// proof.js — runnable proof of the WorldState kernel. Zero setup:
//
//   node proof.js
//
// Proves: the single dispatch/subscribe channel works, the event log is
// append-only and immutable, derived reputation is a view over the log,
// and the whole thing is deterministic. Then the AI voice layer: prompt
// assembly, queue-manager scheduling, stubbed transport plumbing, and the
// fallback + response contract (real AI only exists in a Perchance page).

import assert from 'node:assert/strict';
import { initWorldState, createWorldState } from './worldState.js';
import { createFarmEngine } from './engines/farmEngine.js';
import { createReputationEngine } from './engines/reputationEngine.js';
import { createPlayer, createNpc, effectiveSkill, PRIMARY_SKILL_ATTRIBUTE } from './entities/entitySchema.js';
import {
  createRelationshipStore,
  relationshipTier,
  deriveRelationshipStats,
  deriveRelationshipHistory,
  TIER_THRESHOLDS,
} from './entities/relationshipStore.js';
import {
  createConversationHistoryStore,
  deriveConversationHistory,
  getRecentHistory,
  RECENT_EXCHANGES_WINDOW,
} from './entities/conversationHistoryStore.js';
import { validateDialogueResponse } from './ai/responseContract.js';
import { buildDialoguePrompt } from './ai/buildDialoguePrompt.js';
import { fallbackDialogue } from './ai/fallbackDialogue.js';
import { createQueueManager } from './ai/queueManager.js';
import { getDialogue } from './ai/getDialogue.js';
import { buildSampleWorld } from './game/sampleWorld.js';
import { serializeWorld, parseSave, diffConfigKeys } from './game/saveLoad.js';
import { createRelationshipEffectEngine } from './engines/relationshipEffectEngine.js';
import { createMemoryEngine, deriveEntityMemories } from './engines/memoryEngine.js';
import { helpNpc, robNpc, ignoreNpc, startDialogue, endDialogue } from './actions/playerActions.js';
import { createTravelEngine, deriveTravelIncident } from './engines/travelEngine.js';
import { fallbackTravelNarration } from './ai/fallbackTravelNarration.js';
import {
  createWorldClockEngine,
  deriveCalendarDate,
  deriveActiveTimeContext,
  deriveTotalGameSeconds,
  deriveTimeOfDayBucket,
  TIME_OF_DAY_BUCKETS,
} from './engines/worldClockEngine.js';
import { createTickSource } from './game/tickSource.js';
import {
  createWorldMapEngine,
  deriveTerrainAt,
  generateNeighborCandidates,
  computeHeading,
  deriveNodeAt,
  nodeIdFor,
  deriveClassificationAt,
  deriveHospitability,
  deriveNotability,
  deriveBaselineFactionControl,
  deriveSettlementSiteInCell,
  isSettlementSiteAccepted,
  settlementSpacingOf,
  maxSettlementSpacing,
  settlementSearchCellRadius,
} from './engines/worldMapEngine.js';
import { createFactionEngine, deriveFactionControl } from './engines/factionEngine.js';
import {
  createPoiEngine,
  deriveBaselinePois,
  deriveInjectedPois,
  deriveBlindAttemptCount,
} from './engines/poiEngine.js';
import { createEntityRegistry } from './entities/entityRegistry.js';
import {
  createRaceRegistry,
  deriveRaceRegistry,
  PERSONALITY_AXES,
} from './entities/raceRegistry.js';
import {
  createNpcGeneratorEngine,
  deriveNpcRoster,
  deriveNodePopulation,
  derivePopulationSize,
  deriveScheduleState,
  deriveSchedulePattern,
  NODE_POPULATED,
  VOCATION_WORKPLACE_CATEGORY,
  NOCTURNAL_VOCATIONS,
  VOCATIONS_SETTLEMENT,
  VOCATIONS_WILDERNESS,
} from './engines/npcGeneratorEngine.js';
import { deriveVoiceDirectives, CONFLICTING_PAIRS, AXIS_DIRECTIVES, MAX_DIRECTIVES } from './entities/voice.js';
import { deriveEmotion } from './entities/deriveEmotion.js';
import {
  createEconomyEngine,
  deriveInventory,
  deriveGold,
  deriveBaselineStock,
  deriveShopStock,
  deriveEquipped,
  priceFor,
  shopIdOf,
} from './engines/economyEngine.js';
import {
  ITEM_DEFS,
  RECIPES,
  SHOP_POOLS,
  AUTHORED_SHOPS,
  EQUIP_SLOTS,
  getItemDef,
} from './engines/economyData.js';
import {
  createQuestEngine,
  deriveQuestStatuses,
  deriveObjectiveProgress,
} from './engines/questEngine.js';
import { QUEST_DEFS, getQuestDef, questIds, OBJECTIVE_TYPES } from './engines/questData.js';
import {
  createCombatEngine,
  deriveMaxHp,
  deriveCombatCount,
  deriveEncounter,
  deriveActiveCombat,
  deriveVitalsMap,
  deriveCombatHistory,
} from './engines/combatEngine.js';
import {
  ARCHETYPES,
  ENCOUNTER_TEMPLATES,
  INCIDENT_ENCOUNTERS,
  getArchetype,
  getEncounterTemplate,
} from './engines/combatData.js';
import { INVENTORY_CATEGORIES, CRAFT_STATIONS } from './game/ui/model.js';
import { log, setChannelEnabled, isChannelEnabled } from './debugLog.js';

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

// --- 7. Entity schema: hand-authored NPC and Player -------------------------
console.log('\n=== Entity schema: hand-authored NPC and Player ===');

const mira = createNpc({
  id: NPC, // reuse npc_mira — she's the tavern keeper who also works the fields
  identity: {
    firstName: 'Mira',
    lastName: 'Thistledown',
    age: 34,
    birthday: '1024-04-12',
    gender: 'female',
    sexualOrientation: 'bisexual',
    race: 'human',
    ethnicity: 'Vale Country',
    vocation: 'tavern keeper',
    relationshipStatus: 'widowed',
    livingSituation: 'lives above the tavern she owns',
    background: 'Inherited the Broken Wheel tavern from her late husband and has run it alone for six years.',
    biography: 'Mira grew up in Aldervale, married young, and buried her husband after a bad winter. She kept the tavern running out of stubbornness as much as necessity, and has since made it the social center of the village.',
  },
  appearance: {
    heightBuild: 'average height, sturdy build from years of hauling kegs',
    hair: { color: 'auburn', style: 'braided', length: 'shoulder-length', texture: 'wavy' },
    eyes: { color: 'hazel', shape: 'almond' },
    face: { shape: 'oval', nose: 'straight', lips: 'full', jawline: 'soft', facialHair: 'none' },
    skin: { tone: 'olive', texture: 'weathered, faint laugh lines' },
    body: { shape: 'hourglass', chest: 'full', butt: 'round', legs: 'muscular' },
    distinguishingFeatures: ['a thin scar above her left eyebrow', 'ink-stained fingertips from keeping the ledger'],
    intimate: [{ genitalType: 'vulva', shapeSize: 'average', extraDetails: 'a small birthmark on her inner thigh' }],
  },
  psychology: {
    personalityTraits: ['warm', 'shrewd', 'quick-tempered when crossed'],
    personalityAxes: { extraversion: 7, agreeableness: 6, conscientiousness: 8 },
    factionAlignmentAxes: { crownLoyalty: -2, guildSympathy: 5 },
    hobbies: ['brewing', 'card games', 'gossip'],
    likes: ['a full tavern', 'fair trade', 'quiet mornings'],
    dislikes: ['cheats', 'watered-down ale', 'debt left unpaid'],
    voice: {
      accent: 'Vale Country drawl',
      directives: [
        'Talk like a barkeep who has heard every excuse — blunt and plainspoken.',
        'Stay warm underneath, even when your patience is running short.',
        'Keep it short and get to what someone actually needs.',
      ],
      phrases: ['reckon', 'no trouble at all', 'mind yourself', 'settle up', 'there now'],
    },
    memories: [], // filled in below once the referenced event has a seq
    flags: { personality: ['stubborn'], condition: [], aiDirectives: [] },
  },
  capabilities: {
    attributes: { strength: 12, agility: 10, toughness: 13, charisma: 15, intelligence: 11, insight: 12 },
    skills: {
      primary: {
        athletics: 3, acrobatics: 1, sleightOfHand: 2, stealth: 2, fortitude: 5,
        willpower: 6, deception: 4, intimidation: 3, performance: 5, persuasion: 6,
        magic: 0, investigation: 2, religion: 3, history: 4, perception: 5,
        survival: 3, medicine: 2,
        smithing: 1, alchemy: 3, enchanting: 0,
      },
      secondary: {
        riding: 1, dancing: 2, swimming: 1, cleaning: 6, disguise: 1,
        hands: 4, mouth: 3, breasts: 2, vagina: 2, anus: 1,
      },
    },
  },
  inventory: [],
  schedule: [
    { timeOfDay: 'morning', locationId: 'tavern_broken_wheel', activity: 'restocking the cellar' },
    { timeOfDay: 'evening', locationId: 'tavern_broken_wheel', activity: 'tending the bar' },
    { timeOfDay: 'night', locationId: 'tavern_broken_wheel_upstairs', activity: 'sleeping' },
  ],
});

const rowan = createPlayer({
  id: 'player_rowan',
  identity: {
    firstName: 'Rowan',
    lastName: 'Ashvale',
    age: 27,
    birthday: '1024-09-03',
    gender: 'male',
    sexualOrientation: 'heterosexual',
    race: 'human',
    ethnicity: 'Northmarch',
    vocation: 'wandering adventurer',
    relationshipStatus: 'single',
    livingSituation: 'travels, no fixed address',
    background: 'Left the family farm at seventeen to see the world and never quite stopped moving.',
    biography: 'Rowan has spent the last decade taking odd jobs across the region — guiding caravans, clearing pests, running messages — never staying anywhere long enough to put down roots.',
  },
  appearance: {
    heightBuild: 'tall, lean build',
    hair: { color: 'dark brown', style: 'short', length: 'cropped', texture: 'straight' },
    eyes: { color: 'grey', shape: 'hooded' },
    face: { shape: 'angular', nose: 'aquiline', lips: 'thin', jawline: 'sharp', facialHair: 'light stubble' },
    skin: { tone: 'fair, sun-weathered', texture: 'calloused hands' },
    body: { shape: 'athletic', chest: 'lean', butt: 'flat', legs: 'long' },
    distinguishingFeatures: ['a burn scar on his left forearm', 'a chipped front tooth'],
    intimate: [{ genitalType: 'penis', shapeSize: 'average', extraDetails: 'circumcised' }],
  },
  psychology: {
    personalityTraits: ['curious', 'guarded', 'dryly humorous'],
    personalityAxes: { extraversion: 4, agreeableness: 5, conscientiousness: 6 },
    factionAlignmentAxes: { crownLoyalty: 0, guildSympathy: 2 },
    hobbies: ['whittling', 'map-reading'],
    likes: ['a good story', 'clear directions', 'strong coffee'],
    dislikes: ['crowds', 'being lied to'],
    voice: {
      accent: 'Northmarch',
      directives: [
        'Say little; keep replies terse and understated.',
        'Lean dry and wry rather than warm.',
      ],
      phrases: ['fair enough', "won't lie", 'no matter', 'obliged', 'long as it keeps'],
    },
    memories: [],
    flags: { personality: ['wary of strangers'], condition: [], aiDirectives: [] },
  },
  capabilities: {
    attributes: { strength: 11, agility: 13, toughness: 12, charisma: 9, intelligence: 12, insight: 11 },
    skills: {
      primary: {
        athletics: 5, acrobatics: 4, sleightOfHand: 3, stealth: 6, fortitude: 4,
        willpower: 3, deception: 2, intimidation: 2, performance: 1, persuasion: 2,
        magic: 0, investigation: 4, religion: 1, history: 2, perception: 5,
        survival: 6, medicine: 2,
        smithing: 2, alchemy: 1, enchanting: 0,
      },
      secondary: {
        riding: 5, dancing: 1, swimming: 3, cleaning: 2, disguise: 2,
        hands: 3, mouth: 2, breasts: 0, vagina: 0, anus: 0,
      },
    },
  },
  inventory: [],
});

console.log(`NPC: ${mira.identity.firstName} ${mira.identity.lastName}, age ${mira.identity.age}, ${mira.identity.vocation}`);
console.log(`Player: ${rowan.identity.firstName} ${rowan.identity.lastName}, age ${rowan.identity.age}, ${rowan.identity.vocation}`);

// --- 8. Memory pointing at a real event-log entry ----------------------------
const harvestEntry = world.dispatch('FARM_HARVESTED', { npcId: NPC, cropType: 'barley', quality: 4 });
mira.psychology.memories.push({
  seq: harvestEntry.seq,
  summary: `Brought in a fine batch of ${harvestEntry.payload.cropType} this season.`,
});
console.log(`\nMira's memory: "${mira.psychology.memories[0].summary}" (points at event log seq ${mira.psychology.memories[0].seq})`);
assert.equal(world.getEventLog()[mira.psychology.memories[0].seq].type, 'FARM_HARVESTED');
console.log('Memory check PASSED: memory seq resolves to a real FARM_HARVESTED entry in the log');

// --- 9. effectiveSkill: raw + floor(attribute / 2) ---------------------------
// Mira's raw persuasion is 6, her charisma is 15: 6 + floor(15 / 2) = 6 + 7 = 13.
const miraPersuasion = effectiveSkill(mira, 'persuasion');
console.log(`\nMira's effective persuasion: ${miraPersuasion} (raw 6 + floor(charisma 15 / 2) = 6 + 7)`);
assert.equal(miraPersuasion, 6 + Math.floor(15 / 2));
console.log('effectiveSkill check PASSED: matches hand-computed raw + floor(attribute / 2)');

// --- 10. Relationship edges are directional and independent per side --------
const relationships = createRelationshipStore(world);

// Stats are log-derived: seed an edge by direct-setting its (asymmetric) label
// and dispatching one RELATIONSHIP_EVENT per non-zero starting stat.
function seedEdge(store, fromId, toId, stats, label) {
  store.setLabel(fromId, toId, label);
  for (const [axis, delta] of Object.entries(stats)) {
    if (delta !== 0) store.recordRelationshipEvent(fromId, toId, axis, delta);
  }
}

seedEdge(relationships, rowan.id, mira.id, { affection: 25, comfort: 20, trust: 15, desire: 10, obedience: 5 }, 'Mira');
seedEdge(relationships, mira.id, rowan.id, { affection: 30, comfort: 25, trust: 20, desire: 10, obedience: 2 }, 'traveler');

const playerToNpc = relationships.getRelationship(rowan.id, mira.id);
const npcToPlayer = relationships.getRelationship(mira.id, rowan.id);
console.log(`\nplayer->npc edge: ${JSON.stringify(playerToNpc)}`);
console.log(`npc->player edge: ${JSON.stringify(npcToPlayer)}`);
assert.notEqual(playerToNpc.fromCallsTo, npcToPlayer.fromCallsTo);
console.log(`Directionality check PASSED: Rowan calls her "${playerToNpc.fromCallsTo}", Mira calls him "${npcToPlayer.fromCallsTo}"`);

// --- 11. relationshipTier is derived, never stored ---------------------------
const tierBefore = relationshipTier(playerToNpc.stats);
console.log(`\nplayer->npc tier before: ${tierBefore} (avg of stats = ${(25 + 20 + 15 + 10 + 5) / 5})`);

// Raise trust from 15 to 100 via a single derived event (+85), not an overwrite.
relationships.recordRelationshipEvent(rowan.id, mira.id, 'trust', 85);
const updatedEdge = relationships.getRelationship(rowan.id, mira.id);
const tierAfter = relationshipTier(updatedEdge.stats);
console.log(`player->npc tier after raising trust to 100: ${tierAfter} (avg of stats = ${(25 + 20 + 100 + 10 + 5) / 5})`);
assert.notEqual(tierBefore, tierAfter);
console.log('relationshipTier check PASSED: tier changes when stats change, proving it is computed, not stored');

// --- 12. Entities carry no relationship data of their own --------------------
const forbiddenKeys = ['relationships', 'socialTree', 'relationship', 'edges'];
for (const entity of [mira, rowan]) {
  const ownKeys = Object.keys(entity);
  for (const forbidden of forbiddenKeys) {
    assert.equal(ownKeys.includes(forbidden), false, `${entity.id} must not carry a "${forbidden}" field`);
  }
}
console.log('\nEntity-purity check PASSED: neither entity carries relationship data of its own');

// --- 13. setFamilyTie writes both directions automatically -------------------
relationships.setFamilyTie(mira.id, 'npc_mira_mother', 'child'); // Mira is her mother's child
const childSide = relationships.getFamilyTie(mira.id, 'npc_mira_mother');
const parentSide = relationships.getFamilyTie('npc_mira_mother', mira.id); // never set directly
console.log(`\nfamily tie set once as ${mira.id}->npc_mira_mother = "${childSide.relation}"`);
console.log(`reverse edge npc_mira_mother->${mira.id} auto-populated as "${parentSide.relation}"`);
assert.equal(childSide.relation, 'child');
assert.equal(parentSide.relation, 'parent');
console.log('Auto-inverse check PASSED: the reverse family tie is queryable without a second setFamilyTie() call');

// =============================================================================
// AI voice layer + queue manager (ai/). Everything below is deterministic or
// synthetic — the real generateText plugin only exists inside a live
// Perchance page and can never be exercised from Node. Synthetic delays are
// tens of milliseconds; total added runtime stays under ~2 seconds.
// =============================================================================

// Any unhandled rejection anywhere below is a hard failure — the queue
// manager's core promise is that absorbed late settlements never produce one.
const unhandledRejections = [];
process.on('unhandledRejection', (err) => unhandledRejections.push(err));

// --- Section A: prompt assembly (strict) -------------------------------------
console.log('\n=== Section A: prompt assembly ===');

mira.psychology.flags.aiDirectives.push('Never reveal the size of the tavern strongbox.');
const miraToRowanEdge = relationships.getRelationship(mira.id, rowan.id);
const samplePlayerLine = 'Evening, Mira. Any rooms free tonight?';

const prompt = buildDialoguePrompt(mira, miraToRowanEdge, mira.psychology.memories, samplePlayerLine);
console.log(prompt);

assert.ok(prompt.includes('Mira Thistledown'), 'prompt must contain the identity name');
assert.ok(prompt.includes(relationshipTier(miraToRowanEdge.stats)), 'prompt must contain the derived tier label');
assert.ok(prompt.includes('"traveler"'), 'prompt must contain fromCallsTo from the npc->player edge');
assert.ok(prompt.includes('Never reveal the size of the tavern strongbox.'), 'prompt must contain the aiDirective verbatim');
assert.ok(prompt.includes(mira.psychology.memories[0].summary), 'prompt must contain the memory summary');
assert.ok(prompt.includes('Return ONLY valid JSON matching this exact shape'), 'prompt must contain the JSON-only instruction');

// Voice — the PERMANENT directive section, rendered at imperative (flag-level)
// prominence, NOT as soft descriptive flavor. Each directive is an ALWAYS line.
assert.ok(prompt.includes('== Voice (speak this way) =='), 'prompt must carry the permanent Voice directive section');
for (const directive of mira.psychology.voice.directives) {
  assert.ok(prompt.includes(`- ALWAYS: ${directive}`), 'each voice directive must render as an imperative ALWAYS line');
}
// Emotion — the TRANSIENT per-turn read, a SEPARATE section from Voice (the two
// must never be merged into one block). Built without a log here, so it shows
// the calm baseline; the dedicated emotion section below proves real reads.
assert.ok(prompt.includes('== Current emotional state =='), 'prompt must carry a distinct transient emotion section');
assert.ok(
  prompt.indexOf('== Voice (speak this way) ==') < prompt.indexOf('== Current emotional state =='),
  'the permanent voice section and the transient emotion section must be distinct and separately placed'
);

// Determinism: byte-identical on a second build with the same inputs.
const promptAgain = buildDialoguePrompt(mira, miraToRowanEdge, mira.psychology.memories, samplePlayerLine);
assert.equal(prompt, promptAgain);
console.log('\nSection A PASSED: all required parts present, permanent Voice + transient Emotion are distinct sections, assembly deterministic');

// --- Section B: queue manager correctness (synthetic, no real AI) ------------
console.log('\n=== Section B: queue manager correctness ===');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const qm = createQueueManager(); // text: maxConcurrent 9, backgroundCap ceil(9/3) = 3

// B1: saturate background past its cap — active background never exceeds 3.
const bgDeferreds = [];
const bgPromises = [];
for (let i = 0; i < 6; i++) {
  const d = deferred();
  bgDeferreds.push(d);
  bgPromises.push(qm.enqueue({ type: 'text', category: 'background', run: () => d.promise }));
  assert.ok(qm.getCounts('text').activeBackground <= 3, 'background must never exceed its hard cap');
}
assert.equal(qm.getCounts('text').activeBackground, 3);
assert.equal(qm.getCounts('text').pendingBackground, 3);
console.log('B1 PASSED: background active count capped at 3 with 6 enqueued');

// B2: with background saturated at its cap, a foreground request for the same
// type is admitted immediately — it never waits on background.
const fgDeferred = deferred();
const fgPromise = qm.enqueue({ type: 'text', category: 'foreground', run: () => fgDeferred.promise });
assert.equal(qm.getCounts('text').activeForeground, 1, 'foreground must be admitted immediately past a saturated background cap');
console.log('B2 PASSED: foreground admitted immediately while background is saturated');

// B3: while the cap is saturated, enqueue background requests with different
// priorities; freeing one slot must admit the highest-priority pending one.
const startedOrder = [];
function trackedBackground(tag, priority) {
  const d = deferred();
  const promise = qm.enqueue({
    type: 'text',
    category: 'background',
    priority,
    run: () => { startedOrder.push(tag); return d.promise; },
  });
  return { d, promise };
}
const lowPriority = trackedBackground('low', 1);
const highPriority = trackedBackground('high', 5);
const midPriority = trackedBackground('mid', 3);
assert.equal(startedOrder.length, 0, 'none of the tracked requests may start while the cap is saturated');

bgDeferreds[0].resolve('freed');
await bgPromises[0]; // by now the freed slot has been re-drained
assert.deepEqual(startedOrder, ['high'], 'the highest-priority pending background request must be admitted next');
console.log('B3 PASSED: freed slot went to the highest-priority pending request');

// Drain everything from B1-B3 so later checks start from an idle queue.
for (const d of [...bgDeferreds.slice(1), lowPriority.d, highPriority.d, midPriority.d, fgDeferred]) d.resolve('done');
await Promise.all([...bgPromises, lowPriority.promise, highPriority.promise, midPriority.promise, fgPromise]);
assert.deepEqual(qm.getCounts('text'), { activeForeground: 0, activeBackground: 0, pendingForeground: 0, pendingBackground: 0 });

// B4: timeout + fallbackValue. Representative of a cheap formulaic background
// call — e.g. a future relationship-delta scorer that should fall back to a
// neutral default like [1,1,1,1,1] rather than block on a slow response.
// (That scorer does not exist; this proves the mechanism, not the feature.)
const timeoutStart = Date.now();
const slowResolving = new Promise((res) => setTimeout(() => res('late-real-value'), 300));
const timedOutResult = await qm.enqueue({
  type: 'text',
  category: 'background',
  run: () => slowResolving,
  timeoutMs: 60,
  fallbackValue: [1, 1, 1, 1, 1],
});
const timeoutElapsed = Date.now() - timeoutStart;
assert.ok(timeoutElapsed < 250, `must resolve at ~timeoutMs, not the slow 300ms duration (took ${timeoutElapsed}ms)`);
assert.equal(timedOutResult.usedFallback, true);
assert.equal(timedOutResult.timedOut, true);
assert.deepEqual(timedOutResult.result, [1, 1, 1, 1, 1]);

// A slow REJECTION after timeout is the dangerous case for unhandled
// rejections — enqueue one of those too.
const slowRejecting = new Promise((_, rej) => setTimeout(() => rej(new Error('late failure')), 200));
const rejectedAfterTimeout = await qm.enqueue({
  type: 'text',
  category: 'background',
  run: () => slowRejecting,
  timeoutMs: 60,
  fallbackValue: 'neutral',
});
assert.equal(rejectedAfterTimeout.usedFallback, true);

// Let both slow promises actually settle, then confirm the late settlements
// were absorbed: no unhandled rejection, already-returned results untouched.
await new Promise((res) => setTimeout(res, 400));
assert.equal(unhandledRejections.length, 0, 'late settlements must never produce an unhandled rejection');
assert.deepEqual(timedOutResult.result, [1, 1, 1, 1, 1], 'the late real resolution must not affect the returned result');
console.log('B4 PASSED: resolved with fallback at ~timeoutMs; late real settlements absorbed safely');

// B5: no timeoutMs genuinely waits for the real result instead of failing early.
const waitStart = Date.now();
const waitedResult = await qm.enqueue({
  type: 'text',
  category: 'foreground',
  run: () => new Promise((res) => setTimeout(() => res('real-result'), 50)),
});
assert.equal(waitedResult.result, 'real-result');
assert.equal(waitedResult.usedFallback, false);
assert.ok(Date.now() - waitStart >= 45, 'a request without timeoutMs must wait for run() to settle');
console.log('B5 PASSED: no-timeout request waited for and returned the real result');

// --- Section C: transport plumbing (stubbed) ----------------------------------
// The real generateText global only exists inside a live Perchance page. This
// stub proves OUR plumbing end-to-end — availability detection, queue
// admission, call, parse, validate — and says nothing about real AI output
// quality, which can only ever be verified by hand in a Perchance page.
console.log('\n=== Section C: transport plumbing (stubbed generateText) ===');

globalThis.generateText = async () =>
  '{"dialogue": "Aye, one room left — mind the creaky third stair.", "internalMonologue": "He looks road-worn. Good coin, though.", "toneTags": ["warm", "wry"]}';

const liveResult = await getDialogue(mira, miraToRowanEdge, mira.psychology.memories, samplePlayerLine);
assert.equal(liveResult.source, 'ai', 'with a working stub the live AI path must be taken');
assert.equal(validateDialogueResponse(liveResult.response).ok, true, 'the returned response must satisfy the contract');
assert.ok(liveResult.response.dialogue.includes('creaky third stair'), 'the stubbed dialogue must round-trip intact');
console.log(`stubbed AI path returned: "${liveResult.response.dialogue}"`);

// Restore a clean plugin-unavailable state and prove the fallback path takes over.
delete globalThis.generateText;
const unavailableResult = await getDialogue(mira, miraToRowanEdge, mira.psychology.memories, samplePlayerLine);
assert.equal(unavailableResult.source, 'fallback', 'without the plugin, getDialogue must degrade to the fallback');
console.log('Section C PASSED: stubbed plumbing works end-to-end; plugin-unavailable degrades cleanly');

// --- Section D: fallback + contract enforcement (zero network) ---------------
console.log('\n=== Section D: fallback + contract enforcement ===');

const fallbackResult = fallbackDialogue(mira, miraToRowanEdge);
assert.equal(validateDialogueResponse(fallbackResult).ok, true, 'fallbackDialogue must produce a contract-valid response');
assert.ok(fallbackResult.dialogue.trim().length > 0);
assert.deepEqual(fallbackDialogue(mira, miraToRowanEdge), fallbackResult, 'fallback must be deterministic: same entity + tier -> same line');
console.log(`fallback line for Mira: "${fallbackResult.dialogue}" [${fallbackResult.toneTags.join(', ')}]`);

const missingDialogue = validateDialogueResponse({ internalMonologue: 'hm' });
assert.equal(missingDialogue.ok, false);
assert.ok(missingDialogue.reason.includes('dialogue'), 'missing dialogue must be the stated reason');

const deltaShaped = validateDialogueResponse({ dialogue: 'hi', trustDelta: 5 });
assert.equal(deltaShaped.ok, false);
assert.ok(deltaShaped.reason.includes('state-write-shaped'), 'a delta-shaped key must be rejected AS a state-write-shaped field');

const wellFormed = validateDialogueResponse({ dialogue: 'Hello there.', internalMonologue: 'Careful, now.', toneTags: ['guarded'] });
assert.equal(wellFormed.ok, true);
assert.deepEqual(wellFormed.value, { dialogue: 'Hello there.', internalMonologue: 'Careful, now.', toneTags: ['guarded'] });
console.log('Section D PASSED: fallback valid + deterministic; contract rejects missing/delta-shaped, accepts well-formed');

// =============================================================================
// Section E: player verbs -> relationship effects + auto-generated memory.
// Uses entirely fresh buildSampleWorld() instances — never touches the
// hand-authored mira/rowan/relationships built above, since many earlier
// assertions already depend on their exact state.
// =============================================================================
console.log('\n=== Section E: player verbs, relationship effects, and memory ===');

// Kept in sync by hand with engines/relationshipEffectEngine.js's ACTION_DELTAS.
const ROBBED_DELTA = { affection: -15, comfort: -10, trust: -20, desire: 0, obedience: -5 };
const HELPED_DELTA = { affection: 5, comfort: 3, trust: 5, desire: 0, obedience: -1 };
const IGNORED_DELTA = { affection: -1, comfort: -1, trust: 0, desire: 0, obedience: 0 };

function addStats(stats, delta) {
  return {
    affection: stats.affection + delta.affection,
    comfort: stats.comfort + delta.comfort,
    trust: stats.trust + delta.trust,
    desire: stats.desire + delta.desire,
    obedience: stats.obedience + delta.obedience,
  };
}

// --- E1: ROBBED moves stats, preserves the label, drops the tier, and -------
//         appends a memory pointing at the real dispatched entry.
const sampleA = buildSampleWorld();
createRelationshipEffectEngine(sampleA.world, sampleA.relationships);
createMemoryEngine(sampleA.world, sampleA.registry);

const edgeBeforeA = sampleA.relationships.getRelationship(sampleA.mira.id, sampleA.rowan.id);
const tierBeforeA = relationshipTier(edgeBeforeA.stats);
assert.equal(tierBeforeA, 'acquaintance', 'sanity check on the sample data\'s starting tier');

const robEntry = robNpc(sampleA.world, sampleA.rowan.id, sampleA.mira.id);

const edgeAfterA = sampleA.relationships.getRelationship(sampleA.mira.id, sampleA.rowan.id);
const expectedRobbedStats = addStats(edgeBeforeA.stats, ROBBED_DELTA);
assert.deepEqual(edgeAfterA.stats, expectedRobbedStats, 'ROBBED must apply exactly the ROBBED delta table');
assert.equal(edgeAfterA.fromCallsTo, edgeBeforeA.fromCallsTo, 'fromCallsTo label must survive the stat rewrite');

const tierAfterA = relationshipTier(edgeAfterA.stats);
assert.equal(tierAfterA, 'stranger', 'ROBBED must drop the tier from acquaintance to stranger given the sample stats');

assert.equal(sampleA.mira.psychology.memories.length, 1, 'exactly one memory must be appended');
assert.equal(sampleA.mira.psychology.memories[0].seq, robEntry.seq, 'memory seq must point at the real dispatched entry');
assert.equal(sampleA.mira.psychology.memories[0].summary, 'The player stole from me.');
console.log(`E1 PASSED: ROBBED ${JSON.stringify(edgeBeforeA.stats)} -> ${JSON.stringify(edgeAfterA.stats)}, tier ${tierBeforeA} -> ${tierAfterA}, memory recorded`);

// --- E2: determinism — identical action sequence on a fresh instance --------
//         produces identical resulting stats and memories.
const sampleB = buildSampleWorld();
createRelationshipEffectEngine(sampleB.world, sampleB.relationships);
createMemoryEngine(sampleB.world, sampleB.registry);
robNpc(sampleB.world, sampleB.rowan.id, sampleB.mira.id);

assert.deepEqual(
  sampleB.relationships.getRelationship(sampleB.mira.id, sampleB.rowan.id),
  sampleA.relationships.getRelationship(sampleA.mira.id, sampleA.rowan.id),
  'identical action sequence on a fresh instance must produce identical relationship stats'
);
assert.deepEqual(
  sampleB.mira.psychology.memories,
  sampleA.mira.psychology.memories,
  'identical action sequence on a fresh instance must produce identical memory entries'
);
console.log('E2 PASSED: determinism holds — fresh instance, same action sequence, identical stats and memories');

// --- E3: HELPED applies its own delta table and memory template -------------
const sampleC = buildSampleWorld();
createRelationshipEffectEngine(sampleC.world, sampleC.relationships);
createMemoryEngine(sampleC.world, sampleC.registry);

const edgeBeforeC = sampleC.relationships.getRelationship(sampleC.mira.id, sampleC.rowan.id);
const helpEntry = helpNpc(sampleC.world, sampleC.rowan.id, sampleC.mira.id);
const edgeAfterC = sampleC.relationships.getRelationship(sampleC.mira.id, sampleC.rowan.id);

assert.deepEqual(edgeAfterC.stats, addStats(edgeBeforeC.stats, HELPED_DELTA), 'HELPED must apply exactly the HELPED delta table');
assert.equal(sampleC.mira.psychology.memories[0].seq, helpEntry.seq);
assert.equal(sampleC.mira.psychology.memories[0].summary, 'The player helped me when I needed it.');
console.log(`E3 PASSED: HELPED ${JSON.stringify(edgeBeforeC.stats)} -> ${JSON.stringify(edgeAfterC.stats)}, memory recorded`);

// --- E4: IGNORED applies its own delta table and memory template ------------
const sampleD = buildSampleWorld();
createRelationshipEffectEngine(sampleD.world, sampleD.relationships);
createMemoryEngine(sampleD.world, sampleD.registry);

const edgeBeforeD = sampleD.relationships.getRelationship(sampleD.mira.id, sampleD.rowan.id);
const ignoreEntry = ignoreNpc(sampleD.world, sampleD.rowan.id, sampleD.mira.id);
const edgeAfterD = sampleD.relationships.getRelationship(sampleD.mira.id, sampleD.rowan.id);

assert.deepEqual(edgeAfterD.stats, addStats(edgeBeforeD.stats, IGNORED_DELTA), 'IGNORED must apply exactly the IGNORED delta table');
assert.equal(sampleD.mira.psychology.memories[0].seq, ignoreEntry.seq);
assert.equal(sampleD.mira.psychology.memories[0].summary, 'The player brushed past without a word.');
console.log(`E4 PASSED: IGNORED ${JSON.stringify(edgeBeforeD.stats)} -> ${JSON.stringify(edgeAfterD.stats)}, memory recorded`);

// --- E5: memoryEngine no-ops (never throws) for an unregistered target ------
const sampleE = buildSampleWorld();
createRelationshipEffectEngine(sampleE.world, sampleE.relationships);
createMemoryEngine(sampleE.world, sampleE.registry);
assert.doesNotThrow(() => {
  helpNpc(sampleE.world, sampleE.rowan.id, 'npc_unregistered');
}, 'dispatching against an unregistered target id must not throw');
console.log('E5 PASSED: unregistered target id is a defensive no-op, no crash');

// --- E6: memory fan-out — co-located witnesses remember too -----------------
//         The same-node stand-in for real presence tracking: a presence source
//         says Mira and Sable share a node. Robbing Mira THERE lands a
//         first-person memory on Mira and an OBSERVER memory on Sable; the
//         acting player is never a rememberer. (Under Node there is no
//         generateText, so both summaries stay the deterministic templates.)
const sampleFan = buildSampleWorld();
createRelationshipEffectEngine(sampleFan.world, sampleFan.relationships);
const DEMO_NODE = 'node_demo_scene';
const fanPresence = {
  witnessesAt: (nodeId) => (nodeId === DEMO_NODE ? [sampleFan.mira.id, sampleFan.sable.id] : []),
};
createMemoryEngine(sampleFan.world, sampleFan.registry, fanPresence);

const fanEntry = robNpc(sampleFan.world, sampleFan.rowan.id, sampleFan.mira.id, DEMO_NODE);

assert.equal(sampleFan.mira.psychology.memories.length, 1, 'the target remembers (first person)');
assert.equal(sampleFan.mira.psychology.memories[0].summary, 'The player stole from me.', 'target keeps the first-person template');
assert.equal(sampleFan.sable.psychology.memories.length, 1, 'the co-located witness remembers too');
assert.ok(sampleFan.sable.psychology.memories[0].summary.includes('Mira'), 'the witness memory names who it happened to');
assert.notEqual(
  sampleFan.sable.psychology.memories[0].summary,
  sampleFan.mira.psychology.memories[0].summary,
  'witness perspective must differ from the victim first-person line'
);
assert.equal(sampleFan.rowan.psychology.memories.length, 0, 'the acting player is never a rememberer');
assert.equal(
  sampleFan.mira.psychology.memories[0].seq,
  sampleFan.sable.psychology.memories[0].seq,
  'target and witness memories reference the same event seq'
);
assert.equal(sampleFan.mira.psychology.memories[0].seq, fanEntry.seq, 'the memory points at the real dispatched entry');
console.log(`E6 PASSED: witness Sable recorded "${sampleFan.sable.psychology.memories[0].summary}"; player recorded nothing`);

// --- E7: no nodeId => no fan-out (single-target behavior preserved) ----------
const sampleNoNode = buildSampleWorld();
createRelationshipEffectEngine(sampleNoNode.world, sampleNoNode.relationships);
createMemoryEngine(sampleNoNode.world, sampleNoNode.registry, fanPresence);
robNpc(sampleNoNode.world, sampleNoNode.rowan.id, sampleNoNode.mira.id); // no nodeId
assert.equal(sampleNoNode.mira.psychology.memories.length, 1, 'target still remembers without a node');
assert.equal(sampleNoNode.sable.psychology.memories.length, 0, 'no nodeId => no witnesses, even with a presence source wired');
console.log('E7 PASSED: without a nodeId the fan-out is inert — single-target behavior preserved');

console.log('\nSection E PASSED: player verbs deterministically move relationship stats and auto-generate memories, fanning out to co-located witnesses when a node is named');

assert.equal(unhandledRejections.length, 0, 'no unhandled rejection may have occurred anywhere');

// =============================================================================
// Section F: WorldClock — time is derived from the log, never a stored clock.
// A dedicated world (initWorldState reads worldConfig.json, which now carries
// timeDilation + calendar). CLOCK_TICK/CLOCK_JUMP are runtime/system actions,
// dispatched directly here; the timeContext switch rides on an ordinary action.
// =============================================================================
console.log('\n=== Section F: WorldClock ===');

const clockWorld = initWorldState(CONFIG_PATH);
const clock = createWorldClockEngine(clockWorld);
const clockConfig = clockWorld.getState().config; // frozen clone, incl. timeDilation + calendar

