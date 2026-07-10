// ai/fallbackTravelNarration.js — deterministic non-AI travel narration
// (Principle VIII, Graceful Degradation) — the "safe travels" fallback.
//
// Every AI narration path must have a working non-AI fallback; this is it for
// travel incidents. Synchronous, never throws, zero network. Line selection
// uses the shared djb2 hash of (fromNodeId, toNodeId, legIndex) — NEVER
// world.random(): this function takes no world at all and must never perturb
// kernel RNG determinism. Same leg → same line, always.
//
// The line only ever COLORS facts the seeded roll already committed — the
// three outcome families read differently on purpose:
//   'none'             — a genuinely quiet leg ("safe travels").
//   'auto'             — flavor: something happened, harmlessly, per category.
//   'auto-passthrough' — a requires-a-real-turn incident resolved as a narrated
//                        pass-through (fought off / talked past): clearly a
//                        real event with stakes, clearly NOT "nothing happened".

import { hashString } from './fallbackDialogue.js';

const QUIET_LINES = [
  'The road is quiet, and you make good time.',
  'Nothing troubles you on the way; the miles pass easily.',
  'Safe travels — the path is clear from one end to the other.',
];

// Per-category flavor for auto-resolved incidents (harmless by definition).
const AUTO_LINES = {
  animal: [
    'A wild animal watches you from the treeline, then loses interest.',
    'Something rustles off the path — an animal, already gone by the time you look.',
  ],
  bandit: [
    'You spot an abandoned bandit camp off the road and give it a wide berth.',
    'Rough-looking figures eye you from a distance but let you pass.',
  ],
  npc: [
    'You pass a traveler headed the other way and trade nods.',
    'A peddler on the road shares a rumor and a stretch of the walk.',
  ],
  environmental: [
    'The weather turns briefly foul, and you push through it.',
    'A washed-out stretch of path slows you, but you pick your way across.',
  ],
  mundane: [
    'You find a dropped coin purse on the road — a small, welcome surprise.',
    'You stop at a wayside marker, get your bearings, and press on.',
  ],
};

// Per-category pass-through narration for 'turn'-mode incidents, split by the
// rolled flavor: the encounter was real and dangerous, and you came through.
const PASSTHROUGH_LINES = {
  fought: {
    animal: [
      'A beast comes at you on the road — you drive it off, scraped but standing.',
      'Something big and hungry blocks the path; you fight it back and hurry on, breathing hard.',
    ],
    bandit: [
      'Bandits spring an ambush — you fight them off, roughed up but fine.',
      'Blades out on the road: you give better than you get, and the bandits scatter.',
    ],
    npc: [
      'A stranger turns hostile mid-word — you put them down hard enough that they think better of it.',
      'An argument on the road comes to blows; you end it and walk away bruised.',
    ],
    environmental: [
      'The land itself turns against you — you claw through, battered but moving.',
      'A sudden hazard nearly takes you; you muscle past it and keep going.',
    ],
    mundane: [
      'What looked routine turns ugly for a moment — you handle it and move on.',
      'A small trouble on the road gets physical; you settle it quickly.',
    ],
  },
  talked: {
    animal: [
      'A predator stalks you down the road — you back away slow and steady until it loses the thread.',
      'You stand very still, speak low, and the beast decides you are not worth it.',
    ],
    bandit: [
      'Bandits bar the way — you talk your way past, lighter of nerve but not of coin.',
      'An ambush closes around you; a few careful words and they wave you through.',
    ],
    npc: [
      'A dangerous stranger squares up — you talk them down and part without blood.',
      'Hard words on the road nearly turn worse; you smooth it over and move on.',
    ],
    environmental: [
      'The path turns treacherous — patience and care see you through where hurry would not.',
      'You read the hazard, wait out its worst, and slip past unhurt.',
    ],
    mundane: [
      'A tense misunderstanding on the road unwinds after a few careful words.',
      'A small confrontation fizzles once you explain yourself; you press on.',
    ],
  },
};

// Returned whenever the inputs are too malformed to pick a keyed line. This
// layer must never crash the game.
const GENERIC_LINE = 'The road carries you through without lasting trouble.';

/**
 * @param {Object} incident - the committed incident facts:
 *   { fromNodeId, toNodeId, legIndex, category, outcome, passthroughFlavor? }
 * @returns {string} always a usable narration line
 */
export function fallbackTravelNarration(incident) {
  try {
    let options;
    if (incident.category === 'none') {
      options = QUIET_LINES;
    } else if (incident.outcome === 'auto-passthrough') {
      options = PASSTHROUGH_LINES[incident.passthroughFlavor][incident.category];
    } else {
      options = AUTO_LINES[incident.category];
    }
    const key = `${incident.fromNodeId}->${incident.toNodeId}:${incident.legIndex}`;
    return options[hashString(key) % options.length];
  } catch {
    // Malformed incident — degrade to the generic line rather than ever
    // throwing into the game loop.
    return GENERIC_LINE;
  }
}
