// engines/npcGeneratorEngine.js — the NPC generator: race templates in the
// live raceRegistry -> full EntityBase instances, at population scale, keyed to
// the settlement/wilderness classification worldMapEngine already produces.
//
// This engine deliberately does NOT take the pure-baseline shape of the POI
// pool, because a roster depends on the CURRENT raceRegistry state (a live,
// player-adjustable settings surface) — re-deriving later under an edited
// registry would give different people. So generation is committed to the log
// instead: populateNode() derives a roster from (config, node, the registry
// snapshot AT THAT MOMENT), dispatches ONE NODE_POPULATED event carrying the
// full birth snapshots (the POI_INJECTED precedent: not derivable from
// position alone, so the payload carries them whole), and never re-derives for
// that node again. The frozen log entry is the permanent birth record; the
// live, mutable entities in entityRegistry are clones of it that diverge
// afterward by design (memories, etc.).
//
// Intentional non-determinism, stated plainly: two players on an identical
// world seed with different raceRegistry settings WILL get different
// populations — this is a designed exception to the position-determinism
// discipline, not a bug (see entities/raceRegistry.js). What IS still
// deterministic: within a FIXED registry state, the roster is a pure function
// of (config, node, enabledRaces) — same registry + same node + same seed =>
// same people (proof Section N1) — and registry edits are themselves logged
// events, so full-log replay reproduces every population exactly.
//
// Permanence (the POI-discovery discipline): a generated NPC's race /
// appearance / axes are historical fact. Toggling a race off in settings
// affects only nodes populated AFTER the edit; it never mutates, deletes, or
// rerolls anyone already committed. Re-invoking populateNode for a populated
// node is a no-op returning the committed instances.
//
// Scope: this pass produces generated instances and the registry mechanics
// ONLY. Schedules, dialogue/voice wiring, save/load hardening, and population
// UI are future scope — the same deferral discipline as every prior engine.

import { mulberry32 } from '../worldState.js';
import { hashCoords, mapSeed } from './worldMapEngine.js';
import { weightedPick } from './poiEngine.js';
import {
  createNpc,
  PRIMARY_SKILL_ATTRIBUTE,
  SECONDARY_SKILLS,
  ATTRIBUTE_NAMES,
} from '../entities/entitySchema.js';
import { PERSONALITY_AXES } from '../entities/raceRegistry.js';
import { deriveVoiceDirectives } from '../entities/voice.js';

export const NODE_POPULATED = 'NODE_POPULATED';

// Salt band for NPC draws: NPC_SALT + i (the roster index) seeds one fresh
// mulberry32 per NPC. Kept far above POI_EXPLORE_SALT (80000) plus any
// plausible attempt count, and distinct from every other salt in use
// (11, 29, 53, 71, 97, 777, 4001, 60000, 80000), so NPC randomness never
// correlates with terrain, settlement placement, or POI pools.
const NPC_SALT = 100000;

// readPopulation — guarded reader for the worldMap.population config
// sub-block, mirroring readPoi's up-front validation. Population SIZING is
// seed-locked generation config (it lives under worldMap); which races fill
// those slots is the live raceRegistry's business, not this block's.
function readPopulation(config) {
  const population = config?.worldMap?.population;
  if (!population) throw new Error('WorldConfig is missing worldMap.population');
  if (!population.settlement) throw new Error('WorldConfig is missing worldMap.population.settlement');
  if (!population.wilderness) throw new Error('WorldConfig is missing worldMap.population.wilderness');
  return population;
}

// Same 1e3 coordinate quantization as poiEngine's nodeKeys, so a node's NPC
// draws are pinned to its exact coordinate.
function nodeKeys(node) {
  return { kx: Math.round(node.x * 1000), ky: Math.round(node.y * 1000) };
}

