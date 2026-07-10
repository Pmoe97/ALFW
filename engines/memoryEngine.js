// engines/memoryEngine.js — event -> who remembers -> compressed memory line.
//
// Subscribes to PLAYER_HELPED/PLAYER_ROBBED/PLAYER_IGNORED, resolves WHO
// remembers, and COMMITS that resolution to the log as one MEMORY_RECORDED
// event; a second subscription applies the committed event by appending a
// MemoryRef (pointing at the real source entry via its seq) onto the
// psychology.memories of each named rememberer. Two halves:
//
//   WHO REMEMBERS — the direct target always does (being robbed in your sleep
//   is still your robbery). If the event names a nodeId and a `presence`
//   source is wired, the OTHER NPCs it reports present remember it too, as
//   witnesses. With schedules landed, presence is roster ∩
//   schedule-available: the wiring adapter filters the node's roster
//   (npcGeneratorEngine.rosterIdsAt) through deriveScheduleState at the
//   current game hour, so asleep NPCs witness nothing. The old "same node =
//   present together" stand-in is thus retired for AVAILABILITY, while
//   node-level location remains birth-node only — cross-node schedules are
//   deferred (see npcGeneratorEngine's header on lazy node generation). This
//   engine never looks behind the witnessesAt contract either way.
//
//   WHY the resolution is COMMITTED rather than re-derived: `presence` is an
//   injected collaborator (a stub in the harness, the schedule-filtered
//   roster in a full world), so who-was-present is NOT a pure function of the
//   log — the clock moves between record and replay — and it is a
//   live decision, exactly like relationshipEffectEngine's delta rules. The
//   decision is therefore resolved once, live, and dispatched as
//   MEMORY_RECORDED { sourceSeq, sourceType, memories } — the same
//   "resolve live, commit the resolution" cascade precedent — so a loaded
//   world replays the committed fact instead of re-guessing presence.
//
//   COMPRESSED LINE — real summarization follows the established
//   AI-with-fallback discipline (Principle VIII), same as dialogue: a memory is
//   recorded IMMEDIATELY with a deterministic template line (so state is never
//   missing or blocked), and THEN, only when the plugin is live, a background
//   generateSummary call dispatches MEMORY_SUMMARY_ENHANCED with an AI-written
//   line that replaces that memory's summary text. The seq never changes —
//   only display text — and under Node (no plugin) the template simply stays,
//   so the whole engine is deterministic off the page. Because the enhanced
//   line is itself a logged event (never an in-place overwrite), it survives
//   save/load: replay restores the AI text, not just the template fallback.
//
// The engine's real state lives ON the registered entities, so its
// "cache-vs-log" pair is deriveEntityMemories/rebuildMemories: an entity's
// memories array must always equal the pure fold of MEMORY_RECORDED +
// MEMORY_SUMMARY_ENHANCED over the log. Construction primes entities from
// whatever history the log already holds (cold-start against a loaded save),
// which is why this engine must be constructed AFTER every rememberer is
// registered — hand-authored entities and the npcGeneratorEngine (whose own
// priming re-registers generated NPCs from their birth snapshots) both come
// first.

import { generateSummary } from '../ai/generateSummary.js';
import { log } from '../debugLog.js';

const MEMORY_RECORDED = 'MEMORY_RECORDED';
const MEMORY_SUMMARY_ENHANCED = 'MEMORY_SUMMARY_ENHANCED';

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

// deriveEntityMemories — PURE. An entity's memories array replayed from the
// log alone: every MEMORY_RECORDED naming the entity contributes a
// { seq: sourceSeq, summary } ref in log order, and every later
// MEMORY_SUMMARY_ENHANCED for that (entity, seq) replaces the summary text
// (last one wins, matching live apply order). This is the single source of
// truth an entity's live memories must reproduce (see rebuildMemories) — the
// memory engine's analogue of deriveRelationshipStats.
export function deriveEntityMemories(log, entityId) {
  const memories = [];
  for (const entry of log) {
    if (entry.type === MEMORY_RECORDED) {
      for (const m of entry.payload.memories) {
        if (m.entityId === entityId) {
          memories.push({ seq: entry.payload.sourceSeq, summary: m.summary });
        }
      }
    } else if (entry.type === MEMORY_SUMMARY_ENHANCED) {
      if (entry.payload.entityId !== entityId) continue;
      const memory = memories.find((m) => m.seq === entry.payload.seq);
      if (memory) memory.summary = entry.payload.summary;
    }
  }
  return memories;
}

