// engines/memoryEngine.js — deterministic, rule-based memory generation.
//
// Subscribes to PLAYER_HELPED/PLAYER_ROBBED/PLAYER_IGNORED and appends a
// MemoryRef onto the target NPC's psychology.memories, pointing at the real
// dispatched log entry via its seq. AI-based memory summarization (turning a
// raw event into a nuanced, context-aware sentence via generateText) is
// explicit future work — this proves the mechanism, not the eventual quality
// of the summary text.

const MEMORY_TEMPLATES = {
  PLAYER_HELPED: 'The player helped me when I needed it.',
  PLAYER_ROBBED: 'The player stole from me.',
  PLAYER_IGNORED: 'The player brushed past without a word.',
};

export function createMemoryEngine(world, registry) {
  function recordMemory(entry) {
    const npc = registry.get(entry.payload.targetId);
    if (!npc) return; // target never registered — defensive no-op, no crash
    npc.psychology.memories.push({ seq: entry.seq, summary: MEMORY_TEMPLATES[entry.type] });
  }

  for (const actionType of Object.keys(MEMORY_TEMPLATES)) {
    world.subscribe(actionType, recordMemory);
  }

  return {};
}
