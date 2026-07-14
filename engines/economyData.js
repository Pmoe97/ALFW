// engines/economyData.js — shipped economy content: item definitions, craft
// recipes, shop stock pools, and hand-authored shops. Static frozen data plus
// pure lookups; no world dependency, no dispatch, no randomness.
//
// This lives in CODE, not WorldConfig, on the npcGeneratorEngine precedent
// (VOCATIONS, appearance pools): saves embed their config verbatim, so a
// growing item catalog in config would bloat every save and turn every
// content addition into a config-drift warning. Replay safety doesn't need it
// there anyway — every committed economy event carries its full resolved
// transaction (prices, minted instance records), so historical folds never
// re-read these tables and retuning a baseValue can never rewrite history.
// Numeric TUNING (price spread, stock sizes) does live in config.economy.

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

// The nine equipment slots, exactly mirroring the Inventory screen's
// mannequin (game/ui/screens/inventory.js SLOTS). An item def's optional
// `slot` must be one of these.
export const EQUIP_SLOTS = Object.freeze([
  'head', 'necklace', 'chest', 'gloves', 'ring',
  'mainHand', 'offHand', 'legs', 'shoes',
]);

// Item definitions. `category` must be one of the UI's INVENTORY_CATEGORIES
// ids (weapons/armor/consumables/books/misc). `stackable: true` items live in
// inventories as {defId: qty} counts; non-stackable items exist as individual
// instances ({instanceId, itemDefId, properties}) so per-instance properties
// (enchantments) can be added later without a migration. `baseValue` is the
// flat worth in gold that priceFor spreads into shop buy/sell prices;
// `weight` is carry weight (display-only for now).
//
// The optional `combat` block is what the combat engine reads. Committed
// combat events carry the fully resolved numbers, so retuning these never
// rewrites history (the same replay-safety argument as baseValue above):
//   kind:'weapon'     — `skill` names the attacker's EXISTING primary skill
//                       (melee → athletics, ranged → perception); damage is
//                       damageBase + 0..damageSpread variance; ranged adds
//                       agility/4 instead of strength/4; nonlethalCapable
//                       weapons subdue at full damage, all others strike to
//                       subdue at config.combat.nonlethalDamageFactor.
//   kind:'armor'      — flat `armor` damage reduction, summed across every
//                       equipped armor piece.
//   kind:'consumable' — `heal` hp restored when consumed (ITEM_CONSUMED).
export const ITEM_DEFS = deepFreeze({
  // weapons
  iron_dagger: { id: 'iron_dagger', name: 'Iron Dagger', category: 'weapons', stackable: false, baseValue: 20, weight: 1.0, slot: 'mainHand', combat: { kind: 'weapon', skill: 'athletics', damageBase: 3, damageSpread: 3, nonlethalCapable: false } },
  iron_sword: { id: 'iron_sword', name: 'Iron Sword', category: 'weapons', stackable: false, baseValue: 60, weight: 3.5, slot: 'mainHand', combat: { kind: 'weapon', skill: 'athletics', damageBase: 5, damageSpread: 4, nonlethalCapable: false } },
  oak_staff: { id: 'oak_staff', name: 'Oak Staff', category: 'weapons', stackable: false, baseValue: 15, weight: 2.0, slot: 'mainHand', combat: { kind: 'weapon', skill: 'athletics', damageBase: 3, damageSpread: 3, nonlethalCapable: true } },
  hunting_bow: { id: 'hunting_bow', name: 'Hunting Bow', category: 'weapons', stackable: false, baseValue: 45, weight: 1.5, slot: 'mainHand', combat: { kind: 'weapon', skill: 'perception', damageBase: 4, damageSpread: 4, nonlethalCapable: false, ranged: true } },
  // armor
  leather_cap: { id: 'leather_cap', name: 'Leather Cap', category: 'armor', stackable: false, baseValue: 12, weight: 0.8, slot: 'head', combat: { kind: 'armor', armor: 1 } },
  leather_jerkin: { id: 'leather_jerkin', name: 'Leather Jerkin', category: 'armor', stackable: false, baseValue: 30, weight: 4.0, slot: 'chest', combat: { kind: 'armor', armor: 3 } },
  leather_boots: { id: 'leather_boots', name: 'Leather Boots', category: 'armor', stackable: false, baseValue: 15, weight: 1.5, slot: 'shoes', combat: { kind: 'armor', armor: 1 } },
  traveler_gloves: { id: 'traveler_gloves', name: "Traveler's Gloves", category: 'armor', stackable: false, baseValue: 8, weight: 0.4, slot: 'gloves', combat: { kind: 'armor', armor: 1 } },
  iron_shield: { id: 'iron_shield', name: 'Iron Shield', category: 'armor', stackable: false, baseValue: 40, weight: 6.0, slot: 'offHand', combat: { kind: 'armor', armor: 2 } },
  // jewelry & curios (misc)
  copper_ring: { id: 'copper_ring', name: 'Copper Ring', category: 'misc', stackable: false, baseValue: 10, weight: 0.1, slot: 'ring' },
  bone_amulet: { id: 'bone_amulet', name: 'Bone Amulet', category: 'misc', stackable: false, baseValue: 14, weight: 0.2, slot: 'necklace' },
  ring_of_embers: { id: 'ring_of_embers', name: 'Ring of Embers', category: 'misc', stackable: false, baseValue: 90, weight: 0.1, slot: 'ring' },
  glowing_amulet: { id: 'glowing_amulet', name: 'Glowing Amulet', category: 'misc', stackable: false, baseValue: 120, weight: 0.2, slot: 'necklace' },
  dice_set: { id: 'dice_set', name: 'Dice Set', category: 'misc', stackable: true, baseValue: 5, weight: 0.2 },
  playing_cards: { id: 'playing_cards', name: 'Playing Cards', category: 'misc', stackable: true, baseValue: 6, weight: 0.2 },
  // consumables
  bread: { id: 'bread', name: 'Bread Loaf', category: 'consumables', stackable: true, baseValue: 2, weight: 0.5 },
  dried_meat: { id: 'dried_meat', name: 'Dried Meat', category: 'consumables', stackable: true, baseValue: 4, weight: 0.4 },
  ale: { id: 'ale', name: 'Bottle of Ale', category: 'consumables', stackable: true, baseValue: 3, weight: 1.0 },
  healing_salve: { id: 'healing_salve', name: 'Healing Salve', category: 'consumables', stackable: true, baseValue: 18, weight: 0.3, combat: { kind: 'consumable', heal: 10 } },
  lesser_healing_potion: { id: 'lesser_healing_potion', name: 'Lesser Healing Potion', category: 'consumables', stackable: true, baseValue: 35, weight: 0.5, combat: { kind: 'consumable', heal: 20 } },
  // books
  herbal_primer: { id: 'herbal_primer', name: 'Herbal Primer', category: 'books', stackable: true, baseValue: 25, weight: 1.2 },
  dockside_ballads: { id: 'dockside_ballads', name: 'Dockside Ballads', category: 'books', stackable: true, baseValue: 12, weight: 1.0 },
  // craft materials (misc)
  iron_ore: { id: 'iron_ore', name: 'Iron Ore', category: 'misc', stackable: true, baseValue: 4, weight: 2.0 },
  iron_ingot: { id: 'iron_ingot', name: 'Iron Ingot', category: 'misc', stackable: true, baseValue: 10, weight: 1.5 },
  leather_strip: { id: 'leather_strip', name: 'Leather Strip', category: 'misc', stackable: true, baseValue: 3, weight: 0.3 },
  oak_wood: { id: 'oak_wood', name: 'Oak Wood', category: 'misc', stackable: true, baseValue: 2, weight: 1.8 },
  silverleaf_herb: { id: 'silverleaf_herb', name: 'Silverleaf Herb', category: 'misc', stackable: true, baseValue: 5, weight: 0.1 },
  spring_water: { id: 'spring_water', name: 'Spring Water', category: 'misc', stackable: true, baseValue: 1, weight: 1.0 },
  glass_vial: { id: 'glass_vial', name: 'Glass Vial', category: 'misc', stackable: true, baseValue: 6, weight: 0.2 },
  arcane_dust: { id: 'arcane_dust', name: 'Arcane Dust', category: 'misc', stackable: true, baseValue: 20, weight: 0.1 },
  soul_shard: { id: 'soul_shard', name: 'Soul Shard', category: 'misc', stackable: true, baseValue: 45, weight: 0.2 },
});

