// engines/travelEngine.js — the player's position, real travel between map
// nodes, and the travel-event (incident) system. The FIFTH application of the
// codebase's two established disciplines, and the module that finally gives
// WorldMapEngine's graph, poiEngine's explore functions, and WorldClockEngine's
// timeContext dilation a real player-facing caller.
//
// POSITION — new log-backed state. The player's current node is DERIVED from
// the log (the last TRAVEL_ARRIVED, else the map's deterministic origin node);
// there is no mutable "current node" field, only a provably-redundant cache.
//
// TRAVEL — node-to-node along EXISTING graph edges only, one leg per verb call.
// The destination must be an edge of the current node: no teleporting past
// unexplored nodes, no pathfinding (a longer journey is successive legs). A
// leg's duration derives from real edge geometry — Math.hypot over the two
// nodes' actual coordinates (edges store no distance) × the configured
// travel.gameSecondsPerDistanceUnit — never an invented number.
//
// ACTIVITIES — travel legs and explore windows share one timed-activity
// mechanism. Starting one dispatches an action whose payload carries the
// timeContext ('traveling' via ACTION_TRAVEL_STARTED; 'exploring' via the
// POI_EXPLORED that poiEngine dispatches in the same verb call), the dilated
// clock runs while CLOCK_TICKs accumulate elapsed game-seconds against the
// activity's duration, and completion dispatches the closing event
// (TRAVEL_ARRIVED / ACTION_EXPLORE_ENDED) carrying timeContext:'idle'. At most
// one activity may be open at a time — the verbs throw on overlap, so
// last-write-wins context derivation can never be stomped mid-activity.
//
// INCIDENTS — exactly ONE TRAVEL_INCIDENT is committed per leg, quiet legs
// included (category:'none'), so "max one incident per leg" is a countable log
// invariant. Resolution is two-phase, always in this order:
//
//   1. A DETERMINISTIC SEEDED ROLL (deriveTravelIncident — pure) commits every
//      fact the moment travel starts: category (animal/bandit/npc/
//      environmental/mundane/none), intensity (1–3), and resolutionMode
//      ('auto' flavor vs 'requiresRealTurn' — a genuine branch point). No AI
//      is involved;
//      the stakes are committed before any narration touches them.
//   2. AI NARRATION only COLORS those fixed facts. The TRAVEL_INCIDENT is
//      recorded IMMEDIATELY with a deterministic fallback line (so state is
//      never missing or blocked), and THEN, only when the plugin is live, a
//      detached generateTravelNarration call dispatches
//      TRAVEL_NARRATION_ENHANCED with an AI-written line that replaces the
//      display text — memoryEngine's record-then-enhance shape exactly. The
//      AI call is kicked off the instant travel starts, so its latency hides
//      behind the leg's own dilated time window: the visibly advancing clock
//      IS the loading indicator. Under Node (no plugin) the fallback simply
//      stays — bland but never broken.
//
// 'requiresRealTurn' RESOLUTION — DELIBERATELY DEFERRED HOOK.
// resolutionMode:'requiresRealTurn' marks an incident that SHOULD consume a
// real player turn (combat, negotiation), but no combat/social resolution
// system exists yet — exactly as poiEngine deferred "what does a discovered
// shop DO". The roll, category, and severity are logged as real facts for
// that future system to hook into; in THIS pass a 'requiresRealTurn' incident
// resolves as outcome:'auto-passthrough' (fought off / talked past — clearly
// distinct from 'none' and from 'auto' flavor) so travel never hard-blocks on
// a system that does not exist. Swapping 'auto-passthrough' for a real turn
// is that future system's entry point.
// Rest/making-camp is likewise its own future event type, not built here.

import { mulberry32 } from '../worldState.js';
import { hashCoords, mapSeed } from './worldMapEngine.js';
import { weightedPick } from './poiEngine.js';
import { deriveActiveTimeContext } from './worldClockEngine.js';
import { generateTravelNarration } from '../ai/generateTravelNarration.js';
import { fallbackTravelNarration } from '../ai/fallbackTravelNarration.js';
import { log } from '../debugLog.js';

