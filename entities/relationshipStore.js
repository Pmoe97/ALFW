// entities/relationshipStore.js — directed relationship edges, never entity fields.
//
// Entities know nothing about who they're connected to. Relationships live
// here as directed edges keyed by (fromId, toId), so a player<->NPC edge and
// an NPC<->NPC edge work identically. Built as a factory taking the world
// instance, matching the engine pattern in engines/.
//
// The five relationship stats (affection, comfort, trust, desire, obedience)
// are DERIVED values, never a mutable object a caller overwrites. They are the
// running sum of RELATIONSHIP_EVENT actions in the append-only world event log,
// exactly the way engines/worldClockEngine.js derives game-time and
// engines/reputationEngine.js derives reputation: an incrementally-maintained
// cache that is always fully rebuildable from the log alone (see
// deriveRelationshipStats / rebuildRelationshipStats). fromCallsTo labels and
// family ties are deliberately NOT log-derived — they stay direct-set.

import { getSchema } from '../engines/activeSchema.js';

/**
 * @typedef {Object} RelationshipStats
 * @property {number} affection
 * @property {number} comfort
 * @property {number} trust
 * @property {number} desire
 * @property {number} obedience
 */

/**
 * @typedef {Object} Relationship
 * @property {string} fromId
 * @property {string} toId
 * @property {RelationshipStats} stats
 * @property {string} fromCallsTo - what fromId calls toId; the reverse label
 *   lives on the toId->fromId edge, not here
 */

/**
 * @typedef {Object} RelationshipHistory
 * @property {number} count - number of RELATIONSHIP_EVENT entries for the pair
 * @property {number} totalWeight - sum of absolute weights across those entries
 */

/**
 * @typedef {Object} FamilyTie
 * @property {string} fromId
 * @property {string} toId
 * @property {'parent'|'child'|'sibling'|'spouse'|'other'} relation
 */

// The five axes a RELATIONSHIP_EVENT may target. Any event whose axis is not
// one of these is ignored by the derivation (defensive — never throws on a
// stray payload).
const RELATIONSHIP_AXES = Object.freeze([
  'affection',
  'comfort',
  'trust',
  'desire',
  'obedience',
]);

const DEFAULT_RELATIONSHIP_STATS = Object.freeze({
  affection: 0,
  comfort: 0,
  trust: 0,
  desire: 0,
  obedience: 0,
});

function edgeKey(fromId, toId) {
  return `${fromId}->${toId}`;
}

// The logical inverse of each family relation, used to keep both directions
// of a tie in sync from a single setFamilyTie() call. sibling/spouse/other
// are symmetric; parent/child mirror each other.
const INVERSE_RELATION = {
  parent: 'child',
  child: 'parent',
  sibling: 'sibling',
  spouse: 'spouse',
  other: 'other',
};

// deriveRelationshipStats — pure. Replays every RELATIONSHIP_EVENT for the
// directed (fromId, toId) pair in log order and sums deltas per axis, starting
// from all-zero. This is the single source of truth for a pair's stats; the
// store's cache is only ever an optimization that must reproduce this exactly.
//
// weight is intentionally NOT applied to stat sums — it belongs to history /
// future stickiness math only (see deriveRelationshipHistory). Stats are a
// plain sum of deltas.
export function deriveRelationshipStats(log, fromId, toId) {
  const stats = { ...DEFAULT_RELATIONSHIP_STATS };
  for (const entry of log) {
    if (entry.type !== 'RELATIONSHIP_EVENT') continue;
    const { fromId: f, toId: t, axis, delta } = entry.payload;
    if (f !== fromId || t !== toId) continue;
    if (!RELATIONSHIP_AXES.includes(axis)) continue;
    stats[axis] += delta;
  }
  return stats;
}

