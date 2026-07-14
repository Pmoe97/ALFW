// game/ui/screens/worldConfigEditor.js — authors a named world PRESET: a plain
// JSON-safe config object (shape = sampleWorld.WORLD_CONFIG) plus the onboarding
// blocks this flow introduces (narrative spine, difficulty, content toggles,
// weather tables, and — the architecturally important one — the sparse
// fieldSchema DIFF the Stage 0 resolver reads). Presets are a template library
// stored via persistence, distinct from saves, reused by Character Creation.
//
// Editing model: text inputs mutate the draft object IN PLACE on 'input' with no
// re-render (so focus/caret survive typing); only STRUCTURAL actions (load a
// preset, toggle/add/remove a field, save) call shell.setState({}) to rebuild
// the form from the draft. The shell owns the draft at shell.state.editor.
//
// New config blocks written here are stored on the preset even where no engine
// consumes them yet (difficulty scaling, some content toggles) — the data model
// is real now; enforcement is wired in the stages that own each system. Weather
// tables are consumed by the weather engine; the fieldSchema diff by the NPC
// generator and the creation wizard.

import { div, span, el, button } from '../dom.js';
import {
  FONT_HEAD, FONT_BODY, panelStyle, sectionLabelStyle,
  primaryActionButtonStyle, secondaryActionButtonStyle, smallAccentButtonStyle, journalTabStyle,
} from '../styles.js';
import { BASE_APPEARANCE_POOLS, APPEARANCE_FIELD_ORDER } from '../../../engines/npcGeneratorEngine.js';
import { defaultLabel } from '../../../entities/fieldSchema.js';

const DIFFICULTIES = ['story', 'normal', 'harsh'];
const INPUT = 'background:var(--bg-soft); border:1px solid var(--border-strong); color:var(--text); border-radius:4px; padding:6px 8px; font:400 12px Inter,sans-serif; width:100%;';

// Sensible starting weather tables, keyed by the calendar's season (month) names.
function defaultWeather(monthNames) {
  const byName = {
    Rain: { rain: 4, overcast: 3, clear: 2, storm: 1 },
    Sun: { clear: 5, warm: 3, overcast: 1 },
    Harvest: { clear: 3, overcast: 3, fog: 2, rain: 2 },
    Snow: { snow: 4, overcast: 3, clear: 2, blizzard: 1 },
  };
  const seasons = {};
  for (const name of monthNames) seasons[name] = byName[name] ?? { clear: 3, overcast: 2, rain: 1 };
  return { seasons };
}

// Ensure the onboarding blocks exist on the draft so the form has something to
// bind to (idempotent; called on every render).
function ensureBlocks(draft) {
  if (!draft.narrative) draft.narrative = { spine: '', tone: '' };
  if (!draft.difficulty) draft.difficulty = 'normal';
  if (!draft.content) draft.content = { matureContent: true, banditIncidents: true, weather: true };
  if (!draft.weather) draft.weather = defaultWeather(draft.calendar?.monthNames ?? ['Rain', 'Sun', 'Harvest', 'Snow']);
  if (!draft.fieldSchema) draft.fieldSchema = {};
  if (!draft.fieldSchema.appearance) draft.fieldSchema.appearance = { values: {}, add: {}, remove: [], rename: {} };
  const a = draft.fieldSchema.appearance;
  a.values ??= {}; a.add ??= {}; a.remove ??= []; a.rename ??= {};
  return draft;
}

