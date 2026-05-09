import { ITEMS } from './items';

export const FERTILIZER_ITEMS = ITEMS
  .filter((item) => item.fertilizerValue !== undefined)
  .map((item) => ({
    itemId: item.id,
    nutrientValue: item.fertilizerValue ?? 0,
    nutrientsPerSec: item.fertilizerNutrientsPerSec ?? 0,
  }));

export const FERTILIZER_ITEM_IDS = FERTILIZER_ITEMS.map((fertilizer) => fertilizer.itemId);

export const FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID: Record<string, number> = Object.fromEntries(
  FERTILIZER_ITEMS.map((fertilizer) => [fertilizer.itemId, fertilizer.nutrientValue]),
);

export const FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID: Record<string, number> = Object.fromEntries(
  FERTILIZER_ITEMS.map((fertilizer) => [fertilizer.itemId, fertilizer.nutrientsPerSec]),
);
