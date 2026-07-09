// entities/raceRegistry.js — the canonical race list: a LIVE settings surface.
//
// Races live in this ONE store and are read through its accessors everywhere
// race data is needed (the NPC generator, and any future appearance/voice
// consumer) — no engine hardcodes or locally caches a copy of the race list.
//
// This is a deliberate, explicit EXCEPTION to the position-determinism
// discipline worldMapEngine established: the registry is player-adjustable at
// the settings level (add/remove races, toggle them, reweight them), and NPC
// generation reads the CURRENT registry state at the moment of generation. Two
// players on an identical world seed with different registry settings WILL get
// different populations — intentionally. That is why the registry's config
// defaults live in their own top-level `raceRegistry` section, sibling to
// `worldMap`, not inside it: `worldMap.*` is seed-locked generation config,
// `raceRegistry` is live-settings defaults. What IS still deterministic: the
// registry state itself is a pure function of (config defaults + RACE_* events
// in the log), so full-log replay reproduces it exactly — the same log-replay +
// provably-redundant-cache shape as relationshipStore / factionEngine.
//
// Registry edits only ever affect FUTURE generation: the NPC generator commits
// each node's roster to the log permanently at generation time, so toggling a
// race off can never reach backward and mutate, delete, or reroll an NPC that
// already exists.

// The single personality-axis vocabulary, sorted. Extends the hand-authored
// three-axis stub in game/sampleWorld.js (extraversion / agreeableness /
// conscientiousness, 0-10 integers) with dominance and openness — a small
// foundation, not a final exhaustive system. ai/buildDialoguePrompt.js renders
// personalityAxes generically (sorted keys), so hand-authored entities with
// only the original three axes and generated entities with all five coexist
// without any prompt-layer change.
export const PERSONALITY_AXES = Object.freeze([
  'agreeableness',
  'conscientiousness',
  'dominance',
  'extraversion',
  'openness',
]);

const RACE_ADDED = 'RACE_ADDED';
const RACE_REMOVED = 'RACE_REMOVED';
const RACE_ENABLED_SET = 'RACE_ENABLED_SET';
const RACE_WEIGHT_SET = 'RACE_WEIGHT_SET';

// validateRaceDef — fail loudly on a malformed race definition, whether it
// arrives from config defaults (readRaceRegistry) or a live addRace call.
// appearanceOverrides keys are dot-paths into the shared Appearance shape
// ("skin.tone", "hair.color", ...); an override for a path the generator does
// not know is simply never read, so paths are not validated here (the base
// pool table lives in npcGeneratorEngine and this store must not import it).
function validateRaceDef(id, def) {
  const fail = (msg) => {
    throw new Error(`raceRegistry race "${id}" ${msg}`);
  };
  if (!def || typeof def !== 'object') fail('must be an object');
  if (typeof def.displayName !== 'string' || def.displayName.length === 0) fail('needs a displayName');
  if (typeof def.enabled !== 'boolean') fail('needs a boolean enabled');
  if (typeof def.weight !== 'number' || !(def.weight >= 0)) fail('needs a numeric weight >= 0');
  if (!Array.isArray(def.genders) || def.genders.length === 0) fail('needs a non-empty genders array');
  if (!def.namePool || typeof def.namePool !== 'object') fail('needs a namePool');
  for (const g of def.genders) {
    if (!Array.isArray(def.namePool[g]) || def.namePool[g].length === 0) {
      fail(`needs a non-empty namePool.${g} (one list per entry in genders)`);
    }
  }
  if (!Array.isArray(def.surnames)) fail('needs a surnames array (may be empty — lastName becomes "")');
  if (
    !def.ageRange ||
    typeof def.ageRange.min !== 'number' ||
    typeof def.ageRange.max !== 'number' ||
    def.ageRange.min > def.ageRange.max
  ) {
    fail('needs an ageRange { min, max } with min <= max');
  }
  if (!def.axisPriors || typeof def.axisPriors !== 'object') fail('needs an axisPriors object');
  for (const [axis, v] of Object.entries(def.axisPriors)) {
    if (!PERSONALITY_AXES.includes(axis)) fail(`has unknown personality axis "${axis}"`);
    if (typeof v !== 'number' || v < 0 || v > 10) fail(`axis "${axis}" prior must be a number in [0, 10]`);
  }
  for (const key of ['appearanceOverrides', 'appearanceExtensions']) {
    const table = def[key];
    if (!table || typeof table !== 'object') fail(`needs an ${key} object (may be empty)`);
    for (const [field, options] of Object.entries(table)) {
      if (!Array.isArray(options) || options.length === 0 || options.some((o) => typeof o !== 'string')) {
        fail(`${key}.${field} must be a non-empty array of strings`);
      }
    }
  }
  if (def.voiceAccents !== undefined) {
    if (!Array.isArray(def.voiceAccents) || def.voiceAccents.length === 0) {
      fail('voiceAccents, if present, must be a non-empty array');
    }
    for (const accent of def.voiceAccents) {
      if (!accent || typeof accent !== 'object' || typeof accent.name !== 'string' || accent.name === '') {
        fail('each voiceAccents entry must be an object with a non-empty string "name"');
      }
      if (
        accent.signaturePhrases !== undefined &&
        (!Array.isArray(accent.signaturePhrases) || accent.signaturePhrases.some((p) => typeof p !== 'string'))
      ) {
        fail(`voiceAccents entry "${accent.name}" signaturePhrases, if present, must be an array of strings`);
      }
    }
  }
}