// Craft recipes. Deterministic: meeting the inputs AND the skill gate
// guarantees success — no roll, no quality variance (future depth). `skill`
// gates on effectiveSkill(actor, name) >= min. Recipe ids `bs1` and station
// ids match the UI's CRAFT_STATIONS / reserved app-state seeds.
export const RECIPES = deepFreeze({
  bs_smelt: { id: 'bs_smelt', stationId: 'blacksmith', name: 'Smelt Iron Ingot', inputs: { iron_ore: 2 }, output: { defId: 'iron_ingot', qty: 1 }, skill: { name: 'smithing', min: 4 } },
  bs1: { id: 'bs1', stationId: 'blacksmith', name: 'Forge Iron Dagger', inputs: { iron_ingot: 1, leather_strip: 1 }, output: { defId: 'iron_dagger', qty: 1 }, skill: { name: 'smithing', min: 6 } },
  bs2: { id: 'bs2', stationId: 'blacksmith', name: 'Forge Iron Sword', inputs: { iron_ingot: 2, leather_strip: 1 }, output: { defId: 'iron_sword', qty: 1 }, skill: { name: 'smithing', min: 9 } },
  al1: { id: 'al1', stationId: 'alchemy', name: 'Brew Healing Salve', inputs: { silverleaf_herb: 1, spring_water: 1 }, output: { defId: 'healing_salve', qty: 1 }, skill: { name: 'alchemy', min: 5 } },
  al2: { id: 'al2', stationId: 'alchemy', name: 'Distill Lesser Healing Potion', inputs: { silverleaf_herb: 2, glass_vial: 1 }, output: { defId: 'lesser_healing_potion', qty: 1 }, skill: { name: 'alchemy', min: 7 } },
  en1: { id: 'en1', stationId: 'enchanting', name: 'Enchant Ring of Embers', inputs: { copper_ring: 1, arcane_dust: 2 }, output: { defId: 'ring_of_embers', qty: 1 }, skill: { name: 'enchanting', min: 5 } },
  en2: { id: 'en2', stationId: 'enchanting', name: 'Bind Glowing Amulet', inputs: { bone_amulet: 1, soul_shard: 1 }, output: { defId: 'glowing_amulet', qty: 1 }, skill: { name: 'enchanting', min: 8 } },
});

