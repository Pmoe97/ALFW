// engines/combatEngine.js — turn-based combat: HP/vitals, initiative, one-
// round-per-decision resolution, the lethal/nonlethal fork, loot, and the
// downstream relationship/faction consequences of a fight's outcome. The
// system travel's requiresRealTurn incidents finally hand off into.
//
// RAW STATE, as everywhere: (config, append-only log). Nothing here is a
// mutable field — HP, status, the in-progress fight, and combat history are
// all PURE FOLDS of dispatched events (deriveVitalsMap / deriveActiveCombat /
// deriveCombatHistory), cached only as provably-redundant accelerators proven
// equal to a from-scratch replay by the rebuild* methods.
//
// HP is genuinely stateful history (a wound persists between fights), so it
// lives in the log as damage/heal events — NOT a derived-from-nothing value
// and NOT a new field on EntityBase. Max HP, by contrast, IS a pure function
// of the entity's real toughness/fortitude and is never stored.
//
// APPLY vs REACT, strictly (the travelEngine discipline):
//   * apply* handlers fold committed facts into caches; primed over history
//     at construction, then subscribed — one inert code path, so a loaded
//     save reconstructs an in-progress fight identically to how it was built.
//   * the react VERBS (startIncidentCombat / startCombat / act / consumeItem)
//     resolve a live decision with seeded rolls and dispatch ONE atomic
//     outcome event (a whole round in one COMBAT_ROUND_RESOLVED). They are
//     NEVER primed over history: their outcomes are already in a loaded log,
//     so cold-start can never re-roll a fight or re-grant its loot.
//
// AN OPEN FIGHT IS AN OPEN ACTIVITY, exactly like travel's in-transit leg: a
// COMBAT_STARTED with no matching COMBAT_ENDED. It carries timeContext
// 'combat', whose dilation multiplier is 0 (worldConfig), so CLOCK_TICKs
// during a fight advance game-time by nothing — which also freezes an open
// travel leg's elapsed progress and thereby GATES TRAVEL_ARRIVED behind the
// fight with no bespoke logic in the travel engine. A mid-fight save
// round-trips and resumes for free (proof SL18), matching SL15's mid-leg
// precedent.

import { mulberry32 } from '../worldState.js';
import { hashCoords, mapSeed } from './worldMapEngine.js';
import { nodeKeys } from './poiEngine.js';
import { effectiveSkill } from '../entities/entitySchema.js';
import { getItemDef } from './economyData.js';
import { getSchema } from './activeSchema.js';
import {
  COMBAT_SALT, COMBAT_SALT_STRIDE, MAX_ENEMIES,
  getArchetype, getEncounterTemplate, INCIDENT_ENCOUNTERS,
} from './combatData.js';

const COMBAT_STARTED = 'COMBAT_STARTED';
const COMBAT_ROUND_RESOLVED = 'COMBAT_ROUND_RESOLVED';
const COMBAT_ENDED = 'COMBAT_ENDED';
const ITEM_CONSUMED = 'ITEM_CONSUMED';

// Reused real event types (dispatched through injected collaborators, never a
// parallel mechanism) for a fight's downstream consequences.
const RELATIONSHIP_EVENT = 'RELATIONSHIP_EVENT';
const FACTION_CONTROL_CHANGED = 'FACTION_CONTROL_CHANGED';

const COMBAT_TIME_CONTEXT = 'combat';
const TRAVEL_TIME_CONTEXT = 'traveling';
const IDLE_TIME_CONTEXT = 'idle';

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

// Guarded reader for the config.combat tuning block (the readEconomy /
// readTravel fail-loud style — a malformed config dies here, not deep in a
// roll).
function readCombat(config) {
  const c = config?.combat;
  if (!c) throw new Error('WorldConfig is missing combat');
  for (const k of ['hitBase', 'hitPerSkillPoint', 'hitFloor', 'hitCeiling', 'nonlethalDamageFactor', 'fleeBaseChance', 'fleePerAgilityPoint']) {
    if (typeof c[k] !== 'number') throw new Error(`WorldConfig is missing combat.${k}`);
  }
  if (!c.unarmed || typeof c.unarmed.damageBase !== 'number' || typeof c.unarmed.damageSpread !== 'number') {
    throw new Error('WorldConfig is missing combat.unarmed.{damageBase,damageSpread}');
  }
  return c;
}

// ---------------------------------------------------------------------------
// Pure helpers — stat/loadout math shared by encounter building and the UI.
// ---------------------------------------------------------------------------

