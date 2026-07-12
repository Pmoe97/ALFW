// engines/questData.js — shipped quest/contract content: the hand-authored
// quest definitions the guild board (Journal Log tab) offers. Static frozen
// data plus pure lookups; no world dependency, no dispatch, no randomness.
//
// This lives in CODE, not WorldConfig, on the economyData precedent: saves
// embed their config verbatim, so a growing quest catalog in config would
// bloat every save and turn every content addition into a config-drift
// warning. Replay safety doesn't need it there anyway — every committed quest
// event carries its resolved facts (QUEST_COMPLETED embeds the reward block it
// paid out), so historical folds never re-read these tables and retuning a
// reward can never rewrite history.
//
// A def references the world THREE ways, all deliberately:
//  - authored entity ids ('npc_mira', 'npc_sable') — the sample-world trio;
//  - fixed-seed node ids ('node_-5.000_0.000' is the origin under the shipped
//    rngSeed 12345) — hand-authored content pinned to the shipped world,
//    exactly like the Rusted Ledger; proof.js Section QU closure-checks every
//    one of these against the real generated map so a seed/config change
//    fails the proof loudly instead of silently orphaning a quest;
//  - generated settlement ids ('settlement_1_-1', the nearest real village)
//    for faction consequences — also closure-checked.
//
// Objective types are a discriminated union on `type`. v1 ships the five
// types below (each mapping to an event/derivation that already exists);
// adding a type later = one new matcher case in questEngine, nothing here
// restructures. Combat objectives and procedural generation are explicitly
// out of scope.

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// The five shipped objective types. Exported so the engine's matcher table
// and the proof's closure check assert against the same list.
export const OBJECTIVE_TYPES = Object.freeze([
  'discoverPoi',        // a POI_DISCOVERED for poiId after acceptance
  'travelTo',           // a TRAVEL_ARRIVED at nodeId after acceptance
  'craftRecipe',        // >= count CRAFT_COMPLETED of recipeId by the player after acceptance
  'deliverItems',       // player holds stacks (consumed at turn-in via ITEMS_TRANSFERRED)
  'reachRelationshipTier', // npcId's derived tier toward the player reaches tier
]);

// The origin node of the shipped world (rngSeed 12345) — where Rowan starts
// and where the Mira/Sable demo trio lives. Every shipped quest is given (and
// turned in) here; Section QU asserts this id IS the generated origin.
const ORIGIN_NODE_ID = 'node_-5.000_0.000';

