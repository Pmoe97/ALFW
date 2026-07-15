// engines/weather.js — deterministic, seed-based weather.
//
// Weather is PURE over (seed, season, day-index, region): the same seeded world
// yields the same weather on the same day in the same place, every time — the
// exact discipline deriveTerrainAt / deriveWeatherAt-style derivations use, so
// it needs NO event log and dispatches nothing. It reuses the one seeded-hash
// idiom (mulberry32 ∘ hashCoords) with its own disjoint salt band so weather
// randomness never correlates with terrain, POIs, NPCs, travel, or economy.
//
// The per-season probability tables are a worldConfig setting
// (config.weather.seasons[<monthName>] = { <type>: weight }); a world that
// declares none falls back to the built-in defaults below. Because the calendar
// has one month per season (monthsPerYear 4: Rain/Sun/Harvest/Snow), the season
// IS the month index.

import { mulberry32 } from '../worldState.js';
import { hashCoords, mapSeed } from './worldMapEngine.js';
import { weightedPick } from './poiEngine.js';
import { getSchema } from './activeSchema.js';

// Disjoint salt band, kept clear of terrain (11/29/…), POI (60000/80000),
// NPC (100000), and travel-incident (120000) per worldMapEngine's ledger.
const WEATHER_SALT = 140000;

const DEFAULT_SEASON_WEATHER = getSchema().weather.defaultSeasonWeather;
const GENERIC_WEATHER = getSchema().weather.genericWeather;

// weatherTableFor — the { type: weight } table for a season: the world's
// authored table when present and non-empty, else a built-in default.
export function weatherTableFor(config, seasonName) {
  const authored = config?.weather?.seasons?.[seasonName];
  if (authored && Object.keys(authored).length > 0) return authored;
  return DEFAULT_SEASON_WEATHER[seasonName] ?? GENERIC_WEATHER;
}

// packRegion — coarsen node coords into one stable integer so weather is
// spatially COHERENT: a whole ~8-unit region shares a day's weather rather than
// flickering per node. Two adjacent nodes therefore read the same sky.
function packRegion(node) {
  const kx = Math.round((node?.x ?? 0) / 8) & 0xffff;
  const ky = Math.round((node?.y ?? 0) / 8) & 0xffff;
  return (kx << 16) | ky;
}

// deriveWeatherAt — PURE weather for (config, node, dayIndex, seasonIndex).
// Reuses the canonical seeded-draw idiom; entries are sorted by type so the
// weighted pick is independent of config key order. Deterministic: identical
// inputs → identical weather, with no state and no clock read in the path.
export function deriveWeatherAt(config, node, dayIndex, seasonIndex) {
  const monthNames = config?.calendar?.monthNames ?? [];
  const seasonName = monthNames[seasonIndex] ?? monthNames[0] ?? 'Rain';
  const table = weatherTableFor(config, seasonName);
  const entries = Object.keys(table).sort().map((type) => ({ name: type, weight: table[type] }));
  if (entries.length === 0) return 'clear';
  const rng = mulberry32(hashCoords(mapSeed(config), WEATHER_SALT + seasonIndex, dayIndex, packRegion(node)));
  return weightedPick(entries, rng());
}

// dayIndexFrom — the stable absolute day counter used as the weather day input
// (and as a cache-validity signal). Days since the world's start epoch; changes
// exactly at each calendar day boundary.
export function dayIndexFrom(config, totalGameSeconds) {
  const perDay = config?.calendar?.secondsPerGameDay || 86400;
  return Math.floor(totalGameSeconds / perDay);
}

// weatherForLocation — convenience: derive the current weather at a node from a
// live world clock, computing the season (month index) and day-index for the
// caller. Used by the Freeplay location-state hash and the isekai landing.
export function weatherForLocation(config, clock, node) {
  const date = clock.getCurrentDate();
  const dayIndex = dayIndexFrom(config, clock.getTotalGameSeconds());
  return deriveWeatherAt(config, node, dayIndex, date.monthIndex);
}
