// engines/worldMapEngine.js — procedural generation of the physical world as a
// graph of location nodes at organic continuous (x, y) coordinates, connected
// by edges along 8 compass headings, with coherent terrain, materialized lazily
// as the player explores.
//
// WHY THIS ENGINE DOES NOT DISPATCH/SUBSCRIBE (unlike WorldClockEngine or the
// relationship store): terrain is a PURE FUNCTION of (seed, coordinates), not a
// history of dispatched events. There is nothing to replay. So the shape here
// mirrors deriveCalendarDate (config-in / value-out, stateless math), NOT
// deriveRelationshipStats (log-replay backed by a subscribe-maintained cache).
// The materialization cache below is a performance optimization over the pure
// derivation — never a second source of truth. Clearing it and regenerating at
// the same coordinates yields identical results (see rebuildNodeAt), the same
// standing as rebuildRelationshipStats / rebuildTotalGameSeconds.
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

const DEG2RAD = Math.PI / 180;

function readWorldMap(config) {
  const wm = config?.worldMap;
  if (!wm) throw new Error('WorldConfig is missing worldMap');
  if (!wm.terrain) throw new Error('WorldConfig is missing worldMap.terrain');
  return wm;
}

// The map seed: an explicit worldMap.seed when set, else the main world seed —
// matching the existing convention that rngSeed IS the world seed.
function mapSeed(config) {
  const wm = readWorldMap(config);
  return (wm.seed ?? config.rngSeed) | 0;
}

// hashCoords — mix (seed, salt, integer lattice coords) into a 32-bit unsigned
// int, deterministically and for negative coordinates too. This is only the
// SEED for a fresh mulberry32 draw; the reused kernel PRNG does the actual
// value production, so there is no second RNG algorithm here.
function hashCoords(seed, salt, ix, iy) {
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
// coords + terrain), with no edges. Edges are materialization state, not a
// property of the coordinate, so they are deliberately excluded. This is what
// rebuildNodeAt returns, and what a cached node must match on its derivable
// fields.
export function deriveNodeAt(config, x, y) {
  return { id: nodeIdFor(x, y), x, y, ...deriveTerrainAt(config, x, y) };
}

// createWorldMapEngine — the stateful engine. Same factory contract as the
// other engines (createXxxEngine(world)) for consistency, even though it never
// touches the action log. Holds only a provably-redundant materialization cache
// and seeds a deterministic origin node at (0, 0).
export function createWorldMapEngine(world) {
  const { config } = world.getState();
  readWorldMap(config); // validate up front, mirroring the other engines' guards

  // The cache: nodeId -> node. A node is { id, x, y, elevation, moisture,
  // terrainType, passable, edges: [{ to, heading, passable }] }. It is only ever
  // an optimization over deriveNodeAt — never authoritative.
  const nodes = new Map();
  // Node ids whose neighbors have already been materialized, so re-querying is a
  // no-op rather than a regeneration.
  const materialized = new Set();

  function storeNode(node) {
    nodes.set(node.id, node);
    return node;
  }

  function materializeNode(x, y) {
    const derived = deriveNodeAt(config, x, y);
    const existing = nodes.get(derived.id);
    if (existing) return existing;
    return storeNode({ ...derived, edges: [] });
  }

  // The deterministic origin. Terrain at (0,0) is pure, so this is fixed.
  const origin = materializeNode(0, 0);

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

  // materializeNeighbors — the stateful operation. Generates the 8 candidates,
  // reconciles each against the cache within the tolerance radius, derives
  // terrain for genuinely new candidates, stores them, and wires bidirectional
  // edges. The forward edge carries the ATTEMPTED compass direction; the reverse
  // edge's heading is computed from the REAL relative coordinates (not assumed
  // opposite). Idempotent: re-materializing a node returns its existing set.
  function materializeNeighbors(fromNodeId) {
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

  function getNode(nodeId) {
    return nodes.get(nodeId) ?? null;
  }

  // Cache lookup by coordinate: the nearest materialized node within the
  // reconciliation tolerance radius, or null.
  function getNodeAt(x, y) {
    return findNear(x, y, readWorldMap(config).reconciliationToleranceRadius, null);
  }

  // rebuildNodeAt — re-derive a node from scratch, ignoring the cache entirely.
  // Its derivable fields must equal a cached node's; that equality is the
  // rebuildability proof (cache is redundant over the pure derivation).
  function rebuildNodeAt(cfg, x, y) {
    return deriveNodeAt(cfg, x, y);
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
    rebuildNodeAt,
    getOriginNode,
    isMaterialized,
  };
}