// deriveRelationshipHistory — pure. Returns the raw event count and total
// absolute weight for a directed pair. This is NOT a sixth stat: it exists
// purely so stickiness/decay math can be layered on top later (a long, heavy
// history should be harder to move than a shallow one). No decay math lives
// here — this only exposes the raw count/weight so it CAN be used.
export function deriveRelationshipHistory(log, fromId, toId) {
  let count = 0;
  let totalWeight = 0;
  for (const entry of log) {
    if (entry.type !== 'RELATIONSHIP_EVENT') continue;
    const { fromId: f, toId: t, weight } = entry.payload;
    if (f !== fromId || t !== toId) continue;
    count += 1;
    totalWeight += Math.abs(weight ?? 1);
  }
  return { count, totalWeight };
}

export function createRelationshipStore(world) {
  // cachedStats: edgeKey -> a mutable stats object owned solely by this store.
  // Never handed out by reference (getRelationship clones), and always fully
  // rebuildable from the log via deriveRelationshipStats.
  const cachedStats = new Map();
  // labels: edgeKey -> fromCallsTo. Direct-set, no log involvement — a label is
  // inherently asymmetric and carries no history worth replaying.
  //
  // SAVE/LOAD BOUNDARY: because labels and family ties are NOT in the log,
  // they survive a load only because construction-time authoring re-runs
  // (buildSampleWorld re-sets them, save or no save). That is safe exactly as
  // long as setLabel/setFamilyTie stay authoring-time-only. The moment a
  // RUNTIME feature edits labels or ties, it must go through a dispatched
  // event instead, or the edit will silently vanish across save/load.
  const labels = new Map();
  const familyTies = new Map();

  // applyRelationshipEvent — the ONE code path that folds a RELATIONSHIP_EVENT
  // into the cache. It runs twice over an entry's lifetime, never both: once at
  // construction for entries already in the log (cold-start priming against a
  // loaded save), or once live via the subscription below. Priming through the
  // exact same function the subscription uses is definitionally identical to
  // having been subscribed since seq 0.
  function applyRelationshipEvent(entry) {
    const { fromId, toId, axis, delta } = entry.payload;
    if (!RELATIONSHIP_AXES.includes(axis)) return;
    const key = edgeKey(fromId, toId);
    let stats = cachedStats.get(key);
    if (!stats) {
      // Fresh clone per edge. DEFAULT_RELATIONSHIP_STATS is frozen at module
      // scope: assigning it directly would throw on the first mutation, and
      // sharing one clone across pairs would alias every relationship into one
      // mutually-corrupting object. One independent clone per new edgeKey.
      stats = { ...DEFAULT_RELATIONSHIP_STATS };
      cachedStats.set(key, stats);
    }
    stats[axis] += delta;
  }

  // Prime the cache from whatever history the log already holds (a no-op on a
  // fresh world), THEN subscribe for everything dispatched from here on.
  // ORDER MATTERS for the subscription exactly as before: it must be live
  // before any NEW RELATIONSHIP_EVENT is dispatched — including the seed
  // recordRelationshipEvent calls in game/sampleWorld.js — or the cache will
  // miss those events and silently go stale (only rebuildRelationshipStats
  // would then be correct). Construct the store before wiring engines/seeding.
  for (const entry of world.getEventLog()) {
    if (entry.type === 'RELATIONSHIP_EVENT') applyRelationshipEvent(entry);
  }
  world.subscribe('RELATIONSHIP_EVENT', applyRelationshipEvent);

  // resolveRelationshipEvent — PURE event construction, no dispatch; never
  // fails (any axis/delta is accepted, exactly like recordRelationshipEvent
  // always did — deriveRelationshipStats defensively ignores an unknown
  // axis rather than rejecting it). Exposed so a composite action
  // (combatEngine's resolveConsequences, questEngine's completeQuest) can build
  // its full event list up front and submit it as one world.dispatchBatch —
  // see worldState.js's dispatchBatch for why.
  function resolveRelationshipEvent(fromId, toId, axis, delta, weight = 1) {
    return { type: 'RELATIONSHIP_EVENT', payload: { fromId, toId, axis, delta, weight } };
  }

  // recordRelationshipEvent — the single sanctioned way to move a stat. It only
  // dispatches the action; the subscribe handler above updates the cache. This
  // keeps stats append-only and rebuildable, unlike the removed setRelationship.
  function recordRelationshipEvent(fromId, toId, axis, delta, weight = 1) {
    const event = resolveRelationshipEvent(fromId, toId, axis, delta, weight);
    return world.dispatch(event.type, event.payload);
  }

  // setLabel — direct-set what fromId calls toId. Asymmetric and per-side, so
  // there is no auto-inverse here (unlike setFamilyTie). No log involvement.
  function setLabel(fromId, toId, fromCallsTo) {
    labels.set(edgeKey(fromId, toId), fromCallsTo);
  }

  function getRelationship(fromId, toId) {
    const cached = cachedStats.get(edgeKey(fromId, toId));
    return {
      fromId,
      toId,
      // Clone so callers can never mutate the store's cached object.
      stats: cached ? { ...cached } : { ...DEFAULT_RELATIONSHIP_STATS },
      fromCallsTo: labels.get(edgeKey(fromId, toId)) ?? '',
    };
  }

  // rebuildRelationshipStats — recompute a pair's stats from the log alone,
  // ignoring the cache. Its equality with getRelationship().stats is the
  // rebuildability proof (mirrors worldClockEngine.rebuildTotalGameSeconds).
  function rebuildRelationshipStats(fromId, toId) {
    return deriveRelationshipStats(world.getEventLog(), fromId, toId);
  }

  function getRelationshipHistory(fromId, toId) {
    return deriveRelationshipHistory(world.getEventLog(), fromId, toId);
  }

  function setFamilyTie(fromId, toId, relation) {
    familyTies.set(edgeKey(fromId, toId), { fromId, toId, relation });
    familyTies.set(edgeKey(toId, fromId), { fromId: toId, toId: fromId, relation: INVERSE_RELATION[relation] });
  }

  function getFamilyTie(fromId, toId) {
    return familyTies.get(edgeKey(fromId, toId)) ?? null;
  }

  return {
    getRelationship,
    setLabel,
    recordRelationshipEvent,
    resolveRelationshipEvent,
    rebuildRelationshipStats,
    getRelationshipHistory,
    setFamilyTie,
    getFamilyTie,
  };
}

