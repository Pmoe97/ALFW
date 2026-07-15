// engines/combatData.js — shipped combat content: enemy archetypes, encounter
// templates, and the travel-incident → encounter map. Static frozen data plus
// pure lookups; no world dependency, no dispatch, no randomness — the
// economyData precedent exactly. Content lives in CODE, numeric TUNING
// (hit/damage/flee constants) lives in config.combat: every committed combat
// event carries its fully resolved facts (rosters, rolls, damage, hp), so
// historical folds never re-read these tables and retuning an archetype can
// never rewrite history.
//
// This is deliberately a MINIMAL proof-of-mechanism roster (four archetypes,
// four templates), not a bestiary — content expansion is future scope.

import { getSchema } from './activeSchema.js';

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// Combat's salt band. The global registry so far: terrain/classification
// 11–4001, POI_POOL 60000, POI_EXPLORE 80000, NPC 100000,
// TRAVEL_INCIDENT 120000+legIndex, SHOP_STOCK 200000. Combat claims 300000+,
// striding COMBAT_SALT_STRIDE per combat so every combat's encounter roll and
// per-round rolls get their own decorrelated streams:
//   encounter roll — COMBAT_SALT + combatIndex*COMBAT_SALT_STRIDE
//   round N roll   — COMBAT_SALT + combatIndex*COMBAT_SALT_STRIDE + 1 + N
// (a combat would need 255 rounds to collide with the next combat's band).
export const COMBAT_SALT = 300000;
export const COMBAT_SALT_STRIDE = 256;

// Hard cap on enemies per encounter. Encounter rolls draw a FIXED number of
// values per slot up to this cap regardless of the template's actual size, so
// the stream position never depends on which template was resolved.
export const MAX_ENEMIES = getSchema().combat.maxEnemiesPerEncounter;

// Enemy archetypes — lightweight combatant stat blocks, NOT registry
// entities: no identity/appearance/psychology, so they never enter presence
// or memory fan-out. `attributes` uses the entity band (8–15, with animal
// mind-stats allowed below it); `skills` carries ONLY the primary skills
// combat reads (athletics, acrobatics, fortitude, perception — raws 0–4),
// shaped so entitySchema.effectiveSkill works on a
// {capabilities:{attributes, skills}} wrapper.
//
// A weapon comes from `equipmentDefIds` (the first def whose combat block is
// kind:'weapon'; armor defs sum their combat.armor into armorTotal) or, for
// natural attackers, from `naturalWeapon` (defId:null in committed records).
// `aiMode` is the deterministic policy for the enemy's turn — 'lethal' is
// the only shipped mode (enemies fight to kill; nonlethal intent is a player
// choice with real cost, per the lethality design pillar).
export const ARCHETYPES = deepFreeze({
  wolf: {
    id: 'wolf',
    name: 'Wolf',
    attributes: { strength: 11, agility: 13, toughness: 8, charisma: 3, intelligence: 2, insight: 12 },
    skills: { athletics: 3, acrobatics: 3, fortitude: 0, perception: 3 },
    naturalWeapon: { name: 'bite', skill: 'athletics', damageBase: 3, damageSpread: 2, nonlethalCapable: false },
    aiMode: 'lethal',
    loot: { gold: { min: 0, max: 0 }, stacks: {} },
  },
  bandit_thug: {
    id: 'bandit_thug',
    name: 'Bandit Thug',
    attributes: { strength: 12, agility: 10, toughness: 11, charisma: 8, intelligence: 9, insight: 9 },
    skills: { athletics: 3, acrobatics: 1, fortitude: 2, perception: 1 },
    equipmentDefIds: ['iron_dagger', 'leather_jerkin'],
    aiMode: 'lethal',
    loot: { gold: { min: 5, max: 15 }, stacks: { dried_meat: 1 } },
  },
  bandit_archer: {
    id: 'bandit_archer',
    name: 'Bandit Archer',
    attributes: { strength: 10, agility: 13, toughness: 9, charisma: 8, intelligence: 9, insight: 12 },
    skills: { athletics: 1, acrobatics: 3, fortitude: 1, perception: 3 },
    equipmentDefIds: ['hunting_bow', 'leather_cap'],
    aiMode: 'lethal',
    loot: { gold: { min: 5, max: 15 }, stacks: {} },
  },
  hostile_drifter: {
    id: 'hostile_drifter',
    name: 'Hostile Drifter',
    attributes: { strength: 11, agility: 11, toughness: 10, charisma: 10, intelligence: 10, insight: 10 },
    skills: { athletics: 2, acrobatics: 2, fortitude: 2, perception: 2 },
    equipmentDefIds: ['oak_staff'],
    aiMode: 'lethal',
    loot: { gold: { min: 2, max: 8 }, stacks: {} },
  },
});

// Encounter templates — a named enemy list plus optional outcome
// consequences. Consequence entries dispatch through the REAL existing
// systems (relationship store / faction engine) via the combat engine's
// injected collaborators, the questEngine rewards pattern. Placeholders:
// '$player' resolves to the player's entity id, '$enemyN' to the Nth enemy's
// deterministic combatant id — those ids persist in the log, so e.g. the
// subdued drifter's obedience edge is real, durable relationship state a
// future recruit system could read (that system is explicitly NOT built here).
export const ENCOUNTER_TEMPLATES = deepFreeze({
  tmpl_bandit_ambush: { id: 'tmpl_bandit_ambush', name: 'Bandit Ambush', enemies: ['bandit_thug'] },
  tmpl_bandit_gang: { id: 'tmpl_bandit_gang', name: 'Bandit Gang', enemies: ['bandit_thug', 'bandit_archer'] },
  tmpl_wolf_pack: { id: 'tmpl_wolf_pack', name: 'Wolf Pack', enemies: ['wolf', 'wolf'] },
  tmpl_drifter: {
    id: 'tmpl_drifter',
    name: 'Hostile Drifter',
    enemies: ['hostile_drifter'],
    consequences: {
      onVictoryNonlethal: [
        { kind: 'relationship', fromId: '$enemy0', toId: '$player', axis: 'obedience', delta: 20 },
      ],
    },
  },
});

// Which travel incidents hand off into real combat, keyed by the EXACT
// 'category:intensity' pair. Anything unmapped keeps travelEngine's
// auto-passthrough — deliberately: environmental:3 is a hazard (a future
// hazard-check system, not a fight), mundane never reaches its turn
// threshold, and retuned configs (proofs lower thresholds to 1) must not
// route unmapped pairs like animal:1 into a fight with no template.
export const INCIDENT_ENCOUNTERS = deepFreeze({
  'bandit:2': 'tmpl_bandit_ambush',
  'bandit:3': 'tmpl_bandit_gang',
  'animal:3': 'tmpl_wolf_pack',
  'npc:3': 'tmpl_drifter',
});

// Guarded lookups, getItemDef style: an unknown id is a code bug and dies
// loudly here, not as an undefined-read deep inside a resolution.
export function getArchetype(archetypeId) {
  const arch = ARCHETYPES[archetypeId];
  if (!arch) throw new Error(`Unknown archetype "${archetypeId}"`);
  return arch;
}

export function getEncounterTemplate(templateId) {
  const tmpl = ENCOUNTER_TEMPLATES[templateId];
  if (!tmpl) throw new Error(`Unknown encounter template "${templateId}"`);
  return tmpl;
}
