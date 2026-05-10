import type { ParadoxSettings } from '../types';
import { ITEMS, itemById } from './items';

export const DEFAULT_PARADOX_SETTINGS: ParadoxSettings = {
  oblivionInputItemId: 'sage_seeds',
};

export function getParadoxSettings(settings?: { paradox?: Partial<ParadoxSettings> }): ParadoxSettings {
  return {
    ...DEFAULT_PARADOX_SETTINGS,
    ...(settings?.paradox ?? {}),
  };
}

export function isParadoxableItem(itemId: string): boolean {
  const timeSec = itemById[itemId]?.paradoxTimeSec;
  return typeof timeSec === 'number' && Number.isFinite(timeSec) && timeSec > 0;
}

export const paradoxableItemIds: string[] = ITEMS
  .filter((item) => typeof item.paradoxTimeSec === 'number' && Number.isFinite(item.paradoxTimeSec) && item.paradoxTimeSec > 0)
  .sort((a, b) => (a.paradoxTimeSec ?? 0) - (b.paradoxTimeSec ?? 0) || a.id.localeCompare(b.id))
  .map((item) => item.id);
