// game/saveLoad.js — serialize and parse the ENTIRE world state.
//
// The whole point of the raw-state discipline (raw state = config + the
// append-only event log; everything else derived) is that a save is exactly
// those two things and nothing else: no engine snapshots, no hand-assembled
// caches. Load is "hand the saved log to createWorldState, rebuild every
// engine, let each one prime its cache from the log it finds" — see
// buildSampleWorld({ save }) for the canonical reconstruction order.
//
// The config is embedded in full so a save is self-contained: a future retune
// of the shipped worldConfig can never silently change what an old save
// replays into (different seeds/tuning => a different world). See
// diffConfigKeys below and buildSampleWorld's use of it — drift from the
// currently-shipped config is surfaced as a loud warning at load time, never
// a silent pass-through and never a hard failure (a save must keep loading
// correctly under the rules it was created with even after the game has
// since been retuned).
//
// No node imports here — this module must bundle for the browser as-is.

export const SAVE_FORMAT = 'alfw-save';
export const SAVE_VERSION = 1;

// assertJsonSafe — throw loudly on values JSON.stringify would silently
// mangle: `undefined` (key dropped — the log would no longer deep-equal after
// a round-trip), functions, and non-plain objects like Map/Set/Date (which
// structuredClone happily carries into the log but JSON cannot represent).
// Better one loud throw at save time than a save that loads subtly wrong.
function assertJsonSafe(value, path) {
  if (value === null) return;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return;
  if (t === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`serializeWorld: non-finite number at ${path} cannot survive JSON`);
    }
    return;
  }
  if (t === 'undefined' || t === 'function' || t === 'bigint' || t === 'symbol') {
    throw new Error(`serializeWorld: ${t} at ${path} cannot survive JSON`);
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertJsonSafe(v, `${path}[${i}]`));
    return;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`serializeWorld: non-plain object (${value.constructor?.name ?? 'unknown'}) at ${path} cannot survive JSON`);
  }
  for (const key of Object.keys(value)) assertJsonSafe(value[key], `${path}.${key}`);
}

// serializeWorld — the save file: a JSON string of { format, version, config,
// eventLog }. Both halves come straight from world.getState() (already deep
// clones), so this function stores raw state only — it cannot see, and
// therefore cannot accidentally snapshot, any engine's derived cache.
export function serializeWorld(world) {
  const { config, eventLog } = world.getState();
  const save = { format: SAVE_FORMAT, version: SAVE_VERSION, config, eventLog };
  assertJsonSafe(save, 'save');
  return JSON.stringify(save);
}

// parseSave — validate a save string and return { config, eventLog }, ready
// for createWorldState(config, eventLog). Shape errors throw with the reason;
// deep validation of the log itself (seq contiguity, entry shape) lives in
// createWorldState so EVERY loaded log passes through it.
// diffConfigKeys — PURE. Top-level config keys that differ between a shipped
// config and a save's embedded config (compared via JSON.stringify per key —
// config is plain JSON-safe data, so this is exact). A save always REPLAYS
// under its OWN embedded config, never the currently-shipped one — that is
// the entire reason config is embedded: a future retune of worldConfig.json
// must not silently change what an old save replays into. Drift is therefore
// never a load-time error, only something worth surfacing loudly (see
// buildSampleWorld's warning) so it doesn't pass unnoticed during development.
export function diffConfigKeys(shipped, saved) {
  const keys = new Set([...Object.keys(shipped ?? {}), ...Object.keys(saved ?? {})]);
  const diffed = [];
  for (const key of keys) {
    if (JSON.stringify(shipped?.[key]) !== JSON.stringify(saved?.[key])) diffed.push(key);
  }
  return diffed.sort();
}

export function parseSave(text) {
  let save;
  try {
    save = JSON.parse(text);
  } catch (err) {
    throw new Error(`parseSave: not valid JSON — ${err.message}`);
  }
  if (save?.format !== SAVE_FORMAT) {
    throw new Error(`parseSave: format "${save?.format}" is not "${SAVE_FORMAT}"`);
  }
  if (save.version !== SAVE_VERSION) {
    throw new Error(`parseSave: unsupported save version ${save.version} (expected ${SAVE_VERSION})`);
  }
  if (save.config === null || typeof save.config !== 'object') {
    throw new Error('parseSave: save has no config object');
  }
  if (!Array.isArray(save.eventLog)) {
    throw new Error('parseSave: save has no eventLog array');
  }
  return { config: save.config, eventLog: save.eventLog };
}
