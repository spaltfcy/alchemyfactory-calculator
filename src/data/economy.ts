import type { EconomyEntry } from '../types';

// v0.1 の価格データです。
// 売れないアイテムは sellPriceCopper を定義しません。
// 未確認の価格は後でゲーム内確認に合わせて差し替えてください。
export const ECONOMY: EconomyEntry[] = [
  { itemId: 'logs', buyPriceCopper: 200 },
  { itemId: 'coal_ore', buyPriceCopper: 4800 },
  { itemId: 'rotten_log', buyPriceCopper: 300 },
  { itemId: 'plank', sellPriceCopper: 1 },
  { itemId: 'charcoal', sellPriceCopper: 8 },
  { itemId: 'charcoal_powder', sellPriceCopper: 10 },
  { itemId: 'coal', sellPriceCopper: 40 },
  { itemId: 'gloom_fungus', sellPriceCopper: 16 },
  { itemId: 'stone', sellPriceCopper: 2 },
];

export const economyByItemId = Object.fromEntries(ECONOMY.map((entry) => [entry.itemId, entry]));