// deriveMaxHp — PURE, never stored. A function of the entity's real toughness
// and fortitude (the two toughness-flavored existing stats). Works on any
// {capabilities:{attributes, skills}} shape (player entity OR an enemy
// combatant record), so combatants carry their full capabilities snapshot.
export function deriveMaxHp(entityLike) {
  return getSchema().combat.maxHpToughnessMultiplier * entityLike.capabilities.attributes.toughness + effectiveSkill(entityLike, 'fortitude');
}

// Wrap an archetype's flat {attributes, skills:{...}} into the entity
// capabilities shape effectiveSkill/deriveMaxHp expect (primary skills only;
// combat never reads secondary skills).
function archetypeCapabilities(arch) {
  return { attributes: { ...arch.attributes }, skills: { primary: { ...arch.skills }, secondary: {} } };
}

// unarmedWeapon — the fallback loadout (empty hands). Unarmed CAN subdue at
// full damage (nonlethalCapable), so a barehanded takedown is the clean
// nonlethal path when a lethal weapon isn't equipped.
function unarmedWeapon(config) {
  const u = readCombat(config).unarmed;
  return { defId: null, name: 'fists', skill: 'athletics', damageBase: u.damageBase, damageSpread: u.damageSpread, nonlethalCapable: true, ranged: false };
}

// weaponFromDef — read a weapon's committed combat block into a combatant
// weapon record. Null/non-weapon → unarmed.
function weaponFromDef(config, def) {
  const c = def?.combat;
  if (!c || c.kind !== 'weapon') return unarmedWeapon(config);
  return {
    defId: def.id,
    name: def.name,
    skill: c.skill,
    damageBase: c.damageBase,
    damageSpread: c.damageSpread,
    nonlethalCapable: !!c.nonlethalCapable,
    ranged: !!c.ranged,
  };
}

// playerLoadout — the player's live equipped weapon + summed armor, read from
// the REAL economy engine (getEquipped + getInventory), snapshotted into the
// COMBAT_STARTED record. Combat blocks navigation, so a start-of-fight
// snapshot is authoritative for the whole fight.
function playerLoadout(config, economy, playerId) {
  const equipped = economy.getEquipped(playerId);
  const inv = economy.getInventory(playerId);
  const defOfInstance = (instanceId) => {
    const inst = inv.instances.find((i) => i.instanceId === instanceId);
    return inst ? getItemDef(inst.itemDefId) : null;
  };
  const weapon = weaponFromDef(config, equipped.mainHand ? defOfInstance(equipped.mainHand) : null);
  let armorTotal = 0;
  for (const instanceId of Object.values(equipped)) {
    const def = defOfInstance(instanceId);
    if (def?.combat?.kind === 'armor') armorTotal += def.combat.armor;
  }
  return { weapon, armorTotal };
}

// enemyLoadout — an archetype's weapon (naturalWeapon, or the first weapon in
// equipmentDefIds) and summed armor from its equipped defs.
function enemyLoadout(config, arch) {
  let weapon = null;
  let armorTotal = 0;
  for (const defId of arch.equipmentDefIds ?? []) {
    const def = getItemDef(defId);
    if (def.combat?.kind === 'weapon' && !weapon) weapon = weaponFromDef(config, def);
    else if (def.combat?.kind === 'armor') armorTotal += def.combat.armor;
  }
  if (!weapon) {
    weapon = arch.naturalWeapon
      ? { defId: null, ...arch.naturalWeapon, ranged: !!arch.naturalWeapon.ranged }
      : unarmedWeapon(config);
  }
  return { weapon, armorTotal };
}

function initiativeOf(combatant) {
  return combatant.capabilities.attributes.agility + effectiveSkill(combatant, 'perception');
}

// ---------------------------------------------------------------------------
// Pure derivations over the log.
// ---------------------------------------------------------------------------

// deriveCombatCount — number of fights ever started. Feeds the per-combat RNG
// salt band (the deriveLegCount idiom) and combatant ids; feeds ONLY the seed,
// never any probability.
export function deriveCombatCount(log) {
  let n = 0;
  for (const entry of log) if (entry.type === COMBAT_STARTED) n += 1;
  return n;
}