// --- Base content pools -------------------------------------------------------
//
// The shared value pools every race draws from by default. These are code
// constants, NOT config: per-race variation lives entirely in registry data
// (appearanceOverrides swap a pool per dot-path, appearanceExtensions add
// race-specific fields), so a player-added race can fully define itself at the
// settings level without touching code. Keys of BASE_APPEARANCE_POOLS are the
// same dot-paths appearanceOverrides uses.

const BASE_APPEARANCE_POOLS = Object.freeze({
  heightBuild: ['short and slight', 'average height, lean build', 'average height, sturdy build', 'tall and broad-shouldered', 'tall and lean', 'compact and muscular'],
  'hair.color': ['black', 'dark brown', 'chestnut', 'auburn', 'sandy blond', 'ash grey', 'copper red'],
  'hair.style': ['loose', 'braided', 'tied back', 'cropped close', 'pinned up', 'wind-tangled'],
  'hair.length': ['cropped', 'short', 'shoulder-length', 'long'],
  'hair.texture': ['straight', 'wavy', 'curly', 'coarse'],
  'eyes.color': ['brown', 'hazel', 'green', 'grey', 'blue', 'amber'],
  'eyes.shape': ['almond', 'round', 'hooded', 'narrow', 'deep-set'],
  'face.shape': ['oval', 'round', 'angular', 'square', 'heart-shaped'],
  'face.nose': ['straight', 'aquiline', 'broad', 'upturned', 'crooked from an old break'],
  'face.lips': ['full', 'thin', 'wide', 'bow-shaped'],
  'face.jawline': ['soft', 'sharp', 'square', 'tapered'],
  'face.facialHair': ['none', 'light stubble', 'short beard', 'full beard', 'moustache'],
  'skin.tone': ['fair', 'olive', 'tan', 'deep brown', 'ruddy', 'weathered bronze'],
  'skin.texture': ['smooth', 'weathered', 'freckled', 'scarred in places', 'sun-lined'],
  'body.shape': ['lean', 'athletic', 'stocky', 'soft', 'hourglass', 'wiry'],
  'body.chest': ['flat', 'lean', 'average', 'broad', 'full'],
  'body.butt': ['flat', 'average', 'round', 'muscular'],
  'body.legs': ['short', 'long', 'muscular', 'slender'],
});

// The fixed appearance draw order — Appearance schema order. Part of the
// determinism contract: reordering this list would reroll every future NPC's
// look (already-committed NPCs are birth snapshots and cannot be touched).
const APPEARANCE_FIELD_ORDER = Object.freeze(Object.keys(BASE_APPEARANCE_POOLS));

