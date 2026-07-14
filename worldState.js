// worldState.js — the ALFW kernel.
//
// WorldState is the single channel everything flows through: a merged
// store + event bus. Engines dispatch actions and subscribe to them; the
// append-only event log is the source of truth. No game logic lives here —
// this module stores, appends, and notifies. That's all.

import { readFileSync } from 'node:fs';

// mulberry32 — tiny public-domain seeded PRNG. Every piece of randomness in
// the world must come from here (via world.random()), never Math.random(),
// so a world is fully reproducible from its config + action sequence.
//
// Exported so systems that need position-deterministic (not call-order
// dependent) randomness — e.g. WorldMapEngine seeding a fresh generator per
// noise-lattice point from (seed, gridX, gridY) — can reuse THIS one RNG
// algorithm rather than introducing a parallel one. The shared world.random
// stream is a single stateful sequence and is unsuitable for that.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// assertNoUndefinedDeep — the dispatch-entry-point guard. JSON.stringify
// silently DROPS any object key whose value is `undefined` (array elements
// become `null` instead, which is a different but related hazard), so a
// payload carrying one serializes to something smaller than what was
// dispatched — no error, no crash, just permanently corrupted history from
// that point forward on reload (game/saveLoad.js's assertJsonSafe catches
// this too, but only at SAVE time; a bad dispatch must never get that far).
// Walks every present key/index; a key that is simply ABSENT is untouched —
// "omit the field entirely" (actions/playerActions.js's nodeId) stays the
// correct, unpenalized pattern. Only an explicit `=== undefined` on a
// present key is the bug this catches.
function assertNoUndefinedDeep(actionType, payload) {
  function walk(value, path) {
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const key of Object.keys(value)) {
        const v = value[key];
        if (v === undefined) {
          throw new Error(
            `dispatch: event "${actionType}" has an explicit undefined value at payload${path}.${key} — omit the key instead of passing undefined`
          );
        }
        walk(v, `${path}.${key}`);
      }
    }
  }
  walk(payload, '');
}

const REQUIRED_CONFIG_FIELDS = ['worldName', 'startDateTime', 'rngSeed'];

export function createWorldState(config, savedLog = []) {
  for (const field of REQUIRED_CONFIG_FIELDS) {
    if (config?.[field] === undefined) {
      throw new Error(`WorldConfig is missing required field "${field}"`);
    }
  }
  if (Number.isNaN(Date.parse(config.startDateTime))) {
    throw new Error(
      `WorldConfig startDateTime "${config.startDateTime}" is not a valid date`
    );
  }

  const frozenConfig = deepFreeze(structuredClone(config));

  // The append-only event log. Entries are deep-frozen on dispatch and the
  // live array is never handed out, so nothing in it can be mutated or
  // removed. The world clock doesn't advance yet (time-advancement actions
  // come later), so every entry carries the start time plus a monotonic seq —
  // both derived purely from config + dispatch order, keeping the entire log
  // deterministic.
  const eventLog = [];
  const worldTime = new Date(config.startDateTime).toISOString();

  // Optional pre-populated history (the load half of save/load). Entries are
  // installed verbatim — validated, cloned, re-frozen — with NO subscriber
  // notification: nothing has subscribed yet at construction time, and engines
  // built afterwards prime their caches from getEventLog() instead of being
  // replayed into. Because dispatch derives seq from eventLog.length, new
  // events simply continue the saved history.
  if (!Array.isArray(savedLog)) {
    throw new Error('createWorldState: savedLog must be an array of log entries');
  }
  savedLog.forEach((entry, i) => {
    if (entry?.seq !== i) {
      throw new Error(`createWorldState: savedLog entry ${i} has seq ${entry?.seq} — the log must be contiguous from 0`);
    }
    if (typeof entry.type !== 'string' || !('payload' in entry)) {
      throw new Error(`createWorldState: savedLog entry ${i} is missing a string type or a payload`);
    }
    eventLog.push(deepFreeze(structuredClone(entry)));
  });

  // actionType -> array of handlers, notified in subscription order.
  const subscribers = new Map();

  const random = mulberry32(config.rngSeed);

  // dispatchBatch — the transactional twin of dispatch: takes an array of
  // already-constructed events ({ type, payload }) and either commits ALL of
  // them or NONE. Every event is validated (currently: the undefined-payload
  // guard above) and its frozen entry built BEFORE any of them touch
  // eventLog, so a failure partway through a batch — an invalid event later
  // in the array — throws having appended nothing and notified nobody.
  // Composite actions that dispatch several events for one logical player
  // action (engines/questEngine.js's completeQuest, engines/combatEngine.js's
  // act/finishCombat) build their full event list first and submit it here in
  // one call, instead of dispatching as they go, so a failure mid-sequence
  // can never strand earlier dispatches as permanent, un-rollback-able
  // history. This requires no general rollback system: engines have no side
  // effects beyond producing events, so front-loading validation before any
  // commit is sufficient.
  function dispatchBatch(events) {
    if (!Array.isArray(events) || events.length === 0) {
      throw new Error('dispatchBatch: events must be a non-empty array');
    }
    const startSeq = eventLog.length;
    const entries = events.map((event, i) => {
      if (!event || typeof event.type !== 'string') {
        throw new Error(`dispatchBatch: event at index ${i} is missing a string "type"`);
      }
      assertNoUndefinedDeep(event.type, event.payload);
      return deepFreeze({
        seq: startSeq + i,
        worldTime,
        type: event.type,
        payload: structuredClone(event.payload),
      });
    });
    // Every entry validated and built — commit atomically, THEN notify.
    eventLog.push(...entries);
    for (const entry of entries) {
      for (const handler of subscribers.get(entry.type) ?? []) {
        handler(entry);
      }
    }
    return entries;
  }

  function dispatch(actionType, payload) {
    return dispatchBatch([{ type: actionType, payload }])[0];
  }

  function subscribe(actionType, handler) {
    if (!subscribers.has(actionType)) subscribers.set(actionType, []);
    const handlers = subscribers.get(actionType);
    handlers.push(handler);
    return function unsubscribe() {
      const index = handlers.indexOf(handler);
      if (index !== -1) handlers.splice(index, 1);
    };
  }

  function getState() {
    return structuredClone({ config: frozenConfig, eventLog });
  }

  function getEventLog() {
    return structuredClone(eventLog);
  }

  return { dispatch, dispatchBatch, subscribe, getState, getEventLog, random };
}

// Initialize a fresh world from a WorldConfig file alone.
export function initWorldState(configPath) {
  return createWorldState(JSON.parse(readFileSync(configPath, 'utf8')));
}
