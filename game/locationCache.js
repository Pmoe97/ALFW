// game/locationCache.js — the thin wrapper the AI queue deliberately lacks:
// cache-by-hash, in-flight dedupe, and result swap-in for the location text +
// image pipeline. The queue (ai/queueManager.js) only schedules WHEN work runs;
// it has no cache, no dedupe, and no "swap in when ready" — those live here.
//
// Keying: a LOCATION-STATE hash, not "player is here" —
//   `${nodeId}|${season}|${bucket}|${weather}`
// so the same place under the same day/night + season + (deterministic) weather
// serves the cached read instantly, and any change queues a background regen.
//
// HARD CONSTRAINT (protects the save-growth story): AI-generated text and images
// are regenerable derived content and live ONLY in this in-memory cache — they
// are NEVER written to the event log or a save. A save stays config + the log.
//
// Generation is fire-and-forget and never blocks play: get() returns the
// deterministic placeholder immediately on a miss and kicks the 3-stage
// background pipeline (text → image-prompt → image), calling onUpdate() as each
// stage swaps in so the screen re-renders.

import { fallbackLocationText } from '../ai/fallbackLocationText.js';
import { buildLocationPrompt, generateLocationText } from '../ai/generateLocationText.js';
import { buildImagePrompt, generateImagePromptText } from '../ai/generateImagePrompt.js';
import { generateLocationImage } from '../ai/generateLocationImage.js';

export function locationHash(facts) {
  return `${facts.nodeId}|${facts.season}|${facts.bucket}|${facts.weather}`;
}

export function createLocationCache({ onUpdate } = {}) {
  // hash -> { text, textSource: 'placeholder'|'ai', image: string|null, imageStatus }
  const cache = new Map();
  const inflight = new Set();

  // get(facts) — the cached entry for this location-state, creating a
  // placeholder entry (and kicking a background regen) on a miss. Never blocks.
  function get(facts) {
    const hash = locationHash(facts);
    let entry = cache.get(hash);
    if (!entry) {
      entry = { text: fallbackLocationText(facts), textSource: 'placeholder', image: null, imageStatus: 'none' };
      cache.set(hash, entry);
      kickRegen(hash, facts);
    }
    return entry;
  }

  // kickRegen — the 3-stage background pipeline. Dedupes per hash. Each stage
  // swaps its result into the cached entry and calls onUpdate(); a failure at any
  // stage simply leaves the prior (placeholder text / no image) in place.
  async function kickRegen(hash, facts) {
    if (inflight.has(hash)) return;
    inflight.add(hash);
    try {
      const textResult = await generateLocationText(buildLocationPrompt(facts));
      if (!textResult.ok) return;
      const e1 = cache.get(hash);
      if (e1) { e1.text = textResult.text; e1.textSource = 'ai'; }
      onUpdate?.();

      const promptResult = await generateImagePromptText(buildImagePrompt(textResult.text));
      if (!promptResult.ok) return;

      const eImg = cache.get(hash);
      if (eImg) eImg.imageStatus = 'generating';
      const imageResult = await generateLocationImage(promptResult.prompt);
      const e2 = cache.get(hash);
      if (e2) {
        if (imageResult.ok) { e2.image = imageResult.url; e2.imageStatus = 'ready'; }
        else e2.imageStatus = 'failed';
      }
      onUpdate?.();
    } finally {
      inflight.delete(hash);
    }
  }

  return { get, locationHash, _size: () => cache.size };
}
