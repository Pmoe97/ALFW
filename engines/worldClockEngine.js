// engines/worldClockEngine.js — the system that owns the passage of game-time.
//
// Time is never stored as a mutable clock. Every quantity here is DERIVED from
// the append-only event log:
//
//   * CLOCK_TICK { realSecondsElapsed } — continuous dilation. Real seconds are
//     converted to game-seconds using the multiplier of the ACTIVE timeContext
//     at the moment that tick is processed. The tick entry stores only the raw
//     realSecondsElapsed; the multiplier is applied at derivation time, so
//     retuning a multiplier in WorldConfig changes the rebuilt result.
//   * CLOCK_JUMP { gameSecondsElapsed } — discrete jump (e.g. sleep). Adds a
//     flat, config-independent amount of game-seconds. Never passes through a
//     multiplier.
//
// Active timeContext is itself derived: any dispatched action MAY carry an
// optional `timeContext` string in its payload, and the most recent such action
// before a given point sets the context from that point forward. This engine
// only ever READS that optional field — it never special-cases another system's
// action `type`, and it never imports or calls another engine. Default context
// (none ever set) is 'idle'.
//
// Calendar/date derivation is pure math over total elapsed game-seconds: given
// WorldConfig calendar settings and a total-seconds number, out comes a date
// object. No state, no game logic.

import { log } from '../debugLog.js';

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_TIME_CONTEXT = 'idle';

// deriveActiveTimeContext — the timeContext in force at a point in the log.
//
// Scans for the most recent entry (at or before `atSeq`) whose payload carries
// a string `timeContext`, and returns it; 'idle' if none ever did. `atSeq` is
// the inclusive seq/index cutoff and defaults to the whole log. It is the
// index form of "atIndexOrTimestamp": timestamp-based lookup is a no-op today
// because the kernel stamps every entry with the same constant worldTime, so
// seq is the only meaningful ordering.
export function deriveActiveTimeContext(log, atSeq = Infinity) {
  let context = DEFAULT_TIME_CONTEXT;
  for (const entry of log) {
    if (entry.seq > atSeq) break;
    if (typeof entry.payload?.timeContext === 'string') {
      context = entry.payload.timeContext;
    }
  }
  return context;
}

// deriveTotalGameSeconds — total elapsed game-seconds since epoch, rebuilt from
// the log alone. Replays in order tracking the active context; an entry's own
// timeContext is applied BEFORE that entry's contribution, so a tick that also
// carries a context uses the new one. CLOCK_TICK contributes
// realSecondsElapsed × multiplier[context]; CLOCK_JUMP contributes its flat
// gameSecondsElapsed with no multiplier. Everything else is time-inert.
export function deriveTotalGameSeconds(config, log) {
  const multipliers = config?.timeDilation?.multipliers;
  if (!multipliers) {
    throw new Error('WorldConfig is missing timeDilation.multipliers');
  }

  let total = 0;
  let context = DEFAULT_TIME_CONTEXT;

  for (const entry of log) {
    if (typeof entry.payload?.timeContext === 'string') {
      context = entry.payload.timeContext;
    }
    if (entry.type === 'CLOCK_TICK') {
      const multiplier = multipliers[context];
      if (typeof multiplier !== 'number') {
        throw new Error(
          `No dilation multiplier configured for timeContext "${context}"`
        );
      }
      total += entry.payload.realSecondsElapsed * multiplier;
    } else if (entry.type === 'CLOCK_JUMP') {
      total += entry.payload.gameSecondsElapsed;
    }
  }
  return total;
}

