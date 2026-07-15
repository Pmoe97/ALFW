// engines/economyEngine.js — inventory, gold, shop stock, equipment, trade,
// and craft. ONE engine, deliberately: TRADE_COMPLETED moves items AND gold
// AND shop stock in a single fold, CRAFT_COMPLETED consumes and produces in a
// single fold — splitting these across engines would mean multiple
// subscribers each folding half of the same event, reintroducing exactly the
// partial-state risk the log architecture exists to forbid. (Precedent:
// poiEngine holds discovery/injection/reveal caches in one module because
// they share an event family.)
//
// Two disciplines from engines/poiEngine.js, reused verbatim:
//  - PURE derivation for the seeded baseline: deriveBaselineStock is a
//    function of (config, shopRef) alone — per-slot fresh mulberry32 seeded
//    from hashCoords, never re-rolled, independent of visit order.
//  - Log-replay + provably-redundant cache for everything that changes:
//    inventories, gold, shop deltas, and equipment are derived from the
//    append-only log; the Maps here are rebuildable accelerators, proven by
//    the rebuild* functions.
//
// Apply vs react (the memoryEngine/npcGenerator rule): the apply* handlers
// below only fold committed facts and are primed over history at
// construction. The verbs (trade/craft/equip/drop/transferItems) are REACT operations —
// they resolve everything live (stock, prices, ownership, skill gates) and
// then dispatch exactly ONE atomic outcome event carrying the full resolved
// transaction, or dispatch NOTHING. They are never primed: a loaded log
// already contains their outcomes.

import { mulberry32 } from '../worldState.js';
import { hashCoords, mapSeed, tierRank } from './worldMapEngine.js';
import { weightedPick, nodeKeys, hashString } from './poiEngine.js';
import { effectiveSkill } from '../entities/entitySchema.js';
import { getSchema } from './activeSchema.js';
import {
  getItemDef, getRecipe, AUTHORED_SHOPS, SHOPPABLE_CATEGORIES, SHOP_POOLS, EQUIP_SLOTS,
} from './economyData.js';

const GOLD_GRANTED = 'GOLD_GRANTED';
const ITEMS_GRANTED = 'ITEMS_GRANTED';
const TRADE_COMPLETED = 'TRADE_COMPLETED';
const CRAFT_COMPLETED = 'CRAFT_COMPLETED';
const EQUIP_CHANGED = 'EQUIP_CHANGED';
const ITEM_DROPPED = 'ITEM_DROPPED';
const ITEMS_TRANSFERRED = 'ITEMS_TRANSFERRED';
// Dispatched by the combat engine's consume verbs (engines/combatEngine.js).
// Folded by TWO engines into DIFFERENT caches — the CLOCK_TICK precedent, not
// a violation of the one-fold-path rule: this engine decrements the stack,
// the combat engine folds payload.effect into its vitals cache. Each cache
// still has exactly one code path writing it.
const ITEM_CONSUMED = 'ITEM_CONSUMED';

// Salt band for shop-stock draws: SHOP_STOCK_SALT + poiIndex*32 + slotIndex.
// 200000 sits far above every band in use (terrain/classification 11–4001,
// POI_POOL 60000+i, POI_EXPLORE 80000+i, NPC 100000+i, TRAVEL_INCIDENT
// 120000+legIndex), and the offset stays < 12*32+12 = 396, so shop
// randomness never correlates with any other draw.
const SHOP_STOCK_SALT = 200000;

// Guarded reader for the config.economy block (the readPoi discipline —
// fail loudly up front, not deep inside a draw).
function readEconomy(config) {
  const eco = config?.economy;
  if (!eco) throw new Error('WorldConfig is missing economy');
  if (!eco.spread) throw new Error('WorldConfig is missing economy.spread');
  if (!eco.shop) throw new Error('WorldConfig is missing economy.shop');
  return eco;
}

// ---------------------------------------------------------------------------
// Pure derivations
// ---------------------------------------------------------------------------

// priceFor — PURE. What one unit of an item costs at a shop. Flat baseValue
// spread into the shop's margin: the shop SELLS above value (ceilinged up to
// at least 1c) and BUYS below it (floored down, so the spread stays strict
// even for 1c-baseValue goods — round() on both sides would let the cheapest
// items buy and sell at the same price). shopContext ({category, tier,
// nodeId}) is unused today beyond provenance, but it is a required input ON
// PURPOSE: regional/route pricing later becomes "read more of shopContext",
// not a rearchitecture.
export function priceFor(config, itemDef, shopContext, direction) {
  const { spread } = readEconomy(config);
  if (direction === 'shopSells') return Math.max(getSchema().economy.minPrice, Math.round(itemDef.baseValue * spread.shopSellsFactor));
  if (direction === 'shopBuys') return Math.floor(itemDef.baseValue * spread.shopBuysFactor);
  throw new Error(`priceFor: unknown direction "${direction}"`);
}