// Quest definitions, keyed by id. Shape:
//   { id, title, description, giverId, giverNodeId,
//     objectives: [{ id, text, type, ...per-type fields }],
//     onAccept?: { injectPois?: [{nodeId, poi}], revealPoiIds?: [ids] },
//     rewards?: { gold?, items?: {stacks}, relationshipEvents?: [{fromId,toId,axis,delta}],
//                 factionControl?: [{settlementId, factionId}] } }
// Rewards name only mechanisms that already exist — economy grantGold /
// grantItems, relationshipStore recordRelationshipEvent, factionEngine
// setFactionControl — the quest engine dispatches through those real systems,
// never a parallel reward event type.
export const QUEST_DEFS = deepFreeze({
  quest_clear_camp: {
    id: 'quest_clear_camp',
    title: 'The Wolfpine Camp',
    description:
      'Sable keeps hearing the same story at her tables: a camp in the hills east of here, ' +
      'shaking down anyone bound for the village markets. Find it and confirm the rumor. ' +
      'She marked your map with everything her patrons let slip.',
    giverId: 'npc_sable',
    giverNodeId: ORIGIN_NODE_ID,
    objectives: [
      {
        id: 'find_camp',
        type: 'discoverPoi',
        text: 'Seek out the camp in the eastern hills',
        poiId: 'poi_q_wolfpine_camp',
      },
    ],
    // Accepting injects the camp as a hidden POI on the hills neighbor east of
    // the origin and grants reveal authority for it — the travel screen's
    // "Seek out" lead (exploreDirected) is what surfaces it. This is the POI
    // engine's injectPoi/grantRevealAuthority pair getting its first real,
    // non-debug caller.
    onAccept: {
      injectPois: [
        {
          nodeId: 'node_6.285_-1.357',
          poi: { id: 'poi_q_wolfpine_camp', category: 'camp', prominence: 0.6, hidden: true, data: {} },
        },
      ],
      revealPoiIds: ['poi_q_wolfpine_camp'],
    },
    rewards: {
      gold: 60,
      relationshipEvents: [{ fromId: 'npc_sable', toId: 'player_rowan', axis: 'trust', delta: 8 }],
      // Confirming the camp lets the village's militia clear the road: control
      // of the nearest real settlement shifts. settlementId/factionId are the
      // generated world's own ids (closure-checked in Section QU).
      factionControl: [{ settlementId: 'settlement_1_-1', factionId: 'faction_2' }],
    },
  },

  quest_bread_run: {
    id: 'quest_bread_run',
    title: 'Bread for the Broken Wheel',
    description:
      "Mira's cellar came up short and the evening crowd won't feed itself. " +
      'Bring her two loaves of bread and she will settle up fair.',
    giverId: 'npc_mira',
    giverNodeId: ORIGIN_NODE_ID,
    objectives: [
      {
        id: 'bring_bread',
        type: 'deliverItems',
        text: 'Deliver 2 Bread Loaves to Mira',
        npcId: 'npc_mira',
        stacks: { bread: 2 },
      },
    ],
    rewards: {
      gold: 20,
      relationshipEvents: [
        { fromId: 'npc_mira', toId: 'player_rowan', axis: 'affection', delta: 6 },
        { fromId: 'npc_mira', toId: 'player_rowan', axis: 'comfort', delta: 4 },
      ],
    },
  },

  quest_salves: {
    id: 'quest_salves',
    title: 'Salves for the Road',
    description:
      'Mira patches up more split knuckles than any healer in the valley. ' +
      'Brew a healing salve at the alchemy bench to prove you know the recipe, ' +
      'and she will kit you out with vials for the road.',
    giverId: 'npc_mira',
    giverNodeId: ORIGIN_NODE_ID,
    objectives: [
      {
        id: 'brew_salve',
        type: 'craftRecipe',
        text: 'Brew a Healing Salve (alchemy)',
        recipeId: 'al1',
        count: 1,
      },
    ],
    rewards: {
      gold: 25,
      items: { stacks: { glass_vial: 2 } },
    },
  },

  quest_make_yourself_known: {
    id: 'quest_make_yourself_known',
    title: 'Make Yourself Known',
    description:
      "Sable bets on people, and she doesn't bet on strangers. Walk the north woods so you " +
      'know the ground, and get the Broken Wheel\'s keeper to call you a friend — then ' +
      "she'll have real work for you.",
    giverId: 'npc_sable',
    giverNodeId: ORIGIN_NODE_ID,
    objectives: [
      {
        id: 'walk_north_woods',
        type: 'travelTo',
        text: 'Travel to the north woods',
        nodeId: 'node_3.353_8.010',
      },
      {
        id: 'befriend_mira',
        type: 'reachRelationshipTier',
        text: 'Earn friendship with Mira',
        npcId: 'npc_mira',
        tier: 'friend',
      },
    ],
    rewards: {
      gold: 40,
      relationshipEvents: [{ fromId: 'npc_sable', toId: 'player_rowan', axis: 'trust', delta: 5 }],
    },
  },
});

export function getQuestDef(questId) {
  const def = QUEST_DEFS[questId];
  if (!def) throw new Error(`Unknown quest definition "${questId}"`);
  return def;
}

// Quest ids in a stable order (sorted) so the guild board list and any
// iteration are independent of declaration order.
export function questIds() {
  return Object.keys(QUEST_DEFS).sort();
}
