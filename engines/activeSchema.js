// engines/activeSchema.js — the ONE seam a future ModManager will replace.
//
// Loads base_vanilla.json (vanilla's tunable constants, extracted out of
// engine/entity function bodies) and exposes a single accessor. No merge
// grammar, no mod stacking, no SCHEMA_UPDATED — vanilla is the only layer
// today. Every consuming engine imports getSchema() from HERE, never
// base_vanilla.json directly, so the swap point stays singular when a real
// ModManager (deep-merging an ordered stack of mods into one CompiledSchema)
// eventually replaces this file's body without touching any caller.
//
// A JSON import attribute, not node:fs: worldState.js's initWorldState()
// uses readFileSync and is never called from the browser bundle (see
// scripts/nodeFsShim.js) — game/sampleWorld.js hand-mirrors worldConfig.json
// as a JS object literal specifically to avoid needing fs in the browser.
// `import ... with { type: 'json' }` sidesteps that problem entirely: esbuild
// inlines .json imports as plain objects at bundle time (zero runtime fs
// calls), and Node resolves the same import natively, so no hand-mirrored
// copy is needed here.
import schema from '../base_vanilla.json' with { type: 'json' };

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const frozenSchema = deepFreeze(schema);

// getSchema — the vanilla CompiledSchema, today just base_vanilla.json
// parsed and frozen. Returns the same shared object every call; callers only
// ever read from it.
export function getSchema() {
  return frozenSchema;
}
