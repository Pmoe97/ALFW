// ai/queueManager.js — concurrency scheduler for all AI plugin calls.
//
// Every AI call in the game (text today, image later) routes through here.
// The manager knows nothing about what a request's run() does — it only
// decides WHEN work starts, given per-type slot limits and the
// foreground/background split below.
//
// Why a hard background cap exists: the Perchance transport has no abort.
// Once a call is submitted it cannot be cancelled, so if background work
// were ever allowed to fill every slot, a sudden foreground burst (the
// player talking to someone) would have to wait out whole in-flight calls.
// Capping background at ceil(maxConcurrent / 3) guarantees foreground
// headroom is available the instant it's needed — even when foreground is
// completely idle, background may never grow past its cap.
//
// Scheduling is deterministic: given a known sequence of enqueues and
// completions, admission order is a pure function of (category, priority,
// arrival order). No randomness, no clock reads in the decision path.

const TYPES = ['text', 'image'];
const CATEGORIES = ['foreground', 'background'];
const DEFAULT_MAX_CONCURRENT = 9;

/**
 * @param {{ text?: { maxConcurrent?: number }, image?: { maxConcurrent?: number } }} [config]
 */
export function createQueueManager(config = {}) {
  // Per-type state; 'text' and 'image' are scheduled fully independently.
  const state = {};
  for (const type of TYPES) {
    const maxConcurrent = config[type]?.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    state[type] = {
      maxConcurrent,
      backgroundCap: Math.ceil(maxConcurrent / 3),
      activeForeground: 0,
      activeBackground: 0,
      pending: { foreground: [], background: [] },
    };
  }

  function canAdmit(typeState, category) {
    if (typeState.activeForeground + typeState.activeBackground >= typeState.maxConcurrent) {
      return false;
    }
    // Hard ceiling: background may never exceed its cap, even when
    // foreground is idle (see the header comment for why).
    if (category === 'background' && typeState.activeBackground >= typeState.backgroundCap) {
      return false;
    }
    return true;
  }

  // Pull the next request from a pending queue: highest priority first,
  // FIFO among equals (strict > keeps the earliest arrival on ties, since
  // the array is in arrival order).
  function takeNext(queue) {
    if (queue.length === 0) return null;
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      if (queue[i].priority > queue[best].priority) best = i;
    }
    return queue.splice(best, 1)[0];
  }

  // Re-evaluate admission for a type. Called on every enqueue and every
  // slot-free (completion, failure, or timeout). Foreground is always
  // admitted ahead of background whenever both have pending work.
  function drain(type) {
    const typeState = state[type];
    for (const category of CATEGORIES) {
      while (typeState.pending[category].length > 0 && canAdmit(typeState, category)) {
        start(type, typeState, category, takeNext(typeState.pending[category]));
      }
    }
  }

  function start(type, typeState, category, request) {
    if (category === 'foreground') typeState.activeForeground++;
    else typeState.activeBackground++;

    // Guards this request's single settlement. Once true, every later
    // signal (the timer, or run()'s real settlement) is ignored.
    let settled = false;
    let timer = null;

    function freeSlot() {
      if (category === 'foreground') typeState.activeForeground--;
      else typeState.activeBackground--;
      drain(type);
    }

    if (request.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        // Timeout means "we stop waiting" — the underlying call CANNOT be
        // cancelled on this transport and is likely still running. We free
        // only the LOGICAL slot so other work can be admitted; real
        // in-flight calls may therefore transiently exceed maxConcurrent.
        // That is inherent to an uncancellable transport and accepted by
        // design — the alternative (holding the slot) would let one slow
        // call starve the whole queue.
        freeSlot();
        // No fallbackValue → the clearly-shaped failure result: callers
        // detect it via timedOut and result === undefined.
        request.resolve({
          result: request.hasFallback ? request.fallbackValue : undefined,
          usedFallback: true,
          timedOut: true,
        });
      }, request.timeoutMs);
    }

    let runPromise;
    try {
      runPromise = Promise.resolve(request.run());
    } catch (err) {
      // A synchronously-throwing run() behaves like an immediate rejection.
      runPromise = Promise.reject(err);
    }

    // THE single most important correctness property of this file: both a
    // fulfillment AND a rejection handler are attached to run()'s promise
    // here, unconditionally, at admission time. If the timeout already won,
    // the `settled` guard makes this late settlement a no-op — it is
    // absorbed. run()'s promise therefore can NEVER produce an unhandled
    // rejection, and can never alter a result we already handed back.
    runPromise.then(
      (result) => {
        if (settled) return; // late resolution after timeout — absorbed
        settled = true;
        if (timer !== null) clearTimeout(timer);
        freeSlot();
        request.resolve({ result, usedFallback: false, timedOut: false });
      },
      (err) => {
        if (settled) return; // late rejection after timeout — absorbed
        settled = true;
        if (timer !== null) clearTimeout(timer);
        freeSlot();
        if (request.hasFallback) {
          request.resolve({ result: request.fallbackValue, usedFallback: true, timedOut: false });
        } else {
          // The ONLY path that rejects the caller's promise: run() failed,
          // no timeout fired first, and no fallbackValue was provided —
          // the caller has opted to handle failure itself.
          request.reject(err);
        }
      }
    );
  }

  /**
   * Enqueue a unit of AI work.
   *
   * Settlement semantics of the returned promise:
   * - run() resolves before any timeout
   *     → resolves { result, usedFallback: false, timedOut: false }
   * - timeoutMs elapses first, fallbackValue provided
   *     → resolves { result: fallbackValue, usedFallback: true, timedOut: true }
   * - timeoutMs elapses first, no fallbackValue
   *     → resolves { result: undefined, usedFallback: true, timedOut: true }
   * - run() rejects (no timeout fired), fallbackValue provided
   *     → resolves { result: fallbackValue, usedFallback: true, timedOut: false }
   * - run() rejects (no timeout fired), no fallbackValue
   *     → REJECTS with run()'s error — the only rejection path
   * - no timeoutMs at all → waits indefinitely for run() to settle.
   *
   * @param {Object} spec
   * @param {'text'|'image'} spec.type
   * @param {'foreground'|'background'} spec.category
   * @param {() => Promise<*>} spec.run - the actual work; opaque to the queue
   * @param {number} [spec.priority=0] - higher admits first within the
   *   category's queue; ties break FIFO by arrival order
   * @param {number} [spec.timeoutMs] - how long to wait before giving up on
   *   run() (which keeps running regardless — see start())
   * @param {*} [spec.fallbackValue] - resolved as the result on timeout or
   *   failure when provided
   * @returns {Promise<{result: *, usedFallback: boolean, timedOut: boolean}>}
   */
  function enqueue({ type, category, run, priority = 0, timeoutMs, fallbackValue }) {
    if (!TYPES.includes(type)) {
      throw new Error(`Unknown queue type "${type}"`);
    }
    if (!CATEGORIES.includes(category)) {
      throw new Error(`Unknown queue category "${category}"`);
    }
    if (typeof run !== 'function') {
      throw new Error('enqueue requires a run() function');
    }
    return new Promise((resolve, reject) => {
      state[type].pending[category].push({
        run,
        priority,
        timeoutMs,
        fallbackValue,
        // Distinguishes "no fallback" from "fallback of undefined-ish".
        hasFallback: fallbackValue !== undefined,
        resolve,
        reject,
      });
      drain(type);
    });
  }

  // Introspection for proof.js — enough to assert scheduler correctness.
  function getCounts(type) {
    const typeState = state[type];
    return {
      activeForeground: typeState.activeForeground,
      activeBackground: typeState.activeBackground,
      pendingForeground: typeState.pending.foreground.length,
      pendingBackground: typeState.pending.background.length,
    };
  }

  return { enqueue, getCounts };
}
