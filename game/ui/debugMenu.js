// game/ui/debugMenu.js — the developer-only debug menu. Two jobs:
//   1) Navigation/preview switchers pulled OUT of the player UI per the plan:
//      screen, per-screen variant/viewport, and theme.
//   2) Minimal raw triggers/inspectors for real backend systems that have NO
//      player-facing UI anywhere (their only call sites were proof.js): POI
//      reveal authority, faction control, NPC schedule/presence, raw node
//      classification, race-registry live editing, and a clock jump.
// It is deliberately unstyled-game-chrome — a fixed dark panel labeled DEBUG,
// never part of the polished frame. Collapsed to a small corner tab by default.

import { div, span, el, button, clearEl } from './dom.js';
import { THEME_ORDER } from './theme.js';
import { deriveScheduleState } from '../../engines/npcGeneratorEngine.js';
import { nodeLabel } from './model.js';

const PANEL = 'position:fixed; right:0; bottom:0; width:min(420px,100%); max-height:70vh; overflow:auto; background:#0c0c0f; color:#d8d8d8; border:1px solid #333; border-radius:8px 0 0 0; box-shadow:0 0 24px rgba(0,0,0,0.6); z-index:9999; font:400 12px Inter,sans-serif;';
const TAB = 'position:fixed; right:10px; bottom:10px; z-index:9999; background:#0c0c0f; color:#e0a92e; border:1px solid #4d3f2c; border-radius:6px; padding:6px 12px; font:700 10px "Barlow Semi Condensed",sans-serif; letter-spacing:0.1em; text-transform:uppercase; cursor:pointer;';
const SECTION = 'border-top:1px solid #262626; padding:10px 12px;';
const H = 'font:700 9.5px "Barlow Semi Condensed",sans-serif; letter-spacing:0.08em; text-transform:uppercase; color:#7a7a7a; margin-bottom:6px;';
const CHIP = 'background:#17171b; border:1px solid #333; color:#cfcfcf; border-radius:4px; padding:3px 8px; font:600 10px "Barlow Semi Condensed",sans-serif; cursor:pointer; margin:0 4px 4px 0;';
const CHIP_ON = 'background:#e0a92e; border:1px solid #e0a92e; color:#1a1a1a; border-radius:4px; padding:3px 8px; font:600 10px "Barlow Semi Condensed",sans-serif; cursor:pointer; margin:0 4px 4px 0;';

const SCREENS = ['travel', 'conversation', 'inventory', 'journal', 'character', 'trading', 'craft'];

export function renderDebugMenu(ui) {
  if (!ui.state.debugOpen) {
    return button('Debug', TAB, () => ui.setState({ debugOpen: true }));
  }

  const panel = div(PANEL);

  // Header
  panel.appendChild(div('display:flex; align-items:center; justify-content:space-between; padding:8px 12px; background:#141418;', {
    children: [
      span('font:700 11px "Barlow Semi Condensed",sans-serif; letter-spacing:0.14em; color:#e0a92e;', { text: 'DEBUG MENU' }),
      button('✕ close', 'background:transparent; border:1px solid #333; color:#aaa; border-radius:4px; padding:3px 8px; cursor:pointer; font-size:11px;',
        () => ui.setState({ debugOpen: false })),
    ],
  }));

  panel.append(
    navSection(ui),
    poiSection(ui),
    factionSection(ui),
    presenceSection(ui),
    classificationSection(ui),
    raceSection(ui),
    clockSection(ui),
  );
  return panel;
}

