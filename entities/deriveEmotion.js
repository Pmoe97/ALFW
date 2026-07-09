// entities/deriveEmotion.js — the transient, per-turn emotional read.
//
// Emotion is DERIVED, never stored — the same discipline this codebase already
// applies to relationship tiers (relationshipStore.relationshipTier), game-time
// (worldClockEngine), and faction control: compute fresh from history every
// time, never cache as ground truth. A persistent "current emotion" field would
// contradict the emergent model, so there isn't one. deriveEmotion runs every
// turn as a pure function of (the NPC's recent memories + its personality axes)
// and produces a read for THAT turn only.
//
// This is the deliberate opposite of voice (entities/voice.js): voice is a
// permanent trait fixed at creation; emotion is recomputed constantly and
// stored nowhere. They both READ the axes, but emotion never writes back into
// voice and voice is never re-triggered by emotion.
//
// Reproducibility WITHOUT storage: because the read is a pure function of the
// event log (which supplies each memory's valence via its seq) plus the axes,
// the same history always yields the same read — determinism without a cached
// field. That equality is the load-bearing proof in proof.js.

// Valence per remembered event type. Signed magnitudes, provisional first-pass
// balance (the ACTION_DELTAS / TIER_THRESHOLDS style — retune here freely).
// Valence is a fact about the EVENT, looked up from the log by the memory's
// seq; it is deliberately NOT stored on the MemoryRef, which stays {seq,
// summary} — storing it would duplicate what seq -> log already gives.
const MEMORY_VALENCE = Object.freeze({
  PLAYER_HELPED: 2,
  PLAYER_ROBBED: -4,
  PLAYER_IGNORED: -1,
});

// Only the most recent memories color the current mood; older ones fade fast.
// The k-th most recent memory (k = 1 is the latest) contributes with weight
// 1/k^2, so the freshest interaction dominates the read with older ones as a
// quickly-fading tail — a current mood is mostly about the latest thing.
// Deterministic, no clock.
const RECENCY_WINDOW = 5;

// |netValence| band cutoffs for the human-readable intensity label.
const INTENSITY_BANDS = Object.freeze([
  { max: 1.0, band: 'mild' },
  { max: 2.5, band: 'moderate' },
  { max: Infinity, band: 'strong' },
]);

// Centered axis value in [-1, 1]: 5 is neutral, 10 -> +1, 0 -> -1. A missing
// axis reads as neutral (0). This is the single knob every propensity below is
// written in terms of, so the whole emotion model speaks one unit.
function centered(axes, axis) {
  const v = axes?.[axis];
  return typeof v === 'number' ? (v - 5) / 5 : 0;
}

// The emotion vocabulary. Each entry declares the memory-valence SIGN it
// answers to (negative feelings only surface on net-negative history, etc.) and
// a propensity(cx) multiplier built from the centered axes — how strongly THIS
// NPC's personality reaches for this particular emotion. propensity is clamped
// to >= 0 by the scorer, so a strongly-disinclined axis simply zeroes an
// emotion out rather than flipping its sign.
//
// The axis skews below are the ALFW-5 reconciliation of FUOC's fuller model:
//   dominance      high -> anger/indignation on a slight; low -> fear/hurt
//   agreeableness  high -> warmth; low -> amplified hostility/resentment
//   extraversion   -> scales how loudly ANY feeling is expressed (applied
//                     globally in scoreEmotions, not per-entry)
//   conscientiousness high -> betrayal reads as moral indignation / grudge
//   openness       high -> curiosity/delight on the positive side (light touch)
const EMOTIONS = Object.freeze([
  // --- negative family (net valence < 0) ---
  { name: 'indignant', sign: -1, propensity: (cx) => 1 + 0.8 * cx.dominance + 0.6 * cx.conscientiousness },
  { name: 'angry', sign: -1, propensity: (cx) => 1 + 0.8 * cx.dominance - 0.7 * cx.agreeableness },
  { name: 'resentful', sign: -1, propensity: (cx) => 1 - 0.7 * cx.agreeableness + 0.4 * cx.conscientiousness },
  { name: 'hurt', sign: -1, propensity: (cx) => 1 - 0.8 * cx.dominance + 0.6 * cx.agreeableness },
  { name: 'wary', sign: -1, propensity: (cx) => 1 - 0.6 * cx.dominance - 0.4 * cx.openness },
  // --- positive family (net valence > 0) ---
  { name: 'fond', sign: 1, propensity: (cx) => 1 + 0.8 * cx.agreeableness },
  { name: 'grateful', sign: 1, propensity: (cx) => 1 + 0.5 * cx.agreeableness - 0.5 * cx.dominance },
  { name: 'delighted', sign: 1, propensity: (cx) => 1 + 0.6 * cx.openness + 0.4 * cx.extraversion },
  { name: 'pleased', sign: 1, propensity: () => 1 },
  // --- neutral family (net valence ~ 0): the baseline read when little or
  //     nothing recent weighs on the NPC. Scored off a small constant so it
  //     only surfaces when the valenced families score near zero. ---
  { name: 'content', sign: 0, propensity: (cx) => 1 + 0.5 * cx.agreeableness + 0.4 * cx.extraversion },
  { name: 'reserved', sign: 0, propensity: (cx) => 1 - 0.7 * cx.extraversion },
  { name: 'calm', sign: 0, propensity: () => 1 },
]);

