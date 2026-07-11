// game/ui/screens/trading.js — Trading, Desktop + Mobile, wired to the economy
// engine against Sable's authored Rusted Ledger. The offer is UI state
// (offerPlayerIds / offerMerchantIds — row keys, one occurrence per unit);
// every price, the net, and Confirm's enablement come from economy.quote(),
// which shares its validation path with the trade() commit, so an enabled
// Confirm can never dispatch a rejectable trade.

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
    children: [
      div("font:600 10px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.05em;", { text: 'Your gold' }),
      div("font:700 16px 'Barlow Semi Condensed',sans-serif; color:var(--accent-strong);", { text: `${m.playerGold}c` }),
    ],
  });
  return div(panelStyle(`padding:${compact ? '9px 12px' : '10px 14px'}; display:flex; align-items:center; gap:12px;`), {
    children: [
      div(`width:${compact ? 30 : 36}px; height:${compact ? 30 : 36}px; border-radius:50%; background:var(--panel-alt); border:1px solid var(--border-strong); flex:none;`),
      div('flex:1; min-width:0;', { children: [
        div("font:600 14px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: `Trading with ${m.merchantName}` }),
        div('font:500 10.5px Inter,sans-serif; color:var(--text-faint); margin-top:2px;', { text: `${m.merchantSub || 'merchant'} · shop purse ${m.shopGold}c` }),
      ] }),
      goldBox,
    ],
  });
}

// A stall listing panel. Clicking a row adds ONE unit of it to the offer
// (clicking an offer line in the exchange panel removes one). `side` picks
// which offer array the row keys land in.
function stall(ui, m, title, rows, side) {
  const stateKey = side === 'player' ? 'offerPlayerIds' : 'offerMerchantIds';
  const panel = div(panelStyle('padding:10px; display:flex; flex-direction:column; gap:2px; min-height:0; overflow:auto;'));
  panel.appendChild(div(sectionLabelStyle() + ' padding-bottom:6px;', { text: title }));
  if (rows.length === 0) {
    panel.appendChild(div('font:400 11.5px Inter,sans-serif; color:var(--text-faint); padding:12px; text-align:center;', { text: 'Nothing to trade.' }));
  }
  for (const row of rows) {
    const remaining = row.qty - row.inOffer;
    const blocked = row.equipped || remaining <= 0;
    panel.appendChild(div(
      `display:flex; align-items:baseline; gap:8px; padding:6px 8px; border-radius:4px; cursor:${blocked ? 'not-allowed' : 'pointer'}; opacity:${blocked ? 0.55 : 1}; ` +
      (row.inOffer > 0 ? 'background:var(--panel-alt);' : ''),
      {
        title: row.equipped ? 'Equipped — unequip it first' : `${row.unitPrice}c each — click to add one to the offer`,
        onClick: blocked ? null : () => ui.setState({ [stateKey]: [...ui.state[stateKey], row.key] }),
        children: [
          span("font:600 12px 'Barlow Semi Condensed',sans-serif; color:var(--text); flex:1; min-width:0;",
            { text: row.name + (row.equipped ? ' (equipped)' : '') }),
          row.qty > 1 ? span('font:400 10.5px Inter,sans-serif; color:var(--text-faint);', { text: `×${row.qty}` }) : null,
          row.inOffer > 0 ? span('font:600 10.5px Inter,sans-serif; color:var(--accent-strong);', { text: `${row.inOffer} in offer` }) : null,
          span('font:500 11px Inter,sans-serif; color:var(--accent-strong); flex:none;', { text: `${row.unitPrice}c` }),
        ],
      }
    ));
  }
  return panel;
}

