// game/ui/dom.js — tiny plain-DOM helpers so the screen modules can read like
// the design prototype's markup (inline style strings, nested children) without
// pulling in any framework. This is the whole "view layer" primitive set: create
// an element, set an inline style string, attach children/handlers, and mark an
// element "unwired" per the audit. No virtual DOM, no reconciliation — screens
// clear and rebuild their subtree on each render, exactly like the existing
// game/testHarness.js render() pattern.

import { unwiredOverlayStyle } from './styles.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'g', 'line', 'circle', 'rect', 'path', 'text', 'polyline', 'polygon']);

// el(tag, styleString, opts) — the workhorse. opts:
//   text     — textContent
//   html     — innerHTML (use only for trusted static markup, never engine text)
//   title    — title attribute (tooltip)
//   onClick  — click handler
//   attrs    — { name: value } extra attributes (incl. SVG geometry)
//   children — array of nodes/strings (null/undefined entries skipped)
//   unwired  — when truthy, applies the hazard overlay + data-unwired marker
export function el(tag, styleString = '', opts = {}) {
  const node = SVG_TAGS.has(tag)
    ? document.createElementNS(SVG_NS, tag)
    : document.createElement(tag);

  if (styleString) {
    if (node instanceof SVGElement) node.setAttribute('style', styleString);
    else node.style.cssText = styleString;
  }
  if (opts.attrs) {
    for (const [k, v] of Object.entries(opts.attrs)) {
      if (v !== undefined && v !== null) node.setAttribute(k, String(v));
    }
  }
  if (opts.title != null) node.setAttribute('title', opts.title);
  if (opts.text != null) node.textContent = String(opts.text);
  if (opts.html != null) node.innerHTML = opts.html;
  if (opts.onClick) node.addEventListener('click', opts.onClick);
  appendChildren(node, opts.children);
  if (opts.unwired) markUnwired(node);
  return node;
}

// Convenience wrappers used everywhere.
export const div = (style, opts) => el('div', style, opts);
export const span = (style, opts) => el('span', style, opts);

// button(label, styleString, onClick, opts) — a real <button> so it's keyboard
// focusable; opts.disabled and opts.unwired supported.
export function button(label, styleString, onClick, opts = {}) {
  const b = el('button', styleString, { text: label, onClick, title: opts.title, unwired: opts.unwired });
  if (opts.disabled) b.disabled = true;
  return b;
}

export function appendChildren(node, children) {
  if (!children) return node;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clearEl(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// markUnwired — the single, data-driven "not wired to a real engine" marker.
// Sets data-unwired="true" (the non-visual, programmatically queryable flag the
// audit requires) AND overlays a diagonal amber hazard-stripe span. The overlay
// is absolutely positioned + pointer-events:none so it never blocks the marked
// control's own label or clicks; it inherits border-radius so it hugs chips and
// boxes alike. This reuses the placeholder STRIPE pattern but in the warning
// --unwired-stripe-color, keeping "no image yet" (neutral gray) and "not wired"
// (amber) visually distinct. Applied wherever a view-model field/action carries
// `unwired: true`, never hand-placed in screen code.
export function markUnwired(node) {
  node.setAttribute('data-unwired', 'true');
  const computedPos = node.style.position;
  if (!computedPos || computedPos === 'static') node.style.position = 'relative';
  const overlay = document.createElement('span');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.className = 'unwired-overlay';
  overlay.style.cssText = unwiredOverlayStyle();
  node.appendChild(overlay);
  return node;
}
