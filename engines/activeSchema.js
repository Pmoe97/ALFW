// engines/activeSchema.js — the ONE seam a future ModManager will replace.
//
// Loads base_vanilla.json (vanilla's tunable constants, extracted out of
// engine/entity function bodies), compiles engines/activeMods.js's
// ACTIVE_MODS onto it via engines/schemaCompiler.js's compileSchema, and
// exposes a single accessor over the frozen result. ACTIVE_MODS ships empty,
// so vanilla is still the only *active* layer today, but the compile
// pipeline itself is real: vanilla and any other mod now go through the
// exact same compileSchema -> mergeSchemas/validateModPatch path. Every
// consuming engine imports getSchema() from HERE, never base_vanilla.json
// directly, so the swap point stays singular when a real ModManager
// (persistence, load-order UI, mid-playthrough hot-swap) eventually
// replaces this file's body without touching any caller.
//
// A JSON import attribute, not node:fs: worldState.js's initWorldState()
// uses readFileSync and is never called from the browser bundle (see
// scripts/nodeFsShim.js) — game/sampleWorld.js hand-mirrors worldConfig.json
// as a JS object literal specifically to avoid needing fs in the browser.
// `import ... with { type: 'json' }` sidesteps that problem entirely: esbuild
// inlines .json imports as plain objects at bundle time (zero runtime fs
// calls), and Node resolves the same import natively, so no hand-mirrored
// copy is needed here.
import rawVanilla from '../base_vanilla.json' with { type: 'json' };
import { compileSchema } from './schemaCompiler.js';
import { ACTIVE_MODS } from './activeMods.js';

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const { schema: compiledSchema, skipped } = compileSchema(rawVanilla, ACTIVE_MODS);

for (const { name, errors } of skipped) {
  console.warn(
    `[activeSchema] mod "${name}" skipped: ${errors.map((e) => e.message).join('; ')}`
  );
}

const frozenSchema = deepFreeze(compiledSchema);

// getSchema — the compiled CompiledSchema: base_vanilla.json with
// ACTIVE_MODS folded in, frozen. Returns the same shared object every call;
// callers only ever read from it.
export function getSchema() {
  return frozenSchema;
}
