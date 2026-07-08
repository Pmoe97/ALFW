// engines/farmEngine.js — proves the subscription pattern.
//
// Engines never import or call each other; they only talk through the
// WorldState channel. This one just confirms it receives FARM_HARVESTED —
// actual farming simulation comes later.

import { log } from '../debugLog.js';

export function createFarmEngine(world) {
  world.subscribe('FARM_HARVESTED', (entry) => {
    const { npcId, cropType, quality } = entry.payload;
    log('FarmEngine', `harvest received: ${npcId} harvested ${cropType} (quality ${quality})`);
  });

  return {};
}