const ACTION_TRAVEL_STARTED = 'ACTION_TRAVEL_STARTED';
const TRAVEL_INCIDENT = 'TRAVEL_INCIDENT';
const TRAVEL_NARRATION_ENHANCED = 'TRAVEL_NARRATION_ENHANCED';
const TRAVEL_ARRIVED = 'TRAVEL_ARRIVED';
const ACTION_EXPLORE_STARTED = 'ACTION_EXPLORE_STARTED';
const ACTION_EXPLORE_ENDED = 'ACTION_EXPLORE_ENDED';

const TRAVEL_TIME_CONTEXT = 'traveling';
const IDLE_TIME_CONTEXT = 'idle';

// Per-draw salt, distinct from every band already in use (terrain/classification
// 11–4001, POI_POOL_SALT 60000, POI_EXPLORE_SALT 80000, NPC_SALT 100000) so
// incident randomness never correlates with any other draw. Used as a base the
// legIndex is added to, decorrelating successive legs' streams — the legIndex
// feeds ONLY the RNG seed, never the probabilities.
const TRAVEL_INCIDENT_SALT = 120000;

// readTravel — guarded reader for the travel config block, mirroring readPoi's
// fail-loud style: a malformed config dies here, not deep inside a draw.
function readTravel(config) {
  const t = config?.travel;
  if (!t) throw new Error('WorldConfig is missing travel');
  if (typeof t.gameSecondsPerDistanceUnit !== 'number') {
    throw new Error('WorldConfig is missing travel.gameSecondsPerDistanceUnit');
  }
  if (typeof t.exploreDurationGameSeconds !== 'number') {
    throw new Error('WorldConfig is missing travel.exploreDurationGameSeconds');
  }
  const inc = t.incident;
  if (!inc) throw new Error('WorldConfig is missing travel.incident');
  if (typeof inc.incidentChance !== 'number') {
    throw new Error('WorldConfig is missing travel.incident.incidentChance');
  }
  if (!inc.categories) throw new Error('WorldConfig is missing travel.incident.categories');
  if (!inc.intensityWeights) throw new Error('WorldConfig is missing travel.incident.intensityWeights');
  if (!inc.turnIntensityByCategory) {
    throw new Error('WorldConfig is missing travel.incident.turnIntensityByCategory');
  }
  return t;
}

// Quantize node coords into stable integer keys for seeding — the same 1e3
// quantization poiEngine's nodeKeys uses, so an incident draw is pinned to the
// origin node's exact coordinate.
function nodeKeys(node) {
  return { kx: Math.round(node.x * 1000), ky: Math.round(node.y * 1000) };
}

// Weighted-table entries in a stable (sorted-name) order, the same discipline
// as poiEngine's availableCategories: the pick must never depend on the
// config's JSON key order.
function sortedWeightEntries(table) {
  return Object.keys(table)
    .sort()
    .map((name) => ({ name, weight: typeof table[name] === 'number' ? table[name] : table[name].weight }));
}

// derivePlayerNodeId — PURE. Where the player is, replayed from the log alone:
// the last TRAVEL_ARRIVED's nodeId, or the deterministic origin if the player
// has never completed a leg. (While a leg is in transit the player still
// "is" at the origin node of that leg — position only commits on arrival.)
export function derivePlayerNodeId(log, originNodeId) {
  let nodeId = originNodeId;
  for (const entry of log) {
    if (entry.type === TRAVEL_ARRIVED) nodeId = entry.payload.nodeId;
  }
  return nodeId;
}

// deriveLegCount — PURE. How many legs have ever been started, replayed from
// ACTION_TRAVEL_STARTED entries. The SOLE source of a leg's index (poiEngine's
// deriveBlindAttemptCount discipline): it feeds only the incident RNG seed,
// never probabilities, and is never a mutable counter that could drift.
export function deriveLegCount(log) {
  let count = 0;
  for (const entry of log) {
    if (entry.type === ACTION_TRAVEL_STARTED) count += 1;
  }
  return count;
}

