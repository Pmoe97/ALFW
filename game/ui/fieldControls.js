// game/ui/fieldControls.js — small reusable field components shared across
// creation-wizard-style screens: a preset dropdown with a "Custom…" escape
// hatch, and an addable/removable list of itemized entries. Neither pattern
// existed anywhere in the codebase before this module (every prior appearance
// field was a bare fixed-pool dropdown) — built fresh here so later cleanup of
// other appearance fields, or the world-config editor, can reuse them too.

import { div, el, button } from './dom.js';
import { secondaryActionButtonStyle, smallAccentButtonStyle } from './styles.js';
import { CUSTOM_VALUE } from './creationModel.js';

const INPUT = 'background:var(--bg-soft); border:1px solid var(--border-strong); color:var(--text); border-radius:4px; padding:6px 8px; font:400 12px Inter,sans-serif; width:100%;';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// presetOrCustomField(presets, value, customValue, onValueChange, onCustomInput, placeholder)
// — a <select> of presets plus a trailing "Custom…" option (CUSTOM_VALUE); when
// value === CUSTOM_VALUE, also renders a text input wired to onCustomInput,
// seeded from customValue.
export function presetOrCustomField(presets, value, customValue, onValueChange, onCustomInput, placeholder = 'Custom…') {
  const options = [...presets.map((p) => ({ v: p, t: cap(p) })), { v: CUSTOM_VALUE, t: 'Custom…' }];
  const select = el('select', INPUT);
  for (const o of options) {
    const opt = el('option', '', { text: o.t, attrs: { value: o.v } });
    if (String(o.v) === String(value)) opt.setAttribute('selected', 'selected');
    select.appendChild(opt);
  }
  select.value = value ?? '';
  select.addEventListener('change', (e) => onValueChange(e.target.value));

  const children = [select];
  if (value === CUSTOM_VALUE) {
    const input = el('input', INPUT + ' margin-top:4px;', { attrs: { type: 'text', placeholder } });
    input.value = customValue ?? '';
    input.addEventListener('input', (e) => onCustomInput(e.target.value));
    children.push(input);
  }
  return div('display:flex; flex-direction:column; gap:2px;', { children });
}

// itemListField(entries, renderRow, onAdd, onRemove, addLabel) — one row per
// entry via renderRow(entry, index) -> child nodes, each with its own Remove
// button, plus a trailing Add button. Stateless: the caller's callbacks mutate
// the draft array and re-render, matching creation.js's mutate-then-rerender style.
export function itemListField(entries, renderRow, onAdd, onRemove, addLabel = 'Add') {
  const rows = entries.map((entry, i) =>
    div('display:flex; flex-direction:column; gap:8px; padding:10px; border:1px solid var(--border); border-radius:5px; background:var(--panel-alt);', {
      children: [
        div('display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px;', { children: renderRow(entry, i) }),
        div('display:flex; justify-content:flex-end;', {
          children: [button('Remove', secondaryActionButtonStyle() + ' padding:4px 10px;', () => onRemove(i))],
        }),
      ],
    }));
  return div('display:flex; flex-direction:column; gap:8px;', {
    children: [...rows, div('display:flex;', { children: [button(addLabel, smallAccentButtonStyle() + ' padding:6px 12px;', () => onAdd())] })],
  });
}
