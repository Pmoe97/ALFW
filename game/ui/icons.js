// game/ui/icons.js — inline SVG icon strings lifted from the design prototype,
// plus a helper that returns a <span> wrapping the icon markup. Kept as static
// trusted strings (never engine text), so setting them via innerHTML is safe.

import { span } from './dom.js';

const svg = (inner, size = 15, stroke = 'currentColor') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" style="display:block;">${inner}</svg>`;

export const ICONS = {
  inventory: (s) => svg('<rect x="4" y="8" width="16" height="12" rx="2"></rect><path d="M8 8V6a4 4 0 0 1 8 0v2"></path>', s),
  journal: (s) => svg('<rect x="4" y="4" width="16" height="16" rx="1"></rect><path d="M12 4v16"></path>', s),
  character: (s) => svg('<circle cx="12" cy="8" r="4"></circle><path d="M4 20c0-4 3-7 8-7s8 3 8 7"></path>', s),
  menu: (s) => svg('<line x1="4" y1="7" x2="20" y2="7"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="17" x2="20" y2="17"></line>', s),
  pin: (s) => svg('<circle cx="12" cy="10" r="5"></circle><path d="M12 21 7 12h10z"></path>', s, 'var(--text-muted)'),
  clock: (s) => svg('<circle cx="12" cy="12" r="9"></circle><path d="M12 12V7"></path><path d="M12 12l4 2"></path>', s, 'var(--info)'),
  exchange: (s) => svg('<path d="M7 7h13l-3-3M17 17H4l3 3"></path>', s),
};

// iconSpan(name, size) — a span carrying the named icon markup.
export function iconSpan(name, size = 15, extraStyle = '') {
  const builder = ICONS[name] || ICONS.menu;
  return span(`display:inline-flex; align-items:center; ${extraStyle}`, { html: builder(size) });
}
