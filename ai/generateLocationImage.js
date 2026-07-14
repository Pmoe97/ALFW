// ai/generateLocationImage.js — stage 3 of the location pipeline: a distilled
// image prompt → a location image, via the ai-image plugin global `generateImage`
// (the image analogue of `generateText`; bound by Perchance, absent under Node).
// Routes through the SAME shared queue but on the 'image' type (scheduled
// independently of text) and the background category. Never throws; the caller
// simply keeps the neutral image placeholder on any failure.
//
// As with generateText, nothing here may declare a binding named `generateImage`
// — that would shadow the plugin. `typeof generateImage` is safe when undefined.

import { aiQueue as queue } from './sharedQueue.js';

const RATE_LIMIT_PATTERN = /max.*request|too.*many.*request|rate.*limit/i;
// Images are slower than text; give them a longer ceiling.
const TIMEOUT_MS = 45000;

/**
 * @param {string} imagePrompt - the distilled prompt from generateImagePrompt
 * @returns {Promise<{ok: true, url: string} | {ok: false, reason: string}>}
 *   never throws. `url` is whatever the plugin returns (an image URL / data URI).
 */
export async function generateLocationImage(imagePrompt) {
  if (typeof generateImage !== 'function') {
    return { ok: false, reason: 'plugin-unavailable' };
  }
  let outcome;
  try {
    outcome = await queue.enqueue({
      type: 'image',
      category: 'background',
      priority: 0,
      timeoutMs: TIMEOUT_MS,
      run: async () => generateImage(imagePrompt),
    });
  } catch (err) {
    const message = String(err?.message ?? err);
    return { ok: false, reason: RATE_LIMIT_PATTERN.test(message) ? 'rate-limited' : 'generation-failed' };
  }
  if (outcome.timedOut) return { ok: false, reason: 'timeout' };
  const url = String(outcome.result ?? '').trim();
  return url ? { ok: true, url } : { ok: false, reason: 'empty' };
}
