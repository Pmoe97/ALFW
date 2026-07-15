// game/ui/screens/travel.js — Travel, variants A (map-first) and B (ledger).
// WIRED: real map/edges/headings, current node tier+faction, destination
// distance (hypot of coords) + time (distance × gameSecondsPerDistanceUnit),
// incident log (real categories/narration), Travel/Explore/Seek-out verbs.
// UNWIRED (marked): the per-destination risk chip — no per-node difficulty scalar
// exists (the template unwired case).

import { div, span, el, button } from '../dom.js';
import { buildTravel } from '../model.js';
import {
  panelStyle, sectionLabelStyle, primaryActionButtonStyle, smallAccentButtonStyle,
  riskChipStyle, riskLabelFor, barTrackStyle, barFillStyle, accentPillStyle,
} from '../styles.js';
import { renderMapSvg } from '../mapSvg.js';

export function renderTravel(ui) {
  // Ensure the current node's neighbors exist so there are edges/destinations to
  // show (idempotent — a no-op once materialized), mirroring the harness.
  const { engines } = ui.ctx;
  const hereId = engines.travel.getPlayerNodeId();
  if (!engines.map.isMaterialized(hereId)) engines.map.materializeNeighbors(hereId);

  const m = buildTravel(ui.ctx);
  // An open travel leg replaces the destination-picker with an in-transit
  // view — scoped to this screen's own render (an open explore window keeps
  // the existing disabled-buttons treatment, unchanged).
  if (m.activeLeg) return inTransitView(m);
  return ui.state.travelVariant === 'b' ? travelLedger(ui, m) : travelMapFirst(ui, m);
}

function busyOf(m) {
  return m.activity !== null && m.activity !== undefined;
}

