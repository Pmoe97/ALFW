// game/main.js — smoke-test entry point for the Perchance bundle.
//
// This is NOT a game loop and NOT UI — it's the minimal proof-of-life that
// gets bundled and pasted into Perchance's master HTML panel. It builds a
// world, the same hand-authored Mira/Rowan pair proof.js uses, wires their
// relationship, and makes one real getDialogue() call — the console output
// is how the author hand-verifies the live AI path once this is pasted into
// an actual Perchance page (something node proof.js can never do, since the
// real generateText plugin only exists there).

import { buildSampleWorld } from './sampleWorld.js';
import { getDialogue } from '../ai/getDialogue.js';

// Wrapped in an explicit async function (rather than top-level await) so the
// esbuild iife bundle doesn't depend on version-specific handling of
// top-level await inside iife format.
async function main() {
  const { mira, rowan, relationships } = buildSampleWorld();

  console.log(`[ALFW] NPC: ${mira.identity.firstName} ${mira.identity.lastName}, age ${mira.identity.age}, ${mira.identity.vocation}`);
  console.log(`[ALFW] Player: ${rowan.identity.firstName} ${rowan.identity.lastName}, age ${rowan.identity.age}, ${rowan.identity.vocation}`);

  // typeof is safe even when the identifier was never declared (e.g. here,
  // outside a live Perchance page). Never declare a local generateText or
  // generateImage binding anywhere in this file — doing so would shadow the
  // plugin globals Perchance injects, per the convention in ai/generateDialogue.js.
  console.log('[ALFW] generateText available:', typeof generateText === 'function');
  console.log('[ALFW] generateImage available:', typeof generateImage === 'function');

  const miraToRowan = relationships.getRelationship(mira.id, rowan.id); // NPC -> player edge, per getDialogue's contract
  const sampleLine = 'Evening, Mira. Any rooms free tonight?';
  const result = await getDialogue(mira, miraToRowan, mira.psychology.memories, sampleLine);
  console.log('[ALFW] dialogue source:', result.source);
  console.log('[ALFW] dialogue:', result.response.dialogue);
}

main().catch((err) => console.error('[ALFW] smoke test failed:', err));
