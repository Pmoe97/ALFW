// game/ui/screens/character.js — Character, tabs Overview / Skills / Perks & Traits.
// WIRED: identity, Temperament (real 5 personality axes; absent axes marked
// unwired), Attributes (real), Skills (real 17 primary + effectiveSkill), Traits
// (personalityTraits). UNWIRED (marked): Vitals (no HP/stamina/carry system),
// Standing (no player faction-standing engine), Perks (no perk system),
// Visibility.

import { div, span } from '../dom.js';
import { buildCharacter } from '../model.js';
import {
  panelStyle, sectionLabelStyle, journalTabStyle, barTrackStyle, barFillStyle, factionChipStyle,
} from '../styles.js';

export function renderCharacter(ui) {
  const { state, setState } = ui;
  const m = buildCharacter(ui.ctx);

  const tabs = div('display:flex; gap:6px;', { children: [
    tab('Overview', 'overview'), tab('Skills', 'skills'), tab('Perks & Traits', 'perks'),
  ] });
  function tab(label, id) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = journalTabStyle(state.characterTab === id);
    b.addEventListener('click', () => setState({ characterTab: id }));
    return b;
  }

  let body;
  if (state.characterTab === 'skills') body = skillsTab(m);
  else if (state.characterTab === 'perks') body = perksTab(m);
  else body = overviewTab(m);

  return div('display:flex; flex-direction:column; gap:10px; padding:10px; min-height:calc(100vh - 92px);',
    { children: [tabs, body] });
}