// deriveEncounter — PURE. The seeded enemy roster + loot for one encounter:
// same seed + same combatIndex + same node → the same fight, every time.
// Draws a FIXED number of values per enemy slot up to MAX_ENEMIES regardless
// of the template's real size, so the stream position never depends on which
// template resolved.
export function deriveEncounter(config, node, templateId, combatIndex) {
  const template = getEncounterTemplate(templateId);
  const seed = mapSeed(config);
  const { kx, ky } = nodeKeys(node);
  const rng = mulberry32(hashCoords(seed, COMBAT_SALT + combatIndex * COMBAT_SALT_STRIDE, kx, ky));

  const enemies = [];
  for (let i = 0; i < MAX_ENEMIES; i++) {
    const lootDraw = rng();
    rng(); // reserved second draw — consumed regardless, so the stride is fixed
    const archetypeId = template.enemies[i];
    if (!archetypeId) continue; // slot beyond this template: draws still consumed above
    const arch = getArchetype(archetypeId);
    const capabilities = archetypeCapabilities(arch);
    const { weapon, armorTotal } = enemyLoadout(config, arch);
    const maxHp = deriveMaxHp({ capabilities });
    const goldSpan = arch.loot.gold.max - arch.loot.gold.min;
    const gold = arch.loot.gold.min + (goldSpan > 0 ? Math.floor(lootDraw * (goldSpan + 1)) : 0);
    enemies.push({
      id: `cmb_${combatIndex}_e${i}`,
      side: 'enemy',
      name: arch.name,
      archetypeId,
      capabilities,
      weapon,
      armorTotal,
      maxHp,
      hp: maxHp,
      initiative: initiativeOf({ capabilities }),
      aiMode: arch.aiMode,
      loot: { gold, stacks: { ...arch.loot.stacks } },
    });
  }
  return { templateId, enemies };
}

// deriveTurnOrder — PURE. Initiative desc; ties broken player-first, then
// combatants-array order. Deterministic, committed in COMBAT_STARTED so replay
// never recomputes.
function deriveTurnOrder(combatants) {
  return combatants
    .map((c, index) => ({ id: c.id, initiative: c.initiative, isPlayer: c.side === 'player', index }))
    .sort((a, b) => (b.initiative - a.initiative) || (Number(b.isPlayer) - Number(a.isPlayer)) || (a.index - b.index))
    .map((c) => c.id);
}

// deriveVitalsMap — PURE. entityId -> {hp, maxHp, status}. Every value is a
// committed snapshot; the fold NEVER re-does combat math (COMBAT_STARTED and
// COMBAT_ROUND_RESOLVED carry fully resolved hp).
export function deriveVitalsMap(log) {
  const vitals = new Map();
  for (const entry of log) {
    const p = entry.payload;
    if (entry.type === COMBAT_STARTED) {
      for (const c of p.combatants) vitals.set(c.id, { hp: c.hp, maxHp: c.maxHp, status: 'alive' });
    } else if (entry.type === COMBAT_ROUND_RESOLVED) {
      for (const [id, hp] of Object.entries(p.hpAfter)) {
        const v = vitals.get(id) ?? { hp, maxHp: hp, status: 'alive' };
        vitals.set(id, { ...v, hp, status: p.statusAfter[id] ?? v.status });
      }
    } else if (entry.type === ITEM_CONSUMED) {
      const v = vitals.get(p.entityId);
      if (v) vitals.set(p.entityId, { ...v, hp: p.effect.hpAfter });
    }
  }
  return vitals;
}

// deriveActiveCombat — PURE. The open fight (COMBAT_STARTED with no matching
// COMBAT_ENDED), with live hp/status overlaid and `round` = rounds resolved so
// far; null when no fight is open. This is the save/load-resumable snapshot,
// exactly like travel's deriveActiveActivity.
export function deriveActiveCombat(log) {
  let active = null;
  for (const entry of log) {
    const p = entry.payload;
    if (entry.type === COMBAT_STARTED) {
      active = {
        combatId: p.combatId,
        combatIndex: p.combatIndex,
        source: structuredClone(p.source),
        nodeId: p.nodeId,
        templateId: p.templateId,
        combatants: structuredClone(p.combatants).map((c) => ({ ...c, status: 'alive' })),
        turnOrder: [...p.turnOrder],
        round: 0,
      };
    } else if (entry.type === COMBAT_ROUND_RESOLVED && active && p.combatId === active.combatId) {
      for (const c of active.combatants) {
        if (p.hpAfter[c.id] !== undefined) c.hp = p.hpAfter[c.id];
        if (p.statusAfter[c.id] !== undefined) c.status = p.statusAfter[c.id];
      }
      active.round += 1;
    } else if (entry.type === ITEM_CONSUMED && active && p.combatId === active.combatId) {
      const c = active.combatants.find((x) => x.id === p.entityId);
      if (c) c.hp = p.effect.hpAfter;
    } else if (entry.type === COMBAT_ENDED && active && p.combatId === active.combatId) {
      active = null;
    }
  }
  return active;
}

