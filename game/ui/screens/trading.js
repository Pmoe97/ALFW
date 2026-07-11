// game/ui/screens/trading.js — Trading, Desktop + Mobile. There is no economy /
// merchant / gold engine, so every trade value (gold, prices, offer, net,
// confirm) is hazard-marked unwired. The only real part is the merchant's
// identity (a real NPC), used for the header.

import { div, span, el, button } from '../dom.js';
import { buildTrading } from '../model.js';
import {
  panelStyle, sectionLabelStyle, primaryActionButtonStyle, secondaryActionButtonStyle, mobileTabStyle,
} from '../styles.js';
import { iconSpan } from '../icons.js';

export function renderTrading(ui) {
  return ui.state.tradingView === 'mobile' ? tradingMobile(ui) : tradingDesktop(ui);
}

function header(m, compact) {
  const goldBox = div('text-align:right; flex:none;', {
    unwired: true,
    children: [
      div("font:600 10px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.05em;", { text: 'Your gold' }),
      div("font:700 16px 'Barlow Semi Condensed',sans-serif; color:var(--accent-strong);", { text: '—c' }),
    ],
  });
  return div(panelStyle(`padding:${compact ? '9px 12px' : '10px 14px'}; display:flex; align-items:center; gap:12px;`), {
    children: [
      div(`width:${compact ? 30 : 36}px; height:${compact ? 30 : 36}px; border-radius:50%; background:var(--panel-alt); border:1px solid var(--border-strong); flex:none;`),
      div('flex:1; min-width:0;', { children: [
        div("font:600 14px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: `Trading with ${m.merchantName}` }),
        div('font:500 10.5px Inter,sans-serif; color:var(--text-faint); margin-top:2px;', { text: m.merchantSub || 'merchant' }),
      ] }),
      goldBox,
    ],
  });
}

// A stall listing panel (player's or merchant's) — all values unwired.
function stall(title) {
  const panel = div(panelStyle('padding:10px; display:flex; flex-direction:column; gap:8px; min-height:0;'));
  panel.appendChild(div(sectionLabelStyle(), { text: title }));
  panel.appendChild(div('font:400 11.5px Inter,sans-serif; color:var(--text-faint); padding:12px; text-align:center;',
    { text: 'No economy engine wired — no items, prices, or gold.', unwired: true }));
  return panel;
}

function exchangePanel() {
  return div(panelStyle('padding:14px; border:1px solid var(--accent); border-radius:8px; display:flex; flex-direction:column; gap:10px; box-shadow:0 0 0 1px var(--accent-soft);'), {
    unwired: true,
    children: [
      div("font:600 11px 'Barlow Semi Condensed',sans-serif; color:var(--text); text-transform:uppercase; letter-spacing:0.06em; text-align:center;", { text: 'Exchange' }),
      div('', { children: [
        div(sectionLabelStyle() + ' padding-bottom:5px;', { text: 'You give' }),
        div('font:400 11px Inter,sans-serif; color:var(--text-faint);', { text: '—' }),
      ] }),
      div('', { children: [
        div(sectionLabelStyle() + ' padding-bottom:5px;', { text: 'You receive' }),
        div('font:400 11px Inter,sans-serif; color:var(--text-faint);', { text: '—' }),
      ] }),
      div('border-top:1px solid var(--border); padding-top:10px; display:flex; flex-direction:column; align-items:center; gap:2px;', { children: [
        span(sectionLabelStyle(), { text: 'Net gold change' }),
        span("font:700 22px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint);", { text: '—c' }),
      ] }),
      div('display:flex; gap:6px;', { children: [
        button('Clear', secondaryActionButtonStyle() + ' flex:1;', null, { disabled: true }),
        button('Confirm trade', primaryActionButtonStyle() + ' flex:2;', null, { disabled: true }),
      ] }),
    ],
  });
}

function tradingDesktop(ui) {
  const m = buildTrading(ui.ctx);
  const grid = div('display:grid; grid-template-columns: minmax(0,1fr) minmax(240px,280px) minmax(0,1fr); gap:10px; flex:1; min-height:0;', {
    children: [stall('Your inventory'), exchangePanel(), stall(`${m.merchantName}'s inventory`)],
  });
  return div('display:flex; flex-direction:column; gap:10px; padding:10px; min-height:calc(100vh - 92px);', {
    children: [header(m, false), grid],
  });
}

function tradingMobile(ui) {
  const { state } = ui;
  const m = buildTrading(ui.ctx);
  let body;
  if (state.tradingMobileTab === 'exchange') body = exchangePanel();
  else if (state.tradingMobileTab === 'theirs') body = stall(`${m.merchantName}'s inventory`);
  else body = stall('Your inventory');

  const tabBar = div('display:flex; border-top:1px solid var(--border); background:var(--panel);', { children: [
    mtab(ui, 'yours', 'character', 'Yours'),
    mtab(ui, 'exchange', 'exchange', 'Exchange'),
    mtab(ui, 'theirs', 'inventory', 'Theirs'),
  ] });

  return div('display:flex; flex-direction:column; max-width:420px; margin:0 auto; min-height:calc(100vh - 92px);', {
    children: [
      div('padding:10px 10px 0;', { children: [header(m, true)] }),
      div('flex:1; min-height:0; overflow:auto; padding:10px;', { children: [body] }),
      tabBar,
    ],
  });
}

function mtab(ui, id, icon, label) {
  const b = el('button', mobileTabStyle(ui.state.tradingMobileTab === id), { onClick: () => ui.setState({ tradingMobileTab: id }) });
  b.append(iconSpan(icon, 16), span("font:600 9.5px 'Barlow Semi Condensed',sans-serif; text-transform:uppercase; letter-spacing:0.04em;", { text: label }));
  return b;
}
