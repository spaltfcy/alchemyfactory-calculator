import type { Machine } from '../types';

export const MACHINES: Machine[] = [
  { id: 'table_saw', name: { ja: 'テーブルソー', en: 'Table Saw' } },
  { id: 'stone_crusher', name: { ja: 'ストーンクラッシャー', en: 'Stone Crusher' } },
  { id: 'crucible', name: { ja: 'るつぼ', en: 'Crucible' } },
  { id: 'grinder', name: { ja: 'グラインダー', en: 'Grinder' } },
  { id: 'paradox_crucible', name: { ja: 'パラドックスるつぼ', en: 'Paradox Crucible' } },
];

export const machineById = Object.fromEntries(MACHINES.map((machine) => [machine.id, machine]));
