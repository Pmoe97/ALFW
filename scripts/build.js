// scripts/build.js — bundles game/testHarness.js into a single minified
// <script>, splices the reusable markup out of game/testHarness.html, and
// concatenates the two into one self-contained artifact ready to paste into
// Perchance's html panel: the full interactive test harness (world clock,
// debug time controls, player actions, relationship tiers, dialogue), not
// just a console smoke test.
//
// Uses esbuild's JS API directly (bundle + wrap in one step, no CLI
// shell-chaining) and aliases 'node:fs' to nodeFsShim.js so esbuild can
// resolve worldState.js's unconditional readFileSync import without ever
// touching the real Node fs module or emitting a require() the browser can't
// satisfy — see scripts/nodeFsShim.js for the full explanation.

import { build } from 'esbuild';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../dist');
mkdirSync(outDir, { recursive: true });

const BEGIN_COMMENT = '<!-- PERCHANCE-BUNDLE:BEGIN -->';
const END_COMMENT = '<!-- PERCHANCE-BUNDLE:END -->';

// bundleEntry — bundle one JS entry with esbuild, splice the reusable markup out
// of its companion .html (between the PERCHANCE-BUNDLE markers), and write one
// self-contained artifact: the spliced markup followed by the bundled <script>,
// matching what the entry expects to already exist in the DOM. Two entries share
// this: the interactive test harness and the real game UI.
async function bundleEntry({ entry, html, out, label }) {
  const result = await build({
    entryPoints: [path.resolve(here, entry)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    minify: true,
    write: false,
    alias: { 'node:fs': path.resolve(here, 'nodeFsShim.js') },
    logLevel: 'info',
  });
  const code = result.outputFiles[0].text;

  const htmlSource = readFileSync(path.resolve(here, html), 'utf8');
  const beginIdx = htmlSource.indexOf(BEGIN_COMMENT);
  const endIdx = htmlSource.indexOf(END_COMMENT);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(`${html} is missing its PERCHANCE-BUNDLE:BEGIN/END markers — cannot splice markup for the Perchance bundle`);
  }
  const markup = htmlSource.slice(beginIdx + BEGIN_COMMENT.length, endIdx).trim();

  const outFile = path.join(outDir, out);
  writeFileSync(outFile, `${markup}\n<script>\n${code}\n</script>\n`, 'utf8');
  console.log(`Wrote ${outFile} (${label}: ${markup.length} bytes markup + ${code.length} bytes minified JS)`);
}

// The engine test harness (unchanged) and the real game UI (new). Both are
// paste-ready Perchance artifacts; the game UI is the player-facing one.
await bundleEntry({ entry: '../game/testHarness.js', html: '../game/testHarness.html', out: 'alfw-perchance.html', label: 'test harness' });
await bundleEntry({ entry: '../game/app.js', html: '../game/app.html', out: 'alfw-perchance-app.html', label: 'game UI' });
