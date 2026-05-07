import type { Machine } from '../types';

export const MACHINES: Machine[] = [
  { id: 'steam_boiler', name: { ja: '蒸気ボイラー', en: 'Steam Boiler' } },
  { id: "advanced_alembic", name: { ja: "上級アランビック", en: "Advanced Alembic" } },
  { id: "advanced_assembler", name: { ja: "上級アセンブラー", en: "Advanced Assembler" } },
  { id: "advanced_athanor", name: { ja: "上級アタノール", en: "Advanced Athanor" } },
  { id: "advanced_blender", name: { ja: "上級ブレンダー", en: "Advanced Blender" } },
  { id: "advanced_shaper", name: { ja: "上級シェイパー", en: "Advanced Shaper" } },
  { id: "alembic", name: { ja: "アランビック", en: "Alembic" } },
  { id: "arcane_processor", name: { ja: "秘術プロセッサー", en: "Arcane Processor" } },
  { id: "arcane_shaper", name: { ja: "秘術シェイパー", en: "Arcane Shaper" } },
  { id: "assembler", name: { ja: "アセンブラー", en: "Assembler" } },
  { id: "athanor", name: { ja: "アタノール", en: "Athanor" } },
  { id: "blender", name: { ja: "ブレンダー", en: "Blender" } },
  { id: "cauldron", name: { ja: "大釜", en: "Cauldron" } },
  { id: "crucible", name: { ja: "るつぼ", en: "Crucible" } },
  { id: "extractor", name: { ja: "抽出機", en: "Extractor" } },
  { id: "grinder", name: { ja: "グラインダー", en: "Grinder" } },
  { id: "iron_smelter", name: { ja: "鉄製錬炉", en: "Iron Smelter" } },
  { id: "kiln", name: { ja: "窯", en: "Kiln" } },
  { id: "nursery", name: { ja: "苗床", en: "Nursery" } },
  { id: "paradox_crucible", name: { ja: "パラドックスるつぼ", en: "Paradox Crucible" } },
  { id: "processor", name: { ja: "プロセッサー", en: "Processor" } },
  { id: "refiner", name: { ja: "精製機", en: "Refiner" } },
  { id: "shaper", name: { ja: "シェイパー", en: "Shaper" } },
  { id: "stone_crusher", name: { ja: "ストーンクラッシャー", en: "Stone Crusher" } },
  { id: "table_saw", name: { ja: "テーブルソー", en: "Table Saw" } },
  { id: "world_tree_nursery", name: { ja: "世界樹の苗床", en: "World Tree Nursery" } },
];

export const machineById: Record<string, Machine> = Object.fromEntries(MACHINES.map((machine) => [machine.id, machine]));
