// game/ui/screens/creation.js — the Character Creation wizard.
//
// Wizard-first mechanically, narrated in tone: each page carries a light line in
// the voice of the entity that pulled you out of death and is asking who you
// want to be next. Pages:
//   0 World & seed  — NOT the character: pick a preset, a seed, and the
//                     world-instance options (difficulty / season / start tier /
//                     content review).
//   1 Identity      — race (from the preset's enabled races), gender, name, age,
//                     vocation.
//   2 Attributes    — three selectable structures: Point-Buy / Rolled / Sandbox.
//   3 Appearance    — SCHEMA-DRIVEN off the preset's fieldSchema diff (the hard
//                     requirement): one control per resolved field + race
//                     extensions + intimate + distinguishing features.
//   4 Portrait      — the character becomes visually real (image generation is
//                     wired by the Freeplay/AI stage; a neutral placeholder and
//                     the Finish gate live here now).
//
// The wizard reads everything off the CHOSEN preset config (via deriveRaceRegistry
// and the Stage 0 resolver) so it is fully worldConfig-reactive. Finish assembles
// a run config (preset + seed + options + playerCharacter) and hands it to
// shell.newGame — the character rides IN the config, so it is embedded in saves
// and re-applied identically on load (see sampleWorld's overlay).
//
// Editing model matches the WorldConfig editor: text inputs mutate the draft in
// place (focus survives typing); structural actions call shell.setState({}).

import { div, span, el, button } from '../dom.js';
import {
  FONT_HEAD, FONT_BODY, panelStyle, sectionLabelStyle,
  primaryActionButtonStyle, secondaryActionButtonStyle, smallAccentButtonStyle, journalTabStyle,
} from '../styles.js';
import { WORLD_CONFIG } from '../../sampleWorld.js';
import { deriveRaceRegistry } from '../../../entities/raceRegistry.js';
import { createPlayer, ATTRIBUTE_NAMES, PRIMARY_SKILL_ATTRIBUTE, SECONDARY_SKILLS } from '../../../entities/entitySchema.js';
import { getSchemaDiff, resolveFieldList, resolveFieldValue } from '../../../entities/fieldSchema.js';
import {
  BASE_APPEARANCE_POOLS, APPEARANCE_FIELD_ORDER, INTIMATE_GENITAL_BY_GENDER, INTIMATE_SHAPE_SIZES,
  DISTINGUISHING_FEATURES, PERSONALITY_TRAITS,
} from '../../../engines/npcGeneratorEngine.js';
import { deriveVoiceDirectives } from '../../../entities/voice.js';

const STEPS = ['World', 'Identity', 'Attributes', 'Appearance', 'Portrait'];
const INPUT = 'background:var(--bg-soft); border:1px solid var(--border-strong); color:var(--text); border-radius:4px; padding:6px 8px; font:400 12px Inter,sans-serif; width:100%;';
const POINT_BUY_BASE = 8, POINT_BUY_POOL = 27, POINT_BUY_CAP = 15;

const GOD_LINES = [
  'Death was a misunderstanding. Before I send you on, tell me — which world, and by what turn of fortune?',
  'A shape, then. Every soul remembers being someone. Who were you, or who will you be?',
  'And your measure. Some are born strong, some clever, some simply lucky. How shall I weigh you?',
  'Now the flesh. I will build it exactly as you describe — spare me nothing.',
  'There. Look at yourself. When you open your eyes, this is who wakes.',
];