// deriveCombatHistory — PURE. Closed fights, oldest first. Folds STARTED for
// provenance and emits one record per COMBAT_ENDED.
export function deriveCombatHistory(log) {
  const started = new Map();
  const history = [];
  for (const entry of log) {
    const p = entry.payload;
    if (entry.type === COMBAT_STARTED) {
      started.set(p.combatId, { templateId: p.templateId, source: p.source });
    } else if (entry.type === COMBAT_ENDED) {
      const s = started.get(p.combatId) ?? {};
      history.push({
        combatId: p.combatId,
        templateId: s.templateId ?? null,
        source: structuredClone(s.source ?? null),
        outcome: p.outcome,
        mode: p.mode ?? null,
        rounds: p.rounds,
        finalStatuses: { ...p.finalStatuses },
      });
    }
  }
  return history;
}

// ---------------------------------------------------------------------------
// Pure round resolution — the seeded combat math for ONE round.
// ---------------------------------------------------------------------------

// resolveRound — PURE over (config, active snapshot, playerId, playerAction,
// rng). Resolves every combatant's action in turn order into ONE round's
// worth of facts. Draws EXACTLY two values (hit, damage) per turn-order slot,
// in order, consumed even for skip/wait/useItem, so the stream position is a
// pure function of roster size (the deriveTravelIncident fixed-draw contract).
// Returns { actions, hpAfter, statusAfter, ended, outcome, mode, itemUse }.
export function resolveRound(config, active, playerId, playerAction, rng) {
  const c = readCombat(config);
  const schema = getSchema().combat;
  const byId = new Map(active.combatants.map((x) => [x.id, { ...x, status: x.status ?? 'alive' }]));
  const isActive = (x) => x.status === 'alive';
  const enemies = () => [...byId.values()].filter((x) => x.side === 'enemy');
  const player = byId.get(playerId);

  const actions = [];
  let fled = false;
  let itemUse = null; // {defId, healed, hpBefore, hpAfter} — a separate ITEM_CONSUMED

  const attack = (attacker, defender, mode) => {
    const w = attacker.weapon;
    const hitDraw = rng.hit;
    const dmgDraw = rng.dmg;
    const acc = effectiveSkill(attacker, w.skill) - effectiveSkill(defender, 'acrobatics');
    const hitChance = clamp(c.hitBase + c.hitPerSkillPoint * acc, c.hitFloor, c.hitCeiling);
    const hit = hitDraw < hitChance;
    const record = { actorId: attacker.id, action: mode === 'nonlethal' ? 'attackNonlethal' : 'attackLethal', targetId: defender.id, mode, weaponDefId: w.defId, rolls: { hit: hitDraw, damage: dmgDraw }, hit };
    if (hit) {
      const attrBonus = Math.floor((w.ranged ? attacker.capabilities.attributes.agility : attacker.capabilities.attributes.strength) / schema.attackAttributeDivisor);
      let raw = w.damageBase + Math.floor(dmgDraw * (w.damageSpread + 1)) + attrBonus;
      let dmg = Math.max(schema.minDamage, raw - defender.armorTotal);
      if (mode === 'nonlethal' && !w.nonlethalCapable) dmg = Math.max(schema.minDamage, Math.floor(dmg * c.nonlethalDamageFactor));
      const before = defender.hp;
      defender.hp = Math.max(0, defender.hp - dmg);
      if (defender.hp === 0) defender.status = mode === 'nonlethal' ? 'subdued' : 'dead';
      record.damage = dmg;
      record.targetHpBefore = before;
      record.targetHpAfter = defender.hp;
      record.targetStatusAfter = defender.status;
    }
    return record;
  };

  for (const id of active.turnOrder) {
    const actor = byId.get(id);
    // Two draws per slot, ALWAYS, before any branch — fixed stride.
    rng.hit = rng.next();
    rng.dmg = rng.next();

    if (fled || !isActive(actor)) {
      actions.push({ actorId: id, action: 'skip', rolls: { hit: rng.hit, damage: rng.dmg } });
      continue;
    }

    if (id === playerId) {
      const type = playerAction?.type ?? 'wait';
      if (type === 'flee') {
        const fleeChance = clamp(c.fleeBaseChance + c.fleePerAgilityPoint * (effectiveSkill(actor, 'acrobatics') - Math.max(0, ...enemies().filter(isActive).map((e) => e.capabilities.attributes.agility))), schema.fleeChanceClamp.min, schema.fleeChanceClamp.max);
        const success = rng.hit < fleeChance;
        actions.push({ actorId: id, action: 'flee', rolls: { hit: rng.hit, damage: rng.dmg }, fleeSuccess: success });
        if (success) fled = true;
      } else if (type === 'useItem') {
        const def = getItemDef(playerAction.defId);
        const heal = def.combat?.heal ?? 0;
        const before = actor.hp;
        actor.hp = Math.min(actor.maxHp, actor.hp + heal);
        itemUse = { defId: def.id, healed: actor.hp - before, hpBefore: before, hpAfter: actor.hp };
        actions.push({ actorId: id, action: 'useItem', itemDefId: def.id, rolls: { hit: rng.hit, damage: rng.dmg }, healed: itemUse.healed, targetHpAfter: actor.hp });
      } else if (type === 'attackLethal' || type === 'attackNonlethal') {
        const target = byId.get(playerAction.targetId);
        const mode = type === 'attackNonlethal' ? 'nonlethal' : 'lethal';
        actions.push(attack(actor, target, mode));
      } else {
        actions.push({ actorId: id, action: 'wait', rolls: { hit: rng.hit, damage: rng.dmg } });
      }
    } else {
      // Enemy AI: attack the player with the archetype's mode (lethal).
      if (isActive(player)) {
        actions.push(attack(actor, player, actor.aiMode === 'nonlethal' ? 'nonlethal' : 'lethal'));
      } else {
        actions.push({ actorId: id, action: 'wait', rolls: { hit: rng.hit, damage: rng.dmg } });
      }
    }
  }

  const hpAfter = {};
  const statusAfter = {};
  for (const x of byId.values()) { hpAfter[x.id] = x.hp; statusAfter[x.id] = x.status; }

  // Terminal detection.
  let ended = false;
  let outcome = null;
  let mode = null;
  const liveEnemies = enemies().filter(isActive);
  if (fled) {
    ended = true; outcome = 'fled';
  } else if (!isActive(player)) {
    ended = true; outcome = 'defeat';
  } else if (liveEnemies.length === 0) {
    ended = true; outcome = 'victory';
    const finals = enemies().map((e) => e.status);
    const anyDead = finals.includes('dead');
    const anySub = finals.includes('subdued');
    mode = anyDead && anySub ? 'mixed' : anySub ? 'nonlethal' : 'lethal';
  }
  return { actions, hpAfter, statusAfter, ended, outcome, mode, itemUse };
}

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

