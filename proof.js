// proof.js — runnable proof of the WorldState kernel. Zero setup:
//
//   node proof.js
//
// Proves: the single dispatch/subscribe channel works, the event log is
// append-only and immutable, derived reputation is a view over the log,
// and the whole thing is deterministic.

import assert from 'node:assert/strict';
import { initWorldState } from './worldState.js';
import { createFarmEngine } from './engines/farmEngine.js';
import { createReputationEngine } from './engines/reputationEngine.js';

const CONFIG_PATH = new URL('./worldConfig.json', import.meta.url);
const NPC = 'npc_mira';

function runWorld() {
  const world = initWorldState(CONFIG_PATH);
  createFarmEngine(world);
  const reputation = createReputationEngine(world);

  world.dispatch('FARM_HARVESTED', { npcId: NPC, cropType: 'wheat', quality: 3 });
  world.dispatch('FARM_HARVESTED', { npcId: NPC, cropType: 'pumpkin', quality: 5 });
  world.dispatch('FARM_HARVESTED', { npcId: NPC, cropType: 'turnip', quality: 2 });

  return { world, reputation };
}

// --- 1+2. Initialize from worldConfig.json, dispatch three harvests --------
console.log('=== Run 1: dispatching three FARM_HARVESTED actions ===');
const { world, reputation } = runWorld();

// --- 3. Full event log ------------------------------------------------------
console.log('\n=== Event log ===');
console.log(JSON.stringify(world.getEventLog(), null, 2));

// --- 4. Derived reputation ---------------------------------------------------
const rep = reputation.getReputation(NPC);
console.log(`\nReputation for ${NPC} (quality * 2): ${rep}`);
assert.equal(rep, (3 + 5 + 2) * 2);

// --- 5. Determinism: fresh instance, same config + actions => identical -----
console.log('\n=== Run 2: fresh instance, same config and action sequence ===');
const second = runWorld();
assert.deepEqual(second.world.getEventLog(), world.getEventLog());
assert.equal(second.reputation.getReputation(NPC), rep);
console.log('\nDeterminism check PASSED: full event logs and reputation identical');

// --- 6. Reweighting: same untouched log, new formula -------------------------
const logBefore = world.getEventLog();
const reweighted = reputation.getReputation(NPC, 3);
console.log(`\nReweighted reputation for ${NPC} (quality * 3): ${reweighted}`);
assert.equal(reweighted, (3 + 5 + 2) * 3);
assert.deepEqual(world.getEventLog(), logBefore); // log untouched by reweighting
assert.equal(reputation.getReputation(NPC), rep); // original weight still holds
console.log('Reweighting check PASSED: log unchanged, reputation is a derived view');

// --- Extra guarantees: append-only immutability, no live references ----------
const [firstEntry] = world.getState().eventLog;
assert.throws(() => {
  world.dispatch('FARM_HARVESTED', { npcId: NPC, cropType: 'x', quality: 1 }).payload.quality = 99;
}, TypeError, 'log entries must be frozen');

firstEntry.payload.quality = 999; // mutating a copy from getState()...
assert.equal(world.getEventLog()[0].payload.quality, 3); // ...never touches the world
console.log('Immutability check PASSED: entries frozen, getState() returns copies');

console.log('\nALL CHECKS PASSED');