export function renderWorldConfigEditor(shell) {
  const editor = shell.state.editor;
  const draft = ensureBlocks(editor.draft);
  const rerender = () => shell.setState({});

  // --- input helpers --------------------------------------------------------
  function textInput(value, onInput, extra = '') {
    const i = el('input', INPUT + extra, { attrs: { type: 'text' } });
    i.value = value ?? '';
    i.addEventListener('input', (e) => onInput(e.target.value)); // mutate draft, no rerender
    return i;
  }
  function textArea(value, onInput, rows = 2) {
    const t = el('textarea', INPUT + ` resize:vertical; min-height:${rows * 20}px;`, { attrs: { rows: String(rows) } });
    t.value = value ?? '';
    t.addEventListener('input', (e) => onInput(e.target.value));
    return t;
  }
  function labeled(label, control) {
    return div('display:flex; flex-direction:column; gap:4px;', {
      children: [span(`font:500 10.5px ${FONT_BODY}; color:var(--text-faint);`, { text: label }), control],
    });
  }
  function section(title, ...children) {
    return div(panelStyle('padding:14px 16px; display:flex; flex-direction:column; gap:10px;'), {
      children: [div(sectionLabelStyle(), { text: title }), ...children],
    });
  }

  // --- preset bar -----------------------------------------------------------
  const presets = shell.listPresets();
  const presetSelect = el('select', INPUT + ' width:auto;');
  presetSelect.appendChild(el('option', '', { text: presets.length ? '— load preset —' : '(no saved presets)', attrs: { value: '' } }));
  for (const p of presets) presetSelect.appendChild(el('option', '', { text: p.name, attrs: { value: p.name } }));
  presetSelect.addEventListener('change', (e) => {
    const name = e.target.value;
    if (!name) return;
    const cfg = shell.getPreset(name);
    if (cfg) { editor.draft = structuredClone(cfg); editor.presetName = name; editor.note = `Loaded "${name}"`; rerender(); }
  });

  const nameInput = textInput(editor.presetName, (v) => { editor.presetName = v; });
  const presetBar = section('Preset',
    div('display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end;', {
      children: [
        labeled('Preset name', nameInput),
        labeled('Load existing', presetSelect),
        button('Save preset', primaryActionButtonStyle(), () => {
          const name = (editor.presetName || draft.worldName || 'Untitled').trim();
          editor.presetName = name;
          shell.savePreset(name, structuredClone(draft));
          editor.note = `Saved "${name}"`;
          rerender();
        }),
        presets.some((p) => p.name === (editor.presetName || '').trim())
          ? button('Delete', secondaryActionButtonStyle(), () => { shell.deletePreset(editor.presetName.trim()); editor.note = 'Deleted'; rerender(); })
          : null,
        button('Start game from this preset', smallAccentButtonStyle() + ' padding:8px 12px;', () => shell.newGame(structuredClone(draft))),
      ],
    }),
    editor.note ? span(`font:500 10.5px ${FONT_BODY}; color:var(--good);`, { text: editor.note }) : null,
  );

  // --- identity -------------------------------------------------------------
  const identity = section('World',
    div('display:grid; grid-template-columns:2fr 1fr; gap:10px;', {
      children: [
        labeled('World name', textInput(draft.worldName, (v) => { draft.worldName = v; })),
        labeled('RNG seed', textInput(String(draft.rngSeed ?? ''), (v) => { const n = parseInt(v, 10); draft.rngSeed = Number.isFinite(n) ? n : 0; })),
      ],
    }),
  );

  // --- narrative + difficulty ----------------------------------------------
  const difficultyChips = div('display:flex; gap:6px;', {
    children: DIFFICULTIES.map((d) =>
      button(d, journalTabStyle(draft.difficulty === d), () => { draft.difficulty = d; rerender(); })),
  });
  const narrative = section('Narrative & difficulty',
    labeled('Narrative spine (the world\'s premise; shown to the AI narrator)', textArea(draft.narrative.spine, (v) => { draft.narrative.spine = v; }, 3)),
    labeled('Tone (e.g. "grim", "cozy", "wry")', textInput(draft.narrative.tone, (v) => { draft.narrative.tone = v; })),
    labeled('Difficulty', difficultyChips),
  );

  // --- content toggles ------------------------------------------------------
  const toggle = (key, label) => {
    const on = !!draft.content[key];
    return button(`${on ? '☑' : '☐'} ${label}`, journalTabStyle(on), () => { draft.content[key] = !on; rerender(); });
  };
  const content = section('Content',
    div('display:flex; flex-wrap:wrap; gap:6px;', {
      children: [toggle('matureContent', 'Mature content'), toggle('banditIncidents', 'Bandit incidents'), toggle('weather', 'Weather')],
    }),
  );

  // --- weather tables (consumed by the weather engine) ----------------------
  const weatherRows = Object.keys(draft.weather.seasons).map((season) => {
    const table = draft.weather.seasons[season];
    const asText = Object.entries(table).map(([t, w]) => `${t}:${w}`).join(', ');
    return labeled(`${season} season`, textInput(asText, (v) => { draft.weather.seasons[season] = parseWeights(v); }, ' font-family:monospace;'));
  });
  const weather = section('Weather (type:weight per season)', ...weatherRows,
    span(`font:400 10px ${FONT_BODY}; color:var(--text-faint);`, { text: 'Deterministic per seeded day; consumed by the weather engine.' }));

  // --- appearance field schema (the sparse diff) ----------------------------
  const appearance = section('Appearance field schema (diff over defaults)',
    span(`font:400 10.5px ${FONT_BODY}; color:var(--text-muted);`, {
      text: 'Rename, remove, or re-pool any field; add new ones. Blank pool = keep the default. Character Creation and NPC generation both render off this.',
    }),
    ...APPEARANCE_FIELD_ORDER.map((path) => appearanceFieldRow(path, draft.fieldSchema.appearance, textInput, rerender)),
    addedFieldsBlock(draft.fieldSchema.appearance, textInput, rerender, editor),
  );

  const backBar = div('display:flex; justify-content:space-between; align-items:center; padding:4px 2px;', {
    children: [
      div(`font:700 22px ${FONT_HEAD}; color:var(--accent-strong);`, { text: 'WorldConfig' }),
      button('Back to menu', secondaryActionButtonStyle(), () => shell.backToMenu()),
    ],
  });

  return div('max-width:820px; margin:0 auto; padding:20px 16px; display:flex; flex-direction:column; gap:14px;', {
    children: [backBar, presetBar, identity, narrative, content, weather, appearance],
  });
}

