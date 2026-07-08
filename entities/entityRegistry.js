// entities/entityRegistry.js — id -> entity lookup.
//
// Built as a factory taking the world instance, matching the engine pattern
// in engines/ and the store pattern in relationshipStore.js, even though this
// registry doesn't dispatch or subscribe to anything yet. Entities are stored
// by reference (not cloned) — this is the one place direct mutation of an
// entity (e.g. appending a memory) is expected and fine; it does not go
// through WorldState.dispatch because entities are not part of WorldState's
// own data, same as relationshipStore.

export function createEntityRegistry(world) {
  const entities = new Map();

  function register(entity) {
    entities.set(entity.id, entity);
  }

  function get(id) {
    return entities.get(id);
  }

  function all() {
    return [...entities.values()];
  }

  return { register, get, all };
}