export function createMemoryEngine(world, registry, presence) {
  // enhanceSummary — ask the plugin for an AI-written line and, on success,
  // COMMIT it as a MEMORY_SUMMARY_ENHANCED event (never an in-place mutation —
  // the apply handler below is the only writer, so the enhanced text is a
  // logged fact that replay restores). Fire-and-forget: never awaited by the
  // event handler, and generateSummary never throws, so no unhandled rejection
  // can escape. Only ever called when the plugin is live (guarded in
  // recordMemory), so under Node this code path is inert and the template
  // simply stays.
  async function enhanceSummary(entityId, sourceSeq, type, rememberer, target, isVictim) {
    const result = await generateSummary(buildSummaryPrompt(type, rememberer, target, isVictim));
    if (result.ok) {
      world.dispatch(MEMORY_SUMMARY_ENHANCED, { entityId, seq: sourceSeq, summary: result.summary });
      log('AI', 'memory summarized (live AI path)');
    } else {
      log('AI', `memory summary ${result.reason} -> template retained`);
    }
  }

  // applyMemoryRecorded — the ONE code path that appends committed MemoryRefs
  // onto the live entities: at construction for entries already in the log
  // (cold-start priming against a loaded save), then live via the
  // subscription. The stored seq is the SOURCE event's seq, never this
  // MEMORY_RECORDED entry's own — deriveEmotion resolves a memory's valence
  // via log[mem.seq].type, so pointing at the cascade entry instead of the
  // PLAYER_* entry would silently flatten every emotion read to neutral.
  function applyMemoryRecorded(entry) {
    const { sourceSeq, memories } = entry.payload;
    for (const { entityId, summary } of memories) {
      const npc = registry.get(entityId);
      if (!npc) continue; // a committed rememberer we don't hold — defensive skip
      npc.psychology.memories.push({ seq: sourceSeq, summary });
    }
  }

  // applySummaryEnhanced — replace the matching memory's display text with the
  // committed AI line. Same construction-priming + live-subscription lifecycle
  // as applyMemoryRecorded; the seq (and therefore the underlying fact) never
  // changes, only the summary string.
  function applySummaryEnhanced(entry) {
    const { entityId, seq, summary } = entry.payload;
    const npc = registry.get(entityId);
    if (!npc) return;
    const memory = npc.psychology.memories.find((m) => m.seq === seq);
    if (memory) memory.summary = summary;
  }

  // recordMemory — the REACT handler (relationshipEffectEngine's shape): it
  // resolves the live decision and DISPATCHES, letting the apply handlers do
  // all entity writes. It must never be folded over history at construction —
  // its output (MEMORY_RECORDED) is already in a loaded log.
  function recordMemory(entry) {
    const { actorId, targetId, nodeId } = entry.payload;
    const target = registry.get(targetId);
    if (!target) return; // target never registered — defensive no-op, no event, no crash

    // WHO REMEMBERS: the target, plus co-located witnesses (target and actor
    // excluded from the witness set). Deduped, target first. Only registered
    // rememberers are committed — the payload is the permanent record of who
    // remembers, so a listed-but-unheld witness is filtered here, not carried
    // as a dangling reference.
    const rememberIds = [targetId];
    if (nodeId && presence && typeof presence.witnessesAt === 'function') {
      for (const id of presence.witnessesAt(nodeId)) {
        if (id !== targetId && id !== actorId && !rememberIds.includes(id) && registry.get(id)) {
          rememberIds.push(id);
        }
      }
    }

    const memories = rememberIds.map((id) => ({
      entityId: id,
      summary:
        id === targetId
          ? MEMORY_TEMPLATES[entry.type]
          : MEMORY_OBSERVER_TEMPLATES[entry.type](nameOf(target)),
    }));

    world.dispatch(MEMORY_RECORDED, {
      sourceSeq: entry.seq,
      sourceType: entry.type,
      memories,
    });

    // Optional AI enhancement, kicked off only from the LIVE path (never from
    // construction priming, so loading a save can never fire new AI calls).
    // Fire-and-forget; enhanceSummary swallows every failure internally, but a
    // defensive .catch guarantees these detached promises can never surface as
    // unhandled rejections (the queue manager's cardinal rule).
    if (typeof generateText === 'function') {
      for (const id of rememberIds) {
        enhanceSummary(id, entry.seq, entry.type, registry.get(id), target, id === targetId).catch(() => {});
      }
    }
  }

  // Prime entity memories from whatever history the log already holds (a
  // no-op on a fresh world), then subscribe. The react handler is deliberately
  // NOT primed — see recordMemory.
  for (const entry of world.getEventLog()) {
    if (entry.type === MEMORY_RECORDED) applyMemoryRecorded(entry);
    else if (entry.type === MEMORY_SUMMARY_ENHANCED) applySummaryEnhanced(entry);
  }
  world.subscribe(MEMORY_RECORDED, applyMemoryRecorded);
  world.subscribe(MEMORY_SUMMARY_ENHANCED, applySummaryEnhanced);
  for (const actionType of Object.keys(MEMORY_TEMPLATES)) {
    world.subscribe(actionType, recordMemory);
  }

  // rebuildMemories — an entity's memories recomputed from the log alone,
  // ignoring the live entity. Its equality with the entity's actual
  // psychology.memories is the rebuildability proof (mirrors
  // rebuildRelationshipStats).
  function rebuildMemories(entityId) {
    return deriveEntityMemories(world.getEventLog(), entityId);
  }

  return { rebuildMemories };
}
