export type Lang = 'ja' | 'en';
export type LangCode = Lang;

export type LocalizedText = {
  ja: string; // 日本語表示名
  en: string; // 英語表示名
};

export type ItemAmount = {
  itemId: string; // アイテムID
  amount: number; // 数量
};

// アイテムの搬送状態
export type ItemPhysicalState =
  | 'solid'
  | 'liquid';

// アイテム分類
export type ItemCategory =
  | 'raw'
  | 'intermediate'
  | 'product'
  | 'seed'
  | 'fuel'
  | 'fertilizer'
  | 'internal';

export type Item = {
  id: string; // アイテムID
  name: LocalizedText; // 表示名
  sortName?: Partial<Record<LangCode, string>>; // 並び替え用名。未定義なら表示名
  category: ItemCategory; // アイテム分類
  physicalState: ItemPhysicalState; // 物理状態。solidならベルト、liquidならパイプ
  buyPriceCopper?: number; // 仕入価格。定義ありなら購入可能
  sellPriceCopper?: number; // 売価。定義ありなら売却可能
  fuelValue?: number; // 燃料値。定義ありなら燃料候補
  fertilizerValue?: number; // 肥料値。定義ありなら肥料候補
  fertilizerNutrientsPerSec?: number; // 肥料投入速度。定義ありなら肥料候補
  paradoxTimeSec?: number; // パラドックス坩堝で消滅エッセンス素材にした場合の基準時間秒
  internal?: boolean; // 内部用。ターゲット・売却候補には出さない
};

// 設備分類
export type MachineCategory =
  | 'production'
  | 'heat_source'
  | 'steam'
  | 'furniture'
  | 'internal';

// 設備の入出力系統数
export type MachinePortConfig = {
  solidInputs: number; // 固体入力系統数
  liquidInputs: number; // 液体入力系統数
  solidOutputs: number; // 固体出力系統数
  liquidOutputs: number; // 液体出力系統数
};

export type Machine = {
  id: string; // 設備ID
  name: LocalizedText; // 表示名
  category: MachineCategory; // 設備分類
  buildCost: ItemAmount[]; // 建築コスト。未確認/不要なら空配列
  ports: MachinePortConfig; // 入出力系統数
  heatConsumptionPerSec?: number; // 熱消費P/s
  heatSelfConsumptionPerSec?: number; // 熱源自身の消費P/s
  internal?: boolean; // 内部用。通常UIには出さない
};

export type RecipeIO = {
  itemId: string; // アイテムID
  amount: number; // 数量
  probability?: number; // 出力確率。未定義なら1
};

export type ItemRecipeInput = {
  kind?: 'item';
  itemId: string; // アイテムID
  amount: number; // 数量
};

export type ParadoxableRecipeInput = {
  kind: 'paradoxableItem';
  amount: number; // 数量
};

export type RecipeInput = ItemRecipeInput | ParadoxableRecipeInput;
export type RecipeOutput = RecipeIO;

export type NutrientRunRateMode = 'logisticsCap' | 'fixedTime';

export type Recipe = {
  id: string; // レシピID
  name: LocalizedText; // 表示名
  machineId: string; // 使用設備ID
  timeSec: number; // 1回の処理時間秒
  inputs: RecipeInput[]; // 入力一覧
  outputs: RecipeOutput[]; // 出力一覧
  heatInputPerSec?: number; // レシピ自体が要求する熱P/s。蒸気ボイラーなどで使用
  nutrientInputPerRun?: number; // 肥料/栄養値を使うレシピの1回あたり必要栄養値V。未定義なら肥料不要
  nutrientRunRateMode?: NutrientRunRateMode; // 肥料レシピの速度決定方式。通常ハーブはlogisticsCap、世界樹はfixedTime
  internal?: boolean; // 内部用。通常ターゲット候補には出さない
  order?: number; // レシピ候補の表示順
};

export type TargetMode = 'rate' | 'machines';

export type ProductionTarget = {
  id: string;
  enabled?: boolean;
  recipeId: string;
  outputItemId: string;
  mode: TargetMode;
  value: number;
};

export type MachineRoundingMode = 'none' | 'intermediate' | 'all';
export type SurplusPolicy = 'reuse' | 'discard';
export type ExternalSourceMode = 'internal' | 'external';
export type HeatingMode = 'direct' | 'steam';
export type CrucibleMachinePreference = 'crucible' | 'stackable_crucible';
export type GrinderMachinePreference = 'grinder' | 'enhanced_grinder';
export type ExtractorMachinePreference = 'extractor' | 'thermal_extractor';

export type ParadoxSettings = {
  oblivionInputItemId: string;
};

export type MachinePreferences = {
  crucible: CrucibleMachinePreference;
  grinder: GrinderMachinePreference;
  extractor: ExtractorMachinePreference;
};

export type ThermalExtractorSettings = {
  height: number;
};

export type FuelSettings = {
  enabled: boolean; // 内部互換用。UIでは常に有効として扱う
  fuelItemId: string; // 使用する燃料アイテムID
  sourceMode: ExternalSourceMode; // 内部生産か外部生産か
  heatingMode: HeatingMode; // 直接加熱か蒸気加熱か
};

export type FertilizerSettings = {
  enabled: boolean; // 内部互換用。UIでは常に有効として扱う
  fertilizerItemId: string; // 使用する肥料アイテムID
  sourceMode: ExternalSourceMode; // 内部生産か外部生産か
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

export type TargetDefaults = {
  mode: TargetMode;
  value: number;
};

export type AppSettings = {
  machineRounding: MachineRoundingMode;
  defaultSurplusPolicy: SurplusPolicy;
  showSurplus: boolean;
  showDiscardedByproducts: boolean;
  showCompleted: boolean;
  showInitialInvestmentLines: boolean;
  allowAlternateRecipeCompletion: boolean;
  useByproductFuel: boolean;
  targetDefaults: TargetDefaults;
  machinePreferences: MachinePreferences;
  paradox: ParadoxSettings;
  fuel: FuelSettings;
  fertilizer: FertilizerSettings;
  thermalExtractor: ThermalExtractorSettings;
};


export type MachineTableSortKey = 'recipe' | 'machine' | 'productionRate' | 'theoreticalMachines' | 'actualMachines' | 'surplus';
export type MachineDetailTableSortKey = 'label' | 'usageRate' | 'productionRate' | 'theoreticalMachines' | 'actualMachines';
export type SortDirection = 'asc' | 'desc';

export type TablePreferences = {
  machineSort: {
    key: MachineTableSortKey;
    direction: SortDirection;
  };
  machineDetailSort: {
    key: MachineDetailTableSortKey;
    direction: SortDirection;
  };
};

export type AppState = {
  version: number;
  language: Lang;
  activeTab: 'graph' | 'table' | 'settings' | 'recipeSettings' | 'about' | 'graphDebug' | 'debug';
  tablePreferences: TablePreferences;
  targets: ProductionTarget[];
  settings: AppSettings;
  abilities: AbilitySettings;
  recipePreferences: Record<string, string>;
  surplusPolicies: Record<string, SurplusPolicy>;
  completedGraphNodeIds: Record<string, boolean>;
  nodeNotes: Record<string, string>;
};

