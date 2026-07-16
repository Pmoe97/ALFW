// ai/generatePortraitImages.js — the character-creation wizard's Portrait
// step: a compiled prompt -> N candidate portrait images, via the same
// ai-image plugin global `generateImage` the location pipeline
// (ai/generateLocationImage.js) uses. There is no confirmed multi-image-per-
// call option on the Perchance plugin, so N samples means N separate calls
// fired concurrently through the shared queue, not a guessed {count:N} arg.
//
// Runs on the 'foreground' category (unlike the location pipeline's
// 'background' prefetch) because this is a direct, player-waited-for action
// during an active flow, not a prefetch — it should get the queue's
// foreground-headroom guarantee. Never throws.
//
// As with generateLocationImage.js: nothing here may declare a binding named
// `generateImage` — that would shadow the plugin.

import { aiQueue as queue } from './sharedQueue.js';

const RATE_LIMIT_PATTERN = /max.*request|too.*many.*request|rate.*limit/i;
const TIMEOUT_MS = 45000;

async function generateOnePortrait(prompt) {
  let outcome;
  try {
    outcome = await queue.enqueue({
      type: 'image',
      category: 'foreground',
      priority: 0,
      timeoutMs: TIMEOUT_MS,
      run: async () => generateImage(prompt),
    });
  } catch (err) {
    const message = String(err?.message ?? err);
    return { ok: false, reason: RATE_LIMIT_PATTERN.test(message) ? 'rate-limited' : 'generation-failed' };
  }
  if (outcome.timedOut) return { ok: false, reason: 'timeout' };
  const url = String(outcome.result ?? '').trim();
  return url ? { ok: true, url } : { ok: false, reason: 'empty' };
}

/**
 * @param {string} prompt
 * @param {number} count
 * @returns {Promise<Array<{ok: true, url: string} | {ok: false, reason: string}>>}
 *   one settled result per requested sample, order-preserving, never throws.
 */
export async function generatePortraitImages(prompt, count) {
  if (typeof generateImage !== 'function') {
    return Array.from({ length: count }, () => ({ ok: false, reason: 'plugin-unavailable' }));
  }
  return Promise.all(Array.from({ length: count }, () => generateOnePortrait(prompt)));
}
