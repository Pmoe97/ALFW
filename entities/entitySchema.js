// entities/entitySchema.js — shared schema for Player and NPC.
//
// Both are built from the same EntityBase shape; factories are plain object
// builders, no classes, matching the zero-framework style of the rest of
// ALFW. Raw vs. derived discipline applies here too: everything under
// `capabilities.skills` is an invested value. effectiveSkill() below is the
// only way to read a skill's effective value — the bonus is never written
// back onto the entity.

import { getSchema } from '../engines/activeSchema.js';

/**
 * @typedef {Object} IntimateEntry
 * @property {string} type
 * @property {string} size
 * @property {string} details
 */

/**
 * @typedef {Object} MemoryRef
 * @property {number} seq - index into the world's event log this memory points at
 * @property {string} summary
 */

/**
 * A single transient emotional read. NEVER stored on an entity — it is the
 * output of entities/deriveEmotion.js, recomputed fresh every turn from the
 * NPC's recent memories + axes and rendered into the dialogue prompt. Documented
 * here only so callers have a shape to reference.
 * @typedef {Object} EmotionRead
 * @property {string} emotion - the named feeling (e.g. 'indignant', 'fond')
 * @property {number} intensity - 0..1, relative to the dominant read
 * @property {string} band - human-readable strength: 'mild' | 'moderate' | 'strong'
 */

/**
 * @typedef {Object} ScheduleEntry
 * @property {string} timeOfDay - a TIME_OF_DAY_BUCKETS name ('morning' | 'day'
 *   | 'evening' | 'night'; see worldClockEngine.deriveTimeOfDayBucket)
 * @property {string} locationId - a baseline POI id, a symbolic id ('home',
 *   'out_and_about'), or a hand-authored free-form location string
 * @property {string} activity
 * @property {('awake'|'asleep')=} availability - OPTIONAL presence marker read
 *   by npcGeneratorEngine.deriveScheduleState for witness fan-out. Generated
 *   schedules always carry it; hand-authored entries that predate the field
 *   fall back to the activity === 'sleeping' convention (which the shipped
 *   hand-authored night entries already satisfy verbatim).
 */

/**
 * @typedef {Object} Identity
 * @property {string} firstName
 * @property {string} lastName
 * @property {number} age
 * @property {string} birthday
 * @property {string} gender
 * @property {string} sexualOrientation
 * @property {string} race
 * @property {string} ethnicity
 * @property {string} vocation
 * @property {string} relationshipStatus
 * @property {string} livingSituation
 * @property {string} background
 * @property {string} biography
 */

/**
 * @typedef {Object} Appearance
 * @property {string} heightBuild
 * @property {{color: string, style: string, length: string, texture: string}} hair
 * @property {{color: string, shape: string}} eyes
 * @property {{shape: string, nose: string, lips: string, jawline: string, facialHair: string}} face
 * @property {{tone: string, texture: string}} skin
 * @property {{shape: string, chest: string, butt: string, legs: string}} body
 * @property {string[]} distinguishingFeatures
 * @property {IntimateEntry[]} intimate
 */

/**
 * @typedef {Object} Psychology
 * @property {string[]} personalityTraits
 * @property {Record<string, number>} personalityAxes
 * @property {Record<string, number>} factionAlignmentAxes
 * @property {string[]} hobbies
 * @property {string[]} likes
 * @property {string[]} dislikes
 * @property {{accent: string, directives: string[], phrases?: string[]}} voice
 *   - `accent` is a permanent cultural/racial flavor trait; `phrases` is that
 *   accent's small curated signature-word seed list, snapshotted from the
 *   race registry at the same moment `accent` is rolled (absent on entities
 *   authored before this field existed); `directives` are a small set of
 *   concrete, imperative, axis-derived speech rules (entities/voice.js),
 *   generated ONCE at creation and rendered at flag-level prompt prominence.
 *   All three are permanent — never recomputed, never touched by per-turn emotion.
 * @property {MemoryRef[]} memories
 * @property {{personality: string[], condition: string[], aiDirectives: string[]}} flags
 */

/**
 * @typedef {'athletics'|'acrobatics'|'sleightOfHand'|'stealth'|'fortitude'|
 *   'willpower'|'deception'|'intimidation'|'performance'|'persuasion'|
 *   'magic'|'investigation'|'religion'|'history'|'perception'|'survival'|
 *   'medicine'|'smithing'|'alchemy'|'enchanting'} PrimarySkill
 */

