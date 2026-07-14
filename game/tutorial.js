// game/tutorial.js — the first-fight tutorial controller. After the walkthrough,
// a single weak bandit ambush starts (the real combat engine, tmpl_bandit_ambush).
// There is NO real fail state — just two flavors of arrival:
//   * the player wins the fight outright, or
//   * they are driven to the brink and an unseen ally steadies them: at low HP the
//     controller heals the player back to full (the "rescue"), so the fight can
//     never become a death. Either way it ends in victory and drops to Freeplay.
//
// The engine has no revive once a combatant is 'dead', so the rescue must land
// BEFORE death: it watches each resolved round and, the moment the player is at
// the brink but still alive, dispatches a synthetic ITEM_CONSUMED that heals to
// full. Economy treats an empty `stacks` as a no-op; the combat engine folds
// effect.hpAfter — so this restores HP without inventing an item or touching gold.

// Heal-to-full triggers at half health. Because a lone bandit's single hit is
// well under half of any normal character's max HP (maxHp = 2·toughness +
// fortitude; the point-buy floor of 8 toughness alone gives maxHp ≥ 20), a
// player healed at 50% can never be brought from above-brink to dead in the next
// single blow — so the tutorial cannot end in defeat for any reasonable build.
// (A deliberately extreme sandbox build with very low toughness is the one
// opt-in exception; sandbox is explicitly for hand-built weakness.)
import { getItemDef } from '../engines/economyData.js';

const BRINK_FRACTION = 0.5;

export function createTutorial({ world, combat, map, travel, economy, playerId }) {
  let combatId = null;
  let started = false;
  let rescued = false;

  // Brink watch: heal the player to full the instant they drop to the brink,
  // so the tutorial fight can never end in defeat.
  world.subscribe('COMBAT_ROUND_RESOLVED', (entry) => {
    if (!combatId || entry.payload.combatId !== combatId) return;
    if (!combat.getActiveCombat()) return; // already resolved this round
    const v = combat.getVitals(playerId);
    if (!v || v.status !== 'alive' || v.hp <= 0) return;
    if (v.hp <= Math.ceil(v.maxHp * BRINK_FRACTION)) {
      rescued = true;
      world.dispatch('ITEM_CONSUMED', {
        entityId: playerId,
        combatId, // so the combat engine folds the heal into the ACTIVE snapshot too
        stacks: {}, // economy no-op; combat folds effect.hpAfter
        effect: { healed: v.maxHp - v.hp, hpBefore: v.hp, hpAfter: v.maxHp },
        reason: 'tutorial_rescue',
      });
    }
  });

  // armPlayer — equip a carried weapon before the first fight so it isn't a bare-
  // handed slog. Non-fatal: any hiccup just leaves the newcomer fighting unarmed.
  function armPlayer() {
    if (!economy) return;
    try {
      if (economy.getEquipped(playerId)?.mainHand) return;
      const inv = economy.getInventory(playerId);
      const weapon = (inv?.instances || []).find((i) => getItemDef(i.itemDefId)?.combat?.kind === 'weapon');
      if (weapon) economy.equip(playerId, 'mainHand', weapon.instanceId);
    } catch { /* fight unarmed if anything is off */ }
  }

  // start — begin the ambush at the player's current node. Idempotent.
  function start() {
    if (started) return null;
    started = true;
    armPlayer();
    const node = map.getNode(travel.getPlayerNodeId());
    if (!node) return null;
    const entry = combat.startCombat('tmpl_bandit_ambush', node, { tutorial: true });
    combatId = entry?.payload?.combatId ?? null;
    return entry;
  }

  return {
    start,
    isStarted: () => started,
    wasRescued: () => rescued,
  };
}
