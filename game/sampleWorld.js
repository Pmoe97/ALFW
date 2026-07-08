// game/sampleWorld.js — shared sample-world construction.
//
// Pure, silent construction (no console output) of the hand-authored
// Mira/Rowan pair and their relationship, shared by game/main.js,
// game/testHarness.js, and proof.js so none of them duplicate this data a
// third time.

import { createWorldState } from '../worldState.js';
import { createNpc, createPlayer } from '../entities/entitySchema.js';
import { createRelationshipStore } from '../entities/relationshipStore.js';
import { createEntityRegistry } from '../entities/entityRegistry.js';

// Mirrors worldConfig.json — keep these two in sync by hand. createWorldState()
// (not initWorldState()) is used deliberately: this runs in a browser/
// Perchance page with no filesystem access, so the config must be inlined.
const WORLD_CONFIG = {
  worldName: 'Aldervale',
  startDateTime: '1024-03-01T06:00:00Z',
  rngSeed: 12345,
};

export function buildSampleWorld() {
  const world = createWorldState(WORLD_CONFIG);

  const mira = createNpc({
    id: 'npc_mira', // reuse npc_mira — she's the tavern keeper who also works the fields
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
      memories: [], // no farm engine here (unlike proof.js), so nothing points at a real event-log entry
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

  const registry = createEntityRegistry(world);
  registry.register(mira);
  registry.register(rowan);

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

  return { world, registry, relationships, mira, rowan };
}
