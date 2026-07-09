// engines/worldMapEngine.js — procedural generation of the physical world as a
// graph of location nodes at organic continuous (x, y) coordinates, connected
// by edges along 8 compass headings, with coherent terrain, materialized lazily
// as the player explores.
//
// WHAT IS PURE vs WHAT IS HISTORY: terrain and classification are PURE
// FUNCTIONS of (seed, coordinates), not a history of dispatched events —
// there is nothing to replay for them, so those derivations mirror
// deriveCalendarDate (config-in / value-out, stateless math), NOT
// deriveRelationshipStats. The node/classification caches below are
// performance optimizations over the pure derivation — never a second source
// of truth. Clearing them and regenerating at the same coordinates yields
// identical results (see rebuildNodeAt / rebuildClassificationAt), the same
// standing as rebuildRelationshipStats / rebuildTotalGameSeconds.
//
// THE ONE PIECE OF HISTORY: the EXPLORED GRAPH. Which nodes have had their
// neighbors materialized — and therefore which edges exist — depends on the
// ORDER exploration happened in (edge wiring reconciles each candidate against
// whatever was already materialized; see materializeNeighbors). Order is
// player history, and player history lives in the log: each first-time
// materialization is committed as a MAP_NEIGHBORS_MATERIALIZED event, and
// construction primes by replaying those events in log order — which provably
// reproduces the identical graph, because the fold's only mutable input is the
// node cache itself, evolving identically from the same deterministic origin.
// That is what lets the explored world survive save/load.
//
// THE LOAD-BEARING GUARANTEE: determinism by POSITION, not by exploration order.
// deriveTerrainAt(config, x, y) depends only on (seed, x, y), so which neighbor
// the player approached from, how many nodes were materialized first, or the
// order things were explored in can never change the terrain at a coordinate.
// That is what makes lazy generation provably equivalent to eager generation.
//
// DELIBERATELY DEFERRED (separate future tasks — not even stubbed here): travel-
// time calculation, travel events (bandits/weather/encounters), combat, dialogue
// during travel, node/location naming, discovery/fog-of-war tracking, and any
// map-tab UI.

import { mulberry32 } from '../worldState.js';

// The 8 compass headings as fixed base bearings in standard math degrees
// (0° = East / +x, counter-clockwise positive, +y = North). Index order is
// stable so candidate generation and heading lookups agree.
const DIRECTIONS = [
  { name: 'E', deg: 0 },
  { name: 'NE', deg: 45 },
  { name: 'N', deg: 90 },
  { name: 'NW', deg: 135 },
  { name: 'W', deg: 180 },
  { name: 'SW', deg: 225 },
  { name: 'S', deg: 270 },
  { name: 'SE', deg: 315 },
];

// Noise channels — folded into the lattice hash so elevation and moisture are
// independent coherent fields drawn from the same reused RNG.
const CHANNEL_ELEVATION = 11;
const CHANNEL_MOISTURE = 29;
// Salt base for per-node candidate jitter, kept well clear of the noise
// channels so jitter randomness never correlates with terrain.
const CANDIDATE_SALT = 777;
// Falloff pressure: how far the passable elevation band is squeezed per unit of
// distance-falloff. Tuned so terrain near the origin is essentially unbiased and
// the band collapses toward the center at extreme distance.
const FALLOFF_BAND = 0.2;

// --- Classification channels/salts (node-classification layer) --------------
// All distinct from the terrain channels (11, 29) and the candidate salt (777)
// so classification randomness never correlates with terrain or node jitter.
// SETTLEMENT_SITE_SALT seeds the per-cell jittered settlement-site position;
// CHANNEL_TIER / CHANNEL_NOTABILITY / CHANNEL_FACTION_TERRITORY are independent
// coherent fbm fields for tier rolls, environmental notability, and the coarse
// faction-territory partition respectively.
const SETTLEMENT_SITE_SALT = 4001;
const CHANNEL_TIER = 53;
const CHANNEL_NOTABILITY = 71;
const CHANNEL_FACTION_TERRITORY = 97;

// The settlement tier ladder, ascending. Index doubles as the base priority
// rank (capital outranks city outranks town ...), and the names are the labels
// a node's classification carries. Population/density is a separate future task;
// this pass only assigns the label. Exported so downstream layers (the POI
// engine's tier-gated category tables) reuse this one ladder rather than
// redefining it.
export const SETTLEMENT_TIERS = ['hamlet', 'village', 'town', 'city', 'capital'];

const DEG2RAD = Math.PI / 180;

function readWorldMap(config) {
  const wm = config?.worldMap;
  if (!wm) throw new Error('WorldConfig is missing worldMap');
  if (!wm.terrain) throw new Error('WorldConfig is missing worldMap.terrain');
  return wm;
}

