# Field Classification Audit — Vintage-Locked vs. Live-Formula

Scope: every `derive*`/`rebuild*`/`effective*`/`calculate*`/`resolve*` function (plus
a few `get*`/verb-embedded formulas that clearly belong to the same family) across
`engines/*.js` and `entities/*.js`, evaluated against the classification test in the
task brief. Analysis only — no code was changed.

Files reviewed that had **zero** functions referencing a tunable constant (and so
have no section below): `engines/combatData.js`, `engines/economyData.js`,
`engines/questEngine.js` + `engines/questData.js`, `engines/memoryEngine.js`,
`engines/factionEngine.js`, `engines/farmEngine.js`, `entities/raceRegistry.js`,
`entities/fieldSchema.js`, `entities/entityRegistry.js`. Details on why each was
skipped are in the Summary.

---

## entitySchema.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `effectiveSkill` | `2` (attribute divisor: `raw + floor(attr / 2)`) | 206 | **AMBIGUOUS** | The identical formula is invoked both from pure live accessors (game/ui/model.js character-sheet and craft-gate display) and from call sites whose result is baked straight into a dispatched payload (combatEngine's `deriveMaxHp`/`initiativeOf`/`resolveRound` hit math → `COMBAT_STARTED`/`COMBAT_ROUND_RESOLVED`; economyEngine's `craft()` → `CRAFT_COMPLETED.skill.effective`), so the same constant is simultaneously live everywhere it's read fresh and permanently baked wherever a caller commits its output. | high |

---

## deriveEmotion.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `deriveNetValence` | `MEMORY_VALENCE` {PLAYER_HELPED:2, PLAYER_ROBBED:-4, PLAYER_IGNORED:-1}, `RECENCY_WINDOW`=5, decay exponent 2 in `1/(k*k)` | 26-30, 37, 110 | LIVE-FORMULA | Never dispatched — consumed only by dialogue-prompt building; doc states "recomputed fresh every turn... nothing is written back anywhere." | high |
| `deriveEmotion` | `NEUTRAL_BASE`=0.6, `INTENSITY_BANDS` (1.0/2.5/Infinity), `EMOTIONS` propensity coefficients (0.8/0.6/0.7/0.4/0.5/etc per emotion), expressiveness `1 + 0.3*extraversion` | 40-44, 68-86, 90, 145, 153 | LIVE-FORMULA | Same reasoning as `deriveNetValence` — a pure per-turn read, never cached or stored, and explicitly documented as never written back anywhere. | high |

---

## relationshipStore.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `relationshipTier` | divergence thresholds (`affection>=40 && trust<=0`, `affection<=0 && obedience>=40`), average divisor `5`, `TIER_THRESHOLDS` ladder (-10/10/30/60/Infinity) | 236-242, 259-260, 263 | LIVE-FORMULA | Doc states outright "Relationship tier is always derived from stats, never stored. Recompute it any time the stats change" and calls the thresholds "Provisional first pass only... adjust cutoffs here as needed"; the tier value is never embedded in any dispatched payload (`RELATIONSHIP_EVENT` only carries axis/delta/weight), and questEngine imports the same `TIER_THRESHOLDS` for its own live gate check. | very high |

---

## voice.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `deriveVoiceDirectives` | `HIGH_THRESHOLD`=7, `LOW_THRESHOLD`=3, `MAX_DIRECTIVES`=3 | 82-84 | VINTAGE-LOCKED | Both this file's doc ("Generated ONCE at NPC creation... NEVER recomputed, never re-rolled") and the sole caller's doc (npcGeneratorEngine.deriveNpc step 14) agree explicitly that the result is a permanent birth trait embedded in `psychology.voice.directives`, which is part of the NPC snapshot committed via `NODE_POPULATED`. | very high |

---

