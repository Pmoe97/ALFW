# ALFW

A deterministic world-simulation kernel. `WorldState` is the single channel everything flows through: a merged store + event bus where engines dispatch actions and subscribe to them, and the append-only event log is the source of truth.

## Core ideas

- **One channel.** Engines never import or call each other; they only communicate by dispatching actions through the `WorldState` and subscribing to action types.
- **Append-only event log.** Every dispatched action is deep-frozen and appended to the log. Entries can't be mutated or removed, and `getState()` / `getEventLog()` return copies, never live references.
- **Derived views, not stored numbers.** State like reputation is recomputed from the event log on every call, so changing a formula is instantly reflected without touching the log.
- **Full determinism.** All randomness comes from a seeded PRNG (`world.random()`), never `Math.random()`, so a world is fully reproducible from its config plus its action sequence.

## Layout

| Path | Purpose |
| --- | --- |
| [`worldState.js`](worldState.js) | The kernel: store, event log, dispatch/subscribe, seeded RNG. No game logic. |
| [`engines/farmEngine.js`](engines/farmEngine.js) | Minimal engine proving the subscription pattern. |
| [`engines/reputationEngine.js`](engines/reputationEngine.js) | Reputation as a derived view over the event log. |
| [`worldConfig.json`](worldConfig.json) | World config: name, start time, RNG seed. |
| [`proof.js`](proof.js) | Runnable proof of the kernel's guarantees. |

## Running the proof

Zero setup — no dependencies. Requires Node.js 18+.

```sh
node proof.js
```

It exercises the dispatch/subscribe channel, verifies the event log is append-only and immutable, shows reputation as a reweightable derived view, and confirms two runs from the same config produce identical logs.

## License

[MIT](LICENSE)
