// engines/poiEngine.js — Points of Interest: the discoverable content INSIDE a
// node (shops, taverns, ore deposits, caves, bandit lairs, ...).
//
// POIs are NOT map nodes and do NOT recurse: a POI lives inside exactly one node
// and never itself contains further explorable sub-content (one level of
// containment). This layer produces the POI SCHEMA, GENERATION, DISCOVERY, and
// EXPLORE mechanism only — never POI *content* (what a shop sells is future
// scope, exactly as travel-combat was deferred from WorldMapEngine).
//
// This is the FOURTH application of the codebase's two established disciplines,
// and reuses BOTH halves rather than inventing a shape:
//
//   * The BASELINE POOL is a PURE function of (config, seed, node) — the exact
//     discipline deriveTerrainAt / deriveClassificationAt set. A node's baseline
//     POIs are determined by POSITION, never by visit order or visit count, and
//     are never re-rolled on a repeat visit. There is nothing to replay, so this
//     half does NOT dispatch/subscribe (mirrors deriveClassificationAt, NOT the
//     relationship store). deriveBaselinePois is deliberately NOT folded into
//     deriveNodeAt: a node you merely pass through should not materialize its POI
//     pool — it is derived lazily, only when a node is actually explored.
//
//   * DISCOVERY, INJECTION, and REVEAL AUTHORITY are EVENTS, not derivations, so
//     they take the log-replay + provably-redundant-cache shape of factionEngine
//     / relationshipStore / worldClockEngine. "Has the player found this POI",
//     "what has been injected into this node", and "which POIs the player has
//     authority to reveal" are all DERIVED from the append-only log, never stored
//     as mutable fields. The engine's caches are only ever accelerators: every
//     one is fully rebuildable from the log alone (see the rebuild* methods).
//
// The blind-explore roll is a FLAT success chance (poi.explore.baseExploreSuccess-
// Chance — a stub standing in for a future skill-vs-node/POI-difficulty check)
// rolled against whatever is currently undiscovered. There is deliberately NO
// diminishing-returns curve: the "diminishing" effect is purely the finite pool
// shrinking permanently as discoveries are logged and can never be re-rolled. The
// per-attempt index exists ONLY to decorrelate successive rolls' RNG streams; it
// is derived by pure log replay (deriveBlindAttemptCount), never a mutable
// counter, so it is not a second source of truth for "times explored here".
//
// Exploring costs game-time by plugging into WorldClockEngine as a new timeContext
// ('exploring'): every explore action carries timeContext:'exploring' in its
// payload, which WorldClockEngine already picks up (last-write-wins) with zero
// engine changes — exactly how travelEngine's ACTION_TRAVEL_STARTED sets
// 'traveling'. travelEngine's explore window is what ends the context (its
// ACTION_EXPLORE_ENDED carries 'idle' after the configured duration).

import { mulberry32 } from '../worldState.js';
import { hashCoords, mapSeed, tierRank } from './worldMapEngine.js';

const POI_DISCOVERED = 'POI_DISCOVERED';
const POI_INJECTED = 'POI_INJECTED';
const POI_REVEAL_GRANTED = 'POI_REVEAL_GRANTED';
const POI_EXPLORED = 'POI_EXPLORED';

const EXPLORE_TIME_CONTEXT = 'exploring';

// Per-draw salts, all distinct from the terrain/classification salts already in
// use (11, 29, 777, 4001, 53, 71, 97) so POI randomness never correlates with
// terrain, node jitter, settlement placement, or notability. POI_POOL_SALT and
// POI_EXPLORE_SALT are used as bases that an index is added to, so they are kept
// far apart from each other and from everything else.
const POI_POOL_SALT = 60000;
const POI_EXPLORE_SALT = 80000;

// readPoi — guarded reader for the worldMap.poi config sub-block, mirroring
// readClassification's up-front validation so callers fail loudly on a malformed
// config rather than deep inside a draw.
function readPoi(config) {
  const poi = config?.worldMap?.poi;
  if (!poi) throw new Error('WorldConfig is missing worldMap.poi');
  if (!poi.settlement) throw new Error('WorldConfig is missing worldMap.poi.settlement');
  if (!poi.wilderness) throw new Error('WorldConfig is missing worldMap.poi.wilderness');
  if (!poi.explore) throw new Error('WorldConfig is missing worldMap.poi.explore');
  return poi;
}