## conversationHistoryStore.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `getRecentHistory` (doesn't match derive*/etc. naming but is the direct analog — a formula constant windowing stored data) | `RECENT_EXCHANGES_WINDOW`=4 | 49, 51-53 | LIVE-FORMULA | Doc: "Provisional first-pass balance, retune here freely"; called live every time a dialogue prompt is built, never dispatched — a schema change would immediately change how much prior conversation is visible for every existing pair's history, not just new ones. | high |

---

## combatEngine.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `deriveMaxHp` | `2` (toughness multiplier: `2*toughness + effectiveSkill(fortitude)`) | 88 | **AMBIGUOUS** | The same formula is called both inside `deriveEncounter`/`dispatchStart`, where the result is baked verbatim into `COMBAT_STARTED.combatants[].maxHp`, and inside `getVitals()`'s live fallback for any entity not yet in combat, which recomputes fresh on every call — one caller vintage-locks it, the other never does. | high |
| `deriveEncounter` | `MAX_ENEMIES` (combatData.js, loop bound / dual-purpose RNG-stride cap and enemy-count cap) | 189 | VINTAGE-LOCKED | Result flows straight into `dispatchStart` → `world.dispatch(COMBAT_STARTED, payload)`; medium-high because the constant also serves a structural RNG-stride role, but either way its effect is committed at dispatch. | medium |
| `resolveRound` | `c.hitBase`, `c.hitPerSkillPoint`, `c.hitFloor`, `c.hitCeiling`, ranged/melee attribute bonus divisor `4`, minimum-damage floor `1`, `c.nonlethalDamageFactor` | 336, 340, 342-343 | VINTAGE-LOCKED | `resolveRound` is only ever called from `act()` immediately before `world.dispatch(COMBAT_ROUND_RESOLVED, {actions: result.actions, hpAfter: result.hpAfter, ...})` — the function's return fields ARE the dispatch payload. | high |
| `resolveRound` (flee branch) | `c.fleeBaseChance`, `c.fleePerAgilityPoint`, clamp bounds `0.05`/`0.95` | 369 | VINTAGE-LOCKED | Same call chain as above — the flee outcome is folded into the same committed `COMBAT_ROUND_RESOLVED` entry. | high |

Excluded as structural (RNG stream-separation salts, explicitly documented as such): `COMBAT_SALT`, `COMBAT_SALT_STRIDE` (combatData.js).

---

## economyEngine.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `priceFor` | `spread.shopSellsFactor`, `spread.shopBuysFactor`, minimum-price floor `1` | 80-81 | **AMBIGUOUS** | `quote()` calls `resolveOffer→priceFor` and is documented "NEVER dispatches; safe to call every render pass" (live), while `trade()` calls the identical `resolveOffer→priceFor` and then dispatches `TRADE_COMPLETED` with the priced `gave`/`received` amounts baked in — the same formula is simultaneously a live preview and, once traded, a permanent historical price. | high |
| `deriveBaselineStock` | `eco.shop.stockSizeByTier[tier]`, `eco.shop.baseGoldByTier[tier]`, `eco.shop.maxStackQty` | 250, 260, 266-269 | LIVE-FORMULA | Never dispatched — only trade *deltas* are logged (`TRADE_COMPLETED`); `getShopStock`/`quote` recompute the baseline from current config on every call, so a schema change reshapes every shop's baseline stock immediately, even at long-visited shops. | high |
| `craft()` → `effectiveSkill` | `2` (entitySchema.js divisor, called at line 576) | 576, 629 | VINTAGE-LOCKED | The computed `effective` value is stored verbatim as `CRAFT_COMPLETED.skill.effective`; see entitySchema.js's AMBIGUOUS entry for the fuller picture — this is specifically the call site that commits the number to history. | high |

Excluded as structural: `32`-wide per-slot stride inside `SHOP_STOCK_SALT + poiIndex*32 + j` (RNG stream separation).

---

