// entities/voice.js — permanent, axis-derived voice directives.
//
// A voice directive set is a PERMANENT trait, generated ONCE at NPC creation
// (npcGeneratorEngine.deriveNpc) from the NPC's already-drawn personality axes,
// exactly the same permanence discipline as appearance. It is NEVER recomputed,
// never re-rolled, and — critically — is never touched by the per-turn emotion
// derivation (entities/deriveEmotion.js). Voice is who the NPC IS; emotion is
// how they FEEL this turn. The two share axes as an input but nothing else.
//
// The FUOC playtest lesson driving this shape: a soft descriptive voice field
// (accent / speechPattern / free-form tags) was consistently WEAKER at making
// NPCs sound individually distinct than the flag system was. So voice is a
// SMALL set of concrete, imperative directives rendered at flag-level prompt
// prominence (ai/buildDialoguePrompt.js), not a bag of adjectives. Fewer,
// sharper, obeyable rules beat more descriptive data.
//
// COHERENCE BY CONSTRUCTION — one orthogonal speech facet per axis. A naive
// "one independent threshold line per axis" scheme can seat contradictory
// directives side by side (a dominance line saying "be short and declarative"
// next to an extraversion line saying "be talkative and volunteer more" — a
// direct collision on sentence LENGTH). The fix is that each axis owns exactly
// ONE disjoint facet of speech, and its line stays strictly in that lane:
//
//   dominance        -> STANCE      (command vs. defer)
//   agreeableness    -> WARMTH      (warm vs. blunt)
//   extraversion     -> LENGTH      (talkative vs. terse)  [the SOLE length owner]
//   conscientiousness-> STRUCTURE   (orderly vs. — )       [about order, not length]
//   openness         -> DICTION     (vivid vs. plain)
//
// Because at most one directive fires per axis (high / low / neutral), any
// selected subset addresses different facets and therefore reads coherently:
// a terse-but-warm-but-decisive NPC is fine — length, warmth, and stance are
// independent dials. The ~3 cap below is then purely about brevity, NOT about
// dodging conflicts.

// Provisional first-pass wording and thresholds — the ACTION_DELTAS /
// TIER_THRESHOLDS style: retune here freely, no caller changes needed. Each
// axis maps to { high, low } imperative lines (either may be null when that
// extreme has no directive — e.g. conscientiousness only speaks up when high).
export const AXIS_DIRECTIVES = Object.freeze({
  // STANCE — how the NPC positions requests and assertions.
  dominance: {
    high: 'Frame things as decisions, not requests; do not hedge.',
    low: 'Defer to others; pose things as questions rather than demands.',
  },
  // WARMTH — the temperature of the delivery.
  agreeableness: {
    high: 'Stay warm; soften any disagreement before you voice it.',
    low: 'Be blunt; skip pleasantries and niceties.',
  },
  // LENGTH — the SOLE owner of how much the NPC says. No other axis touches
  // sentence length, so an extraversion directive can never collide with one.
  extraversion: {
    high: "Volunteer more than you're asked; keep the words coming.",
    low: 'Say little — a sentence or two, then stop.',
  },
  // STRUCTURE — orderliness, deliberately NOT length. "One clear point at a
  // time" is compatible with either a terse or a talkative delivery.
  conscientiousness: {
    high: 'Stay orderly; make one clear point at a time.',
    low: null,
  },
  // DICTION — word choice, independent of length, warmth, stance, structure.
  openness: {
    high: 'Reach for vivid, unexpected turns of phrase.',
    low: 'Stick to plain, concrete words.',
  },
});

// Priority order for the brevity cap: when more than MAX_DIRECTIVES axes fire,
// keep the highest-priority ones. Stance and warmth are the most
// character-defining, so they win ties; diction is the most cosmetic, so it
// yields first.
const AXIS_PRIORITY = Object.freeze([
  'dominance',
  'agreeableness',
  'extraversion',
  'conscientiousness',
  'openness',
]);

const HIGH_THRESHOLD = 7; // axis >= 7 fires the `high` line
const LOW_THRESHOLD = 3; // axis <= 3 fires the `low` line
export const MAX_DIRECTIVES = 3; // "fewer, sharper" — hard cap on the rendered set
const NEUTRAL_DIRECTIVE = 'Speak plainly and in character.';

// CONFLICTING_PAIRS — belt-and-braces. EXPECTED EMPTY under the orthogonal
// design above (each axis owns a disjoint facet, so no two selected lines can
// contradict). It exists so that if a future table edit ever reintroduces
// cross-facet overlap, the guard in deriveVoiceDirectives drops the
// lower-priority member instead of silently emitting a mixed signal — and
// proof.js asserts across the whole axis space that this set stays empty.
// Entries are unordered [lineA, lineB] pairs that must never co-occur.
export const CONFLICTING_PAIRS = Object.freeze([]);

function conflicts(a, b) {
  return CONFLICTING_PAIRS.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x)
  );
}

/**
 * Derive an NPC's permanent voice directives from its personality axes.
 * PURE and rng-free: the axes were already drawn, so this consumes no random
 * stream and is a deterministic function of `axes` alone (same axes in => same
 * directives out, forever). Generated once at NPC creation and stored on the
 * entity like appearance; never recomputed.
 *
 * @param {Record<string, number>} axes - the NPC's psychology.personalityAxes
 *   (0-10 integers). Missing axes are treated as the neutral middle (no line).
 * @returns {string[]} 1..MAX_DIRECTIVES imperative directives, coherent by
 *   construction, in AXIS_PRIORITY order.
 */
export function deriveVoiceDirectives(axes = {}) {
  const selected = [];
  for (const axis of AXIS_PRIORITY) {
    const value = axes[axis];
    if (typeof value !== 'number') continue;
    const lines = AXIS_DIRECTIVES[axis];
    let line = null;
    if (value >= HIGH_THRESHOLD) line = lines.high;
    else if (value <= LOW_THRESHOLD) line = lines.low;
    if (!line) continue;
    // Conflict-guard: with CONFLICTING_PAIRS empty this never trips, but a
    // future table edit that reintroduces overlap is caught here — the
    // already-selected (higher-priority) line wins, the newcomer is dropped.
    if (selected.some((existing) => conflicts(existing, line))) continue;
    selected.push(line);
    if (selected.length >= MAX_DIRECTIVES) break;
  }
  // Every NPC gets at least one directive so the prompt's Voice section is
  // never empty (a fully-neutral axis profile lands here).
  return selected.length > 0 ? selected : [NEUTRAL_DIRECTIVE];
}