// Quantize node coords into stable integer keys for lattice seeding, the same
// 1e3 quantization generateNeighborCandidates uses so a node's POI draws are
// pinned to its exact coordinate. Exported for economyEngine's shop-stock
// baseline, which must pin its draws to the same coordinate keys.
export function nodeKeys(node) {
  return { kx: Math.round(node.x * 1000), ky: Math.round(node.y * 1000) };
}

// weightedPick — weighted choice over an array of { name, weight }, using a
// single [0,1) draw `r`. It iterates the array in the order given, so the pick is
// only as deterministic as that order: callers pass a stably-ordered array —
// availableCategories sorts by name (never JSON/insertion order), and the POI-id
// pick uses the stable pool order. Assumes a non-empty array with positive total
// weight. Exported for reuse by npcGeneratorEngine (race and orientation picks) —
// pure-helper sharing, same as this module's own imports from worldMapEngine.
export function weightedPick(entries, r) {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let acc = r * total;
  for (const e of entries) {
    acc -= e.weight;
    if (acc < 0) return e.name;
  }
  return entries[entries.length - 1].name; // float-safety fallback
}

// availableCategories — the category table available to a node, gated by its
// classification, returned as a sorted-name array of { name, weight }. Settlement
// categories are gated by minTier (rank on the shared SETTLEMENT_TIERS ladder);
// wilderness categories by minNotability. Sorting here is what makes the pool
// draw order-independent of the config's key order.
function availableCategories(poi, classification) {
  const raw =
    classification.kind === 'settlement' ? poi.settlement.categories : poi.wilderness.categories;
  const out = [];
  for (const name of Object.keys(raw).sort()) {
    const def = raw[name];
    if (classification.kind === 'settlement') {
      if (tierRank(classification.tier) >= tierRank(def.minTier)) {
        out.push({ name, weight: def.weight });
      }
    } else {
      if ((classification.notability ?? 0) >= (def.minNotability ?? 0)) {
        out.push({ name, weight: def.weight });
      }
    }
  }
  return out;
}

// poolSizeFor — the number of baseline POIs a node's classification yields.
// Settlement: a flat per-tier lookup (richer pool for higher tier). Wilderness: a
// notability-dominant, hospitability-modified formula, clamped to [0, maxPoolSize]
// — a hostile, mundane node can legitimately yield 0 (you cannot find what was
// never in the pool).
function poolSizeFor(poi, classification) {
  if (classification.kind === 'settlement') {
    return poi.settlement.poolSizeByTier[classification.tier] ?? 0;
  }
  const w = poi.wilderness;
  const raw =
    w.base +
    (classification.notability ?? 0) * w.notabilityPoolScale +
    (classification.hospitability ?? 0) * w.hospitabilityPoolScale;
  return Math.max(0, Math.min(w.maxPoolSize, Math.round(raw)));
}

// deriveBaselinePois — PURE. The finite baseline POI stub list for a node, a
// function of (config, seed, node.x, node.y, node.classification) ALONE. Each
// index i seeds a fresh mulberry32 from (seed, POI_POOL_SALT + i, kx, ky) and
// draws category, prominence, and hidden from that one stream — so the pool is
// identical no matter how or when the node was reached, and is never re-rolled on
// a repeat visit. A node with an empty available-category table (should not happen
// for the shipped config) or a zero pool size yields [].
export function deriveBaselinePois(config, node) {
  const poi = readPoi(config);
  const seed = mapSeed(config);
  const { kx, ky } = nodeKeys(node);
  const cats = availableCategories(poi, node.classification);
  const size = poolSizeFor(poi, node.classification);
  if (size <= 0 || cats.length === 0) return [];

  const pois = [];
  for (let i = 0; i < size; i++) {
    const rng = mulberry32(hashCoords(seed, POI_POOL_SALT + i, kx, ky));
    const category = weightedPick(cats, rng());
    const prominence = rng();
    const hidden = rng() < poi.hiddenChance;
    pois.push({
      id: `poi_${node.id}_b${i}`,
      nodeId: node.id,
      category,
      source: 'baseline',
      prominence,
      hidden,
      data: {}, // opaque placeholder — NO content this pass
    });
  }
  return pois;
}