export function createCombatEngine(world, { playerId, registry, map, economy, relationships, faction }) {
  const config = world.getState().config;
  readCombat(config); // validate up front

  // Provably-redundant caches, each rebuildable from the log alone.
  let cachedActive = deriveActiveCombat(world.getEventLog());
  let cachedVitals = deriveVitalsMap(world.getEventLog());
  let cachedHistory = deriveCombatHistory(world.getEventLog());
  let cachedCount = deriveCombatCount(world.getEventLog());

  // --- apply handlers: the ONE fold path per event type, primed then live.
  function applyCombatStarted(entry) {
    const p = entry.payload;
    cachedCount += 1;
    for (const c of p.combatants) cachedVitals.set(c.id, { hp: c.hp, maxHp: c.maxHp, status: 'alive' });
    cachedActive = {
      combatId: p.combatId,
      combatIndex: p.combatIndex,
      source: structuredClone(p.source),
      nodeId: p.nodeId,
      templateId: p.templateId,
      combatants: structuredClone(p.combatants).map((c) => ({ ...c, status: 'alive' })),
      turnOrder: [...p.turnOrder],
      round: 0,
    };
  }

  function applyRoundResolved(entry) {
    const p = entry.payload;
    for (const [id, hp] of Object.entries(p.hpAfter)) {
      const v = cachedVitals.get(id) ?? { hp, maxHp: hp, status: 'alive' };
      cachedVitals.set(id, { ...v, hp, status: p.statusAfter[id] ?? v.status });
    }
    if (cachedActive && cachedActive.combatId === p.combatId) {
      for (const c of cachedActive.combatants) {
        if (p.hpAfter[c.id] !== undefined) c.hp = p.hpAfter[c.id];
        if (p.statusAfter[c.id] !== undefined) c.status = p.statusAfter[c.id];
      }
      cachedActive.round += 1;
    }
  }

  function applyItemConsumed(entry) {
    const p = entry.payload;
    const v = cachedVitals.get(p.entityId);
    if (v) cachedVitals.set(p.entityId, { ...v, hp: p.effect.hpAfter });
    if (cachedActive && p.combatId === cachedActive.combatId) {
      const c = cachedActive.combatants.find((x) => x.id === p.entityId);
      if (c) c.hp = p.effect.hpAfter;
    }
  }

  function applyCombatEnded(entry) {
    const p = entry.payload;
    if (cachedActive && cachedActive.combatId === p.combatId) {
      const s = { templateId: cachedActive.templateId, source: cachedActive.source };
      cachedHistory.push({
        combatId: p.combatId,
        templateId: s.templateId ?? null,
        source: structuredClone(s.source ?? null),
        outcome: p.outcome,
        mode: p.mode ?? null,
        rounds: p.rounds,
        finalStatuses: { ...p.finalStatuses },
      });
      cachedActive = null;
    }
  }

  const APPLY = {
    [COMBAT_STARTED]: applyCombatStarted,
    [COMBAT_ROUND_RESOLVED]: applyRoundResolved,
    [ITEM_CONSUMED]: applyItemConsumed,
    [COMBAT_ENDED]: applyCombatEnded,
  };

  // Prime from history (cold-start against a loaded save reconstructs an
  // in-progress fight here), then subscribe. The caches were already primed by
  // the derive* calls above; re-priming via the fold would double-count, so we
  // ONLY subscribe live — deriveActiveCombat/deriveVitalsMap/etc. already
  // folded the whole log, and the apply handlers take over from the next
  // dispatch. (This mirrors travelEngine priming cachedIncidents via a derive
  // and folding new ones live.)
  for (const [type, handler] of Object.entries(APPLY)) {
    world.subscribe(type, handler);
  }

  // --- readers (clone; a caller can never mutate a cache).
  function getActiveCombat() {
    return cachedActive ? structuredClone(cachedActive) : null;
  }
  function getVitals(entityId) {
    if (cachedVitals.has(entityId)) return { ...cachedVitals.get(entityId) };
    const entity = registry?.get(entityId);
    if (!entity) return null;
    const maxHp = deriveMaxHp(entity);
    return { hp: maxHp, maxHp, status: 'alive' };
  }
  function getCombatHistory() {
    return structuredClone(cachedHistory);
  }
  function isPlayerDefeated() {
    return getVitals(playerId)?.status === 'dead';
  }
  function hasEncounterFor(category, intensity) {
    return Object.prototype.hasOwnProperty.call(INCIDENT_ENCOUNTERS, `${category}:${intensity}`);
  }

  // --- build a COMBAT_STARTED payload and dispatch it (shared by both entries).
  function dispatchStart(node, templateId, source) {
    if (cachedActive) throw new Error('CombatEngine: cannot start a combat while one is already open');
    if (isPlayerDefeated()) throw new Error('CombatEngine: the player is defeated');
    const combatIndex = cachedCount;
    const { enemies } = deriveEncounter(config, node, templateId, combatIndex);

    const player = registry.get(playerId);
    const { weapon, armorTotal } = playerLoadout(config, economy, playerId);
    const maxHp = deriveMaxHp(player);
    const currentHp = getVitals(playerId)?.hp ?? maxHp;
    const playerCombatant = {
      id: playerId,
      side: 'player',
      name: `${player.identity.firstName} ${player.identity.lastName}`.trim(),
      capabilities: structuredClone(player.capabilities),
      weapon,
      armorTotal,
      maxHp,
      hp: currentHp,
      initiative: initiativeOf(player),
    };

    const combatants = [playerCombatant, ...enemies];
    const payload = {
      combatId: `cmb_${combatIndex}`,
      combatIndex,
      source,
      nodeId: node.id,
      templateId,
      combatants,
      turnOrder: deriveTurnOrder(combatants),
      timeContext: COMBAT_TIME_CONTEXT,
    };
    return world.dispatch(COMBAT_STARTED, payload);
  }

  // startIncidentCombat — travel's hook. Called ONLY from travel's
  // reactTravelStarted (itself never primed), so cold-start never re-starts a
  // fight. `intensity` selects the template via the incident map.
  function startIncidentCombat({ legIndex, fromNode, toNodeId, category, intensity }) {
    const templateId = INCIDENT_ENCOUNTERS[`${category}:${intensity}`];
    if (!templateId) throw new Error(`No encounter mapped for ${category}:${intensity}`);
    return dispatchStart(fromNode, templateId, {
      kind: 'travelIncident', legIndex, fromNodeId: fromNode.id, toNodeId, category, intensity,
    });
  }

  // startCombat — scripted/debug/proof entry. Node supplies the RNG anchor.
  function startCombat(templateId, node, source = {}) {
    return dispatchStart(node, templateId, { kind: 'scripted', nodeId: node.id, ...source });
  }

  // --- act — resolve ONE round from the player's chosen action. Dispatches
  // one COMBAT_ROUND_RESOLVED (plus a preceding ITEM_CONSUMED if an item was
  // used, and a trailing COMBAT_ENDED with loot/consequences if terminal). All
  // synchronous, so a save can only ever land BETWEEN rounds — always
  // resumable. Never primed over history.
  function act(playerAction = { type: 'wait' }) {
    const fail = (reason) => ({ ok: false, reason });
    if (!cachedActive) return fail('no combat is open');
    if (isPlayerDefeated()) return fail('the player is defeated');
    const active = getActiveCombat();

    // Live validation of the player's action against the current snapshot.
    const type = playerAction.type;
    if (type === 'attackLethal' || type === 'attackNonlethal') {
      const target = active.combatants.find((c) => c.id === playerAction.targetId);
      if (!target || target.side !== 'enemy') return fail('invalid target');
      if ((target.status ?? 'alive') !== 'alive') return fail('target is not active');
    } else if (type === 'useItem') {
      const def = getItemDef(playerAction.defId);
      if (def.combat?.kind !== 'consumable') return fail(`${def.name} is not usable in combat`);
      if ((economy.getInventory(playerId).stacks[def.id] ?? 0) < 1) return fail(`you have no ${def.name}`);
    } else if (type !== 'flee' && type !== 'wait') {
      return fail(`unknown action "${type}"`);
    }

    // Seed the round's RNG: its own salt slot, fixed two-draws-per-slot stride.
    const node = map.getNode(active.nodeId);
    const { kx, ky } = nodeKeys(node);
    const stream = mulberry32(hashCoords(mapSeed(config), COMBAT_SALT + active.combatIndex * COMBAT_SALT_STRIDE + 1 + active.round, kx, ky));
    const rng = { next: stream, hit: 0, dmg: 0 };

    const result = resolveRound(config, active, playerId, playerAction, rng);

    // Build the full list of resultant events before dispatching any of them
    // — an in-combat item use, then the round, then (if the fight ended)
    // loot + consequences + COMBAT_ENDED last — and commit them in ONE
    // world.dispatchBatch call, the completeQuest discipline (see
    // worldState.js's dispatchBatch): a failure anywhere in the build leaves
    // the log untouched instead of stranding an already-committed round with
    // no COMBAT_ENDED ever closing it out.
    const events = [];

    // An in-combat item use is its own ITEM_CONSUMED (economy decrements the
    // stack; combat folds the interim hp), ordered BEFORE the round event so
    // the round's authoritative hpAfter folds last.
    if (result.itemUse) {
      events.push({
        type: ITEM_CONSUMED,
        payload: {
          entityId: playerId,
          stacks: { [result.itemUse.defId]: 1 },
          effect: { healed: result.itemUse.healed, hpBefore: result.itemUse.hpBefore, hpAfter: result.itemUse.hpAfter },
          combatId: active.combatId,
          reason: active.combatId,
        },
      });
    }

    events.push({
      type: COMBAT_ROUND_RESOLVED,
      payload: {
        combatId: active.combatId,
        round: active.round,
        actions: result.actions,
        hpAfter: result.hpAfter,
        statusAfter: result.statusAfter,
      },
    });

    if (result.ended) {
      events.push(...resolveFinishCombat(active, result));
    }

    const entries = world.dispatchBatch(events);
    const entry = entries.find((e) => e.type === COMBAT_ROUND_RESOLVED);
    return { ok: true, entry, ended: result.ended, outcome: result.outcome };
  }

  // resolveFinishCombat — PURE event construction, no dispatch: loot grants +
  // template consequences, THEN COMBAT_ENDED last (the questEngine "status
  // fact commits last" ordering, preserved here as "COMBAT_ENDED is the last
  // element"). Appended to act()'s batch rather than dispatched directly.
  // timeContext hands time back: 'traveling' resumes a travel leg (which then
  // arrives), 'idle' for a scripted fight.
  function resolveFinishCombat(active, result) {
    const events = [];
    const rounds = active.round + 1;
    const finalStatuses = { ...result.statusAfter };
    const fromTravel = active.source?.kind === 'travelIncident';

    if (result.outcome === 'victory') {
      const template = getEncounterTemplate(active.templateId);
      // Loot every non-fled enemy (dead or subdued — a captured foe can still
      // be looted). Amounts were resolved and committed at COMBAT_STARTED.
      let gold = 0;
      const stacks = {};
      for (const c of active.combatants) {
        if (c.side !== 'enemy' || !c.loot) continue;
        gold += c.loot.gold;
        for (const [defId, qty] of Object.entries(c.loot.stacks)) stacks[defId] = (stacks[defId] ?? 0) + qty;
      }
      if (gold > 0) events.push(economy.resolveGrantGold(playerId, gold, active.combatId));
      if (Object.keys(stacks).length > 0) events.push(economy.resolveGrantItems(playerId, { stacks }, active.combatId));

      events.push(...resolveConsequences(template, result.mode, active));
    }

    events.push({
      type: COMBAT_ENDED,
      payload: {
        combatId: active.combatId,
        outcome: result.outcome,
        mode: result.mode ?? null,
        rounds,
        finalStatuses,
        timeContext: fromTravel ? TRAVEL_TIME_CONTEXT : IDLE_TIME_CONTEXT,
      },
    });
    return events;
  }

  // resolveConsequences — PURE event construction for a template's outcome
  // consequences through the REAL relationship/faction event shapes.
  // $player/$enemyN placeholders resolve to real, persistent combatant ids.
  function resolveConsequences(template, mode, active) {
    const list = mode === 'nonlethal'
      ? template.consequences?.onVictoryNonlethal
      : template.consequences?.onVictoryLethal;
    if (!list) return [];
    const resolveId = (token) => {
      if (token === '$player') return playerId;
      const m = /^\$enemy(\d+)$/.exec(token);
      if (m) return active.combatants.filter((c) => c.side === 'enemy')[Number(m[1])]?.id ?? token;
      return token;
    };
    const events = [];
    for (const cons of list) {
      if (cons.kind === 'relationship') {
        events.push(relationships.resolveRelationshipEvent(resolveId(cons.fromId), resolveId(cons.toId), cons.axis, cons.delta));
      } else if (cons.kind === 'factionControl') {
        events.push(faction.resolveFactionControlChange(cons.settlementId, cons.factionId));
      }
    }
    return events;
  }

  // consumeItem — out-of-combat heal (the general consumable channel). One
  // ITEM_CONSUMED; economy decrements, this engine folds hp.
  function consumeItem(entityId, defId) {
    const fail = (reason) => ({ ok: false, reason });
    if (cachedActive) return fail('use items via act() during combat');
    const def = getItemDef(defId);
    if (def.combat?.kind !== 'consumable') return fail(`${def.name} is not consumable`);
    if ((economy.getInventory(entityId).stacks[defId] ?? 0) < 1) return fail(`no ${def.name} to use`);
    const v = getVitals(entityId);
    if (!v) return fail(`unknown entity "${entityId}"`);
    if (v.status === 'dead') return fail('the dead cannot be healed');
    const heal = def.combat.heal ?? 0;
    const hpAfter = Math.min(v.maxHp, v.hp + heal);
    const entry = world.dispatch(ITEM_CONSUMED, {
      entityId,
      stacks: { [defId]: 1 },
      effect: { healed: hpAfter - v.hp, hpBefore: v.hp, hpAfter },
      reason: 'consume',
    });
    return { ok: true, entry };
  }

  // --- rebuild proofs: recompute from the log alone, ignoring every cache.
  function rebuildActiveCombat() {
    return deriveActiveCombat(world.getEventLog());
  }
  function rebuildVitals() {
    return deriveVitalsMap(world.getEventLog());
  }
  function rebuildCombatHistory() {
    return deriveCombatHistory(world.getEventLog());
  }

  return {
    startIncidentCombat,
    startCombat,
    act,
    consumeItem,
    hasEncounterFor,
    getActiveCombat,
    getVitals,
    getCombatHistory,
    isPlayerDefeated,
    rebuildActiveCombat,
    rebuildVitals,
    rebuildCombatHistory,
  };
}