// deriveActiveActivity — PURE. The open timed activity (a travel leg or an
// explore window) with its elapsed game-seconds, or null when idle. Elapsed
// time follows WorldClockEngine's exact dilation rule: an entry's own
// timeContext applies BEFORE its contribution; CLOCK_TICK contributes
// realSecondsElapsed × multiplier[activeContext]; CLOCK_JUMP contributes its
// flat gameSecondsElapsed. This is the source of truth the engine's activity
// cache must reproduce (see rebuildActiveActivity), and it is also how a
// loaded mid-activity save resumes: the open activity and its progress fall
// straight out of the log.
export function deriveActiveActivity(config, log) {
  const multipliers = config?.timeDilation?.multipliers;
  if (!multipliers) {
    throw new Error('WorldConfig is missing timeDilation.multipliers');
  }

  let context = IDLE_TIME_CONTEXT;
  let activity = null;

  for (const entry of log) {
    if (typeof entry.payload?.timeContext === 'string') {
      context = entry.payload.timeContext;
    }
    if (entry.type === ACTION_TRAVEL_STARTED) {
      const { fromNodeId, toNodeId, legIndex, durationGameSeconds } = entry.payload;
      activity = {
        kind: 'travel',
        startedSeq: entry.seq,
        fromNodeId,
        toNodeId,
        legIndex,
        durationGameSeconds,
        elapsedGameSeconds: 0,
      };
    } else if (entry.type === ACTION_EXPLORE_STARTED) {
      activity = {
        kind: 'explore',
        startedSeq: entry.seq,
        nodeId: entry.payload.nodeId,
        durationGameSeconds: entry.payload.durationGameSeconds,
        elapsedGameSeconds: 0,
      };
    } else if (entry.type === TRAVEL_ARRIVED || entry.type === ACTION_EXPLORE_ENDED) {
      activity = null;
    } else if (entry.type === 'CLOCK_TICK' && activity) {
      const multiplier = multipliers[context];
      if (typeof multiplier !== 'number') {
        throw new Error(`No dilation multiplier configured for timeContext "${context}"`);
      }
      activity.elapsedGameSeconds += entry.payload.realSecondsElapsed * multiplier;
    } else if (entry.type === 'CLOCK_JUMP' && activity) {
      activity.elapsedGameSeconds += entry.payload.gameSecondsElapsed;
    }
  }
  return activity;
}

// deriveTravelIncidents — PURE. Every leg's committed incident, in log order,
// with each later TRAVEL_NARRATION_ENHANCED folding its AI line over the
// matching incident's display text (last one wins, matching live apply order).
// The rolled facts — category/intensity/resolutionMode/outcome — are never
// touched by enhancement; only `narration` is display text.
export function deriveTravelIncidents(log) {
  const incidents = [];
  for (const entry of log) {
    if (entry.type === TRAVEL_INCIDENT) {
      incidents.push({ ...entry.payload });
    } else if (entry.type === TRAVEL_NARRATION_ENHANCED) {
      const incident = incidents.find((i) => i.legIndex === entry.payload.legIndex);
      if (incident) incident.narration = entry.payload.narration;
    }
  }
  return incidents;
}

