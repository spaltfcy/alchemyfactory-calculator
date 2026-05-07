export type Lang = 'ja' | 'en';

export type LocalizedText = { ja: string; en: string };

export type ItemCategory =
  | 'raw'
  | 'fuel'
  | 'component'
  | 'material'
  | 'liquid'
  | 'herb'
  | 'catalyst'
  | 'currency'
  | 'other';

export type ItemPhysicalState = 'solid' | 'liquid' | 'steam';

export type Item = {
  id: string;
  name: LocalizedText;
  category: ItemCategory;
  physicalState?: ItemPhysicalState;
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
export type QuantityRoundingStep = 'none' | '1' | '0.1' | '0.01';
export type SurplusPolicy = 'reuse' | 'discard';
export type ItemSourceMode = 'auto' | 'craft' | 'buy' | 'stock';
export type GraphDetailLevel = 'simple' | 'normal' | 'detailed';

export type FuelSourceMode = 'craft' | 'buy';
export type HeatingMode = 'direct' | 'steam';
export type SteamBoilerMode = 'low' | 'medium' | 'high';
export type FertilizerSourceMode = 'craft' | 'buy';
export type CrucibleVariant = 'crucible' | 'stackable_crucible';

export type FuelSettings = {
  enabled: boolean;
  fuelItemId: string;
  fuelSourceMode: FuelSourceMode;
  heatingMode: HeatingMode;
  steamBoilerMode: SteamBoilerMode;
  crucibleVariant: CrucibleVariant;
  crucibleOverheadHeatPerSec: number;
  otherOverheadHeatPerSec: number;
  maxIterations: number;
};
export type FertilizerSettings = {
  enabled: boolean;
  fertilizerItemId: string;
  fertilizerSourceMode: FertilizerSourceMode;
  nurseryNutrientsPerSec: number;
  maxIterations: number;
};

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
  quantityRoundingStep: QuantityRoundingStep;
  defaultSurplusPolicy: SurplusPolicy;
  graphDetailLevel: GraphDetailLevel;
  showSurplus: boolean;
  showDiscardedByproducts: boolean;
  showCompleted: boolean;
  showInitialInvestmentLines: boolean;
  fuel: FuelSettings;
  fertilizer: FertilizerSettings;
};

export type AppState = {
  version: number;
  language: Lang;
  activeTab: 'graph' | 'table' | 'settings' | 'about' | 'debug';
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