// readRaceRegistry — guarded reader for the top-level raceRegistry config
// section, mirroring readPoi/readClassification's up-front validation so
// callers fail loudly on a malformed config rather than deep inside a draw.
export function readRaceRegistry(config) {
  const rr = config?.raceRegistry;
  if (!rr) throw new Error('WorldConfig is missing raceRegistry');
  if (!rr.races || typeof rr.races !== 'object') throw new Error('WorldConfig is missing raceRegistry.races');
  for (const [id, def] of Object.entries(rr.races)) validateRaceDef(id, def);
  return rr;
}

// deriveRaceRegistry — PURE. The current race table: config defaults replayed
// forward through every RACE_* event in log order. Unknown raceIds in
// REMOVED/ENABLED_SET/WEIGHT_SET events are a defensive skip (never a throw on
// a stray payload — the relationshipStore stance). This is the single source
// of truth; the store's cache below is only ever an accelerator that must
// reproduce this exactly (see rebuildRaces).
export function deriveRaceRegistry(config, log) {
  const races = structuredClone(readRaceRegistry(config).races);
  for (const entry of log) {
    const p = entry.payload;
    switch (entry.type) {
      case RACE_ADDED:
        races[p.raceId] = structuredClone(p.def);
        break;
      case RACE_REMOVED:
        delete races[p.raceId];
        break;
      case RACE_ENABLED_SET:
        if (races[p.raceId]) races[p.raceId].enabled = p.enabled;
        break;
      case RACE_WEIGHT_SET:
        if (races[p.raceId]) races[p.raceId].weight = p.weight;
        break;
      default:
        break;
    }
  }
  return races;
}

export function createRaceRegistry(world) {
  const { config } = world.getState();

  // The accelerator cache: raceId -> def, seeded from config defaults and kept
  // current by the subscriptions below. Always fully rebuildable from the log
  // alone via deriveRaceRegistry (see rebuildRaces).
  const current = deriveRaceRegistry(config, []);

  // ORDER MATTERS, exactly as with the relationship store and POI engine:
  // these subscriptions must be registered before any RACE_* is dispatched or
  // the cache would miss those events and silently go stale (only rebuildRaces
  // would then be correct). Construct the registry before any settings edits.
  world.subscribe(RACE_ADDED, (entry) => {
    current[entry.payload.raceId] = structuredClone(entry.payload.def);
  });
  world.subscribe(RACE_REMOVED, (entry) => {
    delete current[entry.payload.raceId];
  });
  world.subscribe(RACE_ENABLED_SET, (entry) => {
    const def = current[entry.payload.raceId];
    if (def) def.enabled = entry.payload.enabled;
  });
  world.subscribe(RACE_WEIGHT_SET, (entry) => {
    const def = current[entry.payload.raceId];
    if (def) def.weight = entry.payload.weight;
  });

  // --- Mutators: the ONLY sanctioned edit paths. Each validates, dispatches,
  // and lets the subscription update the cache — so every settings edit is a
  // logged fact and the registry stays log-replayable. Unknown-id calls return
  // null without dispatching (the POI discover() duplicate-guard style).

  function addRace(id, def) {
    validateRaceDef(id, def);
    world.dispatch(RACE_ADDED, { raceId: id, def });
    return id;
  }

  function removeRace(id) {
    if (!current[id]) return null;
    world.dispatch(RACE_REMOVED, { raceId: id });
    return id;
  }

  function setRaceEnabled(id, enabled) {
    if (!current[id]) return null;
    world.dispatch(RACE_ENABLED_SET, { raceId: id, enabled: Boolean(enabled) });
    return id;
  }

  function setRaceWeight(id, weight) {
    if (typeof weight !== 'number' || !(weight >= 0)) {
      throw new Error(`raceRegistry: weight for "${id}" must be a number >= 0`);
    }
    if (!current[id]) return null;
    world.dispatch(RACE_WEIGHT_SET, { raceId: id, weight });
    return id;
  }

  // --- Accessors: every one returns clones, so callers can never mutate the
  // cache. getRaces/getEnabledRaces sort by id — that stable order is what
  // makes the generator's weightedPick independent of config key order and
  // edit order (the availableCategories discipline in poiEngine).

  function getRace(id) {
    return current[id] ? structuredClone({ id, ...current[id] }) : null;
  }

  function getRaces() {
    return Object.keys(current)
      .sort()
      .map((id) => structuredClone({ id, ...current[id] }));
  }

  function getEnabledRaces() {
    return getRaces().filter((r) => r.enabled && r.weight > 0);
  }

  // rebuildRaces — recompute the race table from the log alone, ignoring the
  // cache, in the same sorted {id, ...def} shape as getRaces. Its equality
  // with getRaces() is the rebuildability proof (mirrors rebuildFactionControl
  // / rebuildRelationshipStats).
  function rebuildRaces() {
    const rebuilt = deriveRaceRegistry(config, world.getEventLog());
    return Object.keys(rebuilt)
      .sort()
      .map((id) => ({ id, ...rebuilt[id] }));
  }

  return {
    addRace,
    removeRace,
    setRaceEnabled,
    setRaceWeight,
    getRace,
    getRaces,
    getEnabledRaces,
    rebuildRaces,
  };
}
