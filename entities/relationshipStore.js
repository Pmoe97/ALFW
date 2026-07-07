// entities/relationshipStore.js — directed relationship edges, never entity fields.
//
// Entities know nothing about who they're connected to. Relationships live
// here as directed edges keyed by (fromId, toId), so a player<->NPC edge and
// an NPC<->NPC edge work identically. Built as a factory taking the world
// instance, matching the engine pattern in engines/, even though this store
// doesn't dispatch or subscribe to anything yet — that keeps the shape
// consistent for when it does.

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
 * @typedef {Object} FamilyTie
 * @property {string} fromId
 * @property {string} toId
 * @property {'parent'|'child'|'sibling'|'spouse'|'other'} relation
 */

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

export function createRelationshipStore(world) {
  const relationships = new Map();
  const familyTies = new Map();

  function setRelationship(fromId, toId, stats, fromCallsTo) {
    relationships.set(edgeKey(fromId, toId), {
      fromId,
      toId,
      stats: { ...stats },
      fromCallsTo,
    });
  }

  function getRelationship(fromId, toId) {
    return (
      relationships.get(edgeKey(fromId, toId)) ?? {
        fromId,
        toId,
        stats: { ...DEFAULT_RELATIONSHIP_STATS },
        fromCallsTo: '',
      }
    );
  }

  function setFamilyTie(fromId, toId, relation) {
    familyTies.set(edgeKey(fromId, toId), { fromId, toId, relation });
  }

  function getFamilyTie(fromId, toId) {
    return familyTies.get(edgeKey(fromId, toId)) ?? null;
  }

  return { setRelationship, getRelationship, setFamilyTie, getFamilyTie };
}

// Tier thresholds over the average of the five stats. Provisional first pass
// only — not final game balance, adjust cutoffs here as needed.
const TIER_THRESHOLDS = [
  { max: -10, label: 'hostile' },
  { max: 10, label: 'stranger' },
  { max: 30, label: 'acquaintance' },
  { max: 60, label: 'friend' },
  { max: Infinity, label: 'trusted' },
];

/**
 * Relationship tier is always derived from stats, never stored. Recompute
 * it any time the stats change instead of caching a label on the edge.
 */
export function relationshipTier(stats) {
  const { affection, comfort, trust, desire, obedience } = stats;
  const average = (affection + comfort + trust + desire + obedience) / 5;
  return TIER_THRESHOLDS.find((tier) => average <= tier.max).label;
}
