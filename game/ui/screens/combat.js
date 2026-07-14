// game/ui/screens/combat.js — the turn-based combat screen. Rendered whenever a
// fight is open (app-state forces this screen while combat.getActiveCombat() or
// isPlayerDefeated()), so it also serves as the Game Over surface.
//
// It reads a fully-built view-model from model.buildCombat and drives the fight
// through ctx.actions.combatAct — one button = one round (the player acts, then
// the whole round resolves in initiative order). The lethal/nonlethal fork is
// two distinct buttons (Attack / Subdue), the design pillar made literal.

import { div, span, button } from '../dom.js';
import { buildCombat } from '../model.js';
import {
  panelStyle, sectionLabelStyle, barTrackStyle, barFillStyle,
  primaryActionButtonStyle, secondaryActionButtonStyle, smallAccentButtonStyle,
  statusChipStyle,
} from '../styles.js';

export function renderCombat(ui) {
  const { ctx, state, setState } = ui;
  const m = buildCombat(ctx);

  // Game Over / no active fight — the forced-screen fallback.
  if (!m.active) {
    if (m.defeated) return gameOverPanel(m);
    // No fight and not defeated: a transient state (combat just ended). Show a
    // brief aftermath then let the player return to travel.
    return aftermathPanel(ui, m);
  }

  // Default the target to the first live enemy if the current selection is gone.
  const liveIds = m.liveEnemies.map((e) => e.id);
  const targetId = liveIds.includes(state.combatTargetId) ? state.combatTargetId : (liveIds[0] ?? null);

  const header = div('display:flex; align-items:center; justify-content:space-between; gap:8px;', {
    children: [
      div("font:600 15px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: 'Combat' }),
      span(statusChipStyle('active'), { text: `Round ${m.round + 1}` }),
    ],
  });

  // Initiative strip — turn order with live HP + status markers.
  const strip = div(panelStyle('padding:10px 12px; display:flex; flex-direction:column; gap:8px;'), {
    children: [
      div(sectionLabelStyle(), { text: 'Turn order' }),
      div('display:flex; flex-direction:column; gap:8px;', { children: m.order.map((c) => combatantRow(c, c.id === targetId, () => setState({ combatTargetId: c.id }))) }),
    ],
  });

  // Action bar — one press resolves a full round.
  const actionBar = buildActionBar(ui, m, targetId);

  // Round log — the last round's blow-by-blow.
  const logPanel = div(panelStyle('padding:10px 12px; display:flex; flex-direction:column; gap:5px;'), {
    children: [
      div(sectionLabelStyle(), { text: 'Last round' }),
      ...(m.lastActions.length
        ? m.lastActions.map((line) => div('font:400 11.5px Inter,sans-serif; color:var(--text-muted); line-height:1.4;', { text: line }))
        : [div('font:400 11.5px Inter,sans-serif; color:var(--text-faint);', { text: 'The fight begins…' })]),
    ],
  });

  return div('display:flex; flex-direction:column; gap:10px; padding:10px; max-width:720px; margin:0 auto; min-height:calc(100vh - 92px);',
    { children: [header, strip, actionBar, logPanel] });
}

// --- combatant row: name, HP bar, status ------------------------------------
function combatantRow(c, isTarget, onSelect) {
  const dead = c.status === 'dead';
  const subdued = c.status === 'subdued';
  const barColor = c.side === 'player' ? 'var(--good)' : 'var(--danger)';
  const selectable = c.side === 'enemy' && c.status === 'alive';
  const style = `display:grid; grid-template-columns: 120px 1fr 64px; gap:10px; align-items:center; padding:6px 8px; border-radius:5px; ${isTarget ? 'background:var(--accent-soft); border:1px solid var(--accent);' : 'border:1px solid transparent;'} ${selectable ? 'cursor:pointer;' : ''}`;
  const row = div(style, {
    children: [
      div('display:flex; flex-direction:column; gap:1px;', {
        children: [
          span("font:600 12px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: c.name }),
          span('font:500 9px Inter,sans-serif; color:var(--text-faint);', { text: c.side === 'player' ? 'you' : `init ${c.initiative}` }),
        ],
      }),
      dead || subdued
        ? span(statusChipStyle('completed'), { text: subdued ? 'Subdued' : 'Slain' })
        : div(barTrackStyle(8), { children: [div(barFillStyle(c.hpPct, barColor))] }),
      span("font:600 10.5px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); text-align:right;", { text: `${c.hp}/${c.maxHp}` }),
    ],
  });
  if (selectable) row.addEventListener('click', onSelect);
  return row;
}

// --- action bar --------------------------------------------------------------
function buildActionBar(ui, m, targetId) {
  const act = (action) => ui.ctx.actions.combatAct(action);
  const canAttack = !!targetId;
  const wpn = m.playerWeapon;

  const attackBtn = button(`Attack${wpn ? ` (${wpn.name})` : ''}`, primaryActionButtonStyle(), () => canAttack && act({ type: 'attackLethal', targetId }), { disabled: !canAttack });
  const subdueBtn = button('Subdue', secondaryActionButtonStyle(), () => canAttack && act({ type: 'attackNonlethal', targetId }), { disabled: !canAttack, title: wpn && !wpn.nonlethalCapable ? 'This weapon subdues at reduced damage' : 'Knock the target out instead of killing' });
  const fleeBtn = button('Flee', secondaryActionButtonStyle(), () => act({ type: 'flee' }));

  const buttons = [attackBtn, subdueBtn, fleeBtn];

  // Consumables — one button each (uses the item, spends the turn).
  for (const con of m.consumables) {
    buttons.push(button(`${con.name} ×${con.qty} (+${con.heal})`, smallAccentButtonStyle(), () => act({ type: 'useItem', defId: con.defId })));
  }

  return div(panelStyle('padding:12px; display:flex; flex-direction:column; gap:8px;'), {
    children: [
      div(sectionLabelStyle(), { text: canAttack ? 'Your move' : 'No target' }),
      div('display:flex; flex-wrap:wrap; gap:8px;', { children: buttons }),
    ],
  });
}

// --- terminal panels ---------------------------------------------------------
function gameOverPanel(m) {
  return div('display:flex; flex-direction:column; gap:12px; padding:24px; max-width:520px; margin:40px auto; align-items:center; text-align:center;', {
    children: [
      div("font:700 22px 'Barlow Semi Condensed',sans-serif; color:var(--danger);", { text: 'You have fallen.' }),
      div('font:400 12.5px Inter,sans-serif; color:var(--text-muted); line-height:1.5;', {
        text: 'Rowan has been slain. This journey is over — load an earlier save to continue.',
      }),
      div(panelStyle('padding:10px 14px;'), { children: [
        span('font:500 11px Inter,sans-serif; color:var(--text-faint);', { text: 'Vitals: 0 HP' }),
      ] }),
    ],
  });
}

function aftermathPanel(ui, m) {
  const { setState } = ui;
  const r = m.lastResult;
  const title = !r ? 'The road is quiet.'
    : r.outcome === 'victory' ? (r.mode === 'nonlethal' ? 'Enemy subdued.' : 'Victory.')
    : r.outcome === 'fled' ? 'You got away.'
    : 'The fight is over.';
  return div('display:flex; flex-direction:column; gap:12px; padding:24px; max-width:520px; margin:40px auto; align-items:center; text-align:center;', {
    children: [
      div("font:700 18px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: title }),
      m.playerVitals ? div('font:500 11.5px Inter,sans-serif; color:var(--text-muted);', { text: `Health: ${m.playerVitals.hp}/${m.playerVitals.maxHp}` }) : null,
      button('Continue', primaryActionButtonStyle(), () => setState({ screen: 'travel' })),
    ],
  });
}
