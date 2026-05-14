import type { AbilitySettings, AppSettings } from '../types';

export type ItemStat = {
  itemId: string;
  requested: number;
  consumed: number;
  produced: number;
  purchased: number;
  initialPurchased: number;
  reused: number;
  surplus: number;
  discarded: number;
  targetRequested: number;
  targetActual: number;
  purchaseCostCopperPerMin: number;
  initialCostCopper: number;
  revenueCopperPerMin: number;
};

export type RecipeStat = {
  recipeId: string;
  machineId: string;
  theoreticalMachines: number;
  actualMachines: number;
  runsPerMinute: number;
  inputRates: Record<string, number>;
  outputRates: Record<string, number>;
  netRates: Record<string, number>;
  surplusOutputRates: Record<string, number>;
  discardedOutputRates: Record<string, number>;
  targetIds: string[];
  factorySpeedMultiplier?: number;
  thermalHeightMultiplier?: number;
  thermalExtractorHeight?: number;
  thermalExtractorBonusPercent?: number;
  alchemyOutputMultiplier?: number;
  effectiveOutputPerMinuteMultiplier?: number;
};

export type CalculatedEndpoint =
  | { type: 'recipe'; recipeId: string }
  | { type: 'itemSource'; itemId: string; sourceMode: 'buy' | 'external' | 'cycleInput' | 'unresolved' }
  | { type: 'itemSink'; itemId: string; sinkMode: 'final' | 'discard' | 'surplus' };

export type FlowTransportKind = 'belt' | 'pipeline';

export type CalculatedFlowRole =
  | 'material'
  | 'byproductReuse'
  | 'finalOutput'
  | 'discard'
  | 'surplus'
  | 'fuel'
  | 'fertilizer'
  | 'steam';

export type CalculatedFlow = {
  id: string;
  from: CalculatedEndpoint;
  to: CalculatedEndpoint;
  itemId: string;
  rate: number;
  belts: number;
  transportKind: FlowTransportKind;
  transportUnits: number;
  role: CalculatedFlowRole;
};

export type ConveyorEdgeStat = {
  id: string;
  fromItemId: string;
  toRecipeId: string;
  rate: number;
  belts: number;
  transportKind: FlowTransportKind;
  transportUnits: number;
  fromRecipeId?: string;
  sourceKind?: 'recipe' | 'item';
  role?: 'material' | 'byproduct' | 'fuel' | 'fertilizer';
};

export type OutputEdgeStat = {
  id: string;
  fromRecipeId: string;
  toItemId: string;
  rate: number;
  byproduct: boolean;
  discarded: boolean;
};

export type PlanWarning = { messageJa: string; messageEn: string };
export type CalculationStatus = 'ok' | 'invalid';
export type CalculationErrorSummary = {
  code: string;
  messageJa: string;
  messageEn: string;
  cycleTextJa?: string;
  cycleTextEn?: string;
  itemIds?: string[];
  recipeIds?: string[];
};


export type CalculationCycleDecision = {
  componentId: string;
  classification:
    | 'cycleInput'
    | 'purchaseBreakable'
    | 'externalBreakable'
    | 'alternateRecipeBreakable'
    | 'invalid'
    | 'unsupported';
  candidateClassification?: string;
  itemIds: string[];
  recipeIds: string[];
  requiredInitialItems: Record<string, number>;
  runningExternalInputs: Record<string, number>;
  safeForMainResult: boolean;
  reasonJa: string;
  reasonEn: string;
};

export type ResidualUnresolvedFlow = {
  itemId: string;
  itemNameJa: string;
  rate: number;
  consumerRecipeId: string;
  consumerRecipeNameJa: string;
  role: CalculatedFlowRole;
  threshold: number;
  reason: 'solver_residual_below_threshold';
};


export type InitialInvestmentEndpoint =
  | { type: 'recipe'; recipeId: string }
  | { type: 'itemSource'; itemId: string; sourceMode: 'buy' | 'unresolved' | 'cycleInput' }
  | { type: 'itemSink'; itemId: string; sinkMode: 'initial' };

export type InitialInvestmentTransportKind = 'belt' | 'pipeline';

export type InitialInvestmentFlow = {
  id: string;
  from: InitialInvestmentEndpoint;
  to: InitialInvestmentEndpoint;
  itemId: string;
  rate: number;
  belts: number;
  transportKind: InitialInvestmentTransportKind;
  transportUnits: number;
  role: 'material' | 'cycleInput';
};

export type InitialInvestmentGroup = {
  id: string;
  targetRecipeId: string;
  requiredItemIds: string[];
  flows: InitialInvestmentFlow[];
  recipeStats: Record<string, RecipeStat>;
  purchasedItemIds: string[];
  unresolvedItemIds: string[];
};

export type InitialInvestmentData = {
  groups: InitialInvestmentGroup[];
  requiredByRecipe: Record<string, string[]>;
  purchasedItemIds: string[];
  unresolvedItemIds: string[];
};

