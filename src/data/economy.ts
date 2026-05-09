import { ITEMS } from './items';

export type EconomyEntry = {
  itemId: string;
  buyPriceCopper?: number;
  sellPriceCopper?: number;
};

export const ECONOMY: EconomyEntry[] = ITEMS
  .filter((item) => item.buyPriceCopper !== undefined || item.sellPriceCopper !== undefined)
  .map((item) => ({ itemId: item.id, buyPriceCopper: item.buyPriceCopper, sellPriceCopper: item.sellPriceCopper }));

export const economyByItemId: Record<string, EconomyEntry> = Object.fromEntries(
  ECONOMY.map((entry) => [entry.itemId, entry]),
);
