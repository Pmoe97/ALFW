// engines/memoryEngine.js — event -> who remembers -> compressed memory line.
//
// Subscribes to PLAYER_HELPED/PLAYER_ROBBED/PLAYER_IGNORED and appends a
// MemoryRef (pointing at the real dispatched log entry via its seq) onto the
// psychology.memories of everyone who should remember the event. Two halves:
//
//   WHO REMEMBERS — the direct target always does. If the event names a nodeId
//   and a `presence` source is wired, the OTHER NPCs at that node remember it
//   too, as witnesses. The "same node = present together" rule is an explicit
//   STAND-IN for real presence/schedule tracking, which ALFW does not have yet
//   (NPC schedules / location-by-time-of-day are still unchecked on the
//   tracker). It leans on the only location signal that exists — the node an
//   NPC was generated at (npcGeneratorEngine.rosterIdsAt) — exactly the way
//   DEBUG_SET_TIME_CONTEXT stands in for real travel verbs. Swap it for a real
//   "who is physically here now" query when schedules land.
//
//   COMPRESSED LINE — real summarization follows the established
//   AI-with-fallback discipline (Principle VIII), same as dialogue: a memory is
//   pushed IMMEDIATELY with a deterministic template line (so state is never
//   missing or blocked), and THEN, only when the plugin is live, a background
//   generateSummary call overwrites that memory's summary text in place with an
//   AI-written line. The seq never changes — only display text — and under Node
//   (no plugin) the template simply stays, so the whole engine is deterministic
//   off the page. The template lookup is the fallback, not thrown away.

import { generateSummary } from '../ai/generateSummary.js';
import { log } from '../debugLog.js';

// First-person templates for the NPC the player acted ON. Also the offline
// fallback line when AI summarization is unavailable or fails.
const MEMORY_TEMPLATES = {
  PLAYER_HELPED: 'The player helped me when I needed it.',
  PLAYER_ROBBED: 'The player stole from me.',
  PLAYER_IGNORED: 'The player brushed past without a word.',
};

// Observer templates for a witness who saw it happen to someone else. Take the
// target's name so the memory records WHO it happened to.
const MEMORY_OBSERVER_TEMPLATES = {
  PLAYER_HELPED: (name) => `I watched the player help ${name}.`,
  PLAYER_ROBBED: (name) => `I saw the player steal from ${name}.`,
  PLAYER_IGNORED: (name) => `I saw the player brush past ${name} without a word.`,
};

// Verb phrases used only to build the AI summarization prompt, per perspective.
const EVENT_PHRASE = {
  victim: {
    PLAYER_HELPED: 'helped you when you needed it',
    PLAYER_ROBBED: 'stole from you',
    PLAYER_IGNORED: 'brushed past you without a word',
  },
  observer: {
    PLAYER_HELPED: 'help',
    PLAYER_ROBBED: 'steal from',
    PLAYER_IGNORED: 'brush past',
  },
};

function nameOf(npc) {
  return npc?.identity?.firstName ?? 'someone';
}

// buildSummaryPrompt — a compact instruction asking the plugin for ONE short,
// first-person memory line. Perspective-aware: the victim recalls what was done
// to them; a witness recalls what they saw done to the target.
function buildSummaryPrompt(type, rememberer, target, isVictim) {
  const who = nameOf(rememberer);
  if (isVictim) {
    return (
      `You are ${who}. Moments ago, the player ${EVENT_PHRASE.victim[type]}. ` +
      `In ONE short first-person sentence, write the memory you keep of it, in your own voice. ` +
      `Reply with only that sentence — no quotes, no preamble.`
    );
  }
  return (
    `You are ${who}. You just watched the player ${EVENT_PHRASE.observer[type]} ${nameOf(target)}. ` +
    `In ONE short first-person sentence, write the memory you keep of what you saw, in your own voice. ` +
    `Reply with only that sentence — no quotes, no preamble.`
  );
}

export function createMemoryEngine(world, registry, presence) {
  // Enhance a just-pushed memory with an AI-written line, replacing the template
  // summary IN PLACE on success. Fire-and-forget: never awaited by the event
  // handler, and generateSummary never throws, so no unhandled rejection can
  // escape. Only ever called when the plugin is live (guarded in recordMemory),
  // so under Node this code path is inert and the template stays.
  async function enhanceSummary(memory, type, rememberer, target, isVictim) {
    const result = await generateSummary(buildSummaryPrompt(type, rememberer, target, isVictim));
    if (result.ok) {
      memory.summary = result.summary;
      log('AI', 'memory summarized (live AI path)');
    } else {
      log('AI', `memory summary ${result.reason} -> template retained`);
    }
  }

  // Push one MemoryRef onto a rememberer, template-first. Returns nothing; the
  // optional AI overwrite is kicked off separately so the sync path is complete
  // and deterministic before any network work begins.
  function remember(npc, entry, summary, type, target, isVictim) {
    const memory = { seq: entry.seq, summary };
    npc.psychology.memories.push(memory);
    if (typeof generateText === 'function') {
      // Fire-and-forget. enhanceSummary swallows every failure internally, but
      // a defensive .catch here guarantees this detached promise can never
      // surface as an unhandled rejection (the queue manager's cardinal rule).
      enhanceSummary(memory, type, npc, target, isVictim).catch(() => {});
    }
  }

  function recordMemory(entry) {
    const { actorId, targetId, nodeId } = entry.payload;
    const target = registry.get(targetId);
    if (!target) return; // target never registered — defensive no-op, no crash

    // WHO REMEMBERS: the target, plus co-located witnesses (target and actor
    // excluded from the witness set). Deduped, target first.
    const rememberIds = [targetId];
    if (nodeId && presence && typeof presence.witnessesAt === 'function') {
      for (const id of presence.witnessesAt(nodeId)) {
        if (id !== targetId && id !== actorId && !rememberIds.includes(id)) {
          rememberIds.push(id);
        }
      }
    }

    for (const id of rememberIds) {
      const npc = registry.get(id);
      if (!npc) continue; // a listed witness we don't hold — defensive skip
      const isVictim = id === targetId;
      const summary = isVictim
        ? MEMORY_TEMPLATES[entry.type]
        : MEMORY_OBSERVER_TEMPLATES[entry.type](nameOf(target));
      remember(npc, entry, summary, entry.type, target, isVictim);
    }
  }

  for (const actionType of Object.keys(MEMORY_TEMPLATES)) {
    world.subscribe(actionType, recordMemory);
  }

  return {};
}