// Tier thresholds over the average of the five stats. Provisional first pass
// only — not final game balance, adjust cutoffs here as needed. Used only as
// the fallback ladder below the divergence checks in relationshipTier. Exported
// so tests can assert the fallback against the exact same ladder it uses.
// JSON can't hold Infinity, so base_vanilla.json's last band's max is `null`,
// mapped back here.
export const TIER_THRESHOLDS = getSchema().relationships.tierThresholds
  .map((t) => ({ ...t, max: t.max ?? Infinity }));

/**
 * Relationship tier is always derived from stats, never stored. Recompute it
 * any time the stats change instead of caching a label on the edge.
 *
 * Divergence-check-first: archetype rules that read specific axes run BEFORE the
 * average fallback, so relationships whose axes pull apart get a legible label
 * instead of being flattened to a bland middle tier. A high-affection /
 * low-trust "frenemy" would otherwise average to a plain 'stranger'/
 * 'acquaintance'; here it reads as 'complicated'. This ladder is intentionally
 * extensible — add more archetype rules above the fallback average without
 * restructuring.
 */
export function relationshipTier(stats) {
  const { affection, comfort, trust, desire, obedience } = stats;
  const div = getSchema().relationships.divergence;

  if (affection >= div.complicated.affectionMin && trust <= div.complicated.trustMax) return 'complicated'; // frenemy: warm but untrusted
  if (affection <= div.resentful.affectionMax && obedience >= div.resentful.obedienceMin) return 'resentful'; // obeys without any warmth

  // Fallback: the average-based ladder for ordinary, non-divergent relationships.
  // Divided by RELATIONSHIP_AXES.length (not a standalone config number) so
  // the average can never silently drift out of sync with the actual stat
  // count if an axis is ever added or removed.
  const average = (affection + comfort + trust + desire + obedience) / RELATIONSHIP_AXES.length;
  return TIER_THRESHOLDS.find((tier) => average <= tier.max).label;
}
