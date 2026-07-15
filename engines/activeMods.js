// engines/activeMods.js — the ordered list of mods to compile on top of
// vanilla. Array order IS priority: engines/activeSchema.js folds through
// this list in order via engines/schemaCompiler.js's compileSchema. Empty
// by default, so nothing changes for anyone who hasn't edited this file.
//
// Not IndexedDB-backed or file-scanning yet — just a static list a
// developer can hand-edit. That machinery is future ModManager work.
//
// To enable mods/example-easy-mode.json:
//   import exampleEasyMode from '../mods/example-easy-mode.json' with { type: 'json' };
//   ACTIVE_MODS.push({ name: 'example-easy-mode', patch: exampleEasyMode });

export const ACTIVE_MODS = [];