// deriveInjectedPois — PURE. Every POI stub injected into a node AFTER generation,
// replayed from POI_INJECTED entries in log order. Injected POIs carry their full
// stub in the payload (they are not derivable from position). Returned in log
// order, which is stable.
export function deriveInjectedPois(log, nodeId) {
  const out = [];
  for (const entry of log) {
    if (entry.type !== POI_INJECTED) continue;
    if (entry.payload.nodeId !== nodeId) continue;
    out.push(entry.payload.poi);
  }
  return out;
}

// derivePoiPool — PURE. The full undiscovered-SOURCE pool for a node: the pure
// baseline plus everything injected into it. This is the set discovery draws from;
// it says nothing about what has already been found.
export function derivePoiPool(config, node, log) {
  return [...deriveBaselinePois(config, node), ...deriveInjectedPois(log, node.id)];
}

// deriveDiscoveredPoiIds — PURE. The set of POI ids the player has actually found
// at a node, replayed from POI_DISCOVERED entries (mirrors deriveFactionControl /
// deriveRelationshipStats: the log is the single source of truth). A Set.
export function deriveDiscoveredPoiIds(log, nodeId) {
  const found = new Set();
  for (const entry of log) {
    if (entry.type !== POI_DISCOVERED) continue;
    if (entry.payload.nodeId !== nodeId) continue;
    found.add(entry.payload.poiId);
  }
  return found;
}

// deriveRevealedPoiIds — PURE. The set of POI ids the player currently has reveal
// authority for, replayed from POI_REVEAL_GRANTED. A future quest/inventory/spell
// system dispatches these; presence in this set = authorized. A Set.
export function deriveRevealedPoiIds(log) {
  const granted = new Set();
  for (const entry of log) {
    if (entry.type !== POI_REVEAL_GRANTED) continue;
    granted.add(entry.payload.poiId);
  }
  return granted;
}

// deriveBlindAttemptCount — PURE. The number of prior blind-roll explore attempts
// at a node, replayed from POI_EXPLORED entries flagged rolled:true. This is the
// SOLE source of a blind attempt's index; there is no mutable engine counter. The
// index feeds only the RNG seed (decorrelating successive attempts), never the
// success probability, and is never read back as state — so it can never drift
// from the log the way a stored counter could.
export function deriveBlindAttemptCount(log, nodeId) {
  let count = 0;
  for (const entry of log) {
    if (entry.type !== POI_EXPLORED) continue;
    if (entry.payload.nodeId !== nodeId) continue;
    if (entry.payload.rolled) count += 1;
  }
  return count;
}

// deriveBlindExploreOutcome — PURE. The id a blind explore surfaces, or null.
// Candidates are the undiscovered NON-hidden POIs (hidden POIs never surface
// blindly — they need directed + authority). If none remain, returns null: the
// natural, permanent bound (the pool is finite and shrinks as ids are discovered).
// Otherwise a single flat-chance roll (baseExploreSuccessChance) decides success;
// on success the surfaced id is picked weighted by prominence (prominent POIs turn
// up first). attemptIndex only seeds the RNG stream, keeping successive attempts
// independent and deterministic.
export function deriveBlindExploreOutcome(config, node, undiscovered, attemptIndex) {
  const poi = readPoi(config);
  const blind = undiscovered.filter((p) => !p.hidden);
  if (blind.length === 0) return null;

  const seed = mapSeed(config);
  const { kx, ky } = nodeKeys(node);
  const rng = mulberry32(hashCoords(seed, POI_EXPLORE_SALT + attemptIndex, kx, ky));

  if (rng() >= poi.explore.baseExploreSuccessChance) return null; // flat-chance miss
  return weightedPick(
    blind.map((p) => ({ name: p.id, weight: p.prominence })),
    rng()
  );
}

