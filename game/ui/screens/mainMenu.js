// game/ui/screens/mainMenu.js — the first screen a player sees. Unlike the
// in-game screens (which take the render-loop `ui` and read a build*() view-model
// off a live world), the Main Menu runs BEFORE any world exists, so it takes the
// lightweight `shell` controller (game/shell.js) instead: { state, setState, and
// the phase-transition actions newGame / continueGame / openWorldConfig }. It
// reads no engines and fabricates no values.
//
// Continue is disabled until the persistence stage lands saves; it is marked
// `unwired` (the same data-driven "not backed yet" marker the in-game screens
// use) rather than hidden, so the shape of the menu is stable across stages.

import { div, button } from '../dom.js';
import { FONT_HEAD, FONT_BODY, primaryActionButtonStyle, secondaryActionButtonStyle } from '../styles.js';

export function renderMainMenu(shell) {
  const { state } = shell;
  const hasSaves = shell.hasSaves?.() ?? false;

  const title = div(`font:700 46px ${FONT_HEAD}; letter-spacing:0.06em; color:var(--accent-strong); text-align:center;`, { text: 'ALFW' });
  const tagline = div(`font:400 13px ${FONT_BODY}; color:var(--text-muted); text-align:center; margin-top:4px; letter-spacing:0.04em;`, {
    text: 'A deterministic world, waiting for a life to be lived in it.',
  });

  const menuBtn = (label, onClick, opts = {}) => {
    const style = (opts.primary ? primaryActionButtonStyle() : secondaryActionButtonStyle()) +
      ' width:240px; padding:12px 16px; font-size:13px; text-align:center;';
    return button(label, style, onClick, { disabled: opts.disabled, unwired: opts.unwired, title: opts.title });
  };

  const buttons = div('display:flex; flex-direction:column; gap:10px; align-items:center; margin-top:28px;', {
    children: [
      menuBtn('New Game', () => shell.startCreation(), { primary: true }),
      menuBtn(
        hasSaves ? 'Continue' : 'Continue (no saves yet)',
        () => hasSaves && shell.continueGame(),
        { disabled: !hasSaves, unwired: !hasSaves, title: hasSaves ? '' : 'Saved games appear here once you have one.' }
      ),
      menuBtn('WorldConfig', () => shell.openWorldConfig()),
    ],
  });

  const panel = div(
    `background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:40px 48px; display:flex; flex-direction:column; align-items:center; box-shadow:0 8px 40px rgba(0,0,0,0.35);`,
    { children: [title, tagline, buttons] }
  );

  return div('display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px;', {
    children: [panel],
  });
}
