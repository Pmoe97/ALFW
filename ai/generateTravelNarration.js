// ai/generateTravelNarration.js — the travel-narration transport.
//
// Turns a leg's already-committed facts (origin, destination, distance, and
// the seeded incident roll) into one short second-person paragraph via the
// ai-text plugin, following the SAME AI-with-fallback discipline as
// generateDialogue.js / generateSummary.js (Principle VIII): try the live
// call, and let the caller (engines/travelEngine.js) keep its deterministic
// fallback line on ANY failure. This file never throws and never invents a
// second AI-calling convention — same `generateText` global, same shared
// queue, same rate-limit detection.
//
// Two things differ from the memory-summary transport on purpose:
//   1. category 'foreground' — the player IS watching this one: the narration
//      is meant to land inside the leg's own dilated time window (the
//      advancing clock is the loading indicator), so it takes a foreground
//      slot like dialogue rather than yielding like background summaries.
//   2. The timeout is 15s (dialogue's, not summary's 20s) so a slow call
//      still resolves inside a typical ~21–39 real-second leg.
// Like the summary transport, the response is plain prose — a narration
// paragraph has no structured contract, so validation is "non-empty, cleaned,
// length-capped", not JSON parsing.

import { aiQueue as queue } from './sharedQueue.js';

const RATE_LIMIT_PATTERN = /max.*request|too.*many.*request|rate.*limit/i;

// A short paragraph, colorful but bounded: a slightly warmer temperature than
// a memory line, a token ceiling around 2-3 sentences, and a hard length cap.
const TEMPERATURE = 0.8;
const MAX_TOKENS = 160;
const TIMEOUT_MS = 15000;
const MAX_NARRATION_LENGTH = 600;

// cleanNarration — normalize the plugin's String-like return into one tidy
// paragraph: collapse whitespace/newlines, strip wrapping quotes, cap the
// length. Returns '' for anything unusable.
function cleanNarration(raw) {
  let text = String(raw).replace(/\s+/g, ' ').trim();
  const quoted = text.match(/^["'“‘](.*)["'’”]$/);
  if (quoted) text = quoted[1].trim();
  if (text.length > MAX_NARRATION_LENGTH) text = text.slice(0, MAX_NARRATION_LENGTH).trim();
  return text;
}

/**
 * @param {string} promptString - a compact instruction carrying the leg's
 *   committed facts and forbidding the model from changing them (built by
 *   travelEngine)
 * @returns {Promise<{ok: true, narration: string} | {ok: false, reason: string}>}
 *   never throws
 */
export async function generateTravelNarration(promptString) {
  if (typeof generateText !== 'function') {
    return { ok: false, reason: 'plugin-unavailable' };
  }

  let outcome;
  try {
    outcome = await queue.enqueue({
      type: 'text',
      category: 'foreground',
      priority: 0,
      timeoutMs: TIMEOUT_MS,
      run: async () => generateText(promptString, { temperature: TEMPERATURE, max_tokens: MAX_TOKENS }),
    });
  } catch (err) {
    const message = String(err?.message ?? err);
    return {
      ok: false,
      reason: RATE_LIMIT_PATTERN.test(message) ? 'rate-limited' : 'generation-failed',
    };
  }

  if (outcome.timedOut) {
    return { ok: false, reason: 'timeout' };
  }

  const narration = cleanNarration(outcome.result);
  if (narration === '') {
    return { ok: false, reason: 'empty-narration' };
  }
  return { ok: true, narration };
}