// One base appearance field: rename / remove / pool-override controls bound to
// the sparse diff (empty values delete their diff key, keeping it sparse).
function appearanceFieldRow(path, diff, textInput, rerender) {
  const removed = diff.remove.includes(path);
  const renameVal = diff.rename[path] ?? '';
  const poolVal = diff.values[path] ? diff.values[path].join(', ') : '';
  const defaultPool = (BASE_APPEARANCE_POOLS[path] || []).join(', ');

  const removeBtn = button(removed ? '✗ removed' : 'remove', removed ? journalTabStyle(true) : secondaryActionButtonStyle(),
    () => {
      if (removed) diff.remove = diff.remove.filter((p) => p !== path);
      else diff.remove.push(path);
      rerender();
    });

  const rename = textInput(renameVal, (v) => { const t = v.trim(); if (t) diff.rename[path] = t; else delete diff.rename[path]; });
  const pool = textInput(poolVal, (v) => { const arr = splitCsv(v); if (arr.length) diff.values[path] = arr; else delete diff.values[path]; }, ' font-family:monospace;');

  return div(`display:grid; grid-template-columns:150px 1fr auto; gap:8px; align-items:center; ${removed ? 'opacity:0.5;' : ''}`, {
    children: [
      div('', {
        children: [
          span(`font:600 11px ${FONT_HEAD}; color:var(--text);`, { text: defaultLabel(path) }),
          span(`font:400 9px ${FONT_BODY}; color:var(--text-faint); display:block;`, { text: path }),
        ],
      }),
      div('display:flex; flex-direction:column; gap:4px;', {
        children: [rename, pool],
      }),
      removeBtn,
    ],
  });
}

// The list of world-ADDED appearance fields plus an "add field" row.
function addedFieldsBlock(diff, textInput, rerender, editor) {
  const existing = Object.keys(diff.add).map((path) =>
    div('display:flex; gap:8px; align-items:center;', {
      children: [
        span(`font:600 11px ${FONT_HEAD}; color:var(--accent-strong);`, { text: path }),
        span(`font:400 10px ${FONT_BODY}; color:var(--text-muted); flex:1;`, { text: diff.add[path].join(', ') }),
        button('remove', secondaryActionButtonStyle(), () => { delete diff.add[path]; rerender(); }),
      ],
    }));

  editor.newField ??= { path: '', pool: '' };
  const pathI = textInput(editor.newField.path, (v) => { editor.newField.path = v; });
  const poolI = textInput(editor.newField.pool, (v) => { editor.newField.pool = v; }, ' font-family:monospace;');
  const addRow = div('display:grid; grid-template-columns:150px 1fr auto; gap:8px; align-items:center;', {
    children: [
      pathI, poolI,
      button('add field', smallAccentButtonStyle(), () => {
        const path = editor.newField.path.trim();
        const arr = splitCsv(editor.newField.pool);
        if (path && arr.length) { diff.add[path] = arr; editor.newField = { path: '', pool: '' }; rerender(); }
      }),
    ],
  });

  return div('display:flex; flex-direction:column; gap:6px; margin-top:6px; border-top:1px solid var(--border); padding-top:8px;', {
    children: [span(sectionLabelStyle(), { text: 'Added fields' }), ...existing, addRow],
  });
}

// --- parsing helpers --------------------------------------------------------
function splitCsv(v) {
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}
function parseWeights(v) {
  const out = {};
  for (const part of splitCsv(v)) {
    const [type, w] = part.split(':').map((s) => s.trim());
    const weight = parseFloat(w);
    if (type && Number.isFinite(weight)) out[type] = weight;
  }
  return out;
}