// Empty-holdings constant shape. Stacks omit zero-count keys entirely (a key
// is deleted the moment it hits 0) so two holdings with the same contents are
// always deepEqual regardless of history.
function emptyHoldings() {
  return { stacks: {}, instances: [] };
}

function addStacks(stacks, delta, sign) {
  for (const [defId, qty] of Object.entries(delta ?? {})) {
    const next = (stacks[defId] ?? 0) + sign * qty;
    if (next === 0) delete stacks[defId];
    else stacks[defId] = next;
  }
}

function removeInstances(instances, ids) {
  if (!ids || ids.length === 0) return instances;
  const drop = new Set(ids);
  return instances.filter((inst) => !drop.has(inst.instanceId));
}

// Fold one entity-affecting event into a holdings object (the shared kernel
// of deriveInventory and applyies below — ONE code path for both, so priming
// and live folding cannot diverge).
function foldEntityEvent(holdings, entry, entityId) {
  const p = entry.payload;
  switch (entry.type) {
    case ITEMS_GRANTED:
      if (p.entityId !== entityId) return;
      addStacks(holdings.stacks, p.stacks, +1);
      for (const inst of p.instances ?? []) holdings.instances.push(structuredClone(inst));
      return;
    case TRADE_COMPLETED:
      if (p.actorId !== entityId) return;
      addStacks(holdings.stacks, p.gave.stacks, -1);
      addStacks(holdings.stacks, p.received.stacks, +1);
      holdings.instances = removeInstances(holdings.instances, (p.gave.instances ?? []).map((i) => i.instanceId));
      for (const inst of p.received.instances ?? []) holdings.instances.push(structuredClone(inst));
      return;
    case CRAFT_COMPLETED:
      if (p.actorId !== entityId) return;
      addStacks(holdings.stacks, p.consumed.stacks, -1);
      holdings.instances = removeInstances(holdings.instances, p.consumed.instanceIds);
      addStacks(holdings.stacks, p.produced.stacks, +1);
      for (const inst of p.produced.instances ?? []) holdings.instances.push(structuredClone(inst));
      return;
    case ITEM_DROPPED:
      if (p.entityId !== entityId) return;
      addStacks(holdings.stacks, p.stacks, -1);
      holdings.instances = removeInstances(holdings.instances, p.instanceIds);
      return;
    case ITEM_CONSUMED:
      // Consuming is dropping-with-an-effect as far as holdings go: the
      // consumed stack goes away; the effect is the combat engine's business.
      if (p.entityId !== entityId) return;
      addStacks(holdings.stacks, p.stacks, -1);
      return;
    case ITEMS_TRANSFERRED:
      // One atomic hand-off between two entities (quest deliveries): the
      // giver's side subtracts, the receiver's side adds — the same event
      // folds differently per entityId. Stacks only in v1 (deliveries are
      // stackables); instance transfer is future scope.
      if (p.fromId === entityId) addStacks(holdings.stacks, p.stacks, -1);
      else if (p.toId === entityId) addStacks(holdings.stacks, p.stacks, +1);
      return;
    default:
      return;
  }
}

// deriveInventory — PURE. An entity's holdings, replayed from the log alone.
// Instances stay in acquisition (log) order.
export function deriveInventory(log, entityId) {
  const holdings = emptyHoldings();
  for (const entry of log) foldEntityEvent(holdings, entry, entityId);
  return holdings;
}

// deriveGold — PURE. An entity's gold balance: grants plus per-trade nets.
export function deriveGold(log, entityId) {
  let gold = 0;
  for (const entry of log) {
    const p = entry.payload;
    if (entry.type === GOLD_GRANTED && p.entityId === entityId) gold += p.amount;
    else if (entry.type === TRADE_COMPLETED && p.actorId === entityId) {
      gold += (p.received.gold ?? 0) - (p.gave.gold ?? 0);
    }
  }
  return gold;
}

function emptyShopDelta() {
  return { stacks: {}, instancesAdded: [], instanceIdsRemoved: [], goldDelta: 0 };
}