## npcGeneratorEngine.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `derivePopulationSize` | `population.settlement.populationByTier`, `w.base`, `w.notabilityPopScale`, `w.hospitabilityPopScale`, `w.maxPopulation` | 221, 225-228 | VINTAGE-LOCKED | Only ever called from `deriveNpcRoster → populateNode → world.dispatch(NODE_POPULATED, {npcs: roster})`; the roster size becomes a permanent birth-record fact — toggling config afterward "never mutates, deletes, or rerolls anyone already committed" per the file's own doc. | high |
| `deriveNpc` (personality axes) | jitter magnitude `2`, clamp `[0,10]` | 330 | VINTAGE-LOCKED | Embedded directly in the NPC object returned by `deriveNpc`, which is collected into the roster array dispatched via `NODE_POPULATED`. | high |
| `deriveNpc` (attributes) | `8 + floor(rng*8)` → range 8-15 | 337 | VINTAGE-LOCKED | Same flow as above. | high |
| `deriveNpc` (primary skills) | `floor(rng*5)` → range 0-4 | 339 | VINTAGE-LOCKED | Same flow as above. | high |
| `deriveNpc` (secondary skills) | `floor(rng*3)` → range 0-2 | 341 | VINTAGE-LOCKED | Same flow as above. | high |
| `deriveNpc` (distinguishing features) | `pickInt(rng, 0, 2)` | 313 | VINTAGE-LOCKED | Same flow as above (minor). | high |
| `deriveSchedulePattern` | nocturnal-guard-shift threshold `0.5`, tavern-evening threshold `0.5` | 438, 449 | VINTAGE-LOCKED | Called exactly once from `deriveNpc` step 15; its return value (the schedule array) is embedded in the NPC snapshot dispatched via `NODE_POPULATED` — doc: "the permanent 4-entry schedule pattern... riding the birth snapshot." | high |

Excluded as structural: `NPC_SALT` (documented RNG stream-separation salt). Skipped (zero constants): `deriveScheduleState` — the LIVE, never-stored counterpart to `deriveSchedulePattern`, but its body has no numeric literal (only string comparisons).

---

## poiEngine.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `deriveBaselinePois` (incl. internal `poolSizeFor`) | `poi.settlement.poolSizeByTier`, `w.base`, `w.notabilityPoolScale`, `w.hospitabilityPoolScale`, `w.maxPoolSize`, `poi.hiddenChance` | 130-139, 162 | LIVE-FORMULA | Never dispatched — doc says "derived lazily," and `poolFor()`/`getPoiState()` recompute the full baseline pool fresh on every call; only specific discovered/injected POI ids are logged, not the pool's composition. Worth flagging: because `POI_DISCOVERED` logs only a positional id like `poi_<nodeId>_b3`, a schema change that shrinks/reshuffles pool size could desync an already-discovered id from the freshly re-derived pool on replay. | high |
| `deriveBlindExploreOutcome` | `poi.explore.baseExploreSuccessChance` | 256 | VINTAGE-LOCKED | Its only caller, `exploreBlind()`, dispatches `POI_EXPLORED` unconditionally and then, on success, dispatches `POI_DISCOVERED` with the resolved id — the roll's outcome becomes permanent history and is never re-rolled on replay. | high |

Excluded as structural: `POI_POOL_SALT`, `POI_EXPLORE_SALT` (documented RNG stream-separation salts).

---

