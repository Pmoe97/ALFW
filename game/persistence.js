// game/persistence.js — the ONLY persistent store in the game: named world
// presets (config templates, distinct from saves) and named save slots. Both
// live in localStorage; the existing serializeWorld/parseSave (game/saveLoad.js)
// already reduce a whole world to { config, eventLog }, so a save slot is just
// that string plus a little display metadata.
//
// Perchance runs under a strict CSP and localStorage can be unavailable or
// throw; pickBackend() probes once and falls back to an in-memory Map so the
// flow never crashes off a real page (saves simply don't survive a reload then).
//
// Presets are a template LIBRARY that outlives any single playthrough; saves are
// individual runs. They are stored under separate keys and never commingled.

import { serializeWorld, parseSave } from './saveLoad.js';

const PRESETS_KEY = 'alfw:presets:v1';
const SAVES_KEY = 'alfw:saves:v1';

function memoryBackend() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, v),
    removeItem: (k) => m.delete(k),
    persistent: false,
  };
}

// pickBackend — real localStorage when it's present AND writable (the probe
// catches Safari private-mode / CSP throws), else an in-memory shim.
function pickBackend() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return memoryBackend();
    const probe = '__alfw_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    ls.persistent = true;
    return ls;
  } catch {
    return memoryBackend();
  }
}

export function createPersistence(backend = pickBackend()) {
  function readMap(key) {
    const raw = backend.getItem(key);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {}; // corrupt blob — treat as empty rather than crash the menu
    }
  }
  function writeMap(key, map) {
    backend.setItem(key, JSON.stringify(map));
  }

  // --- Presets: named config templates --------------------------------------
  function listPresets() {
    const map = readMap(PRESETS_KEY);
    return Object.keys(map).sort().map((name) => ({ name }));
  }
  function getPreset(name) {
    return readMap(PRESETS_KEY)[name] ?? null;
  }
  function savePreset(name, config) {
    const map = readMap(PRESETS_KEY);
    map[name] = config;
    writeMap(PRESETS_KEY, map);
  }
  function deletePreset(name) {
    const map = readMap(PRESETS_KEY);
    delete map[name];
    writeMap(PRESETS_KEY, map);
  }

  // --- Saves: named runs -----------------------------------------------------
  // A save record: { name, savedAt, meta, data } where data is the
  // serializeWorld() string. meta is display-only (worldName / player / date).
  function listSaves() {
    const map = readMap(SAVES_KEY);
    return Object.values(map)
      .map(({ name, savedAt, meta }) => ({ name, savedAt, meta: meta ?? {} }))
      .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }
  function writeSave(name, world, meta = {}) {
    const map = readMap(SAVES_KEY);
    map[name] = { name, savedAt: new Date().toISOString(), meta, data: serializeWorld(world) };
    writeMap(SAVES_KEY, map);
  }
  function deleteSave(name) {
    const map = readMap(SAVES_KEY);
    delete map[name];
    writeMap(SAVES_KEY, map);
  }
  // loadSave — the { config, eventLog } a save reconstructs to, ready for
  // buildLiveGame({ save }). Null when the slot is missing or unparseable.
  function loadSave(name) {
    const record = readMap(SAVES_KEY)[name];
    if (!record?.data) return null;
    try {
      return parseSave(record.data);
    } catch {
      return null;
    }
  }

  return {
    isPersistent: () => backend.persistent === true,
    listPresets, getPreset, savePreset, deletePreset,
    listSaves, writeSave, deleteSave, loadSave,
  };
}
