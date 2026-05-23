import { ITEMS } from '../data/items';
import { RECIPES } from '../data/recipes';
import type { CauldronTargetEntry, CauldronValueEntry } from './cauldronTypes';

const itemIds = new Set(ITEMS.map((item) => item.id));

function knownValue(itemId: string, value: number, note?: string): CauldronValueEntry {
  return { itemId, value, status: 'unverified', note };
}

function knownTarget(itemId: string, targetValue: number, note?: string): CauldronTargetEntry {
  return { itemId, targetValue, status: 'unverified', note };
}

// v0.10.1: 錬金釜タブ専用の種データ。
// Steamガイド/過去確認メモ由来の値を通常 items/recipes へ混ぜず、未確認データとして隔離する。
const RAW_CAULDRON_INPUT_VALUES: CauldronValueEntry[] = [
  knownValue('small_wooden_gear', 0.33, 'Steamガイド由来の未確認入力値'),
  knownValue('charcoal_powder', 2.5, 'Steamガイド由来の未確認入力値'),
  knownValue('quicklime_powder', 7, '過去方針メモ由来の未確認入力値'),
  knownValue('impure_copper_powder', 150, 'Steamガイド由来の未確認入力値'),
  knownValue('copper_powder', 290, 'Steamガイド由来の未確認入力値'),
  knownValue('panacea_potion', 15306, 'Steamガイド由来の未確認入力値'),
  knownValue('gold_dust', 42357, 'Steamガイド由来の未確認入力値'),
  knownValue('sol', 5587946, '入力値としては確認候補。出力ターゲットではない扱い'),
];

const RAW_CAULDRON_TARGETS: CauldronTargetEntry[] = [
  knownTarget('charcoal', 2, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('coke', 30, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('impure_copper_powder', 180, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('copper_powder', 350, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('silver_powder', 4742, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('gold_dust', 52357, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('perfect_diamond', 131072, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('ruby', 200000, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('sapphire', 400000, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('emerald', 600000, 'Steamガイド由来の未確認ターゲット値'),
  knownTarget('philosophers_stone', 1000000, 'Steamガイド由来の未確認ターゲット値'),
];

export const CAULDRON_INPUT_VALUES: Record<string, CauldronValueEntry> = Object.fromEntries(
  RAW_CAULDRON_INPUT_VALUES.filter((entry) => itemIds.has(entry.itemId)).map((entry) => [entry.itemId, entry]),
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
  RAW_CAULDRON_TARGETS.filter((entry) => itemIds.has(entry.itemId)).map((entry) => [
    entry.itemId,
    {
      ...entry,
      timeSec: manualCauldronTimeByOutputItemId[entry.itemId],
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
