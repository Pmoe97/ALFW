// game/ui/theme.js — the three ALFW themes, ported VERBATIM from the Claude
// Design prototype's `themes` object (ALFW UI.dc.html), plus one added token:
// --unwired-stripe-color (the hazard-stripe hue for elements not backed by a
// real engine — see game/ui/styles.js:unwiredOverlayStyle). applyTheme sets every
// token as an inline CSS custom property on the UI root, the same mechanism the
// prototype used via its spread `rootStyle`; every screen reads only var(--token),
// so switching themes is a single re-apply with no per-screen work.
//
// The added --unwired-stripe-color is a warning AMBER, deliberately chosen to sit
// apart from both --danger (an in-game reddish state) and the neutral gray image
// placeholder, so the "not wired to anything real" marking never reads as either.

export const THEMES = {
  leather: {
    '--bg': '#17130f', '--bg-soft': '#1c1712', '--panel': '#221b13', '--panel-alt': '#2a2118',
    '--border': '#3c3022', '--border-strong': '#4d3f2c',
    '--text': '#ece2d0', '--text-muted': '#b3a48c', '--text-faint': '#8a7c65',
    '--accent': '#c79a55', '--accent-soft': 'rgba(199,154,85,0.16)', '--accent-strong': '#e0b876',
    '--danger': '#c1502f', '--danger-soft': 'rgba(193,80,47,0.18)',
    '--good': '#7a9660', '--good-soft': 'rgba(122,150,96,0.16)',
    '--info': '#6f8fae', '--info-soft': 'rgba(111,143,174,0.16)',
    '--accent-contrast': '#1f160d',
    '--unwired-stripe-color': 'rgba(228,176,54,0.24)',
  },
  moss: {
    '--bg': '#131712', '--bg-soft': '#181d15', '--panel': '#1b2117', '--panel-alt': '#222b1c',
    '--border': '#31392a', '--border-strong': '#414c33',
    '--text': '#e4e8dd', '--text-muted': '#a9b399', '--text-faint': '#7d8a6c',
    '--accent': '#8fae72', '--accent-soft': 'rgba(143,174,114,0.16)', '--accent-strong': '#aecb90',
    '--danger': '#b25a3f', '--danger-soft': 'rgba(178,90,63,0.18)',
    '--good': '#7a9660', '--good-soft': 'rgba(122,150,96,0.16)',
    '--info': '#6f93a3', '--info-soft': 'rgba(111,147,163,0.16)',
    '--accent-contrast': '#141b10',
    '--unwired-stripe-color': 'rgba(214,190,72,0.22)',
  },
  storm: {
    '--bg': '#11131a', '--bg-soft': '#161923', '--panel': '#181c26', '--panel-alt': '#1f2532',
    '--border': '#2b3244', '--border-strong': '#3a4358',
    '--text': '#e2e5ee', '--text-muted': '#9aa3b8', '--text-faint': '#707a90',
    '--accent': '#7d93bb', '--accent-soft': 'rgba(125,147,187,0.16)', '--accent-strong': '#a3b5d6',
    '--danger': '#b0623a', '--danger-soft': 'rgba(176,98,58,0.18)',
    '--good': '#6f9a72', '--good-soft': 'rgba(111,154,114,0.16)',
    '--info': '#7d93bb', '--info-soft': 'rgba(125,147,187,0.16)',
    '--accent-contrast': '#11141c',
    '--unwired-stripe-color': 'rgba(216,182,74,0.22)',
  },
};

// Ordered list + swatch (accent) for the debug menu's theme switcher.
export const THEME_ORDER = [
  { id: 'leather', label: 'Dyed Leather', swatch: '#c79a55' },
  { id: 'moss', label: 'Moss & Iron', swatch: '#8fae72' },
  { id: 'storm', label: 'Storm Ledger', swatch: '#7d93bb' },
];

export const DEFAULT_THEME = 'leather';

// applyTheme(rootEl, name) — write every token of the named theme as an inline
// custom property on rootEl. Idempotent; unknown names fall back to the default.
export function applyTheme(rootEl, name) {
  const theme = THEMES[name] || THEMES[DEFAULT_THEME];
  for (const [token, value] of Object.entries(theme)) {
    rootEl.style.setProperty(token, value);
  }
  return name in THEMES ? name : DEFAULT_THEME;
}
