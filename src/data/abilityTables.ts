import type { AbilityId, AbilitySettings } from '../types';

export const ABILITY_IDS: AbilityId[] = [
  'logisticsEfficiency',
  'throwingEfficiency',
  'factoryEfficiency',
  'alchemySkill',
  'fuelEfficiency',
  'fertilizerEfficiency',
  'salesAbility',
  'negotiationSkill',
  'customerManagement',
  'relicKnowledge',
];

export const DEFAULT_ABILITIES: AbilitySettings = {
  logisticsEfficiency: 0,
  throwingEfficiency: 0,
  factoryEfficiency: 0,
  alchemySkill: 0,
  fuelEfficiency: 0,
  fertilizerEfficiency: 0,
  salesAbility: 0,
  negotiationSkill: 0,
  customerManagement: 0,
  relicKnowledge: 0,
};

// Lv0〜Lv13 の各レベルで加算される値。
// Lv0 は初期値なので 0。Codex の∞表記は実装上は Lv13 として扱う。
export const ABILITY_MAX_LEVEL = 13;

export const ABILITY_TABLES = {
  logisticsEfficiency: {
    conveyorItemsPerMinuteAdd: [0, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3],
  },
  throwingEfficiency: {
    projectileSpeedAdd: [0, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3],
    cannonSpeedAdd: [0, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 6],
  },
  factoryEfficiency: {
    productionSpeedPercentAdd: [0, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 5],
    heatConsumptionSpeedPercentAdd: [0, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 5],
  },
  alchemySkill: {
    distillerOutputPercentAdd: [0, 6, 6, 8, 8, 8, 8, 8, 8, 10, 10, 10, 10, 10],
    extractorOutputPercentAdd: [0, 6, 6, 8, 8, 8, 8, 8, 8, 10, 10, 10, 10, 10],
  },
  fuelEfficiency: {
    fuelHeatValuePercentAdd: [0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  },
  fertilizerEfficiency: {
    fertilizerNutritionPercentAdd: [0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  },
  salesAbility: {
    sellPricePercentAdd: [0, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 10, 10, 10],
    customerPurchasePercentAdd: [0, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 0],
  },
  negotiationSkill: {
    purchaseContractQuantityPercentAdd: [0, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25],
  },
  customerManagement: {
    questRewardPercentAdd: [0, 6, 6, 8, 8, 10, 10, 12, 12, 14, 14, 20, 20, 20],
  },
  relicKnowledge: {
    relicExtractionBonusPercentAdd: [0, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
  },
} as const;

export const ABILITY_BASE_VALUES = {
  conveyorItemsPerMinute: 60,
  productionSpeedMultiplier: 1,
  heatConsumptionMultiplier: 1,
  fuelHeatValueMultiplier: 1,
  sellPriceMultiplier: 1,
  questRandomMultiplier: 1.3,
  questBulkMultiplier: 1.6,
  questUrgentMultiplier: 2,
} as const;

function sumLevels(values: readonly number[], level: number): number {
  const safeLevel = Math.max(0, Math.min(Math.floor(level), ABILITY_MAX_LEVEL));
  let total = 0;

  for (let i = 0; i <= safeLevel; i += 1) total += values[i] ?? 0;

  return total;
}

export function getConveyorItemsPerMinute(abilities: AbilitySettings): number {
  return (
    ABILITY_BASE_VALUES.conveyorItemsPerMinute +
    sumLevels(ABILITY_TABLES.logisticsEfficiency.conveyorItemsPerMinuteAdd, abilities.logisticsEfficiency)
  );
}

export function getProductionSpeedMultiplier(abilities: AbilitySettings): number {
  const addPercent = sumLevels(ABILITY_TABLES.factoryEfficiency.productionSpeedPercentAdd, abilities.factoryEfficiency);

  return ABILITY_BASE_VALUES.productionSpeedMultiplier * (1 + addPercent / 100);
}

export function getHeatConsumptionMultiplier(abilities: AbilitySettings): number {
  const addPercent = sumLevels(
    ABILITY_TABLES.factoryEfficiency.heatConsumptionSpeedPercentAdd,
    abilities.factoryEfficiency,
  );

  return ABILITY_BASE_VALUES.heatConsumptionMultiplier * (1 + addPercent / 100);
}

export function getFuelHeatValueMultiplier(abilities: AbilitySettings): number {
  const addPercent = sumLevels(ABILITY_TABLES.fuelEfficiency.fuelHeatValuePercentAdd, abilities.fuelEfficiency);

  return ABILITY_BASE_VALUES.fuelHeatValueMultiplier * (1 + addPercent / 100);
}

export function getSellPriceMultiplier(
  abilities: AbilitySettings,
  sellMode: 'shop' | 'questRandom' | 'questBulk' | 'questUrgent',
): number {
  const salesAdd = sumLevels(ABILITY_TABLES.salesAbility.sellPricePercentAdd, abilities.salesAbility);
  const customerAdd = sumLevels(ABILITY_TABLES.customerManagement.questRewardPercentAdd, abilities.customerManagement);
  const shop = ABILITY_BASE_VALUES.sellPriceMultiplier * (1 + salesAdd / 100);

  if (sellMode === 'questRandom') return shop * ABILITY_BASE_VALUES.questRandomMultiplier * (1 + customerAdd / 100);
  if (sellMode === 'questBulk') return shop * ABILITY_BASE_VALUES.questBulkMultiplier * (1 + customerAdd / 100);
  if (sellMode === 'questUrgent') return shop * ABILITY_BASE_VALUES.questUrgentMultiplier * (1 + customerAdd / 100);

  return shop;
}
