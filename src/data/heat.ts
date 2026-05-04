export type HeatOverheadKind = 'crucible' | 'other';

export type HeatConsumerConfig = {
  heatPerSec: number;
  overheadKind: HeatOverheadKind;
};

export type FuelItemConfig = {
  itemId: string;
  heatValue: number;
};

export const FUEL_ITEMS: FuelItemConfig[] = [
  { itemId: 'logs', heatValue: 2000 },
  { itemId: 'coal_ore', heatValue: 30000 },
  { itemId: 'plank', heatValue: 20 },
  { itemId: 'charcoal', heatValue: 40 },
  { itemId: 'charcoal_powder', heatValue: 48 },
  { itemId: 'coke', heatValue: 600 },
  { itemId: 'coke_powder', heatValue: 660 },
  { itemId: 'coal', heatValue: 540 },
  { itemId: 'black_powder', heatValue: 3000 },
  { itemId: 'blast_potion', heatValue: 24000 },
  { itemId: 'panacea_potion', heatValue: 320000 },
];

export const FUEL_ITEM_IDS = FUEL_ITEMS.map((fuel) => fuel.itemId);

export const FUEL_HEAT_VALUE_BY_ITEM_ID: Record<string, number> = Object.fromEntries(
  FUEL_ITEMS.map((fuel) => [fuel.itemId, fuel.heatValue]),
);

export const HEAT_CONSUMER_BY_MACHINE_ID: Record<string, HeatConsumerConfig> = {
  iron_smelter: { heatPerSec: 9, overheadKind: 'other' },
  crucible: { heatPerSec: 4, overheadKind: 'crucible' },
  stackable_crucible: { heatPerSec: 6, overheadKind: 'crucible' },
  thermal_extractor: { heatPerSec: 80, overheadKind: 'other' },
  paradox_crucible: { heatPerSec: 1200, overheadKind: 'other' },
  kiln: { heatPerSec: 15, overheadKind: 'other' },
  alembic: { heatPerSec: 108, overheadKind: 'other' },
  athanor: { heatPerSec: 32, overheadKind: 'other' },
  advanced_alembic: { heatPerSec: 270, overheadKind: 'other' },
  advanced_athanor: { heatPerSec: 360, overheadKind: 'other' },
};

export function resolveHeatMachineId(machineId: string, crucibleVariant: 'crucible' | 'stackable_crucible'): string {
  if (machineId === 'crucible') return crucibleVariant;
  return machineId;
}
