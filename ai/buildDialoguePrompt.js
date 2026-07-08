// ai/buildDialoguePrompt.js — pure, deterministic prompt assembly.
//
// Produces the single flat instruction string handed to the Perchance
// ai-text plugin. That transport has no system/user split and no
// server-side JSON enforcement — the JSON-only instruction at the end of
// this prompt plus responseContract.js's validator are the ONLY JSON
// discipline that exists.
//
// Pure function: no network, no randomness, no Date. Same inputs produce a
// byte-identical string, always (object-key iteration is made deterministic
// by sorting wherever key order could vary).

import { relationshipTier } from '../entities/relationshipStore.js';

/**
 * @param {import('../entities/entitySchema.js').EntityBase} entity - the speaking NPC
 * @param {Object} relationship - the NPC→player edge (its fromCallsTo is what
 *   the NPC calls the player); read-only, never written here
 * @param {Array<{seq: number, summary: string}>} recentMemories - MemoryRefs
 *   chosen by the caller; no memory-selection logic lives here
 * @param {string} playerInput - the player's spoken line
 * @returns {string} one flat instruction string
 */
export function buildDialoguePrompt(entity, relationship, recentMemories, playerInput) {
  const identity = entity.identity;
  const psychology = entity.psychology;
  const lines = [];

  lines.push(`You are roleplaying as ${identity.firstName} ${identity.lastName}, a character in a living-world simulation. Respond fully in character.`);
  lines.push('');

  // Identity — from entity.identity (entitySchema Identity section).
  lines.push('== Identity ==');
  lines.push(`Name: ${identity.firstName} ${identity.lastName}`);
  lines.push(`Age: ${identity.age}`);
  lines.push(`Gender: ${identity.gender}`);
  lines.push(`Vocation: ${identity.vocation}`);
  lines.push(`Relationship status: ${identity.relationshipStatus}`);
  lines.push(`Living situation: ${identity.livingSituation}`);
  lines.push(`Background: ${identity.background}`);
  lines.push(`Biography: ${identity.biography}`);
  lines.push('');

  // Personality — from entity.psychology (entitySchema Psychology section).
  lines.push('== Personality ==');
  lines.push(`Traits: ${psychology.personalityTraits.join(', ')}`);
  lines.push('Personality axes (higher = more of that quality):');
  // Sorted keys keep this deterministic regardless of authoring order.
  for (const axis of Object.keys(psychology.personalityAxes).sort()) {
    lines.push(`  ${axis}: ${psychology.personalityAxes[axis]}`);
  }
  lines.push(`Likes: ${psychology.likes.join(', ')}`);
  lines.push(`Dislikes: ${psychology.dislikes.join(', ')}`);
  lines.push(`Hobbies: ${psychology.hobbies.join(', ')}`);
  lines.push('');

  // Voice — from entity.psychology.voice.
  lines.push('== Voice ==');
  lines.push(`Accent: ${psychology.voice.accent}`);
  lines.push(`Speech pattern: ${psychology.voice.speechPattern}`);
  lines.push(`Voice tags: ${psychology.voice.tags.join(', ')}`);
  lines.push('');

  // Relationship — the NPC→player edge plus the derived tier.
  // relationshipTier() is a read-only derived call; nothing here writes.
  lines.push('== Relationship to the player ==');
  if (relationship.fromCallsTo) {
    lines.push(`You call the player "${relationship.fromCallsTo}".`);
  }
  lines.push(`Your relationship with the player is at the "${relationshipTier(relationship.stats)}" tier.`);
  lines.push('');

  // Hard constraints — entity.psychology.flags.aiDirectives, each verbatim
  // at MUST level, plus the baked-in constraints.
  lines.push('== Hard constraints ==');
  for (const directive of psychology.flags.aiDirectives) {
    lines.push(`- MUST: ${directive}`);
  }
  lines.push(`- MUST: Stay in character as ${identity.firstName} at all times.`);
  lines.push('- MUST: Respond with ONLY the JSON object described under "Output format" below — no prose, no explanation, no markdown outside it.');
  lines.push('');

  // Memories — the caller-selected MemoryRefs (entitySchema MemoryRef).
  lines.push('== Recent memories ==');
  for (const memory of recentMemories) {
    lines.push(`- ${memory.summary}`);
  }
  lines.push('');

  // The player's input, framed as speech directed at the NPC.
  lines.push('== The player speaks ==');
  lines.push(`The player says to you: "${playerInput}"`);
  lines.push('');

  // Final instruction, FUOC-style, spelling out the literal expected keys.
  // No server-side schema enforcement exists on this transport — this text
  // and the validator in responseContract.js are the whole contract.
  lines.push('== Output format ==');
  lines.push('Return ONLY valid JSON matching this exact shape, with no other text before or after it: { "dialogue": ..., "internalMonologue": ..., "toneTags": [...] }');
  lines.push('"dialogue" is what the character says aloud, in their voice. "internalMonologue" is the character\'s private, unspoken thought. "toneTags" is a short array of lowercase words describing the delivery. Do not include any other keys, and do not include numbers anywhere in the response.');

  return lines.join('\n');
}
