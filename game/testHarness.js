// game/testHarness.js — dual-purpose: local dev tool AND the source
// scripts/build.js bundles for Perchance. Its entry point is this file; the
// build splices testHarness.html's PERCHANCE-BUNDLE-marked markup out and
// prepends it to this file's esbuild output, producing one self-contained
// paste for Perchance's html panel.
//
// For local dev, this must be loaded via a local static server (e.g.
// `npx serve game` or `python -m http.server --directory game`), not opened
// as a file:// URL — ES module imports are blocked under file://. The
// Perchance bundle sidesteps this entirely since esbuild inlines every
// import into a single non-module IIFE at build time.
//
// Every DOM lookup below (getElementById etc.) assumes the harness's own
// markup already exists in the page — true locally (testHarness.html) and
// true in the Perchance bundle (the spliced markup is placed before this
// script in the output, so the browser has already parsed it in).

import { buildSampleWorld } from './sampleWorld.js';
import { createRelationshipEffectEngine } from '../engines/relationshipEffectEngine.js';
import { createMemoryEngine } from '../engines/memoryEngine.js';
import { createWorldClockEngine } from '../engines/worldClockEngine.js';
import { createTickSource } from './tickSource.js';
import { helpNpc, robNpc, ignoreNpc } from '../actions/playerActions.js';
import { relationshipTier } from '../entities/relationshipStore.js';
import { getRecentHistory } from '../entities/conversationHistoryStore.js';
import { getDialogue } from '../ai/getDialogue.js';
import { log, setChannelEnabled } from '../debugLog.js';

const { world, registry, relationships, conversationHistory, mira, rowan, sable } = buildSampleWorld();
createRelationshipEffectEngine(world, relationships);

// Memory fan-out demo. The full generator isn't running in this hand-authored
// scene, so a tiny presence stub stands in for npcGeneratorEngine.rosterIdsAt:
// it says Mira and Sable share one node (DEMO_SCENE_NODE). The player verbs
// below pass that nodeId, so acting on Mira also lands a witnessed memory on
// Sable — exactly the co-located fan-out the real presence source will drive
// once schedules/location tracking exist.
const DEMO_SCENE_NODE = 'demo_scene';
const presence = {
  witnessesAt: (nodeId) => (nodeId === DEMO_SCENE_NODE ? [mira.id, sable.id] : []),
};
createMemoryEngine(world, registry, presence);

// World clock: created BEFORE the tick source starts so it catches every
// CLOCK_TICK. It owns all game-time derivation; the tick source below only
// dispatches ticks on an interval.
const clock = createWorldClockEngine(world);
const config = world.getState().config;
const tick = createTickSource(world, config);

const relationshipEl = document.getElementById('relationship');
const relationshipTiersEl = document.getElementById('relationship-tiers');
const memoriesEl = document.getElementById('memories');
const dialogueOutputEl = document.getElementById('dialogue-output');
const playerInputEl = document.getElementById('player-input');
const clockEl = document.getElementById('clock');

// Read-only tier readout for the entities currently in the scene. Pure
// surfacing of what getRelationship()/relationshipTier() already compute —
// no new derivation, no new dispatches.
const TIER_PAIRS = [
  { label: 'Rowan → Mira', fromId: rowan.id, toId: mira.id },
  { label: 'Mira → Rowan', fromId: mira.id, toId: rowan.id },
  { label: 'Mira → Sable', fromId: mira.id, toId: sable.id },
  { label: 'Sable → Mira', fromId: sable.id, toId: mira.id },
];

