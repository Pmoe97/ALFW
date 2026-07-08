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
import { createPlayer, createNpc, effectiveSkill } from './entities/entitySchema.js';
import {
  createRelationshipStore,
  relationshipTier,
  deriveRelationshipStats,
  deriveRelationshipHistory,
  TIER_THRESHOLDS,
} from './entities/relationshipStore.js';
import { validateDialogueResponse } from './ai/responseContract.js';
import { buildDialoguePrompt } from './ai/buildDialoguePrompt.js';
import { fallbackDialogue } from './ai/fallbackDialogue.js';
import { createQueueManager } from './ai/queueManager.js';
import { getDialogue } from './ai/getDialogue.js';
import { buildSampleWorld } from './game/sampleWorld.js';
import { createRelationshipEffectEngine } from './engines/relationshipEffectEngine.js';
import { createMemoryEngine } from './engines/memoryEngine.js';
import { helpNpc, robNpc, ignoreNpc } from './actions/playerActions.js';
import {
  createWorldClockEngine,
  deriveCalendarDate,
  deriveActiveTimeContext,
  deriveTotalGameSeconds,
} from './engines/worldClockEngine.js';
import { createTickSource } from './game/tickSource.js';
import {
  createWorldMapEngine,
  deriveTerrainAt,
  generateNeighborCandidates,
  computeHeading,
  deriveNodeAt,
  nodeIdFor,
} from './engines/worldMapEngine.js';
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
    voice: { accent: 'Vale Country drawl', speechPattern: 'blunt, peppered with tavern slang', tags: ['gravelly', 'warm'] },
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
    voice: { accent: 'Northmarch', speechPattern: 'terse, understated', tags: ['low', 'even'] },
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

// Determinism: byte-identical on a second build with the same inputs.
const promptAgain = buildDialoguePrompt(mira, miraToRowanEdge, mira.psychology.memories, samplePlayerLine);
assert.equal(prompt, promptAgain);
console.log('\nSection A PASSED: all required parts present, assembly deterministic');

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

console.log('\nSection E PASSED: player verbs deterministically move relationship stats and auto-generate memories');

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
// be driven deterministically here with no timer. The debug context switch
// (DEBUG_SET_TIME_CONTEXT, a bare timeContext-carrying action) is what the test
// harness uses to prove dilation live; it is exercised here too.
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

// --- I2: the debug context switch drives dilation mid-stream -----------------
// A bare DEBUG_SET_TIME_CONTEXT action (only a timeContext, no gameplay verb)
// flips the active multiplier, exactly as the harness buttons do.
const iBeforeTravel = runtime.clock.getTotalGameSeconds();
runtime.world.dispatch('DEBUG_SET_TIME_CONTEXT', { timeContext: 'traveling' });
assert.equal(runtime.clock.getActiveTimeContext(), 'traveling', 'the debug switch must set the active context');
runtime.tick.simulateTicks(5); // 5 real-s × 60
assert.equal(runtime.clock.getTotalGameSeconds() - iBeforeTravel, 5 * 60, 'traveling ticks must use × 60');

const iBeforeChat = runtime.clock.getTotalGameSeconds();
runtime.world.dispatch('DEBUG_SET_TIME_CONTEXT', { timeContext: 'chatting' });
runtime.tick.simulateTicks(5); // 5 real-s × 1
assert.equal(runtime.clock.getTotalGameSeconds() - iBeforeChat, 5 * 1, 'chatting ticks must use × 1');

const iBeforeIdleAgain = runtime.clock.getTotalGameSeconds();
runtime.world.dispatch('DEBUG_SET_TIME_CONTEXT', { timeContext: 'idle' });
runtime.tick.simulateTicks(5); // 5 real-s × 20
assert.equal(runtime.clock.getTotalGameSeconds() - iBeforeIdleAgain, 5 * 20, 'switching back to idle must restore × 20');
console.log('I2 PASSED: debug context switch drove × 60 (traveling), × 1 (chatting), × 20 (idle) mid-stream');

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
  w.dispatch('DEBUG_SET_TIME_CONTEXT', { timeContext: 'traveling' });
  t.simulateTicks(4);
  w.dispatch('DEBUG_SET_TIME_CONTEXT', { timeContext: 'idle' });
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
silentWorld.world.dispatch('DEBUG_SET_TIME_CONTEXT', { timeContext: 'traveling' });
silentWorld.tick.simulateTicks(3);

setChannelEnabled('WorldClockEngine', true);
const loudWorld = buildTickWorld();
loudWorld.tick.simulateTicks(5);
loudWorld.world.dispatch('DEBUG_SET_TIME_CONTEXT', { timeContext: 'traveling' });
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

// Covers every deterministic/synthetic check above: prompt-assembly
// determinism, the five queue-manager correctness properties, the stubbed
// transport plumbing, and fallback + contract enforcement. Real live-AI
// verification can only happen by hand inside an actual Perchance page.
console.log('\nALL CHECKS PASSED');
