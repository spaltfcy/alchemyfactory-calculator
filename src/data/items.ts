import type { Item } from '../types';

export const ITEMS: Item[] = [
  { id: 'logs', name: { ja: '原木', en: 'Logs' }, category: 'raw' },
  { id: 'rotten_log', name: { ja: '腐朽原木', en: 'Rotten Log' }, category: 'raw' },
  { id: 'coal_ore', name: { ja: '石炭鉱石', en: 'Coal Ore' }, category: 'raw' },
  { id: 'plank', name: { ja: '木材', en: 'Plank' }, category: 'fuel' },
  { id: 'charcoal', name: { ja: '木炭', en: 'Charcoal' }, category: 'fuel' },
  { id: 'charcoal_powder', name: { ja: '木炭粉末', en: 'Charcoal Powder' }, category: 'fuel' },
  { id: 'coal', name: { ja: '石炭', en: 'Coal' }, category: 'fuel' },
  { id: 'gloom_fungus', name: { ja: '幽暗キノコ', en: 'Gloom Fungus' }, category: 'herb' },
  { id: 'stone', name: { ja: '石', en: 'Stone' }, category: 'material' },
  { id: 'iron_sand', name: { ja: '鉄砂', en: 'Iron Sand' }, category: 'material' },
  { id: 'shattered_crystal', name: { ja: '砕けた水晶', en: 'Shattered Crystal' }, category: 'material' },
  { id: 'obsidian', name: { ja: '黒曜石', en: 'Obsidian' }, category: 'material' },
  { id: 'adamant', name: { ja: 'アダマント', en: 'Adamant' }, category: 'material' },
  { id: 'ruby', name: { ja: 'ルビー', en: 'Ruby' }, category: 'material' },
  { id: 'sapphire', name: { ja: 'サファイア', en: 'Sapphire' }, category: 'material' },
  { id: 'emerald', name: { ja: 'エメラルド', en: 'Emerald' }, category: 'material' },
];

export const itemById = Object.fromEntries(ITEMS.map((item) => [item.id, item]));
