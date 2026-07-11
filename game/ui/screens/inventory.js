// game/ui/screens/inventory.js — Inventory, Desktop + Mobile. There is no item or
// equipment engine (player.inventory is a real but empty array), so every data
// region here is hazard-marked unwired. The category rail and desktop/mobile
// layout are UI-only scaffolding; no item content is fabricated to look real.

import { div, span, el, button } from '../dom.js';
import { buildInventory, INVENTORY_CATEGORIES } from '../model.js';
import {
  panelStyle, sectionLabelStyle, categoryBtnStyle, mobileTabStyle, primaryActionButtonStyle,
  secondaryActionButtonStyle, placeholderStripeStyle, slotChipStyle,
} from '../styles.js';
import { iconSpan } from '../icons.js';

const SLOTS = [
  { label: 'Head', x: 50, y: 9 }, { label: 'Necklace', x: 90, y: 22 }, { label: 'Chest', x: 50, y: 30 },
  { label: 'Gloves', x: 10, y: 35 }, { label: 'Ring', x: 90, y: 48 }, { label: 'Main Hand', x: 10, y: 50 },
  { label: 'Off Hand', x: 90, y: 70 }, { label: 'Legs', x: 50, y: 63 }, { label: 'Shoes', x: 50, y: 84 },
];

export function renderInventory(ui) {
  return ui.state.invView === 'mobile' ? invMobile(ui) : invDesktop(ui);
}

function categoryRail(ui, vertical) {
  const rail = div(vertical
    ? 'display:flex; flex-direction:column; gap:5px;'
    : 'display:flex; gap:6px; overflow-x:auto; padding-bottom:10px;');
  for (const c of INVENTORY_CATEGORIES) {
    const b = el('button', categoryBtnStyle(ui.state.selectedCategory === c.id), {
      title: c.label, onClick: () => ui.setState({ selectedCategory: c.id }),
    });
    b.appendChild(iconSpan('inventory', 15));
    rail.appendChild(b);
  }
  return rail;
}

function itemTable() {
  const panel = div(panelStyle('overflow:hidden; display:flex; flex-direction:column;'));
  panel.appendChild(div('display:grid; grid-template-columns: 1.8fr 0.8fr 0.6fr 0.6fr 0.5fr; gap:6px; padding:8px 10px; background:var(--panel-alt); ' + sectionLabelStyle(),
    { html: '<span>Item name</span><span>Type</span><span>Weight</span><span>Value</span><span>Qty</span>' }));
  const body = div('overflow:auto; flex:1; min-height:120px;', { unwired: true, children: [
    div('font:400 12px Inter,sans-serif; color:var(--text-faint); padding:14px; text-align:center;',
      { text: 'No inventory/item engine wired — this list has no backing.' }),
  ] });
  panel.appendChild(body);
  return panel;
}

function detailPane() {
  return div(panelStyle('padding:10px; display:flex; flex-direction:column; gap:8px; overflow:auto;'), {
    unwired: true,
    children: [
      div(placeholderStripeStyle(1.6), { text: 'ITEM IMAGE' }),
      div("font:600 13px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint);", { text: 'No item selected' }),
      div('font:400 11.5px Inter,sans-serif; color:var(--text-faint); line-height:1.4;', { text: 'Item details are not backed by any engine.' }),
      div('display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:auto;', { children: [
        button('Equip', primaryActionButtonStyle(), null, { disabled: true }),
        button('Drop', secondaryActionButtonStyle(), null, { disabled: true }),
        button('Examine', secondaryActionButtonStyle(), null, { disabled: true }),
        button('Favorite', secondaryActionButtonStyle(), null, { disabled: true }),
      ] }),
    ],
  });
}

function equipMannequin() {
  const panel = div(panelStyle('position:relative; min-height:380px;'), { unwired: true });
  const svg = el('svg', 'position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:46%; height:82%;', {
    attrs: { viewBox: '0 0 100 130' },
    html:
      '<circle cx="50" cy="14" r="10" fill="none" stroke="var(--border-strong)" stroke-width="2"></circle>' +
      '<rect x="34" y="24" width="32" height="46" rx="10" fill="none" stroke="var(--border-strong)" stroke-width="2"></rect>' +
      '<rect x="14" y="28" width="16" height="40" rx="6" fill="none" stroke="var(--border-strong)" stroke-width="2"></rect>' +
      '<rect x="70" y="28" width="16" height="40" rx="6" fill="none" stroke="var(--border-strong)" stroke-width="2"></rect>' +
      '<rect x="36" y="70" width="12" height="50" rx="5" fill="none" stroke="var(--border-strong)" stroke-width="2"></rect>' +
      '<rect x="52" y="70" width="12" height="50" rx="5" fill="none" stroke="var(--border-strong)" stroke-width="2"></rect>',
  });
  panel.appendChild(svg);
  for (const s of SLOTS) {
    panel.appendChild(div(slotChipStyle(false) + `left:${s.x}%; top:${s.y}%;`, { text: s.label }));
  }
  return panel;
}

function invDesktop(ui) {
  buildInventory(ui.ctx); // real (empty) inventory read; kept for parity/audit
  return div('display:grid; grid-template-columns: 40px minmax(260px,1fr) minmax(240px,300px) minmax(220px,260px); gap:10px; padding:10px; min-height:calc(100vh - 92px);',
    { children: [categoryRail(ui, true), itemTable(), detailPane(), equipMannequin()] });
}

function invMobile(ui) {
  const { state, setState } = ui;
  let body;
  if (state.invMobileTab === 'details') body = detailPane();
  else if (state.invMobileTab === 'equip') {
    body = div('display:flex; flex-direction:column; gap:6px;', { unwired: true, children: SLOTS.map((s) =>
      div('display:flex; align-items:center; justify-content:space-between; padding:9px 10px; ' + panelStyle('border-radius:5px;'), {
        children: [
          span("font:600 11.5px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: s.label }),
          span('font:500 11px Inter,sans-serif; color:var(--text-faint);', { text: '—' }),
        ],
      })) });
  } else {
    body = div('', { children: [categoryRail(ui, false), itemTable()] });
  }

  const tabBar = div('display:flex; border-top:1px solid var(--border); background:var(--panel);', { children: [
    mobileTab(ui, 'items', 'inventory', 'Items'),
    mobileTab(ui, 'details', 'journal', 'Details'),
    mobileTab(ui, 'equip', 'character', 'Equip'),
  ] });

  return div('display:flex; flex-direction:column; max-width:420px; margin:0 auto; min-height:calc(100vh - 92px);', {
    children: [div('flex:1; min-height:0; overflow:auto; padding:10px;', { children: [body] }), tabBar],
  });
}

function mobileTab(ui, id, icon, label) {
  const b = el('button', mobileTabStyle(ui.state.invMobileTab === id), { onClick: () => ui.setState({ invMobileTab: id }) });
  b.append(iconSpan(icon, 16), span("font:600 9.5px 'Barlow Semi Condensed',sans-serif; text-transform:uppercase; letter-spacing:0.04em;", { text: label }));
  return b;
}
