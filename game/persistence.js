// game/persistence.js — the ONLY persistent store in the game: named world
// presets (config templates, distinct from saves) and named save slots. Both
// live in IndexedDB; the existing serializeWorld/parseSave (game/saveLoad.js)
// already reduce a whole world to { config, eventLog }, so a save slot is
// just that string plus a little display metadata.
//
// Backed by IndexedDB instead of localStorage so a save's event log isn't
// bounded by localStorage's size ceiling (the actual prerequisite for a real
// ModManager — mod lists, save data, and export/import all need storage
// beyond that ceiling). Perchance runs under a strict CSP and IndexedDB can
// be unavailable, blocked, or throw on open; pickBackend()+the probe in
// createPersistence() fall back to an in-memory Map so the flow never
// crashes off a real page (saves simply don't survive a reload then).
//
// Every public function here is now ASYNC (returns a Promise) — callers must
// await. All exported names and return shapes are unchanged from the
// synchronous localStorage version; only the storage layer changed.
//
// Presets are a template LIBRARY that outlives any single playthrough; saves
// are individual runs. They are stored under separate key prefixes and never
// commingled.
//
// Storage layout: ONE RECORD PER NAME, not one big JSON blob holding every
// preset/save. The old localStorage design read-modify-wrote a single
// monolithic blob on every mutation, which is exactly the scaling problem
// this migration exists to fix (a write to one save had to deserialize and
// re-serialize every OTHER save's full event log too). listSaves() also
// only reads small "save-meta" records (name/savedAt/meta), never the heavy
// event-log data blob — loadSave(name) is the only thing that touches a
// save's full data.
//
// A player who used the old localStorage version of this file has real data
// sitting under the legacy alfw:presets:v1 / alfw:saves:v1 keys — see
// migrateLegacyLocalStorage() below, which one-time imports it into the new
// layout the first time a real (persistent) backend resolves.

import { serializeWorld, parseSave } from './saveLoad.js';

const DB_NAME = 'alfw-persistence';
const DB_VERSION = 1;
const STORE = 'kv';

const PRESET_PREFIX = 'preset:';
const SAVE_META_PREFIX = 'save-meta:';
const SAVE_DATA_PREFIX = 'save-data:';
const PROBE_KEY = '__alfw_probe__';

// Keys the PRE-IndexedDB version of this file used: one monolithic JSON blob
// per collection (a map of name -> record), read-modify-written whole on
// every mutation. Kept here only so migrateLegacyLocalStorage (below) can
// find and import them; nothing else in this file reads or writes these.
const LEGACY_PRESETS_KEY = 'alfw:presets:v1';
const LEGACY_SAVES_KEY = 'alfw:saves:v1';

