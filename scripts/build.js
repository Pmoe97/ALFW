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

const result = await build({
  entryPoints: [path.resolve(here, '../game/testHarness.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  minify: true,
  write: false,
  alias: { 'node:fs': path.resolve(here, 'nodeFsShim.js') },
  logLevel: 'info',
});
const code = result.outputFiles[0].text;

// Pull the harness's own markup (style + panels) out of testHarness.html so
// the Perchance bundle is fully self-contained — one paste gets both the
// visible UI and the wired-up interactivity, matching what testHarness.js
// expects to already exist in the DOM (it queries these elements by id).
const harnessHtmlPath = path.resolve(here, '../game/testHarness.html');
const harnessHtmlSource = readFileSync(harnessHtmlPath, 'utf8');
const BEGIN_COMMENT = '<!-- PERCHANCE-BUNDLE:BEGIN -->';
const END_COMMENT = '<!-- PERCHANCE-BUNDLE:END -->';
const beginIdx = harnessHtmlSource.indexOf(BEGIN_COMMENT);
const endIdx = harnessHtmlSource.indexOf(END_COMMENT);
if (beginIdx === -1 || endIdx === -1) {
  throw new Error(
    'game/testHarness.html is missing its PERCHANCE-BUNDLE:BEGIN/END markers — cannot splice markup for the Perchance bundle'
  );
}
const markup = harnessHtmlSource.slice(beginIdx + BEGIN_COMMENT.length, endIdx).trim();

const outFile = path.join(outDir, 'alfw-perchance.html');
writeFileSync(outFile, `${markup}\n<script>\n${code}\n</script>\n`, 'utf8');
console.log(`Wrote ${outFile} (${markup.length} bytes markup + ${code.length} bytes minified JS)`);