// createPoiEngine — the stateful engine. Same factory contract as the other
// engines (createXxxEngine(world)); it talks to nothing but `world` plus the pure
// derivations above. Explore/inject/grant methods take a materialized `node`
// object (carrying id/x/y/classification) — the game layer passes the node the
// player is standing in — mirroring relationshipEffectEngine's "take the subject,
// dispatch, let the log be the truth" shape.
export function createPoiEngine(world) {
  const { config } = world.getState();
  readPoi(config); // validate up front

  // Redundant accelerator caches, each fully rebuildable from the log:
  //   discoveredByNode: nodeId -> Set<poiId> found so far
  //   injectedByNode:   nodeId -> POI[] injected after generation
  //   grantedReveals:   Set<poiId> the player has reveal authority for
  // There is deliberately NO attemptIndex cache: a blind attempt's index is a
  // pure log replay (deriveBlindAttemptCount), never a stored counter, so it can
  // never become a second source of truth alongside the log.
  const discoveredByNode = new Map();
  const injectedByNode = new Map();
  const grantedReveals = new Set();

  // applyDiscovered / applyInjected / applyRevealGranted — the ONE code path
  // per event type that folds it into its cache. Each runs at construction for
  // entries already in the log (cold-start priming against a loaded save), then
  // live via the subscriptions below.
  function applyDiscovered(entry) {
    const { nodeId, poiId } = entry.payload;
    let set = discoveredByNode.get(nodeId);
    if (!set) {
      set = new Set();
      discoveredByNode.set(nodeId, set);
    }
    set.add(poiId);
  }

  function applyInjected(entry) {
    const { nodeId, poi } = entry.payload;
    let list = injectedByNode.get(nodeId);
    if (!list) {
      list = [];
      injectedByNode.set(nodeId, list);
    }
    list.push(poi);
  }

  function applyRevealGranted(entry) {
    grantedReveals.add(entry.payload.poiId);
  }

  // Prime from existing history (no-op on a fresh world), then subscribe.
  // ORDER MATTERS for the subscriptions exactly as with the relationship store
  // and faction engine: they must be live before any NEW POI_* is dispatched or
  // the caches would miss those events and silently go stale (only the rebuild*
  // methods would then be correct). Construct the engine before any seeding.
  for (const entry of world.getEventLog()) {
    if (entry.type === POI_DISCOVERED) applyDiscovered(entry);
    else if (entry.type === POI_INJECTED) applyInjected(entry);
    else if (entry.type === POI_REVEAL_GRANTED) applyRevealGranted(entry);
  }
  world.subscribe(POI_DISCOVERED, applyDiscovered);
  world.subscribe(POI_INJECTED, applyInjected);
  world.subscribe(POI_REVEAL_GRANTED, applyRevealGranted);

  // The full pool for a node from the caches: pure baseline + injected. Kept
  // separate from getPoiState so callers that only need the source pool (not the
  // discovered split) can avoid the discovered-set walk.
  function poolFor(node) {
    return [...deriveBaselinePois(config, node), ...(injectedByNode.get(node.id) ?? [])];
  }

  // getPoiState — the pool, the discovered-id set, and the still-undiscovered
  // stubs for a node, all from the caches. The undiscovered list is what an
  // explore draws from. The returned discovered Set is a copy so callers can
  // never mutate the cache.
  function getPoiState(node) {
    const pool = poolFor(node);
    const discovered = new Set(discoveredByNode.get(node.id) ?? []);
    const undiscovered = pool.filter((p) => !discovered.has(p.id));
    return { pool, discovered, undiscovered };
  }

  // getRevealedPoiIds — the cached reveal-authority set (a copy). Public read of
  // the same cache exploreDirected consults, so its equality with
  // rebuildRevealedPoiIds is a direct cache-vs-log redundancy check.
  function getRevealedPoiIds() {
    return new Set(grantedReveals);
  }

  // discover — the single sanctioned way a POI becomes found: dispatch
  // POI_DISCOVERED (the subscribe handler updates the cache). Guards against a
  // duplicate discovery so the log carries at most one POI_DISCOVERED per (node,
  // poi). Returns the poiId on a fresh discovery, or null if it was already found.
  function discover(nodeId, poiId) {
    const set = discoveredByNode.get(nodeId);
    if (set && set.has(poiId)) return null;
    world.dispatch(POI_DISCOVERED, { nodeId, poiId });
    return poiId;
  }

  // exploreBlind — a blind explore of the node. Derives this attempt's index by
  // pure log replay FIRST (so it counts only PRIOR attempts, since this one is not
  // in the log yet), then records the attempt as a time-consuming action carrying
  // timeContext:'exploring' and flagged rolled:true (which is what future
  // deriveBlindAttemptCount replays see). Rolls deriveBlindExploreOutcome over the
  // current undiscovered set and, on a hit, dispatches POI_DISCOVERED. Returns the
  // discovered id or null.
  function exploreBlind(node) {
    const attemptIndex = deriveBlindAttemptCount(world.getEventLog(), node.id);
    world.dispatch(POI_EXPLORED, {
      nodeId: node.id,
      mode: 'blind',
      rolled: true,
      timeContext: EXPLORE_TIME_CONTEXT,
    });
    const { undiscovered } = getPoiState(node);
    const poiId = deriveBlindExploreOutcome(config, node, undiscovered, attemptIndex);
    if (!poiId) return null;
    return discover(node.id, poiId);
  }

  // exploreDirected — a directed explore that requests a SPECIFIC poiId. Records
  // the (time-consuming) directed attempt. If the player holds reveal authority
  // for that id AND it is genuinely in the node's pool, it is discovered directly,
  // bypassing the roll (rolled:false — a directed hit does not consume the blind
  // attempt sequence), and this is the ONLY path that can surface a hidden POI.
  // Otherwise (no authority, or an id not in the pool) it falls back to a normal
  // blind roll — never a hard reject, never a crash on an unknown id — so
  // "explore, hoping to find the thing the quest mentioned" stays valid without a
  // lead. The blind fallback derives its own attempt index and dispatches its own
  // rolled:true POI_EXPLORED, so the directed record above stays rolled:false.
  function exploreDirected(node, poiId) {
    world.dispatch(POI_EXPLORED, {
      nodeId: node.id,
      mode: 'directed',
      rolled: false,
      timeContext: EXPLORE_TIME_CONTEXT,
    });
    const { pool } = getPoiState(node);
    const inPool = pool.some((p) => p.id === poiId);
    if (inPool && grantedReveals.has(poiId)) {
      return discover(node.id, poiId);
    }
    return exploreBlind(node);
  }

  // injectPoi — add a POI to a node's pool AFTER generation (a quest system's
  // entry point; used by proof now). This is fundamentally an event: content can
  // be added to a node the player has already visited. Injected POIs do NOT
  // auto-surface — the stub joins the undiscovered pool and still has to be
  // explored (or directed to) like any baseline POI. Returns the injected stub.
  function injectPoi(nodeId, poiStub) {
    const poi = { ...poiStub, nodeId, source: 'injected' };
    world.dispatch(POI_INJECTED, { nodeId, poi });
    return poi;
  }

  // grantRevealAuthority — grant reveal authority for a specific POI id. A
  // quest/inventory/spell stand-in (the same stand-in discipline the debug
  // time-context switch followed until travelEngine's real verbs retired it):
  // it only dispatches; the subscribe handler updates the cache. Log-derived,
  // so authority is rebuildable like everything else.
  function grantRevealAuthority(poiId) {
    return world.dispatch(POI_REVEAL_GRANTED, { poiId });
  }

  // rebuildDiscoveredPoiIds / rebuildInjectedPois / rebuildRevealedPoiIds —
  // recompute each cache from the log alone, ignoring the incremental caches.
  // Their equality with the cached values is the rebuildability proof (mirrors
  // rebuildFactionControl / rebuildRelationshipStats).
  function rebuildDiscoveredPoiIds(node) {
    return deriveDiscoveredPoiIds(world.getEventLog(), node.id);
  }
  function rebuildInjectedPois(nodeId) {
    return deriveInjectedPois(world.getEventLog(), nodeId);
  }
  function rebuildRevealedPoiIds() {
    return deriveRevealedPoiIds(world.getEventLog());
  }

  return {
    getPoiState,
    getRevealedPoiIds,
    exploreBlind,
    exploreDirected,
    injectPoi,
    grantRevealAuthority,
    rebuildDiscoveredPoiIds,
    rebuildInjectedPois,
    rebuildRevealedPoiIds,
  };
}
