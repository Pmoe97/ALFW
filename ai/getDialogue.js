// ai/getDialogue.js — the dialogue orchestrator.
//
// The one entry point game code calls to get an NPC line. Builds the prompt
// deterministically, tries the live AI path, and on ANY failure degrades to
// the deterministic fallback (Principle VIII). Never throws; always returns
// a displayable response.

import { buildDialoguePrompt } from './buildDialoguePrompt.js';
import { generateDialogue } from './generateDialogue.js';
import { fallbackDialogue } from './fallbackDialogue.js';
import { deriveEmotion } from '../entities/deriveEmotion.js';
import { log } from '../debugLog.js';

/**
 * @param {Object} entity - the speaking NPC
 * @param {Object} relationship - the NPC→player edge
 * @param {Array<{seq: number, summary: string}>} recentMemories
 * @param {string} playerInput
 * @param {Array} [eventLog] - the world event log, used to derive the NPC's
 *   transient per-turn emotion (deriveEmotion looks up each memory's valence by
 *   seq). Defaults to [] -> a calm, axis-shaped baseline read.
 * @param {Array<{seq: number, speakerId: string, text: string}>} [conversationHistory] -
 *   the bounded recent window of this pair's DIALOGUE_LINE history (see
 *   entities/conversationHistoryStore.js's getRecentHistory), oldest first.
 *   Caller-selected; no windowing logic lives here. Defaults to [] -> no
 *   conversation-history section is rendered.
 * @returns {Promise<{source: 'ai'|'fallback', response: import('./responseContract.js').DialogueResponse}>}
 */
export async function getDialogue(entity, relationship, recentMemories, playerInput, eventLog = [], conversationHistory = []) {
  // Emotion is derived fresh here (never stored) and passed into the pure prompt
  // builder as its own transient section, distinct from the permanent voice.
  const emotion = deriveEmotion(entity, recentMemories, eventLog);
  const prompt = buildDialoguePrompt(entity, relationship, recentMemories, playerInput, emotion, conversationHistory);
  const attempt = await generateDialogue(prompt);

  if (attempt.ok) {
    log('AI', 'dialogue generated (live AI path)');
    return { source: 'ai', response: attempt.response };
  }

  log('AI', `${attempt.reason} -> fallback`);
  return { source: 'fallback', response: fallbackDialogue(entity, relationship) };
}