// --- F1: continuous dilation under the default 'idle' context (× 20) ---------
// Three ticks of 10 real-seconds each: 30 real-s × 20 = 600 game-s = 10 min.
clockWorld.dispatch('CLOCK_TICK', { realSecondsElapsed: 10 });
clockWorld.dispatch('CLOCK_TICK', { realSecondsElapsed: 10 });
clockWorld.dispatch('CLOCK_TICK', { realSecondsElapsed: 10 });
assert.equal(clock.getTotalGameSeconds(), 30 * 20, 'idle ticks must dilate by the idle multiplier');
assert.equal(clock.getActiveTimeContext(), 'idle', 'no timeContext set yet ⇒ default idle');
assert.deepEqual(
  clock.getCurrentDate(),
  { year: 1, monthIndex: 0, monthName: 'Rain', week: 1, day: 1, hour: 6, minute: 10, second: 0 },
  'epoch 06:00 + 600 game-seconds ⇒ 06:10:00 on Year 1, Rain, Week 1, Day 1'
);
console.log(`F1 PASSED: 30 real-s idle → ${clock.getTotalGameSeconds()} game-s, ${JSON.stringify(clock.getCurrentDate())}`);

// --- F2: a timeContext-carrying action switches the multiplier mid-stream ----
// Switch to 'traveling' (× 60), then two 30 real-second ticks: 60 real-s × 60
// = 3600 game-s (one hour), NOT 60 × 20 = 1200.
const beforeTravel = clock.getTotalGameSeconds();
clockWorld.dispatch('ACTION_TRAVEL_STARTED', { timeContext: 'traveling' });
assert.equal(clock.getActiveTimeContext(), 'traveling', 'the dispatched timeContext must become active');
clockWorld.dispatch('CLOCK_TICK', { realSecondsElapsed: 30 });
clockWorld.dispatch('CLOCK_TICK', { realSecondsElapsed: 30 });
const travelAdded = clock.getTotalGameSeconds() - beforeTravel;
assert.equal(travelAdded, 60 * 60, 'traveling ticks must use × 60, not the earlier × 20');
assert.notEqual(travelAdded, 60 * 20, 'sanity: the multiplier really changed mid-stream');
console.log(`F2 PASSED: 60 real-s traveling added ${travelAdded} game-s (× 60), total ${clock.getTotalGameSeconds()}`);

// --- F3: a discrete jump adds a flat amount with no multiplier ---------------
// One full game-day of sleep. Still under 'traveling', but a jump ignores it.
const beforeJump = clock.getTotalGameSeconds();
clockWorld.dispatch('CLOCK_JUMP', { gameSecondsElapsed: 86400 });
const jumpAdded = clock.getTotalGameSeconds() - beforeJump;
assert.equal(jumpAdded, 86400, 'a jump must add exactly its flat game-seconds');
assert.notEqual(jumpAdded, 86400 * 60, 'a jump must NOT pass through the active multiplier');
console.log(`F3 PASSED: CLOCK_JUMP added exactly ${jumpAdded} game-s (flat, no × 60)`);

// --- F4: the incremental cache equals a from-scratch rebuild -----------------
assert.equal(
  clock.rebuildTotalGameSeconds(),
  clock.getTotalGameSeconds(),
  'total rebuilt from the log alone must match the incrementally-cached total'
);
console.log(`F4 PASSED: cached total ${clock.getTotalGameSeconds()} == rebuilt-from-log ${clock.rebuildTotalGameSeconds()}`);

// --- F5: changing a multiplier in config changes a full rebuild --------------
// Same log, retuned traveling multiplier (60 → 120): the 60 traveling real-s
// now yield 7200 instead of 3600. idle ticks (600) and the jump (86400) are
// untouched, proving the multiplier is applied at derivation time, not baked
// into stored log entries.
const clockLog = clockWorld.getEventLog();
const originalRebuild = deriveTotalGameSeconds(clockConfig, clockLog);
const changedConfig = structuredClone(clockConfig);
changedConfig.timeDilation.multipliers.traveling = 120;
const changedRebuild = deriveTotalGameSeconds(changedConfig, clockLog);
assert.notEqual(changedRebuild, originalRebuild, 'retuning a multiplier must change the rebuilt total');
assert.equal(changedRebuild, 30 * 20 + 60 * 120 + 86400, 'rebuild must reflect the new multiplier exactly');
console.log(`F5 PASSED: traveling × 60 → × 120 rebuilds ${originalRebuild} → ${changedRebuild} (config, not stored state)`);

// --- F6: total game-seconds of 0 resolves to the epoch exactly ---------------
assert.deepEqual(
  deriveCalendarDate(clockConfig, 0),
  { year: 1, monthIndex: 0, monthName: 'Rain', week: 1, day: 1, hour: 6, minute: 0, second: 0 },
  'totalGameSeconds 0 must be Year 1, Rain, Week 1, Day 1, 06:00:00'
);
// And deriveActiveTimeContext over an empty log defaults to idle.
assert.equal(deriveActiveTimeContext([]), 'idle', 'empty log ⇒ default idle context');
console.log('F6 PASSED: totalGameSeconds 0 ⇒ Year 1, Rain, Week 1, Day 1, 06:00:00; empty log ⇒ idle');

console.log('\nSection F PASSED: game-time is derived from the log — dilated ticks, flat jumps, rebuildable, config-driven');

// =============================================================================
// Section G: RelationshipStore — stats derived from a RELATIONSHIP_EVENT log,
// and a divergence-first tier that gives frenemy-shaped relationships a legible
// label instead of averaging them into a bland middle tier. Self-contained on
// its own world with throwaway ids so it is independent of the mira/rowan
// seeding above; different id pairs keep the cases from cross-contaminating.
// =============================================================================
console.log('\n=== Section G: RelationshipStore (log-derived stats + divergence-first tier) ===');

const relWorld = initWorldState(CONFIG_PATH);
const rel = createRelationshipStore(relWorld);

// --- G1: multi-axis derived stats equal hand-calculated per-axis delta sums --
// weight is deliberately varied and must NOT affect the stat sums (it feeds
// history/stickiness only).
rel.recordRelationshipEvent('g1_a', 'g1_b', 'affection', 10, 1);
rel.recordRelationshipEvent('g1_a', 'g1_b', 'affection', 5, 2);
rel.recordRelationshipEvent('g1_a', 'g1_b', 'trust', -3, 1);
rel.recordRelationshipEvent('g1_a', 'g1_b', 'comfort', 7, 3);
rel.recordRelationshipEvent('g1_a', 'g1_b', 'desire', 2);
rel.recordRelationshipEvent('g1_a', 'g1_b', 'obedience', -4);
const g1Expected = { affection: 15, comfort: 7, trust: -3, desire: 2, obedience: -4 };
const g1Derived = deriveRelationshipStats(relWorld.getEventLog(), 'g1_a', 'g1_b');
assert.deepEqual(g1Derived, g1Expected, 'derived stats must equal the hand-summed per-axis deltas');
assert.deepEqual(rel.getRelationship('g1_a', 'g1_b').stats, g1Expected, 'cached stats must match the derivation');
console.log(`G1 PASSED: derived stats ${JSON.stringify(g1Derived)} match hand sums (weight ignored for stats)`);

// --- G2: frenemy => 'complicated' (LOAD-BEARING) ----------------------------
// Repeated +affection interleaved with -trust: warm but untrusted. Averaging
// the five axes would flatten this to a bland middle tier; the divergence rule
// must instead read it as 'complicated'.
for (let i = 0; i < 6; i++) {
  rel.recordRelationshipEvent('g2_a', 'g2_b', 'affection', 10);
  rel.recordRelationshipEvent('g2_a', 'g2_b', 'trust', -8);
}
const g2Stats = rel.getRelationship('g2_a', 'g2_b').stats; // affection 60, trust -48
const g2Tier = relationshipTier(g2Stats);
// What the OLD average-only logic would have produced, computed inline:
const g2Avg = (g2Stats.affection + g2Stats.comfort + g2Stats.trust + g2Stats.desire + g2Stats.obedience) / 5;
const g2AvgTier = TIER_THRESHOLDS.find((t) => g2Avg <= t.max).label;
assert.equal(g2Tier, 'complicated', 'frenemy (high affection, low trust) must read as complicated');
assert.notEqual(g2Tier, g2AvgTier, 'complicated must NOT collapse to the average-based tier');
console.log(`G2 PASSED: affection ${g2Stats.affection} / trust ${g2Stats.trust} → '${g2Tier}', NOT the averaged '${g2AvgTier}' (avg ${g2Avg})`);

// --- G3: resentful subordinate => 'resentful' -------------------------------
// Low affection, high obedience: obeys without any warmth.
rel.recordRelationshipEvent('g3_a', 'g3_b', 'affection', -10);
rel.recordRelationshipEvent('g3_a', 'g3_b', 'affection', -10);
rel.recordRelationshipEvent('g3_a', 'g3_b', 'obedience', 50);
const g3Tier = relationshipTier(rel.getRelationship('g3_a', 'g3_b').stats);
assert.equal(g3Tier, 'resentful', 'low affection + high obedience must read as resentful');
console.log(`G3 PASSED: affection -20 / obedience 50 → '${g3Tier}'`);

// --- G4: boring, all axes together => falls through to the average ladder ----
// Proves the archetype rules don't over-trigger on ordinary relationships.
for (const axis of ['affection', 'comfort', 'trust', 'desire', 'obedience']) {
  rel.recordRelationshipEvent('g4_a', 'g4_b', axis, 50);
}
const g4Stats = rel.getRelationship('g4_a', 'g4_b').stats; // all 50
const g4Tier = relationshipTier(g4Stats);
const g4Avg = (g4Stats.affection + g4Stats.comfort + g4Stats.trust + g4Stats.desire + g4Stats.obedience) / 5;
const g4AvgTier = TIER_THRESHOLDS.find((t) => g4Avg <= t.max).label;
assert.equal(g4Tier, g4AvgTier, 'a non-divergent relationship must use the average-based ladder');
assert.equal(g4Tier, 'friend', 'all axes at 50 averages to friend');
assert.ok(g4Tier !== 'complicated' && g4Tier !== 'resentful', 'archetype rules must not over-trigger');
console.log(`G4 PASSED: all axes 50 → '${g4Tier}' via the average ladder (archetype rules did not fire)`);

// --- G5: rebuild-from-log-only equals the cached total ----------------------
rel.recordRelationshipEvent('g5_a', 'g5_b', 'affection', 12);
rel.recordRelationshipEvent('g5_a', 'g5_b', 'trust', -4);
rel.recordRelationshipEvent('g5_a', 'g5_b', 'comfort', 9);
const g5Cached = rel.getRelationship('g5_a', 'g5_b').stats;
const g5Rebuilt = rel.rebuildRelationshipStats('g5_a', 'g5_b');
assert.deepEqual(g5Rebuilt, g5Cached, 'stats rebuilt from the log alone must equal the incrementally-cached stats');
console.log(`G5 PASSED: cached ${JSON.stringify(g5Cached)} == rebuilt-from-log ${JSON.stringify(g5Rebuilt)}`);

// --- G6: deriveRelationshipHistory returns count + total ABSOLUTE weight -----
rel.recordRelationshipEvent('g6_a', 'g6_b', 'affection', 5, 1);
rel.recordRelationshipEvent('g6_a', 'g6_b', 'trust', -2, 2);
rel.recordRelationshipEvent('g6_a', 'g6_b', 'comfort', 1, 3);
rel.recordRelationshipEvent('g6_a', 'g6_b', 'desire', 4, -1); // negative weight ⇒ abs 1
const g6History = deriveRelationshipHistory(relWorld.getEventLog(), 'g6_a', 'g6_b');
assert.deepEqual(g6History, { count: 4, totalWeight: 7 }, 'history must be event count and Σ|weight| (1+2+3+1)');
console.log(`G6 PASSED: history ${JSON.stringify(g6History)} (4 events, Σ|weight| = 7)`);

console.log('\nSection G PASSED: relationship stats are log-derived and rebuildable; divergent pairs read as complicated/resentful, ordinary pairs fall through');

// =============================================================================
// Section H: Sable Voss — an NPC<->NPC edge seeded with pre-existing,
// asymmetric history (not built up from zero by later player actions, unlike
// every other relationship proven above). Both directions land on the same
// 'complicated' tier via two different stat shapes — the actual point of this
// section: divergence-first tiering reads two different histories of the same
// betrayal as the same legible label, without averaging either one away.
// Uses a fresh buildSampleWorld() (Section E's pattern) to exercise the real
// seeded edge rather than synthetic ids.
// =============================================================================
console.log('\n=== Section H: Sable Voss — NPC<->NPC edge with pre-existing, asymmetric history ===');

const sampleH = buildSampleWorld();

// --- H1: Mira -> Sable stats match the hand-authored seed exactly -----------
const miraToSable = sampleH.relationships.getRelationship(sampleH.mira.id, sampleH.sable.id);
assert.deepEqual(
  miraToSable.stats,
  { affection: 60, comfort: 24, trust: -40, desire: 0, obedience: 0 },
  'Mira -> Sable must match the seeded deep-trust-wound shape exactly'
);
console.log(`H1 PASSED: Mira -> Sable stats = ${JSON.stringify(miraToSable.stats)}`);

// --- H2: Sable -> Mira stats match the hand-authored seed exactly, and -------
//         differ from H1's shape (the asymmetry is intentional, not a bug).
const sableToMira = sampleH.relationships.getRelationship(sampleH.sable.id, sampleH.mira.id);
assert.deepEqual(
  sableToMira.stats,
  { affection: 60, comfort: 20, trust: -10, desire: 0, obedience: 0 },
  'Sable -> Mira must match the seeded shallower-trust-wound shape exactly'
);
assert.notDeepEqual(sableToMira.stats, miraToSable.stats, 'the two directions must NOT be symmetric — this is the intentional asymmetry');
console.log(`H2 PASSED: Sable -> Mira stats = ${JSON.stringify(sableToMira.stats)} (deliberately asymmetric to H1)`);

// --- H3: BOTH directions derive 'complicated' despite the different shapes --
//         (load-bearing: two different paths into the same legible tier).
const miraToSableTier = relationshipTier(miraToSable.stats);
const sableToMiraTier = relationshipTier(sableToMira.stats);
assert.equal(miraToSableTier, 'complicated', 'Mira -> Sable (trust -40) must read as complicated');
assert.equal(sableToMiraTier, 'complicated', 'Sable -> Mira (trust -10) must read as complicated too, despite the shallower wound');
console.log(`H3 PASSED: both directions read '${miraToSableTier}' / '${sableToMiraTier}' — same tier, two different histories`);

// --- H4: rebuild-from-log-only equals the cache for both directions ---------
assert.deepEqual(
  sampleH.relationships.rebuildRelationshipStats(sampleH.mira.id, sampleH.sable.id),
  miraToSable.stats,
  'Mira -> Sable must be fully rebuildable from the log alone'
);
assert.deepEqual(
  sampleH.relationships.rebuildRelationshipStats(sampleH.sable.id, sampleH.mira.id),
  sableToMira.stats,
  'Sable -> Mira must be fully rebuildable from the log alone'
);
console.log('H4 PASSED: both directions rebuild from the log alone identically to the cache');

// --- H5: sanity read (NOT an automated assertion) ---------------------------
// Proves the plumbing carries text through for a second NPC with her own
// aiDirectives/voice; voice fluency and tonal contrast can only be judged by a
// human, so this only logs the lines for a manual read-through, same spirit
// as Section C's stubbed AI path. fallbackDialogue.js has no 'complicated'
// tier lines yet (a pre-existing gap from the relationship-store redesign,
// out of scope here), so this deliberately uses the stubbed generateText path
// rather than the fallback path.
console.log('\n--- H5: sanity read of stubbed dialogue for both sides (manual read-through only) ---');

globalThis.generateText = async () =>
  '{"dialogue": "Careful with that tone, or I\'ll start charging Mira interest on the gossip too.", "internalMonologue": "She always knows exactly when to bring up the books.", "toneTags": ["sly", "quick"]}';
const sableLine = await getDialogue(sampleH.sable, sableToMira, sampleH.sable.psychology.memories, 'Rough night at the tables?');
console.log(`Sable (re: Mira): "${sableLine.response.dialogue}"`);

globalThis.generateText = async () =>
  '{"dialogue": "Sable\'s the only one who remembers me before the tavern, so I let her keep her secrets. Mostly.", "internalMonologue": "I still know exactly to the coin what she took.", "toneTags": ["wry", "guarded"]}';
const miraLine = await getDialogue(sampleH.mira, miraToSable, sampleH.mira.psychology.memories, 'You two go way back?');
console.log(`Mira (re: Sable): "${miraLine.response.dialogue}"`);

delete globalThis.generateText; // restore plugin-unavailable state for anything after this section
console.log('H5 done (manual read-through only, not a determinism-checked assertion)');

console.log(`\nSection H PASSED: Sable Voss seeded with pre-existing, asymmetric NPC<->NPC history — both directions rebuildable and both legibly 'complicated'`);

// =============================================================================
// Section I: runtime tick SOURCE — the thing that turns the clock during live
// play. WorldClockEngine (Section F) is proven; this proves the runtime piece
// that feeds it. createTickSource dispatches CLOCK_TICK on a real interval in
// the browser, but exposes simulateTicks(n) so the exact same dispatch path can
// be driven deterministically here with no timer. Context switches are driven
// by dispatching the REAL verbs' action types bare (only their timeContext
// payload matters to the clock; no travel/dialogue engine is wired here) —
// the debug context switch that used to stand in for them is retired.
//
// NOT auto-tested: pause-on-blur. Pausing stops a real setInterval on a real
// tab-visibility event — inherently timer/visibility driven, not reproducible
// deterministically in Node without fake timers. It is eyeballed live in the
// test harness instead (see the commit message).
// =============================================================================
console.log('\n=== Section I: runtime tick source (deterministic simulate-N-ticks) ===');

function buildTickWorld() {
  const w = initWorldState(CONFIG_PATH);
  const c = createWorldClockEngine(w);
  const t = createTickSource(w, w.getState().config);
  return { world: w, clock: c, tick: t };
}

// --- I1: ticks under the default 'idle' context dilate by × 20 ---------------
// tickIntervalMs is 1000 ⇒ 1 real-second per tick. 5 ticks × 1s × 20 = 100 game-s.
const runtime = buildTickWorld();
assert.equal(runtime.tick.realSecondsPerTick, 1, 'config runtime.tickIntervalMs 1000 ⇒ 1 real-s per tick');
runtime.tick.simulateTicks(5);
assert.equal(runtime.clock.getTotalGameSeconds(), 5 * 1 * 20, 'idle ticks must dilate by × 20');
assert.deepEqual(
  runtime.clock.getCurrentDate(),
  { year: 1, monthIndex: 0, monthName: 'Rain', week: 1, day: 1, hour: 6, minute: 1, second: 40 },
  'epoch 06:00 + 100 game-s ⇒ 06:01:40'
);
console.log(`I1 PASSED: 5 idle ticks → ${runtime.clock.getTotalGameSeconds()} game-s, ${JSON.stringify(runtime.clock.getCurrentDate())}`);

// --- I2: real verb actions drive dilation mid-stream -------------------------
// The clock keys off any action's timeContext payload, so the real verbs'
// action types (dispatched bare — no travel/dialogue engine wired here) flip
// the active multiplier exactly as the full verbs do in the harness.
const iBeforeTravel = runtime.clock.getTotalGameSeconds();
runtime.world.dispatch('ACTION_TRAVEL_STARTED', { timeContext: 'traveling' });
assert.equal(runtime.clock.getActiveTimeContext(), 'traveling', 'a travel start must set the active context');
runtime.tick.simulateTicks(5); // 5 real-s × 60
assert.equal(runtime.clock.getTotalGameSeconds() - iBeforeTravel, 5 * 60, 'traveling ticks must use × 60');

const iBeforeChat = runtime.clock.getTotalGameSeconds();
runtime.world.dispatch('ACTION_DIALOGUE_STARTED', { timeContext: 'chatting' });
runtime.tick.simulateTicks(5); // 5 real-s × 1
assert.equal(runtime.clock.getTotalGameSeconds() - iBeforeChat, 5 * 1, 'chatting ticks must use × 1');

const iBeforeIdleAgain = runtime.clock.getTotalGameSeconds();
runtime.world.dispatch('ACTION_DIALOGUE_ENDED', { timeContext: 'idle' });
runtime.tick.simulateTicks(5); // 5 real-s × 20
assert.equal(runtime.clock.getTotalGameSeconds() - iBeforeIdleAgain, 5 * 20, 'ending the dialogue must restore × 20');
console.log('I2 PASSED: real verb actions drove × 60 (traveling), × 1 (chatting), × 20 (idle) mid-stream');

// --- I3: the cache still equals a from-scratch rebuild after tick-driving -----
assert.equal(
  runtime.clock.rebuildTotalGameSeconds(),
  runtime.clock.getTotalGameSeconds(),
  'tick-driven total must remain fully rebuildable from the log alone'
);
console.log(`I3 PASSED: cached ${runtime.clock.getTotalGameSeconds()} == rebuilt-from-log ${runtime.clock.rebuildTotalGameSeconds()}`);

// --- I4: determinism — identical tick/context sequence ⇒ identical log + date -
const runtimeA = buildTickWorld();
const runtimeB = buildTickWorld();
function driveRuntime({ world: w, tick: t }) {
  t.simulateTicks(3);
  w.dispatch('ACTION_TRAVEL_STARTED', { timeContext: 'traveling' });
  t.simulateTicks(4);
  w.dispatch('TRAVEL_ARRIVED', { timeContext: 'idle' });
  t.simulateTicks(2);
}
driveRuntime(runtimeA);
driveRuntime(runtimeB);
assert.deepEqual(runtimeB.world.getEventLog(), runtimeA.world.getEventLog(), 'identical tick/context sequence ⇒ identical event log');
assert.deepEqual(runtimeB.clock.getCurrentDate(), runtimeA.clock.getCurrentDate(), 'identical tick/context sequence ⇒ identical derived date');
console.log(`I4 PASSED: determinism holds — identical sequence, identical log and date ${JSON.stringify(runtimeA.clock.getCurrentDate())}`);

// --- I5: pause() latches and stops the source from starting ------------------
// Deterministic slice of the pause contract we CAN check without a timer: once
// paused, start() must not begin running. (The live "backgrounded tab freezes
// game-time" behavior itself is eyeballed in the harness — see section header.)
const paused = buildTickWorld();
paused.tick.pause();
assert.equal(paused.tick.isPaused, true, 'pause() must latch isPaused');
paused.tick.start(); // must be a no-op while paused
const totalWhilePaused = paused.clock.getTotalGameSeconds();
assert.equal(totalWhilePaused, 0, 'no tick may have been dispatched while paused');
paused.tick.resume();
assert.equal(paused.tick.isPaused, false, 'resume() must clear the latch');
paused.tick.stop(); // resume() started a real interval; clear it so Node exits cleanly
console.log(`I5 PASSED: pause() latches and start() no-ops while paused (game-s held at ${totalWhilePaused}); real tab-blur pausing is eyeballed live`);

console.log('\nSection I PASSED: the runtime tick source feeds CLOCK_TICKs into the proven clock; dilation switches, determinism, and rebuildability all hold');

// =============================================================================
// Section J: debugLog — toggleable console channels, independent of engine
// behavior. Seeds a small foundation for eventually organizing ALL console
// output into independently-toggleable channels, so bug-hunting can target
// one subsystem's log lines instead of the whole thing. The load-bearing
// property this proves: silencing a channel is a PURE side-effect toggle — it
// never changes dispatch, the event log, or anything derived from it.
// =============================================================================
console.log('\n=== Section J: debugLog toggleable console channels ===');

// --- J1: WorldClockEngine ships DISABLED by default -------------------------
// It is by far the noisiest channel (one line per CLOCK_TICK, and ticks fire
// once a second during live play) — this is the actual behavior being seeded.
assert.equal(isChannelEnabled('WorldClockEngine'), false, 'WorldClockEngine must default to disabled — it is the noisiest channel by far');
console.log("J1 PASSED: 'WorldClockEngine' channel defaults to disabled");

// --- J2: silencing a channel never changes what it silences -----------------
// Same tick/context sequence run twice — once with the channel at its shipped
// default (disabled), once with it explicitly re-enabled — must derive the
// identical total. If it didn't, logging would no longer be a pure side effect.
const silentWorld = buildTickWorld();
silentWorld.tick.simulateTicks(5);
silentWorld.world.dispatch('ACTION_TRAVEL_STARTED', { timeContext: 'traveling' });
silentWorld.tick.simulateTicks(3);

setChannelEnabled('WorldClockEngine', true);
const loudWorld = buildTickWorld();
loudWorld.tick.simulateTicks(5);
loudWorld.world.dispatch('ACTION_TRAVEL_STARTED', { timeContext: 'traveling' });
loudWorld.tick.simulateTicks(3);
setChannelEnabled('WorldClockEngine', false); // restore the shipped default

assert.equal(
  loudWorld.clock.getTotalGameSeconds(),
  silentWorld.clock.getTotalGameSeconds(),
  'an identical tick/context sequence must derive an identical total regardless of the WorldClockEngine console channel being on or off'
);
console.log(`J2 PASSED: identical sequence derives ${silentWorld.clock.getTotalGameSeconds()} game-s whether the channel is silenced or not — logging is a pure side effect`);

// --- J3: log() actually gates console.log on the channel's toggle state -----
const originalConsoleLog = console.log;
let callCount = 0;
console.log = (...args) => {
  callCount++;
  originalConsoleLog(...args);
};
try {
  setChannelEnabled('SectionJTestChannel', false);
  log('SectionJTestChannel', 'should NOT print');
  assert.equal(callCount, 0, 'a disabled channel must not call console.log');

  setChannelEnabled('SectionJTestChannel', true);
  log('SectionJTestChannel', 'should print');
  assert.equal(callCount, 1, 'an enabled channel must call console.log exactly once per log() call');
} finally {
  console.log = originalConsoleLog;
}
console.log('J3 PASSED: log() gates console.log on the channel toggle exactly as expected');

console.log('\nSection J PASSED: console channels toggle independent of engine state; WorldClockEngine ships silenced by default');

// =============================================================================
// Section K: WorldMapEngine — procedural terrain/graph generation.
//
// The load-bearing property here is determinism BY POSITION, not by exploration
// order: terrain at (x, y) is a pure function of (seed, coords), so lazy
// materialization is provably equivalent to eager generation. Unlike the clock
// and relationship engines, WorldMapEngine does NOT dispatch/subscribe — there
// is no event history to replay, so these checks derive from config + coords
// (deriveCalendarDate-style), never from the action log.
//
// Controlled scenarios build worlds directly with createWorldState() and custom
// worldMap configs (zero-jitter, varied worldSize, tight world) — the same
// escape hatch game/sampleWorld.js uses to run without a filesystem.
// =============================================================================
console.log('\n=== Section K: WorldMapEngine (coherent terrain + lazy converging graph) ===');

// A mutable clone of the shipped config, plus helpers to derive variants with
// worldMap/terrain overrides for the controlled scenarios below.
const mapBaseConfig = initWorldState(CONFIG_PATH).getState().config;
function mapConfigWith(worldMapOverrides = {}, terrainOverrides = {}) {
  const cfg = structuredClone(mapBaseConfig);
  cfg.worldMap = {
    ...cfg.worldMap,
    ...worldMapOverrides,
    terrain: { ...cfg.worldMap.terrain, ...terrainOverrides },
  };
  return cfg;
}
function mapEngineWith(worldMapOverrides = {}, terrainOverrides = {}) {
  const cfg = mapConfigWith(worldMapOverrides, terrainOverrides);
  return { engine: createWorldMapEngine(createWorldState(cfg)), config: cfg };
}
const terrainOf = ({ elevation, moisture, terrainType, passable }) => ({
  elevation,
  moisture,
  terrainType,
  passable,
});
const stripEdges = ({ edges, ...rest }) => rest;
const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E', NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' };

// runSectionK — the whole section body as a pure, self-contained routine that
// emits every output line through `record`. Running it twice and comparing the
// two line arrays (K6) is the "run the whole section twice, assert byte-
// identical output" determinism check. Every engine it touches is built inside,
// so nothing leaks between runs.
function runSectionK(record) {
  // --- K1: position-determinism, not order-determinism (LOAD-BEARING) --------
  // Reach the same coordinate two ways — directly via deriveTerrainAt, and via a
  // materialized chain — and, in a second engine, materialize an UNRELATED node
  // first before reaching it. The terrain must be byte-identical every way,
  // proving exploration order and prior materialization cannot change it.
  {
    const cfg = mapConfigWith();
    const eng1 = createWorldMapEngine(createWorldState(cfg));
    const origin = eng1.getOriginNode();
    const ring1 = eng1.materializeNeighbors(origin.id).neighbors;
    const nodeA = ring1[0];
    const ring2 = eng1.materializeNeighbors(nodeA.id).neighbors;
    // A second-ring node that is neither the origin nor A (a genuine chain end).
    const nodeC = ring2.find((n) => n.id !== origin.id && n.id !== nodeA.id);
    const { x: cx, y: cy } = nodeC;

    const direct = terrainOf(deriveTerrainAt(cfg, cx, cy));
    assert.deepEqual(terrainOf(nodeC), direct, 'chain-materialized terrain must equal direct derivation');

    // Second engine: churn an unrelated branch (a different first-ring node and
    // all its neighbors) BEFORE walking origin -> A -> C.
    const eng2 = createWorldMapEngine(createWorldState(mapConfigWith()));
    const origin2 = eng2.getOriginNode();
    const ring1b = eng2.materializeNeighbors(origin2.id).neighbors;
    const unrelated = ring1b[3];
    eng2.materializeNeighbors(unrelated.id); // unrelated prior materialization
    const nodeA2 = eng2.materializeNeighbors(origin2.id).neighbors[0];
    const ring2b = eng2.materializeNeighbors(nodeA2.id).neighbors;
    const nodeC2 = ring2b.find((n) => n.id !== origin2.id && n.id !== nodeA2.id);

    assert.equal(nodeC2.id, nodeC.id, 'the same chain must reach the same coordinate/id regardless of order');
    assert.deepEqual(terrainOf(nodeC2), direct, 'terrain must be identical despite unrelated prior materialization');
    record(`K1 PASSED: terrain at (${cx.toFixed(3)}, ${cy.toFixed(3)}) is identical direct, via-chain, and after unrelated churn → ${direct.terrainType}`);
  }

  // --- K2: reconciliation + real reverse heading -----------------------------
  // (a) Zero-jitter world: the East neighbor's West candidate lands exactly on
  //     the origin, so it must reconcile to the existing origin (not duplicate).
  // (b) The reverse edge heading must be computed from real coords.
  // (c) computeHeading is genuinely coordinate-derived — for an off-axis
  //     reconciled target it is NOT the naive opposite of the attempted heading.
  {
    const { engine } = mapEngineWith({ distanceJitter: 0, angleJitterDegrees: 0 });
    const origin = engine.getOriginNode();
    const res1 = engine.materializeNeighbors(origin.id);
    const eastId = res1.edges.find((e) => e.heading === 'E').to;
    const east = engine.getNode(eastId);

    const res2 = engine.materializeNeighbors(east.id);
    assert.ok(res2.reconciled >= 1, 'East\'s back-candidate must reconcile to an existing node, not duplicate');
    // No duplicate node was created at the origin: the nearest node to the
    // origin's own coordinate is still the origin itself. (The seed node sits at
    // the nearest passable coordinate to (0,0), which need not be exactly (0,0).)
    assert.equal(engine.getNodeAt(origin.x, origin.y).id, origin.id, 'reconciliation must connect to the existing origin, not spawn a twin');
    // Bidirectional edge exists both ways.
    assert.ok(origin.edges.some((e) => e.to === east.id), 'origin -> East edge must exist');
    const backEdge = east.edges.find((e) => e.to === origin.id);
    assert.ok(backEdge, 'East -> origin reverse edge must exist');
    // (b) reverse heading equals computeHeading from the real coordinates.
    assert.equal(
      backEdge.heading,
      computeHeading(east.x, east.y, origin.x, origin.y),
      'reverse edge heading must be computed from the real relative coordinates'
    );
    assert.equal(backEdge.heading, 'W', 'East node due-west of origin must head back W');
    record(`K2a PASSED: East's back-candidate reconciled to the existing origin (reconciled=${res2.reconciled}, no duplicate); reverse heading '${backEdge.heading}' from real coords`);

    // (c) Pure isolation of the heading rule: an attempted 'E' edge whose
    // reconciled target actually sits to the north-east. The reverse heading is
    // 'SW' — the true opposite of the target's real bearing, and NOT 'W' (the
    // naive opposite of the attempted direction). Proves reverse headings are
    // never assumed-opposite.
    assert.equal(computeHeading(0, 0, 6, 8), 'NE', 'bearing to (6,8) is NE');
    const reverseReal = computeHeading(6, 8, 0, 0);
    assert.equal(reverseReal, 'SW', 'reverse bearing from (6,8) is SW');
    assert.notEqual(reverseReal, OPPOSITE['E'], 'real reverse heading must differ from the naive opposite of the attempted direction');
    record(`K2c PASSED: off-axis reconciled target → reverse heading '${reverseReal}', NOT the assumed opposite '${OPPOSITE['E']}' of the attempted 'E'`);
  }

  // --- K3: passability falloff (STATISTICAL — note the different check style) -
  // This is NOT an exact-equality assertion like the rest of the section: it is
  // a statistical claim over many samples. At the same far radius, a larger
  // worldSize (slower falloff) must yield a higher passable RATE than a smaller
  // one. We sample a full ring of angles and compare aggregate rates.
  {
    const cfgSmall = mapConfigWith({ worldSize: 0.5 });
    const cfgLarge = mapConfigWith({ worldSize: 3.0 });
    const R = 300;
    const SAMPLES = 360;
    let passSmall = 0;
    let passLarge = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const a = (i / SAMPLES) * Math.PI * 2;
      const x = R * Math.cos(a);
      const y = R * Math.sin(a);
      if (deriveTerrainAt(cfgSmall, x, y).passable) passSmall++;
      if (deriveTerrainAt(cfgLarge, x, y).passable) passLarge++;
    }
    const rateSmall = passSmall / SAMPLES;
    const rateLarge = passLarge / SAMPLES;
    assert.ok(
      rateLarge > rateSmall,
      `larger worldSize must be more passable at radius ${R} (large ${rateLarge} vs small ${rateSmall})`
    );
    record(`K3 PASSED: at radius ${R}, passable rate large-world ${rateLarge.toFixed(3)} > small-world ${rateSmall.toFixed(3)} (${SAMPLES} samples, statistical)`);
  }

  // --- K4: impassable nodes still exist and are retrievable ------------------
  // Walk outward in a tight world (fast falloff) until a materialized neighbor
  // resolves to impassable terrain; it must still be stored and retrievable via
  // getNode, just flagged passable:false.
  {
    const { engine } = mapEngineWith({ worldSize: 0.3 });
    const visited = new Set();
    let current = engine.getOriginNode();
    visited.add(current.id);
    let impassable = null;
    for (let hop = 0; hop < 300 && !impassable; hop++) {
      const res = engine.materializeNeighbors(current.id);
      impassable = res.neighbors.find((n) => !n.passable) ?? null;
      if (impassable) break;
      // Step to the farthest-from-origin unvisited passable neighbor.
      let next = null;
      let nextDist = -1;
      for (const n of res.neighbors) {
        if (visited.has(n.id)) continue;
        const d = Math.hypot(n.x, n.y);
        if (d > nextDist) {
          next = n;
          nextDist = d;
        }
      }
      if (!next) break;
      visited.add(next.id);
      current = next;
    }
    assert.ok(impassable, 'walking outward must eventually materialize an impassable node');
    assert.equal(impassable.passable, false, 'the impassable node must be flagged passable:false');
    const fetched = engine.getNode(impassable.id);
    assert.ok(fetched, 'the impassable node must still be stored and retrievable via getNode');
    assert.equal(fetched.passable, false, 'the retrieved impassable node is still passable:false');
    record(`K4 PASSED: impassable '${fetched.terrainType}' node ${fetched.id} exists and is retrievable, flagged passable:false`);
  }

  // --- K5: cache rebuildability ----------------------------------------------
  // rebuildNodeAt re-derives from scratch, ignoring the cache; its derivable
  // fields must equal the cached node's (edges excluded — they are
  // materialization state, not a property of the coordinate).
  {
    const cfg = mapConfigWith();
    const engine = createWorldMapEngine(createWorldState(cfg));
    const origin = engine.getOriginNode();
    const node = engine.materializeNeighbors(origin.id).neighbors[0];
    const rebuilt = engine.rebuildNodeAt(cfg, node.x, node.y);
    assert.deepEqual(rebuilt, stripEdges(engine.getNode(node.id)), 'rebuilt-from-scratch node must equal the cached node');
    assert.deepEqual(rebuilt, deriveNodeAt(cfg, node.x, node.y), 'rebuildNodeAt must equal the pure deriveNodeAt');
    assert.equal(engine.getNodeAt(node.x, node.y).id, node.id, 'getNodeAt must find the cached node at its own coordinate');
    assert.equal(rebuilt.id, nodeIdFor(node.x, node.y), 'node id must be the deterministic id-for-coordinate');
    // The seed node itself must be passable AND still rebuildable — the nearest-
    // passable-origin fix must not special-case the cache away from the pure
    // derivation. (For the shipped seed, (0,0) rolls an impassable cliff, so the
    // origin genuinely moves.)
    assert.equal(origin.passable, true, 'the seeded origin node must be passable');
    assert.deepEqual(engine.rebuildNodeAt(cfg, origin.x, origin.y), stripEdges(origin), 'the moved origin must still be rebuildable from scratch');
    record(`K5 PASSED: cache is redundant — rebuildNodeAt matches getNode/getNodeAt for ${node.id}; origin (${origin.x.toFixed(3)}, ${origin.y.toFixed(3)}) is passable and rebuildable`);
  }
}

// K1–K5, printed once.
const sectionKLinesA = [];
runSectionK((m) => {
  sectionKLinesA.push(m);
  console.log(m);
});

// --- K6: determinism across full runs --------------------------------------
// Run the entire section a second time and assert the emitted output is byte-
// identical to the first run.
const sectionKLinesB = [];
runSectionK((m) => sectionKLinesB.push(m));
assert.deepEqual(sectionKLinesA, sectionKLinesB, 'Section K output must be byte-identical across two full runs');
console.log(`K6 PASSED: Section K produced identical output across two full runs (${sectionKLinesA.length} lines)`);

