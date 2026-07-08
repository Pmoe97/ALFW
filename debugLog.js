// debugLog.js — a small foundation for independently-toggleable console
// channels, so bug-hunting can target one subsystem's output instead of
// sifting through everything at once.
//
// This is orthogonal to game state on purpose: toggling a channel only ever
// changes whether log() calls console.log — it never touches dispatch, the
// event log, or anything derived from it. Silencing WorldClockEngine's tick
// spam, for example, does not slow, skip, or alter a single tick; the clock
// keeps advancing exactly as before, just quietly.
//
// Any string is a valid channel — nothing needs to be registered up front.
// An unrecognized channel defaults to enabled, so nothing already logging
// today goes silent by accident; only channels named here start disabled.
const DEFAULT_DISABLED_CHANNELS = [
  'WorldClockEngine', // by far the noisiest: one line per CLOCK_TICK, and
                      // ticks fire once a second during live play.
];

const disabledChannels = new Set(DEFAULT_DISABLED_CHANNELS);

export function setChannelEnabled(channel, enabled) {
  if (enabled) disabledChannels.delete(channel);
  else disabledChannels.add(channel);
}

export function isChannelEnabled(channel) {
  return !disabledChannels.has(channel);
}

export function log(channel, ...args) {
  if (!disabledChannels.has(channel)) {
    console.log(`[${channel}]`, ...args);
  }
}
