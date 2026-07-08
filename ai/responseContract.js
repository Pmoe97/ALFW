// ai/responseContract.js — the typed AI response contract + strict validator.
//
// The contract deliberately contains NO state-writing fields: no numeric
// deltas, no `*Delta`/`*Change`/`*Adjustment` keys, nothing a caller could
// feed into relationshipStore.set*() or world.dispatch() without a human or
// a separate deterministic engine deciding to apply it. The AI describes
// speech and tone; it never writes game state. This validator is the
// enforcement point for that rule — on any violation the WHOLE response is
// rejected, never coerced or partially trusted.

/**
 * @typedef {Object} DialogueResponse
 * @property {string} dialogue - what the character says aloud
 * @property {string} internalMonologue - the character's private, unspoken thought
 * @property {string[]} toneTags - short tone descriptors for the delivery
 */

const ALLOWED_KEYS = new Set(['dialogue', 'internalMonologue', 'toneTags']);
const STATE_WRITE_KEY_PATTERN = /delta|change|adjust/i;

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Recursive scan for state-write-shaped content anywhere in the response:
// numeric values and delta/change/adjust-named keys. Runs BEFORE the generic
// whitelist check so these get their specific reason, not "unknown key".
function findStateWriteShape(value, path) {
  if (typeof value === 'number') {
    return `numeric field at "${path}" — numbers in an AI response are state-write-shaped and forbidden by the contract`;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findStateWriteShape(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (STATE_WRITE_KEY_PATTERN.test(key)) {
        return `key "${path ? path + '.' : ''}${key}" is a state-write-shaped field (matches /delta|change|adjust/i) and is forbidden by the contract`;
      }
      const found = findStateWriteShape(value[key], path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Strictly validate a parsed AI response against the DialogueResponse
 * contract. Checked in order; any violation rejects the whole response.
 *
 * @param {*} raw - the JSON.parse()d candidate
 * @returns {{ ok: true, value: DialogueResponse } | { ok: false, reason: string }}
 */
export function validateDialogueResponse(raw) {
  // 1. Must be a plain non-null object.
  if (!isPlainObject(raw)) {
    return { ok: false, reason: 'response is not a plain non-null object' };
  }

  // 2. Belt-and-braces state-write scan first, so a `trustDelta: 5` is named
  //    for what it is rather than falling through to a generic unknown-key
  //    rejection below.
  const stateWrite = findStateWriteShape(raw, '');
  if (stateWrite) {
    return { ok: false, reason: stateWrite };
  }

  // 3. Key whitelist: anything outside the contract rejects the response.
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, reason: `unknown key "${key}" is outside the DialogueResponse contract` };
    }
  }

  // 4. dialogue: required, string, non-empty after trim.
  if (typeof raw.dialogue !== 'string') {
    return { ok: false, reason: '"dialogue" is required and must be a string' };
  }
  if (raw.dialogue.trim() === '') {
    return { ok: false, reason: '"dialogue" must be non-empty after trimming' };
  }

  // 5. internalMonologue: optional, but a string if present.
  if (raw.internalMonologue !== undefined && typeof raw.internalMonologue !== 'string') {
    return { ok: false, reason: '"internalMonologue" must be a string when present' };
  }

  // 6. toneTags: optional, but an array of strings if present.
  if (raw.toneTags !== undefined) {
    if (!Array.isArray(raw.toneTags)) {
      return { ok: false, reason: '"toneTags" must be an array when present' };
    }
    for (const tag of raw.toneTags) {
      if (typeof tag !== 'string') {
        return { ok: false, reason: '"toneTags" must contain only strings' };
      }
    }
  }

  // Missing optionals normalize to '' / [].
  return {
    ok: true,
    value: {
      dialogue: raw.dialogue,
      internalMonologue: raw.internalMonologue ?? '',
      toneTags: raw.toneTags ?? [],
    },
  };
}
