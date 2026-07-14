// game/sampleWorld.js — shared sample-world construction.
//
// Pure, silent construction (no console output, except the one loud warning
// below when a loaded save's config has drifted from the shipped one) of the
// hand-authored Mira/Rowan/Sable trio and their relationships, shared by
// game/main.js, game/testHarness.js, and proof.js so none of them duplicate
// this data a third time.

import { createWorldState } from '../worldState.js';
import { createNpc, createPlayer } from '../entities/entitySchema.js';
import { createRelationshipStore } from '../entities/relationshipStore.js';
import { createConversationHistoryStore } from '../entities/conversationHistoryStore.js';
import { createEntityRegistry } from '../entities/entityRegistry.js';
import { createRaceRegistry } from '../entities/raceRegistry.js';
import { diffConfigKeys } from './saveLoad.js';
import { log } from '../debugLog.js';

// Mirrors worldConfig.json — keep these two in sync by hand. createWorldState()
// (not initWorldState()) is used deliberately: this runs in a browser/
// Perchance page with no filesystem access, so the config must be inlined.
// Exported so the WorldConfig editor can clone it as the base template a named
// preset is authored from, and so a fresh run started from a preset can pass the
// edited config to buildSampleWorld({ config }).
export const WORLD_CONFIG = {
  worldName: 'Aldervale',
  startDateTime: '1024-03-01T06:00:00Z',
  rngSeed: 12345,
  runtime: {
    tickIntervalMs: 1000,
    pauseOnBlur: true,
  },
  timeDilation: {
    multipliers: {
      idle: 20,
      traveling: 60,
      chatting: 1,
      exploring: 40,
      // LOCKED at 0 — a deliberate, permanent design choice (no time
      // technically passes during a fight), not a placeholder default: the
      // ×0 multiplier means CLOCK_TICKs while combat's timeContext is active
      // contribute zero game-seconds to the world clock, which also freezes
      // an open travel leg's elapsed progress. That multiplier alone is the
      // whole mechanism that gates TRAVEL_ARRIVED behind combat resolution
      // (engines/combatEngine.js) — proven by proof.js Section CB (CB3
      // asserts clock.getTotalGameSeconds() is unchanged across ticks taken
      // mid-fight). Do not retune this away from 0 without re-deriving the
      // arrival-gating mechanism it currently provides for free.
      combat: 0,
    },
  },
  calendar: {
    secondsPerGameDay: 86400,
    daysPerWeek: 7,
    weeksPerMonth: 5,
    monthsPerYear: 4,
    monthNames: ['Rain', 'Sun', 'Harvest', 'Snow'],
    epoch: { year: 1, month: 'Rain', week: 1, day: 1, hour: 6, minute: 0, second: 0 },
  },
  worldMap: {
    seed: null,
    worldSize: 1.0,
    baseInterNodeDistance: 10,
    distanceJitter: 0.3,
    angleJitterDegrees: 15,
    reconciliationToleranceRadius: 4,
    terrain: {
      noiseScale: 40,
      octaves: 3,
      deepWaterLevel: 0.18,
      waterLevel: 0.32,
      cliffLevel: 0.82,
      hillsLevel: 0.65,
      forestMoisture: 0.6,
      denseForestMoisture: 0.88,
      falloffScale: 200,
    },
    classification: {
      settlement: {
        cellSize: 60,
        minSpacing: 40,
        suitabilityThreshold: 0.55,
        snapRadius: 3,
        tierNoiseScale: 120,
        tierThresholds: { hamlet: 0.0, village: 0.4, town: 0.52, city: 0.62, capital: 0.72 },
        tierSpacingMultiplier: { hamlet: 1.0, village: 1.5, town: 2.5, city: 4.0, capital: 6.0 },
      },
      faction: { factionCount: 3, territoryNoiseScale: 300, uncontrolledThreshold: 0.25 },
      environment: { notabilityNoiseScale: 30, notabilityRarityExponent: 2.0, notabilityLandmarkThreshold: 0.6 },
    },
    poi: {
      hiddenChance: 0.2,
      settlement: {
        poolSizeByTier: { hamlet: 2, village: 3, town: 5, city: 8, capital: 12 },
        categories: {
          shop: { weight: 4, minTier: 'hamlet' },
          tavern: { weight: 3, minTier: 'hamlet' },
          square: { weight: 2, minTier: 'village' },
          temple: { weight: 2, minTier: 'town' },
          guildhall: { weight: 2, minTier: 'town' },
          keep: { weight: 1, minTier: 'city' },
          palace: { weight: 1, minTier: 'capital' },
        },
      },
      wilderness: {
        base: 0,
        notabilityPoolScale: 4,
        hospitabilityPoolScale: 1,
        maxPoolSize: 8,
        categories: {
          ore_deposit: { weight: 3, minNotability: 0 },
          cave: { weight: 3, minNotability: 0 },
          camp: { weight: 2, minNotability: 0 },
          grove: { weight: 2, minNotability: 0 },
          shrine: { weight: 1, minNotability: 0.5 },
          ruin: { weight: 2, minNotability: 0.4 },
          dungeon: { weight: 1, minNotability: 0.6 },
        },
      },
      explore: {
        baseExploreSuccessChance: 0.75,
      },
    },
    population: {
      settlement: {
        populationByTier: { hamlet: 6, village: 12, town: 24, city: 40, capital: 60 },
      },
      wilderness: {
        base: -1,
        notabilityPopScale: 4,
        hospitabilityPopScale: 2.5,
        maxPopulation: 6,
      },
    },
  },
  // Travel pacing + incident tables (engines/travelEngine.js). A typical leg
  // (baseInterNodeDistance 10 ± jitter → distance ~7–13) costs ~21–39 game-
  // minutes, which at the traveling ×60 dilation with 1s ticks is ~21–39 REAL
  // seconds — long enough to hide the 15s AI-narration timeout behind the
  // visibly advancing clock. turnIntensityByCategory is the intensity at which
  // an incident becomes a requires-a-real-turn branch (4 = never, since
  // intensity tops out at 3 — mundane events are always auto flavor).
  travel: {
    gameSecondsPerDistanceUnit: 180,
    exploreDurationGameSeconds: 600,
    incident: {
      incidentChance: 0.5,
      categories: {
        animal: { weight: 3 },
        bandit: { weight: 2 },
        npc: { weight: 3 },
        environmental: { weight: 3 },
        mundane: { weight: 4 },
      },
      intensityWeights: { 1: 5, 2: 3, 3: 1 },
      turnIntensityByCategory: { animal: 3, bandit: 2, npc: 3, environmental: 3, mundane: 4 },
    },
  },
  // Economy TUNING only (engines/economyEngine.js): the price spread and
  // seeded-shop stock sizing. Item definitions/recipes are shipped CODE
  // (engines/economyData.js) so the catalog never bloats saves or trips the
  // config-drift warning on content additions.
  economy: {
    spread: { shopSellsFactor: 1.3, shopBuysFactor: 0.7 },
    shop: {
      stockSizeByTier: { hamlet: 4, village: 6, town: 8, city: 10, capital: 12 },
      baseGoldByTier: { hamlet: 80, village: 150, town: 300, city: 600, capital: 1000 },
      maxStackQty: 5,
    },
  },
  // Combat TUNING only (engines/combatEngine.js): hit/damage/flee constants.
  // Enemy archetypes, encounter templates, and per-item combat stats are
  // shipped CODE (engines/combatData.js, engines/economyData.js) on the same
  // no-save-bloat argument as the economy catalog. Committed combat events
  // carry their fully resolved rolls and damage, so retuning these constants
  // never rewrites history.
  combat: {
    hitBase: 0.65,
    hitPerSkillPoint: 0.05,
    hitFloor: 0.15,
    hitCeiling: 0.95,
    nonlethalDamageFactor: 0.5,
    fleeBaseChance: 0.5,
    fleePerAgilityPoint: 0.03,
    unarmed: { damageBase: 1, damageSpread: 2 },
  },
  // Top-level SIBLING of worldMap on purpose: worldMap.* is seed-locked
  // generation config; raceRegistry is the DEFAULTS of a live, player-editable
  // settings surface (see entities/raceRegistry.js).
  raceRegistry: {
    races: {
      human: {
        displayName: 'Human',
        enabled: true,
        weight: 10,
        genders: ['female', 'male'],
        namePool: {
          female: ['Tessa', 'Wren', 'Ida', 'Maren', 'Elsbeth', 'Junia', 'Roslyn', 'Ada'],
          male: ['Bram', 'Cole', 'Edric', 'Tomas', 'Garrin', 'Hale', 'Osric', 'Piers'],
        },
        surnames: ['Thistledown', 'Ashvale', 'Copperfield', 'Marsh', 'Weatherby', 'Stroud', 'Fenwick', 'Harrow'],
        ageRange: { min: 18, max: 70 },
        axisPriors: { extraversion: 5, agreeableness: 5, conscientiousness: 5, dominance: 5, openness: 5 },
        appearanceOverrides: {},
        appearanceExtensions: {},
        voiceAccents: [
          { name: 'Vale Country', signaturePhrases: ['reckon', 'much obliged', 'settle up', 'mind yourself', 'no trouble at all', 'there now'] },
          { name: 'Northmarch', signaturePhrases: ["fair enough", "won't lie", 'long as it keeps', 'obliged', 'no matter', 'canny'] },
          { name: 'Aldervale dockside', signaturePhrases: ['savvy?', 'aye', 'square deal', 'keep your coin', 'watch yourself', 'reckon so'] },
        ],
      },
      elf: {
        displayName: 'Elf',
        enabled: true,
        weight: 3,
        genders: ['female', 'male'],
        namePool: {
          female: ['Lirael', 'Aerith', 'Sylune', 'Naivara', 'Keyleth', 'Thessaly'],
          male: ['Aelar', 'Caelith', 'Varis', 'Erevan', 'Soveliss', 'Thamior'],
        },
        surnames: ['Silverbough', 'Dawnwhisper', 'Moonbrook', 'Gladesong', 'Wyndrunner', 'Starfall'],
        ageRange: { min: 30, max: 400 },
        axisPriors: { extraversion: 3, agreeableness: 6, conscientiousness: 6, dominance: 4, openness: 7 },
        appearanceOverrides: {
          'skin.tone': ['pale', 'porcelain', 'golden', 'moon-grey'],
          'hair.color': ['silver', 'white-gold', 'black', 'copper'],
        },
        appearanceExtensions: {
          ears: ['long pointed', 'swept pointed', 'short pointed'],
        },
        voiceAccents: [
          { name: 'old-court lilt', signaturePhrases: ['if it pleases', 'indeed', 'one does not simply', 'as the old songs say', 'in due season'] },
          { name: 'forest-quiet cadence', signaturePhrases: ['the wood remembers', 'softly now', 'let it pass', 'in time', 'so it is'] },
        ],
      },
      dwarf: {
        displayName: 'Dwarf',
        enabled: true,
        weight: 3,
        genders: ['female', 'male'],
        namePool: {
          female: ['Helga', 'Brunhild', 'Dagny', 'Sigrid', 'Astrid', 'Torhild'],
          male: ['Borin', 'Thrain', 'Durgan', 'Keldan', 'Morgrim', 'Ulfgar'],
        },
        surnames: ['Ironvein', 'Stonehelm', 'Coppergrip', 'Deepdelver', 'Anvilmark', 'Granitebrow'],
        ageRange: { min: 25, max: 250 },
        axisPriors: { extraversion: 4, agreeableness: 4, conscientiousness: 8, dominance: 6, openness: 3 },
        appearanceOverrides: {
          heightBuild: ['short and barrel-chested', 'short, broad and heavy-set', 'stocky, dense with muscle'],
        },
        appearanceExtensions: {
          beardStyle: ['long braided beard', 'forked beard with rings', 'short cropped beard', 'elaborately knotted beard'],
        },
        voiceAccents: [
          { name: 'mountain-hall burr', signaturePhrases: ['by the deep stone', 'aye, well enough', 'mind the vein', 'steady now', 'worth its weight', 'hold fast'] },
        ],
      },
      orc: {
        displayName: 'Orc',
        enabled: true,
        weight: 2,
        genders: ['female', 'male'],
        namePool: {
          female: ['Gorza', 'Sharn', 'Ulka', 'Vresh', 'Karga', 'Zetha'],
          male: ['Marruk', 'Ghor', 'Krag', 'Uzek', 'Thok', 'Varg'],
        },
        surnames: ['Bloodfang', 'Ironhide', 'Skullsplitter', 'Ashmaw', 'Stonejaw', 'Redtusk'],
        ageRange: { min: 18, max: 55 },
        axisPriors: { extraversion: 6, agreeableness: 3, conscientiousness: 4, dominance: 8, openness: 4 },
        appearanceOverrides: {
          'skin.tone': ['moss green', 'grey-green', 'olive-drab', 'deep jade'],
        },
        appearanceExtensions: {
          tusks: ['small lower tusks', 'prominent lower tusks', 'one chipped tusk', 'capped tusks'],
        },
        voiceAccents: [
          { name: 'clipped war-camp cant', signaturePhrases: ['move', 'done', 'hold the line', 'no excuses', 'again', 'stand'] },
        ],
      },
      halfling: {
        displayName: 'Halfling',
        enabled: true,
        weight: 2,
        genders: ['female', 'male'],
        namePool: {
          female: ['Rosie', 'Marigold', 'Pearl', 'Tilly', 'Nora', 'Posy'],
          male: ['Milo', 'Alton', 'Corrin', 'Wendel', 'Perrin', 'Odo'],
        },
        surnames: ['Underhill', 'Goodbarrel', 'Tealeaf', 'Brushgather', 'Thorngage', 'Greenbottle'],
        ageRange: { min: 20, max: 100 },
        axisPriors: { extraversion: 6, agreeableness: 7, conscientiousness: 5, dominance: 2, openness: 4 },
        appearanceOverrides: {
          heightBuild: ['very short and round-cheeked', 'small and light-footed', 'tiny, plump and quick'],
        },
        appearanceExtensions: {},
        voiceAccents: [
          { name: 'warm hearthside drawl', signaturePhrases: ['bless you', 'sit a spell', 'eat something first', 'no need to fuss', "there's plenty", 'hush now'] },
        ],
      },
      gnome: {
        displayName: 'Gnome',
        enabled: true,
        weight: 1,
        genders: ['female', 'male'],
        namePool: {
          female: ['Nix', 'Ellywick', 'Tana', 'Zanna', 'Breena', 'Lorilla'],
          male: ['Fizwick', 'Boddynock', 'Dimble', 'Glim', 'Namfoodle', 'Zook'],
        },
        surnames: ['Sparkgear', 'Timbertink', 'Cogwhistle', 'Nimbleknob', 'Brassbolt', 'Fiddlefen'],
        ageRange: { min: 25, max: 200 },
        axisPriors: { extraversion: 5, agreeableness: 6, conscientiousness: 4, dominance: 3, openness: 9 },
        appearanceOverrides: {
          heightBuild: ['tiny and wiry', 'very small, quick-fingered', 'diminutive, always in motion'],
        },
        appearanceExtensions: {},
        voiceAccents: [
          { name: 'rapid workshop patter', signaturePhrases: ['quick quick', 'one more tweak', 'nearly there', 'hand me that', 'brilliant, brilliant', 'just a spark of it'] },
        ],
      },
      dragonborn: {
        displayName: 'Dragonborn',
        enabled: true,
        weight: 1,
        genders: ['female', 'male'],
        namePool: {
          female: ['Akra', 'Sora', 'Kava', 'Mishann', 'Nala', 'Perra'],
          male: ['Balasar', 'Kriv', 'Rhogar', 'Torinn', 'Medrash', 'Arjhan'],
        },
        surnames: ['Flamecrest', 'Emberscale', 'Stormwing', 'Ashborn', 'Cinderfang', 'Duskscale'],
        ageRange: { min: 18, max: 60 },
        axisPriors: { extraversion: 5, agreeableness: 4, conscientiousness: 6, dominance: 7, openness: 5 },
        appearanceOverrides: {
          'skin.texture': ['fine overlapping scales', 'coarse ridged scales', 'smooth polished scales'],
        },
        appearanceExtensions: {
          scaleColor: ['bronze', 'crimson', 'cobalt', 'jade', 'obsidian', 'gold'],
          hornStyle: ['swept-back horns', 'short curved horns', 'crowned ridge of horns'],
          tailShape: ['long tapering tail', 'thick blunt tail', 'short spined tail'],
        },
        voiceAccents: [
          { name: 'resonant clan-hall formality', signaturePhrases: ['by clan and creed', 'it is decided', 'honor demands it', 'so the elders taught', 'let it be known', 'with due respect'] },
        ],
      },
    },
  },
};