// Fold one TRADE_COMPLETED into a shop delta. The shop's side is the mirror
// of the actor's: what the actor GAVE the shop gained, what the actor
// RECEIVED the shop lost. Removed instances are recorded by id only —
// applying a delta never needs the baseline.
function foldShopEvent(delta, entry, shopId) {
  if (entry.type !== TRADE_COMPLETED || entry.payload.shopId !== shopId) return;
  const p = entry.payload;
  addStacks(delta.stacks, p.gave.stacks, +1);
  addStacks(delta.stacks, p.received.stacks, -1);
  for (const inst of p.gave.instances ?? []) delta.instancesAdded.push(structuredClone(inst));
  for (const inst of p.received.instances ?? []) delta.instanceIdsRemoved.push(inst.instanceId);
  delta.goldDelta += (p.gave.gold ?? 0) - (p.received.gold ?? 0);
}

// deriveShopDeltas — PURE. Everything trades have changed about a shop,
// relative to its (re-derivable, never-logged) baseline.
export function deriveShopDeltas(log, shopId) {
  const delta = emptyShopDelta();
  for (const entry of log) foldShopEvent(delta, entry, shopId);
  return delta;
}

// shopIdOf — the stable id deltas are keyed by. POI shops use the poi id
// (already position-deterministic and unique); authored shops their record id.
export function shopIdOf(shopRef) {
  if (shopRef.kind === 'poi') return shopRef.poi.id;
  if (shopRef.kind === 'authored') return shopRef.shopId;
  throw new Error(`Unknown shopRef kind "${shopRef.kind}"`);
}

// shopContextOf — the pricing-provenance context committed in trade events.
// Authored shops have no node/tier: explicit nulls (JSON-safe), not omission,
// because the field is semantically "unknown", not "absent".
export function shopContextOf(shopRef) {
  if (shopRef.kind === 'poi') {
    return {
      category: shopRef.poi.category,
      tier: shopRef.node.classification.tier ?? null,
      nodeId: shopRef.node.id,
    };
  }
  return { category: 'authored', tier: null, nodeId: null };
}

// deriveBaselineStock — PURE. A shop's stock before any trade, a function of
// (config, shopRef) alone.
//
//  - kind 'poi' (a generated shop POI): mirrors deriveBaselinePois exactly —
//    per-slot fresh mulberry32 seeded from (mapSeed, SHOP_STOCK_SALT +
//    poiSalt*32 + slot, kx, ky), where poiSalt is poiEngine's hashString(poi.id)
//    — a hash of the POI's own content-stable id, NOT its position in the
//    pool array, so two shops at the same node still decorrelate even if the
//    pool is later resized/reordered; item picked by weightedPick over the
//    category's pool, gated by settlement tier and sorted by defId (the
//    availableCategories key-order discipline); stackables draw a quantity,
//    non-stackables mint the position-deterministic id itm_bs_<poiId>_<slot>.
//  - kind 'authored' (hand-authored shops like the Rusted Ledger): a deep
//    clone of the shipped record — static game content, like the sample-world
//    trio, deliberately NOT event-seeded (seeding a finite catalog as events
//    would double the source of truth and bloat every save).
export function deriveBaselineStock(config, shopRef) {
  if (shopRef.kind === 'authored') {
    const shop = AUTHORED_SHOPS[shopRef.shopId];
    if (!shop) throw new Error(`Unknown authored shop "${shopRef.shopId}"`);
    return { ...structuredClone(shop.stock), gold: shop.baselineGold };
  }
  if (shopRef.kind !== 'poi') throw new Error(`Unknown shopRef kind "${shopRef.kind}"`);

  const eco = readEconomy(config);
  const { node, poi } = shopRef;
  const poolName = SHOPPABLE_CATEGORIES[poi.category];
  if (!poolName) throw new Error(`POI category "${poi.category}" is not a shop`);
  const tier = node.classification.tier;
  const size = eco.shop.stockSizeByTier[tier] ?? 0;

  // Pool entries gated by tier, sorted by defId so the draw is independent of
  // declaration order, shaped for weightedPick ({name, weight}).
  const entries = SHOP_POOLS[poolName]
    .filter((e) => tierRank(tier) >= tierRank(e.minTier))
    .sort((a, b) => (a.defId < b.defId ? -1 : 1))
    .map((e) => ({ name: e.defId, weight: e.weight }));

  const stock = emptyHoldings();
  if (size <= 0 || entries.length === 0) return { ...stock, gold: eco.shop.baseGoldByTier[tier] ?? 0 };

  const seed = mapSeed(config);
  const { kx, ky } = nodeKeys(node);
  const poiSalt = hashString(poi.id);
  for (let j = 0; j < size; j++) {
    const rng = mulberry32(hashCoords(seed, SHOP_STOCK_SALT + poiSalt * 32 + j, kx, ky));
    const defId = weightedPick(entries, rng());
    if (getItemDef(defId).stackable) {
      addStacks(stock.stacks, { [defId]: 1 + Math.floor(rng() * eco.shop.maxStackQty) }, +1);
    } else {
      stock.instances.push({ instanceId: `itm_bs_${poi.id}_${j}`, itemDefId: defId, properties: {} });
    }
  }
  return { ...stock, gold: eco.shop.baseGoldByTier[tier] ?? 0 };
}