console.log('\nSection K PASSED: terrain is a pure function of (seed, coords); lazy generation reconciles into a converging graph, impassable nodes persist, and the cache is provably redundant');

// =============================================================================
// Section L: WorldMapEngine node classification — settlements, faction control,
// and environmental notability/hospitability.
//
// Classification is layered on top of Section K's terrain. Settlement placement,
// tier, notability, and hospitability are PURE derived values (deriveTerrainAt
// discipline): the load-bearing property, exactly as in K1, is determinism BY
// POSITION not by exploration order — reaching a region different ways must not
// change which nodes are settlements or at what tier. Min-spacing is enforced by
// a pure priority-based Poisson-disk over a deterministic settlement lattice, so
// it needs no arrival-ordered cache. Faction control is the ONE two-layer piece:
// a derived baseline overridden by FACTION_CONTROL_CHANGED log events, replayed
// last-write-wins exactly like deriveActiveTimeContext (Section F) and proved
// rebuildable-from-the-log like relationship stats (Section G5).
// =============================================================================
console.log('\n=== Section L: WorldMapEngine node classification (settlements / faction / environment) ===');

// A config variant helper for classification scenarios: clones the shipped
// config and overrides worldMap.classification.settlement / .environment, the
// same escape hatch mapConfigWith uses for terrain.
function classConfigWith(settlementOverrides = {}, environmentOverrides = {}) {
  const cfg = structuredClone(mapBaseConfig);
  const c = cfg.worldMap.classification;
  cfg.worldMap.classification = {
    ...c,
    settlement: { ...c.settlement, ...settlementOverrides },
    faction: { ...c.faction },
    environment: { ...c.environment, ...environmentOverrides },
  };
  return cfg;
}

function runSectionL(record) {
  // Collect every ACCEPTED settlement site in a (2R+1)^2 block of cells, sorted
  // by id for a stable, order-independent comparison value.
  function collectAccepted(cfg, R, reverse = false) {
    const out = [];
    const xs = [];
    for (let cx = -R; cx <= R; cx++) xs.push(cx);
    if (reverse) xs.reverse();
    for (const cx of xs) {
      for (let dy = 0; dy <= 2 * R; dy++) {
        const cy = reverse ? R - dy : -R + dy;
        const site = isSettlementSiteAccepted(cfg, cx, cy);
        if (site) out.push(site);
      }
    }
    out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return out;
  }
  const acceptedKey = (list) => list.map((s) => `${s.id}:${s.tier}`);

  // --- L1: settlement classification is order-independent (LOAD-BEARING) ------
  // (a) The accepted-settlement SET is identical whether cells are scanned
  //     forward or reversed. (b) A chosen settlement coordinate classifies
  //     byte-identically via a fresh pure derivation and via two engines whose
  //     shared classification caches were warmed by exploring UNRELATED regions
  //     in different orders first.
  {
    const cfg = mapConfigWith();
    const R = 12;
    const forward = collectAccepted(cfg, R, false);
    const reverse = collectAccepted(cfg, R, true);
    assert.deepEqual(acceptedKey(reverse), acceptedKey(forward), 'accepted settlement set must be identical regardless of cell scan order');
    assert.ok(forward.length > 0, 'the scanned region must contain at least one settlement');

    const site = forward[0];
    const direct = deriveClassificationAt(cfg, site.x, site.y);
    assert.equal(direct.kind, 'settlement', 'a chosen accepted site must classify as a settlement');
    assert.equal(direct.tier, site.tier, 'the node tier must match the accepted site tier');

    const engA = createWorldMapEngine(createWorldState(mapConfigWith()));
    engA.classifyAt(600, -400); // warm the shared ctx with far, unrelated cells
    engA.classifyAt(-520, 310);
    const viaA = engA.classifyAt(site.x, site.y);

    const engB = createWorldMapEngine(createWorldState(mapConfigWith()));
    engB.classifyAt(-900, 900); // a DIFFERENT warming order/region
    engB.classifyAt(240, 770);
    engB.classifyAt(-100, -880);
    const viaB = engB.classifyAt(site.x, site.y);

    assert.deepEqual(viaA, direct, 'classification via a warmed shared cache must equal the fresh derivation');
    assert.deepEqual(viaB, viaA, 'classification must be identical no matter how the shared cache was warmed');
    record(`L1 PASSED: ${forward.length} settlements in ${2 * R + 1}^2 cells, set is scan-order-independent; site ${site.id} classifies identically fresh + via two differently-warmed caches → ${direct.tier}`);
  }

  // --- L2: priority-based Poisson-disk spacing, incl. the CAPITAL-tier hazard --
  // (a) Shipped config: no two accepted settlements are closer than their
  //     tier-scaled spacing. (b) A suppressed-but-suitable candidate always has a
  //     higher-priority accepted neighbor within range. (c) CAPITAL case: with a
  //     config where every site is a capital, spacing is the widest tier value,
  //     and suppression provably reaches BEYOND the base minSpacing — the exact
  //     case a fixed base-minSpacing search window would miss.
  {
    const cfg = mapConfigWith();
    const R = 16;
    const acc = collectAccepted(cfg, R);
    for (let i = 0; i < acc.length; i++) {
      for (let j = i + 1; j < acc.length; j++) {
        const a = acc[i];
        const b = acc[j];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const req = Math.max(settlementSpacingOf(cfg, a.tier), settlementSpacingOf(cfg, b.tier));
        assert.ok(d >= req, `accepted settlements ${a.id}/${b.id} must be >= tier-scaled spacing apart (${d.toFixed(1)} >= ${req})`);
      }
    }

    // A suppressed suitable candidate must have a strictly-higher-priority,
    // itself-accepted neighbor within the shared spacing — i.e. suppression is
    // never arbitrary. The suppressor is found by scanning the candidate's OWN
    // searchCellRadius neighborhood (it may sit just outside the collected
    // region), the same window the derivation uses.
    const sr = settlementSearchCellRadius(cfg);
    const higherPriority = (a, b) =>
      settlementSpacingOf(cfg, a.tier) > settlementSpacingOf(cfg, b.tier) ||
      (a.tier === b.tier && (a.suitability > b.suitability || (a.suitability === b.suitability && (a.cx < b.cx || (a.cx === b.cx && a.cy < b.cy)))));
    let suppressedChecked = 0;
    for (let cx = -R; cx <= R && suppressedChecked < 3; cx++) {
      for (let cy = -R; cy <= R && suppressedChecked < 3; cy++) {
        const cand = deriveSettlementSiteInCell(cfg, cx, cy);
        if (!cand || isSettlementSiteAccepted(cfg, cx, cy)) continue; // suitable but suppressed
        let suppressor = null;
        for (let dx = -sr; dx <= sr && !suppressor; dx++) {
          for (let dy = -sr; dy <= sr; dy++) {
            const other = isSettlementSiteAccepted(cfg, cx + dx, cy + dy);
            if (!other || !higherPriority(other, cand)) continue;
            const d = Math.hypot(other.x - cand.x, other.y - cand.y);
            const req = Math.max(settlementSpacingOf(cfg, other.tier), settlementSpacingOf(cfg, cand.tier));
            if (d < req) { suppressor = other; break; }
          }
        }
        assert.ok(suppressor, `suppressed suitable candidate settlement_${cx}_${cy} must have a higher-priority accepted neighbor within range`);
        suppressedChecked++;
      }
    }
    assert.ok(suppressedChecked > 0, 'the region must contain at least one suppressed suitable candidate to justify');

    // (c) Capital-tier hazard: force every suitable site to capital tier.
    const capCfg = classConfigWith({
      tierThresholds: { hamlet: 0, village: 0, town: 0, city: 0, capital: 0 },
    });
    const capSpacing = settlementSpacingOf(capCfg, 'capital');
    const baseMin = capCfg.worldMap.classification.settlement.minSpacing;
    const cellSize = capCfg.worldMap.classification.settlement.cellSize;
    assert.equal(capSpacing, maxSettlementSpacing(capCfg), 'capital spacing must be the max tier-scaled spacing');
    const searchR = settlementSearchCellRadius(capCfg);
    const naiveR = Math.ceil(baseMin / cellSize) + 1;
    assert.equal(searchR, Math.ceil(capSpacing / cellSize) + 1, 'search radius must derive from capital spacing, not base minSpacing');
    assert.ok(searchR > naiveR, `capital-derived search radius (${searchR}) must exceed a naive base-minSpacing window (${naiveR}) — the fixed-window bug`);

    const capAcc = collectAccepted(capCfg, 6);
    let longRangeSuppression = false;
    for (let cx = -6; cx <= 6 && !longRangeSuppression; cx++) {
      for (let cy = -6; cy <= 6 && !longRangeSuppression; cy++) {
        const cand = deriveSettlementSiteInCell(capCfg, cx, cy);
        if (!cand || isSettlementSiteAccepted(capCfg, cx, cy)) continue;
        for (const a of capAcc) {
          const d = Math.hypot(a.x - cand.x, a.y - cand.y);
          if (d > baseMin && d < capSpacing) { longRangeSuppression = true; break; }
        }
      }
    }
    assert.ok(longRangeSuppression, 'a capital must suppress a suitable candidate that lies BEYOND base minSpacing but within capital spacing');
    record(`L2 PASSED: ${acc.length} settlements all >= tier-scaled spacing; suppression justified by priority; capital search radius ${searchR} > naive ${naiveR}, suppression reaches beyond base minSpacing (${baseMin}) up to capital spacing (${capSpacing})`);
  }

  // --- L3: classification cache is provably redundant (K5-analogue) -----------
  // Materialize nodes in an engine; a cached node's classification must equal
  // both rebuildClassificationAt (fresh scan) and the pure deriveClassificationAt.
  {
    const cfg = mapConfigWith();
    const engine = createWorldMapEngine(createWorldState(cfg));
    const origin = engine.getOriginNode();
    const ring = engine.materializeNeighbors(origin.id).neighbors;
    const node = ring[2];
    assert.ok(node.classification, 'a materialized node must carry a classification');
    assert.deepEqual(node.classification, engine.rebuildClassificationAt(cfg, node.x, node.y), 'cached classification must equal a fresh-scan rebuild');
    assert.deepEqual(node.classification, deriveClassificationAt(cfg, node.x, node.y), 'cached classification must equal the pure derivation');
    assert.deepEqual(engine.rebuildNodeAt(cfg, node.x, node.y), stripEdges(engine.getNode(node.id)), 'the whole rebuilt node (terrain + classification) must equal the cached node');
    record(`L3 PASSED: classification cache is redundant — cached == fresh rebuild == pure derivation for ${node.id} (${node.classification.kind})`);
  }

  // --- L4: notability is sparse and coherent (STATISTICAL, K3-analogue) -------
  // High notability must be rare (a small fraction above the landmark threshold)
  // yet present (landmarks exist), and coherent: nearby coordinates differ less
  // than far-apart ones — i.e. it is coherent noise, not a uniform per-node roll.
  {
    const cfg = mapConfigWith();
    const env = cfg.worldMap.classification.environment;
    let above = 0;
    let total = 0;
    let maxN = 0;
    for (let i = 0; i < 6400; i++) {
      const x = (i % 80) * 6 - 240;
      const y = Math.floor(i / 80) * 6 - 240;
      const n = deriveNotability(cfg, x, y);
      if (n > env.notabilityLandmarkThreshold) above++;
      if (n > maxN) maxN = n;
      total++;
    }
    const frac = above / total;
    assert.ok(frac > 0 && frac < 0.15, `landmarks must be rare-but-present (fraction above threshold ${frac.toFixed(4)} in (0, 0.15))`);
    assert.ok(maxN > env.notabilityLandmarkThreshold, 'at least one sampled node must exceed the landmark threshold');

    // Coherence: mean |Δnotability| for near pairs < for far pairs.
    let nearSum = 0;
    let farSum = 0;
    const PAIRS = 300;
    for (let i = 0; i < PAIRS; i++) {
      const x = (i * 13) % 500 - 250;
      const y = (i * 29) % 500 - 250;
      nearSum += Math.abs(deriveNotability(cfg, x, y) - deriveNotability(cfg, x + 2, y + 2));
      farSum += Math.abs(deriveNotability(cfg, x, y) - deriveNotability(cfg, x + 137, y + 211));
    }
    assert.ok(nearSum / PAIRS < farSum / PAIRS, `notability must be coherent: near-pair delta (${(nearSum / PAIRS).toFixed(4)}) < far-pair delta (${(farSum / PAIRS).toFixed(4)})`);
    record(`L4 PASSED: notability sparse (${(frac * 100).toFixed(2)}% landmarks, max ${maxN.toFixed(3)}) and coherent (near Δ ${(nearSum / PAIRS).toFixed(4)} < far Δ ${(farSum / PAIRS).toFixed(4)})`);
  }

  // --- L5: hospitability is the single suitability source ---------------------
  // The scalar a wilderness node carries is exactly deriveHospitability at its
  // coordinate, and it is the SAME scalar that gated settlement placement
  // (a settlement site's hospitability clears the suitability threshold). It also
  // tracks terrain: pastoral high, hostile low.
  {
    const cfg = mapConfigWith();
    const s = cfg.worldMap.classification.settlement;
    const site = collectAccepted(cfg, 12)[0];
    assert.ok(deriveHospitability(cfg, site.x, site.y) >= s.suitabilityThreshold, 'a placed settlement site must clear the suitability threshold (same scalar)');

    // A wilderness node exposes hospitability == deriveHospitability, notability set.
    let wild = null;
    for (let i = 0; i < 2000 && !wild; i++) {
      const x = (i % 40) * 7 - 140;
      const y = Math.floor(i / 40) * 7 - 175;
      const c = deriveClassificationAt(cfg, x, y);
      if (c.kind === 'wilderness') wild = { x, y, c };
    }
    assert.ok(wild, 'the region must contain a wilderness node');
    assert.equal(wild.c.hospitability, deriveHospitability(cfg, wild.x, wild.y), 'wilderness hospitability must equal deriveHospitability (single source)');
    assert.equal(wild.c.tier, null, 'a wilderness node has no settlement tier');
    assert.ok(typeof wild.c.notability === 'number', 'a wilderness node carries a notability scalar');

    // Terrain correlation: hostile deep-water/cliff is less hospitable than a
    // pastoral plains/shore coordinate somewhere in the region.
    let hostileMin = 1;
    let benignMax = 0;
    for (let i = 0; i < 3000; i++) {
      const x = (i % 60) * 8 - 240;
      const y = Math.floor(i / 60) * 8 - 200;
      const tt = deriveTerrainAt(cfg, x, y).terrainType;
      const h = deriveHospitability(cfg, x, y);
      if (tt === 'deep_water' || tt === 'cliff') hostileMin = Math.min(hostileMin, h);
      if (tt === 'plains' || tt === 'shore') benignMax = Math.max(benignMax, h);
    }
    assert.ok(benignMax > hostileMin, `pastoral terrain must reach higher hospitability than hostile terrain (${benignMax.toFixed(3)} > ${hostileMin.toFixed(3)})`);
    record(`L5 PASSED: hospitability is one source — settlement gate uses it, wilderness reuses it; pastoral ${benignMax.toFixed(3)} > hostile ${hostileMin.toFixed(3)}`);
  }

  // --- L6: faction control = derived baseline + log override (G5-analogue) ----
  // Baseline is pure/position-deterministic. FACTION_CONTROL_CHANGED events
  // override it last-write-wins (null is a real value: "taken to uncontrolled"),
  // a never-overridden settlement returns its baseline, and getFactionControl is
  // always rebuildable from the log alone.
  {
    const cfg = mapConfigWith();
    const site = collectAccepted(cfg, 12)[0];
    const classification = deriveClassificationAt(cfg, site.x, site.y);
    const node = { id: 'l6_node', x: site.x, y: site.y, classification };
    const baseline = classification.baselineFaction;

    // Baseline is pure + derived at the site.
    assert.equal(deriveBaselineFactionControl(cfg, site.x, site.y), deriveBaselineFactionControl(cfg, site.x, site.y), 'baseline faction must be deterministic');
    assert.equal(classification.baselineFaction, deriveBaselineFactionControl(cfg, site.x, site.y), 'a settlement carries the baseline faction derived at its site');

    const world = createWorldState(mapConfigWith());
    const factions = createFactionEngine(world); // built BEFORE any dispatch

    // A never-overridden settlement returns its baseline.
    assert.equal(factions.getFactionControl(node), baseline ?? null, 'an un-overridden settlement returns its derived baseline');
    assert.equal(factions.rebuildFactionControl(node), baseline ?? null, 'rebuild of an un-overridden settlement equals the baseline');

    // Override sequence, asserting last-write-wins + rebuild equality each step.
    const steps = ['faction_2', null, 'faction_0'];
    for (const target of steps) {
      factions.setFactionControl(node.classification.settlementId, target);
      assert.equal(factions.getFactionControl(node), target, `getFactionControl must reflect the latest FACTION_CONTROL_CHANGED (${String(target)})`);
      assert.equal(factions.rebuildFactionControl(node), factions.getFactionControl(node), 'rebuilt-from-log control must equal the cached control');
      assert.equal(deriveFactionControl(world.getEventLog(), node.classification.settlementId, baseline), target, 'pure deriveFactionControl must agree with the cache');
    }
    record(`L6 PASSED: faction baseline (${String(baseline)}) overridden last-write-wins → ${String(steps[steps.length - 1])}; rebuild-from-log matches at every step`);
  }
}

// L1–L6, printed once.
const sectionLLinesA = [];
runSectionL((m) => {
  sectionLLinesA.push(m);
  console.log(m);
});

// --- L7: determinism across full runs (K6-analogue) --------------------------
// Run the entire section a second time and assert byte-identical output.
const sectionLLinesB = [];
runSectionL((m) => sectionLLinesB.push(m));
assert.deepEqual(sectionLLinesA, sectionLLinesB, 'Section L output must be byte-identical across two full runs');
console.log(`L7 PASSED: Section L produced identical output across two full runs (${sectionLLinesA.length} lines)`);

console.log('\nSection L PASSED: classification is a pure function of (seed, coords) with order-independent settlement placement; faction control is a derived baseline overridden last-write-wins by the log and is rebuildable from it');

// =============================================================================
// Section M: POI engine — the discoverable content INSIDE a node.
//
// This layer reuses BOTH established disciplines at once. The BASELINE POOL is a
// PURE function of (config, seed, node) — the deriveTerrainAt / deriveClassifica-
// tionAt discipline — so the load-bearing property (M1, the K1/L1 analogue) is,
// again, determinism BY POSITION not by exploration order or visit count, and the
// pool is never re-rolled on a repeat visit. DISCOVERY, INJECTION, and REVEAL
// AUTHORITY are events, so they take the log-replay + provably-redundant-cache
// shape of the faction/relationship/clock engines; M6 (the L3/G5/L6 analogue) is
// their rebuild-from-the-log proof. The blind roll is a FLAT success chance over
// a finite, permanently-shrinking undiscovered set — there is deliberately no
// diminishing-returns curve (M3). Exploring costs game-time purely by carrying
// timeContext:'exploring', which the already-proven WorldClock picks up with zero
// engine changes (M7). Uses the same createWorldState()/mapConfigWith() escape
// hatch as Sections K/L, and synthetic hand-authored node classifications where a
// specific tier/notability is needed for a controlled scenario.
// =============================================================================
console.log('\n=== Section M: POI engine (per-node points of interest) ===');

function runSectionM(record) {
  // Synthetic nodes with hand-authored classifications, so a scenario can pin an
  // exact tier / notability without hunting the real graph for one. deriveBaseline-
  // Pois is PURE over (config, node), so a synthetic node is a first-class input.
  const synthSettlement = (tier, x, y) => ({
    id: `syn_${tier}_${x}_${y}`,
    x,
    y,
    classification: { kind: 'settlement', tier, settlementId: `syn_${tier}`, baselineFaction: null, notability: null, hospitability: null },
  });
  const synthWild = (notability, hospitability, x, y) => ({
    id: `syn_wild_${x}_${y}`,
    x,
    y,
    classification: { kind: 'wilderness', tier: null, settlementId: null, baselineFaction: null, notability, hospitability },
  });

  // The first accepted settlement site in a cell block, sorted by id (the L-section
  // convention) for a stable, order-independent pick.
  function firstAcceptedSite(cfg, R) {
    const sites = [];
    for (let cx = -R; cx <= R; cx++) {
      for (let cy = -R; cy <= R; cy++) {
        const s = isSettlementSiteAccepted(cfg, cx, cy);
        if (s) sites.push(s);
      }
    }
    sites.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return sites[0];
  }

  // A deterministic scan for a capital-tier synthetic node whose baseline pool is
  // rich enough to exercise M2-M4: at least one hidden POI, at least one non-hidden
  // POI, and >= 3 distinct categories. Folding the requirements into the scan keeps
  // the later assertions robust (and still fully deterministic — same cfg ⇒ same
  // node every run).
  function findCapitalNode(cfg) {
    for (let i = 0; i < 20000; i++) {
      const x = (i % 140) * 3 + 1000;
      const y = Math.floor(i / 140) * 3 + 1000;
      const node = synthSettlement('capital', x, y);
      const pool = deriveBaselinePois(cfg, node);
      const hidden = pool.filter((p) => p.hidden);
      const shown = pool.filter((p) => !p.hidden);
      const distinct = new Set(pool.map((p) => p.category)).size;
      if (hidden.length > 0 && shown.length > 0 && distinct >= 3) return { node, pool };
    }
    throw new Error('Section M: no suitable capital node found (config drift?)');
  }

  const cfg = mapConfigWith();
  const capital = findCapitalNode(cfg);

  // --- M1: baseline pool determinism BY POSITION (LOAD-BEARING, K1/L1 analogue) --
  // A settlement's baseline pool (ids, categories, prominence, hidden) is byte-
  // identical derived fresh, derived through a classification cache warmed by
  // exploring unrelated regions in two DIFFERENT orders, and re-derived on a repeat
  // "visit" — proving the pool is fixed by position, never re-rolled per visit.
  {
    const site = firstAcceptedSite(cfg, 12);
    const node = deriveNodeAt(cfg, site.x, site.y);
    assert.equal(node.classification.kind, 'settlement', 'the chosen accepted site must classify as a settlement');
    const direct = deriveBaselinePois(cfg, node);
    assert.ok(direct.length > 0, 'a settlement node must have a non-empty baseline pool');
    assert.ok(direct.every((p) => p.id === `poi_${node.id}_b${direct.indexOf(p)}`), 'baseline ids are deterministic poi_<nodeId>_b<i>');

    const engA = createWorldMapEngine(createWorldState(mapConfigWith()));
    engA.classifyAt(600, -400); // warm the shared classification ctx with far cells
    engA.classifyAt(-520, 310);
    const clsA = engA.classifyAt(site.x, site.y);
    const poolA = deriveBaselinePois(cfg, { id: nodeIdFor(site.x, site.y), x: site.x, y: site.y, classification: clsA });

    const engB = createWorldMapEngine(createWorldState(mapConfigWith()));
    engB.classifyAt(-900, 900); // a DIFFERENT warming order/region
    engB.classifyAt(240, 770);
    engB.classifyAt(-100, -880);
    const clsB = engB.classifyAt(site.x, site.y);
    const poolB = deriveBaselinePois(cfg, { id: nodeIdFor(site.x, site.y), x: site.x, y: site.y, classification: clsB });

    assert.deepEqual(poolA, direct, 'pool via a differently-warmed cache must equal the fresh derivation');
    assert.deepEqual(poolB, poolA, 'pool must be identical no matter how the cache was warmed');
    assert.deepEqual(deriveBaselinePois(cfg, node), direct, 're-deriving on a repeat visit must yield the identical pool (never re-rolled)');
    record(`M1 PASSED: settlement ${node.id} (${node.classification.tier}) baseline pool of ${direct.length} POIs is position-deterministic — identical fresh, via two differently-warmed caches, and on repeat visit`);
  }

  // --- M2: pool richness scales with classification --------------------------
  // Higher settlement tier ⇒ larger pool AND richer category variety (tier-gated);
  // a highly notable wilderness node is POI-rich; a hostile, mundane one is empty.
  {
    const poolSizes = cfg.worldMap.poi.settlement.poolSizeByTier;
    const hamlet = deriveBaselinePois(cfg, synthSettlement('hamlet', 3000, 3000));
    const capitalPool = capital.pool;
    assert.equal(hamlet.length, poolSizes.hamlet, 'hamlet pool size equals its per-tier config lookup');
    assert.equal(capitalPool.length, poolSizes.capital, 'capital pool size equals its per-tier config lookup');
    assert.ok(capitalPool.length > hamlet.length, 'a capital pool must be larger than a hamlet pool');
    for (const p of hamlet) {
      assert.ok(['shop', 'tavern'].includes(p.category), `hamlet categories are tier-gated to shop/tavern (saw ${p.category})`);
    }
    const hamletDistinct = new Set(hamlet.map((p) => p.category)).size;
    const capitalDistinct = new Set(capitalPool.map((p) => p.category)).size;
    assert.ok(capitalDistinct > hamletDistinct, `a capital must offer richer category variety (${capitalDistinct} > ${hamletDistinct})`);

    const richWild = deriveBaselinePois(cfg, synthWild(1.0, 0.8, 4000, 4000));
    const barrenWild = deriveBaselinePois(cfg, synthWild(0.0, 0.0, 5000, 5000));
    assert.ok(richWild.length > 0, 'a highly notable wilderness node must be POI-rich');
    assert.equal(barrenWild.length, 0, 'a hostile, mundane wilderness node must yield an empty pool');
    record(`M2 PASSED: hamlet ${hamlet.length} POIs (${hamletDistinct} categories) < capital ${capitalPool.length} POIs (${capitalDistinct} categories); notable wilderness ${richWild.length} POIs, barren wilderness ${barrenWild.length}`);
  }

  // --- M3: blind explore — flat chance, finite shrinking pool, bounded & det. --
  // Repeated blind explores accumulate discoveries (non-hidden only); once the
  // non-hidden pool is exhausted, blind explore returns null forever (bounded —
  // can never exceed the finite pool, never re-rolls a found POI). attemptIndex is
  // proven to be the pure log-derived count at every step. Hidden POIs never
  // surface blindly. An identical sequence on a fresh world yields identical finds.
  {
    const node = capital.node;
    const pool = capital.pool;
    const nonHidden = pool.filter((p) => !p.hidden);
    const hiddenIds = new Set(pool.filter((p) => p.hidden).map((p) => p.id));

    const world = createWorldState(mapConfigWith());
    const poi = createPoiEngine(world);

    const discoveries = [];
    let attempts = 0;
    const CAP = 1000;
    while (attempts < CAP && poi.getPoiState(node).undiscovered.some((p) => !p.hidden)) {
      // attemptIndex is a PURE log replay, equal to the number of blind attempts
      // so far — no engine-side counter is consulted.
      assert.equal(deriveBlindAttemptCount(world.getEventLog(), node.id), attempts, 'attemptIndex must be the pure log-derived blind-attempt count');
      const found = poi.exploreBlind(node);
      if (found) discoveries.push(found);
      attempts++;
    }
    assert.ok(attempts < CAP, 'blind exploration must exhaust the non-hidden pool well within the cap');

    const discovered = poi.getPoiState(node).discovered;
    for (const p of nonHidden) assert.ok(discovered.has(p.id), `every non-hidden POI must eventually be found blindly (missing ${p.id})`);
    for (const id of hiddenIds) assert.ok(!discovered.has(id), `a hidden POI must never surface via blind exploration (leaked ${id})`);
    assert.equal(discoveries.length, nonHidden.length, 'total blind discoveries cannot exceed the finite non-hidden pool');
    assert.equal(poi.exploreBlind(node), null, 'blind explore on an exhausted non-hidden pool returns null (bounded)');
    assert.equal(poi.exploreBlind(node), null, 'still null — the shrunken pool is never re-rollable');

    // Determinism (E2 analogue): a fixed explore sequence on two fresh worlds.
    function runBlind(n) {
      const w = createWorldState(mapConfigWith());
      const e = createPoiEngine(w);
      const out = [];
      for (let i = 0; i < n; i++) {
        const f = e.exploreBlind(node);
        if (f) out.push(f);
      }
      return out;
    }
    assert.deepEqual(runBlind(40), runBlind(40), 'an identical blind-explore sequence on a fresh world must yield identical discoveries');
    record(`M3 PASSED: ${attempts} flat-chance attempts found all ${nonHidden.length} non-hidden POIs (0 of ${hiddenIds.size} hidden), then null forever; attemptIndex log-derived; sequence deterministic`);
  }

  // --- M4: directed explore + reveal authority -------------------------------
  // Without authority a directed request for a hidden POI falls back to blind and
  // cannot surface it; with authority it discovers exactly that hidden POI,
  // bypassing the roll; a request for an id not in the pool is a safe blind
  // fallback (never throws).
  {
    const node = capital.node;
    const hidden = capital.pool.find((p) => p.hidden);

    const w1 = createWorldState(mapConfigWith());
    const poi1 = createPoiEngine(w1);
    poi1.exploreDirected(node, hidden.id); // no authority ⇒ blind fallback
    assert.ok(!poi1.getPoiState(node).discovered.has(hidden.id), 'directed WITHOUT authority must not surface a hidden POI');

    const w2 = createWorldState(mapConfigWith());
    const poi2 = createPoiEngine(w2);
    poi2.grantRevealAuthority(hidden.id);
    const got = poi2.exploreDirected(node, hidden.id);
    assert.equal(got, hidden.id, 'directed WITH authority must discover exactly the requested hidden POI');
    assert.ok(poi2.getPoiState(node).discovered.has(hidden.id), 'the authorized hidden POI is now discovered');

    const w3 = createWorldState(mapConfigWith());
    const poi3 = createPoiEngine(w3);
    assert.doesNotThrow(() => poi3.exploreDirected(node, 'poi_does_not_exist'), 'directed for an id not in the pool must be a safe blind fallback, not a throw');
    record(`M4 PASSED: hidden POI ${hidden.id} unreachable without authority, discovered directly (roll bypassed) with it; unknown-id directed request is a safe blind fallback`);
  }

  // --- M5: injection after generation ----------------------------------------
  // injectPoi adds a POI to a node's pool even after it has been explored; it does
  // NOT auto-surface (stays undiscovered until explored/directed); it is then
  // discoverable; the injected pool is log-derived.
  {
    const node = synthSettlement('village', 6000, 6000);
    const world = createWorldState(mapConfigWith());
    const poi = createPoiEngine(world);
    poi.exploreBlind(node); // visit BEFORE injecting, to prove post-visit injection works

    const injected = poi.injectPoi(node.id, { id: 'poi_inj_lair', category: 'bandit_lair', prominence: 0.9, hidden: false, data: {} });
    const state = poi.getPoiState(node);
    assert.ok(state.pool.some((p) => p.id === 'poi_inj_lair'), 'an injected POI joins the node pool after generation');
    assert.ok(state.undiscovered.some((p) => p.id === 'poi_inj_lair'), 'an injected POI is undiscovered — it does not auto-surface');
    assert.ok(!state.discovered.has('poi_inj_lair'), 'an injected POI is not auto-discovered');
    assert.equal(injected.source, 'injected', 'an injected stub is tagged source:injected');

    poi.grantRevealAuthority('poi_inj_lair');
    assert.equal(poi.exploreDirected(node, 'poi_inj_lair'), 'poi_inj_lair', 'the injected POI can then be discovered');
    assert.deepEqual(poi.rebuildInjectedPois(node.id), [injected], 'the injected pool rebuilds from the log alone');
    record(`M5 PASSED: POI injected into an already-visited node joined its pool, did not auto-surface, then was discoverable; injected pool log-derived`);
  }

  // --- M6: caches provably redundant (L3 / G5 / L6 analogue) ------------------
  // After a mixed explore/inject/grant/directed sequence, each cache (discovered,
  // injected, revealed) rebuilt from the log alone equals the incrementally-cached
  // version.
  {
    const node = capital.node;
    const world = createWorldState(mapConfigWith());
    const poi = createPoiEngine(world);
    poi.exploreBlind(node);
    poi.exploreBlind(node);
    poi.injectPoi(node.id, { id: 'poi_inj_cache', category: 'cache', prominence: 0.5, hidden: true, data: {} });
    poi.grantRevealAuthority('poi_inj_cache');
    poi.exploreDirected(node, 'poi_inj_cache');
    poi.exploreBlind(node);

    const state = poi.getPoiState(node);
    const cachedDiscovered = [...state.discovered].sort();
    const rebuiltDiscovered = [...poi.rebuildDiscoveredPoiIds(node)].sort();
    assert.deepEqual(rebuiltDiscovered, cachedDiscovered, 'discovered set must rebuild from the log alone');

    const cachedInjected = state.pool.filter((p) => p.source === 'injected');
    assert.deepEqual(poi.rebuildInjectedPois(node.id), cachedInjected, 'injected pool must rebuild from the log alone');

    const cachedRevealed = [...poi.getRevealedPoiIds()].sort();
    const rebuiltRevealed = [...poi.rebuildRevealedPoiIds()].sort();
    assert.deepEqual(rebuiltRevealed, cachedRevealed, 'reveal-authority set must rebuild from the log alone');
    record(`M6 PASSED: discovered (${cachedDiscovered.length}), injected (${cachedInjected.length}), and revealed (${cachedRevealed.length}) caches all equal their from-log rebuilds`);
  }

  // --- M7: explore costs time via the 'exploring' timeContext (F2/I2 analogue) --
  // An explore action carries timeContext:'exploring'; the already-proven WorldClock
  // picks it up (no engine change) and subsequent ticks dilate by the exploring
  // multiplier. Uses the shipped worldConfig.json (which now carries exploring).
  {
    const w = initWorldState(CONFIG_PATH);
    const clock = createWorldClockEngine(w);
    const poi = createPoiEngine(w);
    const mult = w.getState().config.timeDilation.multipliers.exploring;
    const node = synthSettlement('town', 7000, 7000);

    assert.equal(clock.getActiveTimeContext(), 'idle', 'context starts at the default idle');
    poi.exploreBlind(node);
    assert.equal(clock.getActiveTimeContext(), 'exploring', 'an explore action must set the active context to exploring');
    const before = clock.getTotalGameSeconds();
    w.dispatch('CLOCK_TICK', { realSecondsElapsed: 10 });
    const added = clock.getTotalGameSeconds() - before;
    assert.equal(added, 10 * mult, `a tick after exploring must dilate by the exploring multiplier (× ${mult})`);
    assert.equal(clock.rebuildTotalGameSeconds(), clock.getTotalGameSeconds(), 'the exploring-dilated total must remain rebuildable from the log');
    record(`M7 PASSED: explore set timeContext 'exploring'; a 10 real-s tick added ${added} game-s (× ${mult}) with no WorldClock change`);
  }
}

// M1-M7, printed once.
const sectionMLinesA = [];
runSectionM((m) => {
  sectionMLinesA.push(m);
  console.log(m);
});

// --- M-final: determinism across full runs (K6/L7 analogue) ------------------
// Run the entire section a second time and assert byte-identical output.
const sectionMLinesB = [];
runSectionM((m) => sectionMLinesB.push(m));
assert.deepEqual(sectionMLinesA, sectionMLinesB, 'Section M output must be byte-identical across two full runs');
console.log(`M-final PASSED: Section M produced identical output across two full runs (${sectionMLinesA.length} lines)`);

console.log('\nSection M PASSED: baseline POIs are a pure function of (seed, node) with classification-scaled richness; discovery/injection/reveal are log-derived and rebuildable; blind explore is a flat-chance draw over a finite shrinking pool; directed explore honors reveal authority; exploring costs time via the exploring timeContext');

// =============================================================================
// Section N: NPC generator — the live race registry -> per-node population.
//
// This layer contains a DESIGNED EXCEPTION to the position-determinism
// discipline, and the section proves the exception is exactly as intended and
// no wider. The raceRegistry is a live, player-adjustable settings surface;
// generation reads its CURRENT state at the moment a node is first populated.
// So: same seed + same node + DIFFERENT registry settings => different people
// — N3 asserts this divergence as THE FEATURE, not a bug the suite should
// catch. What remains deterministic, and is proven in the usual load-bearing
// way: within a FIXED registry state the roster is a pure function of
// (config, node, enabledRaces) (N1); a committed roster is a permanent
// historical fact that registry edits can never reach backward and reroll
// (N2, N3); and the registry itself plus every population is log-derived and
// rebuildable (N4) — registry edits are logged events, so full-log replay
// reproduces everything exactly even across settings changes.
// =============================================================================
console.log('\n=== Section N: NPC generator (live race registry -> per-node population) ===');

