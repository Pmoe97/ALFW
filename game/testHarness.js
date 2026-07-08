// game/testHarness.js — local-only dev tool, NOT part of the Perchance
// bundle. scripts/build.js has a single explicit entry point (game/main.js)
// and never imports this file, so it can never end up in the bundle.
//
// This must be loaded via a local static server (e.g. `npx serve game` or
// `python -m http.server --directory game`), not opened as a file:// URL —
// ES module imports are blocked under file://.

import { buildSampleWorld } from './sampleWorld.js';
import { createRelationshipEffectEngine } from '../engines/relationshipEffectEngine.js';
import { createMemoryEngine } from '../engines/memoryEngine.js';
import { helpNpc, robNpc, ignoreNpc } from '../actions/playerActions.js';
import { relationshipTier } from '../entities/relationshipStore.js';
import { getDialogue } from '../ai/getDialogue.js';

const { world, registry, relationships, mira, rowan } = buildSampleWorld();
createRelationshipEffectEngine(world, relationships);
createMemoryEngine(world, registry);

const relationshipEl = document.getElementById('relationship');
const memoriesEl = document.getElementById('memories');
const dialogueOutputEl = document.getElementById('dialogue-output');
const playerInputEl = document.getElementById('player-input');

function render() {
  const edge = relationships.getRelationship(mira.id, rowan.id);
  const statsHtml = Object.entries(edge.stats)
    .map(([key, value]) => `<li>${key}: ${value}</li>`)
    .join('');
  relationshipEl.innerHTML = `<ul>${statsHtml}</ul><p>tier: ${relationshipTier(edge.stats)}</p>`;

  const memoriesHtml = mira.psychology.memories
    .map((m) => `<li>[seq ${m.seq}] ${m.summary}</li>`)
    .join('');
  memoriesEl.innerHTML = `<ul>${memoriesHtml}</ul>`;
}

document.getElementById('btn-help').addEventListener('click', () => {
  helpNpc(world, rowan.id, mira.id);
  render();
});
document.getElementById('btn-rob').addEventListener('click', () => {
  robNpc(world, rowan.id, mira.id);
  render();
});
document.getElementById('btn-ignore').addEventListener('click', () => {
  ignoreNpc(world, rowan.id, mira.id);
  render();
});

document.getElementById('btn-talk').addEventListener('click', async () => {
  const playerLine = playerInputEl.value;
  const edge = relationships.getRelationship(mira.id, rowan.id);
  const result = await getDialogue(mira, edge, mira.psychology.memories, playerLine);
  console.log('[TestHarness] dialogue result:', result);
  dialogueOutputEl.textContent = JSON.stringify(
    { source: result.source, dialogue: result.response.dialogue },
    null,
    2
  );
});

render();
