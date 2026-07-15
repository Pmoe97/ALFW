// engines/modContract.js — hard-block structural/safety validator for a
// mod-authored schema patch, meant to run BEFORE a patch is ever handed to
// engines/schemaMerge.js's mergeSchemas(). mergeSchemas merges by doing
// `result[key] = patchValue` on `result = { ...base }` (plain
// computed-property assignment) — this is exactly the prototype-pollution
// surface: an object literally containing an own "__proto__" key (which is
// how JSON.parse represents `{"__proto__": {...}}` — a genuine own
// enumerable data property, NOT the exotic accessor triggered by object-
// literal syntax) would, via that bracket assignment, reassign the merged
// result's actual prototype chain, silently corrupting every subsequent
// property lookup that misses as an own property. validateModPatch() exists
// to catch that, and several other patch-shape hazards mergeSchemas has no
// reason to guard against itself, before merge time: malformed near-$remove
// sentinels that mergeSchemas would silently treat as a wholesale-replace
// object instead of a deletion, patch values that clobber an object-shaped
// base config, oversized/over-deep/over-wide patches, and values that
// cannot survive JSON serialization in the first place.
//
// This file is NOT wired into anything — no ModManager, no patch-loading
// pipeline, no hot-swap/gating logic, no SCHEMA_UPDATED handling exist yet.
// It deliberately does not import engines/schemaMerge.js or
// engines/activeSchema.js: both `patch` and `base` are plain parameters the
// caller supplies, and this module never decides what "the current base
// schema" is. It duplicates its own tiny isPlainObject/$remove-sentinel
// helpers rather than importing schemaMerge.js's, because the two modules'
// notions of "$remove sentinel" are subtly different: schemaMerge.js's
// isRemoveSentinel is a lenient MERGE-TIME predicate (false for a malformed
// `{ $remove: "true" }`, which then just silently merges as an ordinary
// nested object) — this module's job is precisely to catch the shapes that
// lenient predicate mishandles, so importing it would blur that distinction.
//
// No warnings tier: every check below is a hard error. `valid` is exactly
// `errors.length === 0`. All violations are accumulated in one pass —
// unlike ai/responseContract.js's validateDialogueResponse, which rejects
// and returns on the FIRST violation, this validator keeps going so a mod
// author sees every problem in their patch at once.

const MAX_DEPTH = 25;
const MAX_ARRAY_LENGTH = 10000;
const MAX_SERIALIZED_SIZE = 2 * 1024 * 1024; // 2 MB, JSON.stringify(patch).length as a proxy for byte size.
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWellFormedRemove(value) {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === 1 &&
    value.$remove === true
  );
}

/**
 * @typedef {Object} ModPatchError
 * @property {string} path - dot/bracket path to the offending value (e.g.
 *   "combat.fleeChanceClamp", "items[3].name"), or "" for whole-patch checks.
 * @property {string} message - precise, specific reason for the violation.
 */

/**
 * @typedef {Object} ModPatchValidationResult
 * @property {boolean} valid - true iff `errors` is empty.
 * @property {ModPatchError[]} errors - every hard-block violation found,
 *   accumulated across the entire patch tree (no short-circuit).
 */

/**
 * Validate a mod-authored schema patch against a base schema, catching every
 * structural/safety hazard that engines/schemaMerge.js's mergeSchemas has no
 * reason to guard against itself:
 *
 *   1. Prototype-pollution keys — "__proto__", "constructor", or
 *      "prototype" anywhere in the patch tree, including inside array
 *      elements.
 *   2. Size/depth/breadth limits — MAX_DEPTH, MAX_ARRAY_LENGTH,
 *      MAX_SERIALIZED_SIZE (named constants above).
 *   3. Non-JSON-safe values — a function, a Symbol, or a key whose value is
 *      the literal `undefined` (present, not merely absent), anywhere in
 *      the tree.
 *   4. Malformed near-$remove sentinels — an object with a key literally
 *      named "$remove" that isn't exactly `{ $remove: true }` (one key,
 *      value strictly `=== true`), plus the degenerate case of a
 *      well-formed `{ $remove: true }` sitting at the patch ROOT, which has
 *      no parent key for it to delete and would just be merged onto the
 *      result as a literal `$remove: true` property.
 *   5. Object-shaped base path replaced by a non-object, non-$remove value —
 *      would silently discard every sibling key under that base path per
 *      mergeSchemas' actual wholesale-replace behavior. A patch introducing
 *      a brand-new key `base` doesn't have at all is NOT this case.
 *
 * Recurses through the entire patch tree, including into array elements —
 * their contents land in the final merged schema even though mergeSchemas
 * treats the whole array as a wholesale-replace unit. Never mutates `patch`
 * or `base`.
 *
 * @param {*} patch - the mod-authored patch to validate (untrusted).
 * @param {*} base - the schema the patch would be merged onto (e.g. a real
 *   engines/activeSchema.js getSchema()-shaped object, or any plain object
 *   a caller supplies).
 * @returns {ModPatchValidationResult}
 */
