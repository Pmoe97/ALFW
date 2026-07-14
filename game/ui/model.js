// game/ui/model.js — the adapter layer. Every screen's view-model is built here
// from LIVE engine reads, and every field the audit found has no real backing is
// tagged `unwired: true`. This is the single place the wired-vs-unwired audit is
// encoded as data; screens render the flag (via dom.js:markUnwired) but never
// decide it. Nothing here fabricates values to look functional — unwired regions
// carry real empty/derived state or an explicit "—", never invented content.
//
// Engine reads used (all already exported; no engine changes):
//   map.getNode / getOriginNode / classifyAt, poi.getPoiState / getRevealedPoiIds,
//   clock.getCurrentDate, travel.getPlayerNodeId / getActiveActivity / getIncidents,
//   faction.getFactionControl, relationships.getRelationship + relationshipTier,
//   conversationHistory.getConversationHistory, deriveEmotion, effectiveSkill,
//   deriveTimeOfDayBucket, economy.getGold / getInventory / getEquipped /
//   getShopStock / quote (+ priceFor, getItemDef, recipesForStation),
//   quests.getQuestStatuses / getObjectiveProgress (+ questIds, getQuestDef).

import { relationshipTier, TIER_THRESHOLDS } from '../../entities/relationshipStore.js';
import { deriveEmotion } from '../../entities/deriveEmotion.js';
import { deriveTimeOfDayBucket } from '../../engines/worldClockEngine.js';
import { deriveScheduleState } from '../../engines/npcGeneratorEngine.js';
import { weatherForLocation } from '../../engines/weather.js';
import { effectiveSkill, PRIMARY_SKILL_ATTRIBUTE, ATTRIBUTE_NAMES } from '../../entities/entitySchema.js';
import { PERSONALITY_AXES } from '../../entities/raceRegistry.js';
import { priceFor, shopContextOf } from '../../engines/economyEngine.js';
import { getItemDef, recipesForStation, EQUIP_SLOTS } from '../../engines/economyData.js';
import { questIds, getQuestDef } from '../../engines/questData.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const two = (n) => String(n).padStart(2, '0');

// A short, REAL, human-readable label for a node. There is no place-name
// generator in the backend (settlements are opaque ids like settlement_3_5), so
// we surface the real identifier + kind/tier rather than invent "Aldervale".
export function nodeLabel(node) {
  if (!node) return '(unknown)';
  const c = node.classification;
  if (c?.kind === 'settlement') return `${cap(c.tier)} · ${c.settlementId}`;
  return `${cap(node.terrainType)} wilderness`;
}
export function nodeSubLabel(node, faction) {
  const c = node?.classification;
  if (c?.kind === 'settlement') {
    return `${cap(c.tier)} tier${faction ? ` · ${faction}` : ' · unclaimed'}`;
  }
  const notability = c?.notability != null ? c.notability.toFixed(2) : '—';
  const hosp = c?.hospitability != null ? c.hospitability.toFixed(2) : '—';
  return `Wilderness · notability ${notability} · hospitability ${hosp}`;
}

// ---- HUD -------------------------------------------------------------------
export function buildHud(ctx) {
  const { player, engines } = ctx;
  const node = engines.map.getNode(engines.travel.getPlayerNodeId());
  const faction = node?.classification?.kind === 'settlement'
    ? engines.faction.getFactionControl(node)
    : null;
  const d = engines.clock.getCurrentDate();
  const bucket = deriveTimeOfDayBucket(d.hour);
  const first = player.identity.firstName || '';
  const last = player.identity.lastName || '';
  return {
    initials: (first[0] || '') + (last[0] || ''),
    name: `${first} ${last}`.trim(),
    vocation: player.identity.vocation || '',
    level: { text: 'Level —', unwired: true }, // no level field on entities
    location: nodeLabel(node),
    locationSub: nodeSubLabel(node, faction),
    clockText: `${d.monthName} Wk${d.week} Day ${d.day} · ${two(d.hour)}:${two(d.minute)} (${bucket})`,
    visibility: { pct: 0, unwired: true }, // no visibility/notoriety stat exists
  };
}

