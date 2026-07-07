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
import { createPlayer, createNpc, effectiveSkill } from './entities/entitySchema.js';
import { createRelationshipStore, relationshipTier } from './entities/relationshipStore.js';

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

console.log('\nALL CHECKS PASSED');
