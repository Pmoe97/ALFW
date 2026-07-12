// game/ui/screens/journal.js — Journal, tabs Log / People / Map.
// WIRED: Log (the guild board — quest engine statuses, pure-replay objective
// progress, accept/turn-in/abandon verbs), People (relationshipStore names +
// real tiers + real stats), Map (materialized nodes + POI discovery, real
// coordinates). UNWIRED (marked): the per-person progress bar (no 0-100
// relationship scale).

import { div, span, button } from '../dom.js';
import { buildJournal } from '../model.js';
import {
  panelStyle, sectionLabelStyle, journalTabStyle, tierChipStyle, barTrackStyle, barFillStyle,
  smallAccentButtonStyle,
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
  else body = logTab(m, ui);

  return div('display:flex; flex-direction:column; gap:10px; padding:10px; max-width:1000px; margin:0 auto; min-height:calc(100vh - 92px);',
    { children: [tabs, body] });
}

// Log / quests — WIRED: the guild board. Contracts are the quest engine's
// log-derived statuses; every verb goes through ctx.actions (thin arrows over
// the engine's react verbs), then setState({}) for an immediate re-render
// (the travel-screen pattern).
function logTab(m, ui) {
  const q = m.quests;
  const wrap = div('display:flex; flex-direction:column; gap:8px;');
  const act = (fn) => () => { fn(); ui.setState({}); };
  const muted = (text) => div('font:400 11px Inter,sans-serif; color:var(--text-faint);', { text });

  function questCard(entry, buttons, objectives) {
    const card = div(panelStyle('padding:10px 12px; display:flex; flex-direction:column; gap:6px;'));
    card.appendChild(div('display:flex; align-items:baseline; gap:8px; flex-wrap:wrap;', { children: [
      span("font:600 12.5px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: entry.title }),
      span('font:500 10.5px Inter,sans-serif; color:var(--text-faint);', { text: entry.giverName }),
    ] }));
    if (entry.description) {
      card.appendChild(div('font:400 11.5px Inter,sans-serif; color:var(--text-muted); line-height:1.45;', { text: entry.description }));
    }
    for (const o of objectives ?? []) {
      card.appendChild(div('display:flex; align-items:baseline; gap:6px; font:500 11.5px Inter,sans-serif;', { children: [
        span(`flex:none; color:${o.done ? 'var(--accent)' : 'var(--text-faint)'};`, { text: o.done ? '✓' : '○' }),
        span(`color:${o.done ? 'var(--text-muted)' : 'var(--text)'};`, { text: o.text }),
        ...(o.note ? [span('color:var(--text-faint); font-size:10px;', { text: o.note })] : []),
      ] }));
    }
    if (entry.rewardsNote) {
      card.appendChild(div('font:500 10.5px Inter,sans-serif; color:var(--text-faint);', { text: `Reward: ${entry.rewardsNote}` }));
    }
    if (buttons.length) {
      card.appendChild(div('display:flex; align-items:center; gap:8px; margin-top:2px;', { children: buttons }));
    }
    return card;
  }

  function section(label, entries, renderEntry, emptyText) {
    wrap.appendChild(div(sectionLabelStyle() + ' padding:4px 2px 0;', { text: label }));
    if (!entries.length) wrap.appendChild(muted(emptyText));
    for (const entry of entries) wrap.appendChild(renderEntry(entry));
  }

  section('Guild board — available contracts', q.available, (entry) => {
    const buttons = [
      button('Accept', smallAccentButtonStyle(), act(() => ui.ctx.actions.acceptQuest(entry.id)), { disabled: !entry.canAccept }),
      ...(entry.acceptHint ? [muted(entry.acceptHint)] : []),
    ];
    return questCard(entry, buttons, entry.objectives);
  }, 'No contracts on offer.');

  section('Active', q.active, (entry) => {
    const buttons = [
      button('Turn in', smallAccentButtonStyle(), act(() => ui.ctx.actions.turnInQuest(entry.id)), { disabled: !entry.canTurnIn }),
      button('Abandon', smallAccentButtonStyle(), act(() => ui.ctx.actions.abandonQuest(entry.id))),
      ...(entry.turnInHint ? [muted(entry.turnInHint)] : []),
    ];
    return questCard(entry, buttons, entry.objectives);
  }, 'Nothing underway.');

  section('Completed', q.completed, (entry) => questCard(entry, []), 'Nothing finished yet.');
  if (q.failed.length) {
    section('Abandoned', q.failed, (entry) => questCard(entry, []), '');
  }
  return wrap;
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
