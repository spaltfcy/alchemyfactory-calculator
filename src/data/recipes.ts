import type { Recipe } from '../types';

// v0.1: Codex に掲載されている実在レシピだけを少数収録しています。
// 後でゲーム内確認版へ差し替えやすいよう、データはこのファイルに集約しています。
export const RECIPES: Recipe[] = [
  {
    id: 'plank_from_logs',
    name: { ja: '木材', en: 'Plank' },
    machineId: 'table_saw',
    timeSec: 400,
    inputs: [{ itemId: 'logs', amount: 1 }],
    outputs: [{ itemId: 'plank', amount: 200 }],
    primaryOutputId: 'plank',
    sourceUrl: 'https://alchemy-factory-codex.com/recipe/plank/',
  },
  {
    id: 'gloom_fungus_and_plank_from_rotten_log',
    name: { ja: '幽暗キノコと木材', en: 'Gloom Fungus and Plank' },
    machineId: 'table_saw',
    timeSec: 400,
    inputs: [{ itemId: 'rotten_log', amount: 1 }],
    outputs: [
      { itemId: 'gloom_fungus', amount: 40 },
      { itemId: 'plank', amount: 160 },
    ],
    primaryOutputId: 'gloom_fungus',
    sourceUrl: 'https://alchemy-factory-codex.com/ja/recipes/',
  },
  {
    id: 'coal_from_coal_ore',
    name: { ja: '石炭', en: 'Coal' },
    machineId: 'stone_crusher',
    timeSec: 360,
    inputs: [{ itemId: 'coal_ore', amount: 1 }],
    outputs: [{ itemId: 'coal', amount: 120 }],
    primaryOutputId: 'coal',
    sourceUrl: 'https://alchemy-factory-codex.com/recipe/coal/',
  },
  {
    id: 'charcoal_from_plank',
    name: { ja: '木炭', en: 'Charcoal' },
    machineId: 'crucible',
    timeSec: 4,
    inputs: [{ itemId: 'plank', amount: 1 }],
    outputs: [{ itemId: 'charcoal', amount: 1 }],
    primaryOutputId: 'charcoal',
    sourceUrl: 'https://alchemy-factory-codex.com/recipe/charcoal/',
  },
  {
    id: 'charcoal_powder_from_charcoal',
    name: { ja: '木炭粉末', en: 'Charcoal Powder' },
    machineId: 'grinder',
    timeSec: 4,
    inputs: [{ itemId: 'charcoal', amount: 1 }],
    outputs: [{ itemId: 'charcoal_powder', amount: 1 }],
    primaryOutputId: 'charcoal_powder',
    sourceUrl: 'https://alchemy-factory-codex.com/recipes/',
  },
  {
    id: 'stone_and_coal',
    name: { ja: '石と石炭', en: 'Stone and Coal' },
    machineId: 'paradox_crucible',
    timeSec: 3000,
    inputs: [],
    outputs: [
      { itemId: 'stone', amount: 300 },
      { itemId: 'coal', amount: 300 },
      { itemId: 'iron_sand', amount: 300 },
      { itemId: 'shattered_crystal', amount: 60 },
      { itemId: 'obsidian', amount: 30 },
      { itemId: 'adamant', amount: 7 },
      { itemId: 'ruby', amount: 1 },
      { itemId: 'sapphire', amount: 1 },
      { itemId: 'emerald', amount: 1 },
    ],
    primaryOutputId: 'stone',
    sourceUrl: 'https://alchemy-factory-codex.com/recipe/stone-and-coal/',
  },
];

export const recipeById = Object.fromEntries(RECIPES.map((recipe) => [recipe.id, recipe]));

export const DEFAULT_RECIPE_BY_ITEM_ID: Record<string, string> = {
  plank: 'plank_from_logs',
  gloom_fungus: 'gloom_fungus_and_plank_from_rotten_log',
  coal: 'coal_from_coal_ore',
  charcoal: 'charcoal_from_plank',
  charcoal_powder: 'charcoal_powder_from_charcoal',
  stone: 'stone_and_coal',
};

export function getRecipesProducing(itemId: string): Recipe[] {
  return RECIPES.filter((recipe) => recipe.outputs.some((output) => output.itemId === itemId));
}