export function validateModPatch(patch, base) {
  const errors = [];

  if (isWellFormedRemove(patch)) {
    errors.push({
      path: '',
      message:
        'A $remove sentinel at the patch root has no key to delete — $remove only removes the key it\'s assigned to inside a parent object',
    });
  }

  let serializedSize;
  try {
    serializedSize = JSON.stringify(patch).length;
  } catch (err) {
    errors.push({
      path: '',
      message: `Patch could not be serialized to measure its size: ${err.message}`,
    });
    serializedSize = undefined;
  }
  if (serializedSize !== undefined && serializedSize > MAX_SERIALIZED_SIZE) {
    errors.push({
      path: '',
      message: `Patch serializes to ${serializedSize} characters, exceeding the maximum of ${MAX_SERIALIZED_SIZE} (2MB)`,
    });
  }

  function walk(patchValue, baseValue, path, depth, baseAligned) {
    if (depth > MAX_DEPTH) {
      errors.push({
        path,
        message: `Patch nesting depth exceeds the maximum of ${MAX_DEPTH} at "${path}"`,
      });
      return;
    }

    if (typeof patchValue === 'function') {
      errors.push({
        path,
        message: `Value at "${path}" is a function — functions cannot survive JSON serialization`,
      });
      return;
    }
    if (typeof patchValue === 'symbol') {
      errors.push({
        path,
        message: `Value at "${path}" is a Symbol — symbols cannot survive JSON serialization`,
      });
      return;
    }
    if (patchValue === undefined) {
      errors.push({
        path,
        message: `Value at "${path}" is explicitly undefined — omit the key instead of setting it to undefined`,
      });
      return;
    }

    if (Array.isArray(patchValue)) {
      if (patchValue.length > MAX_ARRAY_LENGTH) {
        errors.push({
          path,
          message: `Array at "${path}" has ${patchValue.length} elements, exceeding the maximum of ${MAX_ARRAY_LENGTH}`,
        });
      }
      for (let i = 0; i < patchValue.length; i++) {
        walk(patchValue[i], undefined, `${path}[${i}]`, depth + 1, false);
      }
      return;
    }

    if (isPlainObject(patchValue)) {
      if (
        Object.prototype.hasOwnProperty.call(patchValue, '$remove') &&
        !isWellFormedRemove(patchValue)
      ) {
        errors.push({
          path,
          message: `Malformed $remove sentinel at "${path}" — must be exactly { $remove: true } with no other keys, found keys [${Object.keys(patchValue).join(', ')}] with $remove === ${JSON.stringify(patchValue.$remove)}`,
        });
      }

      for (const key of Object.keys(patchValue)) {
        const childPath = path ? `${path}.${key}` : key;

        if (FORBIDDEN_KEYS.has(key)) {
          errors.push({
            path: childPath,
            message: `Forbidden key "${key}" at "${childPath}" — "__proto__", "constructor", and "prototype" are never allowed as patch keys (prototype-pollution risk)`,
          });
        }

        const childPatchValue = patchValue[key];
        let childBaseValue;
        let childBaseAligned = false;

        if (baseAligned && isPlainObject(baseValue)) {
          childBaseValue = Object.prototype.hasOwnProperty.call(baseValue, key)
            ? baseValue[key]
            : undefined;
          childBaseAligned = true;

          if (
            isPlainObject(childBaseValue) &&
            Object.keys(childBaseValue).length >= 1 &&
            !isPlainObject(childPatchValue) &&
            !isWellFormedRemove(childPatchValue)
          ) {
            errors.push({
              path: childPath,
              message: `Value at "${childPath}" replaces an object-shaped config (base defines ${Object.keys(childBaseValue).length} key(s) there) with a non-object, non-$remove value — provide an object to merge, an exact { $remove: true } to delete, or omit the key to leave it untouched`,
            });
          }
        }

        walk(childPatchValue, childBaseValue, childPath, depth + 1, childBaseAligned);
      }
    }
  }

  walk(patch, base, '', 0, true);

  return { valid: errors.length === 0, errors };
}
