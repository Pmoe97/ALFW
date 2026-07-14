// engines/questEngine.js — the quest/contract state machine: available →
// active → completed | failed, over the hand-authored definitions in
// engines/questData.js.
//
// This engine is chiefly an INTEGRATION layer over systems that already
// exist, and it detects objectives by PURE LOG-REPLAY DERIVATION: an
// objective is "met" iff the log, read after the quest's QUEST_ACCEPTED
// entry, contains the matching fact (a POI_DISCOVERED, a TRAVEL_ARRIVED, a
// CRAFT_COMPLETED, an ITEMS_TRANSFERRED) or currently derives to the required
// state (relationship tier, holdings for a pending delivery). There is
// deliberately NO per-objective-type subscription wiring — the engine
// subscribes to nothing but its own QUEST_* events (for the status cache), so
// a new objective type later is one new matcher case here, never a new
// subscription, and there is nothing reactive that a cold-start prime could
// accidentally re-fire.
//
// Apply vs react (the economy/memory rule, load-bearing here):
//  - The apply handlers fold only the three committed QUEST_* facts into the
//    status cache, primed over history at construction.
//  - The verbs (acceptQuest / completeQuest / abandonQuest) are REACT
//    operations: they resolve everything live and dispatch through the REAL
//    existing systems — poi.injectPoi / poi.grantRevealAuthority on accept
//    (their first non-debug caller), economy.transferItems for deliveries,
//    economy.grantGold / grantItems, relationships.recordRelationshipEvent,
//    and faction.setFactionControl for rewards. They are never primed: a
//    loaded log already contains their outcomes, so loading a save can never
//    re-inject a POI or re-grant a reward.
//  - completeQuest dispatches the STATUS-CHANGING event LAST: deliveries and
//    every reward grant commit first, and QUEST_COMPLETED only after all of
//    them succeeded — a failure at any point leaves the quest safely
//    'active' (retryable), never terminally 'completed' with rewards
//    silently missing. The one step with a real post-validation failure mode
//    (transferItems, which revalidates holdings) runs before anything else
//    has been dispatched; the grants after it are dispatch-only mutators
//    validated up front.
//
// No RNG anywhere: quest state and reward resolution are fully deterministic.

import { deriveInventory } from './economyEngine.js';
import { getItemDef } from './economyData.js';
import { deriveRelationshipStats, relationshipTier, TIER_THRESHOLDS } from '../entities/relationshipStore.js';
import { getQuestDef, questIds } from './questData.js';

const QUEST_ACCEPTED = 'QUEST_ACCEPTED';
const QUEST_COMPLETED = 'QUEST_COMPLETED';
const QUEST_FAILED = 'QUEST_FAILED';

// The ordinary tier ladder in ascending order, straight from the store's own
// thresholds. The divergence tiers ('complicated', 'resentful') are absent on
// purpose: they never satisfy a reachRelationshipTier objective — a warm-but-
// untrusted edge is not "friend".
const TIER_LADDER = TIER_THRESHOLDS.map((t) => t.label);

function tierMeets(currentTier, requiredTier) {
  const current = TIER_LADDER.indexOf(currentTier);
  const required = TIER_LADDER.indexOf(requiredTier);
  return current >= 0 && required >= 0 && current >= required;
}

function emptyStatus() {
  return { status: 'available', acceptedSeq: null, resolvedSeq: null };
}

// deriveQuestStatuses — PURE. Every quest's lifecycle state, replayed from
// QUEST_* entries alone: 'available' until QUEST_ACCEPTED, then 'active'
// until QUEST_COMPLETED / QUEST_FAILED (both terminal in v1 — no re-accept;
// a future retry mechanic would be a new event, not a rewrite). Keyed by
// questId; every shipped def is present even with no events (available), and
// log-only ids (a def removed from a later build) still fold defensively.
export function deriveQuestStatuses(log) {
  const statuses = {};
  for (const id of questIds()) statuses[id] = emptyStatus();
  const ensure = (questId) => (statuses[questId] ??= emptyStatus());
  for (const entry of log) {
    if (entry.type === QUEST_ACCEPTED) {
      const s = ensure(entry.payload.questId);
      s.status = 'active';
      s.acceptedSeq = entry.seq;
    } else if (entry.type === QUEST_COMPLETED) {
      const s = ensure(entry.payload.questId);
      s.status = 'completed';
      s.resolvedSeq = entry.seq;
    } else if (entry.type === QUEST_FAILED) {
      const s = ensure(entry.payload.questId);
      s.status = 'failed';
      s.resolvedSeq = entry.seq;
    }
  }
  return statuses;
}

