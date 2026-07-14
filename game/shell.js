// game/shell.js — the top-level phase controller that sits ABOVE the in-game UI.
//
// The old game/app.js built a live world and dropped straight into play. The
// onboarding flow needs a stage BEFORE any world exists (Main Menu → WorldConfig
// → Character Creation → …), so the shell owns the mount point and a `phase`
// string, renders the pre-play phases itself, and only constructs a live game
// (via buildLiveGame) when the player actually starts one — at which point it
// hands the DOM to createApp, which owns rendering for the duration of play.
//
// This mirrors how app-state.js already computes an EFFECTIVE screen (the combat
// force-override): here the shell computes an effective PHASE. Pre-play phases
// don't need a world/engines, so keeping them in a separate lightweight loop is
// cleaner than forcing createApp to tolerate a null world.

import { applyTheme, DEFAULT_THEME } from './ui/theme.js';
import { clearEl, div, button } from './ui/dom.js';
import { FONT_HEAD, FONT_BODY, secondaryActionButtonStyle } from './ui/styles.js';
import { renderMainMenu } from './ui/screens/mainMenu.js';
import { buildLiveGame } from './liveGame.js';
import { createApp } from './ui/app-state.js';

export function createShell(mountPoint) {
  const state = { phase: 'menu', theme: DEFAULT_THEME };
  // The live run currently mounted (null in pre-play phases). Held so a return
  // to the menu can stop the tick and detach the window listeners.
  let running = null;

  function setState(patch) {
    Object.assign(state, patch);
    renderPhase();
  }

  const shell = {
    state,
    setState,
    // Wired by the persistence stage; false today so Continue stays disabled.
    hasSaves: () => false,
    newGame: () => enterPlay(buildLiveGame()),
    continueGame: () => { /* wired by the persistence stage */ },
    openWorldConfig: () => setState({ phase: 'worldConfig' }),
    backToMenu: () => { teardown(); setState({ phase: 'menu' }); },
  };

  // renderPhase — draw the current PRE-PLAY phase. Never runs during 'play'
  // (createApp owns the DOM then).
  function renderPhase() {
    if (state.phase === 'play') return;
    clearEl(mountPoint);
    const host = div('min-height:100vh; background:var(--bg);');
    applyTheme(host, state.theme);
    mountPoint.appendChild(host);
    if (state.phase === 'worldConfig') host.appendChild(renderWorldConfigPlaceholder());
    else host.appendChild(renderMainMenu(shell));
  }

  // Placeholder until Stage 3's real editor; keeps the phase reachable and the
  // back-navigation wired so the flow is testable end to end now.
  function renderWorldConfigPlaceholder() {
    const panel = div(
      'background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:36px 44px; display:flex; flex-direction:column; align-items:center; gap:16px; max-width:460px; text-align:center;',
      {
        children: [
          div(`font:600 20px ${FONT_HEAD}; color:var(--accent-strong);`, { text: 'WorldConfig' }),
          div(`font:400 12.5px ${FONT_BODY}; color:var(--text-muted); line-height:1.5;`, {
            text: 'Named world presets — theme, difficulty, weather, content toggles, and the stat/appearance field schema — will be authored here. The editor arrives in a later stage.',
          }),
          button('Back to menu', secondaryActionButtonStyle() + ' margin-top:4px;', () => shell.backToMenu()),
        ],
      }
    );
    return div('display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px;', { children: [panel] });
  }

  // enterPlay — hand the mount to a live game. createApp appends its own root and
  // owns rendering; the shell wires the per-tick re-render and pause-on-blur
  // exactly as the old app.js did, but keeps handles so the run can be torn down.
  function enterPlay(game) {
    teardown();
    clearEl(mountPoint);
    const { render } = createApp(game.ctx, mountPoint);
    const unsubTick = game.world.subscribe('CLOCK_TICK', render);

    const cfg = game.config;
    let visHandler = null, blurHandler = null, focusHandler = null;
    if (cfg.runtime?.pauseOnBlur) {
      visHandler = () => { if (document.hidden) game.tick.pause(); else game.tick.resume(); };
      blurHandler = () => game.tick.pause();
      focusHandler = () => game.tick.resume();
      document.addEventListener('visibilitychange', visHandler);
      window.addEventListener('blur', blurHandler);
      window.addEventListener('focus', focusHandler);
    }

    running = { game, unsubTick, visHandler, blurHandler, focusHandler };
    state.phase = 'play';
    render();
    game.tick.start();
  }

  function teardown() {
    if (!running) return;
    running.game.tick.stop();
    running.unsubTick?.();
    if (running.visHandler) document.removeEventListener('visibilitychange', running.visHandler);
    if (running.blurHandler) window.removeEventListener('blur', running.blurHandler);
    if (running.focusHandler) window.removeEventListener('focus', running.focusHandler);
    running = null;
  }

  renderPhase();
  return shell;
}
