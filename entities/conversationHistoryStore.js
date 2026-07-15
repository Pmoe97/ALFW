// entities/conversationHistoryStore.js — verbatim dialogue history, keyed by
// the UNORDERED pair of participants.
//
// Distinct from engines/memoryEngine.js: that engine stores compressed,
// event-triggered summaries on the rememberer entity. This store records
// exactly what was said, in order, during Talk exchanges. A conversation is
// a property of a PAIR, not of one entity — Mira's thread with Rowan must
// stay completely separate from her thread with Sable, and (unlike
// relationship stats, which are legitimately asymmetric per direction) a
// conversation has ONE shared history regardless of who is speaking in a
// given turn. That is why this lives here, as a standalone Map-keyed store
// mirroring entities/relationshipStore.js's edgeKey shape, rather than as a
// field on either entity — direction-agnostic where relationshipStore is
// direction-sensitive.
//
// No registry dependency: like relationshipStore, this store never mutates
// entity objects, so it only ever needs the world.

import { getSchema } from '../engines/activeSchema.js';

const DIALOGUE_LINE = 'DIALOGUE_LINE';

// The canonical, order-independent key for a pair. Sorting collapses
// (a, b) and (b, a) to the same key, the direction-agnostic counterpart to
// relationshipStore's edgeKey(fromId, toId) = `${fromId}->${toId}`.
function conversationKey(idA, idB) {
  return [idA, idB].sort().join('::');
}

// deriveConversationHistory — PURE. Replays every DIALOGUE_LINE naming the
// unordered (idA, idB) pair, in log order. This is the single source of
// truth a pair's live cache must reproduce (see rebuildConversationHistory) —
// the conversation store's analogue of deriveRelationshipStats.
export function deriveConversationHistory(log, idA, idB) {
  const key = conversationKey(idA, idB);
  const history = [];
  for (const entry of log) {
    if (entry.type !== DIALOGUE_LINE) continue;
    const { participantIds, speakerId, text } = entry.payload;
    if (conversationKey(participantIds[0], participantIds[1]) !== key) continue;
    history.push({ seq: entry.seq, speakerId, text });
  }
  return history;
}

// Only the most recent exchanges are loaded into a dialogue prompt — the
// same token-cost discipline as deriveEmotion's RECENCY_WINDOW and voice's
// accent-phrase seed list. Provisional first-pass balance, retune here
// freely. Counted in EXCHANGES (one player line + one NPC line), not raw
// lines, since a "turn" is the natural unit of conversational recency.
export const RECENT_EXCHANGES_WINDOW = getSchema().conversation.recentExchangesWindow;

export function getRecentHistory(fullHistory, windowSize = RECENT_EXCHANGES_WINDOW) {
  return fullHistory.slice(-(windowSize * 2));
}

export function createConversationHistoryStore(world) {
  // cachedHistory: pairKey -> a mutable DialogueLine[] owned solely by this
  // store. Never handed out by reference (getConversationHistory clones),
  // and always fully rebuildable from the log via deriveConversationHistory.
  // Mirrors relationshipStore's cachedStats Map exactly.
  const cachedHistory = new Map();

  // applyDialogueLine — the ONE code path that appends a committed line to
  // the cache: at construction for entries already in the log (cold-start
  // priming against a loaded save), then live via the subscription. No react
  // handler exists for this store — unlike memoryEngine's witness-fan-out
  // recordMemory, the caller has already fully resolved the fact (who said
  // what, to whom) before dispatching, so there's no live decision left to
  // make and re-commit.
  function applyDialogueLine(entry) {
    const { participantIds, speakerId, text } = entry.payload;
    const key = conversationKey(participantIds[0], participantIds[1]);
    let history = cachedHistory.get(key);
    if (!history) {
      history = [];
      cachedHistory.set(key, history);
    }
    history.push({ seq: entry.seq, speakerId, text });
  }

  // Prime the cache from whatever history the log already holds (a no-op on
  // a fresh world), THEN subscribe for everything dispatched from here on —
  // matching relationshipStore's construction-order discipline.
  for (const entry of world.getEventLog()) {
    if (entry.type === DIALOGUE_LINE) applyDialogueLine(entry);
  }
  world.subscribe(DIALOGUE_LINE, applyDialogueLine);

  // recordDialogueLine — the single sanctioned way to append a line. It only
  // dispatches; the subscription above updates the cache. Mirrors
  // recordRelationshipEvent.
  function recordDialogueLine(idA, idB, speakerId, text) {
    return world.dispatch(DIALOGUE_LINE, { participantIds: [idA, idB], speakerId, text });
  }

  function getConversationHistory(idA, idB) {
    const history = cachedHistory.get(conversationKey(idA, idB));
    // Clone so callers can never mutate the store's cached array.
    return history ? [...history] : [];
  }

  // rebuildConversationHistory — recompute a pair's history from the log
  // alone, ignoring the live cache. Its equality with getConversationHistory()
  // is the rebuildability proof (mirrors rebuildRelationshipStats).
  function rebuildConversationHistory(idA, idB) {
    return deriveConversationHistory(world.getEventLog(), idA, idB);
  }

  return { recordDialogueLine, getConversationHistory, rebuildConversationHistory };
}