// ---- FREEPLAY (home base) --------------------------------------------------
// The location-state facts the Freeplay screen renders and the AI/placeholder
// location pipeline keys on. Pure live reads; no generation side effects (the
// NPC roster is only read where already populated, never populateNode'd here).
export function buildFreeplay(ctx) {
  const { engines, config } = ctx;
  const node = engines.map.getNode(engines.travel.getPlayerNodeId());
  const date = engines.clock.getCurrentDate();
  const bucket = deriveTimeOfDayBucket(date.hour);
  const weather = weatherForLocation(config, engines.clock, node);
  // getPoiState returns discovered as a Set of POI ids and undiscovered as stubs;
  // resolve the discovered ids back to their stubs (with categories) via the pool.
  const poiState = node ? engines.poi.getPoiState(node) : { discovered: new Set(), undiscovered: [], pool: [] };
  const discoveredStubs = (poiState.pool || []).filter((p) => poiState.discovered.has(p.id));
  const poiNames = discoveredStubs.map((p) => p.category);
  const rosterIds = node ? (engines.npcGen.rosterIdsAt(node.id) || []) : [];
  const npcNames = rosterIds
    .map((id) => engines.registry.get(id))
    .filter((n) => n && deriveScheduleState(n.schedule, date.hour).available)
    .map((n) => n.identity.firstName);

  const facts = {
    nodeId: node?.id ?? 'unknown',
    terrain: node?.terrainType,
    kind: node?.classification?.kind,
    tier: node?.classification?.tier,
    settlementLabel: node?.classification?.settlementId,
    date: { monthName: date.monthName },
    bucket,
    weather,
    season: date.monthIndex,
    poiNames,
    npcNames,
  };
  return {
    node, date, bucket, weather, facts,
    label: nodeLabel(node),
    poiCount: poiState.discovered?.size ?? 0,
    undiscoveredCount: (poiState.undiscovered || []).length,
    npcNames,
  };
}

