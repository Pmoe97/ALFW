// game/ui/screens/walkthrough.js — the first-run UI walkthrough: a click-through
// overlay of ≤10 short steps covering the essentials only (where you are, how to
// navigate, how to explore) — no deep systems. Shown once, right after the isekai
// landing, over the Freeplay screen; skippable at any point. Driven by
// ui.state.walkthroughStep / walkthroughActive and dismissed by advancing past
// the last step or Skip.

import { div, span, button } from '../dom.js';
import { FONT_HEAD, FONT_BODY, primaryActionButtonStyle, secondaryActionButtonStyle } from '../styles.js';

const STEPS = [
  { title: 'This is your world', body: 'This screen is your window onto everything around you. You will return here between everything you do.' },
  { title: 'The top bar', body: 'Up top: your name and vocation, where you are, and the date and time. Keep an eye on it.' },
  { title: 'Time moves', body: 'The world keeps its own time — day turns to night, the seasons and weather shift as you act, even while you think.' },
  { title: 'Getting around', body: 'Travel carries you to new places. Explore searches wherever you are standing for what is hidden nearby.' },
  { title: 'The people here', body: 'Talk to anyone you meet. Everyone remembers how you treat them — kindness and cruelty both leave a mark.' },
  { title: 'Your records', body: 'Your Journal tracks quests and the map; your Character sheet, who you have become. Your Inventory holds what you carry.' },
  { title: 'Begin', body: 'That is enough to start. The rest you will learn by living it. Good luck.' },
];

export function renderWalkthrough(ui) {
  const { state, setState } = ui;
  const i = Math.min(state.walkthroughStep || 0, STEPS.length - 1);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // Dismissing the walkthrough (Begin or Skip) opens the first-fight tutorial on
  // isekai runs; a no-op otherwise.
  const dismiss = () => {
    setState({ walkthroughActive: false });
    ui.ctx.tutorial?.start();
    setState({}); // re-render so the tutorial fight's combat screen shows at once
  };

  const dots = div('display:flex; gap:5px; justify-content:center;', {
    children: STEPS.map((_, k) =>
      span(`width:7px; height:7px; border-radius:50%; background:${k === i ? 'var(--accent)' : 'var(--border-strong)'};`)),
  });

  const card = div(
    'background:var(--panel); border:1px solid var(--border-strong); border-radius:12px; padding:26px 28px; width:min(440px,92vw); display:flex; flex-direction:column; gap:14px; box-shadow:0 12px 48px rgba(0,0,0,0.5);',
    {
      children: [
        span(`font:600 10px ${FONT_HEAD}; letter-spacing:0.14em; text-transform:uppercase; color:var(--accent-strong);`, { text: `Step ${i + 1} of ${STEPS.length}` }),
        div(`font:700 18px ${FONT_HEAD}; color:var(--text);`, { text: step.title }),
        div(`font:400 13.5px ${FONT_BODY}; color:var(--text-muted); line-height:1.6;`, { text: step.body }),
        dots,
        div('display:flex; justify-content:space-between; align-items:center; margin-top:4px;', {
          children: [
            button('Skip', secondaryActionButtonStyle(), dismiss),
            button(last ? 'Begin' : 'Next', primaryActionButtonStyle() + ' padding:10px 20px;',
              () => (last ? dismiss() : setState({ walkthroughStep: i + 1 }))),
          ],
        }),
      ],
    }
  );

  // Full-screen scrim so the overlay reads as modal over the live Freeplay view.
  return div('position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,0.55); padding:20px;', {
    children: [card],
  });
}
