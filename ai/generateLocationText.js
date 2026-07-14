// ai/generateLocationText.js — stage 1 of the location pipeline: location facts
// → a 2–3 paragraph "DM read-aloud" description. Same AI-with-fallback discipline
// and the SAME shared queue as every other transport (generateSummary is the
// closest sibling: plain prose, background category, so a location regen yields
// the queue's foreground slots to live dialogue). Never throws; the caller keeps
// the deterministic fallbackLocationText on any failure.

import { aiQueue as queue } from './sharedQueue.js';

const RATE_LIMIT_PATTERN = /max.*request|too.*many.*request|rate.*limit/i;
const TEMPERATURE = 0.85;
const MAX_TOKENS = 320;
const TIMEOUT_MS = 20000;
const MAX_LENGTH = 1200;

function cleanText(raw) {
  let text = String(raw).replace(/\r/g, '').trim();
  const quoted = text.match(/^["'“‘]([\s\S]*)["'’”]$/);
  if (quoted) text = quoted[1].trim();
  if (text.length > MAX_LENGTH) text = text.slice(0, MAX_LENGTH).trim();
  return text;
}

// buildLocationPrompt — PURE, deterministic prompt from the same facts the
// fallback uses. Instructs a tight, sensory, second-person read; no invented
// proper nouns beyond what the facts supply.
export function buildLocationPrompt(facts) {
  const pois = facts.poiNames?.length ? facts.poiNames.join(', ') : 'none discovered yet';
  const people = facts.npcNames?.length ? facts.npcNames.join(', ') : 'no one in particular';
  const place = facts.kind === 'settlement'
    ? `${facts.tier || 'settlement'} (${facts.settlementLabel || 'unnamed'})`
    : `${facts.terrain || 'wild'} wilderness`;
  return [
    'You are the narrator of a text RPG. In 2–3 short paragraphs of vivid,',
    'grounded, second-person prose ("you..."), describe the player\'s immediate',
    'surroundings for them to read as they arrive. Do NOT invent place-names,',
    'characters, or events beyond the facts below; stay sensory and present-tense.',
    '',
    `Location: ${place}`,
    `Time: ${facts.bucket} in the season of ${facts.date?.monthName ?? 'unknown'}`,
    `Weather: ${facts.weather}`,
    `Points of interest visible: ${pois}`,
    `People about: ${people}`,
    '',
    'Reply with only the description — no title, no preamble.',
  ].join('\n');
}

/**
 * @returns {Promise<{ok: true, text: string} | {ok: false, reason: string}>}
 */
export async function generateLocationText(promptString) {
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
  const text = cleanText(outcome.result);
  return text ? { ok: true, text } : { ok: false, reason: 'empty' };
}
