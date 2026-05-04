export type Lang = 'ja' | 'en';

export type LocalizedText = {
  ja: string;
  en: string;
};

export type ItemCategory =
  | 'raw'
  | 'fuel'
  | 'component'
  | 'material'
  | 'herb'
  | 'catalyst'
  | 'currency'
  | 'other';

export type Item = {
  id: string;
  name: LocalizedText;
  category: ItemCategory;
};

export type Machine = {
  id: string;
  name: LocalizedText;
};

export type RecipeIO = {
  itemId: string;
  amount: number;
  probability?: number;
};

export type Recipe = {
  id: string;
  name: LocalizedText;
  machineId: string;
  timeSec: number;
  inputs: RecipeIO[];
  outputs: RecipeIO[];
  primaryOutputId: string;
  sourceUrl?: string;
};

export type TargetMode = 'rate' | 'machines';

export type ProductionTarget = {
  id: string;
  recipeId: string;
  outputItemId: string;
  mode: TargetMode;
  value: number;
};

export type MachineRoundingMode = 'none' | 'intermediate' | 'all';
export type SurplusPolicy = 'reuse' | 'discard';
export type ItemSourceMode = 'auto' | 'craft' | 'buy' | 'stock';
export type GraphDetailLevel = 'simple' | 'normal' | 'detailed';

export type AbilityId =
  | 'logisticsEfficiency'
  | 'throwingEfficiency'
  | 'factoryEfficiency'
  | 'alchemySkill'
  | 'fuelEfficiency'
  | 'fertilizerEfficiency'
  | 'salesAbility'
  | 'negotiationSkill'
  | 'customerManagement'
  | 'relicKnowledge';

export type AbilitySettings = Record<AbilityId, number>;

export type AppSettings = {
  machineRounding: MachineRoundingMode;
  defaultSurplusPolicy: SurplusPolicy;
  graphDetailLevel: GraphDetailLevel;
  showSurplus: boolean;
  showDiscardedByproducts: boolean;
  showCompleted: boolean;
};

export type AppState = {
  version: number;
  language: Lang;
  activeTab: 'graph' | 'table' | 'settings' | 'about';
  targets: ProductionTarget[];
  settings: AppSettings;
  abilities: AbilitySettings;
  recipePreferences: Record<string, string>;
  surplusPolicies: Record<string, SurplusPolicy>;
  itemSourceModes: Record<string, ItemSourceMode>;
  completedGraphNodeIds: Record<string, boolean>;
  nodeNotes: Record<string, string>;
};

export type EconomyEntry = {
  itemId: string;
  buyPriceCopper?: number;
  // 売れないアイテムは sellPriceCopper を定義しません。
  sellPriceCopper?: number;
};
