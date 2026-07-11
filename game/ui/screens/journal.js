// game/ui/screens/journal.js — Journal, tabs Log / People / Map.
// WIRED: People (relationshipStore names + real tiers + real stats), Map
// (materialized nodes + POI discovery, real coordinates). UNWIRED (marked): the
// Log/quests tab (no quest engine) and the per-person progress bar (no 0-100
// relationship scale).

import { div, span } from '../dom.js';
import { buildJournal } from '../model.js';
import {
  panelStyle, sectionLabelStyle, journalTabStyle, tierChipStyle, barTrackStyle, barFillStyle,
} from '../styles.js';
import { renderMapSvg } from '../mapSvg.js';

export function renderJournal(ui) {
  const { state, setState } = ui;
  const m = buildJournal(ui.ctx);

  const tabs = div('display:flex; gap:6px;', { children: [
    tab('Log', 'log'), tab('People', 'people'), tab('Map', 'map'),
  ] });
  function tab(label, id) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = journalTabStyle(state.journalTab === id);
    b.addEventListener('click', () => setState({ journalTab: id }));
    return b;
  }

  let body;
  if (state.journalTab === 'people') body = peopleTab(m);
  else if (state.journalTab === 'map') body = mapTab(m);
  else body = logTab();

  return div('display:flex; flex-direction:column; gap:10px; padding:10px; max-width:1000px; margin:0 auto; min-height:calc(100vh - 92px);',
    { children: [tabs, body] });
}

// Log / quests — no quest engine exists.
function logTab() {
  const panel = div(panelStyle('padding:14px;'), { unwired: true, children: [
    div(sectionLabelStyle() + ' padding-bottom:6px;', { text: 'Quest log' }),
    div('font:400 12px Inter,sans-serif; color:var(--text-muted); line-height:1.5;',
      { text: 'No quest engine is wired yet. POI reveal-authority (the quest/spell stand-in) can be granted from the debug menu.' }),
  ] });
  return panel;
}

// People — WIRED.
function peopleTab(m) {
  const wrap = div('display:flex; flex-direction:column; gap:8px;');
  if (!m.people.length) {
    wrap.appendChild(div('font:400 12px Inter,sans-serif; color:var(--text-faint);', { text: 'No acquaintances recorded yet.' }));
  }
  for (const p of m.people) {
    const row = div(panelStyle('padding:10px 12px; display:flex; align-items:center; gap:12px;'));
    row.append(
      div('width:34px; height:34px; border-radius:50%; background:var(--panel-alt); border:1px solid var(--border-strong); flex:none;'),
      div('flex:1; min-width:0;', { children: [
        div('display:flex; align-items:center; gap:8px; flex-wrap:wrap;', { children: [
          span("font:600 12.5px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: p.name }),
          span(tierChipStyle(), { text: p.tier }),
        ] }),
        div('font:400 11px Inter,sans-serif; color:var(--text-faint); margin-top:2px;', { text: p.statsNote }),
        div(barTrackStyle(4) + ' width:160px; margin-top:5px;', { children: [div(barFillStyle(50))], unwired: p.bar.unwired }),
      ] })
    );
    wrap.appendChild(row);
  }
  return wrap;
}

// Map — WIRED (real materialized nodes).
function mapTab(m) {
  const mapPanel = div(panelStyle('overflow:hidden; min-height:380px; position:relative;'));
  const { svg, legend } = renderMapSvg(m.mapNodes, {});
  mapPanel.append(svg, legend);

  const list = div(panelStyle('padding:10px; display:flex; flex-direction:column; gap:4px;'));
  list.appendChild(div(sectionLabelStyle() + ' padding-bottom:4px;', { text: `Discovered (${m.mapNodes.length})` }));
  for (const n of m.mapNodes) {
    list.appendChild(div('font:500 11.5px Inter,sans-serif; color:var(--text-muted); padding:4px 0; border-top:1px solid var(--border);',
      { text: (n.here ? '● ' : '') + n.label }));
  }

  return div('display:grid; grid-template-columns: minmax(0,1fr) 220px; gap:10px;', { children: [mapPanel, list] });
}
