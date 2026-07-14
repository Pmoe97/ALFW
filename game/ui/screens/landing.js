// game/ui/screens/landing.js — the isekai landing: a reactive narrative anchor
// shown after Character Creation, before the Freeplay loop. "You open your
// eyes..." — generic enough to read under any worldConfig, but REACTIVE to it:
// season, time of day, deterministic weather, the terrain underfoot, and the
// small settlement the placement logic sat the player beside.
//
// This narration is a deterministic template (no AI needed): the AI location
// pipeline belongs to Freeplay; the landing is a fixed, reactive beat. It takes
// the already-built (but not-yet-ticking) game so it can read the live world;
// "Open your eyes" hands off to play.

import { div, button } from '../dom.js';
import { FONT_HEAD, FONT_BODY, primaryActionButtonStyle, panelStyle } from '../styles.js';
import { weatherForLocation } from '../../../engines/weather.js';
import { deriveTimeOfDayBucket } from '../../../engines/worldClockEngine.js';

const capTier = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const WEATHER_PHRASE = {
  rain: 'a thin, steady rain', clear: 'clear open sky', overcast: 'a low grey overcast',
  storm: 'a gathering storm', snow: 'drifting snow', fog: 'a soft, close fog',
  warm: 'warm and still air', blizzard: 'a howling white blizzard',
};
const BUCKET_PHRASE = {
  morning: 'early morning', day: 'the middle of the day', evening: 'the failing light of evening', night: 'the dark of night',
};

function directionTo(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  const dirs = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
  return dirs[(Math.round(((ang + 360) % 360) / 45)) % 8];
}

function composeLanding({ player, node, date, bucket, weather, settlement }) {
  const name = player?.identity?.firstName || 'Traveler';
  const terrain = node?.terrainType ? `${node.terrainType} country` : 'unfamiliar country';
  const sky = WEATHER_PHRASE[weather] || weather || 'a nameless sky';
  const when = BUCKET_PHRASE[bucket] || bucket;
  const season = date?.monthName ? `the season of ${date.monthName}` : 'a season you do not know';

  const first = `You open your eyes to ${sky} and ${terrain} stretching out around you. It is ${when}, in ${season}.`;
  const second = `Your last life is already fading — the shape of it, the name, all of it slipping like water. Only "${name}" remains, and even that feels borrowed.`;
  let third;
  if (settlement) {
    const dir = directionTo(node, settlement);
    const tierWord = capTier(settlement.tier || 'settlement');
    third = `You are not alone out here: a small ${tierWord.toLowerCase()} sits close by, its rooftops just visible to the ${dir}. Somewhere to begin.`;
  } else {
    third = `There is no shelter in sight — only the open ${node?.terrainType || 'wild'} and whatever you make of it.`;
  }
  return [first, second, third];
}

export function renderLanding(shell, game) {
  const { ctx } = game;
  const { engines, player, config } = ctx;
  const node = engines.map.getNode(engines.travel.getPlayerNodeId());
  const date = engines.clock.getCurrentDate();
  const bucket = deriveTimeOfDayBucket(date.hour);
  const weather = weatherForLocation(config, engines.clock, node);
  const settlement = engines.map.getStartSettlement?.() ?? null;

  const paras = composeLanding({ player, node, date, bucket, weather, settlement });

  const panel = div(panelStyle('padding:34px 40px; display:flex; flex-direction:column; gap:16px; width:min(620px,92vw);'), {
    children: [
      div(`font:600 12px ${FONT_HEAD}; letter-spacing:0.14em; text-transform:uppercase; color:var(--accent-strong); text-align:center;`, { text: 'A new life' }),
      ...paras.map((p) => div(`font:400 14px ${FONT_BODY}; color:var(--text); line-height:1.7;`, { text: p })),
      div('display:flex; justify-content:center; margin-top:8px;', {
        children: [button('Open your eyes', primaryActionButtonStyle() + ' padding:12px 22px; font-size:13px;', () => shell.enterPlayFromLanding())],
      }),
    ],
  });

  return div('display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px;', { children: [panel] });
}