// deriveTravelIncident — PURE. The seeded incident roll for one leg: same seed
// + same leg → same incident, every time. Seeds a fresh mulberry32 from the
// origin node's quantized coordinate and the leg index (the POI-explore
// idiom), then makes a FIXED number of draws in a FIXED order — the gate,
// category, intensity, and passthrough-flavor draws are all consumed even when
// an earlier draw made them moot, so the stream position never depends on the
// outcome and a config retune can never shift later draws.
//
// resolutionMode is a config LOOKUP, not a draw: intensity at or above
// turnIntensityByCategory[category] marks the incident as 'requiresRealTurn'
// — the branch a future combat/social system hooks into (see header). This
// pass resolves 'requiresRealTurn' as outcome:'auto-passthrough' with a
// fought/talked flavor.
export function deriveTravelIncident(config, fromNode, legIndex) {
  const inc = readTravel(config).incident;
  const seed = mapSeed(config);
  const { kx, ky } = nodeKeys(fromNode);
  const rng = mulberry32(hashCoords(seed, TRAVEL_INCIDENT_SALT + legIndex, kx, ky));

  const gateDraw = rng();
  const categoryDraw = rng();
  const intensityDraw = rng();
  const flavorDraw = rng();

  if (gateDraw >= inc.incidentChance) {
    return { category: 'none', outcome: 'none' };
  }

  const category = weightedPick(sortedWeightEntries(inc.categories), categoryDraw);
  const intensity = Number(weightedPick(sortedWeightEntries(inc.intensityWeights), intensityDraw));
  const turnAt = inc.turnIntensityByCategory[category];
  const resolutionMode = typeof turnAt === 'number' && intensity >= turnAt ? 'requiresRealTurn' : 'auto';

  if (resolutionMode === 'requiresRealTurn') {
    return {
      category,
      intensity,
      resolutionMode,
      outcome: 'auto-passthrough',
      passthroughFlavor: flavorDraw < 0.5 ? 'fought' : 'talked',
    };
  }
  return { category, intensity, resolutionMode, outcome: 'auto' };
}

// describeNode — a compact factual phrase for the narration prompt. Facts
// only; the AI colors, it never decides.
function describeNode(node) {
  if (!node) return 'unknown terrain';
  const c = node.classification;
  if (c?.kind === 'settlement') return `a ${c.tier} (${node.terrainType} terrain)`;
  return `${node.terrainType} wilderness`;
}

// buildNarrationPrompt — every fact is already rolled and committed; the
// prompt says so explicitly. One short paragraph, second person, no choices.
function buildNarrationPrompt(facts) {
  const minutes = Math.max(1, Math.round(facts.durationGameSeconds / 60));
  const journey =
    `The traveler goes on foot from ${facts.fromDescription} to ${facts.toDescription}, ` +
    `heading ${facts.heading}, a trip of about ${minutes} minutes.`;
  let event;
  if (facts.category === 'none') {
    event = 'The trip passes without incident.';
  } else if (facts.outcome === 'auto-passthrough') {
    const how = facts.passthroughFlavor === 'fought' ? 'fought it off and came through roughed up but fine' : 'talked their way past it';
    event = `On the way there is a serious ${facts.category} encounter (severity ${facts.intensity} of 3); the traveler ${how}.`;
  } else {
    event = `On the way there is a minor ${facts.category} encounter (severity ${facts.intensity} of 3) that resolves itself without danger.`;
  }
  return (
    `${journey} ${event} ` +
    `These facts are already decided — do NOT change what happened, add encounters, or leave the outcome open. ` +
    `In ONE short second-person paragraph (2-3 sentences), narrate this stretch of travel vividly. ` +
    `Reply with only that paragraph — no quotes, no preamble.`
  );
}

