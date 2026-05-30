import type { ExternalSourceMode, LocalizedText, ProductionTarget } from '../types';

export type CauldronDataStatus = 'unverified' | 'verified' | 'conflict';
export type CauldronObservedStatus = 'todo' | 'matched' | 'mismatch' | 'unknown';
export type CauldronMachineId = 'cauldron' | 'advanced_cauldron';

export type CauldronValueEntry = {
  itemId: string;
  value: number;
  status: CauldronDataStatus;
  note?: string;
};

export type CauldronTargetEntry = {
  itemId: string;
  targetValue: number;
  multiplier?: number;
  status: CauldronDataStatus;
  timeSec?: number;
  heatPerSec?: number;
  note?: string;
};

export type CauldronInputTuple = [string, string, string];

export type CauldronPrediction = {
  inputItemIds: CauldronInputTuple;
  rawScore: number;
  duplicatePenalty: number;
  adjustedScore: number;
  outputItemId?: string;
  targetValue?: number;
  distance?: number;
  missingInputItemIds: string[];
};

export type CauldronCandidate = CauldronPrediction & {
  id: string;
  outputItemId: string;
  targetValue: number;
  distance: number;
  distanceRatio: number;
  valueEfficiency: number;
  targetStatus: CauldronDataStatus;
  targetTimeSec?: number;
  targetHeatPerSec?: number;
};

export type CauldronObservedCase = {
  id: string;
  inputItemIds: CauldronInputTuple;
  predictedOutputItemId?: string;
  observedOutputItemId?: string;
  predictedScore: number;
  observedTimeSec?: number;
  observedHeatPerSec?: number;
  machineId?: CauldronMachineId;
  status: CauldronObservedStatus;
  note?: string;
  createdAt: string;
};


export type CauldronObjectiveViolationCode =
  | 'CONSTANT_PURCHASE'
  | 'UNRESOLVED_INPUT'
  | 'EXTERNAL_PLANT_INPUT'
  | 'SURPLUS_OUTPUT'
  | 'DISCARDED_OUTPUT'
  | 'DUPLICATE_RECIPE_NODE'
  | 'INITIAL_INVESTMENT_FLOW'
  | 'FUEL_NOT_CLOSED'
  | 'FERTILIZER_NOT_CLOSED'
  | 'CAULDRON_INPUT_SLOT_MISMATCH'
  | 'SUPPORT_CLOSURE_NOT_FINITE'
  | 'FUEL_SUPPORT_CLOSURE_NOT_FINITE'
  | 'FERTILIZER_SUPPORT_CLOSURE_NOT_FINITE'
  | 'FUEL_PROFILE_UNRESOLVED'
  | 'FERTILIZER_PROFILE_UNRESOLVED';

export type CauldronObjectiveViolation = {
  code: CauldronObjectiveViolationCode;
  severity: 'warning' | 'error';
  message: LocalizedText;
  itemIds?: string[];
  recipeIds?: string[];
  details?: Record<string, unknown>;
};


export type CauldronCandidateSelectionKey = {
  classRank: number;
  unresolvedCount: number;
  constantPurchaseCount: number;
  existingReuseCount: number;
  alreadyProducedReuseCount: number;
  plantDerivedInputCount: number;
  fertilizerOpenCount: number;
  fuelOpenCount: number;
  heatOpenCount: number;
  worstInputPreferenceRank: number;
  worstInputRouteTier: number;
  inputRouteTierSum: number;
  cauldronChainDepth: number;
  supportClosureRank: number;
  routeRecipeCount: number;
  routeDepth: number;
  duplicateInputCount: number;
  overTargetInputCount: number;
  weightedDistance: number;
  adjustedScore: number;
};

export type CauldronPlanItemStatus = 'startup' | 'purchase' | 'normal' | 'cauldronTarget' | 'handCauldron' | 'plantDerivedInput' | 'missing' | 'cycle' | 'depthLimit';