function runSectionN(record) {
  // Synthetic nodes with hand-authored classifications (the Section M
  // convention, redefined locally so the section stays self-contained).
  const synthSettlement = (tier, x, y) => ({
    id: `syn_${tier}_${x}_${y}`,
    x,
    y,
    classification: { kind: 'settlement', tier, settlementId: `syn_${tier}`, baselineFaction: null, notability: null, hospitability: null },
  });
  const synthWild = (notability, hospitability, x, y) => ({
    id: `syn_wild_${x}_${y}`,
    x,
    y,
    classification: { kind: 'wilderness', tier: null, settlementId: null, baselineFaction: null, notability, hospitability },
  });

  // popConfigWith — clone of the shipped config, with the race table optionally
  // narrowed to a subset of the shipped races and per-race patches applied.
  function popConfigWith(raceIds = null, racePatches = {}) {
    const cfg = mapConfigWith();
    if (raceIds) {
      cfg.raceRegistry = {
        races: Object.fromEntries(raceIds.map((id) => [id, structuredClone(mapBaseConfig.raceRegistry.races[id])])),
      };
    }
    for (const [id, patch] of Object.entries(racePatches)) {
      Object.assign(cfg.raceRegistry.races[id], patch);
    }
    return cfg;
  }

  // freshPopWorld — world + race registry + entity registry + generator, in
  // the sampleWorld construction order (stores before any dispatch).
  function freshPopWorld(cfg) {
    const world = createWorldState(cfg);
    const races = createRaceRegistry(world);
    const registry = createEntityRegistry(world);
    const npcGen = createNpcGeneratorEngine(world, registry, races);
    return { world, races, registry, npcGen };
  }

  // The config-default enabled races in the generator's expected shape (sorted
  // {id, ...def}), for calling the pure derivations without building a world.
  function enabledRacesOf(cfg) {
    const table = deriveRaceRegistry(cfg, []);
    return Object.keys(table)
      .sort()
      .map((id) => ({ id, ...table[id] }))
      .filter((r) => r.enabled && r.weight > 0);
  }

  // Deterministic scan for `count` village-tier synthetic nodes whose rosters
  // (under the full shipped registry) each contain at least one NPC of raceId —
  // so N3's divergence assertions are guaranteed, not probabilistic.
  function findVillagesWithRace(cfg, raceId, count) {
    const enabled = enabledRacesOf(cfg);
    const found = [];
    for (let i = 0; i < 5000 && found.length < count; i++) {
      const x = (i % 100) * 7 + 2000;
      const y = Math.floor(i / 100) * 7 + 2000;
      const node = synthSettlement('village', x, y);
      if (deriveNpcRoster(cfg, node, enabled).some((n) => n.identity.race === raceId)) found.push(node);
    }
    if (found.length < count) throw new Error(`Section N: fewer than ${count} villages containing race ${raceId} (config drift?)`);
    return found;
  }

  const cfg = mapConfigWith();
  const popByTier = cfg.worldMap.population.settlement.populationByTier;
  const BASE_APPEARANCE_KEYS = ['heightBuild', 'hair', 'eyes', 'face', 'skin', 'body', 'distinguishingFeatures', 'intimate'];

  // --- N1: fixed-registry determinism (LOAD-BEARING, K1/L1/M1 analogue) ------
  // Within ONE registry state, generation is fully deterministic: two
  // independent fresh worlds populate the same node with byte-identical birth
  // snapshots, the pure derivation reproduces itself, and the committed
  // snapshot IS the pure derivation's output.
  //
  // The clock-advanced world C is the age/birthday-purity check specifically:
  // deriveNpc must be a pure function of (config, node, enabledRaces, i) with
  // ZERO reference to WorldClockEngine's current date — age is a pure ageRange
  // draw and birthday's year is config.startDateTime (a frozen constant), never
  // "now". If any of that leaked the game clock, populating AFTER advancing
  // time would shift ages/birthdays and this deepEqual would fail. It is what
  // makes the determinism hold BY CONSTRUCTION rather than by the coincidence
  // of A and B both populating at t=0.
  {
    const node = synthSettlement('village', 8000, 8000);
    const A = freshPopWorld(popConfigWith());
    const B = freshPopWorld(popConfigWith());
    A.npcGen.populateNode(node);
    B.npcGen.populateNode(node);
    const snapA = deriveNodePopulation(A.world.getEventLog(), node.id);
    const snapB = deriveNodePopulation(B.world.getEventLog(), node.id);
    assert.equal(snapA.length, popByTier.village, 'a village commits populationByTier.village people');
    assert.deepEqual(snapA, snapB, 'same registry + same node + same seed must yield byte-identical birth snapshots');
    const enabled = A.races.getEnabledRaces();
    assert.deepEqual(deriveNpcRoster(cfg, node, enabled), deriveNpcRoster(cfg, node, enabled), 'deriveNpcRoster is pure in (config, node, enabledRaces)');
    assert.deepEqual(snapA, deriveNpcRoster(cfg, node, enabled), 'the committed snapshot equals the pure derivation output');
    assert.ok(snapA.every((n, i) => n.id === `npc_${node.id}_g${i}`), 'generated ids are deterministic npc_<nodeId>_g<i>');

    // World C: advance the game clock a long way (and past a birthday-year
    // boundary) BEFORE populating, to prove generation ignores "now" entirely.
    const C = freshPopWorld(popConfigWith());
    const clockC = createWorldClockEngine(C.world);
    C.world.dispatch('CLOCK_TICK', { realSecondsElapsed: 100000 });
    assert.ok(clockC.getTotalGameSeconds() > 0, 'world C clock actually advanced before populating');
    C.npcGen.populateNode(node);
    const snapC = deriveNodePopulation(C.world.getEventLog(), node.id);
    assert.deepEqual(snapC, snapA, 'populating AFTER advancing the game clock yields byte-identical people — age/birthday are pure RNG + frozen config.startDateTime, never the current date');
    record(`N1 PASSED: village roster of ${snapA.length} NPCs is deterministic under a fixed registry — identical across two fresh worlds, equal to the pure derivation, and unchanged when populated after advancing the game clock (age/birthday clock-independent)`);
  }

  // --- N2: no-op on repeat + permanence of the committed roster ---------------
  // A second populateNode returns the SAME live entities (never a reroll),
  // post-birth mutation survives, exactly one NODE_POPULATED exists for the
  // node, and the frozen birth snapshot is unaffected by live mutation.
  {
    const node = synthSettlement('town', 8100, 8100);
    const { world, npcGen } = freshPopWorld(popConfigWith());
    const first = npcGen.populateNode(node);
    assert.ok(npcGen.isPopulated(node), 'the node is marked populated after the first call');
    first[0].psychology.memories.push({ seq: 0, summary: 'a remembered kindness' });
    const again = npcGen.populateNode(node);
    assert.ok(again[0] === first[0], 'a repeat populateNode returns the same live entity references (no-op, not a regeneration)');
    assert.equal(again[0].psychology.memories.length, 1, 'post-birth mutation on the live entity survives the repeat call');
    const entries = world.getEventLog().filter((e) => e.type === NODE_POPULATED && e.payload.nodeId === node.id);
    assert.equal(entries.length, 1, 'the log carries exactly ONE NODE_POPULATED for the node');
    assert.equal(deriveNodePopulation(world.getEventLog(), node.id)[0].psychology.memories.length, 0, 'the birth snapshot in the log is unaffected by live mutation — birth record and live entity diverge by design');
    record(`N2 PASSED: repeat population is a no-op returning the committed live entities; one NODE_POPULATED in the log; birth snapshot immune to post-birth mutation`);
  }

  // --- N3: INTENTIONAL non-determinism across a registry change ---------------
  // THE FEATURE, NOT A BUG: generation reads the CURRENT registry, so an edit
  // changes who future nodes get — while every already-committed roster is
  // byte-untouched. A control world on the same seed with unedited settings
  // gets DIFFERENT people at the same node, which is exactly the designed
  // exception to position-determinism.
  {
    const [nodeA, nodeB] = findVillagesWithRace(cfg, 'elf', 2);
    const edited = freshPopWorld(popConfigWith());
    const control = freshPopWorld(popConfigWith());

    edited.npcGen.populateNode(nodeA);
    const snapABefore = deriveNodePopulation(edited.world.getEventLog(), nodeA.id);
    assert.ok(snapABefore.some((n) => n.identity.race === 'elf'), 'nodeA was committed WITH elves before the edit');

    edited.races.setRaceEnabled('elf', false);
    assert.ok(!edited.races.getEnabledRaces().some((r) => r.id === 'elf'), 'elf is disabled in the live registry');

    edited.npcGen.populateNode(nodeB);
    const snapAAfter = deriveNodePopulation(edited.world.getEventLog(), nodeA.id);
    assert.deepEqual(snapAAfter, snapABefore, 'the edit did NOT reach backward: nodeA is byte-unchanged, its elves intact');
    const editedB = deriveNodePopulation(edited.world.getEventLog(), nodeB.id);
    assert.ok(editedB.every((n) => n.identity.race !== 'elf'), 'nodeB, populated AFTER the edit, contains no elves');

    control.npcGen.populateNode(nodeB);
    const controlB = deriveNodePopulation(control.world.getEventLog(), nodeB.id);
    assert.ok(controlB.some((n) => n.identity.race === 'elf'), 'the control world (unedited settings) gets elves at the same node');
    assert.notDeepEqual(editedB, controlB, 'same seed + same node + DIFFERENT registry settings => different people — the intentional exception to position-determinism');

    const editedLog = edited.world.getEventLog();
    const seqA = editedLog.find((e) => e.type === NODE_POPULATED && e.payload.nodeId === nodeA.id).seq;
    const seqEdit = editedLog.find((e) => e.type === 'RACE_ENABLED_SET').seq;
    const seqB = editedLog.find((e) => e.type === NODE_POPULATED && e.payload.nodeId === nodeB.id).seq;
    assert.ok(seqA < seqEdit && seqEdit < seqB, 'the settings edit is itself a logged fact, ordered between the two populations — full-log replay reproduces everything');
    record(`N3 PASSED: registry edit changed only FUTURE generation (nodeB elf-free, control world diverges by design) and left the committed nodeA byte-untouched`);
  }

  // --- N4: registry + population caches provably redundant (M6 analogue) ------
  // After live edits (add/remove/toggle/reweight) and several populations, the
  // race-table cache equals its from-log rebuild and every node's cached
  // roster equals its from-log rebuild. Unknown-id mutators are null no-ops.
  {
    const { world, races, npcGen } = freshPopWorld(popConfigWith());
    races.addRace('synthling', {
      displayName: 'Synthling',
      enabled: true,
      weight: 5,
      genders: ['female', 'male'],
      namePool: { female: ['Vessa', 'Nyx'], male: ['Koda', 'Rill'] },
      surnames: ['Weft'],
      ageRange: { min: 18, max: 40 },
      axisPriors: { openness: 8 },
      appearanceOverrides: {},
      appearanceExtensions: { seam: ['visible silver seams', 'faint hairline seams'] },
      voiceAccents: [{ name: 'flat harmonic hum', signaturePhrases: ['click-affirm', 'tone-null', 'ping'] }],
    });
    races.setRaceWeight('orc', 7);
    races.setRaceEnabled('gnome', false);
    races.removeRace('halfling');

    assert.equal(races.getRace('halfling'), null, 'a removed race is gone from the accessor');
    assert.ok(!races.getEnabledRaces().some((r) => r.id === 'gnome'), 'a disabled race is filtered from getEnabledRaces');
    assert.equal(races.getRace('orc').weight, 7, 'a reweighted race reads back its new weight');
    assert.equal(races.getRace('synthling').displayName, 'Synthling', 'a player-added race is a first-class registry entry');
    assert.equal(races.removeRace('no_such_race'), null, 'unknown-id removeRace is a null no-op (nothing dispatched)');
    assert.equal(races.setRaceEnabled('no_such_race', true), null, 'unknown-id setRaceEnabled is a null no-op');
    assert.equal(races.setRaceWeight('no_such_race', 2), null, 'unknown-id setRaceWeight is a null no-op');

    const n1 = synthSettlement('hamlet', 9000, 9000);
    const n2 = synthWild(0.9, 0.8, 9100, 9100);
    npcGen.populateNode(n1);
    npcGen.populateNode(n2);

    assert.deepEqual(races.getRaces(), races.rebuildRaces(), 'the race-table cache must rebuild from config defaults + the log alone');
    for (const node of [n1, n2]) {
      const rebuilt = npcGen.rebuildNodePopulation(node.id);
      assert.deepEqual(npcGen.getPopulation(node).map((n) => n.id), rebuilt.map((n) => n.id), `node ${node.id}: cached roster ids must equal the from-log rebuild`);
      assert.deepEqual(npcGen.getPopulation(node), rebuilt, `node ${node.id}: unmutated live entities equal their birth snapshots`);
    }
    assert.equal(deriveNodePopulation(world.getEventLog(), 'never_populated_node').length, 0, 'an unpopulated node rebuilds to an empty roster');
    record(`N4 PASSED: after add/remove/toggle/reweight edits and two populations, the race table and every roster rebuild from the log exactly; unknown-id mutators are null no-ops`);
  }

  // --- N5: race appearance-extension merge (the FUOC fix) ---------------------
  // A dragonborn gets its declared extension fields ADDED onto the shared base
  // appearance; a human's appearance is EXACTLY the base key set — the common
  // race is an ordinary zero-extension registry entry, not a special case.
  {
    const node = synthSettlement('village', 9200, 9200);
    const db = freshPopWorld(popConfigWith(['dragonborn']));
    const dbRoster = db.npcGen.populateNode(node);
    const ext = mapBaseConfig.raceRegistry.races.dragonborn.appearanceExtensions;
    assert.ok(dbRoster.length > 0, 'the dragonborn-only world populated the village');
    for (const n of dbRoster) {
      assert.equal(n.identity.race, 'dragonborn', 'a single-race registry generates only that race');
      for (const key of BASE_APPEARANCE_KEYS) assert.ok(key in n.appearance, `base appearance key ${key} is present`);
      for (const [field, options] of Object.entries(ext)) {
        assert.ok(options.includes(n.appearance[field]), `extension ${field} is drawn from its declared option list`);
      }
    }
    const hu = freshPopWorld(popConfigWith(['human']));
    const huRoster = hu.npcGen.populateNode(node);
    for (const n of huRoster) {
      assert.deepEqual(Object.keys(n.appearance).sort(), [...BASE_APPEARANCE_KEYS].sort(), 'a human appearance carries EXACTLY the base keys — zero extensions, zero special-casing');
    }
    record(`N5 PASSED: dragonborn instances carry ${Object.keys(ext).length} merged extension fields on top of the intact base schema; human instances carry exactly the base keys`);
  }

  // --- N6: personality axes — race priors + bounded deterministic variance ----
  // Every axis is an integer in [0,10] within +/-2 of its race prior; the prior
  // skew is visible in aggregate (orc dominance prior 8 vs human 5).
  {
    const humanOnly = popConfigWith(['human']);
    const orcOnly = popConfigWith(['orc']);
    const nodes = [synthSettlement('town', 9300, 9300), synthSettlement('town', 9350, 9350), synthSettlement('village', 9400, 9400)];
    const sample = (cfg2) => nodes.flatMap((node) => deriveNpcRoster(cfg2, node, enabledRacesOf(cfg2)));
    const humans = sample(humanOnly);
    const orcs = sample(orcOnly);
    for (const [raceId, list] of [['human', humans], ['orc', orcs]]) {
      const priors = mapBaseConfig.raceRegistry.races[raceId].axisPriors;
      for (const npc of list) {
        for (const axis of PERSONALITY_AXES) {
          const v = npc.psychology.personalityAxes[axis];
          assert.ok(Number.isInteger(v) && v >= 0 && v <= 10, `${raceId} ${axis} must be an integer in [0,10] (saw ${v})`);
          assert.ok(Math.abs(v - (priors[axis] ?? 5)) <= 2, `${raceId} ${axis} must sit within +/-2 of its race prior`);
        }
      }
    }
    const mean = (list, axis) => list.reduce((s, n) => s + n.psychology.personalityAxes[axis], 0) / list.length;
    const orcDom = mean(orcs, 'dominance');
    const humanDom = mean(humans, 'dominance');
    assert.ok(orcDom > humanDom, `the dominance prior gap must show in aggregate (orc ${orcDom} > human ${humanDom})`);
    record(`N6 PASSED: all ${humans.length + orcs.length} sampled NPCs keep every axis in [0,10] within +/-2 of their race prior; mean orc dominance ${orcDom.toFixed(2)} > mean human dominance ${humanDom.toFixed(2)}`);
  }

  // --- N7: population counts follow the classification the map already made ---
  // Settlement counts are the flat per-tier lookup; wilderness follows the
  // notability/hospitability formula — hostile mundane wilderness holds NOBODY
  // yet still commits its (empty) roster as a fact, so it stays barren no
  // matter what races are enabled later.
  {
    const { world, npcGen } = freshPopWorld(popConfigWith());
    const hamlet = npcGen.populateNode(synthSettlement('hamlet', 9500, 9500));
    const capital = npcGen.populateNode(synthSettlement('capital', 9600, 9600));
    assert.equal(hamlet.length, popByTier.hamlet, 'hamlet population equals its per-tier lookup');
    assert.equal(capital.length, popByTier.capital, 'capital population equals its per-tier lookup');

    const barren = synthWild(0, 0, 9700, 9700);
    assert.equal(npcGen.populateNode(barren).length, 0, 'hostile, mundane wilderness generates nobody');
    assert.ok(npcGen.isPopulated(barren), 'the empty roster is itself a committed fact');
    npcGen.populateNode(barren); // revisit
    const barrenEntries = world.getEventLog().filter((e) => e.type === NODE_POPULATED && e.payload.nodeId === barren.id);
    assert.equal(barrenEntries.length, 1, 'revisiting the empty node is a no-op (still exactly one NODE_POPULATED)');

    const w = cfg.worldMap.population.wilderness;
    const rich = npcGen.populateNode(synthWild(0.9, 0.8, 9800, 9800));
    assert.ok(rich.length > 0, 'a notable, hospitable wilderness node holds a hermit or small camp');
    assert.ok(rich.length <= w.maxPopulation, 'wilderness population respects maxPopulation');
    assert.equal(
      derivePopulationSize(cfg, synthWild(0.9, 0.8, 0, 0).classification),
      Math.round(w.base + 0.9 * w.notabilityPopScale + 0.8 * w.hospitabilityPopScale),
      'the wilderness count is the clamped notability/hospitability formula'
    );
    record(`N7 PASSED: hamlet ${hamlet.length} / capital ${capital.length} per tier lookup; barren wilderness 0 (committed, no-op on revisit); notable wilderness ${rich.length}`);
  }

  // --- N8: registry weights drive the race mix ---------------------------------
  {
    const skew = popConfigWith(['human', 'elf'], { human: { weight: 100 }, elf: { weight: 1 } });
    const { npcGen } = freshPopWorld(skew);
    let humans = 0;
    let elves = 0;
    for (let k = 0; k < 6; k++) {
      for (const n of npcGen.populateNode(synthSettlement('town', 10000 + k * 50, 10000))) {
        if (n.identity.race === 'human') humans += 1;
        else elves += 1;
      }
    }
    assert.ok(humans > elves, `a 100:1 weight skew must dominate the mix (${humans} humans vs ${elves} elves)`);
    record(`N8 PASSED: at 100:1 registry weights, six towns generated ${humans} humans vs ${elves} elves`);
  }
}

// N1-N8, printed once.
const sectionNLinesA = [];
runSectionN((m) => {
  sectionNLinesA.push(m);
  console.log(m);
});

// --- N-final: determinism across full runs (K6/L7/M-final analogue) ----------
// Run the entire section a second time and assert byte-identical output. This
// holds BECAUSE every scenario pins its own registry state — the intentional
// non-determinism is across differing SETTINGS, never across runs of the same
// settings.
const sectionNLinesB = [];
runSectionN((m) => sectionNLinesB.push(m));
assert.deepEqual(sectionNLinesA, sectionNLinesB, 'Section N output must be byte-identical across two full runs');
console.log(`N-final PASSED: Section N produced identical output across two full runs (${sectionNLinesA.length} lines)`);

console.log('\nSection N PASSED: rosters are deterministic under a fixed registry state and committed permanently as NODE_POPULATED birth snapshots; registry edits are logged settings facts that change only future generation (the designed exception to position-determinism); race extension fields merge additively onto the untouched base appearance; axes are race priors plus bounded seeded variance; population counts reuse the classification layer');

// =============================================================================
// Section V: voice directives — permanent, axis-derived, coherent by
// construction. Voice is generated ONCE at NPC creation from the axes and never
// recomputed (the appearance-grade permanence discipline). Because it is a pure
// function of the axes, "permanent" and "reproducible" are the same statement:
// same axes always yield the same directive set. The load-bearing property
// here is COHERENCE — each axis owns a disjoint speech facet, so no selected
// subset can seat two contradictory directives (the exact failure mode the
// naive one-line-per-axis approach would allow).
// =============================================================================
console.log('\n=== Section V: voice directives (permanent, axis-derived, coherent) ===');

function runSectionV(record) {
  // Reverse map directive-string -> owning axis, built from the exported table.
  // Two axes sharing a directive string would be cross-facet leakage; assert
  // the table itself keeps every line unique to one axis (facet disjointness).
  const directiveAxis = new Map();
  for (const [axis, lines] of Object.entries(AXIS_DIRECTIVES)) {
    for (const line of [lines.high, lines.low]) {
      if (!line) continue;
      assert.ok(!directiveAxis.has(line), `directive "${line}" must belong to exactly one axis facet`);
      directiveAxis.set(line, axis);
    }
  }
  record(`V0 PASSED: ${directiveAxis.size} directive lines each belong to exactly one axis facet (no cross-facet leakage)`);

  // V1: purity/permanence — same axes -> byte-identical directives, every time.
  const profile = { dominance: 8, agreeableness: 2, extraversion: 8, conscientiousness: 5, openness: 5 };
  assert.deepEqual(deriveVoiceDirectives(profile), deriveVoiceDirectives(profile), 'deriveVoiceDirectives is pure in axes');
  record(`V1 PASSED: identical axes reproduce an identical directive set (permanent birth fact): [${deriveVoiceDirectives(profile).join(' | ')}]`);

  // V2: axis skew shows in the chosen lines — each axis speaks in its own lane.
  const highDom = deriveVoiceDirectives({ dominance: 9 });
  const lowDom = deriveVoiceDirectives({ dominance: 1 });
  assert.ok(highDom.includes(AXIS_DIRECTIVES.dominance.high), 'high dominance -> the commanding stance directive');
  assert.ok(lowDom.includes(AXIS_DIRECTIVES.dominance.low), 'low dominance -> the deferring stance directive');
  const highExt = deriveVoiceDirectives({ extraversion: 9 });
  const lowExt = deriveVoiceDirectives({ extraversion: 1 });
  assert.ok(highExt.includes(AXIS_DIRECTIVES.extraversion.high), 'high extraversion -> the talkative length directive');
  assert.ok(lowExt.includes(AXIS_DIRECTIVES.extraversion.low), 'low extraversion -> the terse length directive');
  record('V2 PASSED: stance (dominance) and length (extraversion) directives track their axis, high and low');

  // V3: coherence sweep — every combination of low/mid/high across all 5 axes
  // (3^5 = 243). For each: the set is non-empty and within the cap; every
  // selected directive belongs to a DISTINCT axis (proving <=1 per axis AND
  // orthogonality); and no two selected lines are a declared conflicting pair
  // (CONFLICTING_PAIRS stays empty — the orthogonal-facet design proven, not
  // assumed). A single collision anywhere in the 243 fails the run.
  assert.equal(CONFLICTING_PAIRS.length, 0, 'the orthogonal-facet design keeps the conflict set empty');
  const LEVELS = [2, 5, 8]; // low / mid / high
  const AX = ['dominance', 'agreeableness', 'extraversion', 'conscientiousness', 'openness'];
  let swept = 0;
  for (const d of LEVELS) for (const a of LEVELS) for (const e of LEVELS) for (const c of LEVELS) for (const o of LEVELS) {
    const axes = { dominance: d, agreeableness: a, extraversion: e, conscientiousness: c, openness: o };
    const directives = deriveVoiceDirectives(axes);
    assert.ok(directives.length >= 1 && directives.length <= MAX_DIRECTIVES, 'directive count within [1, cap]');
    const axesUsed = directives.map((line) => directiveAxis.get(line)).filter(Boolean);
    // Every non-fallback directive maps to a distinct axis.
    if (axesUsed.length === directives.length) {
      assert.equal(new Set(axesUsed).size, axesUsed.length, 'each selected directive comes from a distinct axis facet');
    }
    for (let i = 0; i < directives.length; i++) {
      for (let j = i + 1; j < directives.length; j++) {
        const pair = [directives[i], directives[j]];
        const clash = CONFLICTING_PAIRS.some(([x, y]) => (pair.includes(x) && pair.includes(y)));
        assert.ok(!clash, 'no selected pair may be a declared conflicting pair');
      }
    }
    swept += 1;
  }
  record(`V3 PASSED: all ${swept} axis combinations yield a non-empty, capped, single-facet-per-axis directive set with zero conflicting pairs`);
}

const sectionVLinesA = [];
runSectionV((m) => { sectionVLinesA.push(m); console.log(m); });
const sectionVLinesB = [];
runSectionV((m) => sectionVLinesB.push(m));
assert.deepEqual(sectionVLinesA, sectionVLinesB, 'Section V output must be byte-identical across two full runs');
console.log(`V-final PASSED: Section V produced identical output across two full runs (${sectionVLinesA.length} lines)`);

// =============================================================================
// Section AP: accent signature phrases — a small curated seed list per accent,
// snapshotted onto psychology.voice.phrases at NPC birth (deriveNpc, step 14)
// alongside the accent name itself. Never re-looked-up from the race registry
// at prompt-build time: buildDialoguePrompt only ever reads the entity's own
// already-snapshotted voice object, so the birth-time value IS the permanent
// value regardless of what the registry says afterward.
// =============================================================================
console.log('\n=== Section AP: accent signature phrases (permanent, full coverage) ===');

function runSectionAP(record) {
  // AP0: full-coverage audit — every accent declared on every shipped race has
  // a non-empty signaturePhrases list. A future accent added without one would
  // fail here rather than silently rendering a bare accent name forever.
  const races = deriveRaceRegistry(mapConfigWith(), []);
  let accentCount = 0;
  for (const [raceId, def] of Object.entries(races)) {
    assert.ok(Array.isArray(def.voiceAccents) && def.voiceAccents.length > 0, `race "${raceId}" must declare voiceAccents`);
    for (const accent of def.voiceAccents) {
      assert.equal(typeof accent.name, 'string', `race "${raceId}" accent must have a string name`);
      assert.ok(
        Array.isArray(accent.signaturePhrases) && accent.signaturePhrases.length > 0,
        `race "${raceId}" accent "${accent.name}" must have a non-empty signaturePhrases list`
      );
      accentCount += 1;
    }
  }
  record(`AP0 PASSED: all ${accentCount} declared accents across ${Object.keys(races).length} races carry a non-empty signaturePhrases list`);

  // AP1: snapshot permanence — deriveNpcRoster is pure, so the SAME (config,
  // node, enabledRaces) reproduces byte-identical accent + phrases, proving
  // the phrase list is captured once at birth, not re-derived per call. The
  // snapshotted list is also checked to equal the registry accent entry's
  // signaturePhrases at generation time — a direct deterministic lookup on
  // the roll, never an independent draw of its own.
  const cfg = mapConfigWith();
  const enabled = Object.keys(races)
    .sort()
    .map((id) => ({ id, ...races[id] }))
    .filter((r) => r.enabled && r.weight > 0);
  const node = {
    id: 'syn_ap_village',
    x: 9500,
    y: 9500,
    classification: { kind: 'settlement', tier: 'village', settlementId: 'syn_ap_village', baselineFaction: null, notability: null, hospitability: null },
  };
  const rosterA = deriveNpcRoster(cfg, node, enabled);
  const rosterB = deriveNpcRoster(cfg, node, enabled);
  assert.ok(rosterA.length > 0, 'the synthetic village node must actually populate for this check to mean anything');
  assert.deepEqual(
    rosterA.map((n) => n.psychology.voice),
    rosterB.map((n) => n.psychology.voice),
    'same inputs reproduce byte-identical voice (accent + directives + phrases) for every NPC'
  );
  for (const npc of rosterA) {
    assert.ok(Array.isArray(npc.psychology.voice.phrases), 'every generated NPC carries a (possibly empty) snapshotted phrases array');
    const raceDef = races[npc.identity.race];
    const accentDef = raceDef.voiceAccents.find((a) => a.name === npc.psychology.voice.accent);
    assert.deepEqual(
      npc.psychology.voice.phrases,
      accentDef.signaturePhrases,
      "snapshotted phrases equal the registry accent entry's signaturePhrases at generation time"
    );
  }
  record('AP1 PASSED: accent + phrases are a permanent birth snapshot — pure, reproducible, and equal to the registry entry at generation time');

  // AP2: prompt rendering — the extrapolate-don't-recite instruction and every
  // phrase render when phrases are present; the line is silently omitted (no
  // crash, no blank artifact) when phrases are absent, covering hand-authored
  // entities that predate this field.
  const npcWithPhrases = rosterA[0];
  const relationship = { stats: { affection: 0, comfort: 0, trust: 0, desire: 0, obedience: 0 }, fromCallsTo: null };
  const promptWith = buildDialoguePrompt(npcWithPhrases, relationship, [], 'Hello there.');
  assert.ok(promptWith.includes('Favors words/phrases like:'), 'prompt must render the phrase-seed instruction when phrases are present');
  for (const phrase of npcWithPhrases.psychology.voice.phrases) {
    assert.ok(promptWith.includes(phrase), `prompt must include the seed phrase "${phrase}"`);
  }
  assert.ok(promptWith.includes('not limited to only this list'), 'prompt must instruct the model to extrapolate, not recite only the seed list');

  const noPhraseNpc = {
    ...npcWithPhrases,
    psychology: {
      ...npcWithPhrases.psychology,
      voice: { accent: npcWithPhrases.psychology.voice.accent, directives: npcWithPhrases.psychology.voice.directives },
    },
  };
  const promptWithout = buildDialoguePrompt(noPhraseNpc, relationship, [], 'Hello there.');
  assert.ok(
    !promptWithout.includes('Favors words/phrases like:'),
    'prompt must omit the phrase line entirely when voice.phrases is absent (hand-authored-entity compatibility)'
  );
  assert.ok(promptWithout.includes(`Accent: ${noPhraseNpc.psychology.voice.accent}`), 'the Accent line itself still renders with no phrases present');
  record('AP2 PASSED: phrase-seed instruction renders exactly when phrases are present, and degrades gracefully (no crash, no stray line) when absent');
}

const sectionAPLinesA = [];
runSectionAP((m) => { sectionAPLinesA.push(m); console.log(m); });
const sectionAPLinesB = [];
runSectionAP((m) => sectionAPLinesB.push(m));
assert.deepEqual(sectionAPLinesA, sectionAPLinesB, 'Section AP output must be byte-identical across two full runs');
console.log(`AP-final PASSED: Section AP produced identical output across two full runs (${sectionAPLinesA.length} lines)`);

console.log(
  '\nSection AP PASSED: every declared accent carries a curated signature-phrase seed list; the list is captured once at NPC birth as a permanent, reproducible fact equal to the registry entry at that moment; and the prompt renders an extrapolate-dont-recite instruction when phrases are present while degrading gracefully when absent'
);

// =============================================================================
// Section SC: NPC schedules — a permanent intra-node pattern at birth, a pure
// transient state read, and schedule-aware witness presence.
//
// The permanent/transient split is the voice-vs-emotion discipline applied to
// location: the schedule PATTERN is a birth fact (two rng draws appended after
// every existing draw in deriveNpc, riding the NODE_POPULATED birth snapshot —
// no new event type, no new stored state), while the CURRENT state is
// deriveScheduleState(pattern, hour) — pure, zero rng, recomputed at read time
// and stored nowhere. Presence for memoryEngine's witness fan-out becomes
// roster ∩ schedule-available, wired entirely in the witnessesAt adapter:
// asleep NPCs witness nothing, the direct target always remembers. Cross-node
// schedules are explicitly out of scope (lazy node generation — see the
// npcGeneratorEngine header); every location a schedule references is the home
// node's own baseline POI pool or a symbolic intra-node id.
// =============================================================================
console.log('\n=== Section SC: NPC schedules (permanent pattern, pure state read, presence-aware witnesses) ===');

