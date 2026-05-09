import { ITEMS } from './items';
import { machineById } from './machines';

export const FUEL_ITEMS = ITEMS
  .filter((item) => item.fuelValue !== undefined)
  .map((item) => ({ itemId: item.id, heatValue: item.fuelValue ?? 0 }));

export const FUEL_ITEM_IDS = FUEL_ITEMS.map((fuel) => fuel.itemId);

export const FUEL_HEAT_VALUE_BY_ITEM_ID: Record<string, number> = Object.fromEntries(
  FUEL_ITEMS.map((fuel) => [fuel.itemId, fuel.heatValue]),
);

export const HEAT_CONSUMER_BY_MACHINE_ID: Record<string, { heatPerSec: number }> = Object.fromEntries(
  Object.values(machineById)
    .filter((machine) => machine.heatConsumptionPerSec !== undefined)
    .map((machine) => [machine.id, { heatPerSec: machine.heatConsumptionPerSec ?? 0 }]),
);

export function resolveHeatMachineId(machineId: string): string {
  return machineId;
}