// ---- In-transit: replaces the picker while a travel leg is open -----------
function inTransitView(m) {
  const leg = m.activeLeg;
  const panel = div(panelStyle('padding:16px; display:flex; flex-direction:column; gap:12px;'), {
    children: [
      div(sectionLabelStyle(), { text: 'Traveling' }),
      div("font:700 18px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: `En route to ${leg.destinationLabel}` }),
      div(barTrackStyle(8), { children: [div(barFillStyle(leg.progressPct))] }),
      div('display:flex; justify-content:space-between; font:500 10.5px Inter,sans-serif; color:var(--text-faint);', {
        children: [
          span('', { text: `${leg.distanceRemaining} distance remaining` }),
          span('', { text: `${leg.timeRemaining} remaining` }),
        ],
      }),
      leg.narration ? div('display:flex; flex-direction:column; gap:6px;', { children: [
        leg.categoryLabel ? span(accentPillStyle() + ' align-self:flex-start;', { text: leg.categoryLabel }) : null,
        div('font:400 12px Inter,sans-serif; color:var(--text-muted); line-height:1.5; font-style:italic;', { text: leg.narration }),
      ] }) : null,
    ],
  });
  return div('padding:10px; min-height:calc(100vh - 92px); display:flex; align-items:flex-start; justify-content:center;', {
    children: [div('width:100%; max-width:480px; margin-top:40px;', { children: [panel] })],
  });
}

// ---- Variant A: map-first --------------------------------------------------
function travelMapFirst(ui, m) {
  const busy = busyOf(m);

  const mapPanel = div('position:relative; ' + panelStyle('overflow:hidden; min-height:360px;'));
  const points = [
    { x: m.here.x, y: m.here.y, here: true, kind: m.here.classification?.kind, label: 'here' },
    ...m.destinations.map((d) => ({ x: d.x, y: d.y, kind: d.kind, label: d.name })),
  ];
  const edges = m.destinations.map((d) => ({ from: m.here, to: { x: d.x, y: d.y }, passable: d.passable }));
  const { svg, legend } = renderMapSvg(points, { edges });
  mapPanel.append(svg, legend);
  mapPanel.appendChild(
    button('Explore here', primaryActionButtonStyle() + ' position:absolute; right:10px; bottom:10px;',
      () => { engines(ui).travel.startExplore(); ui.setState({}); }, { disabled: busy })
  );

  const sidebar = div('display:flex; flex-direction:column; gap:8px; min-width:0;', {
    children: [nodeCard(m), destinationsList(ui, m, busy), incidentLog(m)],
  });

  return div(
    'display:grid; grid-template-columns: minmax(0,1fr) minmax(260px,320px); gap:10px; padding:10px; min-height:calc(100vh - 92px);',
    { children: [mapPanel, sidebar] }
  );
}

// ---- Variant B: ledger -----------------------------------------------------
function travelLedger(ui, m) {
  const busy = busyOf(m);

  const miniMap = div(panelStyle('overflow:hidden;'));
  const points = [
    { x: m.here.x, y: m.here.y, here: true, kind: m.here.classification?.kind, label: 'here' },
    ...m.destinations.map((d) => ({ x: d.x, y: d.y, kind: d.kind, label: d.name })),
  ];
  const edges = m.destinations.map((d) => ({ from: m.here, to: { x: d.x, y: d.y }, passable: d.passable }));
  const { svg } = renderMapSvg(points, { edges, height: '120px' });
  miniMap.appendChild(svg);

  const header = div(
    panelStyle('padding:10px 12px; display:flex; justify-content:space-between; align-items:baseline;'),
    { children: [
      div('', { children: [
        div("font:600 13px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: m.hereLabel }),
        div('font:500 10.5px Inter,sans-serif; color:var(--text-faint); margin-top:2px;', { text: m.hereSub }),
      ] }),
      button('Explore here', primaryActionButtonStyle() + ' flex:none;',
        () => { engines(ui).travel.startExplore(); ui.setState({}); }, { disabled: busy }),
    ] }
  );

  const cols = '1.7fr 0.9fr 0.6fr 0.8fr 0.6fr 0.6fr';
  const table = div(panelStyle('overflow:hidden;'));
  table.appendChild(div(
    `display:grid; grid-template-columns:${cols}; gap:4px; padding:6px 10px; background:var(--panel-alt); ` + sectionLabelStyle(),
    { html: '<span>Destination</span><span>Tier</span><span>Dist</span><span>Time</span><span>Risk</span><span></span>' }
  ));
  for (const d of m.destinations) {
    const row = div(`display:grid; grid-template-columns:${cols}; gap:4px; align-items:center; padding:7px 10px; border-top:1px solid var(--border); font:500 11.5px Inter,sans-serif; color:var(--text);`);
    row.append(
      span('overflow:hidden; text-overflow:ellipsis; white-space:nowrap;', { text: d.name }),
      span('color:var(--text-muted); font-size:10.5px;', { text: d.tierDisplay }),
      span('color:var(--text-muted); font-size:10.5px;', { text: `${d.dist}` }),
      span('color:var(--text-muted); font-size:10.5px;', { text: d.time }),
      riskChip(d),
      button('Go', smallAccentButtonStyle() + ' justify-self:end;',
        () => { engines(ui).travel.startTravel(d.nodeId); ui.setState({}); }, { disabled: busy || !d.passable })
    );
    table.appendChild(row);
  }

  return div('display:flex; flex-direction:column; gap:8px; padding:10px; max-width:760px; margin:0 auto;', {
    children: [miniMap, header, table, incidentLog(m)],
  });
}

// ---- Shared pieces ---------------------------------------------------------
function nodeCard(m) {
  return div(panelStyle('padding:10px 12px;'), { children: [
    div("font:600 12.5px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: m.hereLabel }),
    div('font:500 10.5px Inter,sans-serif; color:var(--text-faint); margin-top:3px;', { text: m.hereSub }),
  ] });
}

function destinationsList(ui, m, busy) {
  const panel = div(panelStyle('padding:8px; flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:4px;'));
  panel.appendChild(div(sectionLabelStyle() + ' padding:2px 4px 4px;', { text: 'Destinations' }));
  if (m.destinations.length === 0) {
    panel.appendChild(div('font:400 11px Inter,sans-serif; color:var(--text-faint); padding:4px;', { text: 'No routes from here.' }));
  }
  for (const d of m.destinations) {
    const row = div('display:flex; align-items:center; gap:8px; padding:7px 6px; border-radius:4px; background:var(--panel-alt);');
    row.append(
      div('flex:1; min-width:0;', { children: [
        div("font:600 12px 'Barlow Semi Condensed',sans-serif; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;", { text: d.name }),
        div('font:500 10px Inter,sans-serif; color:var(--text-faint);', { text: `${d.tierDisplay} · ${d.dist} · ${d.time} · ${d.heading}` }),
      ] }),
      riskChip(d),
      button('Travel', smallAccentButtonStyle() + ' flex:none;',
        () => { engines(ui).travel.startTravel(d.nodeId); ui.setState({}); }, { disabled: busy || !d.passable })
    );
    panel.appendChild(row);
  }

  // Seek-out targets the player holds reveal authority for (granted by the
  // quest engine on contract acceptance, or the debug menu) — a real, wired
  // action, and the path that surfaces a quest's hidden injected POI.
  const seek = m.seekTargets;
  if (seek && seek.seekable && seek.seekable.length) {
    panel.appendChild(div(sectionLabelStyle() + ' padding:6px 4px 2px;', { text: `Leads (${seek.found}/${seek.total} POIs found)` }));
    for (const t of seek.seekable) {
      panel.appendChild(button(`Seek out ${t.category}`, smallAccentButtonStyle(),
        () => { engines(ui).travel.startExploreDirected(t.id); ui.setState({}); }, { disabled: busy }));
    }
  }
  return panel;
}

function incidentLog(m) {
  const panel = div(panelStyle('padding:8px 10px; max-height:150px; overflow:auto;'));
  panel.appendChild(div(sectionLabelStyle() + ' padding-bottom:6px;', { text: 'Incident log' }));
  if (m.incidents.length === 0) {
    panel.appendChild(div('font:400 11px Inter,sans-serif; color:var(--text-faint);', { text: 'Quiet roads so far.' }));
  }
  for (const inc of m.incidents) {
    const row = div('padding:4px 4px; border-left:2px solid var(--border-strong); margin-bottom:4px;');
    row.append(
      div('display:flex; align-items:baseline; gap:6px;', { children: [
        span('font:500 9.5px Inter,sans-serif; color:var(--text-faint);', { text: `Leg ${inc.legIndex}` }),
        span("font:600 8.5px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.04em;", { text: inc.categoryLabel }),
      ] }),
      div('font:400 11px Inter,sans-serif; color:var(--text-muted); line-height:1.3;', { text: inc.text })
    );
    panel.appendChild(row);
  }
  return panel;
}

// The risk chip — styled per the design but its VALUE is unwired (no per-node
// difficulty scalar). Rendered with the "high" styling and hazard-marked.
function riskChip(d) {
  return span(riskChipStyle('high') + ' flex:none;', { text: 'Risk ?', unwired: d.risk.unwired });
}

// Small accessor so handlers read engines off the live ctx.
function engines(ui) { return ui.ctx.engines; }
