// engines/factionEngine.js — which faction controls a settlement.
//
// Faction control is the ONE piece of node classification that is not a pure
// position function: control starts as a DERIVED BASELINE (deriveBaselineFaction-
// Control in engines/worldMapEngine.js, a pure function of the settlement's
// coordinates) but MUST change over play — wars, quest outcomes, overthrows. So
// it takes the same two-layer shape as the relationship store and the world
// clock: a deterministic baseline plus FACTION_CONTROL_CHANGED events appended to
// the shared world log that override it going forward.
//
// The current controller is therefore DERIVED, never a mutable field that gets
// overwritten — exactly the mistake the relationship-store redesign fixed. It is
// the baseline unless superseded by the most recent FACTION_CONTROL_CHANGED for
// that settlement, replayed the same way engines/worldClockEngine.js derives the
// active time context (last-write-wins), not summed like relationship stats.
//
// The engine keeps an incrementally-maintained cache of overrides, but that cache
// is only ever an optimization: rebuildFactionControl recomputes from the log
// alone and must match (see the rebuildability proof), the same standing as
// rebuildRelationshipStats / rebuildTotalGameSeconds.
//
// Faction rosters/lore are future scope — factionId is an opaque string here.

const FACTION_CONTROL_CHANGED = 'FACTION_CONTROL_CHANGED';

// deriveFactionControl — PURE. The controlling faction of a settlement: start
// from its derived baseline, then replay the log applying every
// FACTION_CONTROL_CHANGED for that settlement in order — the last one wins
// (last-write-wins, like deriveActiveTimeContext). A null factionId is a valid
// value (the settlement was taken to "uncontrolled"), distinct from "no override,
// fall back to baseline". Returns a factionId string or null.
export function deriveFactionControl(log, settlementId, baselineFaction) {
  let controller = baselineFaction ?? null;
  for (const entry of log) {
    if (entry.type !== FACTION_CONTROL_CHANGED) continue;
    if (entry.payload.settlementId !== settlementId) continue;
    controller = entry.payload.factionId ?? null;
  }
  return controller;
}

export function createFactionEngine(world) {
  // cachedOverrides: settlementId -> the latest overridden factionId (may be
  // null for "taken to uncontrolled"). A settlement with NO entry here has never
  // been overridden and falls back to its derived baseline. Always fully
  // rebuildable from the log via deriveFactionControl.
  const cachedOverrides = new Map();

  // ORDER MATTERS, exactly as with the relationship store: this subscription
  // must be registered before any FACTION_CONTROL_CHANGED is dispatched (seeds
  // included) or the cache would miss those early events and silently go stale.
  world.subscribe(FACTION_CONTROL_CHANGED, (entry) => {
    const { settlementId, factionId } = entry.payload;
    cachedOverrides.set(settlementId, factionId ?? null);
  });

  // setFactionControl — the single sanctioned way to change control. It only
  // dispatches; the subscribe handler above updates the cache. This keeps control
  // append-only and rebuildable, never a directly-mutated field.
  function setFactionControl(settlementId, factionId) {
    return world.dispatch(FACTION_CONTROL_CHANGED, { settlementId, factionId: factionId ?? null });
  }

  // getFactionControl — current controller of a settlement node. Reads the
  // override cache if the settlement has ever been overridden, else falls back to
  // the node's derived baseline faction. `node` is a classified settlement node
  // (its classification carries settlementId + baselineFaction).
  function getFactionControl(node) {
    const { settlementId, baselineFaction } = node.classification;
    if (cachedOverrides.has(settlementId)) return cachedOverrides.get(settlementId);
    return baselineFaction ?? null;
  }

  // rebuildFactionControl — recompute a settlement's controller from the log
  // alone, ignoring the cache. Its equality with getFactionControl is the
  // rebuildability proof (mirrors rebuildRelationshipStats).
  function rebuildFactionControl(node) {
    return deriveFactionControl(world.getEventLog(), node.classification.settlementId, node.classification.baselineFaction);
  }

  return {
    setFactionControl,
    getFactionControl,
    rebuildFactionControl,
  };
}