function runSectionSC(record) {
  const cfg = mapConfigWith();
  const synthVillage = (x, y) => ({
    id: `syn_sc_village_${x}_${y}`,
    x,
    y,
    classification: { kind: 'settlement', tier: 'village', settlementId: `syn_sc_village_${x}_${y}`, baselineFaction: null, notability: null, hospitability: null },
  });
  const synthWild = (x, y) => ({
    id: `syn_sc_wild_${x}_${y}`,
    x,
    y,
    classification: { kind: 'wilderness', tier: null, settlementId: null, baselineFaction: null, notability: 0.7, hospitability: 0.7 },
  });
  const scEnabledRaces = () => {
    const table = deriveRaceRegistry(cfg, []);
    return Object.keys(table)
      .sort()
      .map((id) => ({ id, ...table[id] }))
      .filter((r) => r.enabled && r.weight > 0);
  };
  const enabled = scEnabledRaces();
  const isAsleepAt = (npc, bucket) => {
    const entry = npc.schedule.find((e) => e.timeOfDay === bucket);
    return entry?.availability === 'asleep';
  };

  // --- SC0: the bucket function is total over 0-23 and throws outside it -----
  {
    const byBucket = new Map(TIME_OF_DAY_BUCKETS.map((b) => [b, []]));
    for (let hour = 0; hour <= 23; hour++) {
      const bucket = deriveTimeOfDayBucket(hour);
      assert.ok(TIME_OF_DAY_BUCKETS.includes(bucket), `hour ${hour} must map into TIME_OF_DAY_BUCKETS (got ${bucket})`);
      byBucket.get(bucket).push(hour);
    }
    for (const bucket of TIME_OF_DAY_BUCKETS) {
      assert.ok(byBucket.get(bucket).length > 0, `bucket '${bucket}' must own at least one hour`);
    }
    const boundaries = [[4, 'night'], [5, 'morning'], [11, 'morning'], [12, 'day'], [17, 'day'], [18, 'evening'], [21, 'evening'], [22, 'night'], [0, 'night']];
    for (const [hour, expected] of boundaries) {
      assert.equal(deriveTimeOfDayBucket(hour), expected, `hour ${hour} must bucket as '${expected}'`);
    }
    for (const bad of [-1, 24, 6.5]) {
      assert.throws(() => deriveTimeOfDayBucket(bad), `deriveTimeOfDayBucket must throw on ${bad}`);
    }
    const epochHour = deriveCalendarDate(cfg, 0).hour;
    assert.equal(epochHour, 6, 'the shipped epoch starts at hour 6');
    assert.equal(deriveTimeOfDayBucket(epochHour), 'morning', 'the epoch hour buckets as morning — a fresh world wakes up in daylight');
    record(`SC0 PASSED: deriveTimeOfDayBucket is total over hours 0-23 (${TIME_OF_DAY_BUCKETS.map((b) => `${b}:${byBucket.get(b).length}h`).join(', ')}), throws outside, and the epoch (hour 6) is morning`);
  }

  // --- SC1: the pattern is a deterministic, well-formed birth fact ------------
  // Same (config, node, enabledRaces) => byte-identical schedules (the AP1
  // purity idiom — permanence and reproducibility are the same statement for a
  // pure function). Every generated NPC carries exactly one entry per bucket,
  // explicit availability on all four, and both an asleep and an awake stretch.
  // Clock-advance immunity needs no new assertion here: N1's world C populates
  // AFTER advancing the clock and deep-equals the full birth snapshots, which
  // now carry the schedule — a clock leak into the pattern would fail N1.
  {
    const node = synthVillage(9700, 9700);
    const rosterA = deriveNpcRoster(cfg, node, enabled);
    const rosterB = deriveNpcRoster(cfg, node, enabled);
    assert.ok(rosterA.length > 0, 'the synthetic village must populate for this check to mean anything');
    assert.deepEqual(
      rosterA.map((n) => n.schedule),
      rosterB.map((n) => n.schedule),
      'same inputs reproduce byte-identical schedule patterns for every NPC'
    );
    for (const npc of rosterA) {
      assert.equal(npc.schedule.length, TIME_OF_DAY_BUCKETS.length, 'a generated schedule is dense: exactly one entry per bucket');
      assert.deepEqual(
        [...npc.schedule.map((e) => e.timeOfDay)].sort(),
        [...TIME_OF_DAY_BUCKETS].sort(),
        'the four entries cover each time-of-day bucket exactly once'
      );
      for (const entry of npc.schedule) {
        assert.equal(typeof entry.locationId, 'string', 'every entry names a string locationId');
        assert.equal(typeof entry.activity, 'string', 'every entry names a string activity');
        assert.ok(['awake', 'asleep'].includes(entry.availability), 'every generated entry carries an explicit availability');
      }
      assert.ok(npc.schedule.some((e) => e.availability === 'asleep'), 'everyone sleeps sometime');
      assert.ok(npc.schedule.some((e) => e.availability === 'awake'), 'everyone is awake sometime');
    }
    record(`SC1 PASSED: all ${rosterA.length} generated schedules are byte-reproducible, dense over the four buckets, explicitly availability-marked, and include both sleep and waking stretches`);
  }

  // --- SC2: vocation -> workplace binding, its fallback, and intra-node scope -
  {
    // Key-set audit (the AP0 idiom): every vocation in either draw pool has an
    // explicit workplace mapping — a vocation added without one fails loudly.
    assert.deepEqual(
      Object.keys(VOCATION_WORKPLACE_CATEGORY).sort(),
      [...VOCATIONS_SETTLEMENT, ...VOCATIONS_WILDERNESS].sort(),
      'VOCATION_WORKPLACE_CATEGORY keys must exactly cover both vocation pools'
    );
    assert.ok(NOCTURNAL_VOCATIONS.every((v) => v in VOCATION_WORKPLACE_CATEGORY), 'every nocturnal vocation is a known vocation');

    // Deterministic scan for a village whose baseline pool contains a shop —
    // the workplace-binding case (the findVillagesWithRace idiom).
    let shopVillage = null;
    let shopPoi = null;
    for (let i = 0; i < 5000 && !shopVillage; i++) {
      const node = synthVillage((i % 100) * 7 + 5000, Math.floor(i / 100) * 7 + 5000);
      const poi = deriveBaselinePois(cfg, node).find((p) => p.category === 'shop');
      if (poi) { shopVillage = node; shopPoi = poi; }
    }
    assert.ok(shopVillage, 'Section SC: no synthetic village with a shop POI found (config drift?)');

    // A baker at that village works AT the shop POI — the schedule references
    // the node's own baseline pool, independent of player discovery (the pool
    // read is deriveBaselinePois, which never touches the discovery log).
    const baker = deriveSchedulePattern(cfg, shopVillage, 'baker', 0.9, 0.9);
    assert.equal(baker.find((e) => e.timeOfDay === 'morning').locationId, shopPoi.id, "the baker's morning entry is the village's own shop POI");
    assert.deepEqual(baker, deriveSchedulePattern(cfg, shopVillage, 'baker', 0.9, 0.9), 'deriveSchedulePattern is pure in its arguments');

    // Fallbacks: a null-mapped vocation (farmer works the fields), and a
    // mapped-but-absent category (a village has no keep, so a day-shift guard
    // patrols out and about) — never a nonsensical assignment.
    const farmer = deriveSchedulePattern(cfg, shopVillage, 'farmer', 0.9, 0.9);
    assert.equal(farmer.find((e) => e.timeOfDay === 'morning').locationId, 'out_and_about', 'a null-mapped vocation falls back to out_and_about');
    assert.ok(!deriveBaselinePois(cfg, shopVillage).some((p) => p.category === 'keep'), 'a village pool never contains a keep (tier-gated city+)');
    const dayGuard = deriveSchedulePattern(cfg, shopVillage, 'guard', 0.9, 0.9);
    assert.equal(dayGuard.find((e) => e.timeOfDay === 'morning').locationId, 'out_and_about', 'a mapped-but-absent category falls back to out_and_about');

    // Shift split: the same guard under a low shift draw is nocturnal — asleep
    // in the morning, working the night; always-nocturnal vocations need no
    // draw at all (a wilderness outlaw works nights at the camp when one
    // exists, out and about otherwise).
    const nightGuard = deriveSchedulePattern(cfg, shopVillage, 'guard', 0.1, 0.9);
    assert.equal(nightGuard.find((e) => e.timeOfDay === 'morning').availability, 'asleep', 'a night-shift guard sleeps through the morning');
    assert.equal(nightGuard.find((e) => e.timeOfDay === 'night').availability, 'awake', 'a night-shift guard works the night');
    const wildNode = synthWild(5200, 5200);
    const outlaw = deriveSchedulePattern(cfg, wildNode, 'outlaw', 0.9, 0.9);
    assert.equal(outlaw.find((e) => e.timeOfDay === 'morning').availability, 'asleep', 'an outlaw is nocturnal regardless of the shift draw');
    const wildCamp = deriveBaselinePois(cfg, wildNode).find((p) => p.category === 'camp');
    assert.equal(
      outlaw.find((e) => e.timeOfDay === 'night').locationId,
      wildCamp ? wildCamp.id : 'out_and_about',
      "the outlaw's night work location is the node's own camp POI when one exists, out_and_about otherwise"
    );

    // Intra-node containment — the scope rule made checkable: every location a
    // generated schedule references is 'home', 'out_and_about', or a baseline
    // POI id OF THE NPC'S OWN NODE. No schedule ever points at another node.
    const roster = deriveNpcRoster(cfg, shopVillage, enabled);
    const ownPoiIds = new Set(deriveBaselinePois(cfg, shopVillage).map((p) => p.id));
    for (const npc of roster) {
      for (const entry of npc.schedule) {
        assert.ok(
          entry.locationId === 'home' || entry.locationId === 'out_and_about' || ownPoiIds.has(entry.locationId),
          `schedule location ${entry.locationId} must be intra-node (home, out_and_about, or an own-node baseline POI)`
        );
      }
    }
    record(`SC2 PASSED: the workplace map exactly covers all ${Object.keys(VOCATION_WORKPLACE_CATEGORY).length} vocations; a baker binds to the village's own shop POI while farmer (null-mapped) and village guard (keep absent) fall back to out_and_about; guard shift and nocturnal vocations behave; every generated location is intra-node`);
  }

  // --- SC3: deriveScheduleState — pure, and honest about sparse schedules -----
  // The Mira-shaped fixture matches the hand-authored convention exactly:
  // sparse entries (no 'day' bucket), NO availability field, night activity
  // 'sleeping'. The read is pure, falls back to the sleeping convention, and
  // defaults missing buckets and missing schedules to present-and-available so
  // hand-authored NPCs and players never silently vanish from the world.
  {
    const sparse = [
      { timeOfDay: 'morning', locationId: 'tavern_fixture', activity: 'restocking the cellar' },
      { timeOfDay: 'evening', locationId: 'tavern_fixture', activity: 'tending the bar' },
      { timeOfDay: 'night', locationId: 'tavern_fixture_upstairs', activity: 'sleeping' },
    ];
    assert.deepEqual(deriveScheduleState(sparse, 8), deriveScheduleState(sparse, 8), 'deriveScheduleState is pure');
    const morning = deriveScheduleState(sparse, 8);
    assert.deepEqual(morning, { bucket: 'morning', locationId: 'tavern_fixture', activity: 'restocking the cellar', available: true }, 'a hand-authored morning entry reads as present and available');
    const night = deriveScheduleState(sparse, 23);
    assert.equal(night.available, false, "a hand-authored night entry with activity 'sleeping' reads as unavailable via the convention (no availability field needed)");
    const missingBucket = deriveScheduleState(sparse, 14);
    assert.deepEqual(missingBucket, { bucket: 'day', locationId: 'home', activity: 'going about the day', available: true }, 'a missing bucket defaults to at-home-and-available, never vanished');
    assert.equal(deriveScheduleState([], 14).available, true, 'an empty schedule reads as available');
    assert.equal(deriveScheduleState(undefined, 14).available, true, 'a missing schedule reads as available (players, pre-schedule entities)');
    const explicitWins = deriveScheduleState([{ timeOfDay: 'day', locationId: 'home', activity: 'dozing by the fire', availability: 'asleep' }], 14);
    assert.equal(explicitWins.available, false, "an explicit availability:'asleep' wins over activity text that never says 'sleeping'");
    record('SC3 PASSED: deriveScheduleState is pure; hand-authored sparse schedules read correctly (sleeping convention, missing buckets default to available); explicit availability wins');
  }

  // --- SC4: presence-aware witness fan-out, end to end -------------------------
  // A full world: populate a village that holds both a nocturnal NPC (a
  // night-shift guard — the only settlement nocturnal) and sleeping diurnals,
  // jump the clock to the dead of night, rob a diurnal victim, and read the
  // committed MEMORY_RECORDED: the witness set must be EXACTLY the
  // schedule-available roster minus victim — the nocturnal saw it, the
  // sleeping neighbors did not, and the victim still remembers (being robbed
  // in your sleep is still your robbery). Then the same robbery at midday
  // fans out to the whole roster: the night witness set is a strict subset.
  {
    // Deterministic scan for a village roster holding >=1 nocturnal and >=2
    // diurnal NPCs (so the night set is strictly smaller than the day set).
    let scNode = null;
    for (let i = 0; i < 5000 && !scNode; i++) {
      const node = synthVillage((i % 100) * 7 + 6000, Math.floor(i / 100) * 7 + 6000);
      const roster = deriveNpcRoster(cfg, node, enabled);
      const nocturnals = roster.filter((n) => isAsleepAt(n, 'morning')).length;
      const diurnals = roster.filter((n) => isAsleepAt(n, 'night')).length;
      if (nocturnals >= 1 && diurnals >= 2) scNode = node;
    }
    assert.ok(scNode, 'Section SC: no synthetic village with both a nocturnal and >=2 diurnal NPCs found (config drift?)');

    const world = createWorldState(cfg);
    const races = createRaceRegistry(world);
    const registry = createEntityRegistry(world);
    const clock = createWorldClockEngine(world);
    const npcGen = createNpcGeneratorEngine(world, registry, races);
    createMemoryEngine(world, registry, {
      witnessesAt: (nodeId) =>
        npcGen.rosterIdsAt(nodeId).filter(
          (id) => deriveScheduleState(registry.get(id)?.schedule, clock.getCurrentDate().hour).available
        ),
    });

    const roster = npcGen.populateNode(scNode);
    const victim = roster.find((n) => isAsleepAt(n, 'night'));
    const nocturnal = roster.find((n) => isAsleepAt(n, 'morning'));

    // Dead of night: epoch hour 6 + 72000 game-s (20h) => 02:00, bucket 'night'.
    world.dispatch('CLOCK_JUMP', { gameSecondsElapsed: 72000 });
    assert.equal(clock.getCurrentDate().hour, 2, 'the jump lands at 02:00');
    assert.equal(deriveTimeOfDayBucket(clock.getCurrentDate().hour), 'night', '02:00 is night');

    const witnessesOf = (memEntry) => memEntry.payload.memories.map((m) => m.entityId).slice(1); // [0] is always the target
    robNpc(world, 'sc_player', victim.id, scNode.id);
    const nightMem = world.getEventLog().filter((e) => e.type === 'MEMORY_RECORDED').at(-1);
    assert.equal(nightMem.payload.memories[0].entityId, victim.id, 'the sleeping victim still remembers — the target is always recorded');
    const expectedNightWitnesses = npcGen
      .rosterIdsAt(scNode.id)
      .filter((id) => id !== victim.id && deriveScheduleState(registry.get(id).schedule, 2).available);
    assert.deepEqual(witnessesOf(nightMem), expectedNightWitnesses, 'the committed witness set is EXACTLY the schedule-available roster minus the victim');
    assert.ok(witnessesOf(nightMem).includes(nocturnal.id), 'the nocturnal NPC, awake at 02:00, witnessed the robbery');
    for (const npc of roster) {
      if (npc.id === victim.id || !isAsleepAt(npc, 'night')) continue;
      assert.ok(!witnessesOf(nightMem).includes(npc.id), `${npc.id}, asleep at 02:00, must not witness`);
      assert.equal(registry.get(npc.id).psychology.memories.length, 0, 'a sleeping NPC accrued no memory of the robbery');
    }
    assert.equal(registry.get(victim.id).psychology.memories.length, 1, "the victim's robbery memory landed");

    // Midday: +43200 game-s (12h) => 14:00, bucket 'day' — everyone is awake
    // by construction (diurnals at work, nocturnals resting but awake), so the
    // same robbery fans out to the entire roster.
    world.dispatch('CLOCK_JUMP', { gameSecondsElapsed: 43200 });
    assert.equal(clock.getCurrentDate().hour, 14, 'the second jump lands at 14:00');
    robNpc(world, 'sc_player', victim.id, scNode.id);
    const dayMem = world.getEventLog().filter((e) => e.type === 'MEMORY_RECORDED').at(-1);
    const everyoneElse = npcGen.rosterIdsAt(scNode.id).filter((id) => id !== victim.id);
    assert.deepEqual(witnessesOf(dayMem), everyoneElse, 'at midday the whole roster (minus the victim) witnesses');
    assert.ok(witnessesOf(nightMem).length < witnessesOf(dayMem).length, 'the night witness set is strictly smaller than the day set');
    assert.ok(witnessesOf(nightMem).every((id) => witnessesOf(dayMem).includes(id)), 'the night witness set is a subset of the day set');
    record(`SC4 PASSED: at 02:00 the robbery was witnessed by ${witnessesOf(nightMem).length} awake NPC(s) (nocturnal in, ${roster.length - 1 - witnessesOf(nightMem).length} sleeping neighbors out, victim always remembers); at 14:00 the same act fanned out to all ${witnessesOf(dayMem).length} — presence is schedule-aware`);
  }
}

const sectionSCLinesA = [];
runSectionSC((m) => { sectionSCLinesA.push(m); console.log(m); });
const sectionSCLinesB = [];
runSectionSC((m) => sectionSCLinesB.push(m));
assert.deepEqual(sectionSCLinesA, sectionSCLinesB, 'Section SC output must be byte-identical across two full runs');
console.log(`SC-final PASSED: Section SC produced identical output across two full runs (${sectionSCLinesA.length} lines)`);

console.log(
  '\nSection SC PASSED: schedule patterns are permanent birth facts (two draws appended after every existing draw, riding the NODE_POPULATED snapshot); the current-state read is pure and stored nowhere; and witness presence is roster ∩ schedule-available — asleep NPCs witness nothing while the victim always remembers'
);

// =============================================================================
// Section EM: emotion — a TRANSIENT per-turn read, derived fresh from recent
// memories + axes and STORED NOWHERE. The load-bearing property: even though
// nothing is cached, the read is fully reproducible from history (the log
// supplies each memory's valence by seq), the same discipline relationshipTier
// applies. Valence SIGN picks the family; the axes pick which member of that
// family and how loud.
// =============================================================================
console.log('\n=== Section EM: procedural emotion (transient, derived, reproducible) ===');

function runSectionEM(record) {
  // A synthetic log where log[seq].type is the remembered event, plus the
  // matching MemoryRefs. No world needed — deriveEmotion is pure over these.
  const mkLog = (types) => types.map((type, seq) => ({ seq, type }));
  const mkMemories = (types) => types.map((_, seq) => ({ seq, summary: `m${seq}` }));
  const npcWith = (axes) => ({ psychology: { personalityAxes: axes } });

  const NEGATIVE = new Set(['indignant', 'angry', 'resentful', 'hurt', 'wary']);
  const POSITIVE = new Set(['fond', 'grateful', 'delighted', 'pleased']);
  const NEUTRAL = new Set(['content', 'reserved', 'calm']);
  const ANGER = new Set(['indignant', 'angry']);
  const FEAR_HURT = new Set(['hurt', 'wary']);

  const balancedAxes = { dominance: 5, agreeableness: 5, extraversion: 5, conscientiousness: 5, openness: 5 };

  // EM1: determinism — same (axes, memories, log) reproduces the same read, on
  // repeat and on a freshly-rebuilt set of identical inputs. Nothing is stored.
  const robTypes = ['PLAYER_ROBBED'];
  const read1 = deriveEmotion(npcWith(balancedAxes), mkMemories(robTypes), mkLog(robTypes));
  const read2 = deriveEmotion(npcWith(balancedAxes), mkMemories(robTypes), mkLog(robTypes));
  assert.deepEqual(read1, read2, 'same history + axes must reproduce the same emotional read');
  assert.ok(read1.reads.length >= 1, 'a read always names at least one emotion');
  record(`EM1 PASSED: identical history reproduces the read [${read1.reads.map((r) => r.emotion).join(', ')}] (netValence ${read1.netValence}) — reproducible without storage`);

  // EM2: valence sign drives the family.
  const robbed = deriveEmotion(npcWith(balancedAxes), mkMemories(['PLAYER_ROBBED']), mkLog(['PLAYER_ROBBED']));
  const helped = deriveEmotion(npcWith(balancedAxes), mkMemories(['PLAYER_HELPED']), mkLog(['PLAYER_HELPED']));
  assert.ok(NEGATIVE.has(robbed.reads[0].emotion), `robbed -> a negative-family read (got ${robbed.reads[0].emotion})`);
  assert.ok(POSITIVE.has(helped.reads[0].emotion), `helped -> a positive-family read (got ${helped.reads[0].emotion})`);
  record(`EM2 PASSED: ROBBED -> ${robbed.reads[0].emotion} (negative), HELPED -> ${helped.reads[0].emotion} (positive)`);

  // EM3: same negative memory, opposite dominance -> anger-family vs fear/hurt.
  const domHigh = { ...balancedAxes, dominance: 9 };
  const domLow = { ...balancedAxes, dominance: 1 };
  const angry = deriveEmotion(npcWith(domHigh), mkMemories(['PLAYER_ROBBED']), mkLog(['PLAYER_ROBBED']));
  const afraid = deriveEmotion(npcWith(domLow), mkMemories(['PLAYER_ROBBED']), mkLog(['PLAYER_ROBBED']));
  assert.ok(ANGER.has(angry.reads[0].emotion), `high dominance + robbed -> anger family (got ${angry.reads[0].emotion})`);
  assert.ok(FEAR_HURT.has(afraid.reads[0].emotion), `low dominance + robbed -> fear/hurt family (got ${afraid.reads[0].emotion})`);
  record(`EM3 PASSED: same robbery reads as ${angry.reads[0].emotion} for a dominant NPC vs ${afraid.reads[0].emotion} for a submissive one`);

  // EM4: no memories -> a neutral-family baseline, still shaped by axes.
  const outgoing = deriveEmotion(npcWith({ ...balancedAxes, extraversion: 9, agreeableness: 8 }), [], []);
  const withdrawn = deriveEmotion(npcWith({ ...balancedAxes, extraversion: 1 }), [], []);
  assert.ok(NEUTRAL.has(outgoing.reads[0].emotion), `no memories -> neutral baseline (got ${outgoing.reads[0].emotion})`);
  assert.equal(outgoing.netValence, 0, 'no valenced memories -> zero net valence');
  assert.equal(outgoing.reads[0].emotion, 'content', 'an outgoing, agreeable NPC baselines as content');
  assert.equal(withdrawn.reads[0].emotion, 'reserved', 'a withdrawn NPC baselines as reserved');
  record(`EM4 PASSED: no-memory baseline is axis-shaped — outgoing -> ${outgoing.reads[0].emotion}, withdrawn -> ${withdrawn.reads[0].emotion}`);

  // EM5: recency — a fresh positive memory outweighs an older negative one.
  const mixed = ['PLAYER_ROBBED', 'PLAYER_HELPED']; // older robbed, newer helped
  const recent = deriveEmotion(npcWith(balancedAxes), mkMemories(mixed), mkLog(mixed));
  assert.ok(recent.netValence > 0, 'the more recent HELPED must outweigh the older ROBBED');
  assert.ok(POSITIVE.has(recent.reads[0].emotion), `recency tips the read positive (got ${recent.reads[0].emotion})`);
  record(`EM5 PASSED: recency weighting — older robbery + newer help reads as ${recent.reads[0].emotion} (netValence ${recent.netValence})`);
}

const sectionEMLinesA = [];
runSectionEM((m) => { sectionEMLinesA.push(m); console.log(m); });
const sectionEMLinesB = [];
runSectionEM((m) => sectionEMLinesB.push(m));
assert.deepEqual(sectionEMLinesA, sectionEMLinesB, 'Section EM output must be byte-identical across two full runs');
console.log(`EM-final PASSED: Section EM produced identical output across two full runs (${sectionEMLinesA.length} lines)`);

console.log('\nSection V+EM PASSED: voice directives are permanent, axis-derived, and coherent by construction; emotion is a transient per-turn read that is reproducible from history yet stored nowhere');

// =============================================================================
// Section CH: conversation history — verbatim DIALOGUE_LINE turns, keyed by
// the UNORDERED pair of participants (not by a single entity id). Distinct
// from Section EM's memory/emotion machinery: this is an exact transcript,
// never compressed or summarized. Self-contained on its own throwaway world,
// same convention as Section G.
// =============================================================================
console.log('\n=== Section CH: conversation history (pair-keyed, log-derived, bounded-window) ===');

const chWorld = initWorldState(CONFIG_PATH);
const ch = createConversationHistoryStore(chWorld);

// --- CH1: canonical pair-key correctness (THE crux of this design) ---------
// Recording via (a, b) and later via (b, a) must land in the SAME thread —
// a conversation is one shared history regardless of argument order, unlike
// relationship stats which are legitimately asymmetric per direction.
ch.recordDialogueLine('ch1_a', 'ch1_b', 'ch1_a', 'Hello there.');
ch.recordDialogueLine('ch1_b', 'ch1_a', 'ch1_b', 'Well met.');
const ch1Forward = ch.getConversationHistory('ch1_a', 'ch1_b');
const ch1Reversed = ch.getConversationHistory('ch1_b', 'ch1_a');
assert.deepEqual(ch1Reversed, ch1Forward, 'getConversationHistory must be order-independent on its two id arguments');
assert.equal(ch1Forward.length, 2, 'both lines, recorded with swapped argument order, must land in one thread');
assert.deepEqual(ch1Forward.map((l) => l.text), ['Hello there.', 'Well met.'], 'lines must stay in dispatch order');
console.log(`CH1 PASSED: recordDialogueLine(a,b) and (b,a) land in the same canonical thread — ${ch1Forward.length} lines, order-independent`);

// --- CH2: thread isolation — one NPC's separate pairs never bleed together --
ch.recordDialogueLine('ch2_mira', 'ch2_rowan', 'ch2_rowan', "You two go way back?");
ch.recordDialogueLine('ch2_mira', 'ch2_rowan', 'ch2_mira', "Longer than I'd like to admit.");
ch.recordDialogueLine('ch2_mira', 'ch2_sable', 'ch2_sable', 'Rough night at the tables?');
const ch2WithRowan = ch.getConversationHistory('ch2_mira', 'ch2_rowan');
const ch2WithSable = ch.getConversationHistory('ch2_mira', 'ch2_sable');
assert.equal(ch2WithRowan.length, 2, "Mira's thread with Rowan must hold only Rowan's exchange");
assert.equal(ch2WithSable.length, 1, "Mira's thread with Sable must hold only Sable's line");
assert.ok(!ch2WithSable.some((l) => l.text.includes('go way back')), "Sable's thread must not see Rowan's line");
console.log('CH2 PASSED: the same NPC (Mira) keeps fully separate threads per partner — no cross-thread bleed');

// --- CH3: determinism — replaying the same DIALOGUE_LINE sequence into a
// fresh world reproduces a byte-identical derived history.
const ch3Log = chWorld.getEventLog();
const ch3DerivedOnce = deriveConversationHistory(ch3Log, 'ch2_mira', 'ch2_rowan');
const ch3DerivedTwice = deriveConversationHistory(ch3Log, 'ch2_mira', 'ch2_rowan');
assert.deepEqual(ch3DerivedOnce, ch3DerivedTwice, 'deriving twice from the same log must be byte-identical');
const ch3FreshWorld = initWorldState(CONFIG_PATH);
const ch3FreshStore = createConversationHistoryStore(ch3FreshWorld);
ch3FreshStore.recordDialogueLine('ch3_a', 'ch3_b', 'ch3_a', 'One.');
ch3FreshStore.recordDialogueLine('ch3_a', 'ch3_b', 'ch3_b', 'Two.');
const ch3OtherFreshWorld = initWorldState(CONFIG_PATH);
const ch3OtherFreshStore = createConversationHistoryStore(ch3OtherFreshWorld);
ch3OtherFreshStore.recordDialogueLine('ch3_a', 'ch3_b', 'ch3_a', 'One.');
ch3OtherFreshStore.recordDialogueLine('ch3_a', 'ch3_b', 'ch3_b', 'Two.');
assert.deepEqual(
  ch3OtherFreshStore.getConversationHistory('ch3_a', 'ch3_b'),
  ch3FreshStore.getConversationHistory('ch3_a', 'ch3_b'),
  'the same dispatched sequence on two independent worlds must produce an identical history'
);
console.log('CH3 PASSED: conversation history is fully deterministic — same dispatches, same derived result, every time');

// --- CH4: bounded-window correctness — older turns excluded once past N ----
const ch4World = initWorldState(CONFIG_PATH);
const ch4Store = createConversationHistoryStore(ch4World);
const ch4Exchanges = RECENT_EXCHANGES_WINDOW + 3; // deliberately over the window
for (let i = 0; i < ch4Exchanges; i++) {
  ch4Store.recordDialogueLine('ch4_npc', 'ch4_player', 'ch4_player', `player line ${i}`);
  ch4Store.recordDialogueLine('ch4_npc', 'ch4_player', 'ch4_npc', `npc line ${i}`);
}
const ch4Full = ch4Store.getConversationHistory('ch4_npc', 'ch4_player');
assert.equal(ch4Full.length, ch4Exchanges * 2, 'the full history must hold every dispatched line, unwindowed');
const ch4Recent = getRecentHistory(ch4Full);
assert.equal(ch4Recent.length, RECENT_EXCHANGES_WINDOW * 2, `the windowed read must hold exactly ${RECENT_EXCHANGES_WINDOW} exchanges (${RECENT_EXCHANGES_WINDOW * 2} lines)`);
assert.deepEqual(ch4Recent, ch4Full.slice(-(RECENT_EXCHANGES_WINDOW * 2)), 'the window must be exactly the tail of the full history');
assert.ok(!ch4Recent.some((l) => l.text === 'player line 0'), 'the oldest exchange must be excluded once past the window');
console.log(`CH4 PASSED: ${ch4Exchanges} exchanges recorded, windowed read trims to the most recent ${RECENT_EXCHANGES_WINDOW} (oldest excluded), full history keeps all ${ch4Full.length} lines`);

// --- CH5: rebuildability — rebuild-from-log-only equals the live cache -----
const ch5Rebuilt = ch4Store.rebuildConversationHistory('ch4_npc', 'ch4_player');
assert.deepEqual(ch5Rebuilt, ch4Full, 'history rebuilt from the log alone must equal the incrementally-cached history');
console.log(`CH5 PASSED: rebuilt-from-log (${ch5Rebuilt.length} lines) == live cache (${ch4Full.length} lines)`);

// --- CH6: prompt integration — buildDialoguePrompt renders the windowed
// history with correctly-resolved speaker labels, deterministically.
const chNpc = { id: 'ch6_npc', identity: { firstName: 'Mira', lastName: 'Thistledown' }, psychology: mira.psychology };
const chEdge = { fromCallsTo: 'traveler', stats: relationships.getRelationship(mira.id, rowan.id).stats };
const chHistory = [
  { seq: 0, speakerId: 'ch6_player', text: 'You two go way back?' },
  { seq: 1, speakerId: 'ch6_npc', text: "Longer than I'd like to admit." },
];
const chPromptOnce = buildDialoguePrompt(chNpc, chEdge, [], 'Anything else I should know?', { reads: [] }, chHistory);
const chPromptTwice = buildDialoguePrompt(chNpc, chEdge, [], 'Anything else I should know?', { reads: [] }, chHistory);
assert.equal(chPromptOnce, chPromptTwice, 'the prompt must render byte-identically across repeated calls with identical inputs');
assert.ok(chPromptOnce.includes('== Conversation so far =='), 'the prompt must include the conversation-history section header');
assert.ok(chPromptOnce.includes('traveler: You two go way back?'), "the player's line must be labeled with the NPC's fromCallsTo address");
assert.ok(chPromptOnce.includes("Mira: Longer than I'd like to admit."), "the NPC's own line must be labeled with its firstName");
console.log('CH6 PASSED: buildDialoguePrompt renders the conversation-history section deterministically with correctly-resolved speaker labels');

console.log('\nSection CH PASSED: dialogue history is pair-keyed (order-independent), thread-isolated per partner, deterministic, bounded-window correct, rebuildable, and wired into the dialogue prompt');

// =============================================================================
// Section TR: travel engine — the real travel/explore verbs and the seeded
// incident system.
//
// Proves the two-phase discipline end to end: (1) the incident roll is a PURE
// seeded function committed to the log the instant travel starts — same seed +
// same leg ⇒ same incident, every time — and (2) AI narration only ever colors
// those committed facts afterward (and under Node's no-AI environment the
// deterministic "safe travels" fallback simply stays). Also: exactly one
// incident per leg, tick-driven arrival on the exact expected tick, the
// requires-a-real-turn auto-passthrough (facts logged for a future
// combat/social system, travel never hangs), edge-only destinations, the
// explore window, dialogue's chatting brackets, and every cache's rebuild
// redundancy.
// =============================================================================
console.log('\n=== Section TR: travel — real verbs, seeded incidents, tick-driven arrival ===');

// The map/poi/clock/travel stack in the canonical wiring order, tick source
// last, starting node materialized so edges exist to travel along. An
// optional config override lets TR5 retune incident tables.
function buildTravelWorld(configOverride) {
  const w = configOverride ? createWorldState(configOverride) : initWorldState(CONFIG_PATH);
  const map = createWorldMapEngine(w);
  const poi = createPoiEngine(w);
  const clock = createWorldClockEngine(w);
  const travel = createTravelEngine(w, map, poi);
  const tick = createTickSource(w, w.getState().config);
  map.materializeNeighbors(map.getOriginNode().id);
  return { world: w, map, poi, clock, travel, tick };
}

// First passable edge out of the player's current node — travel is only ever
// to an adjacent node, so this is how a destination is legitimately chosen.
function trNextDest(t) {
  const node = t.map.getNode(t.travel.getPlayerNodeId());
  const edge = node.edges.find((e) => e.passable);
  assert.ok(edge, `TR needs a passable edge out of ${node.id}`);
  return edge.to;
}

// Drive ticks until the open activity completes; returns the tick count.
// The bound is itself part of the proof: travel must NEVER hang.
function trTickToCompletion(t, maxTicks = 200) {
  let n = 0;
  while (t.travel.getActiveActivity()) {
    if (++n > maxTicks) throw new Error('TR: activity never completed — travel must never hang');
    t.tick.simulateTicks(1);
  }
  return n;
}

// --- TR1: the incident roll is deterministic — same seed + same leg ⇒ same
// incident, both at the pure-function level and across two whole worlds.
const trA = buildTravelWorld();
const trB = buildTravelWorld();
const trOriginNode = trA.map.getNode(trA.travel.getPlayerNodeId());
assert.deepEqual(
  deriveTravelIncident(trA.world.getState().config, trOriginNode, 0),
  deriveTravelIncident(trA.world.getState().config, trOriginNode, 0),
  'the incident roll is a pure function — two calls must be identical'
);
const trDest0 = trNextDest(trA);
assert.equal(trNextDest(trB), trDest0, 'identically-seeded worlds must offer the identical first destination');
trA.travel.startTravel(trDest0);
trB.travel.startTravel(trDest0);
assert.deepEqual(trB.travel.getIncident(0), trA.travel.getIncident(0), 'same seed + same leg ⇒ the same committed incident, every time');
console.log(`TR1 PASSED: incident roll deterministic — leg 0 rolled '${trA.travel.getIncident(0).category}' in both worlds`);

// --- TR2: two-phase order — the roll (with fallback narration) is committed
// SYNCHRONOUSLY at travel start; the AI line lands later as its own event and
// replaces ONLY the display text, never the rolled facts.
const TR_AI_LINE = 'The AI colors the fixed facts of the road, changing nothing.';
globalThis.generateText = () => Promise.resolve(TR_AI_LINE);
const trAi = buildTravelWorld();
const trAiStart = trAi.travel.startTravel(trNextDest(trAi));
const trAiLog = trAi.world.getEventLog();
assert.equal(trAiLog[trAiStart.seq].type, 'ACTION_TRAVEL_STARTED');
assert.equal(trAiLog[trAiStart.seq + 1].type, 'TRAVEL_INCIDENT', 'phase 1: the seeded roll must be committed synchronously, in the very next log entry');
const trRolled = trAi.travel.getIncident(0);
assert.ok(typeof trRolled.narration === 'string' && trRolled.narration.length > 0, 'the fallback narration must be present the instant the incident is committed');
assert.ok(!trAiLog.some((e) => e.type === 'TRAVEL_NARRATION_ENHANCED'), 'phase 2 (AI) must not land synchronously — narration only ever follows the committed roll');
for (let i = 0; trAi.travel.getIncident(0).narration !== TR_AI_LINE; i++) {
  if (i > 2000) throw new Error('TR2: the AI narration never landed');
  await new Promise((r) => setTimeout(r, 5));
}
delete globalThis.generateText;
const trEnhanced = trAi.travel.getIncident(0);
assert.deepEqual(
  { ...trEnhanced, narration: trRolled.narration },
  trRolled,
  'enhancement must replace ONLY the narration — every rolled fact stays exactly as committed'
);
trTickToCompletion(trAi);
console.log('TR2 PASSED: roll committed first, AI enhancement landed later and touched only the display text');

// --- TR3: the safe-travels fallback — under Node (no generateText), the
// committed narration IS the deterministic fallback line, no enhancement
// event ever appears, and the leg completes without waiting on anything.
assert.equal(typeof generateText, 'undefined', 'TR3 must run in the no-AI Node environment');
const trLeg0 = trA.travel.getIncident(0);
assert.equal(trLeg0.narration, fallbackTravelNarration(trLeg0), 'with no plugin, the committed narration is the deterministic fallback line');
trTickToCompletion(trA);
assert.ok(!trA.world.getEventLog().some((e) => e.type === 'TRAVEL_NARRATION_ENHANCED'), 'no AI ⇒ no enhancement event, and nothing hangs waiting for one');
console.log(`TR3 PASSED: safe-travels fallback held — "${trLeg0.narration}"`);

// --- TR4: max one incident per leg — quiet legs included: every started leg
// commits exactly one TRAVEL_INCIDENT, never zero, never stacked.
trA.travel.startTravel(trNextDest(trA));
trTickToCompletion(trA);
trA.travel.startTravel(trNextDest(trA));
trTickToCompletion(trA);
const trStarts = trA.world.getEventLog().filter((e) => e.type === 'ACTION_TRAVEL_STARTED');
const trIncidents = trA.world.getEventLog().filter((e) => e.type === 'TRAVEL_INCIDENT');
assert.equal(trStarts.length, 3, 'the journey so far is three legs');
assert.equal(trIncidents.length, trStarts.length, 'exactly one incident record per started leg');
for (let leg = 0; leg < trStarts.length; leg++) {
  assert.equal(trIncidents.filter((e) => e.payload.legIndex === leg).length, 1, `leg ${leg} must carry exactly one incident`);
}
console.log(`TR4 PASSED: ${trStarts.length} legs, exactly one TRAVEL_INCIDENT each (quiet legs logged as category:'none')`);

// --- TR5: the requires-a-real-turn branch — under a config retuned so every
// leg rolls a 'requiresRealTurn' incident, the stakes are committed as real
// facts (the future combat/social system's hook) but the incident resolves as
// a narrated auto-passthrough, clearly distinct from a quiet leg, and travel
// still arrives on schedule instead of hard-blocking on a system that doesn't
// exist.
const trTurnConfig = structuredClone(trA.world.getState().config);
trTurnConfig.travel.incident.incidentChance = 1;
for (const cat of Object.keys(trTurnConfig.travel.incident.turnIntensityByCategory)) {
  trTurnConfig.travel.incident.turnIntensityByCategory[cat] = 1;
}
const trTurn = buildTravelWorld(trTurnConfig);
trTurn.travel.startTravel(trNextDest(trTurn));
const trTurnIncident = trTurn.travel.getIncident(0);
assert.equal(trTurnIncident.resolutionMode, 'requiresRealTurn', 'the retuned tables must roll a requires-a-real-turn incident');
assert.equal(trTurnIncident.outcome, 'auto-passthrough', "this pass resolves 'requiresRealTurn' incidents as a narrated pass-through, never a hard block");
assert.ok(['fought', 'talked'].includes(trTurnIncident.passthroughFlavor), 'the pass-through carries its rolled flavor');
assert.notEqual(
  trTurnIncident.narration,
  fallbackTravelNarration({ ...trTurnIncident, category: 'none', outcome: 'none' }),
  "the pass-through narration must be clearly distinct from a quiet leg's"
);
const trTurnTicks = trTickToCompletion(trTurn);
assert.equal(trTurn.travel.getActiveActivity(), null, 'the turn-mode leg still completes');
console.log(`TR5 PASSED: 'requiresRealTurn' incident (${trTurnIncident.category}, intensity ${trTurnIncident.intensity}) auto-passthrough ('${trTurnIncident.passthroughFlavor}') — facts logged, travel arrived after ${trTurnTicks} ticks`);

// --- TR6: every cache equals its own from-scratch rebuild, idle AND mid-leg.
assert.equal(trA.travel.rebuildPlayerNodeId(), trA.travel.getPlayerNodeId(), 'position cache must equal its own rebuild');
assert.deepEqual(trA.travel.rebuildIncidents(), trA.travel.getIncidents(), 'incident cache must equal its own rebuild');
assert.equal(trA.travel.rebuildActiveActivity(), null, 'idle ⇒ no derived activity');
assert.equal(trA.travel.getActiveActivity(), null, 'idle ⇒ no cached activity');
trA.travel.startTravel(trNextDest(trA));
trA.tick.simulateTicks(2);
assert.deepEqual(trA.travel.rebuildActiveActivity(), trA.travel.getActiveActivity(), 'mid-leg progress cache must equal its own rebuild');
trTickToCompletion(trA);
assert.equal(trA.travel.rebuildPlayerNodeId(), trA.travel.getPlayerNodeId(), 'post-arrival position cache must equal its own rebuild');
console.log('TR6 PASSED: position, incident, and in-flight-activity caches all equal their own from-scratch rebuilds');

// --- TR7: tick-driven arrival lands on the EXACT expected tick (the full
// final tick counts — the accepted overshoot), the player lands at the chosen
// adjacent node, the context returns to idle, and arrival materializes the
// destination's neighbors so onward edges exist.
const trDest7 = trNextDest(trA);
const trStart7 = trA.travel.startTravel(trDest7);
const trTravelingMult = trA.world.getState().config.timeDilation.multipliers.traveling;
const trExpectedTicks = Math.ceil(trStart7.payload.durationGameSeconds / trTravelingMult);
const trTicks7 = trTickToCompletion(trA);
assert.equal(trTicks7, trExpectedTicks, 'arrival must fire on exactly the tick that crosses the duration');
assert.equal(trA.travel.getPlayerNodeId(), trDest7, 'the player must land at the chosen adjacent node');
assert.equal(trA.clock.getActiveTimeContext(), 'idle', 'arrival must return the context to idle');
assert.equal(trA.map.isMaterialized(trDest7), true, "arrival must materialize the destination's neighbors so onward edges exist");
console.log(`TR7 PASSED: ${trStart7.payload.durationGameSeconds.toFixed(0)} game-s leg arrived on tick ${trTicks7} of ${trExpectedTicks} expected at ×${trTravelingMult}, destination materialized`);

// --- TR8: guards — travel is edge-only and activities never overlap.
assert.throws(() => trA.travel.startTravel('node_9999.000_9999.000'), /not adjacent/, 'traveling to a non-adjacent node must throw');
trA.travel.startTravel(trNextDest(trA));
assert.throws(() => trA.travel.startTravel(trNextDest(trA)), /already in progress/, 'starting a second leg mid-transit must throw');
assert.throws(() => trA.travel.startExplore(), /already in progress/, 'exploring mid-transit must throw');
trTickToCompletion(trA);
console.log('TR8 PASSED: non-adjacent destinations and overlapping activities are rejected loudly');

// --- TR9: the explore window and the dialogue brackets — the last two
// timeContexts get their real verbs. Explore: instant roll (poiEngine used
// as-is), then 'exploring' rides for the configured duration and ends back at
// idle. Dialogue: startDialogue/endDialogue bracket a ×1 chatting window.
const trConfig = trA.world.getState().config;
const trExploreResult = trA.travel.startExplore();
assert.ok('poiId' in trExploreResult, 'the explore roll resolves instantly (found-or-null), before the window elapses');
assert.equal(trA.travel.getActiveActivity()?.kind, 'explore', 'the explore window must be open');
assert.equal(trA.clock.getActiveTimeContext(), 'exploring', "the explore verb's POI_EXPLORED carries timeContext 'exploring'");
const trExploreTicks = trTickToCompletion(trA);
assert.equal(
  trExploreTicks,
  Math.ceil(trConfig.travel.exploreDurationGameSeconds / trConfig.timeDilation.multipliers.exploring),
  'the explore window must end on exactly the expected tick'
);
assert.equal(trA.clock.getActiveTimeContext(), 'idle', 'the explore window must end back at idle');

const trChatBefore = trA.clock.getTotalGameSeconds();
startDialogue(trA.world, 'player_rowan', 'npc_mira');
assert.equal(trA.clock.getActiveTimeContext(), 'chatting', 'startDialogue must set chatting');
trA.tick.simulateTicks(3);
assert.equal(trA.clock.getTotalGameSeconds() - trChatBefore, 3 * 1, 'chatting ticks dilate ×1 — the real AI-latency window is the time cost');
endDialogue(trA.world, 'player_rowan', 'npc_mira');
assert.equal(trA.clock.getActiveTimeContext(), 'idle', 'endDialogue must restore idle');
console.log(`TR9 PASSED: explore window ${trExploreTicks} ticks at ×40 (found ${trExploreResult.poiId ?? 'nothing'}), dialogue bracketed chatting ×1 → idle`);