// memoryBackend — an in-memory Map behind the same {getItem, setItem,
// removeItem, listKeys} shape as indexedDbBackend, so createPersistence never
// has to know which one it's talking to. Exported so proof.js (no real
// IndexedDB in Node) can construct isolated, deterministic instances via
// createPersistence(memoryBackend()).
export function memoryBackend() {
  const m = new Map();
  return {
    async getItem(key) {
      return m.has(key) ? m.get(key) : null;
    },
    async setItem(key, value) {
      m.set(key, value);
    },
    async removeItem(key) {
      m.delete(key);
    },
    async listKeys(prefix) {
      return [...m.keys()].filter((k) => k.startsWith(prefix));
    },
    persistent: false,
  };
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

// indexedDbBackend — the real browser backend: one database, one object
// store, keyed by our own prefixed string keys (so listKeys can filter by
// prefix without a secondary index). The db-open call is made lazily (on
// first use, not at backend-construction time) and cached, so constructing
// this backend is cheap and side-effect-free.
export function indexedDbBackend() {
  let dbPromise = null;
  function getDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function getItem(key) {
    const db = await getDb();
    const tx = db.transaction(STORE, 'readonly');
    const value = await reqToPromise(tx.objectStore(STORE).get(key));
    return value === undefined ? null : value;
  }
  async function setItem(key, value) {
    const db = await getDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    await txDone(tx);
  }
  async function removeItem(key) {
    const db = await getDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    await txDone(tx);
  }
  async function listKeys(prefix) {
    const db = await getDb();
    const tx = db.transaction(STORE, 'readonly');
    const allKeys = await reqToPromise(tx.objectStore(STORE).getAllKeys());
    return allKeys.filter((k) => typeof k === 'string' && k.startsWith(prefix));
  }
  return { getItem, setItem, removeItem, listKeys, persistent: true };
}

// pickBackend — real IndexedDB when the global exists, else the in-memory
// shim. This is only a presence check; createPersistence's own probe (below)
// catches a backend that exists but throws/rejects on actual use (Safari
// private-mode-style failures, matching this file's long-standing CSP
// concern).
function pickBackend() {
  if (typeof indexedDB === 'undefined') return memoryBackend();
  return indexedDbBackend();
}

// migrateLegacyLocalStorage — one-time import of data left behind by the
// pre-IndexedDB version of this file. Only runs against a real, durable
// backend (persistent === true) — importing into memoryBackend() would be
// pointless (nothing survives a reload there) and would strand the legacy
// data for no reason; leaving it alone in that case means a later
// successful IndexedDB attempt can still pick it up.
//
// No separate "migration done" marker is needed: clearing each legacy key
// on success IS the marker (a cleared key reads back null, so the next boot
// finds nothing to import and does zero work). The two blobs are migrated
// independently so a corrupt/failing one never blocks the other, and each
// entry is only written if nothing already exists under its new key — a
// save/preset made after this migration always wins over an older legacy
// duplicate of the same name. If a blob's import throws partway through
// (e.g. an IndexedDB write failure), its legacy key is left in place rather
// than cleared, so the next boot retries — already-imported entries within
// it are skipped again via the same never-clobber check, so nothing is
// double-written or lost.
async function migrateLegacyLocalStorage(b) {
  if (b.persistent !== true) return;
  const ls = globalThis.localStorage;
  if (typeof ls === 'undefined') return;

  const rawPresets = ls.getItem(LEGACY_PRESETS_KEY);
  if (rawPresets) {
    try {
      const map = JSON.parse(rawPresets);
      for (const [name, config] of Object.entries(map)) {
        const key = PRESET_PREFIX + name;
        if ((await b.getItem(key)) == null) await b.setItem(key, JSON.stringify(config));
      }
      ls.removeItem(LEGACY_PRESETS_KEY);
    } catch {
      // corrupt blob or a write failed partway — leave it for the next boot to retry
    }
  }

  const rawSaves = ls.getItem(LEGACY_SAVES_KEY);
  if (rawSaves) {
    try {
      const map = JSON.parse(rawSaves);
      for (const [name, record] of Object.entries(map)) {
        if (!record?.data) continue;
        const metaKey = SAVE_META_PREFIX + name;
        if ((await b.getItem(metaKey)) == null) {
          await b.setItem(metaKey, JSON.stringify({ name, savedAt: record.savedAt, meta: record.meta ?? {} }));
          await b.setItem(SAVE_DATA_PREFIX + name, record.data);
        }
      }
      ls.removeItem(LEGACY_SAVES_KEY);
    } catch {
      // corrupt blob or a write failed partway — leave it for the next boot to retry
    }
  }
}

export function createPersistence(backendOrFactory = pickBackend) {
  let backend = null;
  let resolving = null;
  // Lazy + memoized: resolves once, on first actual use, and probes the
  // candidate with a real write+delete before trusting it (mirrors the old
  // localStorage write-probe) — if that throws or rejects, fall back to
  // memoryBackend and remember that choice instead of retrying every call.
  function getBackend() {
    if (backend) return Promise.resolve(backend);
    if (!resolving) {
      resolving = (async () => {
        const candidate = typeof backendOrFactory === 'function' ? backendOrFactory() : backendOrFactory;
        try {
          await candidate.setItem(PROBE_KEY, '1');
          await candidate.removeItem(PROBE_KEY);
          backend = candidate;
        } catch {
          backend = memoryBackend();
        }
        await migrateLegacyLocalStorage(backend);
        return backend;
      })();
    }
    return resolving;
  }

  // Serialize every mutation on this instance. Going async introduces a race
  // that never existed under synchronous localStorage: two overlapping
  // read-modify-write calls to the same record could interleave (both read
  // the old value, second write clobbers the first). A single promise chain
  // per persistence instance means mutations always run one at a time, in
  // call order, regardless of how they overlap from the caller's side.
  let queue = Promise.resolve();
  function enqueue(fn) {
    const result = queue.then(fn, fn);
    queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function readJson(key) {
    const b = await getBackend();
    const raw = await b.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null; // corrupt record — treat as absent rather than crash the menu
    }
  }

  // --- Presets: named config templates --------------------------------------
  async function listPresets() {
    const b = await getBackend();
    const keys = await b.listKeys(PRESET_PREFIX);
    return keys
      .map((k) => ({ name: k.slice(PRESET_PREFIX.length) }))
      .sort((a, c) => a.name.localeCompare(c.name));
  }
  async function getPreset(name) {
    return readJson(PRESET_PREFIX + name);
  }
  function savePreset(name, config) {
    return enqueue(async () => {
      const b = await getBackend();
      await b.setItem(PRESET_PREFIX + name, JSON.stringify(config));
    });
  }
  function deletePreset(name) {
    return enqueue(async () => {
      const b = await getBackend();
      await b.removeItem(PRESET_PREFIX + name);
    });
  }

  // --- Saves: named runs -----------------------------------------------------
  // A save is two records: save-meta (name/savedAt/meta, small — what
  // listSaves reads) and save-data (the serializeWorld() string, only read
  // by loadSave). meta is display-only (worldName / player / date).
  async function listSaves() {
    const b = await getBackend();
    const keys = await b.listKeys(SAVE_META_PREFIX);
    const metas = await Promise.all(keys.map((k) => readJson(k)));
    return metas
      .filter(Boolean)
      .map(({ name, savedAt, meta }) => ({ name, savedAt, meta: meta ?? {} }))
      .sort((a, c) => String(c.savedAt).localeCompare(String(a.savedAt)));
  }
  function writeSave(name, world, meta = {}) {
    return enqueue(async () => {
      const b = await getBackend();
      const savedAt = new Date().toISOString();
      await b.setItem(SAVE_META_PREFIX + name, JSON.stringify({ name, savedAt, meta }));
      await b.setItem(SAVE_DATA_PREFIX + name, serializeWorld(world));
    });
  }
  function deleteSave(name) {
    return enqueue(async () => {
      const b = await getBackend();
      await b.removeItem(SAVE_META_PREFIX + name);
      await b.removeItem(SAVE_DATA_PREFIX + name);
    });
  }
  // loadSave — the { config, eventLog } a save reconstructs to, ready for
  // buildLiveGame({ save }). Null when the slot is missing or unparseable.
  async function loadSave(name) {
    const b = await getBackend();
    const raw = await b.getItem(SAVE_DATA_PREFIX + name);
    if (!raw) return null;
    try {
      return parseSave(raw);
    } catch {
      return null;
    }
  }

  return {
    isPersistent: async () => (await getBackend()).persistent === true,
    listPresets, getPreset, savePreset, deletePreset,
    listSaves, writeSave, deleteSave, loadSave,
  };
}

// --- Manual browser smoke-test checklist ------------------------------------
// proof.js runs under plain Node, which has no real IndexedDB, so it only
// exercises memoryBackend(). Verify the real indexedDbBackend() path by hand
// in an actual browser after `npm run build`:
//
//  1. Open the built app; start a run; Save via the debug menu ("Session"
//     section). Open devtools → Application → IndexedDB → alfw-persistence →
//     kv, and confirm a `save-meta:<name>` and a `save-data:<name>` record
//     both appear.
//  2. Reload the page; open "Continue" from the main menu; confirm the save
//     is listed (proves listSaves reads save-meta without needing save-data)
//     and Load reconstructs the same run.
//  3. Save two differently-named runs, then Delete one from the Continue
//     screen; confirm only that one's save-meta/save-data pair disappears
//     from IndexedDB and the other survives.
//  4. In a private/incognito window (or with IndexedDB disabled via devtools
//     if the browser allows it), confirm the app falls back to the in-memory
//     backend instead of crashing: saves work for the session but the
//     Continue screen shows the "Storage unavailable" note, and nothing
//     appears in Application → IndexedDB.
//  5. Legacy migration: in devtools → Application → Local Storage, hand-seed
//     alfw:saves:v1 with a small JSON blob (e.g.
//     {"Old Run":{"name":"Old Run","savedAt":"2024-01-01T00:00:00Z","meta":{},"data":"<a real serializeWorld() string>"}})
//     and reload. Confirm the save appears on the Continue screen, that
//     alfw:saves:v1 is gone from Local Storage afterward, and that
//     Application → IndexedDB → alfw-persistence → kv now has the
//     corresponding save-meta:/save-data: records.
