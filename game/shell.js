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
import { FONT_HEAD, FONT_BODY, secondaryActionButtonStyle, primaryActionButtonStyle, panelStyle } from './ui/styles.js';
import { renderMainMenu } from './ui/screens/mainMenu.js';
import { buildLiveGame } from './liveGame.js';
import { createPersistence } from './persistence.js';
import { createApp } from './ui/app-state.js';

export function createShell(mountPoint, persistence = createPersistence()) {
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
    hasSaves: () => persistence.listSaves().length > 0,
    newGame: () => enterPlay(buildLiveGame()),
    continueGame: () => setState({ phase: 'continue' }),
    openWorldConfig: () => setState({ phase: 'worldConfig' }),
    backToMenu: () => { teardown(); setState({ phase: 'menu' }); },
    loadSave: (name) => {
      const save = persistence.loadSave(name);
      if (save) enterPlay(buildLiveGame({ save }));
    },
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
    else if (state.phase === 'continue') host.appendChild(renderContinue());
    else host.appendChild(renderMainMenu(shell));
  }

  // Placeholder until Stage 3's real editor; keeps the phase reachable and the
  // back-navigation wired so the flow is testable end to end now.
  function renderWorldConfigPlaceholder() {
    return centered(
      div(panelStyle('padding:36px 44px; display:flex; flex-direction:column; align-items:center; gap:16px; max-width:460px; text-align:center;'), {
        children: [
          div(`font:600 20px ${FONT_HEAD}; color:var(--accent-strong);`, { text: 'WorldConfig' }),
          div(`font:400 12.5px ${FONT_BODY}; color:var(--text-muted); line-height:1.5;`, {
            text: 'Named world presets — theme, difficulty, weather, content toggles, and the stat/appearance field schema — will be authored here. The editor arrives in a later stage.',
          }),
          button('Back to menu', secondaryActionButtonStyle() + ' margin-top:4px;', () => shell.backToMenu()),
        ],
      })
    );
  }

  // Continue — the saved-run list. Each row loads or deletes a slot. An empty
  // list still renders (with a note) so the phase is never a dead end.
  function renderContinue() {
    const saves = persistence.listSaves();
    const rows = saves.map((s) => {
      const meta = s.meta || {};
      const when = s.savedAt ? new Date(s.savedAt).toLocaleString() : '';
      const label = div('display:flex; flex-direction:column; gap:2px; text-align:left; flex:1; min-width:0;', {
        children: [
          div(`font:600 12.5px ${FONT_HEAD}; color:var(--text);`, { text: meta.player || s.name }),
          div(`font:400 10.5px ${FONT_BODY}; color:var(--text-faint);`, { text: [meta.worldName, meta.dateText, when].filter(Boolean).join(' · ') }),
        ],
      });
      return div(panelStyle('padding:10px 12px; display:flex; align-items:center; gap:10px;'), {
        children: [
          label,
          button('Load', primaryActionButtonStyle(), () => shell.loadSave(s.name)),
          button('Delete', secondaryActionButtonStyle(), () => { persistence.deleteSave(s.name); renderPhase(); }),
        ],
      });
    });

    const body = saves.length
      ? div('display:flex; flex-direction:column; gap:8px; width:100%;', { children: rows })
      : div(`font:400 12px ${FONT_BODY}; color:var(--text-faint); text-align:center; padding:8px 0;`, { text: 'No saved games yet.' });

    const persistNote = persistence.isPersistent()
      ? null
      : div(`font:400 10px ${FONT_BODY}; color:var(--danger); text-align:center; margin-top:6px;`, {
          text: 'Storage unavailable here — saves will not survive a reload.',
        });

    return centered(
      div(panelStyle('padding:28px 32px; display:flex; flex-direction:column; gap:14px; width:min(520px,92vw);'), {
        children: [
          div(`font:600 20px ${FONT_HEAD}; color:var(--accent-strong); text-align:center;`, { text: 'Continue' }),
          body,
          persistNote,
          button('Back to menu', secondaryActionButtonStyle() + ' align-self:center;', () => shell.backToMenu()),
        ],
      })
    );
  }

  function centered(child) {
    return div('display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px;', { children: [child] });
  }

  // enterPlay — hand the mount to a live game. createApp appends its own root and
  // owns rendering; the shell wires the per-tick re-render and pause-on-blur
  // exactly as the old app.js did, but keeps handles so the run can be torn down,
  // and injects a `session` API (save / quit-to-menu) for the in-game debug menu.
  function enterPlay(game) {
    teardown();
    clearEl(mountPoint);

    game.ctx.session = {
      isPersistent: () => persistence.isPersistent(),
      // Save to a stable per-run slot (world + player), overwriting in place.
      save: () => {
        const p = game.ctx.player;
        const d = game.ctx.engines.clock.getCurrentDate();
        const playerName = `${p.identity.firstName} ${p.identity.lastName}`.trim();
        const name = `${game.config.worldName} — ${playerName}`.trim();
        persistence.writeSave(name, game.world, {
          worldName: game.config.worldName,
          player: playerName,
          dateText: `${d.monthName} Wk${d.week} Day ${d.day}`,
        });
        return name;
      },
      quitToMenu: () => shell.backToMenu(),
    };

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