// --- TR10: whole-journey determinism — the identical scripted journey on two
// fresh worlds produces the identical event log, entry for entry.
function trRunJourney() {
  const t = buildTravelWorld();
  t.travel.startTravel(trNextDest(t));
  trTickToCompletion(t);
  t.travel.startExplore();
  trTickToCompletion(t);
  t.travel.startTravel(trNextDest(t));
  trTickToCompletion(t);
  return t;
}
const trJourneyA = trRunJourney();
const trJourneyB = trRunJourney();
assert.deepEqual(trJourneyB.world.getEventLog(), trJourneyA.world.getEventLog(), 'the identical journey must produce the identical event log');
console.log(`TR10 PASSED: two identical journeys ⇒ identical ${trJourneyA.world.getEventLog().length}-event logs`);

console.log('\nSection TR PASSED: real travel/explore/dialogue verbs carry their timeContexts, incidents roll deterministically and commit before narration, and every new cache is rebuildable from the log alone');

// =============================================================================
// Section EC: inventory & economy — items, gold, shop stock, trade, craft, equip.
//
// The economy engine reuses BOTH established disciplines at once, exactly like
// the POI engine. BASELINE SHOP STOCK is a PURE function of (config, shopRef) —
// per-slot fresh mulberry32 seeded from hashCoords in its own salt band — so
// EC2 is the M1 analogue: stock is fixed by position, never re-rolled.
// Everything that CHANGES (inventories, gold, shop deltas, equipment) is
// log-derived with provably-redundant caches; EC4 is the G5/L3/M6 analogue.
// The new property this section puts on trial is ATOMICITY: trade and craft
// are REACT verbs that resolve everything live and then commit exactly ONE
// outcome event carrying the full resolved transaction — so a success moves
// items AND gold AND shop stock in one indivisible fold (EC5, EC7), and a
// REJECTED attempt appends NOTHING and perturbs NO cache (EC6) — no partial-
// failure state can exist at any log position.
// =============================================================================
console.log('\n=== Section EC: inventory & economy (items, gold, shops, trade, craft, equip) ===');

function runSectionEC(record) {
  const synthShopNode = (tier, x, y) => ({
    id: `syn_ec_${tier}_${x}_${y}`,
    x,
    y,
    classification: { kind: 'settlement', tier, settlementId: `syn_ec_${tier}`, baselineFaction: null, notability: null, hospitability: null },
  });
  const synthShopPoi = (node, b) => ({
    id: `poi_${node.id}_b${b}`,
    nodeId: node.id,
    category: 'shop',
    source: 'baseline',
    prominence: 0.5,
    hidden: false,
    data: {},
  });
  const ecCfg = structuredClone(mapBaseConfig);
  const ledgerRef = { kind: 'authored', shopId: 'shop_rusted_ledger' };

  // --- EC1: static-data sanity — every cross-reference in the shipped catalog
  // resolves, so a content edit that dangles an id fails here, not mid-game.
  {
    const categoryIds = INVENTORY_CATEGORIES.map((c) => c.id);
    const stationIds = CRAFT_STATIONS.map((s) => s.id);
    for (const def of Object.values(ITEM_DEFS)) {
      assert.ok(categoryIds.includes(def.category), `item ${def.id} category "${def.category}" must be a UI inventory category`);
      assert.ok(def.baseValue > 0 && Number.isInteger(def.baseValue), `item ${def.id} needs a positive integer baseValue`);
      if (def.slot !== undefined) assert.ok(EQUIP_SLOTS.includes(def.slot), `item ${def.id} slot "${def.slot}" must be a mannequin slot`);
    }
    for (const recipe of Object.values(RECIPES)) {
      assert.ok(stationIds.includes(recipe.stationId), `recipe ${recipe.id} station "${recipe.stationId}" must be a UI craft station`);
      assert.ok(recipe.skill.name in PRIMARY_SKILL_ATTRIBUTE, `recipe ${recipe.id} skill "${recipe.skill.name}" must be a primary skill`);
      for (const defId of Object.keys(recipe.inputs)) getItemDef(defId);
      getItemDef(recipe.output.defId);
    }
    for (const [poolName, entries] of Object.entries(SHOP_POOLS)) {
      for (const e of entries) {
        getItemDef(e.defId);
        assert.ok(e.weight > 0, `pool ${poolName} entry ${e.defId} needs a positive weight`);
      }
    }
    const authoredIds = new Set();
    for (const shop of Object.values(AUTHORED_SHOPS)) {
      for (const defId of Object.keys(shop.stock.stacks)) getItemDef(defId);
      for (const inst of shop.stock.instances) {
        getItemDef(inst.itemDefId);
        assert.ok(!authoredIds.has(inst.instanceId), `authored instance id ${inst.instanceId} must be unique`);
        authoredIds.add(inst.instanceId);
      }
    }
    record(`EC1 PASSED: shipped catalog is closed — ${Object.keys(ITEM_DEFS).length} item defs, ${Object.keys(RECIPES).length} recipes, ${Object.values(SHOP_POOLS).flat().length} pool entries, ${Object.keys(AUTHORED_SHOPS).length} authored shop(s), every cross-reference resolves`);
  }

  // --- EC2: baseline stock is a pure function of (config, shopRef) — the M1
  // analogue. Identical twice-derived; distinct per poi index; tier-gated
  // (hamlet shops never carry city-gated goods); the authored Rusted Ledger
  // baseline IS the shipped record.
  {
    const village = synthShopNode('village', 2600, 2600);
    const shopA = synthShopPoi(village, 0);
    const refA = { kind: 'poi', node: village, poi: shopA };
    const once = deriveBaselineStock(ecCfg, refA);
    assert.deepEqual(deriveBaselineStock(ecCfg, refA), once, 're-deriving baseline stock must be byte-identical (never re-rolled)');
    const slots = Object.values(once.stacks).reduce((s, q) => s + (q > 0 ? 1 : 0), 0) + once.instances.length;
    assert.ok(slots > 0, 'a village shop must have non-empty baseline stock');
    assert.equal(once.gold, ecCfg.economy.shop.baseGoldByTier.village, 'shop gold comes from the tier table');

    const refB = { kind: 'poi', node: village, poi: synthShopPoi(village, 3) };
    assert.notDeepEqual(deriveBaselineStock(ecCfg, refB), once, 'two shop POIs at the same node must stock independently (salt includes the poi index)');

    const cityGated = new Set(SHOP_POOLS.general.filter((e) => e.minTier === 'city').map((e) => e.defId));
    const hamlet = synthShopNode('hamlet', 3100, 3100);
    const hamletStock = deriveBaselineStock(ecCfg, { kind: 'poi', node: hamlet, poi: synthShopPoi(hamlet, 0) });
    for (const defId of [...Object.keys(hamletStock.stacks), ...hamletStock.instances.map((i) => i.itemDefId)]) {
      assert.ok(!cityGated.has(defId), `hamlet shop must not carry city-gated ${defId}`);
    }

    const ledger = deriveBaselineStock(ecCfg, ledgerRef);
    assert.deepEqual(
      ledger,
      { ...structuredClone(AUTHORED_SHOPS.shop_rusted_ledger.stock), gold: AUTHORED_SHOPS.shop_rusted_ledger.baselineGold },
      'the authored Rusted Ledger baseline must be exactly the shipped record'
    );
    record(`EC2 PASSED: baseline stock is position-deterministic (${slots} village slots, poi-index-independent, tier-gated) and the authored Rusted Ledger baseline equals the shipped record`);
  }

  // --- EC3: pricing — flat baseValue spread through priceFor, shop margin on
  // every def (sells strictly above buys, no arbitrage loop anywhere in the
  // catalog), hand-computed spot checks.
  {
    const ctx = { category: 'authored', tier: null, nodeId: null };
    assert.equal(priceFor(ecCfg, ITEM_DEFS.iron_sword, ctx, 'shopSells'), 78, 'iron_sword (60c) sells at round(60×1.3)=78');
    assert.equal(priceFor(ecCfg, ITEM_DEFS.iron_sword, ctx, 'shopBuys'), 42, 'iron_sword (60c) buys at floor(60×0.7)=42');
    assert.equal(priceFor(ecCfg, ITEM_DEFS.spring_water, ctx, 'shopSells'), 1, 'the cheapest item still sells for at least 1c');
    for (const def of Object.values(ITEM_DEFS)) {
      const sells = priceFor(ecCfg, def, ctx, 'shopSells');
      const buys = priceFor(ecCfg, def, ctx, 'shopBuys');
      assert.ok(sells > buys, `${def.id}: shop must sell (${sells}) strictly above what it buys for (${buys})`);
    }
    record(`EC3 PASSED: priceFor spreads baseValue into a strict shop margin for all ${Object.keys(ITEM_DEFS).length} defs (60c → sells 78 / buys 42)`);
  }

  // Lived fixture for EC4-EC8: the sample world (whose construction seeds
  // Rowan's purse and pack) plus a fresh economy engine that must prime those
  // seed events from the log it finds.
  const fan = buildSampleWorld();
  const economy = createEconomyEngine(fan.world, fan.registry);
  const rowanId = fan.rowan.id;

  // --- EC4: seed grants fold through the log — gold and holdings match the
  // seeded amounts, stacks merge on grant and vanish at zero, and every cache
  // equals its own from-scratch rebuild (the primed-cache proof).
  {
    assert.equal(economy.getGold(rowanId), 150, 'the seeded purse must be primed from the log');
    const inv = economy.getInventory(rowanId);
    assert.equal(inv.stacks.iron_ore, 4, 'seeded stack quantities must fold');
    assert.equal(inv.instances.length, 3, 'seeded instances must fold');
    assert.ok(inv.instances.some((i) => i.itemDefId === 'iron_dagger'), 'the seeded dagger is an instance');

    economy.grantItems(rowanId, { stacks: { bread: 3 } }, 'ec_test');
    assert.equal(economy.getInventory(rowanId).stacks.bread, 5, 'granting an owned stack must merge (2+3), not duplicate the key');
    const dropped = economy.drop(rowanId, { stacks: { bread: 5 } });
    assert.ok(dropped.ok, 'dropping the whole stack must succeed');
    assert.ok(!('bread' in economy.getInventory(rowanId).stacks), 'a stack at zero must DELETE its key, not linger as 0');

    assert.deepEqual(economy.rebuildGold(rowanId), economy.getGold(rowanId), 'gold cache must equal its own rebuild');
    assert.deepEqual(economy.rebuildInventory(rowanId), economy.getInventory(rowanId), 'inventory cache must equal its own rebuild');
    assert.deepEqual(deriveInventory(fan.world.getEventLog(), rowanId), economy.getInventory(rowanId), 'the pure derivation must agree with the cached read');
    record('EC4 PASSED: seeded gold/holdings primed from the log, stacks merge on grant and delete at zero, caches equal their rebuilds');
  }

  // --- EC5: an accepted trade is ONE event that moves everything at once —
  // items and gold on the actor, stock and gold on the shop, conservation
  // between them; instance records move intact; every cache stays rebuildable.
  {
    const before = {
      logLen: fan.world.getEventLog().length,
      gold: economy.getGold(rowanId),
      shop: economy.getShopStock(ledgerRef),
    };
    const daggerId = 'itm_a_rusted_ledger_2';
    const result = economy.trade(rowanId, ledgerRef, { buy: [{ defId: 'ale', qty: 2 }, { instanceId: daggerId }] });
    assert.ok(result.ok, `the buy must succeed (${result.reason ?? ''})`);
    assert.equal(fan.world.getEventLog().length, before.logLen + 1, 'a trade commits EXACTLY ONE event');
    assert.equal(result.entry.type, 'TRADE_COMPLETED', 'and that event is the committed transaction');

    const shopAfter = economy.getShopStock(ledgerRef);
    const spent = before.gold - economy.getGold(rowanId);
    assert.ok(spent > 0, 'buying must cost gold');
    assert.equal(shopAfter.gold - before.shop.gold, spent, 'gold is conserved: what the player spent the shop gained');
    assert.equal(before.shop.stacks.ale - (shopAfter.stacks.ale ?? 0), 2, 'the shop stack depleted by the bought quantity (finite stock)');
    assert.ok(!shopAfter.instances.some((i) => i.instanceId === daggerId), 'the bought instance left the shop');
    assert.ok(economy.getInventory(rowanId).instances.some((i) => i.instanceId === daggerId), 'and arrived in the inventory with the same id');

    const sellBack = economy.trade(rowanId, ledgerRef, { sell: [{ defId: 'iron_ingot', qty: 1 }] });
    assert.ok(sellBack.ok, 'the sell must succeed');
    assert.equal(shopAfter.gold - economy.getShopStock(ledgerRef).gold, priceFor(ecCfg, ITEM_DEFS.iron_ingot, { category: 'authored', tier: null, nodeId: null }, 'shopBuys'), 'the shop paid its buy price');
    assert.equal(economy.getShopStock(ledgerRef).stacks.iron_ingot, 1, 'the sold stack entered shop stock');

    assert.deepEqual(economy.rebuildInventory(rowanId), economy.getInventory(rowanId), 'inventory cache must equal its rebuild after trades');
    assert.deepEqual(economy.rebuildGold(rowanId), economy.getGold(rowanId), 'gold cache must equal its rebuild after trades');
    assert.deepEqual(economy.rebuildShopStock(ledgerRef), economy.getShopStock(ledgerRef), 'shop stock (baseline ⊕ deltas) must equal its pure rebuild');
    assert.deepEqual(deriveShopStock(fan.world.getState().config, fan.world.getEventLog(), ledgerRef), economy.getShopStock(ledgerRef), 'the pure shop-stock derivation must agree with the cached read');
    record(`EC5 PASSED: buy (2 ale + the Ledger's dagger, ${spent}c) and sell each committed as ONE atomic event — gold conserved, stock finite, instance ids intact, caches equal rebuilds`);
  }

  // --- EC6: a REJECTED attempt appends NOTHING — wrong for any reason (actor
  // gold, shop stock, ownership, equipped, shop gold), the log length is
  // unchanged and every cache is bit-for-bit undisturbed.
  {
    // Equip the seeded dagger so the equipped-sell rejection is exercised
    // (this one dispatch is a real, accepted action — the snapshot follows it).
    const seededDagger = economy.getInventory(rowanId).instances.find((i) => i.itemDefId === 'iron_dagger');
    assert.ok(economy.equip(rowanId, 'mainHand', seededDagger.instanceId).ok, 'equipping the seeded dagger must succeed');
    economy.grantItems(rowanId, { stacks: { soul_shard: 10 } }, 'ec_test'); // enough to out-price the shop's purse

    const snapshot = () => ({
      logLen: fan.world.getEventLog().length,
      gold: economy.getGold(rowanId),
      inv: economy.getInventory(rowanId),
      equipped: economy.getEquipped(rowanId),
      shop: economy.getShopStock(ledgerRef),
    });
    const before = snapshot();
    const attempts = [
      ['insufficient actor gold', economy.trade(rowanId, ledgerRef, { buy: [{ defId: 'arcane_dust', qty: 2 }, { instanceId: 'itm_a_rusted_ledger_0' }, { instanceId: 'itm_a_rusted_ledger_1' }, { defId: 'ale', qty: 8 }, { defId: 'playing_cards', qty: 4 }, { defId: 'dice_set', qty: 6 }, { defId: 'dockside_ballads', qty: 2 }, { defId: 'bread', qty: 4 }] })],
      ['insufficient shop stock', economy.trade(rowanId, ledgerRef, { buy: [{ defId: 'ale', qty: 999 }] })],
      ['selling an unowned stack', economy.trade(rowanId, ledgerRef, { sell: [{ defId: 'oak_wood', qty: 1 }] })],
      ['selling an unowned instance', economy.trade(rowanId, ledgerRef, { sell: [{ instanceId: 'itm_nope_0' }] })],
      ['selling an equipped item', economy.trade(rowanId, ledgerRef, { sell: [{ instanceId: seededDagger.instanceId }] })],
      ['a buyout the shop cannot afford', economy.trade(rowanId, ledgerRef, { sell: [{ defId: 'soul_shard', qty: 10 }] })],
      ['an empty offer', economy.trade(rowanId, ledgerRef, {})],
      ['dropping an equipped item', economy.drop(rowanId, { instanceIds: [seededDagger.instanceId] })],
    ];
    for (const [label, result] of attempts) {
      assert.equal(result.ok, false, `${label} must be rejected`);
      assert.ok(typeof result.reason === 'string' && result.reason.length > 0, `${label} must carry a human-readable reason`);
    }
    assert.deepEqual(snapshot(), before, 'after every rejection: log length unchanged, no cache perturbed — nothing was half-applied');
    record(`EC6 PASSED: ${attempts.length} invalid attempts (gold, stock, ownership, equipped, shop purse, empty) each rejected with a reason and appended NOTHING`);
  }

  // --- EC7: craft is deterministic and atomic — ONE event both consumes the
  // inputs and produces the output (stackable and instance-minting recipes,
  // instance ids embedding the entry's own seq); an unmet gate or missing
  // material appends nothing; success at exactly the gate value.
  {
    const invBefore = economy.getInventory(rowanId);
    const logLenBefore = fan.world.getEventLog().length;

    const smelt = economy.craft(rowanId, 'blacksmith', 'bs_smelt'); // smithing gate 4, Rowan effective 7
    assert.ok(smelt.ok, `bs_smelt must succeed (${smelt.reason ?? ''})`);
    assert.equal(fan.world.getEventLog().length, logLenBefore + 1, 'a craft commits EXACTLY ONE event');
    const invAfterSmelt = economy.getInventory(rowanId);
    assert.equal(invBefore.stacks.iron_ore - invAfterSmelt.stacks.iron_ore, 2, 'the same event consumed the ore...');
    assert.equal(invAfterSmelt.stacks.iron_ingot - (invBefore.stacks.iron_ingot ?? 0), 1, '...and produced the ingot — no state between');

    // Instance-minting + instance-consuming recipe: the enchant consumes the
    // seeded copper_ring INSTANCE and mints the output with the entry's seq.
    assert.equal(effectiveSkill(fan.registry.get(rowanId), 'enchanting'), RECIPES.en1.skill.min, 'the fixture pins Rowan EXACTLY at the en1 gate — meeting it must be enough');
    const ringBefore = economy.getInventory(rowanId).instances.find((i) => i.itemDefId === 'copper_ring');
    const enchant = economy.craft(rowanId, 'enchanting', 'en1');
    assert.ok(enchant.ok, `en1 at exactly the gate must succeed (${enchant.reason ?? ''})`);
    const invAfterEnchant = economy.getInventory(rowanId);
    assert.ok(!invAfterEnchant.instances.some((i) => i.instanceId === ringBefore.instanceId), 'the consumed ring instance is gone');
    const minted = invAfterEnchant.instances.find((i) => i.itemDefId === 'ring_of_embers');
    assert.equal(minted.instanceId, `itm_${enchant.entry.seq}_0`, "the minted instance id embeds its own event's seq");

    const failSnapshot = fan.world.getEventLog().length;
    const gated = economy.craft(rowanId, 'blacksmith', 'bs2'); // smithing gate 9 > Rowan's 7
    assert.equal(gated.ok, false, 'an unmet skill gate must reject');
    const starved = economy.craft(rowanId, 'enchanting', 'en2'); // needs a bone_amulet Rowan doesn't own
    assert.equal(starved.ok, false, 'missing materials must reject');
    const misStationed = economy.craft(rowanId, 'blacksmith', 'al1'); // alchemy recipe at the forge
    assert.equal(misStationed.ok, false, 'a recipe crafted at the wrong station must reject');
    assert.equal(fan.world.getEventLog().length, failSnapshot, 'rejected crafts append NOTHING');
    assert.deepEqual(economy.rebuildInventory(rowanId), economy.getInventory(rowanId), 'inventory cache must equal its rebuild after crafts');
    record(`EC7 PASSED: crafts are atomic single events (smelt consumed 2 ore → 1 ingot; en1 at exactly gate ${RECIPES.en1.skill.min} consumed the ring instance and minted itm_${enchant.entry.seq}_0); gate/material/station rejections appended nothing`);
  }

  // --- EC8: equipment — slot-checked, last-write-wins per slot, unequip via
  // null, ownership enforced, and the derived map rebuildable from the log.
  {
    const inv = economy.getInventory(rowanId);
    const jerkin = inv.instances.find((i) => i.itemDefId === 'leather_jerkin');
    const ember = inv.instances.find((i) => i.itemDefId === 'ring_of_embers');

    assert.equal(economy.equip(rowanId, 'head', jerkin.instanceId).ok, false, 'a chest piece must not fit the head slot');
    assert.equal(economy.equip(rowanId, 'ring', 'itm_nope_1').ok, false, 'equipping an unowned instance must reject');
    assert.ok(economy.equip(rowanId, 'chest', jerkin.instanceId).ok, 'the jerkin equips to chest');
    assert.ok(economy.equip(rowanId, 'ring', ember.instanceId).ok, 'the crafted ring equips');
    assert.equal(economy.getEquipped(rowanId).ring, ember.instanceId, 'the ring slot holds the crafted ring');

    // Replace-in-slot: crafting another enchanted ring needs another copper
    // ring and more arcane dust (en1 in EC7 consumed the seeded dust) — barter
    // the Ledger's ring + dust against three soul shards, enchant, equip over.
    assert.ok(economy.trade(rowanId, ledgerRef, { buy: [{ instanceId: 'itm_a_rusted_ledger_0' }, { defId: 'arcane_dust', qty: 2 }], sell: [{ defId: 'soul_shard', qty: 3 }] }).ok, 'barter: the Ledger ring and dust for three shards');
    const secondRing = economy.craft(rowanId, 'enchanting', 'en1');
    assert.ok(secondRing.ok, `the second enchant must succeed (${secondRing.reason ?? ''})`);
    const secondId = `itm_${secondRing.entry.seq}_0`;
    assert.ok(economy.equip(rowanId, 'ring', secondId).ok, 'equipping over an occupied slot is a plain replace');
    assert.equal(economy.getEquipped(rowanId).ring, secondId, 'last write wins the slot');
    assert.ok(economy.getInventory(rowanId).instances.some((i) => i.instanceId === ember.instanceId), 'the replaced ring stays in the inventory');

    assert.ok(economy.equip(rowanId, 'ring', null).ok, 'null unequips');
    assert.ok(!('ring' in economy.getEquipped(rowanId)), 'the slot is empty after unequip');
    assert.ok(economy.drop(rowanId, { instanceIds: [secondId] }).ok, 'the unequipped ring can now be dropped');

    assert.deepEqual(economy.rebuildEquipped(rowanId), economy.getEquipped(rowanId), 'equipped cache must equal its own rebuild');
    assert.deepEqual(deriveEquipped(fan.world.getEventLog(), rowanId), economy.getEquipped(rowanId), 'the pure equipped derivation must agree with the cached read');
    record('EC8 PASSED: equip is slot-checked and ownership-checked, replace is last-write-wins with the old item retained, null unequips, and the equipped map rebuilds from the log');
  }

  // Determinism at the raw-state level: the exact same lived economy twice ⇒
  // identical logs, and gold/holdings derive identically from either.
  return { log: fan.world.getEventLog() };
}

const sectionEcLinesA = [];
const ecRunA = runSectionEC((m) => {
  sectionEcLinesA.push(m);
  console.log(m);
});

// --- EC-final: determinism across full runs (M-final analogue) — the entire
// section re-run produces byte-identical output AND a byte-identical event log.
const sectionEcLinesB = [];
const ecRunB = runSectionEC((m) => sectionEcLinesB.push(m));
assert.deepEqual(sectionEcLinesA, sectionEcLinesB, 'Section EC output must be byte-identical across two full runs');
assert.deepEqual(ecRunB.log, ecRunA.log, 'the identical lived economy must produce the identical event log');
console.log(`EC-final PASSED: Section EC produced identical output (${sectionEcLinesA.length} lines) and an identical ${ecRunA.log.length}-event log across two full runs`);

console.log('\nSection EC PASSED: baseline shop stock is a pure seeded function of (config, shopRef); inventories, gold, shop deltas, and equipment are log-derived and rebuildable; trade and craft commit as single atomic outcome events whose rejections append nothing');

// =============================================================================
// Section QU: quests & contracts — the guild board's log-backed lifecycle
// (available → active → completed | failed) over hand-authored definitions,
// with objectives detected by PURE LOG-REPLAY (no per-event-type
// subscriptions) and rewards paid through the REAL existing systems:
// economy.grantGold/grantItems, relationshipStore.recordRelationshipEvent,
// factionEngine.setFactionControl, and the POI engine's injectPoi /
// grantRevealAuthority — the pair built as quest stand-ins, getting their
// first non-debug caller here. Replay safety is the headline: reconstructing
// the whole world from its save must reproduce quest state WITHOUT
// re-injecting POIs or re-granting a single reward.
// =============================================================================
console.log('\n=== Section QU: quests & contracts (guild board, log-backed lifecycle, real-system rewards) ===');

function runSectionQU(record) {
  // Fixture wiring: the app's engine order, minus npcGen/memory (helpNpc
  // would fan out async AI memory enhancement; relationshipEffect alone
  // handles the synchronous stat deltas the tier objective needs).
  const fan = buildSampleWorld();
  createRelationshipEffectEngine(fan.world, fan.relationships);
  const quMap = createWorldMapEngine(fan.world);
  const quPoi = createPoiEngine(fan.world);
  const quClock = createWorldClockEngine(fan.world);
  const quFaction = createFactionEngine(fan.world);
  const quTravel = createTravelEngine(fan.world, quMap, quPoi);
  const quEconomy = createEconomyEngine(fan.world, fan.registry);
  const quests = createQuestEngine(fan.world, {
    playerId: fan.rowan.id,
    economy: quEconomy,
    relationships: fan.relationships,
    faction: quFaction,
    poi: quPoi,
    travel: quTravel,
  });
  const rowanId = fan.rowan.id;
  const quCfg = fan.world.getState().config;
  const quOrigin = quMap.getOriginNode();
  const quNeighborIds = new Set(quMap.materializeNeighbors(quOrigin.id).neighbors.map((n) => n.id));

  function quTickUntilIdle(label) {
    for (let i = 0; quTravel.getActiveActivity(); i++) {
      if (i > 200) throw new Error(`QU: ${label} never finished`);
      fan.world.dispatch('CLOCK_TICK', { realSecondsElapsed: 1 });
    }
  }

  // --- QU1: static closure — every id a shipped quest def references
  // resolves against the REAL world it ships with: authored NPCs, item defs,
  // recipes, objective types, relationship axes/tiers, POI categories, and —
  // the seed-binding checks — the origin node, its materialized neighbors,
  // and the generated settlement the faction consequence targets. A
  // seed/config/content change that orphans a quest fails HERE, loudly, not
  // in play.
  {
    const relationshipAxes = ['affection', 'comfort', 'trust', 'desire', 'obedience'];
    const tierLabels = TIER_THRESHOLDS.map((t) => t.label);
    const poiCategories = new Set([
      ...Object.keys(quCfg.worldMap.poi.settlement.categories),
      ...Object.keys(quCfg.worldMap.poi.wilderness.categories),
    ]);
    const factionCount = quCfg.worldMap.classification.faction.factionCount;
    const injectedPoiIds = new Set();

    for (const questId of questIds()) {
      const def = getQuestDef(questId);
      assert.equal(def.id, questId, `quest ${questId} must carry its own id`);
      assert.ok(fan.registry.get(def.giverId), `quest ${questId} giver "${def.giverId}" must be a registered entity`);
      assert.equal(def.giverNodeId, quOrigin.id, `quest ${questId} giverNodeId must be the generated origin node`);
      assert.ok(def.objectives.length > 0, `quest ${questId} needs at least one objective`);

      for (const objective of def.objectives) {
        assert.ok(OBJECTIVE_TYPES.includes(objective.type), `quest ${questId} objective type "${objective.type}" must be shipped`);
        if (objective.type === 'travelTo') {
          assert.ok(
            objective.nodeId === quOrigin.id || quNeighborIds.has(objective.nodeId),
            `quest ${questId} travelTo node "${objective.nodeId}" must be the origin or a materialized origin neighbor`
          );
        } else if (objective.type === 'craftRecipe') {
          assert.ok(RECIPES[objective.recipeId], `quest ${questId} recipe "${objective.recipeId}" must exist`);
          assert.ok(Number.isInteger(objective.count) && objective.count > 0, `quest ${questId} craft count must be a positive integer`);
        } else if (objective.type === 'deliverItems') {
          assert.ok(fan.registry.get(objective.npcId), `quest ${questId} delivery target "${objective.npcId}" must be registered`);
          for (const [defId, qty] of Object.entries(objective.stacks)) {
            assert.ok(getItemDef(defId).stackable, `quest ${questId} delivery item "${defId}" must be stackable`);
            assert.ok(Number.isInteger(qty) && qty > 0, `quest ${questId} delivery qty for "${defId}" must be a positive integer`);
          }
        } else if (objective.type === 'reachRelationshipTier') {
          assert.ok(fan.registry.get(objective.npcId), `quest ${questId} tier target "${objective.npcId}" must be registered`);
          assert.ok(tierLabels.includes(objective.tier), `quest ${questId} tier "${objective.tier}" must be an ordinary ladder tier`);
        }
      }

      for (const { nodeId, poi: stub } of def.onAccept?.injectPois ?? []) {
        assert.ok(nodeId === quOrigin.id || quNeighborIds.has(nodeId), `quest ${questId} injects into "${nodeId}", which must be the origin or a materialized origin neighbor`);
        assert.ok(poiCategories.has(stub.category), `quest ${questId} injected POI category "${stub.category}" must be a configured category`);
        assert.ok(!injectedPoiIds.has(stub.id), `injected POI id "${stub.id}" must be unique across quests`);
        injectedPoiIds.add(stub.id);
      }
      for (const poiId of def.onAccept?.revealPoiIds ?? []) {
        assert.ok(injectedPoiIds.has(poiId), `quest ${questId} reveal grant "${poiId}" must reference a POI the quest injects`);
      }
      // discoverPoi objectives must target something reachable: a POI the
      // quest itself injects (v1's only discoverPoi flavor).
      for (const objective of def.objectives) {
        if (objective.type === 'discoverPoi') {
          assert.ok(injectedPoiIds.has(objective.poiId), `quest ${questId} discoverPoi target "${objective.poiId}" must be injected by the quest`);
        }
      }

      const rewards = def.rewards ?? {};
      if (rewards.gold !== undefined) assert.ok(Number.isInteger(rewards.gold) && rewards.gold > 0, `quest ${questId} gold reward must be a positive integer`);
      for (const defId of Object.keys(rewards.items?.stacks ?? {})) getItemDef(defId);
      for (const ev of rewards.relationshipEvents ?? []) {
        assert.ok(fan.registry.get(ev.fromId) && fan.registry.get(ev.toId), `quest ${questId} relationship reward entities must be registered`);
        assert.ok(relationshipAxes.includes(ev.axis), `quest ${questId} relationship reward axis "${ev.axis}" must be a real axis`);
      }
      for (const fc of rewards.factionControl ?? []) {
        const cellMatch = /^settlement_(-?\d+)_(-?\d+)$/.exec(fc.settlementId);
        assert.ok(cellMatch, `quest ${questId} faction consequence settlement "${fc.settlementId}" must be a generated settlement id`);
        const site = isSettlementSiteAccepted(quCfg, Number(cellMatch[1]), Number(cellMatch[2]));
        assert.ok(site && site.id === fc.settlementId, `quest ${questId} faction consequence settlement "${fc.settlementId}" must be an ACCEPTED site under the shipped config`);
        const factionIndex = Number(/^faction_(\d+)$/.exec(fc.factionId)?.[1] ?? NaN);
        assert.ok(factionIndex >= 0 && factionIndex < factionCount, `quest ${questId} faction "${fc.factionId}" must be within factionCount ${factionCount}`);
      }
    }
    record(`QU1 PASSED: shipped quest catalog is closed — ${questIds().length} defs, every giver/node/recipe/item/axis/tier/POI/settlement reference resolves against the real generated world`);
  }

  // The settlement node the camp contract's faction consequence targets,
  // derived pure for the QU2 before/after control read.
  const quSettlementSite = isSettlementSiteAccepted(quCfg, 1, -1);
  const quSettlementNode = deriveNodeAt(quCfg, quSettlementSite.x, quSettlementSite.y);

  // --- QU2: the headline lifecycle — accept at the giver's node (injecting
  // the hidden camp POI and arming reveal authority: the stand-ins' first
  // real caller), REALLY travel there, seek it out through the wired
  // directed-explore verb, return, and turn in. Rewards land through the
  // real systems (gold, Sable's trust, the village's faction flip), the
  // status fact commits LAST, and every rejection appends nothing.
  {
    assert.deepEqual(quests.getQuestStatuses().quest_clear_camp, { status: 'available', acceptedSeq: null, resolvedSeq: null }, 'a fresh world offers the contract');

    // Turn-in and abandon both require an ACTIVE quest.
    const lenBefore = fan.world.getEventLog().length;
    assert.equal(quests.completeQuest('quest_clear_camp').ok, false, 'completing an unaccepted quest must be rejected');
    assert.equal(quests.abandonQuest('quest_clear_camp').ok, false, 'abandoning an unaccepted quest must be rejected');
    assert.equal(fan.world.getEventLog().length, lenBefore, 'rejected quest verbs append NOTHING');

    const accepted = quests.acceptQuest('quest_clear_camp');
    assert.ok(accepted.ok, `accepting at the giver's node must succeed (${accepted.reason ?? ''})`);
    assert.equal(accepted.entry.type, 'QUEST_ACCEPTED');
    const injected = fan.world.getEventLog().filter((e) => e.type === 'POI_INJECTED' && e.payload.poi.id === 'poi_q_wolfpine_camp');
    assert.equal(injected.length, 1, 'accepting must inject the camp POI exactly once (injectPoi retired as a stand-in)');
    assert.equal(injected[0].payload.nodeId, 'node_6.285_-1.357', 'the camp lands on the authored hills neighbor');
    assert.ok(quPoi.getRevealedPoiIds().has('poi_q_wolfpine_camp'), 'accepting must grant reveal authority (grantRevealAuthority retired as a stand-in)');
    assert.equal(quests.getQuestStatuses().quest_clear_camp.status, 'active');
    assert.equal(quests.acceptQuest('quest_clear_camp').ok, false, 're-accepting an active quest must be rejected');

    const progress0 = quests.getObjectiveProgress('quest_clear_camp');
    assert.deepEqual(progress0.map((o) => o.done), [false], 'the camp is not found at acceptance');
    assert.equal(quests.completeQuest('quest_clear_camp').ok, false, 'turn-in with an unmet objective must be rejected');

    // Travel to the camp's node for real (tick-driven arrival), seek it out
    // through the wired directed-explore verb (the ONLY path that surfaces a
    // hidden POI), and confirm the objective flips by pure log replay.
    quTravel.startTravel('node_6.285_-1.357');
    quTickUntilIdle('the leg to the camp node');
    assert.equal(quTravel.getPlayerNodeId(), 'node_6.285_-1.357', 'arrived at the camp node');
    assert.equal(quests.acceptQuest('quest_bread_run').ok, false, 'accepting away from the giver must be rejected (the board is a place)');
    const sought = quTravel.startExploreDirected('poi_q_wolfpine_camp');
    assert.equal(sought.poiId, 'poi_q_wolfpine_camp', 'directed explore with authority surfaces the hidden camp');
    quTickUntilIdle('the explore window');
    assert.deepEqual(quests.getObjectiveProgress('quest_clear_camp').map((o) => o.done), [true], 'the discoverPoi objective is met after POI_DISCOVERED');
    assert.equal(quests.completeQuest('quest_clear_camp').ok, false, 'turn-in away from the giver must be rejected');

    quTravel.startTravel(quOrigin.id);
    quTickUntilIdle('the leg home');

    const goldBefore = quEconomy.getGold(rowanId);
    const trustBefore = deriveRelationshipStats(fan.world.getEventLog(), 'npc_sable', rowanId).trust;
    assert.equal(quFaction.getFactionControl(quSettlementNode), quSettlementNode.classification.baselineFaction, 'the village is at its baseline faction before turn-in');
    const done = quests.completeQuest('quest_clear_camp');
    assert.ok(done.ok, `turn-in at the giver must succeed (${done.reason ?? ''})`);
    assert.equal(done.entry.seq, fan.world.getEventLog().length - 1, 'QUEST_COMPLETED commits LAST — after every reward, so a failure could never strand a completed-but-unpaid quest');
    const rewardEntries = fan.world.getEventLog().filter((e) =>
      (e.type === 'GOLD_GRANTED' && e.payload.reason === 'quest_clear_camp') ||
      (e.type === 'FACTION_CONTROL_CHANGED' && e.payload.settlementId === 'settlement_1_-1'));
    assert.equal(rewardEntries.length, 2, 'exactly one gold grant and one faction flip were paid');
    assert.ok(rewardEntries.every((e) => e.seq < done.entry.seq), 'every reward fact precedes the status fact');
    assert.equal(quEconomy.getGold(rowanId), goldBefore + 60, 'the 60c bounty landed through economy.grantGold');
    assert.equal(deriveRelationshipStats(fan.world.getEventLog(), 'npc_sable', rowanId).trust, trustBefore + 8, "Sable's trust moved through recordRelationshipEvent");
    assert.equal(quFaction.getFactionControl(quSettlementNode), 'faction_2', 'the village flipped through setFactionControl');
    assert.equal(deriveFactionControl(fan.world.getEventLog(), 'settlement_1_-1', quSettlementNode.classification.baselineFaction), 'faction_2', 'the pure faction derivation agrees');
    assert.equal(quests.getQuestStatuses().quest_clear_camp.status, 'completed');
    assert.equal(quests.acceptQuest('quest_clear_camp').ok, false, 'completed is terminal — no re-accept');
    record(`QU2 PASSED: full lifecycle — accept injected the hidden camp + reveal authority (the stand-ins' first real caller), travel + directed explore met the objective by log replay, turn-in paid 60c / trust +8 / faction flip through the real systems with QUEST_COMPLETED last`);
  }

  // --- QU3: delivery — the bread run consumes the goods through the
  // economy's new atomic ITEMS_TRANSFERRED (the one event type this task
  // added to economy: player→NPC hand-off didn't exist), and an invalid
  // transfer appends nothing.
  {
    const badTransfer = quEconomy.transferItems(rowanId, 'npc_mira', { stacks: { bread: 99 } }, 'qu_test');
    assert.equal(badTransfer.ok, false, 'transferring more than is held must be rejected');
    const badInstance = quEconomy.transferItems(rowanId, 'npc_mira', { stacks: { iron_dagger: 1 } }, 'qu_test');
    assert.equal(badInstance.ok, false, 'transferring a non-stackable must be rejected (v1 is stacks-only)');

    assert.ok(quests.acceptQuest('quest_bread_run').ok, 'accepting the bread run at the giver must succeed');
    const progress = quests.getObjectiveProgress('quest_bread_run');
    assert.deepEqual(progress.map((o) => o.done), [true], 'the seeded 2 bread already satisfy the delivery objective');
    assert.equal(progress[0].note, 'ready to deliver');

    const goldBefore = quEconomy.getGold(rowanId);
    const done = quests.completeQuest('quest_bread_run');
    assert.ok(done.ok, `the bread run turn-in must succeed (${done.reason ?? ''})`);
    const transfers = fan.world.getEventLog().filter((e) => e.type === 'ITEMS_TRANSFERRED' && e.payload.reason === 'quest_bread_run');
    assert.equal(transfers.length, 1, 'the delivery is ONE atomic transfer event');
    assert.ok(!('bread' in quEconomy.getInventory(rowanId).stacks), "the player's bread stack is consumed (key deleted at zero)");
    assert.equal(quEconomy.getInventory('npc_mira').stacks.bread, 2, "Mira's holdings gained the loaves (same event, other side)");
    assert.deepEqual(deriveInventory(fan.world.getEventLog(), 'npc_mira'), quEconomy.getInventory('npc_mira'), 'the pure inventory derivation agrees for the NPC side');
    assert.equal(quEconomy.getGold(rowanId), goldBefore + 20, 'the 20c payment landed');
    assert.equal(quests.getObjectiveProgress('quest_bread_run')[0].note, 'delivered', 'after turn-in the objective reads from the transfer record, not the (now empty) holdings');
    record('QU3 PASSED: delivery consumed 2 bread through ONE atomic ITEMS_TRANSFERRED (player side down, NPC side up, pure derivation agrees); invalid transfers appended nothing');
  }

  // --- QU4: the acceptance window + the remaining matchers — work done
  // BEFORE accepting a contract never satisfies it (craft), and the
  // multi-objective quest needs BOTH its travel arrival and the derived
  // relationship tier.
  {
    assert.ok(quEconomy.craft(rowanId, 'alchemy', 'al1').ok, 'the pre-acceptance craft must succeed');
    assert.ok(quests.acceptQuest('quest_salves').ok, 'accepting the salve contract must succeed');
    const before = quests.getObjectiveProgress('quest_salves')[0];
    assert.equal(before.done, false, 'a craft from BEFORE acceptance must not count (the window is seq > acceptedSeq)');
    assert.equal(before.note, '0/1 crafted');
    assert.ok(quEconomy.craft(rowanId, 'alchemy', 'al1').ok, 'the post-acceptance craft must succeed');
    assert.deepEqual(quests.getObjectiveProgress('quest_salves').map((o) => o.done), [true]);
    const vialsBefore = quEconomy.getInventory(rowanId).stacks.glass_vial ?? 0;
    assert.ok(quests.completeQuest('quest_salves').ok, 'the salve turn-in must succeed');
    assert.equal((quEconomy.getInventory(rowanId).stacks.glass_vial ?? 0) - vialsBefore, 2, 'the item reward landed through economy.grantItems');

    assert.ok(quests.acceptQuest('quest_make_yourself_known').ok, 'accepting the two-objective contract must succeed');
    const [walk0, befriend0] = quests.getObjectiveProgress('quest_make_yourself_known');
    assert.equal(walk0.done, false, 'the north woods are unvisited at acceptance');
    assert.equal(befriend0.done, false, `Mira starts below friend (${befriend0.note})`);
    assert.equal(quests.completeQuest('quest_make_yourself_known').ok, false, 'turn-in with neither objective met must be rejected');

    let helps = 0;
    while (!quests.getObjectiveProgress('quest_make_yourself_known')[1].done) {
      if (++helps > 20) throw new Error('QU4: the friend tier was never reached');
      helpNpc(fan.world, rowanId, 'npc_mira');
    }
    assert.equal(relationshipTier(deriveRelationshipStats(fan.world.getEventLog(), 'npc_mira', rowanId)), 'friend', 'the tier objective flips exactly when the derived tier does');
    assert.equal(quests.completeQuest('quest_make_yourself_known').ok, false, 'one objective is not both — the travel leg is still owed');

    quTravel.startTravel('node_3.353_8.010');
    quTickUntilIdle('the north-woods leg');
    quTravel.startTravel(quOrigin.id);
    quTickUntilIdle('the leg home from the woods');
    assert.deepEqual(quests.getObjectiveProgress('quest_make_yourself_known').map((o) => o.done), [true, true]);
    assert.ok(quests.completeQuest('quest_make_yourself_known').ok, 'the two-objective turn-in must succeed');
    record(`QU4 PASSED: the acceptance window holds (pre-acceptance craft did not count), and the two-objective contract required BOTH the real travel arrival and the derived friend tier (${helps} helps)`);
  }

  // --- QU5: abandon — active → failed, terminal, and nothing was paid.
  // A separate fresh fixture: the main one has consumed all four contracts.
  {
    const fan5 = buildSampleWorld();
    createRelationshipEffectEngine(fan5.world, fan5.relationships);
    const map5 = createWorldMapEngine(fan5.world);
    const poi5 = createPoiEngine(fan5.world);
    const faction5 = createFactionEngine(fan5.world);
    const travel5 = createTravelEngine(fan5.world, map5, poi5);
    const economy5 = createEconomyEngine(fan5.world, fan5.registry);
    const quests5 = createQuestEngine(fan5.world, {
      playerId: fan5.rowan.id, economy: economy5, relationships: fan5.relationships, faction: faction5, poi: poi5, travel: travel5,
    });
    assert.ok(quests5.acceptQuest('quest_bread_run').ok);
    assert.ok(quests5.abandonQuest('quest_bread_run').ok, 'abandoning an active quest must succeed');
    assert.equal(quests5.getQuestStatuses().quest_bread_run.status, 'failed');
    assert.equal(quests5.acceptQuest('quest_bread_run').ok, false, 'failed is terminal in v1 — no re-accept');
    assert.equal(quests5.completeQuest('quest_bread_run').ok, false, 'a failed quest cannot be turned in');
    assert.equal(
      fan5.world.getEventLog().filter((e) => e.type === 'GOLD_GRANTED' && e.payload.reason === 'quest_bread_run').length,
      0,
      'abandoning paid nothing'
    );
    record('QU5 PASSED: abandon moves active → failed (terminal), pays nothing, and blocks both re-accept and turn-in');
  }

  // --- QU6: redundancy — the pure derivation, the primed cache, and the
  // from-scratch rebuild agree three ways, statuses and objectives both.
  {
    const log = fan.world.getEventLog();
    assert.deepEqual(deriveQuestStatuses(log), quests.getQuestStatuses(), 'pure deriveQuestStatuses must agree with the cached read');
    assert.deepEqual(quests.rebuildQuestStatuses(), quests.getQuestStatuses(), 'the quest status cache must equal its own rebuild');
    for (const questId of questIds()) {
      assert.deepEqual(deriveObjectiveProgress(log, questId, rowanId), quests.getObjectiveProgress(questId), `objective progress for ${questId} must derive identically`);
    }
    record('QU6 PASSED: statuses are three-way redundant (pure derive == primed cache == rebuild) and objective progress derives identically');
  }

  // --- QU7: replay safety — reconstruct the ENTIRE world from its save and
  // wire fresh engines (the priming path). Quest statuses reproduce, and NO
  // reward re-granted: gold, Mira's bread, Sable's trust, and the faction
  // flip are all exactly the original values, because the verbs are react
  // handlers that never prime.
  {
    const replay = buildSampleWorld({ save: parseSave(serializeWorld(fan.world)) });
    createRelationshipEffectEngine(replay.world, replay.relationships);
    const mapR = createWorldMapEngine(replay.world);
    const poiR = createPoiEngine(replay.world);
    const factionR = createFactionEngine(replay.world);
    const travelR = createTravelEngine(replay.world, mapR, poiR);
    const economyR = createEconomyEngine(replay.world, replay.registry);
    const questsR = createQuestEngine(replay.world, {
      playerId: replay.rowan.id, economy: economyR, relationships: replay.relationships, faction: factionR, poi: poiR, travel: travelR,
    });
    assert.deepEqual(questsR.getQuestStatuses(), quests.getQuestStatuses(), 'quest statuses must reproduce from the log alone');
    assert.equal(economyR.getGold(rowanId), quEconomy.getGold(rowanId), 'gold must NOT change on replay — rewards never re-grant');
    assert.deepEqual(economyR.getInventory('npc_mira'), quEconomy.getInventory('npc_mira'), "Mira's delivered bread must not double");
    assert.deepEqual(
      deriveRelationshipStats(replay.world.getEventLog(), 'npc_sable', rowanId),
      deriveRelationshipStats(fan.world.getEventLog(), 'npc_sable', rowanId),
      "Sable's trust must not double"
    );
    assert.equal(factionR.getFactionControl(quSettlementNode), 'faction_2', 'the faction flip replays from its committed fact, not a re-fired reward');
    assert.equal(
      replay.world.getEventLog().filter((e) => e.type === 'POI_INJECTED' && e.payload.poi.id === 'poi_q_wolfpine_camp').length,
      1,
      'the camp was not re-injected on replay'
    );
    record('QU7 PASSED: a full save/replay reconstruction reproduces quest state with zero re-granted rewards and zero re-injected POIs');
  }

  return { log: fan.world.getEventLog() };
}

