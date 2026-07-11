// game/ui/screens/inventory.js — Inventory, Desktop + Mobile, wired to the
// economy engine: the item table, detail pane, Drop/Equip/Unequip, and the
// equip mannequin all read real holdings/equipment. Examine and Favorite stay
// hazard-marked unwired (no examine-text or favorites backing exists); the
// item image keeps the NEUTRAL "no image yet" placeholder.

import { div, span, el, button } from '../dom.js';
import { buildInventory, INVENTORY_CATEGORIES } from '../model.js';
import {
  panelStyle, sectionLabelStyle, categoryBtnStyle, mobileTabStyle, primaryActionButtonStyle,
  secondaryActionButtonStyle, placeholderStripeStyle, slotChipStyle,
} from '../styles.js';
import { iconSpan } from '../icons.js';

const SLOTS = [
  { id: 'head', label: 'Head', x: 50, y: 9 }, { id: 'necklace', label: 'Necklace', x: 90, y: 22 }, { id: 'chest', label: 'Chest', x: 50, y: 30 },
  { id: 'gloves', label: 'Gloves', x: 10, y: 35 }, { id: 'ring', label: 'Ring', x: 90, y: 48 }, { id: 'mainHand', label: 'Main Hand', x: 10, y: 50 },
  { id: 'offHand', label: 'Off Hand', x: 90, y: 70 }, { id: 'legs', label: 'Legs', x: 50, y: 63 }, { id: 'shoes', label: 'Shoes', x: 50, y: 84 },
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

function itemTable(ui, m) {
  const panel = div(panelStyle('overflow:hidden; display:flex; flex-direction:column;'));
  panel.appendChild(div('display:grid; grid-template-columns: 1.8fr 0.8fr 0.6fr 0.6fr 0.5fr; gap:6px; padding:8px 10px; background:var(--panel-alt); ' + sectionLabelStyle(),
    { html: '<span>Item name</span><span>Type</span><span>Weight</span><span>Value</span><span>Qty</span>' }));
  const body = div('overflow:auto; flex:1; min-height:120px;');
  if (m.items.length === 0) {
    body.appendChild(div('font:400 12px Inter,sans-serif; color:var(--text-faint); padding:14px; text-align:center;',
      { text: 'Nothing in this category.' }));
  }
  for (const row of m.items) {
    const selected = m.selected?.key === row.key;
    body.appendChild(div(
      `display:grid; grid-template-columns: 1.8fr 0.8fr 0.6fr 0.6fr 0.5fr; gap:6px; padding:7px 10px; cursor:pointer; align-items:baseline; ` +
      `border-left:2px solid ${selected ? 'var(--accent)' : 'transparent'}; background:${selected ? 'var(--panel-alt)' : 'transparent'};`,
      {
        onClick: () => ui.setState({ selectedItemId: row.key }),
        children: [
          span("font:600 12px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: row.name + (row.equipped ? ' (equipped)' : '') }),
          span('font:400 11px Inter,sans-serif; color:var(--text-faint);', { text: row.typeLabel }),
          span('font:400 11px Inter,sans-serif; color:var(--text-faint);', { text: String(row.weight) }),
          span('font:500 11px Inter,sans-serif; color:var(--accent-strong);', { text: `${row.value}c` }),
          span('font:500 11px Inter,sans-serif; color:var(--text);', { text: String(row.qty) }),
        ],
      }
    ));
  }
  panel.appendChild(body);
  return panel;
}

function detailPane(ui, m) {
  const item = m.selected;
  const act = ui.ctx.actions;

  const buttons = [];
  if (item?.slot && item.instanceId) {
    buttons.push(button(item.equipped ? 'Unequip' : 'Equip', primaryActionButtonStyle(), () => {
      act.equipItem(item.slot, item.equipped ? null : item.instanceId);
      ui.setState({});
    }));
  } else {
    buttons.push(button('Equip', primaryActionButtonStyle(), null, { disabled: true, title: item ? 'Not equippable' : 'No item selected' }));
  }
  buttons.push(button('Drop', secondaryActionButtonStyle(), item && !item.equipped ? () => {
    act.dropItem(item.instanceId ? { instanceIds: [item.instanceId] } : { stacks: { [item.defId]: item.qty } });
    ui.setState({ selectedItemId: null });
  } : null, { disabled: !item || item.equipped, title: item?.equipped ? 'Unequip it first' : undefined }));
  // Examine/Favorite have no backing engine — the audit keeps them marked.
  buttons.push(button('Examine', secondaryActionButtonStyle(), null, { disabled: true, unwired: m.examine.unwired }));
  buttons.push(button('Favorite', secondaryActionButtonStyle(), null, { disabled: true, unwired: m.favorite.unwired }));

  return div(panelStyle('padding:10px; display:flex; flex-direction:column; gap:8px; overflow:auto;'), {
    children: [
      div(placeholderStripeStyle(1.6), { text: 'ITEM IMAGE' }),
      div("font:600 13px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: item ? item.name : 'No item selected' }),
      item
        ? div('font:400 11.5px Inter,sans-serif; color:var(--text-faint); line-height:1.4;', {
            text: `${item.typeLabel} · ${item.value}c · ${item.weight} wt` +
              (item.qty > 1 ? ` · ×${item.qty}` : '') +
              (item.slot ? ` · fits ${SLOTS.find((s) => s.id === item.slot)?.label ?? item.slot}` : '') +
              (item.equipped ? ' · currently equipped' : ''),
          })
        : div('font:400 11.5px Inter,sans-serif; color:var(--text-faint); line-height:1.4;', { text: 'Select an item from the list.' }),
      div('display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:auto;', { children: buttons }),
    ],
  });
}

function equipMannequin(ui, m) {
  const panel = div(panelStyle('position:relative; min-height:380px;'));
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
    const worn = m.equippedBySlot[s.id];
    panel.appendChild(div(slotChipStyle(Boolean(worn)) + `left:${s.x}%; top:${s.y}%;`, {
      text: worn ? worn.name : s.label,
      title: worn ? `${s.label}: ${worn.name} — click to select` : `${s.label}: empty`,
      onClick: worn ? () => ui.setState({ selectedItemId: worn.key }) : null,
    }));
  }
  return panel;
}

function invDesktop(ui) {
  const m = buildInventory(ui.ctx, ui.state);
  return div('display:grid; grid-template-columns: 40px minmax(260px,1fr) minmax(240px,300px) minmax(220px,260px); gap:10px; padding:10px; min-height:calc(100vh - 92px);',
    { children: [categoryRail(ui, true), itemTable(ui, m), detailPane(ui, m), equipMannequin(ui, m)] });
}

function invMobile(ui) {
  const { state } = ui;
  const m = buildInventory(ui.ctx, state);
  let body;
  if (state.invMobileTab === 'details') body = detailPane(ui, m);
  else if (state.invMobileTab === 'equip') {
    body = div('display:flex; flex-direction:column; gap:6px;', { children: SLOTS.map((s) => {
      const worn = m.equippedBySlot[s.id];
      return div('display:flex; align-items:center; justify-content:space-between; padding:9px 10px; ' + panelStyle('border-radius:5px;'), {
        onClick: worn ? () => ui.setState({ selectedItemId: worn.key, invMobileTab: 'details' }) : null,
        children: [
          span("font:600 11.5px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: s.label }),
          span(`font:500 11px Inter,sans-serif; color:${worn ? 'var(--text)' : 'var(--text-faint)'};`, { text: worn ? worn.name : '—' }),
        ],
      });
    }) });
  } else {
    body = div('', { children: [categoryRail(ui, false), itemTable(ui, m)] });
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