const DISTINGUISHING_FEATURES = Object.freeze(['a thin scar across one eyebrow', 'a missing half-finger on the left hand', 'a tattoo of a local charm on the wrist', 'ink-stained fingertips', 'a chipped front tooth', 'a burn scar on one forearm', 'a birthmark at the collarbone', 'ears pierced with simple studs']);
const VOCATIONS_SETTLEMENT = Object.freeze(['farmer', 'baker', 'blacksmith', 'carpenter', 'fisher', 'weaver', 'merchant', 'guard', 'hunter', 'herbalist', 'laborer', 'stablehand', 'seamstress', 'scribe', 'potter', 'butcher']);
const VOCATIONS_WILDERNESS = Object.freeze(['hermit', 'trapper', 'forager', 'prospector', 'poacher', 'wandering pilgrim', 'camp cook', 'outlaw']);
const RELATIONSHIP_STATUSES = Object.freeze(['single', 'single', 'married', 'widowed', 'courting']); // single repeated = cheap weighting
const LIVING_SITUATIONS_SETTLEMENT = Object.freeze(['lives alone in a small home', 'lives with family', 'rents a room above the workplace', 'lives at the edge of the settlement', 'shares a crowded boarding house']);
const LIVING_SITUATIONS_WILDERNESS = Object.freeze(['camps rough, moving with the seasons', 'keeps a lone cabin off the trails', 'shelters in a cave dug into the hillside', 'lives out of a wagon']);
const SEXUAL_ORIENTATIONS = Object.freeze([
  { name: 'heterosexual', weight: 6 },
  { name: 'bisexual', weight: 2 },
  { name: 'homosexual', weight: 1 },
  { name: 'asexual', weight: 1 },
]);
const PERSONALITY_TRAITS = Object.freeze(['warm', 'guarded', 'curious', 'blunt', 'patient', 'quick-tempered', 'superstitious', 'pragmatic', 'dryly humorous', 'earnest', 'stubborn', 'easygoing']);
const HOBBIES = Object.freeze(['whittling', 'card games', 'dice', 'fishing', 'gossip', 'singing', 'gardening', 'collecting odd stones', 'mending', 'charcoal sketches']);
const LIKES = Object.freeze(['a warm meal', 'fair trade', 'quiet mornings', 'a good story', 'strong drink', 'festival days', 'honest work', 'rainy evenings']);
const DISLIKES = Object.freeze(['cheats', 'crowds', 'being lied to', 'cold winters', 'debt', 'pushy strangers', 'spoiled food', 'idle hands']);
const BASE_VOICE_ACCENTS = Object.freeze(['plain regional burr', 'soft rural drawl', 'clipped trade-road cadence']);
// speechPattern / voice-tag pools are gone: voice directives now derive from
// personality axes (entities/voice.js), not from independent flavor rolls.
const INTIMATE_GENITAL_BY_GENDER = Object.freeze({ female: 'vulva', male: 'penis' });
const INTIMATE_SHAPE_SIZES = Object.freeze(['petite', 'average', 'generous']);

