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

// 配列は「レベルごとの加算値」です。ゲーム内最新値に合わせる場合はここだけ編集してください。
export const ABILITY_TABLES = {
  logisticsEfficiency: {
    conveyorItemsPerMinuteAdd: [0.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0, 15.0],
  },
  throwingEfficiency: {
    placeholderPercentAdd: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  },
  factoryEfficiency: {
    productionSpeedPercentAdd: [0.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
  },
  alchemySkill: {
    extractorOutputPercentAdd: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  },
  fuelEfficiency: {
    fuelHeatValuePercentAdd: [0.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
  },
  fertilizerEfficiency: {
    fertilizerNutritionPercentAdd: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  },
  salesAbility: {
    sellPricePercentAdd: [0.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0],
  },
  negotiationSkill: {
    purchaseContractPercentAdd: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  },
  customerManagement: {
    questRewardPercentAdd: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  },
  relicKnowledge: {
    relicBonusPercentAdd: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  },
} as const;

export const ABILITY_BASE_VALUES = {
  conveyorItemsPerMinute: 60.0,
  productionSpeedMultiplier: 1.0,
  fuelHeatValueMultiplier: 1.0,
  sellPriceMultiplier: 1.0,
  questRandomMultiplier: 1.3,
  questBulkMultiplier: 1.6,
  questUrgentMultiplier: 2.0,
} as const;

function sumLevels(values: readonly number[], level: number): number {
  const safeLevel = Math.max(0, Math.min(Math.floor(level), values.length - 1));
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