// ---- TRAVEL ----------------------------------------------------------------
function tierDisplay(node) {
  const c = node?.classification;
  if (c?.kind === 'settlement') return cap(c.tier);
  if (c?.notability != null) return c.notability >= 0.6 ? 'Notable' : 'Remote';
  return 'Wilds';
}
function formatDuration(gameSeconds) {
  const mins = Math.max(1, Math.round(gameSeconds / 60));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${two(m)}m` : `${m}m`;
}
export function buildTravel(ctx) {
  const { engines, config } = ctx;
  const secPerUnit = config.travel?.gameSecondsPerDistanceUnit ?? 180;
  const here = engines.map.getNode(engines.travel.getPlayerNodeId());
  const faction = here?.classification?.kind === 'settlement'
    ? engines.faction.getFactionControl(here)
    : null;

  const destinations = (here?.edges || []).map((edge) => {
    const dest = engines.map.getNode(edge.to);
    const dist = dest ? Math.hypot(dest.x - here.x, dest.y - here.y) : 0;
    return {
      nodeId: edge.to,
      heading: edge.heading,
      passable: edge.passable,
      x: dest ? dest.x : here.x,
      y: dest ? dest.y : here.y,
      name: dest ? nodeLabel(dest) : '(unmapped)',
      tierDisplay: dest ? tierDisplay(dest) : '—',
      kind: dest?.classification?.kind || 'unknown',
      dist: dist.toFixed(1),
      time: formatDuration(dist * secPerUnit),
      // The flagged UNWIRED case: no per-node difficulty/danger scalar exists.
      // We show the chip styling but the value is not backed by any engine.
      risk: { label: '?', unwired: true },
    };
  });

  const incidents = engines.travel.getIncidents()
    .filter((i) => i.category && i.category !== 'none')
    .map((i) => ({
      legIndex: i.legIndex,
      categoryLabel: incidentCategoryLabel(i.category),
      text: i.narration || '(narration pending…)',
    }))
    .reverse();

  return {
    here,
    hereLabel: nodeLabel(here),
    hereSub: nodeSubLabel(here, faction),
    activity: engines.travel.getActiveActivity(),
    destinations,
    incidents,
    // POI "seek out" targets the player actually holds reveal authority for.
    seekTargets: buildSeekTargets(ctx, here),
  };
}
function incidentCategoryLabel(cat) {
  const labels = { animal: 'Animal', bandit: 'Bandit', npc: 'NPC', environmental: 'Environmental', mundane: 'Mundane', none: 'Quiet' };
  return labels[cat] || cat;
}
function buildSeekTargets(ctx, node) {
  if (!node) return [];
  const { pool, discovered, undiscovered } = ctx.engines.poi.getPoiState(node);
  const revealed = ctx.engines.poi.getRevealedPoiIds();
  return {
    discovered: pool.filter((p) => discovered.has(p.id)).map((p) => ({ id: p.id, category: p.category })),
    total: pool.length,
    found: discovered.size,
    seekable: undiscovered.filter((p) => revealed.has(p.id)).map((p) => ({ id: p.id, category: p.category })),
  };
}

// ---- CONVERSATION ----------------------------------------------------------
export function buildConversation(ctx) {
  const { player, npc, engines, world } = ctx;
  const edge = engines.relationships.getRelationship(npc.id, player.id);
  const tier = relationshipTier(edge.stats);
  const recentMemories = (npc.psychology.memories || []).map((m) => ({ seq: m.seq, summary: m.summary }));
  const emotionRead = deriveEmotion(npc, recentMemories, world.getEventLog());
  const history = engines.conversationHistory.getConversationHistory(npc.id, player.id);

  return {
    name: `${npc.identity.firstName} ${npc.identity.lastName}`.trim(),
    sub: `${cap(npc.identity.race)} · ${npc.identity.age} · ${npc.identity.vocation}`,
    accent: npc.psychology.voice?.accent || '—',
    tier: cap(tier),
    // No 0-100 relationship scale exists; the tier is the real read.
    percent: { unwired: true },
    stats: edge.stats,
    emotion: emotionRead.reads[0]?.emotion || 'calm',
    memories: recentMemories.map((m) => m.summary), // real (may be empty)
    transcript: history.map((line) => ({
      who: line.speakerId === npc.id ? 'npc' : 'player',
      text: line.text,
    })),
    // No dialogue-option generator exists; only the freeform Say box is wired.
    choices: { unwired: true, count: 3 },
  };
}

// ---- JOURNAL ---------------------------------------------------------------
export function buildJournal(ctx) {
  const { player, engines } = ctx;

  // People — WIRED from the relationship store. Show each NPC Rowan has an edge
  // to, with the real tier + real stats. The numeric progress bar the mock shows
  // implies a 0-100 progression system that does not exist → unwired.
  const knownIds = ctx.knownNpcIds || [];
  const people = knownIds.map((id) => {
    const other = engines.registry.get(id);
    const edge = engines.relationships.getRelationship(player.id, id);
    const tier = relationshipTier(edge.stats);
    return {
      name: other ? `${other.identity.firstName} ${other.identity.lastName}`.trim() : id,
      tier: cap(tier),
      statsNote: Object.entries(edge.stats).map(([k, v]) => `${k} ${v}`).join(' · '),
      bar: { unwired: true },
    };
  });

  // Map — WIRED from materialized nodes + POI discovery.
  const nodeIds = ctx.materializedNodeIds ? ctx.materializedNodeIds() : [];
  const nodes = nodeIds.map((id) => engines.map.getNode(id)).filter(Boolean);
  const hereId = engines.travel.getPlayerNodeId();
  const mapNodes = nodes.map((n) => ({
    id: n.id,
    x: n.x,
    y: n.y,
    here: n.id === hereId,
    kind: n.classification?.kind,
    label: nodeLabel(n),
  }));

  // Log (quests) — WIRED from the quest engine: statuses are log-derived,
  // objective progress is pure replay, and the accept/turn-in gating mirrors
  // the engine's own location rule (the giver's node) so the buttons and the
  // verbs can never disagree.
  const statuses = engines.quests.getQuestStatuses();
  const giverNameOf = (id) => {
    const giver = engines.registry.get(id);
    return giver ? `${giver.identity.firstName} ${giver.identity.lastName}`.trim() : id;
  };
  const rewardsNoteOf = (def) => {
    const r = def.rewards ?? {};
    const parts = [];
    if (r.gold) parts.push(`${r.gold}c`);
    for (const [defId, qty] of Object.entries(r.items?.stacks ?? {})) {
      parts.push(`${qty}× ${getItemDef(defId).name}`);
    }
    if ((r.relationshipEvents ?? []).length > 0) {
      const names = [...new Set(r.relationshipEvents.map((ev) => giverNameOf(ev.fromId).split(' ')[0]))];
      parts.push(`${names.join(', ')}'s regard`);
    }
    for (const fc of r.factionControl ?? []) parts.push(`shifts ${fc.settlementId}`);
    return parts.join(' · ') || '—';
  };
  const quests = { available: [], active: [], completed: [], failed: [] };
  for (const questId of questIds()) {
    const def = getQuestDef(questId);
    const status = statuses[questId].status;
    const giverName = giverNameOf(def.giverId);
    const atGiver = hereId === def.giverNodeId;
    if (status === 'available') {
      quests.available.push({
        id: questId,
        title: def.title,
        description: def.description,
        giverName,
        rewardsNote: rewardsNoteOf(def),
        objectives: def.objectives.map((o) => ({ text: o.text })),
        canAccept: atGiver,
        acceptHint: atGiver ? '' : `Offered by ${giverName} — travel to their location to accept`,
      });
    } else if (status === 'active') {
      const objectives = engines.quests.getObjectiveProgress(questId);
      const allDone = objectives.every((o) => o.done);
      quests.active.push({
        id: questId,
        title: def.title,
        description: def.description,
        giverName,
        rewardsNote: rewardsNoteOf(def),
        objectives,
        canTurnIn: allDone && atGiver,
        turnInHint: !allDone ? 'Objectives remain' : atGiver ? '' : `Return to ${giverName} to turn in`,
      });
    } else {
      quests[status].push({ id: questId, title: def.title, giverName });
    }
  }

  return {
    quests,
    people,
    mapNodes,
  };
}

