// ai/generateSummary.js — the memory-summarization transport.
//
// Turns a raw remembered event into a single compressed, in-character memory
// line via the ai-text plugin, following the SAME AI-with-fallback discipline
// as generateDialogue.js (Principle VIII): try the live call, and let the
// caller (engines/memoryEngine.js) degrade to its deterministic template line
// on ANY failure. This file never throws and never invents a second
// AI-calling convention — same `generateText` global, same shared queue, same
// rate-limit detection as dialogue.
//
// Two things differ from dialogue on purpose:
//   1. category 'background' — the player is NOT waiting on a memory line the
//      way they wait on an NPC's spoken reply, so summaries yield the queue's
//      foreground slots to live dialogue.
//   2. The response is plain prose, not JSON — a memory line has no structured
//      contract to enforce, so validation is just "a non-empty single line,"
//      cleaned and length-capped rather than parsed.

import { aiQueue as queue } from './sharedQueue.js';

// Same "detect availability by identifier, not by config" trick as
// generateDialogue: there is no API key or endpoint on our side; the plugin
// binding either exists on the page or it doesn't (e.g. under Node).
const RATE_LIMIT_PATTERN = /max.*request|too.*many.*request|rate.*limit/i;

// A memory line should be a single short sentence. Low temperature keeps it
// factual and compressed rather than florid; the token ceiling is a hard stop
// well under a sentence or two.
const TEMPERATURE = 0.6;
const MAX_TOKENS = 60;
const TIMEOUT_MS = 20000;
const MAX_SUMMARY_LENGTH = 200;

// cleanSummaryLine — normalize the plugin's String-like return into one tidy
// line: collapse whitespace/newlines, strip wrapping quotes the model often
// adds, and cap the length. Returns '' for anything unusable.
function cleanSummaryLine(raw) {
  let text = String(raw).replace(/\s+/g, ' ').trim();
  // Strip a single pair of surrounding quotes (straight or curly).
  const quoted = text.match(/^["'“‘](.*)["'’”]$/);
  if (quoted) text = quoted[1].trim();
  if (text.length > MAX_SUMMARY_LENGTH) text = text.slice(0, MAX_SUMMARY_LENGTH).trim();
  return text;
}

/**
 * @param {string} promptString - a compact instruction describing the event and
 *   asking for one in-character memory line (built by memoryEngine)
 * @returns {Promise<{ok: true, summary: string} | {ok: false, reason: string}>}
 *   never throws
 */
export async function generateSummary(promptString) {
  if (typeof generateText !== 'function') {
    return { ok: false, reason: 'plugin-unavailable' };
  }

  let outcome;
  try {
    outcome = await queue.enqueue({
      type: 'text',
      category: 'background',
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

  const summary = cleanSummaryLine(outcome.result);
  if (summary === '') {
    return { ok: false, reason: 'empty-summary' };
  }
  return { ok: true, summary };
}
