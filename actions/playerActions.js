// actions/playerActions.js — thin player verbs.
//
// Each function does nothing but dispatch a raw event — no relationship math,
// no memory logic lives here. Independent engines (relationshipEffectEngine,
// memoryEngine) react to these same dispatched events without knowing about
// each other or about this module.

export function helpNpc(world, actorId, targetId) {
  return world.dispatch('PLAYER_HELPED', { actorId, targetId });
}

export function robNpc(world, actorId, targetId) {
  return world.dispatch('PLAYER_ROBBED', { actorId, targetId });
}

export function ignoreNpc(world, actorId, targetId) {
  return world.dispatch('PLAYER_IGNORED', { actorId, targetId });
}