// Baseline score the neutral family is measured against, so a no-memory NPC
// still gets a personality-shaped read instead of nothing.
const NEUTRAL_BASE = 0.6;

function bandFor(magnitude) {
  return INTENSITY_BANDS.find((b) => magnitude <= b.max).band;
}

// deriveNetValence — the recency-weighted sum of remembered-event valences.
// PURE over (recentMemories, log). Memories whose seq/type isn't a known
// valenced event are a defensive skip (never a throw), matching the
// relationshipStore stance on stray payloads.
function deriveNetValence(recentMemories, log) {
  // Most-recent-first, capped to the window. recentMemories is in append order
  // (oldest -> newest), so walk it backwards.
  let net = 0;
  let k = 1;
  for (let i = recentMemories.length - 1; i >= 0 && k <= RECENCY_WINDOW; i--) {
    const mem = recentMemories[i];
    const entry = log[mem?.seq];
    const valence = entry ? MEMORY_VALENCE[entry.type] : undefined;
    if (typeof valence !== 'number') continue; // not a valenced memory — skip, don't advance decay
    net += valence * (1 / (k * k));
    k += 1;
  }
  return net;
}

/**
 * The per-turn emotional read. PURE: same (entity axes + recentMemories + log)
 * always yields the same result, and nothing is written back anywhere.
 *
 * @param {Object} entity - the speaking NPC (only psychology.personalityAxes is read)
 * @param {Array<{seq: number, summary: string}>} recentMemories - the same
 *   MemoryRefs the caller feeds buildDialoguePrompt; their event type/valence
 *   is looked up from the log by seq
 * @param {Array} [log] - the world event log (log[seq] === the entry). Defaults
 *   to [] -> no valenced memories -> a pure axis-shaped baseline read.
 * @returns {{reads: Array<{emotion: string, intensity: number, band: string}>,
 *   netValence: number}} `reads` holds the top 1-2 emotions, strongest first.
 */
export function deriveEmotion(entity, recentMemories = [], log = []) {
  const axes = entity?.psychology?.personalityAxes ?? {};
  const cx = {
    dominance: centered(axes, 'dominance'),
    agreeableness: centered(axes, 'agreeableness'),
    extraversion: centered(axes, 'extraversion'),
    conscientiousness: centered(axes, 'conscientiousness'),
    openness: centered(axes, 'openness'),
  };

  const netValence = deriveNetValence(recentMemories, log);
  const magnitude = Math.abs(netValence);
  const valenceSign = netValence > 0 ? 1 : netValence < 0 ? -1 : 0;

  // Extraversion scales how loudly any feeling is expressed: +/-30% around
  // neutral. Applied uniformly so it changes intensity, never which emotion.
  const expressiveness = 1 + 0.3 * cx.extraversion;

  const scored = [];
  for (const emo of EMOTIONS) {
    let base;
    if (emo.sign === 0) {
      // Neutral reads fade OUT as valenced history builds up, so they only win
      // when nothing much is going on.
      base = Math.max(0, NEUTRAL_BASE - magnitude);
    } else if (emo.sign === valenceSign) {
      base = magnitude;
    } else {
      continue; // wrong-signed feeling for the current history — not a candidate
    }
    const propensity = Math.max(0, emo.propensity(cx));
    const score = base * propensity * expressiveness;
    if (score > 0) scored.push({ name: emo.name, score });
  }

  // Strongest first; ties break on the fixed EMOTIONS order (stable) so the
  // read is fully deterministic. Take the top two.
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 2);

  // Normalize intensity to 0..1 against the leading score so the dominant read
  // reports its true strength band while the secondary read is relative to it.
  const peak = top.length > 0 ? top[0].score : 0;
  const reads = top.map((s) => ({
    emotion: s.name,
    intensity: peak > 0 ? Number((s.score / peak).toFixed(3)) : 0,
    band: bandFor(s === top[0] ? magnitude : magnitude * (s.score / peak)),
  }));

  return { reads, netValence: Number(netValence.toFixed(3)) };
}