// deriveTransferredStacks — PURE helper. Quantities the player has handed a
// specific NPC after acceptance, summed over ITEMS_TRANSFERRED entries. What
// makes a delivery objective stay "done" after turn-in consumed the goods.
function deriveTransferredStacks(log, acceptedSeq, fromId, toId) {
  const totals = {};
  for (const entry of log) {
    if (entry.type !== 'ITEMS_TRANSFERRED') continue;
    if (entry.seq <= acceptedSeq) continue;
    const p = entry.payload;
    if (p.fromId !== fromId || p.toId !== toId) continue;
    for (const [defId, qty] of Object.entries(p.stacks ?? {})) {
      totals[defId] = (totals[defId] ?? 0) + qty;
    }
  }
  return totals;
}

// matchObjective — PURE. One objective's progress against the log:
// { done, note, delivered? }. Windowed types (discoverPoi / travelTo /
// craftRecipe) count only facts with seq > acceptedSeq — pre-acceptance
// history never satisfies a contract. Current-state types (deliverItems
// readiness, reachRelationshipTier) evaluate the derived present. For an
// unaccepted quest pass acceptedSeq = Infinity: windowed matchers see
// nothing, state matchers still preview honestly.
function matchObjective(log, objective, acceptedSeq, playerId) {
  switch (objective.type) {
    case 'discoverPoi': {
      const done = log.some(
        (e) => e.type === 'POI_DISCOVERED' && e.seq > acceptedSeq && e.payload.poiId === objective.poiId
      );
      return { done, note: done ? 'found' : 'not yet found' };
    }
    case 'travelTo': {
      const done = log.some(
        (e) => e.type === 'TRAVEL_ARRIVED' && e.seq > acceptedSeq && e.payload.nodeId === objective.nodeId
      );
      return { done, note: done ? 'visited' : 'not yet visited' };
    }
    case 'craftRecipe': {
      let crafted = 0;
      for (const e of log) {
        if (e.type !== 'CRAFT_COMPLETED' || e.seq <= acceptedSeq) continue;
        if (e.payload.actorId === playerId && e.payload.recipeId === objective.recipeId) crafted += 1;
      }
      return { done: crafted >= objective.count, note: `${Math.min(crafted, objective.count)}/${objective.count} crafted` };
    }
    case 'deliverItems': {
      // Delivered (turn-in consumed the goods) OR ready (currently held) both
      // read as done — 'done' means "satisfiable at turn-in, or satisfied".
      const transferred = deriveTransferredStacks(log, acceptedSeq, playerId, objective.npcId);
      const delivered = Object.entries(objective.stacks).every(([defId, qty]) => (transferred[defId] ?? 0) >= qty);
      if (delivered) return { done: true, delivered: true, note: 'delivered' };
      const holdings = deriveInventory(log, playerId);
      const parts = [];
      let ready = true;
      for (const [defId, qty] of Object.entries(objective.stacks)) {
        const have = holdings.stacks[defId] ?? 0;
        if (have < qty) ready = false;
        parts.push(`${getItemDef(defId).name} ${Math.min(have, qty)}/${qty}`);
      }
      return { done: ready, delivered: false, note: ready ? 'ready to deliver' : parts.join(', ') };
    }
    case 'reachRelationshipTier': {
      const tier = relationshipTier(deriveRelationshipStats(log, objective.npcId, playerId));
      const done = tierMeets(tier, objective.tier);
      return { done, note: done ? `${objective.tier} reached` : `${tier}, needs ${objective.tier}` };
    }
    default:
      throw new Error(`Unknown objective type "${objective.type}"`);
  }
}

