// game/app.js — the game UI entry point. Bootstraps the top-level SHELL (Main
// Menu → WorldConfig → Character Creation → … → play), which constructs a live
// world only when the player actually starts one. The world/engine construction
// and the whole `ctx` assembly that used to live here inline now live in
// game/liveGame.js (buildLiveGame); the shell owns WHEN that runs. This stays the
// second esbuild entry (scripts/build.js emits dist/alfw-perchance-app.html); the
// old game/testHarness.js entry is untouched.
//
// Every DOM lookup assumes app.html's #app root already exists — true locally and
// true in the Perchance bundle (the spliced markup precedes this script).

import { createShell } from './shell.js';

const mountPoint = document.getElementById('app');
createShell(mountPoint);