// ---- CHARACTER -------------------------------------------------------------
export function buildCharacter(ctx) {
  const { player } = ctx;
  const axes = player.psychology.personalityAxes || {};
  // Temperament: the 5 canonical axes. Present ones are real; any missing from
  // this entity (the hand-authored trio carry only 3) are genuinely unbacked.
  const temperament = PERSONALITY_AXES.map((axis) => ({
    label: cap(axis),
    value: axes[axis],
    unwired: axes[axis] === undefined,
  }));

  const attributes = ATTRIBUTE_NAMES.map((name) => ({
    label: cap(name),
    value: player.capabilities.attributes[name],
  }));

  const skills = Object.keys(PRIMARY_SKILL_ATTRIBUTE).map((name) => ({
    label: cap(name),
    raw: player.capabilities.skills.primary[name],
    effective: effectiveSkill(player, name),
  }));

  const traits = (player.psychology.personalityTraits || []).map((t) => ({ name: cap(t) }));

  return {
    identity: {
      initials: (player.identity.firstName[0] || '') + (player.identity.lastName[0] || ''),
      name: `${player.identity.firstName} ${player.identity.lastName}`.trim(),
      sub: `${cap(player.identity.race)} · ${player.identity.age} · ${player.identity.vocation}`,
      accent: player.psychology.voice?.accent || '—',
      bio: player.identity.biography || player.identity.background || '',
    },
    temperament,       // wired (present axes) / unwired (absent axes)
    attributes,        // wired
    skills,            // wired
    traits,            // wired (personalityTraits)
    // Health is now wired to the combat engine's vitals fold (max HP derived
    // from toughness/fortitude, current HP a log fold). Stamina/carry remain
    // unbacked, so they stay marked unwired individually.
    vitals: buildVitals(ctx),
    standing: { unwired: true },   // no player faction-standing engine
    perks: { unwired: true },      // no perk system
    visibility: { unwired: true },
  };
}

