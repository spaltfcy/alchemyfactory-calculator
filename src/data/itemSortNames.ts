import type { Item } from '../types';
import { itemById } from './items';

export function validateItemSortNames(items: Item[]): void {
  const nameOwnerByLang = new Map<string, string>();

  for (const item of items) {
    for (const lang of ['ja', 'en'] as const) {
      const key = lang + ':' + item.name[lang];
      const previous = nameOwnerByLang.get(key);

      if (previous && previous !== item.id) {
        throw new Error(`Duplicate item name detected: ${item.name[lang]} (${previous}, ${item.id})`);
      }

      nameOwnerByLang.set(key, item.id);
    }
  }
}

export function getItemSortNameJa(itemId: string): string {
  const item = itemById[itemId];
  return item?.sortName?.ja ?? item?.name.ja ?? itemId;
}