// Which POI categories are vendors, and which stock pool each draws from.
// Only 'shop' carries real stock in v1; tavern/square can be added here later
// without restructuring anything.
export const SHOPPABLE_CATEGORIES = Object.freeze({ shop: 'general' });

// Baseline stock pools: what a generated shop can carry. Entries are gated by
// the shop's settlement tier (tierRank(tier) >= tierRank(minTier), the POI
// category-gating discipline) and weighted for the seeded draw. Craft-only
// outputs (ring_of_embers, glowing_amulet) are deliberately absent.
export const SHOP_POOLS = deepFreeze({
  general: [
    { defId: 'bread', weight: 5, minTier: 'hamlet' },
    { defId: 'ale', weight: 4, minTier: 'hamlet' },
    { defId: 'dried_meat', weight: 4, minTier: 'hamlet' },
    { defId: 'leather_strip', weight: 3, minTier: 'hamlet' },
    { defId: 'iron_ore', weight: 3, minTier: 'hamlet' },
    { defId: 'oak_wood', weight: 3, minTier: 'hamlet' },
    { defId: 'spring_water', weight: 3, minTier: 'hamlet' },
    { defId: 'dice_set', weight: 1, minTier: 'hamlet' },
    { defId: 'playing_cards', weight: 1, minTier: 'hamlet' },
    { defId: 'silverleaf_herb', weight: 2, minTier: 'village' },
    { defId: 'glass_vial', weight: 2, minTier: 'village' },
    { defId: 'iron_ingot', weight: 2, minTier: 'village' },
    { defId: 'iron_dagger', weight: 2, minTier: 'village' },
    { defId: 'leather_cap', weight: 2, minTier: 'village' },
    { defId: 'leather_boots', weight: 2, minTier: 'village' },
    { defId: 'traveler_gloves', weight: 2, minTier: 'village' },
    { defId: 'copper_ring', weight: 1, minTier: 'village' },
    { defId: 'bone_amulet', weight: 1, minTier: 'village' },
    { defId: 'oak_staff', weight: 1, minTier: 'village' },
    { defId: 'healing_salve', weight: 2, minTier: 'town' },
    { defId: 'leather_jerkin', weight: 2, minTier: 'town' },
    { defId: 'iron_sword', weight: 1, minTier: 'town' },
    { defId: 'iron_shield', weight: 1, minTier: 'town' },
    { defId: 'hunting_bow', weight: 1, minTier: 'town' },
    { defId: 'herbal_primer', weight: 1, minTier: 'town' },
    { defId: 'dockside_ballads', weight: 1, minTier: 'town' },
    { defId: 'lesser_healing_potion', weight: 1, minTier: 'city' },
    { defId: 'arcane_dust', weight: 1, minTier: 'city' },
    { defId: 'soul_shard', weight: 1, minTier: 'city' },
  ],
});

