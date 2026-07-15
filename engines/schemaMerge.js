// engines/schemaMerge.js — pure recursive merge of a mod-authored schema
// patch onto a base schema (vanilla or an already-merged schema). This file
// is NOT wired into anything — no ModManager, no patch validation, no
// hot-swap/gating logic, no SCHEMA_UPDATED handling exist yet. It exists so a
// FUTURE mechanism that applies a mod's schema patch on top of the vanilla
// schema (or on top of another mod's already-merged output) has a single,
// already-proven merge primitive to call instead of re-deriving this
// three-verb grammar from scratch.
//
// The merge grammar (exactly three verbs, nothing else):
//   1. object + object   -> recurse key-by-key.
//   2. anything else     -> patch's value wholesale-replaces base's value
//                           (primitives, arrays, or an object replacing a
//                           non-object all replace; arrays are NEVER merged
//                           element-by-element or reconciled by id/position).
//   3. { $remove: true }  -> delete the key from the result, whether or not
//                           base had it. A literal `null` patch value is
//                           just an override, NOT this sentinel.
//
// mergeSchemas never mutates `base` or `patch`, and is safe to call with a
// deeply frozen `base` (e.g. real engines/activeSchema.js getSchema()
// output) — it never assigns into base, only ever into freshly allocated
// result objects.

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRemoveSentinel(value) {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 1 &&
    value.$remove === true
  );
}

/**
 * Merge a schema patch onto a base schema, producing a brand-new object.
 * Never mutates `base` or `patch`.
 *
 * Three-verb grammar:
 *   1. Object + object at the same key -> recursively merged key-by-key.
 *   2. Anything else -> patch's value wholesale-replaces base's value at
 *      that key. Covers primitives, arrays, an object replacing a
 *      non-object, and a non-object replacing an object. Arrays are always
 *      replaced whole — never merged, never reconciled by id or position.
 *   3. `{ $remove: true }` — an object with EXACTLY one key, `$remove`,
 *      whose value is strictly `true` (no extra keys) -> the key is deleted
 *      from the result, whether or not `base` had it. `{ $remove: true, x: 1 }`
 *      is NOT the sentinel (falls through to verb 2, a wholesale replace with
 *      that literal object). A literal `null` patch value is just an
 *      override, NOT the remove sentinel.
 *
 * A patch may introduce brand-new keys (top-level or nested) that `base`
 * does not have; they are simply added to the result.
 *
 * Purity / immutability: only the objects along paths actually touched by
 * `patch` are newly allocated. Any subtree of `base` left untouched by
 * `patch` is shared by reference in the result — safe, since `base` is never
 * written to (and may be deep-frozen, as with the real getSchema() output).
 *
 * @param {*} base  - the existing schema (or subtree) to merge onto.
 * @param {*} patch - the patch to apply on top of base (or subtree).
 * @returns {*} a new merged value.
 */
export function mergeSchemas(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch;
  }

  const result = { ...base };

  for (const key of Object.keys(patch)) {
    const patchValue = patch[key];

    if (isRemoveSentinel(patchValue)) {
      delete result[key];
      continue;
    }

    const baseValue = base[key];

    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      result[key] = mergeSchemas(baseValue, patchValue);
    } else {
      result[key] = patchValue;
    }
  }

  return result;
}
