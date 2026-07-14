// ai/fallbackLocationText.js — the deterministic placeholder shown the instant a
// location is new (cache miss), BEFORE any AI text exists. Assembled from the
// SAME location facts the AI pipeline is handed, so it is never a blank/loading
// state — just a plainer, provisional read of where you are. Pure, synchronous,
// never throws, zero network (the fallbackTravelNarration discipline). Small
// deterministic variety via hashString keeps repeated visits from reading
// identically without touching the world RNG.

import { hashString } from './fallbackDialogue.js';

const WEATHER_PHRASE = {
  rain: 'a thin, steady rain', clear: 'clear open sky', overcast: 'a low grey overcast',
  storm: 'a gathering storm', snow: 'drifting snow', fog: 'a soft, close fog',
  warm: 'warm, still air', blizzard: 'a howling blizzard',
};
const BUCKET_PHRASE = {
  morning: 'early morning', day: 'midday', evening: 'evening', night: 'deep night',
};
const OPENERS = ['You stand in', 'You find yourself in', 'Around you lies', 'You take in'];

function listPhrase(items) {
  if (!items || items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

// fallbackLocationText(facts) → a 2-paragraph provisional description.
// facts: { nodeId, terrain, kind, tier, settlementLabel, date:{monthName},
//          bucket, weather, poiNames:[], npcNames:[] }
export function fallbackLocationText(facts) {
  const sky = WEATHER_PHRASE[facts.weather] || facts.weather || 'an uncertain sky';
  const when = BUCKET_PHRASE[facts.bucket] || facts.bucket || 'the day';
  const opener = OPENERS[hashString(`${facts.nodeId}|${facts.bucket}|${facts.weather}`) % OPENERS.length];
  const place = facts.kind === 'settlement'
    ? `the ${facts.tier || 'settlement'} of ${facts.settlementLabel || 'this place'}`
    : `open ${facts.terrain || 'wild'} country`;

  const p1 = `${opener} ${place}, under ${sky}. It is ${when}, in ${facts.date?.monthName || 'an unnamed season'}.`;

  const poiSentence = facts.poiNames && facts.poiNames.length
    ? `You can make out ${listPhrase(facts.poiNames)} nearby.`
    : 'Nothing in particular draws the eye here yet.';
  const peopleSentence = facts.npcNames && facts.npcNames.length
    ? `${listPhrase(facts.npcNames)} ${facts.npcNames.length === 1 ? 'is' : 'are'} about.`
    : '';
  const p2 = [poiSentence, peopleSentence].filter(Boolean).join(' ');

  return `${p1}\n\n${p2}`;
}
