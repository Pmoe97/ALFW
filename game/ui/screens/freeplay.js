// game/ui/screens/freeplay.js — the Home Base / Freeplay screen: the window the
// player looks at most. A narrative description of their surroundings plus
// contextual links to everything available right now — immersive first,
// informative second.
//
// The narration comes from the location cache (ctx.locationCache): the same
// location-state (nodeId + season + day/night + weather) serves cached text/image
// instantly; a new state shows a deterministic PLACEHOLDER immediately (visually
// distinct — lighter, italic, desaturated — so it reads as provisional) while a
// background pipeline regenerates and swaps in. Generation never blocks play. If
// no cache is wired (e.g. the engine test harness), the placeholder is rendered
// directly so the screen still works.

import { div, span, el, button } from '../dom.js';
import { buildFreeplay } from '../model.js';
import {
  FONT_HEAD, FONT_BODY, panelStyle, sectionLabelStyle, secondaryActionButtonStyle,
  placeholderStripeStyle, tierChipStyle, accentPillStyle,
} from '../styles.js';
import { fallbackLocationText } from '../../../ai/fallbackLocationText.js';

export function renderFreeplay(ui) {
  const { ctx, setState } = ui;
  const m = buildFreeplay(ctx);
  const cache = ctx.locationCache;
  const entry = cache
    ? cache.get(m.facts)
    : { text: fallbackLocationText(m.facts), textSource: 'placeholder', image: null, imageStatus: 'none' };

  const isPlaceholder = entry.textSource === 'placeholder';

  // Header: where you are + time-of-day + weather.
  const header = div('display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;', {
    children: [
      div('display:flex; flex-direction:column; gap:2px;', {
        children: [
          div(`font:700 18px ${FONT_HEAD}; color:var(--text);`, { text: m.label }),
          div(`font:500 11px ${FONT_BODY}; color:var(--text-faint);`, { text: `${cap(m.bucket)} · ${m.date.monthName} · Day ${m.date.day}` }),
        ],
      }),
      span(accentPillStyle(), { text: cap(m.weather) }),
    ],
  });

  // Image (or neutral "no image yet" placeholder).
  const imageBox = entry.image
    ? div('width:100%; border-radius:8px; overflow:hidden; border:1px solid var(--border);', {
        children: [el('img', 'width:100%; display:block;', { attrs: { src: entry.image, alt: 'location' } })],
      })
    : div(placeholderStripeStyle(1.7), {
        children: [span('', { text: entry.imageStatus === 'generating' ? 'GENERATING…' : 'NO IMAGE YET' })],
      });

  // Narration — placeholder text is lighter/italic/desaturated; AI text is normal.
  const paras = String(entry.text).split(/\n\n+/).filter(Boolean);
  const narration = div('display:flex; flex-direction:column; gap:10px;', {
    children: paras.map((p) =>
      div(`font:${isPlaceholder ? 'italic 400 13px' : '400 14px'} ${FONT_BODY}; color:${isPlaceholder ? 'var(--text-faint)' : 'var(--text)'}; line-height:1.7;`, { text: p })),
  });
  const provisionalNote = isPlaceholder
    ? span(`font:400 10px ${FONT_BODY}; color:var(--text-faint); font-style:italic;`, { text: '— a first impression; a fuller picture is forming —' })
    : null;

  // Contextual actions — links to everything available from here.
  const actions = div('display:flex; flex-wrap:wrap; gap:8px;', {
    children: [
      actionBtn('Travel', () => setState({ screen: 'travel' })),
      actionBtn(m.undiscoveredCount > 0 ? `Explore (${m.undiscoveredCount})` : 'Explore', () => setState({ screen: 'travel' })),
      m.npcNames.length ? actionBtn(`Talk (${m.npcNames.length})`, () => setState({ screen: 'conversation' })) : null,
      actionBtn('Journal & Quests', () => setState({ screen: 'journal' })),
      actionBtn('Inventory', () => setState({ screen: 'inventory' })),
      actionBtn('Character', () => setState({ screen: 'character' })),
    ],
  });

  const left = div('display:flex; flex-direction:column; gap:12px;', { children: [header, narration, provisionalNote].filter(Boolean) });
  const right = div('display:flex; flex-direction:column; gap:10px;', {
    children: [
      imageBox,
      div(panelStyle('padding:10px 12px; display:flex; flex-direction:column; gap:6px;'), {
        children: [
          div(sectionLabelStyle(), { text: 'Here' }),
          statLine('Points of interest', `${m.poiCount} known · ${m.undiscoveredCount} to find`),
          statLine('People about', m.npcNames.length ? m.npcNames.join(', ') : 'no one just now'),
        ],
      }),
    ],
  });

  const grid = div('display:grid; grid-template-columns:minmax(0,1.4fr) minmax(240px,1fr); gap:16px; align-items:start;', { children: [left, right] });

  return div('display:flex; flex-direction:column; gap:14px; padding:16px; max-width:900px; margin:0 auto;', {
    children: [grid, div('', { children: [div(sectionLabelStyle() + ' margin-bottom:6px;', { text: 'What now?' }), actions] })],
  });
}

function actionBtn(label, onClick) {
  return button(label, secondaryActionButtonStyle() + ' padding:10px 14px;', onClick);
}
function statLine(label, value) {
  return div('display:flex; justify-content:space-between; gap:10px;', {
    children: [
      span(`font:500 11px ${FONT_BODY}; color:var(--text-muted);`, { text: label }),
      span(`font:500 11px ${FONT_BODY}; color:var(--text-faint); text-align:right;`, { text: value }),
    ],
  });
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