// ---- ECONOMY-SHARED ---------------------------------------------------------
// Flatten an engine holdings read ({stacks, instances}) into UI rows joined
// with the item definitions. Stack rows key by defId (qty = the count),
// instance rows key by their instanceId (qty = 1) so per-instance items stay
// individually selectable/tradeable.
function holdingsRows(holdings, equippedIds = new Set()) {
  const rows = [];
  for (const defId of Object.keys(holdings.stacks).sort()) {
    const def = getItemDef(defId);
    rows.push({
      key: defId, instanceId: null, defId, name: def.name, category: def.category,
      typeLabel: cap(def.category), weight: def.weight, value: def.baseValue,
      qty: holdings.stacks[defId], slot: null, equipped: false,
    });
  }
  for (const inst of holdings.instances) {
    const def = getItemDef(inst.itemDefId);
    rows.push({
      key: inst.instanceId, instanceId: inst.instanceId, defId: def.id, name: def.name,
      category: def.category, typeLabel: cap(def.category), weight: def.weight,
      value: def.baseValue, qty: 1, slot: def.slot ?? null,
      equipped: equippedIds.has(inst.instanceId),
    });
  }
  return rows;
}

// ---- TRADING (economyEngine — Sable's authored Rusted Ledger stock) ---------
// The offer is UI state: offerPlayerIds / offerMerchantIds hold row keys, one
// occurrence per unit (a stack key may appear several times). This converts
// them to the engine's offer shape; the ENGINE prices and validates via
// quote() — the exact same code path trade() commits through, so an enabled
// Confirm can never dispatch a rejectable trade.
export function offerFromState(state) {
  const toLines = (keys) => {
    const stackCounts = {};
    const lines = [];
    for (const key of keys) {
      if (key.startsWith('itm_')) lines.push({ instanceId: key });
      else stackCounts[key] = (stackCounts[key] ?? 0) + 1;
    }
    for (const defId of Object.keys(stackCounts).sort()) lines.push({ defId, qty: stackCounts[defId] });
    return lines;
  };
  return { buy: toLines(state.offerMerchantIds), sell: toLines(state.offerPlayerIds) };
}

export function buildTrading(ctx, state) {
  const { merchant, player, merchantShopRef, config } = ctx;
  const economy = ctx.engines.economy;
  const shopCtx = shopContextOf(merchantShopRef);
  const stock = economy.getShopStock(merchantShopRef);
  const equippedIds = new Set(Object.values(economy.getEquipped(player.id)));

  const priceRows = (rows, direction) =>
    rows.map((r) => ({ ...r, unitPrice: priceFor(config, getItemDef(r.defId), shopCtx, direction) }));
  const inOfferCounts = (keys) => keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map());
  const playerOffer = inOfferCounts(state.offerPlayerIds);
  const merchantOffer = inOfferCounts(state.offerMerchantIds);

  const playerRows = priceRows(holdingsRows(economy.getInventory(player.id), equippedIds), 'shopBuys')
    .map((r) => ({ ...r, inOffer: playerOffer.get(r.key) ?? 0 }));
  const shopRows = priceRows(holdingsRows(stock), 'shopSells')
    .map((r) => ({ ...r, inOffer: merchantOffer.get(r.key) ?? 0 }));

  const offer = offerFromState(state);
  const empty = offer.buy.length === 0 && offer.sell.length === 0;
  const quoted = empty
    ? { ok: false, empty: true, lines: [], netGold: 0 }
    : { empty: false, ...economy.quote(player.id, merchantShopRef, offer) };

  return {
    merchantName: merchant ? `${merchant.identity.firstName} ${merchant.identity.lastName}`.trim() : 'a merchant',
    merchantSub: merchant ? merchant.identity.vocation : '',
    playerGold: economy.getGold(player.id),
    shopGold: stock.gold,
    playerRows,
    shopRows,
    offer,
    quote: quoted,
  };
}