function overviewTab(m) {
  // Left: identity + bio + visibility(unwired)
  const idCard = div(panelStyle('padding:12px; display:flex; flex-direction:column; gap:8px; align-items:center; text-align:center;'), {
    children: [
      div('width:64px; height:64px; border-radius:50%; background:var(--accent-soft); border:1px solid var(--accent); color:var(--accent-strong); display:flex; align-items:center; justify-content:center; font:600 20px \'Barlow Semi Condensed\',sans-serif;', { text: m.identity.initials }),
      div('', { children: [
        div("font:600 15px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: m.identity.name }),
        div('font:500 10.5px Inter,sans-serif; color:var(--text-faint); margin-top:2px;', { text: m.identity.sub }),
      ] }),
      div('font:500 10px Inter,sans-serif; color:var(--text-muted);', { text: `${m.identity.accent} accent` }),
    ],
  });
  const bioCard = labeledPanel('Bio', div('font:400 11.5px Inter,sans-serif; color:var(--text-muted); line-height:1.5;', { text: m.identity.bio }));
  const visCard = div(panelStyle('padding:10px 12px;'), { children: [
    div(sectionLabelStyle() + ' padding-bottom:6px;', { text: 'Visibility' }),
    div('display:flex; align-items:center; gap:8px;', {
      children: [div(barTrackStyle(5), { children: [div(barFillStyle(35))] })], unwired: m.visibility.unwired,
    }),
  ] });
  const left = div('display:flex; flex-direction:column; gap:8px;', { children: [idCard, bioCard, visCard] });

  // Middle: Temperament (axes) + Attributes (real)
  const temperament = labeledPanel('Temperament', statRows(m.temperament.map((a) => ({
    label: a.label, value: a.value === undefined ? '—' : a.value, pct: a.value === undefined ? 0 : a.value * 10, unwired: a.unwired,
  })), 20));
  const attributes = labeledPanel('Attributes', statRows(m.attributes.map((a) => ({
    label: a.label, value: a.value, pct: Math.min(100, a.value * 5), unwired: false,
  })), 24, 'var(--info)'));
  const middle = div('display:flex; flex-direction:column; gap:8px;', { children: [temperament, attributes] });

  // Right: Standing (unwired) + Vitals (unwired)
  const standing = div(panelStyle('padding:12px;'), { children: [
    div(sectionLabelStyle() + ' padding-bottom:6px;', { text: 'Standing' }),
    div('', {
      unwired: m.standing.unwired,
      children: [
        standingRow('Free City', 'muted'),
        standingRow('Trade Guild', 'muted'),
        standingRow('Wildlands', 'muted'),
      ],
    }),
  ] });
  const vitals = div(panelStyle('padding:12px;'), { children: [
    div(sectionLabelStyle() + ' padding-bottom:8px;', { text: 'Vitals' }),
    // Health is real (combat vitals fold); stamina/carry stay unwired.
    healthRow(m.vitals.health),
    div('', { unwired: m.vitals.stamina.unwired, children: [vitalRow('Stamina')] }),
    div('', { unwired: m.vitals.carry.unwired, children: [vitalRow('Carry weight')] }),
  ] });
  const right = div('display:flex; flex-direction:column; gap:8px;', { children: [standing, vitals] });

  return div('display:grid; grid-template-columns: minmax(200px,240px) minmax(0,1fr) minmax(220px,260px); gap:10px;',
    { children: [left, middle, right] });
}

function skillsTab(m) {
  const panel = div(panelStyle('padding:14px; max-width:560px;'));
  for (const s of m.skills) {
    const row = div('display:flex; align-items:center; gap:10px; margin-bottom:10px;');
    row.append(
      span('font:500 12px Inter,sans-serif; color:var(--text); width:130px; flex:none;', { text: s.label }),
      div(barTrackStyle(7) + ' flex:1;', { children: [div(barFillStyle(Math.min(100, s.effective * 8)))] }),
      span("font:600 11px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); width:56px; text-align:right; flex:none;", { text: `${s.raw} (+${s.effective - s.raw})` })
    );
    panel.appendChild(row);
  }
  return panel;
}

function perksTab(m) {
  const traitsCol = div('display:flex; flex-direction:column; gap:8px;');
  traitsCol.appendChild(div(sectionLabelStyle(), { text: 'Traits' }));
  if (!m.traits.length) traitsCol.appendChild(div('font:400 11.5px Inter,sans-serif; color:var(--text-faint);', { text: 'None recorded.' }));
  for (const t of m.traits) {
    traitsCol.appendChild(div(panelStyle('padding:10px 12px; border-left:2px solid var(--info); border-radius:0 6px 6px 0;'), {
      children: [div("font:600 12.5px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: t.name })],
    }));
  }

  const perksCol = div('display:flex; flex-direction:column; gap:8px;');
  perksCol.appendChild(div(sectionLabelStyle(), { text: 'Perks' }));
  const perkBox = div(panelStyle('padding:10px 12px; border-left:2px solid var(--accent); border-radius:0 6px 6px 0;'), {
    unwired: m.perks.unwired,
    children: [
      div("font:600 12.5px 'Barlow Semi Condensed',sans-serif; color:var(--text);", { text: 'No perk system' }),
      div('font:400 11.5px Inter,sans-serif; color:var(--text-muted); line-height:1.4; margin-top:3px;', { text: 'Perks are not backed by any engine yet.' }),
    ],
  });
  perksCol.appendChild(perkBox);

  return div('display:grid; grid-template-columns: repeat(auto-fit,minmax(280px,1fr)); gap:10px; max-width:800px;',
    { children: [perksCol, traitsCol] });
}

// ---- helpers ---------------------------------------------------------------
function labeledPanel(label, ...children) {
  return div(panelStyle('padding:12px;'), { children: [div(sectionLabelStyle() + ' padding-bottom:8px;', { text: label }), ...children] });
}
function statRows(rows, labelW = 20, color = 'var(--accent)') {
  const wrap = div('');
  for (const r of rows) {
    const row = div('display:flex; align-items:center; gap:10px; margin-bottom:8px;');
    const bar = div(barTrackStyle(6) + ' flex:1;', { children: [div(barFillStyle(r.pct, color))] });
    row.append(
      span('font:500 11.5px Inter,sans-serif; color:var(--text-muted); width:130px; flex:none;', { text: r.label }),
      bar,
      span(`font:600 10.5px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); width:${labelW}px; text-align:right; flex:none;`, { text: String(r.value), unwired: r.unwired })
    );
    wrap.appendChild(row);
  }
  return wrap;
}
function standingRow(name, level) {
  return div('display:flex; align-items:center; justify-content:space-between; gap:8px; padding:5px 0; border-top:1px solid var(--border);', {
    children: [
      span('font:500 11.5px Inter,sans-serif; color:var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;', { text: name }),
      span(factionChipStyle(level), { text: '—' }),
    ],
  });
}
function vitalRow(label) {
  return div('display:flex; align-items:center; gap:10px; margin-bottom:8px;', {
    children: [
      span('font:500 11.5px Inter,sans-serif; color:var(--text-muted); width:130px; flex:none;', { text: label }),
      div(barTrackStyle(6) + ' flex:1;', { children: [div(barFillStyle(0))] }),
      span("font:600 10.5px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); width:50px; text-align:right; flex:none;", { text: '—/—' }),
    ],
  });
}
// healthRow — the wired Health vital: a red-tinted bar and hp/maxHp readout,
// with a Dead/Subdued note when the player is in a terminal state.
function healthRow(health) {
  if (!health) return vitalRow('Health');
  const color = health.status === 'dead' ? 'var(--danger)' : health.pct <= 33 ? 'var(--danger)' : health.pct <= 66 ? 'var(--accent)' : 'var(--good)';
  const label = health.status === 'alive' ? 'Health' : `Health (${health.status})`;
  return div('display:flex; align-items:center; gap:10px; margin-bottom:8px;', {
    children: [
      span('font:500 11.5px Inter,sans-serif; color:var(--text-muted); width:130px; flex:none;', { text: label }),
      div(barTrackStyle(6) + ' flex:1;', { children: [div(barFillStyle(health.pct, color))] }),
      span("font:600 10.5px 'Barlow Semi Condensed',sans-serif; color:var(--text-faint); width:50px; text-align:right; flex:none;", { text: `${health.hp}/${health.maxHp}` }),
    ],
  });
}
