// ai/generateImagePrompt.js — stage 2 of the location pipeline: the flavor text
// from stage 1 → a single distilled image prompt (a comma-separated visual
// phrase an image model can use). Text transport, background category, same
// shared queue. Never throws.

import { aiQueue as queue } from './sharedQueue.js';

const RATE_LIMIT_PATTERN = /max.*request|too.*many.*request|rate.*limit/i;
const TEMPERATURE = 0.5;
const MAX_TOKENS = 80;
const TIMEOUT_MS = 20000;
const MAX_LENGTH = 400;

function cleanPrompt(raw) {
  let text = String(raw).replace(/\s+/g, ' ').trim();
  const quoted = text.match(/^["'“‘](.*)["'’”]$/);
  if (quoted) text = quoted[1].trim();
  if (text.length > MAX_LENGTH) text = text.slice(0, MAX_LENGTH).trim();
  return text;
}

export function buildImagePrompt(flavorText) {
  return [
    'Distill the following scene into ONE concise image-generation prompt:',
    'a comma-separated list of concrete visual elements, setting, lighting, and',
    'mood — no sentences, no second person, no camera directions. Fantasy RPG',
    'landscape art style.',
    '',
    'Scene:',
    String(flavorText).slice(0, 800),
    '',
    'Reply with only the comma-separated prompt.',
  ].join('\n');
}

/**
 * @returns {Promise<{ok: true, prompt: string} | {ok: false, reason: string}>}
 */
export async function generateImagePromptText(promptString) {
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
    return { ok: false, reason: RATE_LIMIT_PATTERN.test(message) ? 'rate-limited' : 'generation-failed' };
  }
  if (outcome.timedOut) return { ok: false, reason: 'timeout' };
  const prompt = cleanPrompt(outcome.result);
  return prompt ? { ok: true, prompt } : { ok: false, reason: 'empty' };
}
