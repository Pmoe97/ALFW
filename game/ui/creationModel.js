// game/ui/creationModel.js — pure, DOM-free draft-state helpers for the
// character creation wizard (game/ui/screens/creation.js). Kept separate from
// game/ui/model.js, which is scoped to LIVE engine reads for in-game screens —
// this module only ever touches the wizard's own draft object, never a running
// world. DOM-free so proof.js can import and test it directly, the same way
// it already imports game/ui/model.js's buildCombat.

import { INTIMATE_TYPE_BY_GENDER } from '../../engines/npcGeneratorEngine.js';

// Sentinel stored in a preset-or-custom field's value when the player has
// chosen the "Custom…" option; the actual free-text lives in a sibling
// `${field}Custom` property so the raw preset value is never overwritten.
export const CUSTOM_VALUE = '__custom__';

// resolvePresetOrCustom — the single place that decides what a preset-or-custom
// field actually means: a real preset passes through verbatim; CUSTOM_VALUE
// resolves to the trimmed free-text, ignoring any stray customText a real
// preset selection happens to carry alongside it.
export function resolvePresetOrCustom(value, customText) {
  return value === CUSTOM_VALUE ? String(customText ?? '').trim() : value;
}

// defaultIntimateEntry — one freshly-added intimate-details row, type defaulted
// by gender (matching the old single-slot behavior), size defaulted to 'average'.
export function defaultIntimateEntry(gender) {
  return {
    type: INTIMATE_TYPE_BY_GENDER[gender] ?? 'unspecified',
    typeCustom: '',
    size: 'average',
    sizeCustom: '',
    details: '',
  };
}

// assembleIntimateEntries — draft rows (as edited via presetOrCustomField) ->
// the final Appearance.intimate shape: [{type, size, details}, ...].
export function assembleIntimateEntries(draftEntries) {
  return draftEntries.map((entry) => ({
    type: resolvePresetOrCustom(entry.type, entry.typeCustom),
    size: resolvePresetOrCustom(entry.size, entry.sizeCustom),
    details: entry.details || '',
  }));
}
