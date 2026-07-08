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
import { initWorldState } from './worldState.js';
import { createFarmEngine } from './engines/farmEngine.js';
import { createReputationEngine } from './engines/reputationEngine.js';
import { createPlayer, createNpc, effectiveSkill } from './entities/entitySchema.js';
import { createRelationshipStore, relationshipTier } from './entities/relationshipStore.js';
import { validateDialogueResponse } from './ai/responseContract.js';
import { buildDialoguePrompt } from './ai/buildDialoguePrompt.js';
import { fallbackDialogue } from './ai/fallbackDialogue.js';
import { createQueueManager } from './ai/queueManager.js';
import { getDialogue } from './ai/getDialogue.js';
import { buildSampleWorld } from './game/sampleWorld.js';
import { createRelationshipEffectEngine } from './engines/relationshipEffectEngine.js';
import { createMemoryEngine } from './engines/memoryEngine.js';
import { helpNpc, robNpc, ignoreNpc } from './actions/playerActions.js';

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

relationships.setRelationship(
  rowan.id, mira.id,
  { affection: 25, comfort: 20, trust: 15, desire: 10, obedience: 5 },
  'Mira'
);
relationships.setRelationship(
  mira.id, rowan.id,
  { affection: 30, comfort: 25, trust: 20, desire: 10, obedience: 2 },
  'traveler'
);

const playerToNpc = relationships.getRelationship(rowan.id, mira.id);
const npcToPlayer = relationships.getRelationship(mira.id, rowan.id);
console.log(`\nplayer->npc edge: ${JSON.stringify(playerToNpc)}`);
console.log(`npc->player edge: ${JSON.stringify(npcToPlayer)}`);
assert.notEqual(playerToNpc.fromCallsTo, npcToPlayer.fromCallsTo);
console.log(`Directionality check PASSED: Rowan calls her "${playerToNpc.fromCallsTo}", Mira calls him "${npcToPlayer.fromCallsTo}"`);

// --- 11. relationshipTier is derived, never stored ---------------------------
const tierBefore = relationshipTier(playerToNpc.stats);
console.log(`\nplayer->npc tier before: ${tierBefore} (avg of stats = ${(25 + 20 + 15 + 10 + 5) / 5})`);

relationships.setRelationship(
  rowan.id, mira.id,
  { ...playerToNpc.stats, trust: 100 },
  playerToNpc.fromCallsTo
);
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

// Covers every deterministic/synthetic check above: prompt-assembly
// determinism, the five queue-manager correctness properties, the stubbed
// transport plumbing, and fallback + contract enforcement. Real live-AI
// verification can only happen by hand inside an actual Perchance page.
console.log('\nALL CHECKS PASSED');