// --- Draw helpers (all consume the one per-NPC rng stream) --------------------

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function pickInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Two entries, distinct when the pool allows it. The nudge-to-next-index on a
// collision is deterministic (no rejection loop of unbounded draw count).
function pickTwo(rng, arr) {
  const a = Math.floor(rng() * arr.length);
  let b = Math.floor(rng() * arr.length);
  if (arr.length > 1 && b === a) b = (b + 1) % arr.length;
  return [arr[a], arr[b]];
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

// derivePopulationSize — how many NPCs a node's classification yields.
// Settlement: the flat per-tier lookup (populationByTier — poolSizeByTier's
// exact shape). Wilderness: the notability/hospitability formula from
// poiEngine's poolSizeFor, clamped to [0, maxPopulation] — with the shipped
// base of -1, ordinary wilderness legitimately yields 0 people.
export function derivePopulationSize(config, classification) {
  const population = readPopulation(config);
  if (classification.kind === 'settlement') {
    return population.settlement.populationByTier[classification.tier] ?? 0;
  }
  const w = population.wilderness;
  const raw =
    w.base +
    (classification.notability ?? 0) * w.notabilityPopScale +
    (classification.hospitability ?? 0) * w.hospitabilityPopScale;
  return Math.max(0, Math.min(w.maxPopulation, Math.round(raw)));
}

// deriveNpc — ONE full EntityBase NPC: roster index i at a node, drawn from a
// fresh mulberry32 seeded by (mapSeed, NPC_SALT + i, kx, ky). PURE in
// (config, node, enabledRaces, i): it reads NOTHING with a clock or visit
// history in it. In particular, age is a uniform draw from the race's
// ageRange and birthday is a pure month/day roll with the year taken verbatim
// from config.startDateTime (a frozen config constant, matching the
// hand-authored convention — Mira's '1024-04-12' against start '1024-03-01')
// — never the world clock's current date, so WHEN populateNode is called can
// never change who is generated.
//
// The draw ORDER below is part of the determinism contract: inserting,
// removing, or reordering draws rerolls every future NPC. Committed NPCs are
// untouched either way (they live as birth snapshots in the log), but keep
// the order stable unless a reroll of future generation is intended.
export function deriveNpc(config, node, enabledRaces, i) {
  const seed = mapSeed(config);
  const { kx, ky } = nodeKeys(node);
  const rng = mulberry32(hashCoords(seed, NPC_SALT + i, kx, ky));
  const kind = node.classification.kind;

  // 1. race — weightedPick over the (sorted-by-id) enabled races.
  const raceId = weightedPick(enabledRaces.map((r) => ({ name: r.id, weight: r.weight })), rng());
  const race = enabledRaces.find((r) => r.id === raceId);

  // 2-3. gender, names.
  const gender = pick(rng, race.genders);
  const firstName = pick(rng, race.namePool[gender]);
  const lastName = race.surnames.length > 0 ? pick(rng, race.surnames) : '';

  // 4. age + birthday (see the purity note in the function comment).
  const age = pickInt(rng, race.ageRange.min, race.ageRange.max);
  const startYear = config.startDateTime.slice(0, 4);
  const birthday = `${startYear}-${pad2(pickInt(rng, 1, 12))}-${pad2(pickInt(rng, 1, 28))}`;

  // 5-7. orientation, vocation, household.
  const sexualOrientation = weightedPick(SEXUAL_ORIENTATIONS, rng());
  const vocation = pick(rng, kind === 'settlement' ? VOCATIONS_SETTLEMENT : VOCATIONS_WILDERNESS);
  const relationshipStatus = pick(rng, RELATIONSHIP_STATUSES);
  const livingSituation = pick(rng, kind === 'settlement' ? LIVING_SITUATIONS_SETTLEMENT : LIVING_SITUATIONS_WILDERNESS);

  // 8. appearance — one draw per base field in fixed schema order; each
  // field's pool is the race's override for that dot-path, else the base pool.
  // Females skip the facialHair draw ('none', no stream consumption) — a
  // deterministic branch since gender was drawn above on this same stream.
  const appearance = {
    heightBuild: '',
    hair: { color: '', style: '', length: '', texture: '' },
    eyes: { color: '', shape: '' },
    face: { shape: '', nose: '', lips: '', jawline: '', facialHair: '' },
    skin: { tone: '', texture: '' },
    body: { shape: '', chest: '', butt: '', legs: '' },
    distinguishingFeatures: [],
    intimate: [],
  };
  for (const path of APPEARANCE_FIELD_ORDER) {
    if (path === 'face.facialHair' && gender === 'female') {
      appearance.face.facialHair = 'none';
      continue;
    }
    const pool = race.appearanceOverrides[path] ?? BASE_APPEARANCE_POOLS[path];
    const value = pick(rng, pool);
    const [head, tail] = path.split('.');
    if (tail === undefined) appearance[head] = value;
    else appearance[head][tail] = value;
  }

  // 9. race extension fields — merged ADDITIVELY onto appearance, one draw per
  // key in sorted key order. A race with no extensions (e.g. human) merges
  // nothing; there is no special-cased base race.
  for (const field of Object.keys(race.appearanceExtensions).sort()) {
    appearance[field] = pick(rng, race.appearanceExtensions[field]);
  }

  // 10. distinguishing features (0-2) + intimate set.
  const featureCount = pickInt(rng, 0, 2);
  if (featureCount === 1) appearance.distinguishingFeatures = [pick(rng, DISTINGUISHING_FEATURES)];
  if (featureCount === 2) appearance.distinguishingFeatures = pickTwo(rng, DISTINGUISHING_FEATURES);
  appearance.intimate = [
    {
      genitalType: INTIMATE_GENITAL_BY_GENDER[gender] ?? 'unspecified',
      shapeSize: pick(rng, INTIMATE_SHAPE_SIZES),
      extraDetails: '',
    },
  ];

  // 11. personality axes — race prior +/- jitter of 2, clamped to [0, 10]
  // integers, iterated in PERSONALITY_AXES (sorted) order. A missing prior
  // defaults to the neutral center 5.
  const personalityAxes = {};
  for (const axis of PERSONALITY_AXES) {
    const prior = race.axisPriors[axis] ?? 5;
    personalityAxes[axis] = Math.max(0, Math.min(10, Math.round(prior + (rng() * 2 - 1) * 2)));
  }

  // 12-13. traits, capabilities — modest, vocation-agnostic rolls (attribute
  // 8-15 matching the hand-authored range; skills are shallow investments).
  const personalityTraits = pickTwo(rng, PERSONALITY_TRAITS);
  const attributes = {};
  for (const attr of ATTRIBUTE_NAMES) attributes[attr] = 8 + Math.floor(rng() * 8);
  const primary = {};
  for (const skill of Object.keys(PRIMARY_SKILL_ATTRIBUTE)) primary[skill] = Math.floor(rng() * 5);
  const secondary = {};
  for (const skill of SECONDARY_SKILLS) secondary[skill] = Math.floor(rng() * 3);

  // 14. flavor — hobbies/likes/dislikes and voice. Accent stays a permanent
  // independent roll (a cultural/racial trait). Voice DIRECTIVES, by contrast,
  // are DERIVED from this NPC's already-drawn personalityAxes (step 11) via
  // deriveVoiceDirectives — consuming ZERO rng — so voice finally reflects
  // personality (the FUOC intent). Removing the old independent speechPattern
  // and voice-tag draws that used to sit here shifts no other field's draw:
  // they were the LAST draws in deriveNpc, so every earlier field stays
  // byte-identical; only voice's shape changes.
  const hobbies = pickTwo(rng, HOBBIES);
  const likes = pickTwo(rng, LIKES);
  const dislikes = pickTwo(rng, DISLIKES);
  const accent = pick(rng, race.voiceAccents ?? BASE_VOICE_ACCENTS);
  const voiceDirectives = deriveVoiceDirectives(personalityAxes);

  const place = kind === 'settlement' ? node.classification.settlementId : 'the wilds';
  return createNpc({
    id: `npc_${node.id}_g${i}`,
    identity: {
      firstName,
      lastName,
      age,
      birthday,
      gender,
      sexualOrientation,
      race: raceId,
      ethnicity: `${race.displayName} stock of ${place}`,
      vocation,
      relationshipStatus,
      livingSituation,
      // Minimal templated stubs — richer generated backstory is future scope,
      // the same content deferral as POI data:{}.
      background: `A ${race.displayName.toLowerCase()} ${vocation} making a living in ${place}.`,
      biography: `${firstName} has made a modest life as a ${vocation}, one face among many around ${node.id}.`,
    },
    appearance,
    psychology: {
      personalityTraits,
      personalityAxes,
      factionAlignmentAxes: {}, // out of scope this pass
      hobbies,
      likes,
      dislikes,
      voice: { accent, directives: voiceDirectives },
      memories: [],
      flags: { personality: [], condition: [], aiDirectives: [] },
    },
    capabilities: { attributes, skills: { primary, secondary } },
    inventory: [],
    schedule: [], // schedules are future scope
  });
}

// deriveNpcRoster — the full roster for a node. PURE in
// (config, node, enabledRaces): the registry snapshot is an ARGUMENT, which is
// exactly what makes fixed-registry determinism provable (same snapshot in =>
// same roster out) while remaining intentionally sensitive to registry edits
// (a different snapshot in => a different roster out, by design).
export function deriveNpcRoster(config, node, enabledRaces) {
  const size = derivePopulationSize(config, node.classification);
  if (size <= 0 || enabledRaces.length === 0) return [];
  const roster = [];
  for (let i = 0; i < size; i++) roster.push(deriveNpc(config, node, enabledRaces, i));
  return roster;
}

// deriveNodePopulation — PURE log replay: a node's committed birth snapshots,
// from its first NODE_POPULATED entry ([] if it was never populated).
// populateNode guards against a second dispatch, so first-wins is exact.
export function deriveNodePopulation(log, nodeId) {
  for (const entry of log) {
    if (entry.type !== NODE_POPULATED) continue;
    if (entry.payload.nodeId !== nodeId) continue;
    return entry.payload.npcs;
  }
  return [];
}

// createNpcGeneratorEngine — the stateful engine. Extends memoryEngine's
// (world, registry) factory precedent with the raceRegistry store as the third
// collaborator: `races.getEnabledRaces()` at generation time is the ONE
// sanctioned coupling point to the live settings surface.
export function createNpcGeneratorEngine(world, registry, races) {
  const { config } = world.getState();
  readPopulation(config); // validate up front

  // Redundant accelerator cache: nodeId -> the committed roster's npc ids, in
  // birth order. Fully rebuildable from the log (rebuildNodePopulation); it is
  // also the no-op guard that makes a committed roster permanent.
  const populatedByNode = new Map();

  // ORDER MATTERS, exactly as with the relationship store and POI engine:
  // register before any NODE_POPULATED is dispatched. Registering the live
  // entities happens HERE (not in populateNode) so a replayed/injected
  // NODE_POPULATED behaves identically to a locally-generated one. The
  // structuredClone is load-bearing: dispatch deep-freezes the log entry (the
  // permanent birth record), while the registered entity must stay mutable —
  // memoryEngine pushes memories onto it. Live entity = mutable clone of the
  // frozen snapshot; they diverge after birth by design.
  world.subscribe(NODE_POPULATED, (entry) => {
    const { nodeId, npcs } = entry.payload;
    populatedByNode.set(nodeId, npcs.map((n) => n.id));
    for (const snapshot of npcs) registry.register(structuredClone(snapshot));
  });

  // populateNode — LAZY, the POI lazy-on-explore pattern: the game layer calls
  // this the first time it actually needs a node's people; merely passing
  // through a node materializes nobody. First call: derive from the CURRENT
  // registry state, commit ONE NODE_POPULATED (even for an empty roster — the
  // emptiness is itself a committed fact, so a barren node stays barren no
  // matter what races are enabled later), return the live entities. Every
  // later call: a no-op that returns the committed instances — never a reroll,
  // never a registry re-read.
  function populateNode(node) {
    if (populatedByNode.has(node.id)) return getPopulation(node);
    const roster = deriveNpcRoster(config, node, races.getEnabledRaces());
    world.dispatch(NODE_POPULATED, { nodeId: node.id, npcs: roster });
    return getPopulation(node);
  }

  // getPopulation — read-only: the LIVE (possibly post-birth-mutated) entities
  // for a node, [] if it was never populated. Never generates.
  function getPopulation(node) {
    const ids = populatedByNode.get(node.id);
    if (!ids) return [];
    return ids.map((id) => registry.get(id));
  }

  function isPopulated(node) {
    return populatedByNode.has(node.id);
  }

  // rosterIdsAt — read-only: the ids of the NPCs committed at a node, [] if it
  // was never populated. Exposes the existing populatedByNode cache (no new
  // stored state) so the memory engine can answer "who else is here" for
  // witness fan-out. This is the codebase's only current location signal — the
  // node an NPC was generated at — and is the honest STAND-IN for real
  // presence/schedule tracking, which does not exist yet.
  function rosterIdsAt(nodeId) {
    return populatedByNode.get(nodeId) ?? [];
  }

  // rebuildNodePopulation — the node's birth snapshots recomputed from the log
  // alone, ignoring the cache. Matching ids against the cache is the
  // rebuildability proof. Deliberately proves birth snapshots, NOT live entity
  // state: entities mutate after birth via the sanctioned entityRegistry path,
  // and that divergence is by design.
  function rebuildNodePopulation(nodeId) {
    return deriveNodePopulation(world.getEventLog(), nodeId);
  }

  return { populateNode, getPopulation, isPopulated, rosterIdsAt, rebuildNodePopulation };
}
