// engines/geographyConfigKeys.js — verified reference list of the WorldConfig
// paths that determine already-explored geography (terrain, classification,
// settlement placement, and node-graph edge geometry), all classified
// LIVE-FORMULA in field-classification-audit.md: worldMapEngine.js never
// stores their derived output, only a bare nodeId (MAP_NEIGHBORS_MATERIALIZED),
// so changing any of these paths reshapes the ENTIRE explored map the next
// time the log is replayed. This file is NOT wired into anything — no gating
// logic, no ModManager, no SCHEMA_UPDATED handling exist yet. It exists so a
// FUTURE mechanism that blocks a mod hot-swap into an existing save (when the
// mod's diff touches one of these paths) has a single, verified source of
// truth to check against instead of re-deriving this list from scratch.
//
// Every path below was confirmed against the real shipped schema
// (worldConfig.json, mirrored by hand in game/sampleWorld.js) and against its
// read site in engines/worldMapEngine.js — see the `readAt` field.

export const GEOGRAPHY_CONFIG_KEYS = Object.freeze([
  // --- Terrain (engines/worldMapEngine.js: deriveTerrainAt) ------------------
  { path: 'worldMap.terrain.noiseScale', readAt: 'worldMapEngine.js:202-203 (fbm noiseScale)' },
  { path: 'worldMap.terrain.octaves', readAt: 'worldMapEngine.js:202-203 (fbm octaves)' },
  { path: 'worldMap.terrain.falloffScale', readAt: 'worldMapEngine.js:208 (falloff denominator)' },
  { path: 'worldMap.terrain.waterLevel', readAt: 'worldMapEngine.js:215,217 (band center + effWater)' },
  { path: 'worldMap.terrain.cliffLevel', readAt: 'worldMapEngine.js:215,218 (band center + effCliff)' },
  { path: 'worldMap.terrain.deepWaterLevel', readAt: 'worldMapEngine.js:216 (effDeepWater)' },
  { path: 'worldMap.terrain.denseForestMoisture', readAt: 'worldMapEngine.js:245 (dense_forest threshold)' },
  { path: 'worldMap.terrain.forestMoisture', readAt: 'worldMapEngine.js:248 (forest threshold)' },
  { path: 'worldMap.terrain.hillsLevel', readAt: 'worldMapEngine.js:251 (hills threshold)' },

  // --- Notability (engines/worldMapEngine.js: deriveNotability) --------------
  { path: 'worldMap.classification.environment.notabilityNoiseScale', readAt: 'worldMapEngine.js:326 (fbm noiseScale)' },
  { path: 'worldMap.classification.environment.notabilityRarityExponent', readAt: 'worldMapEngine.js:327 (Math.pow exponent)' },

  // --- Faction baseline (engines/worldMapEngine.js: deriveBaselineFactionControl) ---
  { path: 'worldMap.classification.faction.territoryNoiseScale', readAt: 'worldMapEngine.js:340 (fbm noiseScale)' },
  { path: 'worldMap.classification.faction.uncontrolledThreshold', readAt: 'worldMapEngine.js:341,343 (frontier band + span)' },
  { path: 'worldMap.classification.faction.factionCount', readAt: 'worldMapEngine.js:343-344 (quantization bucket count)' },

  // --- Settlement placement (engines/worldMapEngine.js: deriveSettlementSiteInCell, ---
  // --- isSettlementSiteAccepted, deriveClassificationAt) ----------------------
  { path: 'worldMap.classification.settlement.suitabilityThreshold', readAt: 'worldMapEngine.js:421 (site acceptance gate)' },
  { path: 'worldMap.classification.settlement.tierNoiseScale', readAt: 'worldMapEngine.js:423 (fbm noiseScale)' },
  { path: 'worldMap.classification.settlement.tierThresholds', readAt: 'worldMapEngine.js:369-370,424 (tierForRoll ladder)' },
  { path: 'worldMap.classification.settlement.minSpacing', readAt: 'worldMapEngine.js:379,481 (settlementSpacingOf)' },
  { path: 'worldMap.classification.settlement.tierSpacingMultiplier', readAt: 'worldMapEngine.js:379,481 (settlementSpacingOf)' },
  { path: 'worldMap.classification.settlement.snapRadius', readAt: 'worldMapEngine.js:505,507 (deriveClassificationAt claim radius)' },

  // --- Node graph geometry (engines/worldMapEngine.js: generateNeighborCandidates, ---
  // --- reconcileNeighbors) -----------------------------------------------------
  { path: 'worldMap.baseInterNodeDistance', readAt: 'worldMapEngine.js:550,562 (candidate distance base)' },
  { path: 'worldMap.distanceJitter', readAt: 'worldMapEngine.js:551,560 (candidate distance jitter)' },
  { path: 'worldMap.angleJitterDegrees', readAt: 'worldMapEngine.js:552,561 (candidate angle jitter)' },
  { path: 'worldMap.reconciliationToleranceRadius', readAt: 'worldMapEngine.js:774 (merge-vs-create tolerance)' },
]);
