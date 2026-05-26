import { ITEMS } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { CauldronTargetEntry, CauldronValueEntry } from './cauldronTypes';

function cauldronStatus(status: 'unverified' | 'verified' | 'conflict' | undefined): CauldronValueEntry['status'] {
  return status ?? 'unverified';
}

export const CAULDRON_INPUT_VALUES: Record<string, CauldronValueEntry> = Object.fromEntries(
  ITEMS
    .filter((item) => item.cauldronValue !== undefined)
    .map((item) => [
      item.id,
      {
        itemId: item.id,
        value: item.cauldronValue ?? 0,
        status: cauldronStatus(item.cauldronValueStatus),
        note: 'items.ts 由来の錬金釜入力値',
      },
    ]),
);

const manualCauldronTimeByOutputItemId: Record<string, number> = {};
for (const recipe of RECIPES) {
  if (recipe.machineId !== 'cauldron' && recipe.machineId !== 'advanced_cauldron') continue;
  for (const output of recipe.outputs) {
    if (output.amount <= 0) continue;
    if (manualCauldronTimeByOutputItemId[output.itemId] === undefined) {
      manualCauldronTimeByOutputItemId[output.itemId] = recipe.timeSec;
    }
  }
}

export const CAULDRON_TARGETS: Record<string, CauldronTargetEntry> = Object.fromEntries(
  ITEMS
    .filter((item) => item.cauldronTargetValue !== undefined && (item.cauldronTargetMultiplier ?? 1) > 0)
    .map((item) => [
      item.id,
      {
        itemId: item.id,
        targetValue: item.cauldronTargetValue ?? 0,
        multiplier: item.cauldronTargetMultiplier ?? 1,
        status: cauldronStatus(item.cauldronTargetStatus),
        timeSec: manualCauldronTimeByOutputItemId[item.id],
        note: 'items.ts 由来の錬金釜ターゲット値',
      },
    ]),
);

export const CAULDRON_INPUT_ITEM_IDS = Object.keys(CAULDRON_INPUT_VALUES).sort(
  (a, b) => CAULDRON_INPUT_VALUES[a].value - CAULDRON_INPUT_VALUES[b].value || a.localeCompare(b),
);

export const CAULDRON_TARGET_ITEM_IDS = Object.keys(CAULDRON_TARGETS).sort(
  (a, b) => CAULDRON_TARGETS[a].targetValue - CAULDRON_TARGETS[b].targetValue || a.localeCompare(b),
);

export const STATIC_CAULDRON_RECIPES = RECIPES.filter(
  (recipe) => recipe.machineId === 'cauldron' || recipe.machineId === 'advanced_cauldron',
);
