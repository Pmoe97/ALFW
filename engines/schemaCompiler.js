// engines/schemaCompiler.js — folds an ORDERED stack of mod patches onto a
// base schema, one compilation pass. This is the piece that makes "vanilla
// is just the first mod" literally true: engines/activeSchema.js calls this
// with base_vanilla.json as `base` and its active mod list as `modPatches`,
// but this file takes both as plain parameters and imports neither
// base_vanilla.json nor any active-mod list itself.
//
// No persistence, no file-scanning, no UI, no SCHEMA_UPDATED, no
// mid-playthrough hot-swap — this compiles once, given whatever `base` and
// `modPatches` the caller hands it.

import { mergeSchemas } from './schemaMerge.js';
import { validateModPatch } from './modContract.js';

/**
 * @typedef {Object} CompileSkip
 * @property {string} name - the mod's name.
 * @property {import('./modContract.js').ModPatchError[]} errors - the
 *   validation errors that caused this mod to be skipped.
 */

/**
 * @typedef {Object} CompileResult
 * @property {*} schema - `base` with every valid patch in `modPatches`
 *   folded in, in order.
 * @property {string[]} applied - names of mods that merged successfully, in
 *   the order they were applied.
 * @property {CompileSkip[]} skipped - mods rejected by validation, each with
 *   the real errors that rejected it.
 */

/**
 * Fold an ordered list of mod patches onto `base`. Array order in
 * `modPatches` IS priority — there is no separate priority number.
 *
 * For each `{ name, patch }` entry, in order:
 *   1. Validate `patch` against the CUMULATIVE schema compiled so far (not
 *      always the original `base`) via validateModPatch — a later mod may
 *      legitimately extend or override something an earlier mod introduced
 *      that `base` never had, and validation needs to see that accumulated
 *      state to judge it correctly.
 *   2. If valid, merge it in via mergeSchemas and continue folding with the
 *      result.
 *   3. If invalid, skip this mod (do not merge it) and continue to the next
 *      one with the cumulative state unchanged — one broken mod must not
 *      prevent every other mod from loading.
 *
 * Pure and side-effect-free: never mutates `base` or any patch in
 * `modPatches`, and never logs. Callers decide what to do with `skipped`.
 *
 * @param {*} base - the starting schema (e.g. base_vanilla.json content).
 * @param {{name: string, patch: *}[]} modPatches - ordered mod patches.
 * @returns {CompileResult}
 */
export function compileSchema(base, modPatches) {
  let cumulative = base;
  const applied = [];
  const skipped = [];

  for (const { name, patch } of modPatches) {
    const { valid, errors } = validateModPatch(patch, cumulative);

    if (valid) {
      cumulative = mergeSchemas(cumulative, patch);
      applied.push(name);
    } else {
      skipped.push({ name, errors });
    }
  }

  return { schema: cumulative, applied, skipped };
}