/**
 * @typedef {'riding'|'dancing'|'swimming'|'cleaning'|'disguise'|'hands'|
 *   'mouth'|'breasts'|'vagina'|'anus'} SecondarySkill
 */

/**
 * @typedef {Object} Capabilities
 * @property {{strength: number, agility: number, toughness: number, charisma: number, intelligence: number, insight: number}} attributes
 * @property {{primary: Record<PrimarySkill, number>, secondary: Record<SecondarySkill, number>}} skills
 */

/**
 * @typedef {Object} EntityBase
 * @property {string} id
 * @property {Identity} identity
 * @property {Appearance} appearance
 * @property {Psychology} psychology
 * @property {Capabilities} capabilities
 * @property {Array} inventory
 */

function buildEntityBase({ id, identity, appearance, psychology, capabilities, inventory = [] }) {
  return { id, identity, appearance, psychology, capabilities, inventory };
}

/**
 * @param {Object} data - EntityBase fields
 * @returns {EntityBase & { playerData: Object }}
 */
export function createPlayer(data) {
  return {
    ...buildEntityBase(data),
    // Placeholder for future player-only fields (quest log, discovered map).
    // Intentionally empty — do not add speculative fields here.
    playerData: {},
  };
}

/**
 * @param {Object} data - EntityBase fields plus `schedule`
 * @returns {EntityBase & { schedule: ScheduleEntry[] }}
 */
export function createNpc({ schedule = [], ...base }) {
  return {
    ...buildEntityBase(base),
    schedule,
  };
}

// Which attribute backs each primary skill's effective-value bonus.
// Provisional RPG-convention mapping — this is the only place it's defined,
// adjust here if the pairing needs to change. Exported so the NPC generator can
// iterate the primary-skill roster (Object.keys order) instead of duplicating it.
export const PRIMARY_SKILL_ATTRIBUTE = {
  athletics: 'strength',
  acrobatics: 'agility',
  sleightOfHand: 'agility',
  stealth: 'agility',
  fortitude: 'toughness',
  willpower: 'toughness',
  deception: 'charisma',
  intimidation: 'charisma',
  performance: 'charisma',
  persuasion: 'charisma',
  magic: 'intelligence',
  investigation: 'intelligence',
  religion: 'intelligence',
  history: 'intelligence',
  perception: 'insight',
  survival: 'insight',
  medicine: 'insight',
  // Crafting skills (economy engine). Appended at the END of the roster:
  // the NPC generator draws one value per key in Object.keys order, so
  // appending shifts only the draws AFTER the primary block — an intentional
  // reroll of future generated NPCs (committed rosters are log snapshots).
  smithing: 'strength',
  alchemy: 'intelligence',
  enchanting: 'insight',
};

// Runtime rosters for the secondary skills and attributes documented in the
// typedefs above (typedefs are erased at runtime, so iterating code needs a
// value). The single source of truth for these name lists — the NPC generator
// iterates them in this exact order as part of its fixed-draw-order contract.
export const SECONDARY_SKILLS = Object.freeze([
  'riding', 'dancing', 'swimming', 'cleaning', 'disguise',
  'hands', 'mouth', 'breasts', 'vagina', 'anus',
]);
export const ATTRIBUTE_NAMES = Object.freeze([
  'strength', 'agility', 'toughness', 'charisma', 'intelligence', 'insight',
]);

/**
 * Effective value of a primary skill = raw invested value +
 * floor(backing attribute / 2). Secondary skills have no backing attribute
 * and return the raw value unchanged. Never stored — call this wherever an
 * effective value is needed instead of caching it on the entity.
 */
export function effectiveSkill(entity, skillName) {
  const { skills, attributes } = entity.capabilities;
  if (skillName in skills.primary) {
    const attrName = PRIMARY_SKILL_ATTRIBUTE[skillName];
    const divisor = getSchema().entitySchema.effectiveSkillAttributeDivisor;
    return skills.primary[skillName] + Math.floor(attributes[attrName] / divisor);
  }
  if (skillName in skills.secondary) {
    return skills.secondary[skillName];
  }
  throw new Error(`Unknown skill "${skillName}"`);
}
