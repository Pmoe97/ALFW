// ai/generateDialogue.js — the dialogue transport, routed through the queue.
//
// `generateText` is a page global that Perchance's lists panel binds via
// `generateText = {import:ai-text-plugin}`. We only ever CALL it — nothing
// in this file (or anywhere in ai/) may declare a function or variable
// named `generateText` or `generateImage`, since that would shadow the
// plugin binding and silently break it. `typeof generateText` is safe even
// when the identifier was never declared (e.g. running under Node), which
// is exactly how availability is detected: there is no API key, header, or
// endpoint on our side at all.

import { aiQueue as queue } from './sharedQueue.js';
import { validateDialogueResponse } from './responseContract.js';

// The single queue every AI call in the game routes through (ai/sharedQueue.js).
// Foreground dialogue here and background memory summaries in generateSummary.js
// draw on the same budget, so the queue's foreground-headroom guarantee holds.

// The transport has no structured error codes — rate limiting can only be
// detected by matching the rejected promise's message text (FUOC pattern).
const RATE_LIMIT_PATTERN = /max.*request|too.*many.*request|rate.*limit/i;

// Generation defaults for short in-character dialogue:
// - temperature 0.7: enough variety that repeated lines don't read canned,
//   low enough that the JSON-shape instruction stays reliably followed.
// - max_tokens 300: comfortably fits a few sentences of dialogue plus a
//   short internal monologue and tone tags. (`max_tokens` snake_case is the
//   one spelling used in this codebase; FUOC mixes spellings, we don't.)
// - 15s queue timeout: long enough for a normal generation, short enough
//   that the deterministic fallback line appears before the player assumes
//   the game hung. No fallbackValue here — a timeout surfaces as
//   { ok: false, reason: 'timeout' } so getDialogue.js falls through to
//   fallbackDialogue.js.
const TEMPERATURE = 0.7;
const MAX_TOKENS = 300;
const TIMEOUT_MS = 15000;

/**
 * @param {string} promptString - output of buildDialoguePrompt()
 * @returns {Promise<{ok: true, response: import('./responseContract.js').DialogueResponse}
 *   | {ok: false, reason: string}>} never throws
 */
export async function generateDialogue(promptString) {
  // Expected state when not inside a live Perchance page (e.g. Node) — an
  // ordinary outcome, not an error.
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

  // The plugin returns a String-like object; String() + trim() normalize it.
  // There is no server-side JSON enforcement — parse + validate here is the
  // entire discipline.
  let parsed;
  try {
    parsed = JSON.parse(String(outcome.result).trim());
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }

  const validated = validateDialogueResponse(parsed);
  if (!validated.ok) {
    return { ok: false, reason: `invalid-response: ${validated.reason}` };
  }
  return { ok: true, response: validated.value };
}
