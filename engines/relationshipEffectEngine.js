// engines/relationshipEffectEngine.js — deterministic relationship stat
// deltas for player actions.
//
// Subscribes to PLAYER_HELPED/PLAYER_ROBBED/PLAYER_IGNORED and adjusts the
// targetId -> actorId edge (the NPC's feelings about the player who acted on
// them) by a fixed amount per action type. Never reads a numeric value from
// the AI layer — deltas are raw, hand-authored constants.

// Provisional first-pass balance numbers, not final — easy to retune here
// later without touching anything else.
const ACTION_DELTAS = {
  PLAYER_HELPED: { affection: 5, comfort: 3, trust: 5, desire: 0, obedience: -1 },
  PLAYER_ROBBED: { affection: -15, comfort: -10, trust: -20, desire: 0, obedience: -5 },
  PLAYER_IGNORED: { affection: -1, comfort: -1, trust: 0, desire: 0, obedience: 0 },
};

export function createRelationshipEffectEngine(world, relationships) {
  function applyDelta(entry) {
    const delta = ACTION_DELTAS[entry.type];
    const { actorId, targetId } = entry.payload;
    const edge = relationships.getRelationship(targetId, actorId);
    const newStats = {
      affection: edge.stats.affection + delta.affection,
      comfort: edge.stats.comfort + delta.comfort,
      trust: edge.stats.trust + delta.trust,
      desire: edge.stats.desire + delta.desire,
      obedience: edge.stats.obedience + delta.obedience,
    };
    // No clamping of stat bounds today — unbounded stat drift is a known
    // simplification for a future balance pass, not an oversight.
    relationships.setRelationship(targetId, actorId, newStats, edge.fromCallsTo);
  }

  for (const actionType of Object.keys(ACTION_DELTAS)) {
    world.subscribe(actionType, applyDelta);
  }

  return {};
}
