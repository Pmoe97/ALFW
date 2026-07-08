// game/tickSource.js — the runtime tick SOURCE: the thing that actually turns
// the world clock during live play.
//
// This is deliberately NOT an engine. It contains no derivation logic and knows
// nothing about game-time, dilation, or the calendar — all of that lives in
// engines/worldClockEngine.js and stays there. This module does exactly one
// thing: on a real wall-clock interval, dispatch a CLOCK_TICK carrying the raw
// real-seconds elapsed. WorldClockEngine (subscribed to CLOCK_TICK) does the
// rest. Interval length and the pause-on-blur default both come from
// WorldConfig.runtime, never hardcoded here.
//
// Pause semantics are strict: pause() STOPS dispatching entirely (it clears the
// interval), rather than dispatching a zero or altered value. The browser
// harness wires pause()/resume() to tab visibility so a backgrounded tab
// freezes game-time instead of accumulating it. A Node/manual test path calls
// pause()/resume() directly.

export function createTickSource(world, config) {
  const intervalMs = config?.runtime?.tickIntervalMs ?? 1000;
  const realSecondsPerTick = intervalMs / 1000;

  let handle = null;
  let paused = false;

  // The single dispatch call — the whole point of this module. Everything else
  // just decides WHEN to call this. simulateTicks() calls it directly, so a
  // deterministic test drives the exact same code path a live interval would.
  function tickOnce() {
    world.dispatch('CLOCK_TICK', { realSecondsElapsed: realSecondsPerTick });
  }

  function start() {
    if (handle === null && !paused) {
      handle = setInterval(tickOnce, intervalMs);
    }
  }

  function stop() {
    if (handle !== null) {
      clearInterval(handle);
      handle = null;
    }
  }

  // pause() stops dispatching entirely and latches; resume() clears the latch
  // and (if it was running) resumes. This is what pause-on-blur uses.
  function pause() {
    paused = true;
    stop();
  }

  function resume() {
    paused = false;
    start();
  }

  // Deterministic "simulate N ticks" hook: fires N ticks synchronously with no
  // real interval, ignoring the pause latch (the caller is explicitly driving
  // it). Lets proof.js exercise the real dispatch path without a live timer.
  function simulateTicks(n) {
    for (let i = 0; i < n; i++) tickOnce();
  }

  return {
    start,
    stop,
    pause,
    resume,
    tickOnce,
    simulateTicks,
    realSecondsPerTick,
    get isPaused() {
      return paused;
    },
  };
}
