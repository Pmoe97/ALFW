// game/ui/app-state.js — the UI state + render loop. No framework: a plain state
// object, a setState that merges + re-renders, and a render() that rebuilds the
// HUD, the active screen, and the debug menu from scratch each pass. This mirrors
// game/testHarness.js's subscribe-and-re-render pattern, scaled to a multi-screen
// UI. Full rebuild per pass is fine at this scale; focus/scroll of the one live
// text input (the conversation Say box) is preserved across passes so typing and
// per-tick clock updates coexist.

import { applyTheme } from './theme.js';
import { clearEl } from './dom.js';
import { renderHud } from './hud.js';
import { renderDebugMenu } from './debugMenu.js';
import { renderTravel } from './screens/travel.js';
import { renderConversation } from './screens/conversation.js';
import { renderInventory } from './screens/inventory.js';
import { renderJournal } from './screens/journal.js';
import { renderCharacter } from './screens/character.js';
import { renderTrading } from './screens/trading.js';
import { renderCraft } from './screens/craft.js';
import { renderCombat } from './screens/combat.js';
import { renderFreeplay } from './screens/freeplay.js';

const SCREENS = {
  freeplay: renderFreeplay,
  travel: renderTravel,
  conversation: renderConversation,
  inventory: renderInventory,
  journal: renderJournal,
  character: renderCharacter,
  trading: renderTrading,
  craft: renderCraft,
  combat: renderCombat,
};

const INITIAL_STATE = {
  screen: 'freeplay',
  theme: 'leather',
  // per-screen variant/sub-state (the design's variants + tabs)
  travelVariant: 'a',
  convoVariant: 'a',
  invView: 'desktop',
  invMobileTab: 'items',
  tradingView: 'desktop',
  tradingMobileTab: 'yours',
  selectedCategory: 'all',
  selectedItemId: null, // an inventory row key: an instanceId or a stack's defId
  journalTab: 'log',
  characterTab: 'overview',
  combatTargetId: null,
  craftStation: 'blacksmith',
  craftRecipeId: 'bs1',
  offerPlayerIds: [],
  offerMerchantIds: [],
  debugOpen: false,
};

// createApp(ctx) — builds the DOM shell and returns { ui, render, mount }.
// ctx carries the live world + engines + entities (see game/app.js:buildContext).
export function createApp(ctx, mountPoint) {
  const state = { ...INITIAL_STATE };

  const root = document.createElement('div');
  root.style.cssText =
    'display:flex; flex-direction:column; min-height:100vh; background:var(--bg); font-family:Inter,sans-serif;';

  const hudHost = document.createElement('div');
  const contentHost = document.createElement('div');
  contentHost.style.cssText = 'flex:1; min-height:0; overflow:auto;';
  const debugHost = document.createElement('div');

  root.append(hudHost, contentHost, debugHost);
  mountPoint.appendChild(root);

  const ui = { state, ctx, setState, root };

  function setState(patch) {
    Object.assign(state, patch);
    render();
  }

  function render() {
    applyTheme(root, state.theme);

    // Preserve the live text input (conversation) across the rebuild.
    const active = document.activeElement;
    const focusId = active && active.id && active.tagName === 'INPUT' ? active.id : null;
    const focusVal = focusId ? active.value : null;
    const focusSel = focusId ? active.selectionStart : null;
    const scrollTop = contentHost.scrollTop;

    clearEl(hudHost).appendChild(renderHud(ui));
    // An open fight (or a defeated player) forces the combat screen and blocks
    // navigation — WITHOUT mutating state.screen, so the player returns to
    // wherever they were once the fight resolves. Mirrors how the combat
    // engine's timeContext freeze blocks travel at the engine layer.
    const combat = ctx.engines?.combat;
    const forceCombat = combat && (combat.getActiveCombat() || combat.isPlayerDefeated());
    const screenId = forceCombat ? 'combat' : state.screen;
    const screenFn = SCREENS[screenId] || SCREENS.travel;
    clearEl(contentHost).appendChild(screenFn(ui));
    clearEl(debugHost).appendChild(renderDebugMenu(ui));

    if (focusId) {
      const again = document.getElementById(focusId);
      if (again) {
        again.value = focusVal;
        again.focus();
        try { again.setSelectionRange(focusSel, focusSel); } catch { /* non-text input */ }
      }
    }
    contentHost.scrollTop = scrollTop;
  }

  return { ui, render };
}
