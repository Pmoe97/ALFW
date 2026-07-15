// engines/reputationEngine.js — reputation as a derived view over the log.
//
// Reputation is never a stored number some engine sets. It is recomputed from
// the event log on every call, so changing the weighting formula is instantly
// reflected without touching the log. (A cached running total can come later
// for performance, but it must stay rebuildable from the log alone.)

import { log } from '../debugLog.js';
import { getSchema } from './activeSchema.js';

export function createReputationEngine(world) {
  world.subscribe('FARM_HARVESTED', (entry) => {
    log('ReputationEngine', `noted harvest by ${entry.payload.npcId} (log seq ${entry.seq})`);
  });

  function getReputation(npcId, weightPerQuality = getSchema().reputation.weightPerQuality) {
    return world
      .getEventLog()
      .filter((e) => e.type === 'FARM_HARVESTED' && e.payload.npcId === npcId)
      .reduce((total, e) => total + e.payload.quality * weightPerQuality, 0);
  }

  return { getReputation };
}