const sectionQuLinesA = [];
const quRunA = runSectionQU((m) => {
  sectionQuLinesA.push(m);
  console.log(m);
});

// --- QU-final: determinism across full runs (the EC-final idiom) — the
// entire section re-run produces byte-identical output AND a byte-identical
// event log (no RNG anywhere in the quest layer).
const sectionQuLinesB = [];
const quRunB = runSectionQU((m) => sectionQuLinesB.push(m));
assert.deepEqual(sectionQuLinesA, sectionQuLinesB, 'Section QU output must be byte-identical across two full runs');
assert.deepEqual(quRunB.log, quRunA.log, 'the identical lived quest run must produce the identical event log');
console.log(`QU-final PASSED: Section QU produced identical output (${sectionQuLinesA.length} lines) and an identical ${quRunA.log.length}-event log across two full runs`);

console.log('\nSection QU PASSED: quest lifecycle is log-backed and derived (available → active → completed | failed), objectives are pure log-replay matches over real underlying events, acceptance is the first real caller of injectPoi/grantRevealAuthority, and completion pays only through the existing economy/relationship/faction systems with the status fact committed last');

// =============================================================================
// Section CB: combat & resolution — HP/vitals, turn resolution, the
// lethal/nonlethal fork, the travel handoff, and rebuildability, all on the
// same (config + log) discipline. Run twice, asserted byte-identical.
//
// The fixture forces incidents into real fights (incidentChance 1, one mapped
// category, thresholds met) so the travel handoff is exercised deterministically,
// and drives fights through the real act() verb. Everything a fight commits —
// rosters, rolls, damage, hp, loot, consequences — is a fact in the log, so a
// mid-fight save round-trips (SL18) and two identical runs produce identical
// logs. Enemies are lightweight combatant records (never registry entities),
// their full stat block committed in COMBAT_STARTED.
// =============================================================================
function runSectionCB(record) {
  // Shipped config, cloned + mutated per sub-case. A plain build (no save)
  // reads the shipped WORLD_CONFIG with no drift warning.
  const cbBase = buildSampleWorld().world.getState().config;

  // cbBuild — a fresh combat-capable world under a (possibly mutated) config,
  // wired in game/app.js order (economy → combat → travel). Silent: the forced
  // config drifts from the shipped one, and that warning is expected noise here.
  function cbBuild(mutate) {
    const config = structuredClone(cbBase);
    if (mutate) mutate(config);
    let fan;
    captureConsole(() => { fan = buildSampleWorld({ save: { config, eventLog: [] } }); });
    createRelationshipEffectEngine(fan.world, fan.relationships);
    const map = createWorldMapEngine(fan.world);
    const poi = createPoiEngine(fan.world);
    const clock = createWorldClockEngine(fan.world);
    const faction = createFactionEngine(fan.world);
    const economy = createEconomyEngine(fan.world, fan.registry);
    const combat = createCombatEngine(fan.world, {
      playerId: fan.rowan.id, registry: fan.registry, map, economy, relationships: fan.relationships, faction,
    });
    economy.setCombatEngine(combat); // late-bound: see economyEngine.js
    const travel = createTravelEngine(fan.world, map, poi, combat);
    map.materializeNeighbors(travel.getPlayerNodeId());
    return { fan, world: fan.world, rowanId: fan.rowan.id, map, poi, clock, faction, economy, combat, travel };
  }

  // Force every leg into a fight of one mapped category:intensity.
  const forceIncident = (category, intensity) => (config) => {
    config.travel.incident.incidentChance = 1;
    config.travel.incident.categories = { [category]: { weight: 1 } };
    config.travel.incident.intensityWeights = { [String(intensity)]: 1 };
    config.travel.incident.turnIntensityByCategory = { [category]: intensity };
  };
  const cbGiveWeapon = (w, defId) => {
    w.economy.grantItems(w.rowanId, { instanceDefIds: [defId] }, 'cb');
    const inst = w.economy.getInventory(w.rowanId).instances.find((i) => i.itemDefId === defId);
    w.economy.equip(w.rowanId, 'mainHand', inst.instanceId);
    return inst.instanceId;
  };
  const cbFirstLiveEnemy = (combat) => {
    const a = combat.getActiveCombat();
    return a.combatants.find((c) => c.side === 'enemy' && (c.status ?? 'alive') === 'alive') ?? null;
  };
  const cbStartTravelLeg = (w) => {
    const node = w.map.getNode(w.travel.getPlayerNodeId());
    const dest = node.edges.find((e) => w.map.getNode(e.to)?.passable).to;
    w.travel.startTravel(dest);
    return dest;
  };

  // --- CB1: content closure — every archetype, template, incident mapping,
  // and consumable resolves against the REAL item catalog it ships with, and
  // max HP is a positive function of real stats for every combatant.
  {
    for (const [id, arch] of Object.entries(ARCHETYPES)) {
      assert.equal(getArchetype(id), arch, `archetype ${id} resolves`);
      const caps = { capabilities: { attributes: arch.attributes, skills: { primary: arch.skills, secondary: {} } } };
      assert.ok(deriveMaxHp(caps) > 0, `archetype ${id} has positive max HP`);
      let hasWeapon = !!arch.naturalWeapon;
      for (const defId of arch.equipmentDefIds ?? []) {
        const def = getItemDef(defId);
        assert.ok(def.combat, `archetype ${id} equipment ${defId} has a combat block`);
        if (def.combat.kind === 'weapon') hasWeapon = true;
      }
      assert.ok(hasWeapon, `archetype ${id} has a weapon (natural or equipped)`);
    }
    for (const [id, tmpl] of Object.entries(ENCOUNTER_TEMPLATES)) {
      assert.equal(getEncounterTemplate(id), tmpl, `template ${id} resolves`);
      assert.ok(tmpl.enemies.length > 0, `template ${id} has enemies`);
      for (const a of tmpl.enemies) assert.ok(ARCHETYPES[a], `template ${id} enemy ${a} is a real archetype`);
    }
    for (const [key, templateId] of Object.entries(INCIDENT_ENCOUNTERS)) {
      const [cat, intStr] = key.split(':');
      assert.ok(cat && Number(intStr) >= 1, `incident key ${key} parses to category:intensity`);
      assert.ok(ENCOUNTER_TEMPLATES[templateId], `incident ${key} maps to a real template`);
    }
    for (const defId of ['healing_salve', 'lesser_healing_potion']) {
      assert.equal(getItemDef(defId).combat.kind, 'consumable', `${defId} is a combat consumable`);
      assert.ok(getItemDef(defId).combat.heal > 0, `${defId} heals a positive amount`);
    }
    const cbTrio = cbBuild();
    for (const e of [cbTrio.fan.mira, cbTrio.fan.rowan, cbTrio.fan.sable]) {
      assert.ok(deriveMaxHp(e) > 0, `${e.id} has positive max HP`);
    }
    record(`CB1 PASSED: ${Object.keys(ARCHETYPES).length} archetypes, ${Object.keys(ENCOUNTER_TEMPLATES).length} templates, ${Object.keys(INCIDENT_ENCOUNTERS).length} incident mappings all resolve against the real catalog; max HP positive for every combatant`);
  }

  // --- CB2: determinism — the seeded encounter roll is pure (twice-identical),
  // and two identically-built worlds running the identical scripted fight
  // produce byte-identical event logs.
  {
    const w = cbBuild();
    const node = w.map.getOriginNode();
    const e1 = deriveEncounter(w.world.getState().config, node, 'tmpl_bandit_gang', 0);
    const e2 = deriveEncounter(w.world.getState().config, node, 'tmpl_bandit_gang', 0);
    assert.deepEqual(e1, e2, 'deriveEncounter is pure (twice-identical)');

    function cbScriptedFight() {
      const g = cbBuild();
      cbGiveWeapon(g, 'iron_sword');
      g.combat.startCombat('tmpl_bandit_ambush', g.map.getOriginNode());
      for (let i = 0; g.combat.getActiveCombat() && i < 60; i++) {
        const en = cbFirstLiveEnemy(g.combat);
        g.combat.act(en ? { type: 'attackLethal', targetId: en.id } : { type: 'wait' });
      }
      return g.world.getEventLog();
    }
    assert.deepEqual(cbScriptedFight(), cbScriptedFight(), 'two identical worlds → byte-identical fight logs');
    record('CB2 PASSED: deriveEncounter is pure and two identically-seeded worlds produce byte-identical fight logs');
  }

  // --- CB3: travel handoff + lethal victory, end to end. The leg commits
  // TRAVEL_INCIDENT{outcome:combat} then COMBAT_STARTED; ticks during the fight
  // add zero game-time and the leg never arrives; each act() appends exactly one
  // COMBAT_ROUND_RESOLVED; on victory loot is granted once (reason = combatId),
  // COMBAT_ENDED is last, and only then does the leg resume and arrive.
  {
    const w = cbBuild(forceIncident('bandit', 2));
    cbGiveWeapon(w, 'iron_sword');
    const origin = w.travel.getPlayerNodeId();
    const dest = cbStartTravelLeg(w);

    const log0 = w.world.getEventLog();
    const inc = w.travel.getIncident(0);
    assert.equal(inc.outcome, 'combat', 'the leg routes to combat');
    const startedIdx = log0.findIndex((e) => e.type === 'COMBAT_STARTED');
    const incidentIdx = log0.findIndex((e) => e.type === 'TRAVEL_INCIDENT');
    assert.ok(incidentIdx >= 0 && startedIdx === incidentIdx + 1, 'COMBAT_STARTED immediately follows the incident');
    assert.ok(w.combat.getActiveCombat(), 'a fight is open');

    const gsBefore = w.clock.getTotalGameSeconds();
    for (let i = 0; i < 4; i++) w.world.dispatch('CLOCK_TICK', { realSecondsElapsed: 1 });
    assert.equal(w.clock.getTotalGameSeconds(), gsBefore, 'combat ticks add zero game-time (×0 dilation)');
    assert.equal(w.travel.getActiveActivity().elapsedGameSeconds, 0, 'the leg is frozen during combat');
    assert.equal(w.travel.getPlayerNodeId(), origin, 'no arrival mid-combat');
    assert.equal(w.world.getEventLog().filter((e) => e.type === 'TRAVEL_ARRIVED').length, 0, 'no TRAVEL_ARRIVED before COMBAT_ENDED');

    let rounds = 0;
    let combatId = w.combat.getActiveCombat().combatId;
    while (w.combat.getActiveCombat()) {
      const before = w.world.getEventLog().filter((e) => e.type === 'COMBAT_ROUND_RESOLVED').length;
      const en = cbFirstLiveEnemy(w.combat);
      const r = w.combat.act(en ? { type: 'attackLethal', targetId: en.id } : { type: 'wait' });
      assert.ok(r.ok, 'each act resolves');
      const after = w.world.getEventLog().filter((e) => e.type === 'COMBAT_ROUND_RESOLVED').length;
      assert.equal(after, before + 1, 'each act appends exactly one COMBAT_ROUND_RESOLVED');
      rounds++;
      if (rounds > 60) throw new Error('CB3 fight never ended');
    }
    const ended = w.world.getEventLog().filter((e) => e.type === 'COMBAT_ENDED');
    assert.equal(ended.length, 1, 'exactly one COMBAT_ENDED');
    assert.equal(ended[0].payload.outcome, 'victory', 'the armed player wins');
    const goldGrants = w.world.getEventLog().filter((e) => e.type === 'GOLD_GRANTED' && e.payload.reason === combatId);
    assert.equal(goldGrants.length, 1, 'loot gold granted exactly once, keyed by combatId');
    // COMBAT_ENDED is the last combat event (after loot).
    const log1 = w.world.getEventLog();
    assert.ok(log1.findLastIndex((e) => e.type === 'COMBAT_ENDED') > log1.findLastIndex((e) => e.type === 'GOLD_GRANTED' && e.payload.reason === combatId), 'COMBAT_ENDED commits after loot');

    for (let i = 0; w.travel.getActiveActivity() && i < 500; i++) w.world.dispatch('CLOCK_TICK', { realSecondsElapsed: 1 });
    assert.equal(w.travel.getPlayerNodeId(), dest, 'the leg resumes and arrives after the fight');
    record(`CB3 PASSED: travel→combat handoff — incident routed to combat, ${rounds} rounds resolved (one event each), time frozen mid-fight, loot granted once, and the leg arrived only after COMBAT_ENDED`);
  }

  // --- CB4: the nonlethal fork — subduing the drifter yields a DISTINCT
  // 'subdued' terminal state (not 'dead'), COMBAT_ENDED mode 'nonlethal', and
  // the template's obedience consequence lands once through the real
  // relationship system (rebuild agrees).
  {
    const w = cbBuild(forceIncident('npc', 3));
    cbGiveWeapon(w, 'oak_staff'); // nonlethalCapable — subdues at full damage
    cbStartTravelLeg(w);
    const enemyId = w.combat.getActiveCombat().combatants.find((c) => c.side === 'enemy').id;
    for (let i = 0; w.combat.getActiveCombat() && i < 60; i++) {
      const en = cbFirstLiveEnemy(w.combat);
      w.combat.act(en ? { type: 'attackNonlethal', targetId: en.id } : { type: 'wait' });
    }
    const h = w.combat.getCombatHistory().at(-1);
    assert.equal(h.outcome, 'victory', 'the drifter fight is won');
    assert.equal(h.mode, 'nonlethal', 'the finishing blow was nonlethal');
    assert.equal(h.finalStatuses[enemyId], 'subdued', "the enemy is 'subdued' — distinct from 'dead'");
    assert.notEqual(h.finalStatuses[enemyId], 'dead', 'subdued is not dead');
    const rel = w.fan.relationships.getRelationship(enemyId, w.rowanId);
    assert.equal(rel.stats.obedience, 20, 'the subdue consequence set obedience +20 through the real relationship system');
    assert.deepEqual(w.fan.relationships.rebuildRelationshipStats(enemyId, w.rowanId), rel.stats, 'relationship cache equals its rebuild');
    const relEvents = w.world.getEventLog().filter((e) => e.type === 'RELATIONSHIP_EVENT' && e.payload.fromId === enemyId && e.payload.toId === w.rowanId);
    assert.equal(relEvents.length, 1, 'the consequence dispatched exactly once');
    record("CB4 PASSED: nonlethal subdue yields a distinct 'subdued' terminal state and mode, and the obedience consequence landed once through the real relationship system");
  }

  // --- CB5: flee, both ways. fleeBaseChance 1 → flee succeeds, outcome 'fled',
  // enemies stay active, and the travel leg still arrives. fleeBaseChance 0 →
  // flee fails, the fight stays open, and the round still resolves the enemies.
  {
    const wYes = cbBuild((c) => { forceIncident('bandit', 2)(c); c.combat.fleeBaseChance = 1; });
    cbGiveWeapon(wYes, 'iron_dagger');
    const dest = cbStartTravelLeg(wYes);
    const r = wYes.combat.act({ type: 'flee' });
    assert.ok(r.ok && r.outcome === 'fled', 'guaranteed flee succeeds');
    const hYes = wYes.combat.getCombatHistory().at(-1);
    assert.equal(hYes.outcome, 'fled', 'combat ends fled');
    for (const [id, st] of Object.entries(hYes.finalStatuses)) {
      if (id !== wYes.rowanId) assert.equal(st, 'alive', 'fled-from enemies remain active');
    }
    for (let i = 0; wYes.travel.getActiveActivity() && i < 500; i++) wYes.world.dispatch('CLOCK_TICK', { realSecondsElapsed: 1 });
    assert.equal(wYes.travel.getPlayerNodeId(), dest, 'the leg still arrives after fleeing');

    const wNo = cbBuild((c) => { forceIncident('bandit', 2)(c); c.combat.fleeBaseChance = 0; c.combat.fleePerAgilityPoint = 0; });
    cbGiveWeapon(wNo, 'iron_dagger');
    cbStartTravelLeg(wNo);
    const rNo = wNo.combat.act({ type: 'flee' });
    assert.ok(rNo.ok && !rNo.ended, 'a failed flee does not end the fight');
    assert.ok(wNo.combat.getActiveCombat(), 'the fight stays open after a failed flee');
    const lastRound = wNo.world.getEventLog().filter((e) => e.type === 'COMBAT_ROUND_RESOLVED').at(-1);
    assert.ok(lastRound.payload.actions.some((a) => a.actorId !== wNo.rowanId), 'enemies still act in the failed-flee round');
    record('CB5 PASSED: guaranteed flee ends the fight (enemies left active) and the leg still arrives; a failed flee keeps the fight open with enemies still acting');
  }

  // --- CB6: player defeat — an unarmed player who only waits is killed; the
  // fight ends 'defeat', vitals read 'dead', isPlayerDefeated() gates further
  // verbs, and the vitals cache equals its rebuild.
  {
    const w = cbBuild(forceIncident('animal', 3)); // wolf pack vs an unarmed, passive player
    cbStartTravelLeg(w);
    for (let i = 0; w.combat.getActiveCombat() && i < 200; i++) w.combat.act({ type: 'wait' });
    assert.ok(!w.combat.getActiveCombat(), 'the fight ended');
    const h = w.combat.getCombatHistory().at(-1);
    assert.equal(h.outcome, 'defeat', 'a passive unarmed player is defeated');
    assert.equal(w.combat.getVitals(w.rowanId).status, 'dead', 'the player reads dead');
    assert.ok(w.combat.isPlayerDefeated(), 'isPlayerDefeated() is true');
    assert.equal(w.combat.act({ type: 'wait' }).ok, false, 'further act() is rejected once defeated');
    assert.throws(() => w.combat.startCombat('tmpl_wolf_pack', w.map.getOriginNode()), /defeated/, 'starting a new fight is rejected once defeated');
    assert.equal(w.combat.rebuildVitals().get(w.rowanId).status, 'dead', 'the vitals rebuild agrees the player is dead');
    record('CB6 PASSED: a passive unarmed player is defeated — outcome defeat, vitals dead, further verbs gated, vitals rebuild agrees');
  }

  // --- CB7: equipment matters + rebuildability. Same seed, armed vs unarmed:
  // the committed first-round damage facts differ. And mid- AND post-fight,
  // every combat cache equals its own from-scratch rebuild.
  {
    function cbFirstStrike(giveWeaponDefId) {
      const g = cbBuild();
      if (giveWeaponDefId) cbGiveWeapon(g, giveWeaponDefId);
      g.combat.startCombat('tmpl_bandit_ambush', g.map.getOriginNode());
      const en = cbFirstLiveEnemy(g.combat);
      g.combat.act({ type: 'attackLethal', targetId: en.id });
      const round0 = g.world.getEventLog().find((e) => e.type === 'COMBAT_ROUND_RESOLVED');
      const playerAction = round0.payload.actions.find((a) => a.actorId === g.rowanId);
      return { g, playerAction };
    }
    const armed = cbFirstStrike('iron_sword');
    const unarmed = cbFirstStrike(null);
    assert.equal(armed.playerAction.weaponDefId, 'iron_sword', 'armed strike records the weapon');
    assert.equal(unarmed.playerAction.weaponDefId, null, 'unarmed strike records no weapon');
    assert.notDeepEqual(
      { hit: armed.playerAction.hit, dmg: armed.playerAction.damage },
      { hit: unarmed.playerAction.hit, dmg: unarmed.playerAction.damage },
      'equipment changes the committed combat facts (a sword hits harder than fists)'
    );

    // Rebuildability, mid-fight (armed.g still open).
    assert.deepEqual(armed.g.combat.getActiveCombat(), armed.g.combat.rebuildActiveCombat(), 'mid-fight active-combat cache equals its rebuild');
    const vmid = armed.g.combat.rebuildVitals();
    for (const id of vmid.keys()) assert.deepEqual(armed.g.combat.getVitals(id), vmid.get(id), `mid-fight vitals cache for ${id} equals its rebuild`);
    assert.deepEqual(armed.g.combat.getCombatHistory(), armed.g.combat.rebuildCombatHistory(), 'mid-fight history cache equals its rebuild');
    // Finish it and re-check post-fight.
    for (let i = 0; armed.g.combat.getActiveCombat() && i < 60; i++) {
      const en = cbFirstLiveEnemy(armed.g.combat);
      armed.g.combat.act(en ? { type: 'attackLethal', targetId: en.id } : { type: 'wait' });
    }
    assert.equal(armed.g.combat.getActiveCombat(), null, 'the fight is over');
    assert.equal(armed.g.combat.rebuildActiveCombat(), null, 'post-fight active rebuild is null');
    assert.deepEqual(armed.g.combat.getCombatHistory(), armed.g.combat.rebuildCombatHistory(), 'post-fight history cache equals its rebuild');
    const vend = armed.g.combat.rebuildVitals();
    for (const id of vend.keys()) assert.deepEqual(armed.g.combat.getVitals(id), vend.get(id), `post-fight vitals cache for ${id} equals its rebuild`);
    record('CB7 PASSED: equipment changes committed combat facts (sword vs fists), and every combat cache equals its from-scratch rebuild mid- and post-fight');
  }

  // --- CB8: non-combat player verbs are refused while a fight is open — the
  // SAME belt-and-braces travel's startTravel/startExplore already apply
  // (the UI blocks navigation to these screens during combat, but the engine
  // must not trust that alone). economy.trade/craft/equip/drop and
  // quests.acceptQuest/completeQuest/abandonQuest must all return
  // {ok:false, reason:'a combat is in progress'} while combat.getActiveCombat()
  // is truthy, and the guard must LIFT once the fight ends — not get stuck.
  {
    const w = cbBuild(forceIncident('bandit', 2));
    const questsCb = createQuestEngine(w.world, {
      playerId: w.rowanId, economy: w.economy, relationships: w.fan.relationships, faction: w.faction, poi: w.poi, travel: w.travel, combat: w.combat,
    });
    cbGiveWeapon(w, 'iron_sword');
    cbStartTravelLeg(w);
    assert.ok(w.combat.getActiveCombat(), 'CB8 fixture must open a fight');

    const cbBlocked = 'a combat is in progress';
    const tradeR = w.economy.trade(w.rowanId, { kind: 'authored', shopId: 'shop_rusted_ledger' }, { buy: [{ defId: 'bread', qty: 1 }] });
    assert.deepEqual(tradeR, { ok: false, reason: cbBlocked }, 'trade must refuse while a fight is open');
    const craftR = w.economy.craft(w.rowanId, 'blacksmith', 'bs1');
    assert.deepEqual(craftR, { ok: false, reason: cbBlocked }, 'craft must refuse while a fight is open');
    const equipR = w.economy.equip(w.rowanId, 'mainHand', null);
    assert.deepEqual(equipR, { ok: false, reason: cbBlocked }, 'equip must refuse while a fight is open');
    const dropR = w.economy.drop(w.rowanId, { stacks: { bread: 1 } });
    assert.deepEqual(dropR, { ok: false, reason: cbBlocked }, 'drop must refuse while a fight is open');
    const acceptR = questsCb.acceptQuest('quest_bread_run');
    assert.deepEqual(acceptR, { ok: false, reason: cbBlocked }, 'quest accept must refuse while a fight is open');
    const completeR = questsCb.completeQuest('quest_bread_run');
    assert.deepEqual(completeR, { ok: false, reason: cbBlocked }, 'quest turn-in must refuse while a fight is open');
    const abandonR = questsCb.abandonQuest('quest_bread_run');
    assert.deepEqual(abandonR, { ok: false, reason: cbBlocked }, 'quest abandon must refuse while a fight is open');

    // None of the refused calls dispatched anything.
    const logLenBlocked = w.world.getEventLog().length;

    // Resolve the fight, then confirm the guard LIFTS — the same verb that
    // was refused now goes through cleanly.
    for (let i = 0; w.combat.getActiveCombat() && i < 60; i++) {
      const en = cbFirstLiveEnemy(w.combat);
      w.combat.act(en ? { type: 'attackLethal', targetId: en.id } : { type: 'wait' });
    }
    assert.ok(!w.combat.getActiveCombat(), 'the fight must end for the guard-lift check to be meaningful');
    assert.ok(w.world.getEventLog().length > logLenBlocked, 'the fight itself did dispatch events after the refused calls');
    const equipAfter = w.economy.equip(w.rowanId, 'mainHand', null);
    assert.ok(equipAfter.ok, 'equip succeeds again once combat has ended — the guard is not permanently stuck');
    record('CB8 PASSED: trade/craft/equip/drop and quest accept/complete/abandon all refuse with a consistent reason while a fight is open, and the guard lifts cleanly once combat ends');
  }

  return { log: cbBuild(forceIncident('bandit', 2)).world.getEventLog() };
}

const sectionCbLinesA = [];
runSectionCB((m) => { sectionCbLinesA.push(m); console.log(m); });
const sectionCbLinesB = [];
runSectionCB((m) => sectionCbLinesB.push(m));
assert.deepEqual(sectionCbLinesA, sectionCbLinesB, 'Section CB output must be byte-identical across two full runs');
console.log(`CB-final PASSED: Section CB produced identical output (${sectionCbLinesA.length} lines) across two full runs`);

console.log('\nSection CB PASSED: combat is log-backed and derived (vitals, active fight, history all pure folds), turns resolve one atomic event per decision with seeded fixed-draw rolls, the lethal/nonlethal fork yields distinct persisted outcomes, equipment drives the math through real equipped-item data, travel routes requires-a-real-turn incidents into real fights that freeze the leg until resolved, and every cache equals its from-scratch rebuild');

// =============================================================================
// Section SL: save/load — round-tripping the ENTIRE world state.
//
// The architecture's core promise, put on trial end to end: raw state is
// exactly (config, event log), so a save is serializeWorld's JSON of those two
// things and NOTHING else, and load is "hand the saved log to a fresh
// buildSampleWorld, wire a fresh engine set, let every engine prime from the
// log it finds." A lived-in world — explored map, discovered/injected POIs,
// faction overrides, a populated settlement, race edits, clock history,
// travel legs (one AI-narrated, one mid-transit at save time), and
// memories INCLUDING AI-enhanced summary text (stubbed generateText) — is
// serialized to an actual JSON string, reconstructed from that string alone,
// and every derived read on the reconstruction must equal the original live
// world exactly. This is the proof that no state lives outside the log:
// live-only mutations (the old in-place AI summary overwrite) or
// subscribe-only caches (cold-start against a non-empty log) would fail here.
// =============================================================================
console.log('\n=== Section SL: save/load — round-tripping the entire world state ===');

// Deterministic AI stub, identical for every run: the "AI-written" line is a
// pure function of the prompt, so enhanced summaries are reproducible and
// visibly different from the templates.
function slStubGenerateText(prompt) {
  const who = /^You are ([^.]+)\./.exec(prompt)?.[1] ?? 'someone';
  return Promise.resolve(`${who} will not forget what the player did today.`);
}

// The Section M/N synthetic-node convention: engines take classified node
// objects from the game layer, so hand-authored classifications keep the
// section deterministic and self-contained.
function slSettlement(id, tier, x, y) {
  return {
    id,
    x,
    y,
    classification: { kind: 'settlement', tier, settlementId: id, baselineFaction: 'faction_old_guard', notability: null, hospitability: null },
  };
}

// wireEngines — the canonical full-world wiring order, shared verbatim by the
// original build and the load path (that sharing IS the point: load is the
// same construction, just against a world whose log is already full).
// Presence for the memory engine is the generator's roster filtered through
// each NPC's schedule at the current game hour — asleep NPCs witness nothing.
// The clock is constructed BEFORE npcGen/memory because the adapter reads it;
// the reorder is safe (the clock subscribes only CLOCK_TICK/CLOCK_JUMP and
// primes purely from the log — no subscription-order coupling with any other
// engine), and witnessesAt only runs at dispatch time anyway.
function slWireEngines(fan) {
  const effects = createRelationshipEffectEngine(fan.world, fan.relationships);
  const map = createWorldMapEngine(fan.world);
  const poi = createPoiEngine(fan.world);
  const faction = createFactionEngine(fan.world);
  const clock = createWorldClockEngine(fan.world);
  const npcGen = createNpcGeneratorEngine(fan.world, fan.registry, fan.races);
  const memory = createMemoryEngine(fan.world, fan.registry, {
    witnessesAt: (nodeId) =>
      npcGen.rosterIdsAt(nodeId).filter(
        (id) => deriveScheduleState(fan.registry.get(id)?.schedule, clock.getCurrentDate().hour).available
      ),
  });
  // Economy + combat BEFORE travel, matching game/app.js: travel takes combat
  // as its optional collaborator (routing requires-a-real-turn incidents into
  // real fights), and combat takes economy (equipped-item stats, loot).
  const economy = createEconomyEngine(fan.world, fan.registry);
  const combat = createCombatEngine(fan.world, {
    playerId: fan.rowan.id, registry: fan.registry, map, economy, relationships: fan.relationships, faction,
  });
  economy.setCombatEngine(combat); // late-bound: see economyEngine.js
  const travel = createTravelEngine(fan.world, map, poi, combat);
  const quests = createQuestEngine(fan.world, {
    playerId: fan.rowan.id, economy, relationships: fan.relationships, faction, poi, travel, combat,
  });
  return { effects, map, poi, faction, npcGen, memory, clock, travel, economy, combat, quests };
}