// buildSampleWorld — the canonical construction path, for BOTH a fresh world
// and a loaded save (pass { save } as returned by saveLoad.parseSave). The
// split of responsibilities on load:
//   - the SAVE supplies raw state: config + the event log, verbatim;
//   - CONSTRUCTION re-runs the static baseline exactly as on a fresh build —
//     hand-authored entities, registration, direct-set labels — because that
//     authoring is shipped-game data, like config, not logged history;
//   - each engine primes its cache from the log it finds at construction;
//   - the seed DISPATCHES are skipped — those events are already in the saved
//     log, and re-dispatching them would double history.
//
// CONFIG DRIFT: a save always replays under its OWN embedded config, never
// the currently-shipped WORLD_CONFIG — that is the entire point of embedding
// it (a future retune must not silently change what an old save replays
// into). If the two have drifted, that is still worth knowing about, so it is
// logged as a loud, non-fatal warning naming the differing top-level keys —
// never a load-time throw, which would brick every existing save the moment
// the shipped config changes at all.
export function buildSampleWorld({ save, config } = {}) {
  if (save) {
    const drift = diffConfigKeys(WORLD_CONFIG, save.config);
    if (drift.length > 0) {
      log(
        'SaveLoad',
        `WARNING: this save's config differs from the currently-shipped config in: ${drift.join(', ')}. ` +
          `Replaying under the SAVE's own config (as it must, for correct replay) — the shipped values are NOT applied.`
      );
    }
  }

  // Config precedence: a save replays under its OWN embedded config; a fresh run
  // started from a named preset uses that preset's config; otherwise the shipped
  // default. A preset only reshapes a NEW world — never an existing save.
  const effectiveConfig = save?.config ?? config ?? WORLD_CONFIG;
  const world = createWorldState(effectiveConfig, save?.eventLog ?? []);

  // The live race registry (settings surface). Constructed first — before any
  // dispatches — because its RACE_* subscriptions must not miss an edit event
  // (ORDER MATTERS, same as the relationship store below). Mira/Rowan/Sable
  // stay hand-authored with race 'human' — an ordinary registry entry, not a
  // special-cased default.
  const races = createRaceRegistry(world);

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
      voice: {
        accent: 'Vale Country drawl',
        directives: [
          'Talk like a barkeep who has heard every excuse — blunt and plainspoken.',
          'Stay warm underneath, even when your patience is running short.',
          'Keep it short and get to what someone actually needs.',
        ],
        phrases: ['reckon', 'no trouble at all', 'mind yourself', 'settle up', 'there now'],
      },
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

  // Character Creation delivers the player as effectiveConfig.playerCharacter
  // (carried IN the config so it is embedded in a save and re-applied identically
  // on load). It reskins the registered player slot in place — keeping the id
  // `player_rowan` so every seed that references it (starting gold, the Mira
  // relationship, combat/quest playerId) stays wired — while replacing the
  // authored identity/appearance/psychology/capabilities with the created ones.
  const pc = effectiveConfig.playerCharacter;
  if (pc) {
    if (pc.identity) rowan.identity = { ...rowan.identity, ...structuredClone(pc.identity) };
    if (pc.appearance) rowan.appearance = structuredClone(pc.appearance);
    if (pc.psychology) rowan.psychology = { ...structuredClone(pc.psychology), memories: rowan.psychology.memories ?? [] };
    if (pc.capabilities) rowan.capabilities = structuredClone(pc.capabilities);
    if (pc.playerData) rowan.playerData = { ...(rowan.playerData ?? {}), ...structuredClone(pc.playerData) };
  }

  const sable = createNpc({
    id: 'npc_sable', // proprietor of the Rusted Ledger, Mira's oldest friend and quietest grudge
    identity: {
      firstName: 'Sable',
      lastName: 'Voss',
      age: 35,
      birthday: '1023-11-02',
      gender: 'female',
      sexualOrientation: 'bisexual',
      race: 'human',
      ethnicity: 'Aldervale dockside',
      vocation: 'proprietor of the Rusted Ledger, a card-and-dice house',
      relationshipStatus: 'single',
      livingSituation: 'lives above the Rusted Ledger',
      background: 'Opened the Rusted Ledger the same year Mira opened the Broken Wheel, on half of a stake the two of them inherited together from the dockside quarter they grew up in.',
      biography: 'Sable and Mira grew up two doors apart in Aldervale\'s dockside quarter and split a small inheritance to start their businesses the same season. Three years in, during a bad stretch for Mira\'s tavern, Sable quietly moved half of the shared capital into the Ledger — legal, never discussed, and Mira learned of it from a bookkeeper rather than from Sable\'s own mouth. Sable has never said the word "sorry" about it out loud; instead she overpays her tab, over-helps, over-shows-up, in ways that read as unspoken penance. They still grab drinks most weeks. She is the only person left who remembers Mira from before anyone called her "the barkeep."',
    },
    appearance: {
      heightBuild: 'tall, narrow-shouldered, holds herself like she is always about to leave',
      hair: { color: 'black', style: 'sleek, pinned back', length: 'long', texture: 'straight' },
      eyes: { color: 'dark brown', shape: 'sharp, hooded' },
      face: { shape: 'angular', nose: 'straight', lips: 'thin, quick to smirk', jawline: 'sharp', facialHair: 'none' },
      skin: { tone: 'deep olive', texture: 'smooth, carefully kept' },
      body: { shape: 'lean', chest: 'small', butt: 'flat', legs: 'long' },
      distinguishingFeatures: ['ink stains on two fingers she never quite scrubs off', 'dresses noticeably better than her dockside upbringing would suggest'],
      intimate: [{ genitalType: 'vulva', shapeSize: 'petite', extraDetails: 'a small tattoo of a pair of dice on her hip' }],
    },
    psychology: {
      personalityTraits: ['sharp-tongued', 'quick with a joke', 'evasive about money', 'genuinely warm underneath it'],
      personalityAxes: { extraversion: 8, agreeableness: 5, conscientiousness: 6 },
      factionAlignmentAxes: { crownLoyalty: -4, guildSympathy: 3 },
      hobbies: ['cards', 'dice', 'counting other people\'s tells'],
      likes: ['a good bluff', 'Mira\'s company', 'expensive fabric'],
      dislikes: ['being asked about the books', 'silence at a card table', 'owing anyone anything'],
      voice: {
        accent: 'clipped Aldervale dockside patter, sanded smoother than it used to be',
        directives: [
          'Stay fast and funny — land a joke half a beat before anyone can pin you down.',
          'Volunteer plenty of words; fill a silence before it fills itself.',
          'Keep real warmth under the banter, even while you are deflecting.',
        ],
        phrases: ['no kidding', 'square deal', "don't test me", 'keep your coin', "deal's a deal"],
      },
      memories: [], // no farm engine here (unlike proof.js), so nothing points at a real event-log entry
      flags: {
        personality: ['deflects with humor'],
        condition: [],
        aiDirectives: [
          "When money, debts, or the Rusted Ledger's books come up, deflect with a joke rather than answering directly.",
        ],
      },
    },
    capabilities: {
      attributes: { strength: 8, agility: 11, toughness: 9, charisma: 16, intelligence: 13, insight: 14 },
      skills: {
        primary: {
          athletics: 1, acrobatics: 2, sleightOfHand: 7, stealth: 3, fortitude: 2,
          willpower: 5, deception: 8, intimidation: 3, performance: 6, persuasion: 7,
          magic: 0, investigation: 3, religion: 1, history: 2, perception: 6,
          survival: 1, medicine: 1,
          smithing: 0, alchemy: 1, enchanting: 1,
        },
        secondary: {
          riding: 1, dancing: 3, swimming: 1, cleaning: 2, disguise: 3,
          hands: 5, mouth: 3, breasts: 1, vagina: 2, anus: 1,
        },
      },
    },
    inventory: [],
    schedule: [
      { timeOfDay: 'morning', locationId: 'rusted_ledger', activity: 'squaring last night\'s books' },
      { timeOfDay: 'evening', locationId: 'rusted_ledger', activity: 'running the tables' },
      { timeOfDay: 'night', locationId: 'rusted_ledger_upstairs', activity: 'sleeping' },
    ],
  });

  const registry = createEntityRegistry(world);
  registry.register(mira);
  registry.register(rowan);
  registry.register(sable);

  // createRelationshipStore subscribes to RELATIONSHIP_EVENT in its constructor,
  // so it must be built BEFORE the seed dispatches below (and before any engine
  // that dispatches relationship events) or the cache would miss these events.
  const relationships = createRelationshipStore(world);

  // conversationHistory: pair-keyed verbatim dialogue log, built alongside
  // relationships for the same reason — it subscribes to DIALOGUE_LINE in its
  // constructor and must exist before any dispatch of that event.
  const conversationHistory = createConversationHistoryStore(world);

  // Seed the starting edges. Stats are log-derived, so the starting values are
  // dispatched as RELATIONSHIP_EVENTs (one per non-zero axis) — but ONLY on a
  // fresh world: a loaded save already carries those events in its log (the
  // relationship store just primed from them), and re-dispatching would double
  // every seed stat. The asymmetric fromCallsTo label is direct-set and NOT in
  // the log, so it is (re-)applied unconditionally, save or no save.
  function seedEdge(fromId, toId, stats, label) {
    relationships.setLabel(fromId, toId, label);
    if (save) return;
    for (const [axis, delta] of Object.entries(stats)) {
      if (delta !== 0) relationships.recordRelationshipEvent(fromId, toId, axis, delta);
    }
  }
  seedEdge(rowan.id, mira.id, { affection: 25, comfort: 20, trust: 15, desire: 10, obedience: 5 }, 'Mira');
  seedEdge(mira.id, rowan.id, { affection: 30, comfort: 25, trust: 20, desire: 10, obedience: 2 }, 'traveler');

  // Mira <-> Sable: old dockside friends with a real, unhealed betrayal over
  // money. Both directions land on the 'complicated' tier (high affection,
  // non-positive trust) but via deliberately different stat shapes — Mira's
  // trust wound runs much deeper than Sable's. This asymmetry is intentional,
  // not a bug: the two of them experienced the same history very differently.
  seedEdge(mira.id, sable.id, { affection: 60, comfort: 24, trust: -40, desire: 0, obedience: 0 }, 'Sable');
  seedEdge(sable.id, mira.id, { affection: 60, comfort: 20, trust: -10, desire: 0, obedience: 0 }, 'Mira');

  // Rowan's starting purse and pack (engines/economyEngine.js derives all
  // holdings from these events). Same save/load idiom as the seedEdge stat
  // dispatches: seeds are raw dispatches on a FRESH world only — a loaded
  // save already carries them in its log, and the economy engine (wired by
  // callers) primes from the log it finds. Materials are chosen so the
  // bs_smelt/bs1/al1/al2/en1 recipes are immediately craftable while bs2/en2
  // sit above Rowan's effective skills (live skill-gate demo). The instance
  // ids embed the entry's own seq (read immediately before the dispatch —
  // dispatch is synchronous, so nothing can interleave).
  if (!save) {
    world.dispatch('GOLD_GRANTED', { entityId: rowan.id, amount: 150, reason: 'seed' });
    const nextSeq = world.getEventLog().length;
    world.dispatch('ITEMS_GRANTED', {
      entityId: rowan.id,
      reason: 'seed',
      stacks: {
        iron_ore: 4, iron_ingot: 2, leather_strip: 2, silverleaf_herb: 3,
        spring_water: 2, glass_vial: 1, arcane_dust: 2, bread: 2,
      },
      instances: [
        { instanceId: `itm_${nextSeq}_0`, itemDefId: 'iron_dagger', properties: {} },
        { instanceId: `itm_${nextSeq}_1`, itemDefId: 'leather_jerkin', properties: {} },
        { instanceId: `itm_${nextSeq}_2`, itemDefId: 'copper_ring', properties: {} },
      ],
    });
  }

  return { world, registry, relationships, conversationHistory, races, mira, rowan, sable };
}