// deriveObjectiveProgress — PURE. Every objective of a quest with its live
// progress: [{ id, text, done, note }]. Computed on demand, never cached
// (the reputationEngine precedent — an accelerator can come later and must
// stay rebuildable; at this log scale the replay is cheap and can never go
// stale).
export function deriveObjectiveProgress(log, questId, playerId) {
  const def = getQuestDef(questId);
  const status = deriveQuestStatuses(log)[questId];
  const acceptedSeq = status.acceptedSeq ?? Infinity;
  return def.objectives.map((objective) => {
    const { done, note } = matchObjective(log, objective, acceptedSeq, playerId);
    return { id: objective.id, text: objective.text, done, note };
  });
}

// createQuestEngine — the stateful engine. Same factory contract as the
// others; collaborators are the REAL engines its verbs dispatch through
// (memoryEngine's injected-collaborator shape). playerId is the acting
// entity every objective and reward resolves against.
export function createQuestEngine(world, { playerId, economy, relationships, faction, poi, travel, combat = null }) {
  // The one cache: questId -> { status, acceptedSeq, resolvedSeq }. A
  // provably-redundant accelerator over deriveQuestStatuses (see
  // rebuildQuestStatuses). Objective progress is deliberately uncached.
  const statusByQuest = new Map();
  for (const id of questIds()) statusByQuest.set(id, emptyStatus());

  function statusOf(questId) {
    if (!statusByQuest.has(questId)) statusByQuest.set(questId, emptyStatus());
    return statusByQuest.get(questId);
  }

  // --- apply handlers — the ONE cache-write path per event type. Primed
  // over history at construction, then live via the subscriptions. They only
  // fold the committed status facts; side effects live in the verbs.
  function applyAccepted(entry) {
    const s = statusOf(entry.payload.questId);
    s.status = 'active';
    s.acceptedSeq = entry.seq;
  }
  function applyCompleted(entry) {
    const s = statusOf(entry.payload.questId);
    s.status = 'completed';
    s.resolvedSeq = entry.seq;
  }
  function applyFailed(entry) {
    const s = statusOf(entry.payload.questId);
    s.status = 'failed';
    s.resolvedSeq = entry.seq;
  }

  const APPLY = {
    [QUEST_ACCEPTED]: applyAccepted,
    [QUEST_COMPLETED]: applyCompleted,
    [QUEST_FAILED]: applyFailed,
  };

  // Prime from existing history (cold-start against a loaded save), then
  // subscribe. ONLY the apply handlers are primed — the verbs below never
  // fold history (their outcomes ARE the history).
  for (const entry of world.getEventLog()) {
    APPLY[entry.type]?.(entry);
  }
  for (const [type, handler] of Object.entries(APPLY)) {
    world.subscribe(type, handler);
  }

  // --- readers (clones — callers can never mutate the cache).

  function getQuestStatuses() {
    const out = {};
    for (const [questId, s] of statusByQuest) out[questId] = { ...s };
    return out;
  }

  function getObjectiveProgress(questId) {
    return deriveObjectiveProgress(world.getEventLog(), questId, playerId);
  }

  // --- react verbs: resolve live, dispatch through the real systems, and
  // commit the status fact. A failed attempt leaves the log untouched.

  // acceptQuest — available → active, gated to the giver's node (the guild
  // board is a place, not a menu). After committing QUEST_ACCEPTED, the
  // def's onAccept hooks run through the POI engine's real entry points:
  // injectPoi puts the quest's target into the world, grantRevealAuthority
  // arms the travel screen's directed "Seek out" lead for it.
  function acceptQuest(questId) {
    const fail = (reason) => ({ ok: false, reason });
    if (combat?.getActiveCombat()) return fail('a combat is in progress');
    const def = getQuestDef(questId);
    const s = statusOf(questId);
    if (s.status !== 'available') return fail(`quest is ${s.status}, not available`);
    const atNodeId = travel.getPlayerNodeId();
    if (atNodeId !== def.giverNodeId) return fail('you must be at the giver\'s location to accept');

    const entry = world.dispatch(QUEST_ACCEPTED, { questId, atNodeId });
    for (const { nodeId, poi: poiStub } of def.onAccept?.injectPois ?? []) {
      poi.injectPoi(nodeId, poiStub);
    }
    for (const poiId of def.onAccept?.revealPoiIds ?? []) {
      poi.grantRevealAuthority(poiId);
    }
    return { ok: true, entry };
  }

  // completeQuest — turn-in. Validates everything first (status, location,
  // every objective derived-done), then dispatches in the safety order the
  // header describes: deliveries → rewards → QUEST_COMPLETED last.
  function completeQuest(questId) {
    const fail = (reason) => ({ ok: false, reason });
    if (combat?.getActiveCombat()) return fail('a combat is in progress');
    const def = getQuestDef(questId);
    const s = statusOf(questId);
    if (s.status !== 'active') return fail(`quest is ${s.status}, not active`);
    const atNodeId = travel.getPlayerNodeId();
    if (atNodeId !== def.giverNodeId) return fail('you must return to the giver to turn this in');

    const log = world.getEventLog();
    for (const objective of def.objectives) {
      const { done } = matchObjective(log, objective, s.acceptedSeq, playerId);
      if (!done) return fail(`objective not met: ${objective.text}`);
    }

    // Deliveries: consume the goods through the economy's atomic transfer.
    // Skip any delivery a prior attempt already committed (a re-run after an
    // interrupted turn-in must not take the items twice).
    for (const objective of def.objectives) {
      if (objective.type !== 'deliverItems') continue;
      const { delivered } = matchObjective(world.getEventLog(), objective, s.acceptedSeq, playerId);
      if (delivered) continue;
      const transfer = economy.transferItems(playerId, objective.npcId, { stacks: objective.stacks }, questId);
      if (!transfer.ok) return fail(`delivery failed: ${transfer.reason}`);
    }

    // Rewards, through the real systems — no parallel grant mechanism.
    const rewards = def.rewards ?? {};
    if (rewards.gold) economy.grantGold(playerId, rewards.gold, questId);
    if (rewards.items) economy.grantItems(playerId, rewards.items, questId);
    for (const { fromId, toId, axis, delta } of rewards.relationshipEvents ?? []) {
      relationships.recordRelationshipEvent(fromId, toId, axis, delta);
    }
    for (const { settlementId, factionId } of rewards.factionControl ?? []) {
      faction.setFactionControl(settlementId, factionId);
    }

    // The status fact commits LAST — see the header's ordering rationale.
    // The payload embeds the paid-out reward block as the audit record.
    const entry = world.dispatch(QUEST_COMPLETED, { questId, atNodeId, rewards });
    return { ok: true, entry };
  }

  // abandonQuest — active → failed (terminal in v1). No rewards, no refunds;
  // anything the quest injected on accept stays in the world (the camp does
  // not vanish because you stopped looking for it).
  function abandonQuest(questId) {
    const fail = (reason) => ({ ok: false, reason });
    if (combat?.getActiveCombat()) return fail('a combat is in progress');
    getQuestDef(questId); // unknown ids throw, matching the other verbs
    const s = statusOf(questId);
    if (s.status !== 'active') return fail(`quest is ${s.status}, not active`);
    const entry = world.dispatch(QUEST_FAILED, { questId, reason: 'abandoned' });
    return { ok: true, entry };
  }

  // rebuildQuestStatuses — recompute from the log alone, ignoring the cache.
  // Its equality with getQuestStatuses is the rebuildability proof.
  function rebuildQuestStatuses() {
    return deriveQuestStatuses(world.getEventLog());
  }

  return {
    getQuestStatuses,
    getObjectiveProgress,
    acceptQuest,
    completeQuest,
    abandonQuest,
    rebuildQuestStatuses,
  };
}