// ---- CRAFT (economyEngine — recipes, ingredient have/need, skill gates) -----
export const CRAFT_STATIONS = [
  { id: 'blacksmith', label: 'Blacksmithing', stationName: 'The Forge', accent: 'var(--accent)' },
  { id: 'alchemy', label: 'Alchemy', stationName: 'Alchemy Table', accent: 'var(--info)' },
  { id: 'enchanting', label: 'Enchanting', stationName: "Enchanter's Altar", accent: 'var(--good)' },
];
export function buildCraft(ctx, stationId, craftRecipeId) {
  const station = CRAFT_STATIONS.find((s) => s.id === stationId) || CRAFT_STATIONS[0];
  const { player } = ctx;
  const inventory = ctx.engines.economy.getInventory(player.id);
  const owned = (defId) =>
    (inventory.stacks[defId] ?? 0) + inventory.instances.filter((i) => i.itemDefId === defId).length;

  const recipes = recipesForStation(station.id).map((r) => {
    const inputs = Object.entries(r.inputs).map(([defId, need]) => ({
      defId, name: getItemDef(defId).name, need, have: owned(defId), met: owned(defId) >= need,
    }));
    const effective = effectiveSkill(player, r.skill.name);
    const skillGate = { name: r.skill.name, min: r.skill.min, effective, met: effective >= r.skill.min };
    const outDef = getItemDef(r.output.defId);
    return {
      id: r.id,
      name: r.name,
      output: { defId: outDef.id, name: outDef.name, qty: r.output.qty, value: outDef.baseValue },
      inputs,
      skillGate,
      canCraft: skillGate.met && inputs.every((i) => i.met),
    };
  });

  return {
    station,
    recipes,
    selected: recipes.find((r) => r.id === craftRecipeId) ?? recipes[0] ?? null,
  };
}

// ---- INVENTORY (economyEngine — items, equipment, gold) ---------------------
export const INVENTORY_CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'weapons', label: 'Weapons' },
  { id: 'armor', label: 'Armor' },
  { id: 'consumables', label: 'Consumables' },
  { id: 'books', label: 'Books' },
  { id: 'misc', label: 'Misc' },
];
export function buildInventory(ctx, state = {}) {
  const { player } = ctx;
  const economy = ctx.engines.economy;
  const equipped = economy.getEquipped(player.id);
  const equippedIds = new Set(Object.values(equipped));
  const all = holdingsRows(economy.getInventory(player.id), equippedIds);
  const category = state.selectedCategory ?? 'all';
  const items = category === 'all' ? all : all.filter((r) => r.category === category);

  // slot -> the equipped row (for the mannequin chips and mobile equip list).
  const equippedBySlot = {};
  for (const slot of EQUIP_SLOTS) {
    const id = equipped[slot];
    equippedBySlot[slot] = id ? all.find((r) => r.instanceId === id) ?? null : null;
  }

  return {
    gold: economy.getGold(player.id),
    items,
    selected: all.find((r) => r.key === state.selectedItemId) ?? null,
    equippedBySlot,
    // Examine/Favorite stay unwired: there is no examine-text or favorites
    // backing, and the audit marks exactly the missing pieces, no wider.
    examine: { unwired: true },
    favorite: { unwired: true },
  };
}