// ---- 1) Navigation / preview switchers ------------------------------------
function navSection(ui) {
  const { state, setState } = ui;
  const s = div(SECTION);
  s.appendChild(div(H, { text: 'Screen' }));
  s.appendChild(chipRow(SCREENS.map((id) => chip(id, state.screen === id, () => setState({ screen: id })))));

  // Per-screen variant/viewport toggles
  const variantRow = [];
  if (state.screen === 'travel') {
    variantRow.push(chip('A · map', state.travelVariant === 'a', () => setState({ travelVariant: 'a' })));
    variantRow.push(chip('B · ledger', state.travelVariant === 'b', () => setState({ travelVariant: 'b' })));
  } else if (state.screen === 'conversation') {
    variantRow.push(chip('A · portrait', state.convoVariant === 'a', () => setState({ convoVariant: 'a' })));
    variantRow.push(chip('B · chat', state.convoVariant === 'b', () => setState({ convoVariant: 'b' })));
  } else if (state.screen === 'inventory') {
    variantRow.push(chip('Desktop', state.invView === 'desktop', () => setState({ invView: 'desktop' })));
    variantRow.push(chip('Mobile', state.invView === 'mobile', () => setState({ invView: 'mobile' })));
  } else if (state.screen === 'trading') {
    variantRow.push(chip('Desktop', state.tradingView === 'desktop', () => setState({ tradingView: 'desktop' })));
    variantRow.push(chip('Mobile', state.tradingView === 'mobile', () => setState({ tradingView: 'mobile' })));
  }
  if (variantRow.length) {
    s.appendChild(div(H + ' margin-top:8px;', { text: 'Layout' }));
    s.appendChild(chipRow(variantRow));
  }

  s.appendChild(div(H + ' margin-top:8px;', { text: 'Theme' }));
  s.appendChild(chipRow(THEME_ORDER.map((t) => chip(t.label, state.theme === t.id, () => setState({ theme: t.id })))));
  return s;
}

// ---- 2a) POI reveal authority ---------------------------------------------
function poiSection(ui) {
  const { engines } = ui.ctx;
  const here = engines.map.getNode(engines.travel.getPlayerNodeId());
  const s = div(SECTION);
  s.appendChild(div(H, { text: 'POI reveal authority — grantRevealAuthority()' }));
  if (!here) return s;
  const { undiscovered } = engines.poi.getPoiState(here);
  const revealed = engines.poi.getRevealedPoiIds();
  s.appendChild(span('color:#888; font-size:11px;', { text: `${here.classification?.kind} node · ${undiscovered.length} undiscovered POIs · ${revealed.size} revealed` }));
  const row = div('margin-top:6px;');
  if (!undiscovered.length) row.appendChild(span('color:#666;', { text: '(none here)' }));
  for (const p of undiscovered) {
    const granted = revealed.has(p.id);
    row.appendChild(button(`${granted ? '✓ ' : 'grant '}${p.category}`, granted ? CHIP_ON : CHIP,
      () => { engines.poi.grantRevealAuthority(p.id); ui.setState({}); }));
  }
  s.appendChild(row);
  return s;
}

// ---- 2b) Faction control ---------------------------------------------------
function factionSection(ui) {
  const { engines } = ui.ctx;
  const here = engines.map.getNode(engines.travel.getPlayerNodeId());
  const s = div(SECTION);
  s.appendChild(div(H, { text: 'Faction control — setFactionControl()' }));
  if (here?.classification?.kind !== 'settlement') {
    s.appendChild(span('color:#666;', { text: 'Current node is not a settlement.' }));
    return s;
  }
  const controller = engines.faction.getFactionControl(here);
  s.appendChild(span('color:#888; font-size:11px;', { text: `${here.classification.settlementId} → controller: ${controller ?? 'uncontrolled'}` }));
  const row = div('margin-top:6px;');
  for (const f of ['faction_0', 'faction_1', 'faction_2', null]) {
    row.appendChild(button(f ?? 'uncontrolled', controller === f ? CHIP_ON : CHIP,
      () => { engines.faction.setFactionControl(here.classification.settlementId, f); ui.setState({}); }));
  }
  s.appendChild(row);
  return s;
}