function renderRelationshipTiers() {
  const rowsHtml = TIER_PAIRS.map(({ label, fromId, toId }) => {
    const edge = relationships.getRelationship(fromId, toId);
    return `<tr><td>${label}</td><td>${relationshipTier(edge.stats)}</td></tr>`;
  }).join('');
  relationshipTiersEl.innerHTML =
    `<table class="tiers"><thead><tr><th>Pair</th><th>Tier</th></tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function render() {
  const edge = relationships.getRelationship(mira.id, rowan.id);
  const statsHtml = Object.entries(edge.stats)
    .map(([key, value]) => `<li>${key}: ${value}</li>`)
    .join('');
  relationshipEl.innerHTML = `<ul>${statsHtml}</ul><p>tier: ${relationshipTier(edge.stats)}</p>`;

  // Mira's own memories plus any Sable picked up as a co-located witness — the
  // fan-out made visible.
  const miraMem = mira.psychology.memories
    .map((m) => `<li>Mira: [seq ${m.seq}] ${m.summary}</li>`)
    .join('');
  const sableMem = sable.psychology.memories
    .map((m) => `<li>Sable (witness): [seq ${m.seq}] ${m.summary}</li>`)
    .join('');
  memoriesEl.innerHTML = `<ul>${miraMem}${sableMem}</ul>`;

  renderRelationshipTiers();
}

// --- World clock: live readout + debug context switch --------------------
// Ugly-is-fine readout of the derived calendar date/time, updated on every
// tick (and after a context switch). None of this is stored — it's all read
// back out of the clock engine, which derives it from the event log.
function twoDigit(n) {
  return String(n).padStart(2, '0');
}
function renderClock() {
  const d = clock.getCurrentDate();
  const context = clock.getActiveTimeContext();
  const total = clock.getTotalGameSeconds();
  clockEl.textContent =
    `Year ${d.year}, ${d.monthName}, Wk ${d.week}, Day ${d.day} — ` +
    `${twoDigit(d.hour)}:${twoDigit(d.minute)}:${twoDigit(d.second)} ` +
    `[${context}]  (${total} game-s total)`;
}
world.subscribe('CLOCK_TICK', renderClock);

// Debug-only context switch. Real gameplay verbs (travel, dialogue) don't
// exist yet, so this dispatches a bare, clearly-debug action carrying ONLY a
// timeContext — enough to prove the tick source + dilation live without
// pretending those verbs exist. WorldClockEngine already reads any action's
// optional timeContext, so no engine change is needed.
function debugSetContext(name) {
  world.dispatch('DEBUG_SET_TIME_CONTEXT', { timeContext: name });
  renderClock();
}
window.debugSetContext = debugSetContext; // also console-callable

// Console channels: toggleable independent of engine behavior (debugLog.js).
// Silencing a channel never stops what it silences — WorldClockEngine keeps
// ticking into the log at the same rate whether its channel is on or off.
window.setLogChannel = setChannelEnabled; // e.g. setLogChannel('WorldClockEngine', true)
console.log("[DebugLog] Console channels are toggleable: setLogChannel('WorldClockEngine', true) to re-enable tick/jump logs (off by default — very high frequency).");
document.getElementById('btn-ctx-idle').addEventListener('click', () => debugSetContext('idle'));
document.getElementById('btn-ctx-traveling').addEventListener('click', () => debugSetContext('traveling'));
document.getElementById('btn-ctx-chatting').addEventListener('click', () => debugSetContext('chatting'));

// Pause-on-blur (default, driven by config). When the tab is backgrounded the
// tick source stops dispatching entirely, so game-time freezes instead of
// accumulating while the player isn't looking. visibilitychange is the primary
// signal; blur/focus are a fallback for browsers/timing that don't fire it.
if (config.runtime?.pauseOnBlur) {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) tick.pause();
    else tick.resume();
  });
  window.addEventListener('blur', () => tick.pause());
  window.addEventListener('focus', () => tick.resume());
}

renderClock();
tick.start();

document.getElementById('btn-help').addEventListener('click', () => {
  helpNpc(world, rowan.id, mira.id, DEMO_SCENE_NODE);
  render();
});
document.getElementById('btn-rob').addEventListener('click', () => {
  robNpc(world, rowan.id, mira.id, DEMO_SCENE_NODE);
  render();
});
document.getElementById('btn-ignore').addEventListener('click', () => {
  ignoreNpc(world, rowan.id, mira.id, DEMO_SCENE_NODE);
  render();
});

document.getElementById('btn-talk').addEventListener('click', async () => {
  const playerLine = playerInputEl.value;
  const edge = relationships.getRelationship(mira.id, rowan.id);
  const recentHistory = getRecentHistory(conversationHistory.getConversationHistory(mira.id, rowan.id));
  const result = await getDialogue(mira, edge, mira.psychology.memories, playerLine, world.getEventLog(), recentHistory);
  conversationHistory.recordDialogueLine(mira.id, rowan.id, rowan.id, playerLine);
  conversationHistory.recordDialogueLine(mira.id, rowan.id, mira.id, result.response.dialogue);
  log('TestHarness', 'dialogue result:', result);
  dialogueOutputEl.textContent = JSON.stringify(
    { source: result.source, dialogue: result.response.dialogue },
    null,
    2
  );
  render();
});

render();