// deriveCalendarDate — pure function: (config + total game-seconds) -> date.
//
// Total game-seconds of 0 resolves to exactly the configured epoch. The epoch
// is folded into an absolute offset from Year 1 / month[0] / Week 1 / Day 1 /
// 00:00:00, then abs = epochOffset + totalGameSeconds is decomposed by the
// calendar's own (config-driven) rollover sizes.
export function deriveCalendarDate(config, totalGameSeconds) {
  const cal = config?.calendar;
  if (!cal) {
    throw new Error('WorldConfig is missing calendar');
  }

  const secondsPerDay = cal.secondsPerGameDay;
  const secondsPerWeek = secondsPerDay * cal.daysPerWeek;
  const secondsPerMonth = secondsPerWeek * cal.weeksPerMonth;
  const secondsPerYear = secondsPerMonth * cal.monthsPerYear;

  const epoch = cal.epoch;
  const epochMonthIndex = cal.monthNames.indexOf(epoch.month);
  if (epochMonthIndex === -1) {
    throw new Error(`Epoch month "${epoch.month}" is not in monthNames`);
  }
  const epochOffset =
    (epoch.year - 1) * secondsPerYear +
    epochMonthIndex * secondsPerMonth +
    (epoch.week - 1) * secondsPerWeek +
    (epoch.day - 1) * secondsPerDay +
    epoch.hour * SECONDS_PER_HOUR +
    epoch.minute * SECONDS_PER_MINUTE +
    epoch.second;

  const abs = epochOffset + totalGameSeconds;

  const secondOfDay = abs % secondsPerDay;
  const hour = Math.floor(secondOfDay / SECONDS_PER_HOUR);
  const minute = Math.floor((secondOfDay % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const second = secondOfDay % SECONDS_PER_MINUTE;

  const totalDays = Math.floor(abs / secondsPerDay);
  const day = (totalDays % cal.daysPerWeek) + 1;

  const totalWeeks = Math.floor(totalDays / cal.daysPerWeek);
  const week = (totalWeeks % cal.weeksPerMonth) + 1;

  const totalMonths = Math.floor(totalWeeks / cal.weeksPerMonth);
  const monthIndex = totalMonths % cal.monthsPerYear;
  const monthName = cal.monthNames[monthIndex];

  const year = Math.floor(totalMonths / cal.monthsPerYear) + 1;

  return { year, monthIndex, monthName, week, day, hour, minute, second };
}

// createWorldClockEngine — the engine. Same contract as the other engines: a
// named factory taking `world`, subscribing in its body, returning methods, and
// talking to nothing but `world`.
export function createWorldClockEngine(world) {
  const { config } = world.getState();
  if (!config?.timeDilation?.multipliers) {
    throw new Error('WorldConfig is missing timeDilation.multipliers');
  }
  if (!config?.calendar) {
    throw new Error('WorldConfig is missing calendar');
  }

  // Incrementally-maintained running total, PRIMED from whatever CLOCK_*
  // history the log already holds (0 on a fresh world) so the engine
  // cold-starts correctly against a loaded save. It is only ever a cache:
  // every value it holds is fully rebuildable from the log via
  // deriveTotalGameSeconds (see rebuildTotalGameSeconds), which is exactly the
  // function priming reuses — construction-time priming and the rebuild proof
  // are the same computation by definition.
  let cachedTotalGameSeconds = deriveTotalGameSeconds(config, world.getEventLog());

  world.subscribe('CLOCK_TICK', (entry) => {
    // The full entry is already in the log by the time this handler runs, so
    // deriving the active context up to this seq sees this tick's own context.
    const context = deriveActiveTimeContext(world.getEventLog(), entry.seq);
    const multiplier = config.timeDilation.multipliers[context];
    if (typeof multiplier !== 'number') {
      throw new Error(
        `No dilation multiplier configured for timeContext "${context}"`
      );
    }
    cachedTotalGameSeconds += entry.payload.realSecondsElapsed * multiplier;
    log(
      'WorldClockEngine',
      `tick +${entry.payload.realSecondsElapsed}s real ` +
        `× ${multiplier} (${context}) → ${cachedTotalGameSeconds}s game total`
    );
  });

  world.subscribe('CLOCK_JUMP', (entry) => {
    cachedTotalGameSeconds += entry.payload.gameSecondsElapsed;
    log(
      'WorldClockEngine',
      `jump +${entry.payload.gameSecondsElapsed}s game ` +
        `(flat, no multiplier) → ${cachedTotalGameSeconds}s game total`
    );
  });

  // The incrementally-cached total.
  function getTotalGameSeconds() {
    return cachedTotalGameSeconds;
  }

  // The same total, recomputed from scratch off the log — ignores the cache.
  // Must equal getTotalGameSeconds(); that equality is the rebuildability proof.
  function rebuildTotalGameSeconds() {
    return deriveTotalGameSeconds(config, world.getEventLog());
  }

  function getCurrentDate() {
    return deriveCalendarDate(config, cachedTotalGameSeconds);
  }

  function getActiveTimeContext() {
    return deriveActiveTimeContext(world.getEventLog());
  }

  return {
    getTotalGameSeconds,
    rebuildTotalGameSeconds,
    getCurrentDate,
    getActiveTimeContext,
  };
}
