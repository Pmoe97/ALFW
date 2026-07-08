// scripts/nodeFsShim.js — build-only stand-in for 'node:fs'.
//
// worldState.js has an unconditional top-level `import { readFileSync } from
// 'node:fs'` (required — do not touch worldState.js). esbuild resolves that
// import while walking the module graph, before tree-shaking runs, so with
// the default browser platform it fails to resolve 'node:fs' even though
// readFileSync/initWorldState are never called from game/main.js. This file
// is aliased in for 'node:fs' during the build (see scripts/build.js) so
// resolution succeeds, and is bundled as an ordinary local ESM module (NOT
// externalized), so it carries no require()/import artifacts into the iife
// output. readFileSync throws if ever actually invoked — that must never
// happen, since game/main.js only calls createWorldState(), never
// initWorldState().
export function readFileSync() {
  throw new Error(
    'nodeFsShim.readFileSync() called: this build-only stub should never execute. ' +
      'game/main.js must only call createWorldState(), never initWorldState().'
  );
}