## travelEngine.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `deriveActiveActivity` | `config.timeDilation.multipliers[context]` | 201, 371 | LIVE-FORMULA | `CLOCK_TICK` stores only raw `realSecondsElapsed`; both the live `applyClockTick` fold and `rebuildActiveActivity`'s full-log replay multiply it by the *current* config's per-context multiplier — mirrors worldClockEngine's `deriveTotalGameSeconds`, whose own comment confirms this is deliberate recompute-at-fold-time, not replay-of-baked-deltas. Blast radius is limited to whichever activity is currently open (the leg's `durationGameSeconds` is separately vintage-locked, see below). | high |
| `deriveTravelIncident` | `inc.incidentChance`, `inc.categories`/`inc.intensityWeights` weighted tables, `inc.turnIntensityByCategory[category]` threshold, flavor coinflip `0.5` | 255, 259-262, 270 | VINTAGE-LOCKED | Sole caller `reactTravelStarted` builds the dispatched payload directly from this function's return value and dispatches `TRAVEL_INCIDENT` immediately — doc: "commits every fact the moment travel starts." | high |
| `startTravel` → duration calc (doesn't match derive*/etc. naming, but the direct verb-embedded analog) | `travel.gameSecondsPerDistanceUnit` | 558 | VINTAGE-LOCKED | Computed once and stored as `ACTION_TRAVEL_STARTED.durationGameSeconds`; `deriveActiveActivity` only ever reads that stored field back, never recomputes it from distance. | high |

Excluded as structural: `TRAVEL_INCIDENT_SALT` (RNG salt); the `/60` minutes conversion in `buildNarrationPrompt` (unit conversion, not balance).

---

## worldMapEngine.js

This entire file is **LIVE-FORMULA** with no vintage-locked functions at all — the
single most consequential finding in this audit for the eventual ModManager work.
The one event this engine dispatches, `MAP_NEIGHBORS_MATERIALIZED`, carries only
`{nodeId}`; it never stores terrain, classification, or edge geometry. Every node's
full terrain, classification, and connectivity is *recomputed from the current
config* on every engine construction (cold-start priming) and every live
`materializeNeighbors` call. The file's own comments confirm this design intent
verbatim: "nothing to replay... never a second source of truth... regenerating at
the same coordinates yields identical results." A schema change would retroactively
reshape the entire explored map (terrain types, passability, settlement placement,
faction baseline, edges) the next time the log is replayed.

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `deriveTerrainAt` | `FALLOFF_BAND`=0.2, `t.noiseScale`, `t.octaves`, `t.falloffScale`, `t.waterLevel`, `t.cliffLevel`, `t.deepWaterLevel`, `t.denseForestMoisture`, `t.forestMoisture`, `t.hillsLevel` | 202-256 | LIVE-FORMULA | Pure function of `(config, x, y)`; never dispatched with its own data, only recomputed via `deriveNodeAt` on every replay/materialize. | high |
| `deriveHospitability` | `HOSPITABILITY_TYPE_BASE` table, `HOSPITABILITY_PROBES`=8, weights `0.55`/`0.25`/`0.2` | 279-314 | LIVE-FORMULA | Feeds `deriveClassificationAt`'s wilderness `hospitability` field and settlement-site suitability, neither of which is ever stored beyond a bare `nodeId`. | high |
| `deriveNotability` | `env.notabilityNoiseScale`, `env.notabilityRarityExponent` | 326-327 | LIVE-FORMULA | Same flow as `deriveHospitability` — embedded in classification, never dispatched raw. | high |
| `deriveBaselineFactionControl` | `f.territoryNoiseScale`, `f.uncontrolledThreshold`, `f.factionCount` | 340-344 | LIVE-FORMULA | The baseline itself always recomputes live; factionEngine.js can layer a logged `FACTION_CONTROL_CHANGED` override on top per-settlement, but that's a separate, already-covered vintage-locked mechanism — this function only ever computes the un-overridden default. | high |
| `deriveSettlementSiteInCell` (+ `settlementSpacingOf`/`isSettlementSiteAccepted`) | `s.suitabilityThreshold`, `s.tierNoiseScale`, `s.tierThresholds`, `s.minSpacing`, `s.tierSpacingMultiplier` | 379, 421, 423-424, 481 | LIVE-FORMULA | Determines whether a settlement candidate is accepted/suppressed; never logged — only the resulting node's bare id ever reaches an event. | high |
| `deriveClassificationAt` | `s.snapRadius` | 505 | LIVE-FORMULA | The umbrella classification function; same never-stored reasoning as its sub-derivations above. | high |
| `generateNeighborCandidates` | `wm.baseInterNodeDistance`, `wm.distanceJitter`, `wm.angleJitterDegrees` | 550-552 | LIVE-FORMULA | `MAP_NEIGHBORS_MATERIALIZED` logs only `{nodeId}` — the actual candidate positions/edges are recomputed from scratch on every replay via this function, so a schema change reshapes the entire explored graph's geometry retroactively. | very high |
| `reconcileNeighbors` (doesn't match derive*/etc. naming, but is the core per-node replay path worth flagging) | `wm.reconciliationToleranceRadius` | 774 | LIVE-FORMULA | Runs on every cold-start prime and every live materialization, deciding whether a candidate merges with an existing node or creates a new one — never itself logged. | high |
| `findSettlementAdjacentOrigin` | hop distance `s.snapRadius + (wm.baseInterNodeDistance ?? 10) * 0.6` | 676 | LIVE-FORMULA | Only affects the initial landing spot, computed fresh at every engine construction; never dispatched or stored. | medium-high |

Excluded as structural (hash/noise-algorithm internals, not balance): `hashCoords`'s mixing constants (`0x9e3779b9` etc.), `fade()`'s polynomial coefficients, `fbm`'s octave step (`0.5`/`2`, `salt*131`), and the `CHANNEL_*`/`CANDIDATE_SALT`/`SETTLEMENT_SITE_SALT` RNG stream-separation salts.

Noted but **not** tabled — genuinely uncertain whether tunable or structural, flagging per instructions rather than dropping: `ORIGIN_SEARCH_STEP`=1 / `ORIGIN_SEARCH_ANGLES`=12 / `ORIGIN_SEARCH_MAX_RADIUS`=10000 (`findPassableOrigin`) and `LANDING_SEARCH_RINGS`=80 / `LANDING_PLACE_ANGLES`=16 (`findSettlementAdjacentOrigin`) — these bound a deterministic spiral/ring search for a passable or settlement-adjacent coordinate. They read more like search-resolution/perf knobs than balance constants, but a coarser or finer search could land on a different exact coordinate near a boundary.

---

## worldClockEngine.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `deriveTotalGameSeconds` | `config.timeDilation.multipliers[context]` | 71, 77 | LIVE-FORMULA | This is the canonical, self-documented instance of the "cached value whose rebuild function re-applies the constant during the fold" pattern flagged as the hard case — the code's own comment states outright "the multiplier is applied at derivation time, so retuning a multiplier in WorldConfig changes the rebuilt result," and both the live subscription handler and `rebuildTotalGameSeconds` apply the current multiplier to raw stored `realSecondsElapsed`. | very high |
| `deriveCalendarDate` | `cal.secondsPerGameDay`, `cal.daysPerWeek`, `cal.weeksPerMonth`, `cal.monthsPerYear`, `cal.epoch.*` | 97-114 | LIVE-FORMULA | Pure function of `(config, totalGameSeconds)`, never dispatched; only ever read live via `getCurrentDate()` — a calendar-shape change remaps the same `totalGameSeconds` to a different date project-wide. | high |
| `deriveTimeOfDayBucket` | hour boundaries `5`/`12`/`18`/`22` | 154-157 | LIVE-FORMULA | Doc notes these are code constants (not yet config) called live by npcGeneratorEngine's `deriveScheduleState` (itself never stored) — a plausible future schema-configurable threshold. | high |

Excluded as structural: `SECONDS_PER_HOUR`=3600, `SECONDS_PER_MINUTE`=60 (unit conversions).

---

## reputationEngine.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `getReputation` | `weightPerQuality` default `2` | 15 | LIVE-FORMULA | File header states explicitly: "Reputation is never a stored number... recomputed from the event log on every call, so changing the weighting formula is instantly reflected without touching the log." | very high |

---

## relationshipEffectEngine.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `applyDelta` / `ACTION_DELTAS` | `PLAYER_HELPED` {affection:5, comfort:3, trust:5, desire:0, obedience:-1}, `PLAYER_ROBBED` {-15,-10,-20,0,-5}, `PLAYER_IGNORED` {-1,-1,0,0,0} | 11-15 | VINTAGE-LOCKED | `applyDelta` is a pure react subscriber — never primed over history at construction, only `world.subscribe` — that fires once per fresh `PLAYER_HELPED`/`ROBBED`/`IGNORED` dispatch and calls `relationships.recordRelationshipEvent(..., amount)` with the delta already baked in; the resulting `RELATIONSHIP_EVENT.amount` is what gets replayed forever after (relationshipStore only ever sums stored amounts, never re-reads `ACTION_DELTAS`). | high |

---

## weather.js

| Function | Constant(s) | Line(s) | Classification | Reasoning (1 sentence) | Confidence |
|---|---|---|---|---|---|
| `deriveWeatherAt` / `weatherTableFor` | `DEFAULT_SEASON_WEATHER` per-season weight tables, `GENERIC_WEATHER` fallback weights (plus `config.weather.seasons` authored weights when present) | 24-30, 34-38 | LIVE-FORMULA | Doc states outright "it needs NO event log and dispatches nothing"; `weatherForLocation` recomputes fresh from the live clock's current date every call, never cached or stored. | very high |
| `dayIndexFrom` | `86400` fallback default for `calendar.secondsPerGameDay` | 67 | LIVE-FORMULA | Only matters when the config value is absent; otherwise a passthrough — recomputed live every call regardless. | medium |

Excluded as structural: `WEATHER_SALT` (RNG stream-separation salt).

---

## Summary

**Totals** (by function-constant row, not by individual constant):

| Classification | Rows |
|---|---|
| AMBIGUOUS | 3 |
| LIVE-FORMULA | 22 |
| VINTAGE-LOCKED | 16 |
| **Total** | **41** |

**AMBIGUOUS (review these first):**
1. `entitySchema.js: effectiveSkill` — the "2" attribute divisor is live everywhere it's read fresh (UI, gates) but permanently baked wherever a caller's dispatch commits its output (combat rounds, craft records).
2. `combatEngine.js: deriveMaxHp` — the "2" toughness multiplier is vintage-locked when baked into `COMBAT_STARTED`, but live when `getVitals()` falls back for an out-of-combat entity.
3. `economyEngine.js: priceFor` — the shop spread factors are a live preview via `quote()` but permanently committed via `trade()`.

**Files with zero qualifying functions** (reviewed, no rows — reasons noted in each file's read-through, summarized here):
- `combatData.js`, `economyData.js`, `questData.js` — static content tables with pure `get*` lookups; no formula combines a raw field with a constant.
- `questEngine.js` — all "reward" numbers are per-quest authored content passed straight through, not a shared formula constant.
- `memoryEngine.js` — text templates only, no numeric constants.
- `factionEngine.js` — pure last-write-wins string resolution.
- `farmEngine.js` — subscription-pattern stub, no formula.
- `raceRegistry.js` — pure field replay from event payloads, not a formula.
- `fieldSchema.js` — structural diff/merge resolution (value vs. shape overrides), no balance formula.
- `entityRegistry.js` — plain id→entity map.

**Genuinely stuck (constants found but flow undetermined):** none. Every constant in
scope was traced to a clear dispatch-vs-live flow, or explicitly flagged AMBIGUOUS
(with the specific dual call-site reasoning above) or excluded as structural
(RNG stream-separation salts, hash/noise-algorithm internals, unit conversions) —
see each file's "Excluded as structural" note for the specific constants and why.

**Worth flagging for the next planning step** (factual, not a ModManager
recommendation): `worldMapEngine.js` is entirely LIVE-FORMULA — the whole explored
map (terrain, classification, settlement placement, edges) is recomputed from
current config on every load, with only bare `nodeId`s logged. `poiEngine.js`'s
baseline pool composition is similarly live-recomputed while individual discoveries
are logged by positional id (`poi_<nodeId>_b3`) — a pool-size/shape change could
desync an already-discovered id from a freshly re-derived pool. Both are worth a
close look whichever way the mod-stack/hot-swap design goes.
