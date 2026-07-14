// game/liveGame.js — build a LIVE, playable game (world + every engine + the UI
// `ctx`), extracted verbatim from the old game/app.js top-level so it can be
// constructed on demand — when the player picks New Game or Continue from the
// Main Menu — instead of unconditionally at page load. The shell (game/shell.js)
// owns WHEN this runs; this module owns WHAT a running game is made of.
//
// Returns everything the shell needs to mount and drive the game: the world (for
// the CLOCK_TICK re-render subscription), the config (pause-on-blur), the fully
// assembled `ctx` (handed to createApp), and the tick source. No DOM here — the
// shell mounts. Passing `{ save }` through to buildSampleWorld loads a saved run
// (Continue); omitting it builds the fresh sample world (New Game, until the
// creation wizard replaces the sample player in a later stage).

import { buildSampleWorld } from './sampleWorld.js';
import { createRelationshipEffectEngine } from '../engines/relationshipEffectEngine.js';
import { createMemoryEngine } from '../engines/memoryEngine.js';
import { createWorldMapEngine } from '../engines/worldMapEngine.js';
import { createPoiEngine } from '../engines/poiEngine.js';
import { createWorldClockEngine } from '../engines/worldClockEngine.js';
import { createFactionEngine } from '../engines/factionEngine.js';
import { createNpcGeneratorEngine, deriveScheduleState } from '../engines/npcGeneratorEngine.js';
import { createTravelEngine } from '../engines/travelEngine.js';
import { createEconomyEngine } from '../engines/economyEngine.js';
import { createCombatEngine } from '../engines/combatEngine.js';
import { createQuestEngine } from '../engines/questEngine.js';
import { createTickSource } from './tickSource.js';
import { helpNpc, robNpc, ignoreNpc, startDialogue, endDialogue } from '../actions/playerActions.js';
import { getDialogue } from '../ai/getDialogue.js';

// buildLiveGame({ save }) — construct a runnable game. The engine construction
// order is canonical and load-bearing (map → poi → clock → faction/npc → memory →
// economy → combat → travel → quests); see the inline notes carried over from the
// original app.js.
export function buildLiveGame({ save, config: presetConfig } = {}) {
  const { world, registry, relationships, conversationHistory, races, mira, rowan, sable } = buildSampleWorld({ save, config: presetConfig });
  createRelationshipEffectEngine(world, relationships);

  const map = createWorldMapEngine(world);
  const poi = createPoiEngine(world);
  const clock = createWorldClockEngine(world);
  const faction = createFactionEngine(world);
  const npcGen = createNpcGeneratorEngine(world, registry, races);

  // Memory fan-out presence: the generator's committed roster at a node, filtered
  // to those whose schedule has them awake at the current game hour.
  const presence = {
    witnessesAt: (nodeId) =>
      npcGen.rosterIdsAt(nodeId).filter(
        (id) => deriveScheduleState(registry.get(id)?.schedule, clock.getCurrentDate().hour).available
      ),
  };
  createMemoryEngine(world, registry, presence);

  // Economy and combat are constructed BEFORE travel: travel takes the combat
  // engine as an optional collaborator, and combat takes economy.
  const economy = createEconomyEngine(world, registry);
  const combat = createCombatEngine(world, {
    playerId: rowan.id, registry, map, economy, relationships, faction,
  });
  // Late-bound: economy needs a live combat reference to refuse trade/craft/
  // equip/drop while a fight is open, but economy is constructed before combat.
  economy.setCombatEngine(combat);
  const travel = createTravelEngine(world, map, poi, combat);
  // The quest engine dispatches through the engines above, so it is constructed
  // last, with all of them live.
  const quests = createQuestEngine(world, {
    playerId: rowan.id, economy, relationships, faction, poi, travel, combat,
  });
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

  // The Trading screen trades with Sable's authored shop (the Rusted Ledger).
  const merchantShopRef = { kind: 'authored', shopId: 'shop_rusted_ledger' };

  const ctx = {
    world,
    config,
    player: rowan,
    npc: mira,
    merchant: sable,
    merchantShopRef,
    engines: { map, poi, clock, faction, npcGen, travel, relationships, conversationHistory, races, registry, economy, combat, quests },
    actions: {
      startDialogue,
      endDialogue,
      helpNpc,
      robNpc,
      ignoreNpc,
      equipItem: (slot, instanceId) => economy.equip(rowan.id, slot, instanceId),
      dropItem: (items) => economy.drop(rowan.id, items),
      confirmTrade: (offer) => economy.trade(rowan.id, merchantShopRef, offer),
      craftRecipe: (stationId, recipeId) => economy.craft(rowan.id, stationId, recipeId),
      acceptQuest: (questId) => quests.acceptQuest(questId),
      turnInQuest: (questId) => quests.completeQuest(questId),
      abandonQuest: (questId) => quests.abandonQuest(questId),
      combatAct: (action) => combat.act(action),
      consumeItem: (defId) => combat.consumeItem(rowan.id, defId),
    },
    getDialogue,
    knownNpcIds: [mira.id, sable.id],
    materializedNodeIds,
  };

  return { world, config, ctx, tick };
}