// createTravelEngine — the stateful engine. Same factory contract as the other
// engines, with mapEngine and poiEngine as injected collaborators (memoryEngine's
// registry/presence shape): the map supplies nodes/edges/materialization, the
// POI engine supplies the explore roll, and this engine gives both their real
// player-facing caller.
export function createTravelEngine(world, mapEngine, poiEngine) {
  const { config } = world.getState();
  const travel = readTravel(config); // validate up front

  // Redundant accelerator caches, each fully rebuildable from the log alone
  // (see the rebuild* methods):
  //   cachedPlayerNodeId — derivePlayerNodeId
  //   cachedActivity     — deriveActiveActivity (null when idle)
  //   cachedIncidents    — deriveTravelIncidents (log order = legIndex order)
  // Primed here from whatever history the log already holds (cold-start
  // against a loaded save — a mid-activity save resumes because the open
  // activity and its elapsed progress derive straight from the log), exactly
  // as WorldClockEngine primes via deriveTotalGameSeconds.
  let cachedPlayerNodeId = derivePlayerNodeId(world.getEventLog(), mapEngine.getOriginNode().id);
  let cachedActivity = deriveActiveActivity(config, world.getEventLog());
  const cachedIncidents = deriveTravelIncidents(world.getEventLog());

  // --- APPLY handlers: the ONE live code path per event type that folds it
  // into the caches. They never dispatch (the save/load discipline: priming
  // and live application must be the same inert fold).

  function applyTravelStarted(entry) {
    if (cachedActivity) {
      throw new Error('TravelEngine: ACTION_TRAVEL_STARTED while an activity is already open');
    }
    const { fromNodeId, toNodeId, legIndex, durationGameSeconds } = entry.payload;
    cachedActivity = {
      kind: 'travel',
      startedSeq: entry.seq,
      fromNodeId,
      toNodeId,
      legIndex,
      durationGameSeconds,
      elapsedGameSeconds: 0,
    };
  }

  function applyExploreStarted(entry) {
    if (cachedActivity) {
      throw new Error('TravelEngine: ACTION_EXPLORE_STARTED while an activity is already open');
    }
    cachedActivity = {
      kind: 'explore',
      startedSeq: entry.seq,
      nodeId: entry.payload.nodeId,
      durationGameSeconds: entry.payload.durationGameSeconds,
      elapsedGameSeconds: 0,
    };
  }

  function applyClockTick(entry) {
    if (!cachedActivity) return;
    // Same per-tick context derivation the clock engine itself uses: the tick
    // is already in the log, so deriving up to its seq sees its own context.
    const context = deriveActiveTimeContext(world.getEventLog(), entry.seq);
    const multiplier = config.timeDilation.multipliers[context];
    if (typeof multiplier !== 'number') {
      throw new Error(`No dilation multiplier configured for timeContext "${context}"`);
    }
    cachedActivity.elapsedGameSeconds += entry.payload.realSecondsElapsed * multiplier;
  }

  function applyClockJump(entry) {
    if (!cachedActivity) return;
    cachedActivity.elapsedGameSeconds += entry.payload.gameSecondsElapsed;
  }

  function applyTravelIncident(entry) {
    cachedIncidents.push({ ...entry.payload });
  }

  function applyNarrationEnhanced(entry) {
    const incident = cachedIncidents.find((i) => i.legIndex === entry.payload.legIndex);
    if (incident) incident.narration = entry.payload.narration;
  }

  function applyTravelArrived(entry) {
    cachedPlayerNodeId = entry.payload.nodeId;
    cachedActivity = null;
  }

  function applyExploreEnded() {
    cachedActivity = null;
  }

  // --- REACT handlers: resolve live decisions and DISPATCH (memoryEngine's
  // recordMemory shape). Deliberately NOT primed over history at construction —
  // their output (TRAVEL_INCIDENT, TRAVEL_NARRATION_ENHANCED, TRAVEL_ARRIVED,
  // ACTION_EXPLORE_ENDED, MAP_NEIGHBORS_MATERIALIZED) is already in a loaded
  // log, so loading a save can never re-roll incidents or re-fire AI calls.

  // enhanceNarration — ask the plugin for an AI-written line coloring the
  // already-committed facts and, on success, COMMIT it as its own log event so
  // save/load replay restores the AI text, not just the fallback. Fire-and-
  // forget; generateTravelNarration never throws. Only called when the plugin
  // is live (guarded in reactTravelStarted), so under Node the fallback stays.
  async function enhanceNarration(legIndex, prompt) {
    const result = await generateTravelNarration(prompt);
    if (result.ok) {
      world.dispatch(TRAVEL_NARRATION_ENHANCED, { legIndex, narration: result.narration });
      log('AI', 'travel narration generated (live AI path)');
    } else {
      log('AI', `travel narration ${result.reason} -> fallback retained`);
    }
  }

  // reactTravelStarted — phase 1 then phase 2, in that order and in the same
  // synchronous dispatch: the seeded roll commits every stake as a
  // TRAVEL_INCIDENT (with its deterministic fallback narration) the instant
  // travel starts, and only THEN is the AI asked to color those fixed facts.
  // All facts are known here, at the leg's first moment, so the AI call's
  // latency runs concurrently with the leg's dilated time window.
  function reactTravelStarted(entry) {
    const { fromNodeId, toNodeId, heading, legIndex, distance, durationGameSeconds } = entry.payload;
    const fromNode = mapEngine.getNode(fromNodeId);
    const roll = deriveTravelIncident(config, fromNode, legIndex);

    const payload = {
      legIndex,
      fromNodeId,
      toNodeId,
      category: roll.category,
      outcome: roll.outcome,
    };
    if (roll.category !== 'none') {
      payload.intensity = roll.intensity;
      payload.resolutionMode = roll.resolutionMode;
    }
    if (roll.passthroughFlavor) payload.passthroughFlavor = roll.passthroughFlavor;
    payload.narration = fallbackTravelNarration(payload);
    world.dispatch(TRAVEL_INCIDENT, payload);

    if (typeof generateText === 'function') {
      const prompt = buildNarrationPrompt({
        fromDescription: describeNode(fromNode),
        toDescription: describeNode(mapEngine.getNode(toNodeId)),
        heading,
        distance,
        durationGameSeconds,
        category: payload.category,
        intensity: payload.intensity,
        outcome: payload.outcome,
        passthroughFlavor: payload.passthroughFlavor,
      });
      enhanceNarration(legIndex, prompt).catch(() => {});
    }
  }

  // reactClockTick — completion. Runs AFTER applyClockTick (subscription
  // order), so it sees this tick's contribution folded in. The final tick's
  // full contribution counts — no partial-tick splitting — so a leg can
  // overshoot its duration by up to one tick's worth of game-time; accepted.
  function reactClockTick() {
    if (!cachedActivity) return;
    if (cachedActivity.elapsedGameSeconds < cachedActivity.durationGameSeconds) return;
    if (cachedActivity.kind === 'travel') {
      world.dispatch(TRAVEL_ARRIVED, {
        nodeId: cachedActivity.toNodeId,
        legIndex: cachedActivity.legIndex,
        timeContext: IDLE_TIME_CONTEXT,
      });
    } else {
      world.dispatch(ACTION_EXPLORE_ENDED, {
        nodeId: cachedActivity.nodeId,
        timeContext: IDLE_TIME_CONTEXT,
      });
    }
  }

  // reactTravelArrived — arriving somewhere new materializes its neighbors so
  // onward edges exist (the explore-forward loop). A react handler, not an
  // apply: first-time materialization dispatches MAP_NEIGHBORS_MATERIALIZED.
  // On load, past arrivals' materializations are already in the log, and
  // materializeNeighbors is idempotent besides.
  function reactTravelArrived(entry) {
    mapEngine.materializeNeighbors(entry.payload.nodeId);
  }

  // Subscribe. ORDER MATTERS twice over: apply handlers are registered before
  // react handlers for the same type so a react always sees this entry's own
  // effects in the caches; and the engine must be constructed before the tick
  // source starts (or any new travel dispatch) so nothing is missed.
  world.subscribe(ACTION_TRAVEL_STARTED, applyTravelStarted);
  world.subscribe(ACTION_EXPLORE_STARTED, applyExploreStarted);
  world.subscribe('CLOCK_TICK', applyClockTick);
  world.subscribe('CLOCK_JUMP', applyClockJump);
  world.subscribe(TRAVEL_INCIDENT, applyTravelIncident);
  world.subscribe(TRAVEL_NARRATION_ENHANCED, applyNarrationEnhanced);
  world.subscribe(TRAVEL_ARRIVED, applyTravelArrived);
  world.subscribe(ACTION_EXPLORE_ENDED, applyExploreEnded);

  world.subscribe(ACTION_TRAVEL_STARTED, reactTravelStarted);
  world.subscribe('CLOCK_TICK', reactClockTick);
  world.subscribe(TRAVEL_ARRIVED, reactTravelArrived);

  // --- Verbs.

  // startTravel — the real travel verb. One leg to an ADJACENT node: the
  // destination must be an existing edge of the player's current node, and the
  // target must be passable. Duration comes from real edge geometry. Dispatches
  // ACTION_TRAVEL_STARTED (timeContext:'traveling' — the dilated window opens
  // here); the react handler above commits the incident and kicks off
  // narration; arrival is tick-driven. Returns the dispatched entry.
  function startTravel(toNodeId) {
    if (cachedActivity) {
      throw new Error('TravelEngine: cannot start travel — an activity is already in progress');
    }
    const fromNode = mapEngine.getNode(cachedPlayerNodeId);
    const edge = fromNode.edges.find((e) => e.to === toNodeId);
    if (!edge) {
      throw new Error(`TravelEngine: "${toNodeId}" is not adjacent to "${fromNode.id}"`);
    }
    const toNode = mapEngine.getNode(toNodeId);
    if (!toNode || !toNode.passable) {
      throw new Error(`TravelEngine: "${toNodeId}" is not passable`);
    }
    const distance = Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y);
    return world.dispatch(ACTION_TRAVEL_STARTED, {
      fromNodeId: fromNode.id,
      toNodeId,
      heading: edge.heading,
      distance,
      durationGameSeconds: distance * travel.gameSecondsPerDistanceUnit,
      legIndex: deriveLegCount(world.getEventLog()),
      timeContext: TRAVEL_TIME_CONTEXT,
    });
  }

  // startExplore / startExploreDirected — the real explore verbs: poiEngine's
  // exploreBlind/exploreDirected finally get a player-facing caller, used
  // AS-IS. The roll and its result are instant (poiEngine dispatches
  // POI_EXPLORED carrying timeContext:'exploring' and returns the discovered
  // id immediately); what this wrapper adds is the timed window — the
  // 'exploring' dilation rides for exploreDurationGameSeconds, then the
  // tick-driven completion above dispatches ACTION_EXPLORE_ENDED back to idle.
  function startExplore() {
    if (cachedActivity) {
      throw new Error('TravelEngine: cannot explore — an activity is already in progress');
    }
    const node = mapEngine.getNode(cachedPlayerNodeId);
    const poiId = poiEngine.exploreBlind(node);
    const entry = world.dispatch(ACTION_EXPLORE_STARTED, {
      nodeId: node.id,
      durationGameSeconds: travel.exploreDurationGameSeconds,
    });
    return { poiId, entry };
  }

  function startExploreDirected(poiId) {
    if (cachedActivity) {
      throw new Error('TravelEngine: cannot explore — an activity is already in progress');
    }
    const node = mapEngine.getNode(cachedPlayerNodeId);
    const foundId = poiEngine.exploreDirected(node, poiId);
    const entry = world.dispatch(ACTION_EXPLORE_STARTED, {
      nodeId: node.id,
      durationGameSeconds: travel.exploreDurationGameSeconds,
    });
    return { poiId: foundId, entry };
  }

  // --- Reads (copies — callers can never mutate the caches).

  function getPlayerNodeId() {
    return cachedPlayerNodeId;
  }

  function getActiveActivity() {
    return cachedActivity ? { ...cachedActivity } : null;
  }

  function getIncident(legIndex) {
    const incident = cachedIncidents.find((i) => i.legIndex === legIndex);
    return incident ? { ...incident } : null;
  }

  function getIncidents() {
    return cachedIncidents.map((i) => ({ ...i }));
  }

  // --- Rebuilds: each cache recomputed from the log alone, ignoring the
  // incremental caches. Their equality with the cached values is the
  // rebuildability proof (mirrors rebuildFactionControl / rebuildMemories).

  function rebuildPlayerNodeId() {
    return derivePlayerNodeId(world.getEventLog(), mapEngine.getOriginNode().id);
  }

  function rebuildActiveActivity() {
    return deriveActiveActivity(config, world.getEventLog());
  }

  function rebuildIncidents() {
    return deriveTravelIncidents(world.getEventLog());
  }

  return {
    startTravel,
    startExplore,
    startExploreDirected,
    getPlayerNodeId,
    getActiveActivity,
    getIncident,
    getIncidents,
    rebuildPlayerNodeId,
    rebuildActiveActivity,
    rebuildIncidents,
  };
}