// One committed side of the exchange preview. Clicking a line removes one
// unit of it from the offer.
function offerLines(ui, lines, kind, stateKey) {
  const mine = lines.filter((l) => l.kind === kind);
  if (mine.length === 0) return div('font:400 11px Inter,sans-serif; color:var(--text-faint);', { text: '—' });
  return div('display:flex; flex-direction:column; gap:3px;', {
    children: mine.map((l) => div('display:flex; justify-content:space-between; gap:8px; cursor:pointer;', {
      title: 'Click to remove one from the offer',
      onClick: () => {
        const keys = [...ui.state[stateKey]];
        const idx = keys.findIndex((k) => k === l.key);
        if (idx !== -1) keys.splice(idx, 1);
        ui.setState({ [stateKey]: keys });
      },
      children: [
        span('font:400 11px Inter,sans-serif; color:var(--text);', { text: `${l.qty}× ${l.name}` }),
        span('font:500 11px Inter,sans-serif; color:var(--accent-strong);', { text: `${l.total}c` }),
      ],
    })),
  });
}

function exchangePanel(ui, m) {
  const q = m.quote;
  const net = q.ok ? q.netGold : 0;
  const netText = q.empty ? '—c' : q.ok ? `${net > 0 ? '+' : ''}${net}c` : '—c';
  const netColor = !q.ok || net === 0 ? 'var(--text-faint)' : net > 0 ? 'var(--good)' : 'var(--danger)';

  const clear = () => ui.setState({ offerPlayerIds: [], offerMerchantIds: [] });
  const confirm = () => {
    const result = ui.ctx.actions.confirmTrade(m.offer);
    if (result.ok) clear();
    else ui.setState({}); // engine re-quote will surface the reason
  };

  return div(panelStyle('padding:14px; border:1px solid var(--accent); border-radius:8px; display:flex; flex-direction:column; gap:10px; box-shadow:0 0 0 1px var(--accent-soft);'), {
    children: [
      div("font:600 11px 'Barlow Semi Condensed',sans-serif; color:var(--text); text-transform:uppercase; letter-spacing:0.06em; text-align:center;", { text: 'Exchange' }),
      div('', { children: [
        div(sectionLabelStyle() + ' padding-bottom:5px;', { text: 'You give' }),
        offerLines(ui, q.lines ?? [], 'sell', 'offerPlayerIds'),
      ] }),
      div('', { children: [
        div(sectionLabelStyle() + ' padding-bottom:5px;', { text: 'You receive' }),
        offerLines(ui, q.lines ?? [], 'buy', 'offerMerchantIds'),
      ] }),
      !q.empty && !q.ok
        ? div('font:500 10.5px Inter,sans-serif; color:var(--danger); text-align:center;', { text: q.reason })
        : null,
      div('border-top:1px solid var(--border); padding-top:10px; display:flex; flex-direction:column; align-items:center; gap:2px;', { children: [
        span(sectionLabelStyle(), { text: 'Net gold change' }),
        span(`font:700 22px 'Barlow Semi Condensed',sans-serif; color:${netColor};`, { text: netText }),
      ] }),
      div('display:flex; gap:6px;', { children: [
        button('Clear', secondaryActionButtonStyle() + ' flex:1;', q.empty ? null : clear, { disabled: q.empty }),
        button('Confirm trade', primaryActionButtonStyle() + ' flex:2;', q.ok ? confirm : null, { disabled: !q.ok }),
      ] }),
    ],
  });
}

function tradingDesktop(ui) {
  const m = buildTrading(ui.ctx, ui.state);
  const grid = div('display:grid; grid-template-columns: minmax(0,1fr) minmax(240px,280px) minmax(0,1fr) ; gap:10px; flex:1; min-height:0;', {
    children: [
      stall(ui, m, 'Your inventory', m.playerRows, 'player'),
      exchangePanel(ui, m),
      stall(ui, m, `${m.merchantName}'s stock`, m.shopRows, 'merchant'),
    ],
  });
  return div('display:flex; flex-direction:column; gap:10px; padding:10px; min-height:calc(100vh - 92px);', {
    children: [header(m, false), grid],
  });
}

function tradingMobile(ui) {
  const { state } = ui;
  const m = buildTrading(ui.ctx, state);
  let body;
  if (state.tradingMobileTab === 'exchange') body = exchangePanel(ui, m);
  else if (state.tradingMobileTab === 'theirs') body = stall(ui, m, `${m.merchantName}'s stock`, m.shopRows, 'merchant');
  else body = stall(ui, m, 'Your inventory', m.playerRows, 'player');

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