// The classification sub-block (settlements / faction / environment). Kept as a
// separate guarded reader so callers that only touch terrain never pay for it,
// mirroring readWorldMap's up-front validation.
function readClassification(config) {
  const wm = readWorldMap(config);
  const c = wm.classification;
  if (!c) throw new Error('WorldConfig is missing worldMap.classification');
  if (!c.settlement) throw new Error('WorldConfig is missing worldMap.classification.settlement');
  if (!c.faction) throw new Error('WorldConfig is missing worldMap.classification.faction');
  if (!c.environment) throw new Error('WorldConfig is missing worldMap.classification.environment');
  return c;
}

// The map seed: an explicit worldMap.seed when set, else the main world seed —
// matching the existing convention that rngSeed IS the world seed. Exported so
// the POI engine pins its baseline pool to the SAME world seed the terrain and
// classification layers use, not a parallel seed source.
export function mapSeed(config) {
  const wm = readWorldMap(config);
  return (wm.seed ?? config.rngSeed) | 0;
}

// hashCoords — mix (seed, salt, integer lattice coords) into a 32-bit unsigned
// int, deterministically and for negative coordinates too. This is only the
// SEED for a fresh mulberry32 draw; the reused kernel PRNG does the actual
// value production, so there is no second RNG algorithm here. Exported so the
// POI engine seeds its own per-node lattice draws through this same primitive
// rather than introducing a parallel hash.
export function hashCoords(seed, salt, ix, iy) {
  let h = (seed | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (salt | 0), 0x85ebca6b);
  h = Math.imul(h ^ (ix | 0), 0xc2b2ae35);
  h = Math.imul(h ^ (iy | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

// A single seeded pseudorandom value in [0, 1) pinned to a lattice point.
function latticeValue(seed, salt, ix, iy) {
  return mulberry32(hashCoords(seed, salt, ix, iy))();
}

// Perlin smootherstep fade for smooth (coherent) transitions between lattice
// points — this is what stops the field from looking like independent noise.
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// valueNoise2D — one octave of coherent value noise: seeded lattice values
// bilinearly interpolated with a smootherstep fade. Returns [0, 1).
function valueNoise2D(seed, salt, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xf = x - x0;
  const yf = y - y0;
  const u = fade(xf);
  const v = fade(yf);

  const n00 = latticeValue(seed, salt, x0, y0);
  const n10 = latticeValue(seed, salt, x0 + 1, y0);
  const n01 = latticeValue(seed, salt, x0, y0 + 1);
  const n11 = latticeValue(seed, salt, x0 + 1, y0 + 1);

  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

// fbm — fractional Brownian motion: sum several octaves of value noise at
// doubling frequency and halving amplitude for richer-but-still-coherent
// topography. Each octave gets a distinct salt so octaves are uncorrelated.
// Normalized back into [0, 1).
function fbm(seed, channel, x, y, noiseScale, octaves) {
  let total = 0;
  let amp = 1;
  let freq = 1 / noiseScale;
  let ampSum = 0;
  for (let o = 0; o < octaves; o++) {
    const salt = channel * 131 + o;
    total += amp * valueNoise2D(seed, salt, x * freq, y * freq);
    ampSum += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / ampSum;
}

// deriveTerrainAt — PURE. Terrain at a coordinate is a function of (seed, x, y)
// alone. Returns { elevation, moisture, terrainType, passable }.
//
// Elevation and moisture are two independent coherent fields. Terrain type and
// passability are a pure derived function of those two values against the
// config thresholds, biased by distance-from-origin falloff.
//
// FALLOFF (worldSize as a soft parameter, never a hard cap): the passable
// elevation band is squeezed toward its center as distance from the origin
// grows, at a rate inversely proportional to worldSize. Bigger worldSize ⇒
// slower squeeze ⇒ larger reliably-passable region; smaller worldSize ⇒ tighter,
// cozier region. Nodes are ALWAYS generated regardless of distance — extreme
// distance just makes terrain reliably impassable, it never refuses generation.
export function deriveTerrainAt(config, x, y) {
  const wm = readWorldMap(config);
  const t = wm.terrain;
  const seed = mapSeed(config);

  const elevation = fbm(seed, CHANNEL_ELEVATION, x, y, t.noiseScale, t.octaves);
  const moisture = fbm(seed, CHANNEL_MOISTURE, x, y, t.noiseScale, t.octaves);

  // Distance-from-origin falloff. shift grows with distance and shrinks with
  // worldSize, so it is strictly monotonic in worldSize at a fixed radius.
  const distance = Math.hypot(x, y);
  const falloff = distance / (wm.worldSize * t.falloffScale);
  const shift = falloff * FALLOFF_BAND;

  // Effective thresholds. Raise the water levels, lower the cliff level. If the
  // passable middle band collapses, clamp everything to its center so extreme
  // distance reads as consistently hostile (impassable) terrain — the intended
  // soft edge of the world.
  const center = (t.waterLevel + t.cliffLevel) / 2;
  let effDeepWater = t.deepWaterLevel + shift;
  let effWater = t.waterLevel + shift;
  let effCliff = t.cliffLevel - shift;
  if (effWater > effCliff) {
    effWater = center;
    effCliff = center;
  }
  if (effDeepWater > effWater) effDeepWater = effWater;

  // Terrain ladder (documented decision from the config shape):
  //   below deep-water level     → deep_water   (impassable)
  //   below water level          → shore        (passable)
  //   above cliff level          → cliff        (impassable)
  //   otherwise, by moisture:
  //     very wet                 → dense_forest (impassable thicket)
  //     wet                      → forest       (passable)
  //     high (but not cliff)     → hills        (passable)
  //     else                     → plains       (passable)
  let terrainType;
  let passable;
  if (elevation < effDeepWater) {
    terrainType = 'deep_water';
    passable = false;
  } else if (elevation < effWater) {
    terrainType = 'shore';
    passable = true;
  } else if (elevation > effCliff) {
    terrainType = 'cliff';
    passable = false;
  } else if (moisture > t.denseForestMoisture) {
    terrainType = 'dense_forest';
    passable = false;
  } else if (moisture > t.forestMoisture) {
    terrainType = 'forest';
    passable = true;
  } else if (elevation > t.hillsLevel) {
    terrainType = 'hills';
    passable = true;
  } else {
    terrainType = 'plains';
    passable = true;
  }

  return { elevation, moisture, terrainType, passable };
}

// =============================================================================
// NODE CLASSIFICATION LAYER — PURE derived values over (config, coords) plus the
// already-derived terrain, following the exact discipline deriveTerrainAt set:
// determinism by POSITION, never by exploration order. There is still nothing to
// replay here (settlements/notability/hospitability are pure), so the shape
// mirrors deriveTerrainAt — NOT deriveRelationshipStats. The ONE exception is
// faction control, which layers log-event overrides on top of the pure baseline
// derived here; that lives in engines/factionEngine.js.
// =============================================================================

// deriveHospitability — PURE. A [0,1] "how livable is this coordinate" scalar,
// derived from the already-derived terrain. High for passable, moderate-
// elevation, near-water, pastoral terrain; low for cliffs, deep water, and dense
// forest. This SINGLE scalar is reused two ways: it gates settlement placement
// (the suitability test) and it flavors wilderness nodes (benign/pastoral vs.
// hostile/dangerous). "Near water" is a bounded, pure probe of a ring of nearby
// coordinates — coherent, not an independent per-node roll.
const HOSPITABILITY_TYPE_BASE = {
  plains: 0.75,
  shore: 0.7,
  forest: 0.55,
  hills: 0.5,
  dense_forest: 0.25,
  cliff: 0.1,
  deep_water: 0.05,
};
const HOSPITABILITY_PROBES = 8;
export function deriveHospitability(config, x, y) {
  const wm = readWorldMap(config);
  const t = wm.terrain;
  const own = deriveTerrainAt(config, x, y);

  // Base livability by terrain type.
  let base = HOSPITABILITY_TYPE_BASE[own.terrainType] ?? 0.3;

  // Moderate-elevation bonus: closeness to the center of the passable band
  // (between water and cliff) reads as most livable.
  const bandCenter = (t.waterLevel + t.cliffLevel) / 2;
  const bandHalf = (t.cliffLevel - t.waterLevel) / 2 || 1;
  const elevCloseness = 1 - Math.min(1, Math.abs(own.elevation - bandCenter) / bandHalf);

  // Near-water bonus: probe a ring ~one inter-node hop out and reward proximity
  // to shore/deep_water. Bounded and pure — a coherent measure, not a dice roll.
  const probeR = wm.baseInterNodeDistance;
  let waterHits = 0;
  for (let i = 0; i < HOSPITABILITY_PROBES; i++) {
    const a = (i / HOSPITABILITY_PROBES) * Math.PI * 2;
    const tt = deriveTerrainAt(config, x + probeR * Math.cos(a), y + probeR * Math.sin(a)).terrainType;
    if (tt === 'shore' || tt === 'deep_water') waterHits++;
  }
  const nearWater = waterHits / HOSPITABILITY_PROBES;

  const score = 0.55 * base + 0.25 * elevCloseness + 0.2 * nearWater;
  return Math.max(0, Math.min(1, score));
}

// deriveNotability — PURE. A [0,1] rarity-weighted scalar for non-settlement
// nodes: mostly ordinary, occasionally a remarkable landmark. Coherent fbm noise
// pushed through a rarity curve (exponent > 1) so high values are sparse — it
// feels rare/clustered, NOT an evenly-distributed per-node roll. Only the value
// is produced here; what a high value unlocks is the future POI engine's job.
export function deriveNotability(config, x, y) {
  const wm = readWorldMap(config);
  const env = readClassification(config).environment;
  const base = fbm(mapSeed(config), CHANNEL_NOTABILITY, x, y, env.notabilityNoiseScale, wm.terrain.octaves);
  return Math.pow(base, env.notabilityRarityExponent);
}

// deriveBaselineFactionControl — PURE. The DEFAULT controlling faction at a
// coordinate: a coarse coherent territory field quantized into `factionCount`
// opaque placeholder ids, with a frontier band below `uncontrolledThreshold`
// that returns null (uncontrolled). This is only the baseline; it can be
// overridden going forward by FACTION_CONTROL_CHANGED log events replayed in
// engines/factionEngine.js (derived baseline + log override, never a mutable
// field). Real faction rosters/lore are future scope — ids are opaque strings.
export function deriveBaselineFactionControl(config, x, y) {
  const wm = readWorldMap(config);
  const f = readClassification(config).faction;
  const territory = fbm(mapSeed(config), CHANNEL_FACTION_TERRITORY, x, y, f.territoryNoiseScale, wm.terrain.octaves);
  if (territory < f.uncontrolledThreshold) return null;
  const span = 1 - f.uncontrolledThreshold || 1;
  let idx = Math.floor(((territory - f.uncontrolledThreshold) / span) * f.factionCount);
  if (idx >= f.factionCount) idx = f.factionCount - 1;
  if (idx < 0) idx = 0;
  return `faction_${idx}`;
}

// --- Settlement lattice (pure source of truth for placement + spacing) -------
// Settlements live on a deterministic coarse grid, one candidate site per cell,
// so min-spacing is resolved by PURE PRIORITY over derivable candidates — never
// by which node materialized first. That is what makes settlement placement
// order-independent under lazy generation (the same move deriveTerrainAt made).

// tierRank — position on the ascending ladder (hamlet=0 … capital=4), −1 for a
// non-tier. Exported alongside SETTLEMENT_TIERS so the POI engine can gate
// category tables by minimum tier without duplicating the ladder.
export const tierRank = (tier) => SETTLEMENT_TIERS.indexOf(tier);

function cellOf(x, y, cellSize) {
  return { cx: Math.floor(x / cellSize), cy: Math.floor(y / cellSize) };
}

// tierForRoll — highest tier whose ascending threshold the roll clears. Higher
// tiers have higher thresholds ⇒ they are rarer.
function tierForRoll(tierThresholds, roll) {
  let chosen = SETTLEMENT_TIERS[0];
  for (const tier of SETTLEMENT_TIERS) {
    const thr = tierThresholds[tier];
    if (thr !== undefined && roll >= thr) chosen = tier;
  }
  return chosen;
}

// settlementSpacingOf — the tier-scaled minimum spacing a settlement of `tier`
// reserves. Bigger settlements reserve more territory.
export function settlementSpacingOf(config, tier) {
  const s = readClassification(config).settlement;
  return s.minSpacing * (s.tierSpacingMultiplier[tier] ?? 1);
}

// maxSettlementSpacing — the LARGEST possible tier-scaled spacing (capital tier).
// This, not the base minSpacing, is what the suppression search must cover.
export function maxSettlementSpacing(config) {
  const s = readClassification(config).settlement;
  let max = 0;
  for (const tier of SETTLEMENT_TIERS) {
    max = Math.max(max, s.minSpacing * (s.tierSpacingMultiplier[tier] ?? 1));
  }
  return max;
}

// settlementSearchCellRadius — how many cells out the Poisson-disk suppression
// scan must reach, derived from maxSettlementSpacing (capital tier), NOT the base
// minSpacing. Because sites are jittered anywhere inside their cell, two sites in
// cells k apart can be as close as (k-1)*cellSize; to catch every suppressor
// within maxSpacing we need (k-1)*cellSize < maxSpacing, i.e.
// k <= ceil(maxSpacing/cellSize) + 1. The +1 covers the intra-cell jitter and
// guarantees correctness at the capital tier for ANY cellSize (cellSize is only
// a density/perf knob, never a correctness gate).
export function settlementSearchCellRadius(config) {
  const s = readClassification(config).settlement;
  return Math.ceil(maxSettlementSpacing(config) / s.cellSize) + 1;
}

// deriveSettlementSiteInCell — PURE. The single jittered candidate site for a
// cell, or null if that site's terrain is not suitable enough to host a
// settlement. Position, suitability, and tier are all pure functions of
// (seed, cell), so the candidate for a cell is fixed no matter how it is reached.
export function deriveSettlementSiteInCell(config, cx, cy) {
  const wm = readWorldMap(config);
  const s = readClassification(config).settlement;
  const seed = mapSeed(config);
  const cellSize = s.cellSize;

  const rng = mulberry32(hashCoords(seed, SETTLEMENT_SITE_SALT, cx, cy));
  const x = (cx + rng()) * cellSize;
  const y = (cy + rng()) * cellSize;

  const suitability = deriveHospitability(config, x, y);
  if (suitability < s.suitabilityThreshold) return null;

  const roll = fbm(seed, CHANNEL_TIER, x, y, s.tierNoiseScale, wm.terrain.octaves);
  const tier = tierForRoll(s.tierThresholds, roll);
  return { id: `settlement_${cx}_${cy}`, cx, cy, x, y, suitability, tier };
}

// A shared derivation context: memoizes raw sites and acceptance results per
// cell so the engine can amortize the lattice scan across many node lookups.
// It is ONLY a cache — every value is recomputable from scratch (rebuild uses a
// fresh ctx), which is what proves the accelerator cache is redundant.
function makeClassCtx() {
  return { sites: new Map(), accepted: new Map() };
}
function siteAt(config, cx, cy, ctx) {
  const key = `${cx},${cy}`;
  if (ctx.sites.has(key)) return ctx.sites.get(key);
  const site = deriveSettlementSiteInCell(config, cx, cy);
  ctx.sites.set(key, site);
  return site;
}

// comparePriority — strict total order over candidate sites. Higher tier wins;
// then higher suitability; then a deterministic cell-coordinate tiebreak (lower
// cx, then lower cy). Returns > 0 iff `a` outranks `b`. Total + pure ⇒ the
// Poisson-disk resolution is commutative and exploration-order-independent.
function comparePriority(a, b) {
  const ra = tierRank(a.tier);
  const rb = tierRank(b.tier);
  if (ra !== rb) return ra - rb;
  if (a.suitability !== b.suitability) return a.suitability - b.suitability;
  if (a.cx !== b.cx) return b.cx - a.cx;
  return b.cy - a.cy;
}

// isSettlementSiteAccepted — PURE (given the same config). Priority-based
// Poisson-disk: a candidate B is ACCEPTED unless some strictly-higher-priority,
// itself-accepted candidate A lies within max(spacingOf(A), spacingOf(B)) of it.
// Resolution follows the pure priority order, not arrival order, so the accepted
// set is identical regardless of how a region is explored. Recursion terminates
// because it only ever descends to strictly-higher-priority cells (a DAG down a
// strict total order); memoized so each cell resolves once.
export function isSettlementSiteAccepted(config, cx, cy, ctx = makeClassCtx()) {
  const key = `${cx},${cy}`;
  if (ctx.accepted.has(key)) return ctx.accepted.get(key);

  const site = siteAt(config, cx, cy, ctx);
  if (!site) {
    ctx.accepted.set(key, null);
    return null;
  }

  const r = settlementSearchCellRadius(config);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      if (dx === 0 && dy === 0) continue;
      const other = siteAt(config, cx + dx, cy + dy, ctx);
      if (!other) continue;
      if (comparePriority(other, site) <= 0) continue; // only higher priority can suppress
      const d = Math.hypot(other.x - site.x, other.y - site.y);
      const spacing = Math.max(settlementSpacingOf(config, other.tier), settlementSpacingOf(config, site.tier));
      if (d < spacing && isSettlementSiteAccepted(config, cx + dx, cy + dy, ctx)) {
        ctx.accepted.set(key, null);
        return null;
      }
    }
  }
  ctx.accepted.set(key, site);
  return site;
}

// deriveClassificationAt — PURE. The full classification for a node coordinate.
// A node is a settlement iff an ACCEPTED settlement site sits within snapRadius
// of it (a pure position test, so byte-identical however the node is reached);
// then it carries that site's tier + id and its baseline faction. Otherwise it
// is wilderness and carries notability + hospitability. Folded into deriveNodeAt
// so cached nodes are self-describing and participate in the rebuildability proof.
export function deriveClassificationAt(config, x, y, ctx = makeClassCtx()) {
  const s = readClassification(config).settlement;
  const cellSize = s.cellSize;
  const { cx, cy } = cellOf(x, y, cellSize);

  // Cells whose accepted site could fall within snapRadius of (x,y). snapRadius
  // is small, but derive the ring from it so this stays correct if it grows.
  const snapCells = Math.ceil(s.snapRadius / cellSize) + 1;
  let claimed = null;
  let claimedDist = s.snapRadius;
  for (let dx = -snapCells; dx <= snapCells; dx++) {
    for (let dy = -snapCells; dy <= snapCells; dy++) {
      const accepted = isSettlementSiteAccepted(config, cx + dx, cy + dy, ctx);
      if (!accepted) continue;
      const d = Math.hypot(accepted.x - x, accepted.y - y);
      if (d <= claimedDist) {
        claimed = accepted;
        claimedDist = d;
      }
    }
  }

  if (claimed) {
    return {
      kind: 'settlement',
      tier: claimed.tier,
      settlementId: claimed.id,
      // Baseline faction is derived at the SITE, not the node, so every node
      // that claims the same settlement agrees on its controlling faction.
      baselineFaction: deriveBaselineFactionControl(config, claimed.x, claimed.y),
      notability: null,
      hospitability: null,
    };
  }
  return {
    kind: 'wilderness',
    tier: null,
    settlementId: null,
    baselineFaction: null,
    notability: deriveNotability(config, x, y),
    hospitability: deriveHospitability(config, x, y),
  };
}

// generateNeighborCandidates — PURE. Returns 8 candidate { direction, x, y }
// positions around fromNode, one per compass heading, jittered per config. It
// does NOT yet resolve terrain or reconciliation. Jitter is seeded from the
// node's own coordinates + direction, so the candidates for a given node are
// identical no matter how or when the node was reached.
export function generateNeighborCandidates(config, fromNode) {
  const wm = readWorldMap(config);
  const seed = mapSeed(config);
  const baseDist = wm.baseInterNodeDistance;
  const distJitter = wm.distanceJitter;
  const angleJitter = wm.angleJitterDegrees;

  // Quantize the node coordinates into stable integer keys for the jitter seed.
  const kx = Math.round(fromNode.x * 1000);
  const ky = Math.round(fromNode.y * 1000);

  return DIRECTIONS.map((dir, index) => {
    const rng = mulberry32(hashCoords(seed, CANDIDATE_SALT + index, kx, ky));
    const distFactor = 1 + (rng() * 2 - 1) * distJitter;
    const angleOffset = (rng() * 2 - 1) * angleJitter;
    const dist = baseDist * distFactor;
    const angleRad = (dir.deg + angleOffset) * DEG2RAD;
    return {
      direction: dir.name,
      x: fromNode.x + dist * Math.cos(angleRad),
      y: fromNode.y + dist * Math.sin(angleRad),
    };
  });
}

// computeHeading — the compass name of the vector (fromX,fromY) → (toX,toY),
// snapped to the nearest of the 8 headings from the REAL relative coordinates.
// Used for reverse edges: because node positions are organic/jittered (not a
// perfect grid), the heading back is NOT assumed to be the opposite of the way
// we came — it is computed from where the two nodes actually sit.
export function computeHeading(fromX, fromY, toX, toY) {
  let deg = Math.atan2(toY - fromY, toX - fromX) / DEG2RAD;
  deg = ((deg % 360) + 360) % 360;
  const index = Math.round(deg / 45) % 8;
  return DIRECTIONS[index].name;
}

// nodeIdFor — a stable id derived from a coordinate, so the same generated
// position always yields the same id (needed for cache lookups and the
// rebuildability proof).
export function nodeIdFor(x, y) {
  return `node_${x.toFixed(3)}_${y.toFixed(3)}`;
}

// deriveNodeAt — PURE. The full derivable node object at a coordinate (id +
// coords + terrain + classification), with no edges. Edges are materialization
// state, not a property of the coordinate, so they are deliberately excluded.
// This is what rebuildNodeAt returns, and what a cached node must match on its
// derivable fields. `ctx` is an optional classification cache the engine passes
// to amortize the settlement-lattice scan; omitting it (rebuild/proof path)
// yields byte-identical values from a fresh scan — that equality is the proof
// the cache is redundant.
export function deriveNodeAt(config, x, y, ctx) {
  return {
    id: nodeIdFor(x, y),
    x,
    y,
    ...deriveTerrainAt(config, x, y),
    classification: deriveClassificationAt(config, x, y, ctx),
  };
}

// findPassableOrigin — PURE. The seed node the whole graph grows from must not
// itself be impassable (terrain at (0,0) is just whatever the noise field rolls
// — for some seeds a cliff or deep water). This deterministically spirals
// outward from (0,0) and returns the nearest coordinate whose terrain is
// passable. Only the seed node's POSITION moves; falloff is still measured from
// (0,0), and terrain stays a pure function of coordinates, so the origin node
// remains fully rebuildable (deriveNodeAt at this coordinate matches the cache).
// The scan (fixed radial step + angular resolution) is itself deterministic, so
// the chosen origin is reproducible from (seed, config) alone.
const ORIGIN_SEARCH_STEP = 1;
const ORIGIN_SEARCH_ANGLES = 12;
const ORIGIN_SEARCH_MAX_RADIUS = 10000;
function findPassableOrigin(config) {
  if (deriveTerrainAt(config, 0, 0).passable) return { x: 0, y: 0 };
  for (
    let radius = ORIGIN_SEARCH_STEP;
    radius <= ORIGIN_SEARCH_MAX_RADIUS;
    radius += ORIGIN_SEARCH_STEP
  ) {
    for (let a = 0; a < ORIGIN_SEARCH_ANGLES; a++) {
      const ang = (a / ORIGIN_SEARCH_ANGLES) * Math.PI * 2;
      const x = radius * Math.cos(ang);
      const y = radius * Math.sin(ang);
      if (deriveTerrainAt(config, x, y).passable) return { x, y };
    }
  }
  // Unreachable near the origin (falloff ~0 there ⇒ mostly-passable base
  // terrain); fall back to (0,0) rather than throw.
  return { x: 0, y: 0 };
}

// The one event this engine owns: a node's first neighbor-materialization,
// i.e. the player's exploration history (see the header note on the explored
// graph). Terrain/classification stay pure and unlogged.
const MAP_NEIGHBORS_MATERIALIZED = 'MAP_NEIGHBORS_MATERIALIZED';

// createWorldMapEngine — the stateful engine. Same factory contract as the
// other engines (createXxxEngine(world)). Terrain and classification never
// touch the action log (pure position functions); the explored graph does —
// MAP_NEIGHBORS_MATERIALIZED entries are its history, primed at construction
// and appended as the player explores. Also seeds a deterministic,
// guaranteed-passable origin node near (0, 0).
export function createWorldMapEngine(world) {
  const { config } = world.getState();
  readClassification(config); // validate terrain + classification up front

  // The cache: nodeId -> node. A node is { id, x, y, elevation, moisture,
  // terrainType, passable, classification, edges: [{ to, heading, passable }] }.
  // It is only ever an optimization over deriveNodeAt — never authoritative.
  const nodes = new Map();
  // Node ids whose neighbors have already been materialized, so re-querying is a
  // no-op rather than a regeneration.
  const materialized = new Set();
  // The settlement-lattice accelerator cache, shared across every node lookup so
  // the Poisson-disk scan is amortized. Purely redundant: rebuildClassificationAt
  // recomputes from a fresh ctx and must match (see rebuild proof).
  const classCtx = makeClassCtx();

  function storeNode(node) {
    nodes.set(node.id, node);
    return node;
  }

  function materializeNode(x, y) {
    const derived = deriveNodeAt(config, x, y, classCtx);
    const existing = nodes.get(derived.id);
    if (existing) return existing;
    return storeNode({ ...derived, edges: [] });
  }

  // The deterministic, guaranteed-passable seed node near (0,0). Both its
  // position and its terrain are pure functions of (seed, config), so it is
  // fixed and fully rebuildable.
  const originCoord = findPassableOrigin(config);
  const origin = materializeNode(originCoord.x, originCoord.y);

  // Nearest already-materialized node within `radius` of (x, y), or null.
  function findNear(x, y, radius, excludeId) {
    let best = null;
    let bestDist = radius;
    for (const node of nodes.values()) {
      if (node.id === excludeId) continue;
      const d = Math.hypot(node.x - x, node.y - y);
      if (d <= bestDist) {
        best = node;
        bestDist = d;
      }
    }
    return best;
  }

  // Wire a one-directional edge if one to that target does not already exist.
  function addEdge(node, toNode, heading) {
    if (node.edges.some((e) => e.to === toNode.id)) return;
    node.edges.push({ to: toNode.id, heading, passable: toNode.passable });
  }

  // reconcileNeighbors — the stateful body shared by live materialization and
  // log replay. Generates the 8 candidates, reconciles each against the cache
  // within the tolerance radius, derives terrain for genuinely new candidates,
  // stores them, and wires bidirectional edges. The forward edge carries the
  // ATTEMPTED compass direction; the reverse edge's heading is computed from
  // the REAL relative coordinates (not assumed opposite). Idempotent:
  // re-running it for a node returns its existing set.
  function reconcileNeighbors(fromNodeId) {
    const fromNode = nodes.get(fromNodeId);
    if (!fromNode) throw new Error(`WorldMapEngine: unknown node "${fromNodeId}"`);

    const wm = readWorldMap(config);
    const tol = wm.reconciliationToleranceRadius;
    const candidates = generateNeighborCandidates(config, fromNode);

    const neighbors = [];
    const edges = [];
    let created = 0;
    let reconciled = 0;

    for (const cand of candidates) {
      // Reconciliation: if a candidate lands within tolerance of an existing
      // node, connect to that node instead of duplicating it. This is what turns
      // independent per-node generation into a converging, tangled lattice.
      let target = findNear(cand.x, cand.y, tol, fromNode.id);
      if (target) {
        reconciled++;
      } else {
        target = materializeNode(cand.x, cand.y);
        created++;
      }

      // Forward edge uses the attempted direction; reverse edge uses the real
      // relative heading from the two nodes' actual coordinates.
      addEdge(fromNode, target, cand.direction);
      const reverseHeading = computeHeading(target.x, target.y, fromNode.x, fromNode.y);
      addEdge(target, fromNode, reverseHeading);

      neighbors.push(target);
      edges.push({ from: fromNode.id, to: target.id, heading: cand.direction });
    }

    materialized.add(fromNode.id);
    return { origin: fromNode, neighbors, edges, created, reconciled };
  }

  // applyNeighborsMaterialized — fold ONE committed materialization into the
  // graph: at construction for entries already in the log (cold-start priming
  // against a loaded save), then live via the subscription. The result is
  // stashed so the dispatching materializeNeighbors call can return it.
  let lastReconcileResult = null;
  function applyNeighborsMaterialized(entry) {
    lastReconcileResult = reconcileNeighbors(entry.payload.nodeId);
  }

  // Prime the explored graph from existing history — replaying committed
  // materializations in log order from the same deterministic origin rebuilds
  // the identical node set and edges (a no-op on a fresh world) — then
  // subscribe for live exploration.
  for (const entry of world.getEventLog()) {
    if (entry.type === MAP_NEIGHBORS_MATERIALIZED) applyNeighborsMaterialized(entry);
  }
  world.subscribe(MAP_NEIGHBORS_MATERIALIZED, applyNeighborsMaterialized);

  // materializeNeighbors — the public exploration verb. A node's FIRST
  // materialization is player history, so it is committed to the log (the
  // subscribe handler does the actual graph work); re-materializing an
  // already-explored node changes nothing, so it re-runs the idempotent body
  // directly for the same return shape without logging a second event — the
  // log carries at most one MAP_NEIGHBORS_MATERIALIZED per node.
  function materializeNeighbors(fromNodeId) {
    if (!nodes.has(fromNodeId)) throw new Error(`WorldMapEngine: unknown node "${fromNodeId}"`);
    if (materialized.has(fromNodeId)) return reconcileNeighbors(fromNodeId);
    world.dispatch(MAP_NEIGHBORS_MATERIALIZED, { nodeId: fromNodeId });
    return lastReconcileResult;
  }

  function getNode(nodeId) {
    return nodes.get(nodeId) ?? null;
  }

  // Cache lookup by coordinate: the nearest materialized node within the
  // reconciliation tolerance radius, or null.
  function getNodeAt(x, y) {
    return findNear(x, y, readWorldMap(config).reconciliationToleranceRadius, null);
  }

  // rebuildNodeAt — re-derive a node from scratch, ignoring the cache entirely
  // (fresh classification ctx too). Its derivable fields must equal a cached
  // node's; that equality is the rebuildability proof (cache is redundant over
  // the pure derivation).
  function rebuildNodeAt(cfg, x, y) {
    return deriveNodeAt(cfg, x, y);
  }

  // classifyAt — classify any coordinate THROUGH the shared accelerator ctx
  // (the same cache node materialization uses). Because the ctx is only a cache
  // over a pure derivation, the result is independent of how the ctx was warmed
  // — that order-independence is what rebuildClassificationAt (a fresh scan)
  // proves it equals.
  function classifyAt(x, y) {
    return deriveClassificationAt(config, x, y, classCtx);
  }

  // rebuildClassificationAt — re-derive just the classification from a fresh
  // settlement-lattice scan, ignoring the shared accelerator ctx. Equality with
  // a cached node's classification proves the accelerator cache is redundant,
  // exactly as rebuildNodeAt does for terrain.
  function rebuildClassificationAt(cfg, x, y) {
    return deriveClassificationAt(cfg, x, y);
  }

  function getOriginNode() {
    return origin;
  }

  function isMaterialized(nodeId) {
    return materialized.has(nodeId);
  }

  return {
    materializeNeighbors,
    getNode,
    getNodeAt,
    classifyAt,
    rebuildNodeAt,
    rebuildClassificationAt,
    getOriginNode,
    isMaterialized,
  };
}