// buildVitals — the character screen's Vitals panel. Health is real (combat
// engine vitals fold); stamina/carry have no engine, so each is marked unwired
// individually rather than the whole panel.
export function buildVitals(ctx) {
  const combat = ctx.engines?.combat;
  const v = combat?.getVitals(ctx.player.id);
  return {
    health: v ? { hp: v.hp, maxHp: v.maxHp, status: v.status, pct: v.maxHp > 0 ? (v.hp / v.maxHp) * 100 : 0 } : null,
    stamina: { unwired: true },
    carry: { unwired: true },
  };
}

// buildCombat — the combat screen's view-model, entirely from live combat
// engine reads. Returns { active } (null when no fight is open), the player's
// selectable enemy targets, the last round's action log, whether the player is
// defeated, and the usable consumables in the pack.
export function buildCombat(ctx) {
  const { engines, player } = ctx;
  const combat = engines.combat;
  const active = combat.getActiveCombat();
  const defeated = combat.isPlayerDefeated();

  if (!active) {
    const last = combat.getCombatHistory().at(-1) ?? null;
    return { active: null, defeated, lastResult: last, playerVitals: combat.getVitals(player.id) };
  }

  const byId = new Map(active.combatants.map((c) => [c.id, c]));
  const order = active.turnOrder.map((id) => {
    const c = byId.get(id);
    return { id, name: c.name, side: c.side, status: c.status ?? 'alive', hp: c.hp, maxHp: c.maxHp, hpPct: c.maxHp > 0 ? (c.hp / c.maxHp) * 100 : 0, initiative: c.initiative };
  });
  const enemies = order.filter((c) => c.side === 'enemy');
  const playerRow = order.find((c) => c.side === 'player');
  const liveEnemies = enemies.filter((e) => e.status === 'alive');

  // Usable consumables (stackable heals) in the player's pack.
  const inv = engines.economy.getInventory(player.id);
  const consumables = Object.entries(inv.stacks)
    .map(([defId, qty]) => ({ defId, qty, def: getItemDef(defId) }))
    .filter((x) => x.def.combat?.kind === 'consumable')
    .map((x) => ({ defId: x.defId, name: x.def.name, qty: x.qty, heal: x.def.combat.heal }));

  const player_ = byId.get(player.id);
  return {
    active,
    defeated,
    order,
    enemies,
    liveEnemies,
    playerRow,
    playerWeapon: player_?.weapon ?? null,
    round: active.round,
    consumables,
    // the most recent round's per-actor lines, for the log panel
    lastActions: buildLastRoundLog(ctx, active),
  };
}

// buildLastRoundLog — reconstruct the last COMBAT_ROUND_RESOLVED into readable
// lines. Reads the raw log (the combat engine commits full action facts).
function buildLastRoundLog(ctx, active) {
  const log = ctx.world.getEventLog();
  let last = null;
  for (const entry of log) {
    if (entry.type === 'COMBAT_ROUND_RESOLVED' && entry.payload.combatId === active.combatId) last = entry.payload;
  }
  if (!last) return [];
  const nameOf = (id) => active.combatants.find((c) => c.id === id)?.name ?? id;
  return last.actions.map((a) => {
    if (a.action === 'skip' || a.action === 'wait') return `${nameOf(a.actorId)} holds.`;
    if (a.action === 'flee') return a.fleeSuccess ? `${nameOf(a.actorId)} breaks away and flees!` : `${nameOf(a.actorId)} tries to flee, but is cut off.`;
    if (a.action === 'useItem') return `${nameOf(a.actorId)} uses an item (+${a.healed ?? 0} HP).`;
    if (!a.hit) return `${nameOf(a.actorId)} attacks ${nameOf(a.targetId)} — miss.`;
    const killed = a.targetStatusAfter === 'dead' ? ' — slain!' : a.targetStatusAfter === 'subdued' ? ' — subdued!' : '';
    return `${nameOf(a.actorId)} hits ${nameOf(a.targetId)} for ${a.damage}${killed}`;
  });
}

// Shared: relationship tier ladder labels (for a legend, if needed).
export const REL_TIERS = TIER_THRESHOLDS.map((t) => t.label);