// applyDeltaToBaseline — baseline ⊕ trade deltas = current stock. Shared by
// deriveShopStock and the cached getShopStock read.
function applyDeltaToBaseline(baseline, delta) {
  const stock = structuredClone(baseline);
  addStacks(stock.stacks, delta.stacks, +1);
  stock.instances = removeInstances(stock.instances, delta.instanceIdsRemoved);
  for (const inst of delta.instancesAdded) stock.instances.push(structuredClone(inst));
  stock.gold += delta.goldDelta;
  return stock;
}

// deriveShopStock — PURE. A shop's current stock: seeded/authored baseline
// with every logged trade folded over it (the POI-discovery-over-baseline /
// faction-override-over-baseline layering pattern).
export function deriveShopStock(config, log, shopRef) {
  return applyDeltaToBaseline(deriveBaselineStock(config, shopRef), deriveShopDeltas(log, shopIdOf(shopRef)));
}

// deriveEquipped — PURE. slot -> instanceId, last-write-wins per slot over
// EQUIP_CHANGED (the deriveActiveTimeContext idiom); null clears a slot. As a
// defensive final pass, a slot whose instance the entity no longer owns is
// dropped — the verbs already refuse to trade/drop an equipped item, so this
// only matters if a future event source bypasses them.
export function deriveEquipped(log, entityId) {
  const equipped = {};
  for (const entry of log) {
    if (entry.type !== EQUIP_CHANGED || entry.payload.entityId !== entityId) continue;
    const { slot, instanceId } = entry.payload;
    if (instanceId === null) delete equipped[slot];
    else equipped[slot] = instanceId;
  }
  const owned = new Set(deriveInventory(log, entityId).instances.map((i) => i.instanceId));
  for (const slot of Object.keys(equipped)) {
    if (!owned.has(equipped[slot])) delete equipped[slot];
  }
  return equipped;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export function createEconomyEngine(world, registry) {
  const config = world.getState().config;

  // combatEngine is late-bound via setCombatEngine, not constructor-injected:
  // economy is constructed BEFORE combat (combat depends on a live economy
  // reference — equipped-item stats, loot grants — so the order can't
  // reverse). The setter is called once, immediately after combat is built,
  // before anything else can dispatch — see game/app.js and proof.js
  // slWireEngines. Guards a player-facing verb from firing while a fight is
  // open, the same belt-and-braces travel's startTravel/startExplore already
  // apply: the UI blocks navigation to these screens during combat, but the
  // engine must not trust that alone.
  let combatEngine = null;
  function setCombatEngine(engine) {
    combatEngine = engine;
  }
  function combatGuard() {
    return combatEngine?.getActiveCombat() ? { ok: false, reason: 'a combat is in progress' } : null;
  }

  // Caches — provably-redundant accelerators over the log, rebuildable via
  // the rebuild* functions below. Holdings/equipped objects are owned solely
  // by this engine; readers clone.
  const goldByEntity = new Map();
  const inventoryByEntity = new Map();
  const deltasByShop = new Map();
  const equippedByEntity = new Map();

  function holdingsOf(entityId) {
    if (!inventoryByEntity.has(entityId)) inventoryByEntity.set(entityId, emptyHoldings());
    return inventoryByEntity.get(entityId);
  }
  function deltaOf(shopId) {
    if (!deltasByShop.has(shopId)) deltasByShop.set(shopId, emptyShopDelta());
    return deltasByShop.get(shopId);
  }
  function equippedOf(entityId) {
    if (!equippedByEntity.has(entityId)) equippedByEntity.set(entityId, {});
    return equippedByEntity.get(entityId);
  }

  // --- apply handlers — the ONE cache-write path per event type. Each runs
  // once per entry's lifetime: at construction priming for entries already in
  // the log, or live via the subscriptions below — never both.

  function applyGoldGranted(entry) {
    const { entityId, amount } = entry.payload;
    goldByEntity.set(entityId, (goldByEntity.get(entityId) ?? 0) + amount);
  }

  function applyItemsGranted(entry) {
    foldEntityEvent(holdingsOf(entry.payload.entityId), entry, entry.payload.entityId);
  }

  // One function moves the actor's gold, the actor's items, AND the shop's
  // delta — a trade is atomic by construction, no partial fold possible.
  function applyTradeCompleted(entry) {
    const p = entry.payload;
    foldEntityEvent(holdingsOf(p.actorId), entry, p.actorId);
    goldByEntity.set(p.actorId, (goldByEntity.get(p.actorId) ?? 0) + (p.received.gold ?? 0) - (p.gave.gold ?? 0));
    foldShopEvent(deltaOf(p.shopId), entry, p.shopId);
  }

  function applyCraftCompleted(entry) {
    foldEntityEvent(holdingsOf(entry.payload.actorId), entry, entry.payload.actorId);
  }

  function applyEquipChanged(entry) {
    const { entityId, slot, instanceId } = entry.payload;
    const equipped = equippedOf(entityId);
    if (instanceId === null) delete equipped[slot];
    else equipped[slot] = instanceId;
  }

  function applyItemDropped(entry) {
    const p = entry.payload;
    foldEntityEvent(holdingsOf(p.entityId), entry, p.entityId);
    // Dropping an equipped item is rejected by the verb, but keep the cache
    // consistent with deriveEquipped's defensive ownership pass regardless.
    const equipped = equippedOf(p.entityId);
    const dropped = new Set(p.instanceIds ?? []);
    for (const slot of Object.keys(equipped)) {
      if (dropped.has(equipped[slot])) delete equipped[slot];
    }
  }

  // One function moves both parties — a transfer is atomic by construction,
  // exactly like applyTradeCompleted's actor+shop fold.
  function applyItemsTransferred(entry) {
    const p = entry.payload;
    foldEntityEvent(holdingsOf(p.fromId), entry, p.fromId);
    foldEntityEvent(holdingsOf(p.toId), entry, p.toId);
  }

  function applyItemConsumed(entry) {
    foldEntityEvent(holdingsOf(entry.payload.entityId), entry, entry.payload.entityId);
  }

  const APPLY = {
    [GOLD_GRANTED]: applyGoldGranted,
    [ITEMS_GRANTED]: applyItemsGranted,
    [TRADE_COMPLETED]: applyTradeCompleted,
    [CRAFT_COMPLETED]: applyCraftCompleted,
    [EQUIP_CHANGED]: applyEquipChanged,
    [ITEM_DROPPED]: applyItemDropped,
    [ITEMS_TRANSFERRED]: applyItemsTransferred,
    [ITEM_CONSUMED]: applyItemConsumed,
  };

  // Prime from whatever history the log already holds (cold-start against a
  // loaded save), then subscribe live. ONLY the apply handlers are primed —
  // the react verbs below never fold history (their outcomes are the history).
  for (const entry of world.getEventLog()) {
    APPLY[entry.type]?.(entry);
  }
  for (const [type, handler] of Object.entries(APPLY)) {
    world.subscribe(type, handler);
  }

  // --- readers (always clone; callers can never mutate a cache)

  function getGold(entityId) {
    return goldByEntity.get(entityId) ?? 0;
  }

  function getInventory(entityId) {
    return structuredClone(inventoryByEntity.get(entityId) ?? emptyHoldings());
  }

  function getEquipped(entityId) {
    return { ...equippedOf(entityId) };
  }

  function getShopStock(shopRef) {
    return applyDeltaToBaseline(
      deriveBaselineStock(config, shopRef),
      deltasByShop.get(shopIdOf(shopRef)) ?? emptyShopDelta()
    );
  }

  // --- resolveOffer — the single validation/pricing path shared by quote()
  // and trade(), so a UI that enables Confirm off a passing quote can never
  // dispatch a rejectable trade.
  //
  // offer: { buy: [{defId, qty} | {instanceId}], sell: [{defId, qty} | {instanceId}] }
  // Returns { ok, reason?, gave, received, netGold, lines } where gave/received
  // are the actor's perspective and carry FULL instance records.
  function resolveOffer(actorId, shopRef, offer) {
    const fail = (reason) => ({ ok: false, reason });
    const stock = getShopStock(shopRef);
    const inventory = getInventory(actorId);
    const equipped = getEquipped(actorId);
    const equippedIds = new Set(Object.values(equipped));
    const lines = [];

    // What the actor receives from the shop (buys), priced at shopSells.
    const received = { gold: 0, stacks: {}, instances: [] };
    let buyCost = 0;
    for (const line of offer.buy ?? []) {
      if (line.instanceId !== undefined) {
        const inst = stock.instances.find((i) => i.instanceId === line.instanceId);
        if (!inst) return fail(`the shop does not have item "${line.instanceId}"`);
        if (received.instances.some((i) => i.instanceId === inst.instanceId)) {
          return fail(`item "${line.instanceId}" is in the offer twice`);
        }
        const def = getItemDef(inst.itemDefId);
        const price = priceFor(config, def, shopContextOf(shopRef), 'shopSells');
        received.instances.push(structuredClone(inst));
        buyCost += price;
        lines.push({ kind: 'buy', key: inst.instanceId, name: def.name, qty: 1, unitPrice: price, total: price });
      } else {
        const def = getItemDef(line.defId);
        const have = stock.stacks[line.defId] ?? 0;
        if (have < line.qty) return fail(`the shop has ${have} ${def.name}, not ${line.qty}`);
        const price = priceFor(config, def, shopContextOf(shopRef), 'shopSells');
        addStacks(received.stacks, { [line.defId]: line.qty }, +1);
        buyCost += price * line.qty;
        lines.push({ kind: 'buy', key: line.defId, name: def.name, qty: line.qty, unitPrice: price, total: price * line.qty });
      }
    }

    // What the actor gives the shop (sells), priced at shopBuys.
    const gave = { gold: 0, stacks: {}, instances: [] };
    let sellValue = 0;
    for (const line of offer.sell ?? []) {
      if (line.instanceId !== undefined) {
        const inst = inventory.instances.find((i) => i.instanceId === line.instanceId);
        if (!inst) return fail(`you do not own item "${line.instanceId}"`);
        if (equippedIds.has(inst.instanceId)) return fail('cannot sell an equipped item — unequip it first');
        if (gave.instances.some((i) => i.instanceId === inst.instanceId)) {
          return fail(`item "${line.instanceId}" is in the offer twice`);
        }
        const def = getItemDef(inst.itemDefId);
        const price = priceFor(config, def, shopContextOf(shopRef), 'shopBuys');
        gave.instances.push(structuredClone(inst));
        sellValue += price;
        lines.push({ kind: 'sell', key: inst.instanceId, name: def.name, qty: 1, unitPrice: price, total: price });
      } else {
        const def = getItemDef(line.defId);
        const have = inventory.stacks[line.defId] ?? 0;
        if (have < line.qty) return fail(`you have ${have} ${def.name}, not ${line.qty}`);
        const price = priceFor(config, def, shopContextOf(shopRef), 'shopBuys');
        addStacks(gave.stacks, { [line.defId]: line.qty }, +1);
        sellValue += price * line.qty;
        lines.push({ kind: 'sell', key: line.defId, name: def.name, qty: line.qty, unitPrice: price, total: price * line.qty });
      }
    }

    if (lines.length === 0) return fail('the offer is empty');

    // Net gold from the actor's perspective; exactly one side of the trade
    // carries gold. Both parties' liquidity is finite — the shop can refuse a
    // buyout it cannot afford just as the actor can't overspend.
    const netGold = sellValue - buyCost;
    if (netGold < 0) {
      if (getGold(actorId) < -netGold) return fail(`costs ${-netGold}c, you have ${getGold(actorId)}c`);
      gave.gold = -netGold;
    } else if (netGold > 0) {
      if (stock.gold < netGold) return fail(`the shop cannot afford ${netGold}c (has ${stock.gold}c)`);
      received.gold = netGold;
    }

    return { ok: true, gave, received, netGold, lines };
  }

  // quote — pure preview for the trading UI (prices, net, validity). NEVER
  // dispatches; safe to call every render pass.
  function quote(actorId, shopRef, offer) {
    return resolveOffer(actorId, shopRef, offer);
  }

  // --- react verbs: resolve live, then commit ONE atomic outcome event or
  // NOTHING. A failed attempt leaves the log untouched.

  function trade(actorId, shopRef, offer) {
    const blocked = combatGuard();
    if (blocked) return blocked;
    const resolved = resolveOffer(actorId, shopRef, offer);
    if (!resolved.ok) return resolved;
    const entry = world.dispatch(TRADE_COMPLETED, {
      actorId,
      shopId: shopIdOf(shopRef),
      shopContext: shopContextOf(shopRef),
      gave: resolved.gave,
      received: resolved.received,
    });
    return { ok: true, entry };
  }

  function craft(actorId, stationId, recipeId) {
    const fail = (reason) => ({ ok: false, reason });
    const blocked = combatGuard();
    if (blocked) return blocked;
    const recipe = getRecipe(recipeId);
    if (recipe.stationId !== stationId) return fail(`recipe "${recipeId}" belongs to ${recipe.stationId}, not ${stationId}`);
    const actor = registry.get(actorId);
    if (!actor) return fail(`unknown entity "${actorId}"`);
    const effective = effectiveSkill(actor, recipe.skill.name);
    if (effective < recipe.skill.min) {
      return fail(`requires ${recipe.skill.name} ${recipe.skill.min}, effective is ${effective}`);
    }
    const inventory = getInventory(actorId);
    for (const [defId, qty] of Object.entries(recipe.inputs)) {
      const have = inventory.stacks[defId] ?? 0;
      const haveInstances = inventory.instances.filter((i) => i.itemDefId === defId).length;
      if (have + haveInstances < qty) {
        return fail(`needs ${qty} ${getItemDef(defId).name}, you have ${have + haveInstances}`);
      }
    }

    // Resolve consumption: stackable inputs come off the stack; non-stackable
    // inputs consume the OLDEST owned instances of that def (log order), but
    // never an equipped one.
    const equippedIds = new Set(Object.values(getEquipped(actorId)));
    const consumedStacks = {};
    const consumedInstanceIds = [];
    for (const [defId, qty] of Object.entries(recipe.inputs)) {
      const fromStack = Math.min(qty, inventory.stacks[defId] ?? 0);
      if (fromStack > 0) consumedStacks[defId] = fromStack;
      let remaining = qty - fromStack;
      for (const inst of inventory.instances) {
        if (remaining === 0) break;
        if (inst.itemDefId !== defId || equippedIds.has(inst.instanceId)) continue;
        consumedInstanceIds.push(inst.instanceId);
        remaining -= 1;
      }
      if (remaining > 0) return fail(`needs ${qty} ${getItemDef(defId).name} unequipped`);
    }

    // Mint output. nextSeq is exactly the committed entry's seq: dispatch is
    // synchronous and nothing can interleave between this read and it.
    const outDef = getItemDef(recipe.output.defId);
    const produced = {};
    if (outDef.stackable) {
      produced.stacks = { [recipe.output.defId]: recipe.output.qty };
    } else {
      const nextSeq = world.getEventLog().length;
      produced.instances = [];
      for (let k = 0; k < recipe.output.qty; k++) {
        produced.instances.push({ instanceId: `itm_${nextSeq}_${k}`, itemDefId: recipe.output.defId, properties: {} });
      }
    }

    const consumed = { stacks: consumedStacks };
    const entry = world.dispatch(CRAFT_COMPLETED, {
      actorId,
      stationId,
      recipeId,
      consumed: consumedInstanceIds.length > 0 ? { ...consumed, instanceIds: consumedInstanceIds } : consumed,
      produced,
      skill: { name: recipe.skill.name, required: recipe.skill.min, effective },
    });
    return { ok: true, entry };
  }

  function equip(entityId, slot, instanceId) {
    const fail = (reason) => ({ ok: false, reason });
    const blocked = combatGuard();
    if (blocked) return blocked;
    if (!EQUIP_SLOTS.includes(slot)) return fail(`unknown slot "${slot}"`);
    if (instanceId !== null) {
      const inst = getInventory(entityId).instances.find((i) => i.instanceId === instanceId);
      if (!inst) return fail(`you do not own item "${instanceId}"`);
      const def = getItemDef(inst.itemDefId);
      if (def.slot !== slot) return fail(`${def.name} does not fit the ${slot} slot`);
    }
    const entry = world.dispatch(EQUIP_CHANGED, { entityId, slot, instanceId });
    return { ok: true, entry };
  }

  function drop(entityId, { stacks, instanceIds } = {}) {
    const fail = (reason) => ({ ok: false, reason });
    const blocked = combatGuard();
    if (blocked) return blocked;
    const inventory = getInventory(entityId);
    const payload = { entityId };
    if (stacks && Object.keys(stacks).length > 0) {
      for (const [defId, qty] of Object.entries(stacks)) {
        const have = inventory.stacks[defId] ?? 0;
        if (have < qty) return fail(`you have ${have} ${getItemDef(defId).name}, not ${qty}`);
      }
      payload.stacks = stacks;
    }
    if (instanceIds && instanceIds.length > 0) {
      const equippedIds = new Set(Object.values(getEquipped(entityId)));
      for (const id of instanceIds) {
        if (!inventory.instances.some((i) => i.instanceId === id)) return fail(`you do not own item "${id}"`);
        if (equippedIds.has(id)) return fail('cannot drop an equipped item — unequip it first');
      }
      payload.instanceIds = instanceIds;
    }
    if (!payload.stacks && !payload.instanceIds) return fail('nothing to drop');
    const entry = world.dispatch(ITEM_DROPPED, payload);
    return { ok: true, entry };
  }

  // resolveTransferItems — PURE validation + event construction, no dispatch.
  // transferItems below is just this plus the commit. Exposed separately so a
  // composite action (questEngine's completeQuest) can build its full event
  // list up front and submit it as one world.dispatchBatch — see that
  // module's header for why front-loaded validation replaces a rollback
  // system. Returns { ok: false, reason } or { ok: true, event: { type,
  // payload } }.
  function resolveTransferItems(fromId, toId, { stacks } = {}, reason) {
    const fail = (reason_) => ({ ok: false, reason: reason_ });
    if (!stacks || Object.keys(stacks).length === 0) return fail('nothing to transfer');
    if (fromId === toId) return fail('cannot transfer to the same entity');
    const inventory = getInventory(fromId);
    for (const [defId, qty] of Object.entries(stacks)) {
      const def = getItemDef(defId);
      if (!def.stackable) return fail(`${def.name} is not stackable — instance transfer is not supported`);
      if (!Number.isInteger(qty) || qty <= 0) return fail(`invalid quantity ${qty} for ${def.name}`);
      const have = inventory.stacks[defId] ?? 0;
      if (have < qty) return fail(`you have ${have} ${def.name}, not ${qty}`);
    }
    return { ok: true, event: { type: ITEMS_TRANSFERRED, payload: { fromId, toId, stacks, reason } } };
  }

  // transferItems — one atomic hand-off of stackables between two entities
  // (the quest engine's delivery verb; there was no player→NPC item motion
  // before this — TRADE_COMPLETED is strictly player↔shop). Resolves live
  // (defs, quantities, the giver's holdings) and commits ONE event or
  // NOTHING, the trade/craft react discipline.
  function transferItems(fromId, toId, offer, reason) {
    const resolved = resolveTransferItems(fromId, toId, offer, reason);
    if (!resolved.ok) return resolved;
    const entry = world.dispatch(resolved.event.type, resolved.event.payload);
    return { ok: true, entry };
  }

  // --- thin dispatch-only mutators (seeding, quest rewards). The
  // caller supplies stacks; instance grants mint ids here from nextSeq.
  // Each has a resolve* twin (event construction, no dispatch) for the same
  // build-then-dispatchBatch reason as resolveTransferItems above.
  function resolveGrantGold(entityId, amount, reason) {
    return { type: GOLD_GRANTED, payload: { entityId, amount, reason } };
  }

  function grantGold(entityId, amount, reason) {
    const event = resolveGrantGold(entityId, amount, reason);
    return world.dispatch(event.type, event.payload);
  }

  function resolveGrantItems(entityId, { stacks, instanceDefIds } = {}, reason) {
    const payload = { entityId, reason };
    if (stacks && Object.keys(stacks).length > 0) payload.stacks = stacks;
    if (instanceDefIds && instanceDefIds.length > 0) {
      const nextSeq = world.getEventLog().length;
      payload.instances = instanceDefIds.map((defId, k) => {
        getItemDef(defId); // validate before committing (throws on an unknown id)
        return { instanceId: `itm_${nextSeq}_${k}`, itemDefId: defId, properties: {} };
      });
    }
    return { type: ITEMS_GRANTED, payload };
  }

  function grantItems(entityId, opts, reason) {
    const event = resolveGrantItems(entityId, opts, reason);
    return world.dispatch(event.type, event.payload);
  }

  // --- rebuild proofs: recompute from the log alone, ignoring every cache.
  function rebuildGold(entityId) {
    return deriveGold(world.getEventLog(), entityId);
  }
  function rebuildInventory(entityId) {
    return deriveInventory(world.getEventLog(), entityId);
  }
  function rebuildEquipped(entityId) {
    return deriveEquipped(world.getEventLog(), entityId);
  }
  function rebuildShopStock(shopRef) {
    return deriveShopStock(config, world.getEventLog(), shopRef);
  }

  return {
    getGold,
    getInventory,
    getEquipped,
    getShopStock,
    quote,
    trade,
    craft,
    equip,
    drop,
    transferItems,
    grantGold,
    grantItems,
    resolveTransferItems,
    resolveGrantGold,
    resolveGrantItems,
    rebuildGold,
    rebuildInventory,
    rebuildEquipped,
    rebuildShopStock,
    setCombatEngine,
  };
}
