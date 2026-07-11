// game/ui/screens/craft.js — Craft, stations Blacksmithing / Alchemy / Enchanting,
// wired to the economy engine: real recipes per station, ingredient have/need
// from live holdings, the effectiveSkill gate, and an atomic Craft commit
// (one CRAFT_COMPLETED event consumes the inputs and produces the output).
// The output preview keeps the NEUTRAL "no image yet" placeholder — there is
// still no item-image system.

import { div, span, button } from '../dom.js';
import { buildCraft, CRAFT_STATIONS } from '../model.js';
import {
  panelStyle, sectionLabelStyle, craftStationTabStyle, primaryActionButtonStyle,
  secondaryActionButtonStyle, placeholderStripeStyle,
} from '../styles.js';

export function renderCraft(ui) {
  const { state, setState } = ui;
  const m = buildCraft(ui.ctx, state.craftStation, state.craftRecipeId);
  const accent = m.station.accent;

  const tabs = div('display:flex; gap:6px;', { children: CRAFT_STATIONS.map((s) => {
    const b = document.createElement('button');
    b.textContent = s.label;
    b.style.cssText = craftStationTabStyle(s.id === state.craftStation, s.accent);
    b.addEventListener('click', () => setState({ craftStation: s.id }));
    return b;
  }) });

  // Recipe list — one row per station recipe, live craftability at a glance.
  const recipeRows = m.recipes.map((r) => {
    const selected = m.selected?.id === r.id;
    return div(
      `display:flex; align-items:baseline; gap:8px; padding:7px 8px; border-radius:4px; cursor:pointer; ` +
      `border-left:2px solid ${selected ? accent : 'transparent'}; background:${selected ? 'var(--panel-alt)' : 'transparent'};`,
      {
        onClick: () => setState({ craftRecipeId: r.id }),
        children: [
          span("font:600 12px 'Barlow Semi Condensed',sans-serif; color:var(--text); flex:1; min-width:0;", { text: r.name }),
          span(`font:600 10px Inter,sans-serif; color:${r.canCraft ? 'var(--good)' : 'var(--text-faint)'};`,
            { text: r.canCraft ? 'ready' : r.skillGate.met ? 'missing materials' : 'skill too low' }),
        ],
      }
    );
  });
  const recipeList = div(panelStyle('padding:10px; display:flex; flex-direction:column; gap:6px; min-height:0; overflow:auto;'), {
    children: [
      div(sectionLabelStyle() + ' padding:0 2px;', { text: `${m.station.stationName} recipes` }),
      ...(recipeRows.length ? recipeRows
        : [div('font:400 11px Inter,sans-serif; color:var(--text-faint); padding:10px 2px;', { text: 'No recipes at this station.' })]),
    ],
  });

  // Bench — the selected recipe's materials, skill gate, and the Craft commit.
  const r = m.selected;
  const benchChildren = [
    div('display:flex; align-items:baseline; justify-content:space-between;', { children: [
      span("font:600 14px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: r ? r.name : 'No recipe selected' }),
      span(`font:500 11px Inter,sans-serif; color:${accent};`, { text: m.station.stationName }),
    ] }),
    div(sectionLabelStyle() + ' padding-top:4px;', { text: 'Materials' }),
  ];
  if (r) {
    for (const input of r.inputs) {
      benchChildren.push(div('display:flex; justify-content:space-between; gap:8px;', { children: [
        span('font:400 11.5px Inter,sans-serif; color:var(--text);', { text: input.name }),
        span(`font:600 11.5px Inter,sans-serif; color:${input.met ? 'var(--good)' : 'var(--danger)'};`, { text: `${input.have} / ${input.need}` }),
      ] }));
    }
    benchChildren.push(div('display:flex; justify-content:space-between; gap:8px; border-top:1px solid var(--border); padding-top:8px; margin-top:4px;', { children: [
      span('font:400 11.5px Inter,sans-serif; color:var(--text);', { text: `Skill: ${r.skillGate.name}` }),
      span(`font:600 11.5px Inter,sans-serif; color:${r.skillGate.met ? 'var(--good)' : 'var(--danger)'};`, { text: `${r.skillGate.effective} / ${r.skillGate.min} required` }),
    ] }));
  } else {
    benchChildren.push(div('font:400 11px Inter,sans-serif; color:var(--text-faint);', { text: 'Select a recipe from the list.' }));
  }
  benchChildren.push(div('flex:1;'));
  benchChildren.push(r && r.canCraft
    ? button('Craft', primaryActionButtonStyle(), () => {
        ui.ctx.actions.craftRecipe(m.station.id, r.id);
        setState({});
      })
    : button('Craft', secondaryActionButtonStyle() + ' opacity:0.5; cursor:not-allowed;', null, {
        disabled: true,
        title: r ? (r.skillGate.met ? 'Missing materials' : 'Skill too low') : 'No recipe selected',
      }));
  const bench = div(panelStyle(`padding:14px; border:1px solid ${accent}; border-radius:8px; display:flex; flex-direction:column; gap:10px;`), {
    children: benchChildren,
  });

  // Output preview — real output item; the image keeps the NEUTRAL placeholder.
  const preview = div(panelStyle('padding:12px; display:flex; flex-direction:column; gap:8px;'), {
    children: [
      div(placeholderStripeStyle(1.3), { text: 'OUTPUT PREVIEW' }),
      r
        ? div('font:400 11.5px Inter,sans-serif; color:var(--text); line-height:1.45;', {
            text: `${r.output.qty}× ${r.output.name} (${r.output.value}c)`,
          })
        : div('font:400 11.5px Inter,sans-serif; color:var(--text-faint); line-height:1.45;', { text: 'Select a recipe to see its output.' }),
    ],
  });

  const grid = div('display:grid; grid-template-columns: minmax(220px,280px) minmax(0,1fr) minmax(240px,300px); gap:10px; flex:1; min-height:0;',
    { children: [recipeList, bench, preview] });

  return div('display:flex; flex-direction:column; gap:10px; padding:10px; min-height:calc(100vh - 92px);',
    { children: [tabs, grid] });
}