// slBuildLivedInWorld — build a fresh world and LIVE in it: a representative
// mix of actions across every engine, including AI-enhanced memories under the
// stub. Waits for every fired enhancement to land in the log before returning,
// so the returned world is fully settled (no in-flight async work).
async function slBuildLivedInWorld() {
  const fan = buildSampleWorld();
  const { world, registry, relationships, conversationHistory, races, mira, rowan, sable } = fan;
  const engines = slWireEngines(fan);
  const { map, poi, faction, npcGen, travel, economy } = engines;

  // Count expected vs landed enhancements so the settle-wait below is exact:
  // every committed rememberer fires one background enhancement under the stub.
  let expectedEnhancements = 0;
  let seenEnhancements = 0;
  world.subscribe('MEMORY_RECORDED', (e) => { expectedEnhancements += e.payload.memories.length; });
  world.subscribe('MEMORY_SUMMARY_ENHANCED', () => { seenEnhancements += 1; });

  // Race edits BEFORE populating, so the committed roster is generated under
  // the edited registry (the sanctioned live-settings coupling).
  const raceList = races.getRaces();
  races.setRaceWeight(raceList[0].id, 7);
  races.setRaceEnabled(raceList[1].id, false);

  // Explore the map: two rings out from the origin, plus a re-materialization
  // that must NOT append a second event for the same node.
  const origin = map.getOriginNode();
  const ring1 = map.materializeNeighbors(origin.id);
  const nodeA = ring1.neighbors[0];
  const logLenBeforeRepeat = world.getEventLog().length;
  const ring1Again = map.materializeNeighbors(origin.id);
  assert.equal(world.getEventLog().length, logLenBeforeRepeat, 're-materializing an explored node must not log a second event');
  assert.deepEqual(ring1Again.neighbors.map((n) => n.id), ring1.neighbors.map((n) => n.id), 're-materialization returns the same neighbor set');
  const ring2 = map.materializeNeighbors(nodeA.id);
  const exploredNodeIds = [...new Set([origin.id, ...ring1.neighbors.map((n) => n.id), ...ring2.neighbors.map((n) => n.id)])];

  // POIs at a synthetic village: blind attempts, a post-visit hidden
  // injection, reveal authority, and a directed find of the hidden POI.
  const village = slSettlement('sl_village', 'village', 2600, 2600);
  poi.exploreBlind(village);
  poi.exploreBlind(village);
  poi.exploreBlind(village);
  poi.injectPoi(village.id, { id: 'poi_sl_cache', category: 'cache', prominence: 0.5, hidden: true, data: {} });
  poi.grantRevealAuthority('poi_sl_cache');
  poi.exploreDirected(village, 'poi_sl_cache');

  // Faction control: an override at the village, and an explicit
  // taken-to-uncontrolled (null) at a second settlement — distinct from
  // "no override, baseline applies."
  const hamlet = slSettlement('sl_hamlet', 'hamlet', 3100, 3100);
  faction.setFactionControl(village.id, 'faction_rebels');
  faction.setFactionControl(hamlet.id, null);

  // Populate the village and commit its roster to the log.
  const roster = npcGen.populateNode(village);
  assert.ok(roster.length >= 2, `SL needs a village roster with witnesses (got ${roster.length})`);
  const victim = roster[0];

  // Memories under the live-AI stub: a witnessed robbery at the village (the
  // schedule-available roster fans out — it happens at hour 6, 'morning', so
  // diurnal NPCs witness while any night-shift guards sleep through it) and an
  // unwitnessed help of a hand-authored NPC.
  // Every rememberer's template line is then enhanced via the stub, each
  // enhancement landing as a MEMORY_SUMMARY_ENHANCED log event.
  globalThis.generateText = slStubGenerateText;
  robNpc(world, rowan.id, victim.id, village.id);
  helpNpc(world, rowan.id, mira.id);

  // Settle: wait until every fired enhancement has dispatched (bounded).
  for (let i = 0; seenEnhancements < expectedEnhancements; i++) {
    if (i > 2000) throw new Error(`SL: enhancements never settled (${seenEnhancements}/${expectedEnhancements})`);
    await new Promise((r) => setTimeout(r, 5));
  }
  delete globalThis.generateText;
  assert.ok(expectedEnhancements >= 3, 'the robbery fan-out plus the help must have fired several enhancements');

  // Clock history: ticks under two contexts (the POI explores above already
  // switched the derived context to 'exploring'; the real dialogue verbs
  // bracket a 'chatting' window), plus a flat jump.
  world.dispatch('CLOCK_TICK', { realSecondsElapsed: 10 });
  startDialogue(world, rowan.id, mira.id);
  world.dispatch('CLOCK_TICK', { realSecondsElapsed: 10 });
  endDialogue(world, rowan.id, mira.id);
  world.dispatch('CLOCK_JUMP', { gameSecondsElapsed: 3600 });

  // Conversation history: more than RECENT_EXCHANGES_WINDOW exchanges on the
  // Mira<->Rowan pair (proves the bounded window still trims correctly after
  // a round-trip), plus a line on a DIFFERENT pair (Mira<->Sable) to prove
  // save/load preserves thread isolation, not just single-thread content.
  const slExchangeCount = RECENT_EXCHANGES_WINDOW + 2;
  for (let i = 0; i < slExchangeCount; i++) {
    conversationHistory.recordDialogueLine(mira.id, rowan.id, rowan.id, `Rowan says ${i}.`);
    conversationHistory.recordDialogueLine(mira.id, rowan.id, mira.id, `Mira replies ${i}.`);
  }
  conversationHistory.recordDialogueLine(mira.id, sable.id, sable.id, 'Rough night at the tables?');

  // Economy: one of every event family, so the save carries a purchase from a
  // GENERATED shop POI (finite seeded stock), a sale to the AUTHORED Rusted
  // Ledger, an atomic craft, and two equips — on top of the construction-time
  // seed grants already in the log. The purchase line is picked
  // deterministically (sorted first stack, else first instance).
  const shopPoi = poi.getPoiState(village).pool.find((p) => p.category === 'shop');
  assert.ok(shopPoi, 'SL needs a shop POI in the village pool (config drift?)');
  const slShopRef = { kind: 'poi', node: village, poi: shopPoi };
  const slVillageStock = economy.getShopStock(slShopRef);
  const slFirstStackId = Object.keys(slVillageStock.stacks).sort()[0];
  const slBuyLine = slFirstStackId
    ? { defId: slFirstStackId, qty: 1 }
    : { instanceId: slVillageStock.instances[0].instanceId };
  assert.ok(economy.trade(rowan.id, slShopRef, { buy: [slBuyLine] }).ok, 'the village shop purchase must succeed');
  assert.ok(economy.trade(rowan.id, { kind: 'authored', shopId: 'shop_rusted_ledger' }, { sell: [{ defId: 'iron_ingot', qty: 1 }] }).ok, 'the Rusted Ledger sale must succeed');
  assert.ok(economy.craft(rowan.id, 'alchemy', 'al1').ok, 'the salve craft must succeed');
  const slDagger = economy.getInventory(rowan.id).instances.find((i) => i.itemDefId === 'iron_dagger');
  assert.ok(economy.equip(rowan.id, 'mainHand', slDagger.instanceId).ok, 'equipping the seeded dagger must succeed');
  const slRing = economy.getInventory(rowan.id).instances.find((i) => i.itemDefId === 'copper_ring');
  assert.ok(economy.equip(rowan.id, 'ring', slRing.instanceId).ok, 'equipping the seeded ring must succeed');

  // Quests (while still at the origin, the giver's node): one contract fully
  // resolved — accepted, delivered through ITEMS_TRANSFERRED, completed with
  // its rewards paid — and one left ACTIVE with its injected POI and reveal
  // authority outstanding, so the save carries both a resolved and an open
  // contract plus every quest event type.
  assert.ok(engines.quests.acceptQuest('quest_bread_run').ok, 'accepting the bread run must succeed');
  assert.ok(engines.quests.completeQuest('quest_bread_run').ok, 'completing the bread run must succeed');
  assert.ok(engines.quests.acceptQuest('quest_clear_camp').ok, 'accepting the camp contract must succeed');

  // Real travel: three legs along the explored graph. Leg one runs under the
  // live stub so its narration is AI-ENHANCED (the enhancement is settled
  // before anything else dispatches, so the log's event order is
  // deterministic); leg two runs with no plugin so its deterministic fallback
  // narration STAYS; leg three is deliberately left IN TRANSIT so the save
  // captures an open activity mid-leg (SL15 proves it round-trips and
  // resumes). Ticks are dispatched raw (1 real-s each), the same channel the
  // tick source uses.
  let slTravelEnhancements = 0;
  world.subscribe('TRAVEL_NARRATION_ENHANCED', () => { slTravelEnhancements += 1; });
  function slNextDest() {
    const node = map.getNode(travel.getPlayerNodeId());
    const edge = node.edges.find((e) => e.passable);
    assert.ok(edge, `SL needs a passable edge out of ${node.id}`);
    return edge.to;
  }
  function slTickToArrival(label) {
    for (let i = 0; travel.getActiveActivity(); i++) {
      if (i > 200) throw new Error(`SL: ${label} never arrived`);
      world.dispatch('CLOCK_TICK', { realSecondsElapsed: 1 });
    }
  }
  // A leg may now roll a real fight (travel is wired to combat). Resolve any
  // open fight deterministically (always attack-lethal the first live enemy)
  // so the lived-in world settles — leaving it open would freeze the leg (the
  // combat timeContext ×0) and slTickToArrival would spin forever. Deterministic,
  // so SL1's two-run byte-identity holds.
  const { combat: slCombat } = engines;
  function slResolveCombatIfAny() {
    for (let i = 0; slCombat.getActiveCombat(); i++) {
      if (i > 200) throw new Error('SL: a travel-incident combat never resolved');
      const active = slCombat.getActiveCombat();
      const enemy = active.combatants.find((c) => c.side === 'enemy' && (c.status ?? 'alive') === 'alive');
      slCombat.act(enemy ? { type: 'attackLethal', targetId: enemy.id } : { type: 'wait' });
      if (slCombat.isPlayerDefeated()) break;
    }
  }

  globalThis.generateText = slStubGenerateText;
  travel.startTravel(slNextDest());
  slResolveCombatIfAny(); // no-op unless this leg rolled a real fight
  for (let i = 0; slTravelEnhancements < 1; i++) {
    if (i > 2000) throw new Error('SL: travel narration never settled');
    await new Promise((r) => setTimeout(r, 5));
  }
  delete globalThis.generateText;
  slTickToArrival('leg one');

  travel.startTravel(slNextDest()); // no plugin: the fallback narration stays
  slResolveCombatIfAny();
  slTickToArrival('leg two');

  travel.startTravel(slNextDest());
  slResolveCombatIfAny(); // resolve any fight FIRST, so the leg (not a combat) is what's left open
  world.dispatch('CLOCK_TICK', { realSecondsElapsed: 1 }); // partial progress only
  assert.ok(travel.getActiveActivity(), 'SL leaves leg three open — the save must capture an in-transit activity');

  return { ...fan, ...engines, village, hamlet, victim, exploredNodeIds, shopPoi };
}

const slA = await slBuildLivedInWorld();
const slSaveText = serializeWorld(slA.world);

// --- SL1: whole-run determinism at the artifact level — living the exact same
// life twice produces byte-identical save files (the runWorld/K6 idiom, but on
// the save string itself, async AI enhancement included).
const slB = await slBuildLivedInWorld();
assert.equal(serializeWorld(slB.world), slSaveText, 'two identical runs must produce byte-identical saves');
console.log(`SL1 PASSED: two identical lived-in runs serialize to byte-identical saves (${slSaveText.length} chars, ${slA.world.getEventLog().length} events)`);

// --- SL2: reconstruct a COMPLETELY fresh world + engine set from the save
// string alone, through the same construction path a fresh world uses.
const slLoaded = buildSampleWorld({ save: parseSave(slSaveText) });
const slL = { ...slLoaded, ...slWireEngines(slLoaded) };
assert.deepEqual(slL.world.getEventLog(), slA.world.getEventLog(), 'the loaded log must equal the original log exactly');
assert.deepEqual(slL.world.getState().config, slA.world.getState().config, 'the loaded config must equal the original config exactly');
console.log('SL2 PASSED: fresh world reconstructed from the save string alone — log and config identical');

// --- SL3: relationships — stats, tiers, and direct-set labels all match, and
// the loaded store's primed cache equals its own from-scratch rebuild.
const slPairs = [
  [slA.rowan.id, slA.mira.id],
  [slA.mira.id, slA.rowan.id],
  [slA.mira.id, slA.sable.id],
  [slA.sable.id, slA.mira.id],
  [slA.victim.id, slA.rowan.id],
];
for (const [from, to] of slPairs) {
  const a = slA.relationships.getRelationship(from, to);
  const l = slL.relationships.getRelationship(from, to);
  assert.deepEqual(l, a, `relationship ${from}->${to} must round-trip`);
  assert.equal(relationshipTier(l.stats), relationshipTier(a.stats), `tier ${from}->${to} must round-trip`);
  assert.deepEqual(slL.relationships.rebuildRelationshipStats(from, to), l.stats, `loaded cache ${from}->${to} must equal its own rebuild`);
}
console.log('SL3 PASSED: relationship stats, tiers, and labels round-trip; loaded cache equals from-scratch rebuild');

// --- SL4: race registry — the edited table round-trips and the loaded primed
// cache equals its own rebuild.
assert.deepEqual(slL.races.getRaces(), slA.races.getRaces(), 'the edited race table must round-trip');
assert.deepEqual(slL.races.rebuildRaces(), slL.races.getRaces(), 'loaded race cache must equal its own rebuild');
console.log('SL4 PASSED: race registry (with live edits) round-trips');

// --- SL5: the explored map graph — every known node, WITH its edges (pure
// terrain/classification plus order-dependent materialization state), plus the
// materialized set and origin.
assert.deepEqual(slL.map.getOriginNode(), slA.map.getOriginNode(), 'origin node must round-trip');
for (const id of slA.exploredNodeIds) {
  assert.deepEqual(slL.map.getNode(id), slA.map.getNode(id), `map node ${id} (incl. edges) must round-trip`);
  assert.equal(slL.map.isMaterialized(id), slA.map.isMaterialized(id), `materialized flag for ${id} must round-trip`);
}
console.log(`SL5 PASSED: explored map graph round-trips — ${slA.exploredNodeIds.length} nodes with identical edges and materialization state`);

// --- SL6: POI state — pool (baseline + injected), discovered set, reveal
// authority; loaded caches equal their own rebuilds.
assert.deepEqual(slL.poi.getPoiState(slA.village), slA.poi.getPoiState(slA.village), 'village POI state must round-trip');
assert.deepEqual(slL.poi.getRevealedPoiIds(), slA.poi.getRevealedPoiIds(), 'reveal authority must round-trip');
assert.deepEqual(slL.poi.rebuildDiscoveredPoiIds(slA.village), slL.poi.getPoiState(slA.village).discovered, 'loaded discovered cache must equal its own rebuild');
assert.deepEqual(slL.poi.rebuildRevealedPoiIds(), slL.poi.getRevealedPoiIds(), 'loaded reveal cache must equal its own rebuild');
console.log('SL6 PASSED: POI pools, discoveries, injections, and reveal authority round-trip');

// --- SL7: faction control — the override and the explicit-null both
// round-trip (and the null is an override, not the baseline).
assert.equal(slA.faction.getFactionControl(slA.village), 'faction_rebels');
assert.equal(slL.faction.getFactionControl(slA.village), 'faction_rebels', 'village faction override must round-trip');
assert.equal(slL.faction.getFactionControl(slA.hamlet), null, 'explicit-null control must round-trip (not fall back to baseline)');
assert.equal(slL.faction.rebuildFactionControl(slA.village), 'faction_rebels', 'loaded faction cache must equal its own rebuild');
console.log('SL7 PASSED: faction overrides round-trip, including taken-to-uncontrolled (explicit null)');

// --- SL8: every registered entity — hand-authored AND generated — deep-equals
// its original, INCLUDING the memories arrays with AI-ENHANCED summary text.
// This is the regression test for the old in-place summary overwrite: were the
// enhancement not a logged event, the loaded side would show template text.
const slById = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
assert.deepEqual(slById(slL.registry.all()), slById(slA.registry.all()), 'every registered entity must round-trip exactly');
const slVictimA = slA.registry.get(slA.victim.id);
const slVictimL = slL.registry.get(slA.victim.id);
assert.equal(slVictimA.psychology.memories[0].summary, `${slVictimA.identity.firstName} will not forget what the player did today.`, 'the original victim memory carries the AI-enhanced line');
assert.equal(slVictimL.psychology.memories[0].summary, slVictimA.psychology.memories[0].summary, 'the AI-enhanced summary text must round-trip, not regress to the template');
assert.deepEqual(slL.memory.rebuildMemories(slA.victim.id), slVictimL.psychology.memories, 'loaded entity memories must equal their own from-scratch rebuild');
assert.deepEqual(deriveEntityMemories(slL.world.getEventLog(), slA.mira.id), slL.registry.get(slA.mira.id).psychology.memories, 'hand-authored entity memories must equal the pure derivation');
console.log(`SL8 PASSED: all ${slA.registry.all().length} entities round-trip exactly, AI-enhanced memory text included`);

// --- SL9: clock — total, calendar date, and active context all match; the
// loaded primed cache equals its own rebuild.
assert.equal(slL.clock.getTotalGameSeconds(), slA.clock.getTotalGameSeconds(), 'game-time total must round-trip');
assert.deepEqual(slL.clock.getCurrentDate(), slA.clock.getCurrentDate(), 'calendar date must round-trip');
assert.equal(slL.clock.getActiveTimeContext(), slA.clock.getActiveTimeContext(), 'active time context must round-trip');
assert.equal(slL.clock.rebuildTotalGameSeconds(), slL.clock.getTotalGameSeconds(), 'loaded clock cache must equal its own rebuild');
console.log(`SL9 PASSED: clock round-trips — ${slL.clock.getTotalGameSeconds()}s game time, context '${slL.clock.getActiveTimeContext()}'`);

// --- SL10: derived reads that are never stored anywhere — emotion (and the
// npc roster view) — reproduce identically on the loaded side.
assert.deepEqual(
  deriveEmotion(slVictimL, slVictimL.psychology.memories, slL.world.getEventLog()),
  deriveEmotion(slVictimA, slVictimA.psychology.memories, slA.world.getEventLog()),
  'the emotional read must reproduce identically from the loaded world'
);
assert.deepEqual(slL.npcGen.getPopulation(slA.village).map((n) => n.id), slA.npcGen.getPopulation(slA.village).map((n) => n.id), 'the village roster must round-trip');
assert.deepEqual(slL.npcGen.rebuildNodePopulation(slA.village.id).map((n) => n.id), slL.npcGen.getPopulation(slA.village).map((n) => n.id), 'loaded roster cache must equal its own rebuild');
assert.deepEqual(
  deriveScheduleState(slVictimL.schedule, slL.clock.getCurrentDate().hour),
  deriveScheduleState(slVictimA.schedule, slA.clock.getCurrentDate().hour),
  'the schedule-state read must reproduce identically from the loaded world (pattern rides the birth snapshot; the state is derived, never stored)'
);
console.log('SL10 PASSED: transient derived reads (emotion, rosters, schedule state) reproduce identically from the loaded world');

// --- SL11: saving the loaded world reproduces the original save byte for
// byte — load is lossless, so save->load->save is a fixed point.
assert.equal(serializeWorld(slL.world), slSaveText, 'save -> load -> save must be byte-identical');
console.log('SL11 PASSED: save -> load -> save is a byte-identical fixed point');

// --- SL12: the loaded world is LIVE — a new action continues the log at the
// next seq, moves stats, and lands a new memory, exactly as it would have in
// the original session.
const slSeqBefore = slL.world.getEventLog().length;
const slMiraTrustBefore = slL.relationships.getRelationship(slA.mira.id, slA.rowan.id).stats;
const slMiraMemsBefore = slL.registry.get(slA.mira.id).psychology.memories.length;
const slNewEntry = helpNpc(slL.world, slA.rowan.id, slA.mira.id);
assert.equal(slNewEntry.seq, slSeqBefore, 'a post-load dispatch must continue seq from the loaded history');
assert.notDeepEqual(slL.relationships.getRelationship(slA.mira.id, slA.rowan.id).stats, slMiraTrustBefore, 'post-load actions must move relationship stats');
assert.equal(slL.registry.get(slA.mira.id).psychology.memories.length, slMiraMemsBefore + 1, 'post-load actions must land new memories');
assert.deepEqual(
  slL.relationships.rebuildRelationshipStats(slA.mira.id, slA.rowan.id),
  slL.relationships.getRelationship(slA.mira.id, slA.rowan.id).stats,
  'the post-load cache must still equal its own rebuild'
);
console.log('SL12 PASSED: the loaded world is live — new events continue the log and every cache stays coherent');

// --- SL13: config drift — a save's embedded config differing from the
// currently-shipped config must be DETECTED and LOUDLY WARNED ABOUT, but must
// NEVER block loading and must NEVER be silently swapped for the shipped
// values (that would replay an old save under someone else's seed/tuning).
// This is the actual failure-path test the design called for: not just "a
// matching save round-trips" (SL2), but "a MISMATCHED save is rejected
// loudly, not silently accepted."
const slShippedConfig = slA.world.getState().config; // built with no save => exactly WORLD_CONFIG
const slGoodSave = parseSave(slSaveText);
assert.deepEqual(diffConfigKeys(slShippedConfig, slGoodSave.config), [], 'a save with no drift must report no differing keys');

const slDriftedSave = { ...slGoodSave, config: { ...slGoodSave.config, rngSeed: slGoodSave.config.rngSeed + 1 } };
assert.deepEqual(diffConfigKeys(slShippedConfig, slDriftedSave.config), ['rngSeed'], 'a deliberately mismatched save must report exactly the differing key');

function captureConsole(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => { lines.push(args.join(' ')); };
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines;
}

let slDriftWorld;
const slDriftLines = captureConsole(() => {
  assert.doesNotThrow(() => {
    slDriftWorld = buildSampleWorld({ save: slDriftedSave });
  }, 'a config-mismatched save must load without throwing — old saves must not be bricked by a future shipped-config retune');
});
assert.equal(
  slDriftWorld.world.getState().config.rngSeed,
  slDriftedSave.config.rngSeed,
  "the loaded world must replay under the SAVE's own config, not silently fall back to the shipped one"
);
assert.equal(
  slDriftLines.filter((l) => l.includes('WARNING') && l.includes('rngSeed')).length,
  1,
  'exactly one loud warning naming the drifted key must be logged on a mismatched load'
);

const slNoDriftLines = captureConsole(() => {
  buildSampleWorld({ save: slGoodSave });
});
assert.equal(slNoDriftLines.filter((l) => l.includes('SaveLoad')).length, 0, 'a save with no config drift must not warn');
console.log("SL13 PASSED: config drift between a save and the shipped config is detected and loudly warned about, but never blocks loading and never silently swaps in the shipped values");

// --- SL14: conversation history — pair-keyed, round-trips exactly, and the
// loaded store's primed cache equals its own from-scratch rebuild. Distinct
// threads for the same NPC (Mira<->Rowan vs Mira<->Sable) must both round-trip
// and stay isolated from each other, not just individually correct.
const slMiraRowanA = slA.conversationHistory.getConversationHistory(slA.mira.id, slA.rowan.id);
const slMiraRowanL = slL.conversationHistory.getConversationHistory(slA.mira.id, slA.rowan.id);
assert.deepEqual(slMiraRowanL, slMiraRowanA, "Mira<->Rowan's conversation history must round-trip exactly");
assert.equal(slMiraRowanA.length, (RECENT_EXCHANGES_WINDOW + 2) * 2, 'the fixture recorded more than the window — full history must carry every line');

const slMiraSableA = slA.conversationHistory.getConversationHistory(slA.mira.id, slA.sable.id);
const slMiraSableL = slL.conversationHistory.getConversationHistory(slA.mira.id, slA.sable.id);
assert.deepEqual(slMiraSableL, slMiraSableA, "Mira<->Sable's conversation history must round-trip exactly");
assert.notDeepEqual(slMiraSableL, slMiraRowanL, "Mira's two separate threads must stay distinct after round-tripping, not merge");

assert.deepEqual(
  slL.conversationHistory.rebuildConversationHistory(slA.mira.id, slA.rowan.id),
  slMiraRowanL,
  'loaded conversation-history cache must equal its own from-scratch rebuild'
);
console.log(`SL14 PASSED: conversation history round-trips pair-keyed and thread-isolated — Mira<->Rowan ${slMiraRowanA.length} lines, Mira<->Sable ${slMiraSableA.length} line(s), loaded cache equals its own rebuild`);

// --- SL15: travel — position, the full incident history (including the
// AI-enhanced narration line, which must replay from its own log event), and
// the IN-TRANSIT leg all round-trip; loaded caches equal their own rebuilds;
// and the loaded mid-leg world RESUMES — continued ticks complete the leg
// exactly as the original session would have.
assert.equal(slL.travel.getPlayerNodeId(), slA.travel.getPlayerNodeId(), 'player position must round-trip');
assert.deepEqual(slL.travel.getIncidents(), slA.travel.getIncidents(), 'the full incident history must round-trip');
const slIncidents = slA.travel.getIncidents();
assert.equal(slIncidents.length, 3, 'three legs ⇒ three incidents (exactly one each, quiet legs included)');
assert.equal(
  slIncidents[0].narration,
  'someone will not forget what the player did today.',
  "leg one's narration must be the stub-AI line (the enhancement event replayed), not the fallback"
);
assert.equal(
  slIncidents[1].narration,
  fallbackTravelNarration(slIncidents[1]),
  "leg two's narration must be the deterministic fallback (no plugin was live)"
);
assert.ok(slA.travel.getActiveActivity(), 'the save was taken mid-leg — the original world was still traveling');
assert.deepEqual(slL.travel.getActiveActivity(), slA.travel.getActiveActivity(), 'the open in-transit activity (with its elapsed progress) must round-trip');
assert.equal(slL.travel.rebuildPlayerNodeId(), slL.travel.getPlayerNodeId(), 'loaded position cache must equal its own rebuild');
assert.deepEqual(slL.travel.rebuildIncidents(), slL.travel.getIncidents(), 'loaded incident cache must equal its own rebuild');
assert.deepEqual(slL.travel.rebuildActiveActivity(), slL.travel.getActiveActivity(), 'loaded activity cache must equal its own rebuild');

const slResumeDest = slL.travel.getActiveActivity().toNodeId;
for (let i = 0; slL.travel.getActiveActivity(); i++) {
  if (i > 200) throw new Error('SL15: the loaded in-transit leg never arrived');
  slL.world.dispatch('CLOCK_TICK', { realSecondsElapsed: 1 });
}
assert.equal(slL.travel.getPlayerNodeId(), slResumeDest, 'the loaded world resumes the leg and arrives at the destination the original chose');
console.log(`SL15 PASSED: travel round-trips — position, ${slIncidents.length} incidents (AI-enhanced and fallback narration both), and the open mid-leg activity, which resumed and arrived after load`);

// --- SL16: economy — gold, holdings, equipment, and BOTH kinds of shop stock
// (a generated shop POI's seeded baseline ⊕ trade deltas, and the authored
// Rusted Ledger's) round-trip; every loaded cache equals its own rebuild; and
// the loaded economy is LIVE — one more trade continues the log and moves the
// player's and the shop's purses coherently. Holdings/equipment are the exact
// class of state the memory-engine overwrite bug was about: were any of it a
// live-only mutation instead of a logged event, the loaded side would diverge
// here.
const slLedgerRef = { kind: 'authored', shopId: 'shop_rusted_ledger' };
const slPoiShopRef = { kind: 'poi', node: slA.village, poi: slA.shopPoi };
assert.equal(slL.economy.getGold(slA.rowan.id), slA.economy.getGold(slA.rowan.id), "the player's gold must round-trip");
assert.deepEqual(slL.economy.getInventory(slA.rowan.id), slA.economy.getInventory(slA.rowan.id), "the player's holdings (stacks + instances) must round-trip");
assert.deepEqual(slL.economy.getEquipped(slA.rowan.id), slA.economy.getEquipped(slA.rowan.id), 'the equipped map must round-trip');
assert.ok(slL.economy.getEquipped(slA.rowan.id).mainHand, 'the equipped dagger is still in hand after load');
for (const [label, ref] of [['generated shop POI', slPoiShopRef], ['authored Rusted Ledger', slLedgerRef]]) {
  assert.deepEqual(slL.economy.getShopStock(ref), slA.economy.getShopStock(ref), `${label} stock must round-trip (baseline re-derived, deltas replayed)`);
  assert.deepEqual(slL.economy.rebuildShopStock(ref), slL.economy.getShopStock(ref), `loaded ${label} stock must equal its own rebuild`);
}
assert.deepEqual(slL.economy.rebuildGold(slA.rowan.id), slL.economy.getGold(slA.rowan.id), 'loaded gold cache must equal its own rebuild');
assert.deepEqual(slL.economy.rebuildInventory(slA.rowan.id), slL.economy.getInventory(slA.rowan.id), 'loaded inventory cache must equal its own rebuild');
assert.deepEqual(slL.economy.rebuildEquipped(slA.rowan.id), slL.economy.getEquipped(slA.rowan.id), 'loaded equipped cache must equal its own rebuild');

const slEcSeqBefore = slL.world.getEventLog().length;
const slEcGoldBefore = slL.economy.getGold(slA.rowan.id);
const slEcShopGoldBefore = slL.economy.getShopStock(slLedgerRef).gold;
const slEcTrade = slL.economy.trade(slA.rowan.id, slLedgerRef, { buy: [{ defId: 'bread', qty: 1 }] });
assert.ok(slEcTrade.ok, `a post-load trade must succeed (${slEcTrade.reason ?? ''})`);
assert.equal(slEcTrade.entry.seq, slEcSeqBefore, 'the post-load trade must continue seq from the loaded history');
const slEcSpent = slEcGoldBefore - slL.economy.getGold(slA.rowan.id);
assert.ok(slEcSpent > 0, 'the post-load purchase must cost gold');
assert.equal(slL.economy.getShopStock(slLedgerRef).gold - slEcShopGoldBefore, slEcSpent, 'post-load gold is still conserved between player and shop');
assert.deepEqual(slL.economy.rebuildInventory(slA.rowan.id), slL.economy.getInventory(slA.rowan.id), 'the post-load inventory cache must still equal its own rebuild');
console.log(`SL16 PASSED: economy round-trips — gold, holdings, equipment, generated + authored shop stock all match, loaded caches equal their rebuilds, and a post-load trade (${slEcSpent}c of bread) continued the log coherently`);

// --- SL17: quests — the resolved contract (completed, rewards paid) and the
// OPEN contract (active, camp POI injected, reveal authority armed) both
// round-trip; objective progress derives identically on the loaded side; the
// loaded status cache equals its own rebuild; and NOTHING re-granted or
// re-injected on load — the react-verb discipline's save/load payoff.
assert.deepEqual(slL.quests.getQuestStatuses(), slA.quests.getQuestStatuses(), 'quest statuses must round-trip');
assert.equal(slL.quests.getQuestStatuses().quest_bread_run.status, 'completed', 'the resolved contract stays completed');
assert.equal(slL.quests.getQuestStatuses().quest_clear_camp.status, 'active', 'the open contract stays active');
for (const slQuestId of questIds()) {
  assert.deepEqual(slL.quests.getObjectiveProgress(slQuestId), slA.quests.getObjectiveProgress(slQuestId), `objective progress for ${slQuestId} must round-trip`);
}
assert.deepEqual(slL.quests.rebuildQuestStatuses(), slL.quests.getQuestStatuses(), 'loaded quest status cache must equal its own rebuild');
const slCampNode = slL.map.getNode('node_6.285_-1.357');
assert.ok(slL.poi.getPoiState(slCampNode).pool.some((p) => p.id === 'poi_q_wolfpine_camp'), "the open contract's injected camp is still in the node's pool after load");
assert.ok(slL.poi.getRevealedPoiIds().has('poi_q_wolfpine_camp'), "the open contract's reveal authority survives load");
assert.equal(
  slL.world.getEventLog().filter((e) => e.type === 'GOLD_GRANTED' && e.payload.reason === 'quest_bread_run').length,
  1,
  'the bread-run bounty was paid exactly once — priming re-granted nothing'
);
assert.equal(
  slL.world.getEventLog().filter((e) => e.type === 'POI_INJECTED' && e.payload.poi.id === 'poi_q_wolfpine_camp').length,
  1,
  'the camp was injected exactly once — priming re-injected nothing'
);
console.log('SL17 PASSED: quests round-trip — the completed and the open contract, objective progress, injected POI + reveal authority, loaded cache equals its rebuild, and load re-granted nothing');

// --- SL18: an IN-PROGRESS combat round-trips and RESUMES, the travel-leg
// precedent (SL15) extended to a mid-fight save. A forced-combat world starts a
// leg that opens a fight; ONE round is resolved, then the world is serialized
// mid-fight. The reconstruction must restore the open fight exactly (roster hp,
// statuses, round, turn order), its caches must equal their own rebuilds, load
// must re-grant NO loot, and continuing the identical act() script must drive
// both worlds to a byte-identical finish that then resumes and arrives the leg.
function slBuildMidCombatWorld() {
  const cfg = structuredClone(slA.world.getState().config);
  cfg.travel.incident.incidentChance = 1;
  cfg.travel.incident.categories = { bandit: { weight: 1 } };
  cfg.travel.incident.intensityWeights = { 2: 1 };
  cfg.travel.incident.turnIntensityByCategory = { bandit: 2 };
  let fan;
  captureConsole(() => { fan = buildSampleWorld({ save: { config: cfg, eventLog: [] } }); });
  const engines = slWireEngines(fan);
  const { map, travel, combat, economy } = engines;
  map.materializeNeighbors(travel.getPlayerNodeId());
  // Arm the player (empty-log save skips the seed grants), then start a leg —
  // which opens a fight — and resolve exactly ONE round.
  economy.grantItems(fan.rowan.id, { instanceDefIds: ['iron_sword'] }, 'sl18');
  economy.equip(fan.rowan.id, 'mainHand', economy.getInventory(fan.rowan.id).instances[0].instanceId);
  const node = map.getNode(travel.getPlayerNodeId());
  travel.startTravel(node.edges.find((e) => map.getNode(e.to)?.passable).to);
  assert.ok(combat.getActiveCombat(), 'SL18 fixture must open a fight on the leg');
  const enemy = combat.getActiveCombat().combatants.find((c) => c.side === 'enemy');
  combat.act({ type: 'attackLethal', targetId: enemy.id });
  assert.ok(combat.getActiveCombat(), 'SL18 saves mid-fight — the fight must still be open after one round');
  return { ...fan, ...engines };
}

const sl18A = slBuildMidCombatWorld();
const sl18SaveText = serializeWorld(sl18A.world);
const sl18Loaded = buildSampleWorld({ save: parseSave(sl18SaveText) });
const sl18L = { ...sl18Loaded, ...slWireEngines(sl18Loaded) };

// The open fight round-trips exactly, and its caches equal their own rebuilds.
assert.deepEqual(sl18L.combat.getActiveCombat(), sl18A.combat.getActiveCombat(), 'the open fight (roster hp, statuses, round, turn order) must round-trip');
assert.deepEqual(sl18L.combat.rebuildActiveCombat(), sl18L.combat.getActiveCombat(), 'loaded active-combat cache equals its own rebuild');
assert.deepEqual(sl18L.combat.rebuildCombatHistory(), sl18L.combat.getCombatHistory(), 'loaded combat-history cache equals its own rebuild');
assert.deepEqual(sl18L.combat.rebuildVitals(), sl18A.combat.rebuildVitals(), 'loaded vitals equal the original');
// Load re-granted nothing — no loot events exist yet (the fight is unresolved).
assert.equal(sl18L.world.getEventLog().filter((e) => e.type === 'COMBAT_ENDED').length, 0, 'no fight has ended yet');
assert.equal(sl18L.world.getEventLog().filter((e) => e.type === 'GOLD_GRANTED').length, 0, 'no loot granted before the fight resolves (priming re-granted nothing)');

// Resume the SAME act() script on both worlds → byte-identical finish.
function sl18Finish(fan) {
  for (let i = 0; fan.combat.getActiveCombat() && i < 60; i++) {
    const en = fan.combat.getActiveCombat().combatants.find((c) => c.side === 'enemy' && (c.status ?? 'alive') === 'alive');
    fan.combat.act(en ? { type: 'attackLethal', targetId: en.id } : { type: 'wait' });
  }
}
sl18Finish(sl18A);
sl18Finish(sl18L);
assert.deepEqual(sl18L.world.getEventLog(), sl18A.world.getEventLog(), 'resuming the identical fight after load yields a byte-identical log');
const sl18Ended = sl18L.world.getEventLog().filter((e) => e.type === 'COMBAT_ENDED');
assert.equal(sl18Ended.length, 1, 'the resumed fight ends exactly once');
assert.equal(sl18Ended[0].payload.outcome, 'victory', 'the resumed fight is won');
// The leg was frozen through the fight; now it resumes and arrives on both.
const sl18Dest = sl18L.travel.getActiveActivity().toNodeId;
for (let i = 0; sl18L.travel.getActiveActivity() && i < 500; i++) sl18L.world.dispatch('CLOCK_TICK', { realSecondsElapsed: 1 });
assert.equal(sl18L.travel.getPlayerNodeId(), sl18Dest, 'the loaded world resumes the leg and arrives after the fight');
console.log('SL18 PASSED: an in-progress combat round-trips (open fight, hp, statuses, round, turn order), loaded caches equal their rebuilds, load re-grants no loot, and resuming the identical fight drives a byte-identical finish that then arrives the frozen leg');

console.log('\nSection SL PASSED: the entire world state round-trips through (config + event log) alone — serialize, reconstruct fresh engines, and every derived read (inventory, gold, shop stock, quest state, and an in-progress combat included) matches the original exactly');

// Covers every deterministic/synthetic check above: prompt-assembly
// determinism, the five queue-manager correctness properties, the stubbed
// transport plumbing, fallback + contract enforcement, memory fan-out, the
// permanent-voice / transient-emotion derivations, NPC schedules with
// presence-aware witnesses, pair-keyed conversation history, the
// travel/explore verbs with their seeded incident system, the inventory &
// economy engine (seeded shop stock, atomic trade/craft, equipment), and the
// full save/load round-trip of the entire world state.
// Real live-AI verification
// (dialogue lines AND memory-summary lines) can only happen by hand inside an
// actual Perchance page.
console.log('\nALL CHECKS PASSED');
