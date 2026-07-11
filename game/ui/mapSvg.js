// game/ui/mapSvg.js — a shared SVG map renderer used by Travel and Journal. Plots
// REAL node world-coordinates (from worldMapEngine) into a fixed viewBox, colored
// by kind (settlement=info, wilderness=danger) with the player's node accented.
// Optional edges draw the real adjacency. Pure presentation over real positions —
// no invented geography.

import { el } from './dom.js';

const VB_W = 600;
const VB_H = 400;
const PAD = 60;

// project(points) — map world (x,y) into the padded viewBox, preserving aspect
// so the lattice isn't distorted. Returns a function (x,y) -> {px,py}.
function projector(points) {
  if (points.length === 0) return () => ({ px: VB_W / 2, py: VB_H / 2 });
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((VB_W - 2 * PAD) / spanX, (VB_H - 2 * PAD) / spanY);
  const offX = (VB_W - spanX * scale) / 2;
  const offY = (VB_H - spanY * scale) / 2;
  return (x, y) => ({ px: offX + (x - minX) * scale, py: offY + (y - minY) * scale });
}

// renderMapSvg(points, opts) — points: [{x,y,here,kind,label}]. opts.edges:
// [{from:{x,y}, to:{x,y}, passable}]. opts.height: css height.
export function renderMapSvg(points, opts = {}) {
  const project = projector(points);
  const svg = el('svg', `width:100%; height:${opts.height || '100%'}; display:block;`, {
    attrs: { viewBox: `0 0 ${VB_W} ${VB_H}` },
  });

  for (const e of opts.edges || []) {
    const a = project(e.from.x, e.from.y);
    const b = project(e.to.x, e.to.y);
    svg.appendChild(el('line', '', {
      attrs: {
        x1: a.px.toFixed(1), y1: a.py.toFixed(1), x2: b.px.toFixed(1), y2: b.py.toFixed(1),
        stroke: 'var(--border-strong)', 'stroke-width': 2,
        ...(e.passable === false ? { 'stroke-dasharray': '4 4' } : {}),
      },
    }));
  }

  for (const p of points) {
    const { px, py } = project(p.x, p.y);
    const isSettlement = p.kind === 'settlement';
    const fill = p.here ? 'var(--accent)' : 'var(--panel-alt)';
    const stroke = p.here ? 'var(--accent-strong)' : (isSettlement ? 'var(--info)' : 'var(--danger)');
    svg.appendChild(el('circle', '', {
      attrs: { cx: px.toFixed(1), cy: py.toFixed(1), r: p.here ? 11 : 7, fill, stroke, 'stroke-width': 2 },
    }));
    svg.appendChild(el('text', '', {
      attrs: {
        x: px.toFixed(1), y: (py - 14).toFixed(1), 'text-anchor': 'middle',
        fill: p.here ? 'var(--text)' : 'var(--text-muted)', 'font-size': 10, 'font-family': 'Inter, sans-serif',
      },
      text: p.here ? 'You are here' : p.label,
    }));
  }

  // Legend
  const legend = el('div',
    'position:absolute; left:10px; bottom:10px; display:flex; gap:10px; font:500 10px Inter,sans-serif; color:var(--text-faint); background:rgba(0,0,0,0.35); padding:5px 8px; border-radius:4px;',
    { html:
      '<span style="display:flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--info);display:inline-block;"></span>Settlement</span>' +
      '<span style="display:flex;align-items:center;gap:4px;"><span style="width:7px;height:7px;border-radius:50%;background:var(--danger);display:inline-block;"></span>Wilderness</span>' +
      '<span>- - impassable</span>',
    });

  return { svg, legend };
}
