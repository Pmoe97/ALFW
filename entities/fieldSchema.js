// entities/fieldSchema.js — read-time field resolution over a sparse worldConfig diff.
//
// The appearance/stat option pools live as hardcoded DEFAULTS where they always
// have (engines/npcGeneratorEngine.js: BASE_APPEARANCE_POOLS and the flavor pools;
// entities/entitySchema.js: the stat rosters). worldConfig NEVER holds a merged
// schema — only a sparse DIFF of what a given world changes. This module is the
// ONE place a default and that diff are combined, and it does so at READ time: no
// baked/merged schema object is ever materialized anywhere, and the bus only needs
// to expose the diff (config.fieldSchema) to subscribers. Resolution logic lives
// here, not in the bus.
//
// Two deliberately-separated kinds of override:
//
//   * VALUE override — the option pool / number for a field whose SHAPE is
//     unchanged. resolveFieldValue() is transparent: a consumer (the NPC
//     generator, a stat page) just gets a different value back and neither knows
//     nor cares that it was overridden.
//
//   * SHAPE override — a field renamed, added, or removed. This changes WHAT the
//     wizard renders and WHAT "enumerate every field" returns, so it must be read
//     EXPLICITLY via resolveFieldList() by UI-generation and field-enumeration
//     code. It is never silently folded into value resolution.
//
// The diff shape (all keys optional; an absent diff == the defaults verbatim):
//   config.fieldSchema[category] = {
//     values: { <path>: <pool|value> },   // VALUE override for an existing field
//     add:    { <path>: <pool|value> },   // SHAPE: a brand-new field + its pool
//     remove: [ <path>, ... ],            // SHAPE: drop these fields
//     rename: { <path>: '<label>' },      // SHAPE: display label only (storage
//                                         //   path stays stable — no migration)
//   }
//
// Design constraints this module honors:
//   - PURE and default-agnostic: every function takes the default as an argument
//     (matching resolveFieldValue(path, diff, default)), so this module imports
//     NOTHING from the engines that own the defaults — no circular dependency.
//   - Storage path is stable under rename (only the label changes), so a rename
//     never perturbs the NPC generator's fixed draw order — only add/remove do.

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

// getSchemaDiff — the sparse diff block for one category ('appearance', 'stats',
// ...), or {} when the world overrides nothing. This is the only reach into the
// config; every other function takes the returned diff explicitly.
export function getSchemaDiff(config, category) {
  return config?.fieldSchema?.[category] ?? {};
}

// defaultLabel — a human-readable label derived from a dot-path when the diff
// does not rename it: 'hair.color' -> 'Hair color', 'heightBuild' -> 'Height build'.
export function defaultLabel(path) {
  const leaf = path.includes('.') ? path.slice(path.indexOf('.') + 1) : path;
  const spaced = leaf.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[._]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

// resolveFieldValue — VALUE resolution. The effective pool/value for `path`:
// a world VALUE override wins, then an ADDED field's own pool, else the caller's
// default. Transparent to the caller — it just gets a value. An empty diff always
// returns `defaultValue` unchanged (the determinism-preserving identity case).
export function resolveFieldValue(path, diff, defaultValue) {
  if (diff?.values && hasOwn(diff.values, path)) return diff.values[path];
  if (diff?.add && hasOwn(diff.add, path)) return diff.add[path];
  return defaultValue;
}

// resolveFieldList — SHAPE resolution. The effective, ordered field set after
// removals/additions/renames, as `{ path, label, source }` entries. `defaultOrder`
// is the consumer's default ordered path list (e.g. APPEARANCE_FIELD_ORDER).
//
// Order contract (matters for the NPC generator's fixed draw order): base fields
// keep their default order (minus removals), then ADDED fields append in sorted
// path order — exactly the "additions append so the stream prefix stays stable"
// discipline appearanceExtensions already uses. An empty diff returns the base
// order verbatim, so a consumer iterating this list draws byte-identically to
// iterating `defaultOrder` directly.
export function resolveFieldList(defaultOrder, diff) {
  const remove = new Set(diff?.remove ?? []);
  const rename = diff?.rename ?? {};
  const labelFor = (path) => (hasOwn(rename, path) ? rename[path] : defaultLabel(path));

  const out = [];
  for (const path of defaultOrder) {
    if (remove.has(path)) continue;
    out.push({ path, label: labelFor(path), source: 'base' });
  }
  const add = diff?.add ?? {};
  for (const path of Object.keys(add).sort()) {
    if (remove.has(path)) continue; // a diff that both adds and removes a path drops it
    out.push({ path, label: labelFor(path), source: 'added' });
  }
  return out;
}