// --- config / race helpers --------------------------------------------------
function presetConfigFor(shell, name) {
  const cfg = name ? shell.getPreset(name) : null;
  return structuredClone(cfg ?? WORLD_CONFIG);
}
function enabledRacesOf(config) {
  const races = deriveRaceRegistry(config, []);
  return Object.entries(races)
    .filter(([, r]) => r.enabled && r.weight > 0)
    .map(([id, r]) => ({ id, ...r }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
function raceById(config, id) {
  const list = enabledRacesOf(config);
  return list.find((r) => r.id === id) || list[0];
}
function poolFor(path, race, diff) {
  return race.appearanceOverrides?.[path] ?? resolveFieldValue(path, diff, BASE_APPEARANCE_POOLS[path]);
}
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

// --- state init -------------------------------------------------------------
export function initCreation(shell) {
  const config = presetConfigFor(shell, '');
  const races = enabledRacesOf(config);
  const race = races[0];
  const attributes = {};
  for (const a of ATTRIBUTE_NAMES) attributes[a] = POINT_BUY_BASE;
  return {
    step: 0,
    presetName: '',
    seed: Math.floor(Math.random() * 1e9),
    difficulty: '', season: '', startTier: 'village', contentReviewed: false,
    race: race?.id, gender: (race?.genders?.[0]) || 'female',
    firstName: '', lastName: '', age: race?.ageRange?.min ?? 25, vocation: 'wandering adventurer',
    statMode: 'pointbuy',
    attributes,
    rolledPool: null, rolledAssign: {},
    sandbox: Object.fromEntries(ATTRIBUTE_NAMES.map((a) => [a, 10])),
    appearance: {}, extensions: {},
    intimate: { shapeSize: 'average', extraDetails: '' },
    features: [],
    portrait: null,
  };
}

export function renderCreation(shell) {
  const c = shell.state.creation;
  const config = presetConfigFor(shell, c.presetName);
  const rerender = () => shell.setState({});
  const race = raceById(config, c.race);

  const header = div('display:flex; flex-direction:column; gap:8px; margin-bottom:10px;', {
    children: [
      div('display:flex; align-items:center; gap:8px; flex-wrap:wrap;', {
        children: STEPS.map((label, i) =>
          span(`font:600 10px ${FONT_HEAD}; letter-spacing:0.04em; padding:4px 9px; border-radius:12px; ${i === c.step ? 'background:var(--accent-soft); color:var(--accent-strong); border:1px solid var(--accent);' : 'color:var(--text-faint); border:1px solid var(--border);'}`,
            { text: `${i + 1}. ${label}` })),
      }),
      div(`font:italic 400 12.5px ${FONT_BODY}; color:var(--text-muted); line-height:1.5;`, { text: GOD_LINES[c.step] }),
    ],
  });

  let body;
  if (c.step === 0) body = pageWorld(shell, c, config, rerender);
  else if (c.step === 1) body = pageIdentity(shell, c, config, race, rerender);
  else if (c.step === 2) body = pageAttributes(shell, c, rerender);
  else if (c.step === 3) body = pageAppearance(shell, c, config, race, rerender);
  else body = pagePortrait(shell, c, race, rerender);

  const canNext = validateStep(c, config, race);
  const nav = div('display:flex; justify-content:space-between; align-items:center; margin-top:16px;', {
    children: [
      button('Back to menu', secondaryActionButtonStyle(), () => shell.backToMenu()),
      div('display:flex; gap:8px;', {
        children: [
          c.step > 0 ? button('Back', secondaryActionButtonStyle(), () => { c.step--; rerender(); }) : null,
          c.step < STEPS.length - 1
            ? button('Next', primaryActionButtonStyle() + (canNext ? '' : ' opacity:0.4; pointer-events:none;'), () => { if (canNext) { c.step++; rerender(); } })
            : button('Begin this life', primaryActionButtonStyle(), () => finish(shell, c, config, race)),
        ],
      }),
    ],
  });

  return div('max-width:760px; margin:0 auto; padding:22px 16px;', { children: [header, body, nav] });
}

// --- page 0: world & seed ---------------------------------------------------
function pageWorld(shell, c, config, rerender) {
  const presets = shell.listPresets();
  const presetSelect = selectEl(
    [{ v: '', t: 'Default world' }, ...presets.map((p) => ({ v: p.name, t: p.name }))],
    c.presetName,
    (v) => { c.presetName = v; c.race = enabledRacesOf(presetConfigFor(shell, v))[0]?.id; rerender(); }
  );
  const seedRow = div('display:flex; gap:8px; align-items:flex-end;', {
    children: [
      labeled('Seed', textInput(String(c.seed), (v) => { const n = parseInt(v, 10); c.seed = Number.isFinite(n) ? n : 0; })),
      button('Randomize', smallAccentButtonStyle() + ' padding:7px 10px;', () => { c.seed = Math.floor(Math.random() * 1e9); rerender(); }),
    ],
  });
  const seasonNames = config.calendar?.monthNames ?? [];
  const difficultyRow = chipRow(['story', 'normal', 'harsh'], c.difficulty || config.difficulty || 'normal',
    (v) => { c.difficulty = v; rerender(); });
  const seasonRow = chipRow(['', ...seasonNames], c.season, (v) => { c.season = v; rerender(); }, (v) => v || 'Default');
  const tierRow = chipRow(['hamlet', 'village'], c.startTier, (v) => { c.startTier = v; rerender(); });

  const content = config.content || {};
  const contentList = Object.keys(content).length
    ? div('display:flex; flex-wrap:wrap; gap:6px;', {
        children: Object.entries(content).map(([k, v]) =>
          span(`font:500 10px ${FONT_BODY}; padding:3px 8px; border-radius:10px; border:1px solid var(--border); color:${v ? 'var(--good)' : 'var(--text-faint)'};`,
            { text: `${v ? '☑' : '☐'} ${k}` })),
      })
    : span(`font:400 11px ${FONT_BODY}; color:var(--text-faint);`, { text: 'This world declares no content toggles.' });

  return div('display:flex; flex-direction:column; gap:14px;', {
    children: [
      section('World & instance', labeled('World preset', presetSelect), seedRow),
      section('Difficulty', difficultyRow),
      section('Start of your new life', labeled('Season', seasonRow), labeled('Settlement you wake beside', tierRow)),
      section('Content in this world', contentList),
    ],
  });
}

// --- page 1: identity -------------------------------------------------------
function pageIdentity(shell, c, config, race, rerender) {
  const races = enabledRacesOf(config);
  const raceRow = chipRow(races.map((r) => r.id), c.race, (v) => {
    c.race = v; const r = raceById(config, v);
    if (!r.genders.includes(c.gender)) c.gender = r.genders[0];
    c.age = Math.max(c.age, r.ageRange?.min ?? c.age);
    rerender();
  }, (id) => races.find((r) => r.id === id)?.displayName || id);
  const genderRow = chipRow(race.genders, c.gender, (v) => { c.gender = v; rerender(); });

  const nameRow = div('display:grid; grid-template-columns:1fr 1fr auto; gap:8px; align-items:flex-end;', {
    children: [
      labeled('First name', textInput(c.firstName, (v) => { c.firstName = v; })),
      labeled('Last name', textInput(c.lastName, (v) => { c.lastName = v; })),
      button('Random', smallAccentButtonStyle() + ' padding:7px 10px;', () => {
        c.firstName = rand(race.namePool?.[c.gender] || ['Rowan']);
        c.lastName = rand(race.surnames || ['Ashvale']);
        rerender();
      }),
    ],
  });
  const ageMin = race.ageRange?.min ?? 18, ageMax = race.ageRange?.max ?? 80;
  return div('display:flex; flex-direction:column; gap:14px;', {
    children: [
      section('Kin', labeled(`Race (${races.length} available)`, raceRow), labeled('Gender', genderRow)),
      section('Name', nameRow),
      section('Details',
        labeled(`Age (${ageMin}–${ageMax})`, textInput(String(c.age), (v) => { const n = parseInt(v, 10); c.age = Number.isFinite(n) ? n : ageMin; })),
        labeled('Vocation', textInput(c.vocation, (v) => { c.vocation = v; }))),
    ],
  });
}

// --- page 2: attributes -----------------------------------------------------
function pageAttributes(shell, c, rerender) {
  const modeRow = div('display:flex; gap:6px;', {
    children: [
      modeChip('Point-Buy', 'pointbuy', c, rerender),
      modeChip('Rolled', 'rolled', c, rerender),
      modeChip('Sandbox', 'sandbox', c, rerender),
    ],
  });

  let panel;
  if (c.statMode === 'pointbuy') {
    const spent = ATTRIBUTE_NAMES.reduce((s, a) => s + (c.attributes[a] - POINT_BUY_BASE), 0);
    const remaining = POINT_BUY_POOL - spent;
    panel = div('display:flex; flex-direction:column; gap:8px;', {
      children: [
        span(`font:600 12px ${FONT_HEAD}; color:${remaining < 0 ? 'var(--danger)' : 'var(--accent-strong)'};`, { text: `Points remaining: ${remaining}` }),
        ...ATTRIBUTE_NAMES.map((a) => attrStepper(a, c.attributes[a], POINT_BUY_BASE, POINT_BUY_CAP,
          (nv) => { if (nv >= POINT_BUY_BASE && nv <= POINT_BUY_CAP && (nv - c.attributes[a]) <= remaining) { c.attributes[a] = nv; rerender(); } })),
      ],
    });
  } else if (c.statMode === 'rolled') {
    if (!c.rolledPool) {
      panel = div('', { children: [button('Roll the dice (4d6 drop lowest × 6)', primaryActionButtonStyle(), () => { c.rolledPool = rollSix(); c.rolledAssign = {}; rerender(); })] });
    } else {
      panel = div('display:flex; flex-direction:column; gap:8px;', {
        children: [
          div('display:flex; gap:6px; flex-wrap:wrap; align-items:center;', {
            children: [
              span(`font:600 11px ${FONT_BODY}; color:var(--text-muted);`, { text: 'Rolled:' }),
              ...c.rolledPool.map((v, i) => span(`font:700 12px ${FONT_HEAD}; padding:3px 8px; border-radius:4px; background:var(--panel-alt); border:1px solid var(--border);`, { text: String(v) })),
              button('Reroll', secondaryActionButtonStyle(), () => { c.rolledPool = rollSix(); c.rolledAssign = {}; rerender(); }),
            ],
          }),
          ...ATTRIBUTE_NAMES.map((a) => div('display:flex; align-items:center; gap:8px;', {
            children: [
              span(`font:500 12px ${FONT_BODY}; color:var(--text); width:110px;`, { text: cap(a) }),
              selectEl(
                [{ v: '', t: '—' }, ...c.rolledPool.map((v, i) => ({ v: String(i), t: `${v}${assignedElsewhere(c, a, i) ? ' (used)' : ''}` }))],
                c.rolledAssign[a] ?? '',
                (val) => { if (val === '') delete c.rolledAssign[a]; else c.rolledAssign[a] = Number(val); rerender(); }
              ),
            ],
          })),
        ],
      });
    }
  } else {
    panel = div('display:flex; flex-direction:column; gap:8px;', {
      children: ATTRIBUTE_NAMES.map((a) => div('display:flex; align-items:center; gap:8px;', {
        children: [
          span(`font:500 12px ${FONT_BODY}; color:var(--text); width:110px;`, { text: cap(a) }),
          textInput(String(c.sandbox[a]), (v) => { const n = parseInt(v, 10); c.sandbox[a] = Number.isFinite(n) ? n : 0; }, ' width:90px;'),
        ],
      })),
    });
  }

  return div('display:flex; flex-direction:column; gap:14px;', {
    children: [section('Stat structure', modeRow), section(cap(c.statMode), panel)],
  });
}

// --- page 3: appearance (schema-driven) -------------------------------------
function pageAppearance(shell, c, config, race, rerender) {
  const diff = getSchemaDiff(config, 'appearance');
  const fields = resolveFieldList(APPEARANCE_FIELD_ORDER, diff)
    .filter((f) => !(f.path === 'face.facialHair' && c.gender === 'female'));

  const controls = fields.map(({ path, label }) => {
    const pool = poolFor(path, race, diff) || [];
    return labeled(label, selectEl(pool.map((o) => ({ v: o, t: o })), c.appearance[path] ?? pool[0], (v) => { c.appearance[path] = v; }));
  });

  const extFields = Object.keys(race.appearanceExtensions || {}).sort();
  const extControls = extFields.map((f) => {
    const pool = race.appearanceExtensions[f];
    return labeled(`${cap(f)} (${race.displayName})`, selectEl(pool.map((o) => ({ v: o, t: o })), c.extensions[f] ?? pool[0], (v) => { c.extensions[f] = v; }));
  });

  const intimate = section('Intimate',
    labeled('Build', selectEl(INTIMATE_SHAPE_SIZES.map((o) => ({ v: o, t: o })), c.intimate.shapeSize, (v) => { c.intimate.shapeSize = v; })),
    labeled('Details (optional)', textInput(c.intimate.extraDetails, (v) => { c.intimate.extraDetails = v; })));

  const featureChips = div('display:flex; flex-wrap:wrap; gap:6px;', {
    children: DISTINGUISHING_FEATURES.map((f) =>
      button(f, journalTabStyle(c.features.includes(f)), () => {
        c.features = c.features.includes(f) ? c.features.filter((x) => x !== f) : [...c.features, f].slice(0, 3);
        rerender();
      })),
  });

  const randomize = button('Randomize appearance', smallAccentButtonStyle() + ' padding:8px 12px;', () => {
    for (const { path } of fields) c.appearance[path] = rand(poolFor(path, race, diff) || ['']);
    for (const f of extFields) c.extensions[f] = rand(race.appearanceExtensions[f]);
    c.intimate.shapeSize = rand(INTIMATE_SHAPE_SIZES);
    c.features = Math.random() < 0.6 ? [rand(DISTINGUISHING_FEATURES)] : [];
    rerender();
  });

  return div('display:flex; flex-direction:column; gap:14px;', {
    children: [
      div('display:flex; justify-content:flex-end;', { children: [randomize] }),
      section('Features', div('display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:10px;', { children: [...controls, ...extControls] })),
      intimate,
      section('Distinguishing features (up to 3)', featureChips),
    ],
  });
}

// --- page 4: portrait -------------------------------------------------------
function pagePortrait(shell, c, race, rerender) {
  const preview = div('width:180px; height:180px; border-radius:8px; margin:0 auto; display:flex; align-items:center; justify-content:center; overflow:hidden; background:repeating-linear-gradient(45deg, var(--panel-alt), var(--panel-alt) 8px, var(--bg-soft) 8px, var(--bg-soft) 16px); border:1px solid var(--border);');
  if (c.portrait) {
    const img = el('img', 'width:100%; height:100%; object-fit:cover;', { attrs: { src: c.portrait } });
    preview.appendChild(img);
  } else {
    preview.appendChild(span(`font:600 10px ${FONT_HEAD}; color:var(--text-faint); letter-spacing:0.06em;`, { text: 'PORTRAIT' }));
  }

  const summary = div(`font:400 12px ${FONT_BODY}; color:var(--text-muted); line-height:1.6; text-align:center;`, {
    text: `${c.firstName || 'Unnamed'} ${c.lastName || ''} — ${cap(c.gender)} ${race.displayName}, ${c.age}. ${cap(c.vocation)}.`,
  });

  const genBtn = button(
    typeof generateImage === 'function' ? 'Generate portrait' : 'Portrait generation (needs the AI image plugin)',
    primaryActionButtonStyle() + (typeof generateImage === 'function' ? '' : ' opacity:0.5; pointer-events:none;'),
    () => { /* wired to the shared image pipeline in the Freeplay/AI stage */ }
  );

  return div('display:flex; flex-direction:column; gap:14px;', {
    children: [section('Your face in this world', preview, summary, div('display:flex; justify-content:center;', { children: [genBtn] }),
      span(`font:400 10px ${FONT_BODY}; color:var(--text-faint); text-align:center;`, { text: 'You can begin now; a portrait can be generated here once the image pipeline is live.' }))],
  });
}

// --- finish: assemble config + player, start the run ------------------------
function finish(shell, c, config, race) {
  // World-instance options onto the run config.
  config.rngSeed = c.seed;
  if (c.difficulty) config.difficulty = c.difficulty;
  if (c.season && config.calendar?.monthNames?.includes(c.season)) config.startSeason = c.season;
  config.startTier = c.startTier;

  const attributes = buildAttributes(c);
  const axes = {};
  for (const [axis, prior] of Object.entries(race.axisPriors || {})) axes[axis] = prior;
  const primary = Object.fromEntries(Object.keys(PRIMARY_SKILL_ATTRIBUTE).map((k) => [k, 0]));
  const secondary = Object.fromEntries(SECONDARY_SKILLS.map((k) => [k, 0]));
  const accent = race.voiceAccents?.[0]?.name ?? 'plain regional burr';
  const phrases = race.voiceAccents?.[0]?.signaturePhrases ?? [];

  const player = createPlayer({
    id: 'player_rowan',
    identity: {
      firstName: c.firstName || 'Traveler', lastName: c.lastName || '',
      age: c.age, birthday: `${config.startDateTime?.slice(0, 4) ?? '1024'}-01-01`,
      gender: c.gender, sexualOrientation: 'heterosexual', race: c.race,
      ethnicity: `${race.displayName} newcomer`, vocation: c.vocation,
      relationshipStatus: 'single', livingSituation: 'newly arrived, no fixed address',
      background: 'Woke in this world with a life already behind them, the details of it fading like a dream.',
      biography: `${c.firstName || 'A stranger'} arrived in this world with nothing but the shape of a former life.`,
    },
    appearance: assembleAppearance(c, config, race),
    psychology: {
      personalityTraits: [rand(PERSONALITY_TRAITS)],
      personalityAxes: axes,
      factionAlignmentAxes: {},
      hobbies: [], likes: [], dislikes: [],
      voice: { accent, directives: deriveVoiceDirectives(axes), phrases },
      memories: [],
      flags: { personality: [], condition: [], aiDirectives: [] },
    },
    capabilities: { attributes, skills: { primary, secondary } },
    inventory: [],
  });
  player.playerData = { portrait: c.portrait ?? null };

  config.playerCharacter = player;
  shell.newGame(config);
}

// --- assembly helpers -------------------------------------------------------
function buildAttributes(c) {
  if (c.statMode === 'sandbox') return { ...c.sandbox };
  if (c.statMode === 'rolled') {
    const out = {};
    for (const a of ATTRIBUTE_NAMES) {
      const idx = c.rolledAssign[a];
      out[a] = idx != null && c.rolledPool ? c.rolledPool[idx] : POINT_BUY_BASE;
    }
    return out;
  }
  return { ...c.attributes };
}
function assembleAppearance(c, config, race) {
  const diff = getSchemaDiff(config, 'appearance');
  const appearance = {
    heightBuild: '', hair: { color: '', style: '', length: '', texture: '' },
    eyes: { color: '', shape: '' }, face: { shape: '', nose: '', lips: '', jawline: '', facialHair: 'none' },
    skin: { tone: '', texture: '' }, body: { shape: '', chest: '', butt: '', legs: '' },
    distinguishingFeatures: [], intimate: [],
  };
  for (const { path } of resolveFieldList(APPEARANCE_FIELD_ORDER, diff)) {
    if (path === 'face.facialHair' && c.gender === 'female') { appearance.face.facialHair = 'none'; continue; }
    const pool = poolFor(path, race, diff) || [''];
    const value = c.appearance[path] ?? pool[0];
    const [head, tail] = path.split('.');
    if (tail === undefined) appearance[head] = value;
    else { if (appearance[head] === undefined) appearance[head] = {}; appearance[head][tail] = value; }
  }
  for (const f of Object.keys(race.appearanceExtensions || {})) {
    appearance[f] = c.extensions[f] ?? race.appearanceExtensions[f][0];
  }
  appearance.distinguishingFeatures = [...c.features];
  appearance.intimate = [{
    genitalType: INTIMATE_GENITAL_BY_GENDER[c.gender] ?? 'unspecified',
    shapeSize: c.intimate.shapeSize, extraDetails: c.intimate.extraDetails || '',
  }];
  return appearance;
}

function validateStep(c, config, race) {
  if (c.step === 1) return true; // names default if blank
  if (c.step === 2 && c.statMode === 'pointbuy') {
    const spent = ATTRIBUTE_NAMES.reduce((s, a) => s + (c.attributes[a] - POINT_BUY_BASE), 0);
    return spent <= POINT_BUY_POOL;
  }
  return true;
}

// --- small UI helpers -------------------------------------------------------
function section(title, ...children) {
  return div(panelStyle('padding:14px 16px; display:flex; flex-direction:column; gap:10px;'), {
    children: [div(sectionLabelStyle(), { text: title }), ...children],
  });
}
function labeled(label, control) {
  return div('display:flex; flex-direction:column; gap:4px;', {
    children: [span(`font:500 10.5px ${FONT_BODY}; color:var(--text-faint);`, { text: label }), control],
  });
}
function textInput(value, onInput, extra = '') {
  const i = el('input', INPUT + extra, { attrs: { type: 'text' } });
  i.value = value ?? '';
  i.addEventListener('input', (e) => onInput(e.target.value));
  return i;
}
function selectEl(options, value, onChange) {
  const s = el('select', INPUT);
  for (const o of options) {
    const opt = el('option', '', { text: o.t, attrs: { value: o.v } });
    if (String(o.v) === String(value)) opt.setAttribute('selected', 'selected');
    s.appendChild(opt);
  }
  s.value = value ?? '';
  s.addEventListener('change', (e) => onChange(e.target.value));
  return s;
}
function chipRow(values, active, onPick, labelFn = (v) => v) {
  return div('display:flex; flex-wrap:wrap; gap:6px;', {
    children: values.map((v) => button(labelFn(v), journalTabStyle(String(active) === String(v)), () => onPick(v))),
  });
}
function modeChip(label, mode, c, rerender) {
  return button(label, journalTabStyle(c.statMode === mode), () => { c.statMode = mode; rerender(); });
}
function attrStepper(attr, value, min, max, set) {
  return div('display:flex; align-items:center; gap:8px;', {
    children: [
      span(`font:500 12px ${FONT_BODY}; color:var(--text); width:110px;`, { text: cap(attr) }),
      button('−', secondaryActionButtonStyle() + ' padding:2px 10px;', () => set(value - 1)),
      span(`font:700 13px ${FONT_HEAD}; color:var(--accent-strong); width:28px; text-align:center;`, { text: String(value) }),
      button('+', secondaryActionButtonStyle() + ' padding:2px 10px;', () => set(value + 1)),
    ],
  });
}
function rollSix() {
  const roll = () => {
    const d = [0, 0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b);
    return d[1] + d[2] + d[3]; // drop lowest
  };
  return [0, 0, 0, 0, 0, 0].map(roll);
}
function assignedElsewhere(c, attr, idx) {
  return Object.entries(c.rolledAssign).some(([a, i]) => a !== attr && i === idx);
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
