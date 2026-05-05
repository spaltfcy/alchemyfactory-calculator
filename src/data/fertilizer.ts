export type FertilizerItemConfig = {
  itemId: string;
  nutrientValue: number;
  nutrientsPerSec: number;
};

export const FERTILIZER_ITEMS: FertilizerItemConfig[] = [
  { itemId: 'basic_fertilizer', nutrientValue: 144, nutrientsPerSec: 12 },
  { itemId: 'advanced_fertilizer', nutrientValue: 720, nutrientsPerSec: 144 },
  { itemId: 'growth_potion', nutrientValue: 6480, nutrientsPerSec: 2160 },
  { itemId: 'fertile_catalyst', nutrientValue: 24000, nutrientsPerSec: 6000 },
  { itemId: 'panacea_potion', nutrientValue: 200000, nutrientsPerSec: 20000 },
];

export const FERTILIZER_ITEM_IDS = FERTILIZER_ITEMS.map((fertilizer) => fertilizer.itemId);

export const FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID: Record<string, number> = Object.fromEntries(
  FERTILIZER_ITEMS.map((fertilizer) => [fertilizer.itemId, fertilizer.nutrientValue]),
);