export type CauldronPlanItem = {
  itemId: string;
  label: LocalizedText;
  amount: number;
  status: CauldronPlanItemStatus;
  reason: LocalizedText;
  recipeId?: string;
  candidateCount?: number;
  selectedInputItemIds?: CauldronInputTuple;
  sourceTier?: 'cauldron-planned' | 'plant-derived' | 'purchasable-derived' | 'mixed' | 'all-values';
  children: CauldronPlanItem[];
};

export type CauldronTargetPlan = {
  targetItemId: string;
  targetLabel: LocalizedText;
  status: 'provisional' | 'blocked' | 'startup';
  confidence: 'verified' | 'partiallyVerified' | 'predictedOnly' | 'blocked';
  root: CauldronPlanItem;
  missingItemIds: string[];
  cauldronCandidateItemIds: string[];
};

export type CauldronOptimizedPlanStatus = 'perfect' | 'closed' | 'warning' | 'blocked';

export type CauldronOptimizedPlanSource = 'cauldron' | 'normal';

export type CauldronOptimizedPlanIssue = {
  code:
    | 'COMPLETE_CLOSED'
    | 'MISSING'
    | 'CONSTANT_SUPPLY'
    | 'SURPLUS'
    | 'SELLABLE_SURPLUS'
    | 'COIN_SURPLUS'
    | 'INITIAL_INPUT'
    | 'TIME_UNVERIFIED'
    | 'CYCLE_UNPROVEN'
    | 'CAULDRON_DATA_MISSING'
    | CauldronObjectiveViolationCode;
  severity: 'info' | 'warning' | 'error';
  message: LocalizedText;
  itemIds?: string[];
};

export type CauldronOptimizedPlanMetrics = {
  selfContained: boolean;
  noSurplus: boolean;
  hasConstantSupply: boolean;
  hasMissing: boolean;
  hasBlockingSurplus: boolean;
  startupCostCopper: number;
  purchaseCostCopperPerMin: number;
  initialItemIds: string[];
  purchasedItemIds: string[];
  externalItemIds: string[];
  unresolvedItemIds: string[];
  surplusItemIds: string[];
  coinSurplusItemIds: string[];
  sellableSurplusItemIds: string[];
  blockingSurplusItemIds: string[];
  recipeCount: number;
  edgeCount: number;
  depth: number;
  machineCount: number;
  heatRequiredPerMin: number;
  fuelRequiredPerMin: number;
  fertilizerRequiredPerMin: number;
  hasObjectiveViolations?: boolean;
  objectiveViolationCount?: number;
  objectiveViolationCodes?: string[];
  objectiveViolations?: CauldronObjectiveViolation[];
};

export type CauldronOptimizedPlan = {
  id: string;
  rank: number;
  source: CauldronOptimizedPlanSource;
  status: CauldronOptimizedPlanStatus;
  score: number;
  targetItemId: string;
  targetLabel: LocalizedText;
  title: LocalizedText;
  summary: LocalizedText;
  targetRatePerMinute: number;
  selectedInputItemIds?: CauldronInputTuple;
  cauldronCandidateId?: string;
  cauldronDistanceRatio?: number;
  root: CauldronPlanItem;
  metrics: CauldronOptimizedPlanMetrics;
  issues: CauldronOptimizedPlanIssue[];
};

export type CauldronOptimizationResult = {
  targetItemId: string;
  targetLabel: LocalizedText;
  bestPlan?: CauldronOptimizedPlan;
  plans: CauldronOptimizedPlan[];
};

export type CauldronState = {
  targets: ProductionTarget[];
  inputItemIds: CauldronInputTuple;
  machineId: CauldronMachineId;
  candidateIndex: number;
  candidateTargetItemId: string;
  maxCandidates: number;
  allowDuplicateInputs: boolean;
  fuelSourceMode: ExternalSourceMode;
  fertilizerSourceMode: ExternalSourceMode;
  targetItemIdsText: string;
  startupItemIdsText: string;
  observedOutputItemId: string;
  observedTimeSec: string;
  observedHeatPerSec: string;
  observedStatus: CauldronObservedStatus;
  observedNote: string;
};
