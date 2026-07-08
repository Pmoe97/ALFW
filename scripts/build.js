// scripts/build.js — bundles game/main.js into a single minified <script>
// fragment ready to paste into Perchance's master HTML panel.
//
// Uses esbuild's JS API directly (bundle + wrap in one step, no CLI
// shell-chaining) and aliases 'node:fs' to nodeFsShim.js so esbuild can
// resolve worldState.js's unconditional readFileSync import without ever
// touching the real Node fs module or emitting a require() the browser can't
// satisfy — see scripts/nodeFsShim.js for the full explanation.

import { build } from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../dist');
mkdirSync(outDir, { recursive: true });

const result = await build({
  entryPoints: [path.resolve(here, '../game/main.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  minify: true,
  write: false,
  alias: { 'node:fs': path.resolve(here, 'nodeFsShim.js') },
  logLevel: 'info',
});

const code = result.outputFiles[0].text;
const outFile = path.join(outDir, 'alfw-perchance.html');
writeFileSync(outFile, `<script>\n${code}\n</script>\n`, 'utf8');
console.log(`Wrote ${outFile} (${code.length} bytes minified)`);
