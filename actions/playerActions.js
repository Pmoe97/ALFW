// actions/playerActions.js — thin player verbs.
//
// Each function does nothing but dispatch a raw event — no relationship math,
// no memory logic lives here. Independent engines (relationshipEffectEngine,
// memoryEngine) react to these same dispatched events without knowing about
// each other or about this module.
//
// The optional `nodeId` names WHERE the interaction happened. memoryEngine uses
// it to fan the memory out to other NPCs present at that node (witnesses);
// relationshipEffectEngine ignores it. When omitted (e.g. acting on a
// hand-authored NPC with no node), only the direct target remembers — the
// current, unchanged behavior.

// Payloads must be JSON-round-trippable (the save file is JSON): a key holding
// `undefined` survives structuredClone into the frozen log but is DROPPED by
// JSON.stringify, so a saved log would no longer deep-equal the live one.
// Omit nodeId entirely when the caller didn't pass one.
function interactionPayload(actorId, targetId, nodeId) {
  const payload = { actorId, targetId };
  if (nodeId !== undefined) payload.nodeId = nodeId;
  return payload;
}

export function helpNpc(world, actorId, targetId, nodeId) {
  return world.dispatch('PLAYER_HELPED', interactionPayload(actorId, targetId, nodeId));
}

export function robNpc(world, actorId, targetId, nodeId) {
  return world.dispatch('PLAYER_ROBBED', interactionPayload(actorId, targetId, nodeId));
}

export function ignoreNpc(world, actorId, targetId, nodeId) {
  return world.dispatch('PLAYER_IGNORED', interactionPayload(actorId, targetId, nodeId));
}

// startDialogue/endDialogue — the real dialogue time-cost verbs. Bracketing a
// conversation dispatches timeContext:'chatting' going in and 'idle' coming
// out, so the real seconds spent inside (including AI latency) dilate at the
// chatting multiplier — WorldClockEngine picks the context off any action's
// payload with zero engine changes. DIALOGUE_LINE itself stays time-inert.
// Call endDialogue in a `finally`: the context must never be left stuck on
// 'chatting' because a dialogue call failed.
export function startDialogue(world, actorId, targetId) {
  return world.dispatch('ACTION_DIALOGUE_STARTED', {
    ...interactionPayload(actorId, targetId),
    timeContext: 'chatting',
  });
}

export function endDialogue(world, actorId, targetId) {
  return world.dispatch('ACTION_DIALOGUE_ENDED', {
    ...interactionPayload(actorId, targetId),
    timeContext: 'idle',
  });
}