// ---- 2c) NPC schedule / presence ------------------------------------------
function presenceSection(ui) {
  const { engines } = ui.ctx;
  const here = engines.map.getNode(engines.travel.getPlayerNodeId());
  const hour = engines.clock.getCurrentDate().hour;
  const s = div(SECTION);
  s.appendChild(div(H, { text: 'NPC schedule/presence — populateNode() · rosterIdsAt()' }));
  if (!here) return s;
  s.appendChild(button('Populate this node', CHIP, () => { engines.npcGen.populateNode(here); ui.setState({}); }));
  const ids = engines.npcGen.rosterIdsAt(here.id);
  const list = div('margin-top:6px;');
  if (!ids.length) list.appendChild(span('color:#666;', { text: '(not populated yet — or empty roster)' }));
  for (const id of ids) {
    const npc = engines.registry.get(id);
    const sched = deriveScheduleState(npc?.schedule, hour);
    list.appendChild(div('padding:2px 0; color:#bbb; font-size:11px;', {
      text: `${npc ? npc.identity.firstName + ' ' + npc.identity.lastName : id} — ${sched.available ? 'available' : 'away/asleep'} @ ${hour}:00`,
    }));
  }
  s.appendChild(list);
  return s;
}

// ---- 2d) Raw node classification ------------------------------------------
function classificationSection(ui) {
  const { engines } = ui.ctx;
  const here = engines.map.getNode(engines.travel.getPlayerNodeId());
  const s = div(SECTION);
  s.appendChild(div(H, { text: 'Raw node classification — classifyAt()' }));
  if (!here) return s;
  const c = here.classification;
  const fmt = (v) => (v == null ? '—' : typeof v === 'number' ? v.toFixed(3) : v);
  s.appendChild(div('font-family:monospace; font-size:11px; color:#bbb; line-height:1.6;', {
    html: `node: ${here.id}<br>label: ${nodeLabel(here)}<br>kind: ${c.kind} · tier: ${fmt(c.tier)}<br>notability: ${fmt(c.notability)} · hospitability: ${fmt(c.hospitability)}<br>terrain: ${here.terrainType} · passable: ${here.passable}<br>baselineFaction: ${fmt(c.baselineFaction)}`,
  }));
  return s;
}

// ---- 2e) Race registry live editing ---------------------------------------
function raceSection(ui) {
  const { engines } = ui.ctx;
  const s = div(SECTION);
  s.appendChild(div(H, { text: 'Race registry — setRaceEnabled() (live)' }));
  const races = engines.races.getRaces();
  const row = div('');
  for (const r of races) {
    row.appendChild(button(`${r.enabled ? '✓ ' : '✗ '}${r.displayName || r.id}`, r.enabled ? CHIP_ON : CHIP,
      () => { engines.races.setRaceEnabled(r.id, !r.enabled); ui.setState({}); }));
  }
  s.appendChild(row);
  s.appendChild(span('color:#666; font-size:10px;', { text: `${engines.races.getEnabledRaces().length} enabled · affects newly generated NPC rosters` }));
  return s;
}

// ---- 2f) Clock jump --------------------------------------------------------
function clockSection(ui) {
  const { world, engines } = ui.ctx;
  const s = div(SECTION);
  s.appendChild(div(H, { text: 'Clock — CLOCK_JUMP · getActiveTimeContext()' }));
  const d = engines.clock.getCurrentDate();
  s.appendChild(span('color:#888; font-size:11px;', { text: `${d.monthName} Day ${d.day} ${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')} · context: ${engines.clock.getActiveTimeContext()}` }));
  const row = div('margin-top:6px;');
  for (const [label, secs] of [['+1h', 3600], ['+6h', 21600], ['+1 day', 86400]]) {
    row.appendChild(button(label, CHIP, () => { world.dispatch('CLOCK_JUMP', { gameSecondsElapsed: secs }); ui.setState({}); }));
  }
  s.appendChild(row);
  return s;
}

// ---- helpers ---------------------------------------------------------------
function chip(label, on, onClick) {
  return button(label, on ? CHIP_ON : CHIP, onClick);
}
function chipRow(children) {
  return div('display:flex; flex-wrap:wrap;', { children });
}