export type CalculationResult = {
  itemStats: Record<string, ItemStat>;
  recipeStats: Record<string, RecipeStat>;
  flows: CalculatedFlow[];
  conveyorEdges: ConveyorEdgeStat[];
  outputEdges: OutputEdgeStat[];
  warnings: PlanWarning[];
  residualUnresolvedFlows?: ResidualUnresolvedFlow[];
  calculationStatus?: CalculationStatus;
  errorSummaries?: CalculationErrorSummary[];
  initialInvestment?: InitialInvestmentData;
  cycleDecisions?: CalculationCycleDecision[];
  totals: {
    initialCostCopper: number;
    runningCostCopperPerMin: number;
    purchaseCostCopperPerMin: number;
    revenueCopperPerMin: number;
    profitCopperPerMin: number;
    conveyorItemsPerMinute: number;
    productionSpeedMultiplier: number;
    heatConsumptionMultiplier: number;
    sellPriceMultiplier: number;
    fuelHeatValueMultiplier: number;
    fertilizerNutritionMultiplier: number;
    heatRequiredPerMin: number;
    fuelRequiredPerMin: number;
    fuelItemId: string;
    fertilizerNutrientsRequiredPerMin: number;
    fertilizerRequiredPerMin: number;
    fertilizerItemId: string;
    calculationMs?: number;
    queueSteps?: number;
    queueMax?: number;
  };
};

export type CalculateInput = {
  targets: import('../types').ProductionTarget[];
  settings: AppSettings;
  abilities: AbilitySettings;
  recipePreferences: Record<string, string>;
  surplusPolicies: Record<string, string>;
};

export type CalculationDebugIssue = {
  severity: 'info' | 'warning' | 'error';
  code: string;
  messageJa: string;
  messageEn: string;
  data?: unknown;
};

export type CalculationDebugLog = {
  generatedAt: string;
  input: CalculateInput;
  totals: CalculationResult['totals'];
  warnings: PlanWarning[];
  issues: CalculationDebugIssue[];
  summary: {
    itemCount: number;
    recipeCount: number;
    flowCount: number;
    flowsByRole: Record<string, number>;
    flowsByTransport: Record<string, number>;
    purchasedAutoCraftableCount: number;
  };
  initialInvestment?: InitialInvestmentData;
  cycleDecisions?: CalculationCycleDecision[];
  residualUnresolvedFlows: ResidualUnresolvedFlow[];
  purchasedAutoCraftableFlows: Array<{
    itemId: string;
    rate: number;
    consumerRecipeId: string;
    selectedRecipeId: string;
    role: CalculatedFlowRole;
  }>;
  flows: CalculatedFlow[];
  itemStats: ItemStat[];
  recipeStats: RecipeStat[];
  effectiveRecipeRateAudit?: Array<{
    recipeId: string;
    machineId: string;
    theoreticalMachines: number;
    actualMachines: number;
    runsPerMachinePerMinute: number;
    inputsPerMachinePerMinute: Record<string, number>;
    outputsPerMachinePerMinute: Record<string, number>;
    differencesPerMachinePerMinute: Record<string, number>;
    factorySpeedMultiplier?: number;
    thermalHeightMultiplier?: number;
    thermalExtractorHeight?: number;
    thermalExtractorBonusPercent?: number;
    alchemyOutputMultiplier?: number;
    effectiveOutputPerMinuteMultiplier?: number;
  }>;
  heatRequiredByRecipe?: Record<string, {
    recipeId: string;
    machineId: string;
    theoreticalMachines: number;
    actualMachines: number;
    runsPerMinute: number;
    runsPerMachinePerMinute: number;
    heatPerSecond: number;
    heatConsumptionMultiplier: number;
    heatPerRun: number;
    heatRequiredPerMin: number;
  }>;
  solver?: {
    mode: string;
    version: string;
    debug: boolean;
    resultEngine?: string;
    solverEngine?: string;
    diagnosticsMode?: string;
    normalizedTargetCount: number;
    calculationTargetCount: number;
    enabledTargetCount: number;
    disabledTargetCount: number;
    planModelSummary?: unknown;
    materialPlannerShadowMode?: string;
    materialPlannerShadowStatus?: string;
  };
  diagnosticComparison?: {
    resultFlowCount: number;
    resultRecipeCount: number;
    resultItemCount: number;
    linearActiveRecipeCount?: number;
    linearActiveItemCount?: number;
    linearTargetCount?: number;
    activeRecipeDelta?: number;
    activeItemDelta?: number;
    severeMismatch?: boolean;
    diagnosticsOrigin?: string;
    noteJa: string;
    noteEn: string;
  };
  graphArtifacts?: {
    normal?: { metrics: unknown };
    debug?: { metrics: unknown };
    diff?: unknown;
  };
  materialPlannerShadow?: unknown;
  structuredMaterialPlan?: unknown;
  legacyAlphaComparison?: unknown;
  planModel?: unknown;
};

export type CalculationDebugResult = {
  result: CalculationResult;
  debugLog: CalculationDebugLog;
};
