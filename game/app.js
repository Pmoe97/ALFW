// game/app.js — the real game UI entry point. Bootstraps a LIVE world (the
// procedurally-generated map/POI/classification + NPC generator, PLUS the
// hand-authored Mira/Rowan/Sable trio for the conversation demo), creates every
// engine in the canonical order (map → poi → clock → faction/npc → memory →
// travel), builds the UI, and drives it off the tick source. This is the second
// esbuild entry (scripts/build.js emits dist/alfw-perchance-app.html); the old
// game/testHarness.js entry stays untouched as the engine harness.
//
// Every DOM lookup assumes app.html's #app root already exists — true locally and
// true in the Perchance bundle (the spliced markup precedes this script).

import { buildSampleWorld } from './sampleWorld.js';
import { createRelationshipEffectEngine } from '../engines/relationshipEffectEngine.js';
import { createMemoryEngine } from '../engines/memoryEngine.js';
import { createWorldMapEngine } from '../engines/worldMapEngine.js';
import { createPoiEngine } from '../engines/poiEngine.js';
import { createWorldClockEngine } from '../engines/worldClockEngine.js';
import { createFactionEngine } from '../engines/factionEngine.js';
import { createNpcGeneratorEngine, deriveScheduleState } from '../engines/npcGeneratorEngine.js';
import { createTravelEngine } from '../engines/travelEngine.js';
import { createTickSource } from './tickSource.js';
import { helpNpc, robNpc, ignoreNpc, startDialogue, endDialogue } from '../actions/playerActions.js';
import { getDialogue } from '../ai/getDialogue.js';
import { createApp } from './ui/app-state.js';

// --- World + engines --------------------------------------------------------
const { world, registry, relationships, conversationHistory, races, mira, rowan, sable } = buildSampleWorld();
createRelationshipEffectEngine(world, relationships);

const map = createWorldMapEngine(world);
const poi = createPoiEngine(world);
const clock = createWorldClockEngine(world);
const faction = createFactionEngine(world);
const npcGen = createNpcGeneratorEngine(world, registry, races);

// Memory fan-out presence: the generator's committed roster at a node, filtered
// to those whose schedule has them awake at the current game hour (the same
// schedule-aware presence the full world wires).
const presence = {
  witnessesAt: (nodeId) =>
    npcGen.rosterIdsAt(nodeId).filter(
      (id) => deriveScheduleState(registry.get(id)?.schedule, clock.getCurrentDate().hour).available
    ),
};
createMemoryEngine(world, registry, presence);

const travel = createTravelEngine(world, map, poi);
const config = world.getState().config;
const tick = createTickSource(world, config);

// Materialize the starting node's neighbors so Travel has real destinations.
map.materializeNeighbors(travel.getPlayerNodeId());

// --- BFS the explored graph so the Journal map can list known nodes ---------
function materializedNodeIds() {
  const originId = map.getOriginNode().id;
  const seen = new Set();
  const queue = [originId];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const node = map.getNode(id);
    for (const edge of node?.edges || []) if (!seen.has(edge.to)) queue.push(edge.to);
  }
  return [...seen];
}

// --- UI context -------------------------------------------------------------
const ctx = {
  world,
  config,
  player: rowan,
  npc: mira,
  merchant: sable,
  engines: { map, poi, clock, faction, npcGen, travel, relationships, conversationHistory, races, registry },
  actions: { startDialogue, endDialogue, helpNpc, robNpc, ignoreNpc },
  getDialogue,
  knownNpcIds: [mira.id, sable.id],
  materializedNodeIds,
};

const mountPoint = document.getElementById('app');
const { render } = createApp(ctx, mountPoint);

// Live clock: re-render on every tick so the HUD clock and in-transit travel
// progress advance. Full rebuild is fine at this scale; the render loop
// preserves the conversation input's focus/value across passes.
world.subscribe('CLOCK_TICK', render);

// Pause-on-blur (config-driven): freeze game-time when the tab is backgrounded
// instead of accumulating unseen, exactly as the harness does.
if (config.runtime?.pauseOnBlur) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) tick.pause();
    else tick.resume();
  });
  window.addEventListener('blur', () => tick.pause());
  window.addEventListener('focus', () => tick.resume());
}

render();
tick.start();
