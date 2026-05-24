import { itemById } from '../data/items';
import { safeCeil } from '../utils/format';
import type { FlowTransportKind } from './calculationTypes';

const EPS = 1e-9;

export type FlowTransport = {
  belts: number;
  transportKind: FlowTransportKind;
  transportUnits: number;
};

export function isPipelineItem(itemId: string): boolean {
  if (itemId === 'steam') return true;
  return (itemById[itemId]?.physicalState ?? 'solid') === 'liquid';
}

export function flowTransportForItem(
  itemId: string,
  rate: number,
  conveyorItemsPerMinute: number,
): FlowTransport {
  if (isPipelineItem(itemId)) return { belts: 1, transportKind: 'pipeline', transportUnits: 1 };
  const capacity = Math.max(1, conveyorItemsPerMinute || 60);
  const belts = Number.isFinite(rate) && rate > EPS ? Math.max(1, safeCeil(rate / capacity)) : 0;
  return { belts, transportKind: 'belt', transportUnits: belts };
}
