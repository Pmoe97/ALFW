// game/ui/hud.js — the persistent moment-frame / HUD across the top of every
// screen (design lines 66-117). Real navigation lives here: the quick-access
// icons switch screens and the menu icon toggles the developer debug menu.
// Player name/vocation, location + tier + controlling faction, and the clock are
// live engine reads; the "Level" tag and the Visibility meter are marked unwired
// (no level field, no visibility/notoriety stat).

import { div, span, el, button } from './dom.js';
import { buildHud } from './model.js';
import { hudIconStyle } from './styles.js';
import { iconSpan } from './icons.js';

export function renderHud(ui) {
  const m = buildHud(ui.ctx);
  const { setState } = ui;

  const bar = div(
    'display:flex; align-items:center; gap:0; flex-wrap:wrap; background:var(--panel); border-bottom:1px solid var(--border); padding:6px 12px; min-height:44px;'
  );

  // Player
  const avatar = div(
    'width:28px; height:28px; border-radius:50%; background:var(--accent-soft); border:1px solid var(--accent); color:var(--accent-strong); display:flex; align-items:center; justify-content:center; font:600 11px \'Barlow Semi Condensed\',sans-serif; flex:none;',
    { text: m.initials || '?' }
  );
  const levelTag = span(
    'font:500 10px Inter,sans-serif; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.04em;',
    { text: `${m.vocation} · ${m.level.text}`, unwired: m.level.unwired }
  );
  const playerBlock = div(
    'display:flex; align-items:center; gap:8px; padding-right:14px; margin-right:14px; border-right:1px solid var(--border);',
    { children: [avatar, div('display:flex; flex-direction:column; line-height:1.15; min-width:0;', {
      children: [
        span("font:600 12.5px 'Barlow Semi Condensed',sans-serif; color:var(--text); white-space:nowrap;", { text: m.name }),
        levelTag,
      ],
    })] }
  );

  // Location
  const locationBlock = div(
    'display:flex; align-items:center; gap:6px; padding-right:14px; margin-right:14px; border-right:1px solid var(--border); min-width:0;',
    { children: [
      iconSpan('pin', 14),
      div('display:flex; flex-direction:column; line-height:1.15; min-width:0;', {
        children: [
          span("font:600 12px 'Barlow Semi Condensed',sans-serif; color:var(--text); white-space:nowrap;", { text: m.location }),
          span('font:500 10px Inter,sans-serif; color:var(--text-faint); white-space:nowrap;', { text: m.locationSub }),
        ],
      }),
    ] }
  );

  // Clock
  const clockBlock = div(
    'display:flex; align-items:center; gap:6px; padding-right:14px; margin-right:14px; border-right:1px solid var(--border);',
    { children: [
      iconSpan('clock', 14),
      span("font:600 12px 'Barlow Semi Condensed',sans-serif; color:var(--text); white-space:nowrap;", { text: m.clockText }),
    ] }
  );

  // Visibility (unwired)
  const visTrack = div('width:60px; height:5px; border-radius:3px; background:var(--border); overflow:hidden;', {
    children: [div(`width:${m.visibility.pct}%; height:100%; background:var(--accent);`)],
    unwired: m.visibility.unwired,
  });
  const visBlock = div(
    'display:flex; align-items:center; gap:8px; padding-right:14px; margin-right:14px; border-right:1px solid var(--border);',
    { children: [
      span("font:600 10px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); text-transform:uppercase; letter-spacing:0.05em; white-space:nowrap;", { text: 'Visibility' }),
      visTrack,
    ] }
  );

  const spacer = div('flex:1; min-width:8px;');

  // Quick access — real navigation
  const quick = div('display:flex; align-items:center; gap:4px;', {
    children: [
      hudBtn('inventory', 'Inventory', () => setState({ screen: 'inventory' })),
      hudBtn('journal', 'Journal & Map', () => setState({ screen: 'journal' })),
      hudBtn('character', 'Character sheet', () => setState({ screen: 'character' })),
      hudBtn('menu', 'Debug menu', () => setState({ debugOpen: !ui.state.debugOpen })),
    ],
  });

  bar.append(playerBlock, locationBlock, clockBlock, visBlock, spacer, quick);
  return bar;
}

function hudBtn(iconName, title, onClick) {
  const b = el('button', hudIconStyle, { title, onClick });
  b.appendChild(iconSpan(iconName, 15));
  return b;
}
