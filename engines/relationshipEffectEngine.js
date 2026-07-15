// engines/relationshipEffectEngine.js — deterministic relationship stat
// deltas for player actions.
//
// Subscribes to PLAYER_HELPED/PLAYER_ROBBED/PLAYER_IGNORED and adjusts the
// targetId -> actorId edge (the NPC's feelings about the player who acted on
// them) by a fixed amount per action type. Never reads a numeric value from
// the AI layer — deltas are raw, hand-authored constants.

import { getSchema } from './activeSchema.js';

// Provisional first-pass balance numbers, not final — easy to retune here
// later without touching anything else.
const ACTION_DELTAS = getSchema().relationships.actionDeltas;

export function createRelationshipEffectEngine(world, relationships) {
  function applyDelta(entry) {
    const delta = ACTION_DELTAS[entry.type];
    const { actorId, targetId } = entry.payload;
    // Stats are log-derived now: record one RELATIONSHIP_EVENT per non-zero axis
    // on the targetId -> actorId edge (the NPC's feelings about the player who
    // acted on them) rather than overwriting a stats object. Zero deltas are
    // skipped to keep the log clean; the summed result is identical. The
    // fromCallsTo label is untouched — it lives in the store's label map.
    // No clamping of stat bounds today — unbounded stat drift is a known
    // simplification for a future balance pass, not an oversight.
    for (const [axis, amount] of Object.entries(delta)) {
      if (amount !== 0) {
        relationships.recordRelationshipEvent(targetId, actorId, axis, amount);
      }
    }
  }

  for (const actionType of Object.keys(ACTION_DELTAS)) {
    world.subscribe(actionType, applyDelta);
  }

  return {};
}
