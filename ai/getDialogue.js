// ai/getDialogue.js — the dialogue orchestrator.
//
// The one entry point game code calls to get an NPC line. Builds the prompt
// deterministically, tries the live AI path, and on ANY failure degrades to
// the deterministic fallback (Principle VIII). Never throws; always returns
// a displayable response.

import { buildDialoguePrompt } from './buildDialoguePrompt.js';
import { generateDialogue } from './generateDialogue.js';
import { fallbackDialogue } from './fallbackDialogue.js';

/**
 * @param {Object} entity - the speaking NPC
 * @param {Object} relationship - the NPC→player edge
 * @param {Array<{seq: number, summary: string}>} recentMemories
 * @param {string} playerInput
 * @returns {Promise<{source: 'ai'|'fallback', response: import('./responseContract.js').DialogueResponse}>}
 */
export async function getDialogue(entity, relationship, recentMemories, playerInput) {
  const prompt = buildDialoguePrompt(entity, relationship, recentMemories, playerInput);
  const attempt = await generateDialogue(prompt);

  if (attempt.ok) {
    console.log('[AI] dialogue generated (live AI path)');
    return { source: 'ai', response: attempt.response };
  }

  console.log(`[AI] ${attempt.reason} -> fallback`);
  return { source: 'fallback', response: fallbackDialogue(entity, relationship) };
}
