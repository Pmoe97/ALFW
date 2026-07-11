// game/ui/screens/craft.js — Craft, stations Blacksmithing / Alchemy / Enchanting.
// There is no crafting engine (farmEngine is a stub), so recipes, ingredient
// have/need, the skill gate, the Craft button, and the output are all hazard-
// marked unwired. The three station tabs are UI-only scaffolding; the output
// preview uses the NEUTRAL "no image yet" placeholder (distinct from the amber
// unwired hazard on the data regions).

import { div, span, button } from '../dom.js';
import { buildCraft, CRAFT_STATIONS } from '../model.js';
import {
  panelStyle, sectionLabelStyle, craftStationTabStyle, secondaryActionButtonStyle, placeholderStripeStyle,
} from '../styles.js';

export function renderCraft(ui) {
  const { state, setState } = ui;
  const m = buildCraft(ui.ctx, state.craftStation);
  const accent = m.station.accent;

  const tabs = div('display:flex; gap:6px;', { children: CRAFT_STATIONS.map((s) => {
    const b = document.createElement('button');
    b.textContent = s.label;
    b.style.cssText = craftStationTabStyle(s.id === state.craftStation, s.accent);
    b.addEventListener('click', () => setState({ craftStation: s.id }));
    return b;
  }) });

  // Recipe list — unwired (no recipe data source).
  const recipeList = div(panelStyle('padding:10px; display:flex; flex-direction:column; gap:6px; min-height:0; overflow:auto;'), {
    unwired: true,
    children: [
      div(sectionLabelStyle() + ' padding:0 2px;', { text: `${m.station.stationName} recipes` }),
      div('font:400 11px Inter,sans-serif; color:var(--text-faint); padding:10px 2px;', { text: 'No crafting engine wired — no recipes.' }),
    ],
  });

  // Bench — unwired.
  const bench = div(panelStyle(`padding:14px; border:1px solid ${accent}; border-radius:8px; display:flex; flex-direction:column; gap:10px;`), {
    unwired: true,
    children: [
      div('display:flex; align-items:baseline; justify-content:space-between;', { children: [
        span("font:600 14px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: 'No recipe selected' }),
        span(`font:500 11px Inter,sans-serif; color:${accent};`, { text: m.station.stationName }),
      ] }),
      div(sectionLabelStyle() + ' padding-top:4px;', { text: 'Materials' }),
      div('font:400 11px Inter,sans-serif; color:var(--text-faint);', { text: 'Ingredients and skill gates are not backed by any engine.' }),
      div('flex:1;'),
      button('Craft', secondaryActionButtonStyle() + ' opacity:0.5; cursor:not-allowed;', null, { disabled: true }),
    ],
  });

  // Output preview — NEUTRAL "no image yet" placeholder (not the unwired hazard).
  const preview = div(panelStyle('padding:12px; display:flex; flex-direction:column; gap:8px;'), {
    children: [
      div(placeholderStripeStyle(1.3), { text: 'OUTPUT PREVIEW' }),
      div('font:400 11.5px Inter,sans-serif; color:var(--text-faint); line-height:1.45;',
        { text: 'Output appears here once crafting is wired to a real engine.', unwired: true }),
    ],
  });

  const grid = div('display:grid; grid-template-columns: minmax(220px,280px) minmax(0,1fr) minmax(240px,300px); gap:10px; flex:1; min-height:0;',
    { children: [recipeList, bench, preview] });

  return div('display:flex; flex-direction:column; gap:10px; padding:10px; min-height:calc(100vh - 92px);',
    { children: [tabs, grid] });
}
