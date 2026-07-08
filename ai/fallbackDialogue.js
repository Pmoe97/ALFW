// ai/fallbackDialogue.js — deterministic non-AI fallback (Principle VIII,
// Graceful Degradation).
//
// Every AI dialogue path must have a working non-AI fallback; this is it.
// Synchronous, never throws, zero network. Line selection uses a small pure
// hash of entity.id — NEVER world.random(): this function takes no world at
// all and must never perturb kernel RNG determinism. Same entity + same
// tier → same line, always.

import { relationshipTier } from '../entities/relationshipStore.js';

// Hand-written canned lines per relationship tier. `address` is what the NPC
// calls the player (the edge's fromCallsTo) or a neutral stand-in.
const LINES_BY_TIER = {
  hostile: [
    { line: (address) => `Say your piece and get out, ${address}.`, toneTags: ['cold', 'curt'] },
    { line: (address) => `I've got nothing for you, ${address}.`, toneTags: ['hostile', 'dismissive'] },
  ],
  stranger: [
    { line: (address) => `Don't believe we've met, ${address}. What do you need?`, toneTags: ['neutral', 'guarded'] },
    { line: (address) => `Something I can do for you, ${address}?`, toneTags: ['neutral', 'polite'] },
  ],
  acquaintance: [
    { line: (address) => `Back again, ${address}? What'll it be?`, toneTags: ['familiar', 'easy'] },
    { line: (address) => `Good to see you about, ${address}.`, toneTags: ['warm', 'casual'] },
  ],
  friend: [
    { line: (address) => `There you are, ${address}! Come sit down.`, toneTags: ['warm', 'welcoming'] },
    { line: (address) => `Always glad when you come by, ${address}.`, toneTags: ['warm', 'fond'] },
  ],
  trusted: [
    { line: (address) => `Come in, ${address} — you never have to ask.`, toneTags: ['intimate', 'warm'] },
    { line: (address) => `Whatever you need, ${address}, it's yours.`, toneTags: ['devoted', 'warm'] },
  ],
};

// Returned whenever the inputs are too malformed to pick a tiered line.
// This layer must never crash the game.
const GENERIC_RESPONSE = Object.freeze({
  dialogue: 'Well met.',
  internalMonologue: '',
  toneTags: Object.freeze(['neutral']),
});

// djb2 — tiny pure string hash for deterministic line selection.
function hashString(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * @param {Object} entity - the speaking NPC (only id is used for selection)
 * @param {Object} relationship - the NPC→player edge (stats pick the tier,
 *   fromCallsTo supplies the address)
 * @returns {{dialogue: string, internalMonologue: string, toneTags: string[]}}
 *   always a valid DialogueResponse
 */
export function fallbackDialogue(entity, relationship) {
  try {
    const options = LINES_BY_TIER[relationshipTier(relationship.stats)];
    const address =
      typeof relationship.fromCallsTo === 'string' && relationship.fromCallsTo.trim() !== ''
        ? relationship.fromCallsTo
        : 'stranger';
    const pick = options[hashString(String(entity.id)) % options.length];
    return {
      dialogue: pick.line(address),
      internalMonologue: '',
      toneTags: [...pick.toneTags],
    };
  } catch {
    // Malformed entity/relationship — degrade to the generic line rather
    // than ever throwing into the game loop.
    return { ...GENERIC_RESPONSE, toneTags: [...GENERIC_RESPONSE.toneTags] };
  }
}