// Hand-authored shops — shipped-game content re-supplied at construction on
// every build/load, exactly like the Mira/Rowan/Sable trio (a save must NOT
// carry this baseline; only CHANGES to it flow through logged trades). The
// Rusted Ledger is Sable's card-and-dice house from the sample world; it is
// not a generated POI, so fabricating coordinates to feed hashCoords would
// fake position-determinism — a literal record is the honest channel.
// Instance ids use the reserved `itm_a_` (authored) prefix.
export const AUTHORED_SHOPS = deepFreeze({
  shop_rusted_ledger: {
    id: 'shop_rusted_ledger',
    name: 'The Rusted Ledger',
    ownerId: 'npc_sable',
    baselineGold: 250,
    stock: {
      stacks: { playing_cards: 4, dice_set: 6, ale: 10, bread: 4, dockside_ballads: 2, arcane_dust: 2 },
      instances: [
        { instanceId: 'itm_a_rusted_ledger_0', itemDefId: 'copper_ring', properties: {} },
        { instanceId: 'itm_a_rusted_ledger_1', itemDefId: 'bone_amulet', properties: {} },
        { instanceId: 'itm_a_rusted_ledger_2', itemDefId: 'iron_dagger', properties: {} },
      ],
    },
  },
});

export function getItemDef(defId) {
  const def = ITEM_DEFS[defId];
  if (!def) throw new Error(`Unknown item definition "${defId}"`);
  return def;
}

export function getRecipe(recipeId) {
  const recipe = RECIPES[recipeId];
  if (!recipe) throw new Error(`Unknown recipe "${recipeId}"`);
  return recipe;
}

// Recipes for a craft station, in a stable order (sorted by id) so the UI
// list and any seeded iteration are independent of declaration order.
export function recipesForStation(stationId) {
  return Object.keys(RECIPES).sort()
    .map((id) => RECIPES[id])
    .filter((r) => r.stationId === stationId);
}
