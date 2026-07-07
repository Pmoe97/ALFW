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
function mulberry32(seed) {
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

const REQUIRED_CONFIG_FIELDS = ['worldName', 'startDateTime', 'rngSeed'];

export function createWorldState(config) {
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

  // actionType -> array of handlers, notified in subscription order.
  const subscribers = new Map();

  const random = mulberry32(config.rngSeed);

  function dispatch(actionType, payload) {
    const entry = deepFreeze({
      seq: eventLog.length,
      worldTime,
      type: actionType,
      payload: structuredClone(payload),
    });
    eventLog.push(entry);
    for (const handler of subscribers.get(actionType) ?? []) {
      handler(entry);
    }
    return entry;
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

  return { dispatch, subscribe, getState, getEventLog, random };
}

// Initialize a fresh world from a WorldConfig file alone.
export function initWorldState(configPath) {
  return createWorldState(JSON.parse(readFileSync(configPath, 'utf8')));
}
