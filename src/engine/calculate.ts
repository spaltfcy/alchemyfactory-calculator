import type {
  AbilitySettings,
  AppSettings,
  FertilizerSettings,
  FuelSettings,
  MachineRoundingMode,
  ItemPhysicalState,
  ProductionTarget,
  Recipe,
} from '../types';
import {
  RECIPES,
  recipeById,
  DEFAULT_RECIPE_BY_ITEM_ID,
  getRecipesProducing,
} from '../data/recipes';
import { itemById } from '../data/items';
import { chooseRecipeForItem, isBuyableItem } from './itemSourceResolver';
import {
  getConveyorItemsPerMinute,
  getFertilizerNutritionMultiplier,
  getFuelHeatValueMultiplier,
  getHeatConsumptionMultiplier,
  getProductionSpeedMultiplier,
  getSellPriceMultiplier,
} from '../data/abilityTables';
import {
  FUEL_HEAT_VALUE_BY_ITEM_ID,
  HEAT_CONSUMER_BY_MACHINE_ID,
} from '../data/heat';
import { FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID, FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID } from '../data/fertilizer';
import { safeCeil } from '../utils/format';
import { buildInitialInvestment, type InitialInvestmentData } from './initialInvestment';

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
  surplusOutputRates: Record<string, number>;
  discardedOutputRates: Record<string, number>;
  targetIds: string[];
};

export type CalculatedEndpoint =
  | { type: 'recipe'; recipeId: string }
  | { type: 'itemSource'; itemId: string; sourceMode: 'buy' | 'external' | 'unresolved' }
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
    fuelIterations?: number;
    fuelConverged?: boolean;
    fuelHitMaxIterations?: boolean;
    fuelConvergenceDelta?: number;
    fuelIterationTrace?: Array<{
      iteration: number;
      injectedFuelRate: number;
      nextFuelRate: number;
      delta: number;
    }>;
    byproductIterations?: number;
    calculationMs?: number;
    queueSteps?: number;
    queueMax?: number;
  };
};

export type CalculateInput = {
  targets: ProductionTarget[];
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
};

export type CalculationDebugResult = {
  result: CalculationResult;
  debugLog: CalculationDebugLog;
};

type WorkRole = 'material' | 'fuel' | 'fertilizer';
type DemandLot = { itemId: string; rate: number; consumerRecipeId: string; role: WorkRole };
type SupplyLot = { recipeId: string; itemId: string; rate: number; originalRate: number };
type RunMap = Map<string, number>;
type TargetLock = { recipeId: string; itemId: string; targetId: string; requestedRate: number; actualRate: number; runsPerMinute: number };
type DirectTargetPurchase = { itemId: string; rate: number; targetId: string };
type RunAnalysis = {
  demandLots: DemandLot[];
  demandByItem: Map<string, number>;
  byproductSupplyByItem: Map<string, number>;
  heatByRecipe: Map<string, number>;
  steamByRecipe: Map<string, number>;
  fertilizerNutrientsByRecipe: Map<string, number>;
  heatRequiredPerMin: number;
  steamRequiredPerMin: number;
  steamBoilerRecipeId?: string;
  fertilizerNutrientsRequiredPerMin: number;
  fertilizerRequiredPerMin: number;
};

const EPS = 1e-9;
const VISIBLE_RATE_EPS = EPS;
const SOLVER_RESIDUAL_RATE_EPS = 0.001;
const RESIDUAL_REPORT_RATE_EPS = 0.000001;
const FUEL_CONVERGENCE_EPS = 0.001;
const FUEL_ESTIMATION_RATIO_LIMIT = 0.999999;
const MAX_SOLVE_ITERATIONS = 120;

const DEFAULT_FUEL_SETTINGS: FuelSettings = {
  enabled: true,
  fuelItemId: 'charcoal_powder',
  sourceMode: 'internal',
  heatingMode: 'direct',
  maxIterations: 16,
};

const DEFAULT_FERTILIZER_SETTINGS: FertilizerSettings = {
  enabled: true,
  fertilizerItemId: 'basic_fertilizer',
  sourceMode: 'internal',
  nurseryNutrientsPerSec: 12,
  maxIterations: 4,
};

function normalizeFuelSettings(settings: AppSettings): FuelSettings {
  const fuel = settings.fuel ?? DEFAULT_FUEL_SETTINGS;
  const heatingMode = fuel.heatingMode === 'steam' ? 'steam' : 'direct';
  return {
    ...DEFAULT_FUEL_SETTINGS,
    ...fuel,
    sourceMode: fuel.sourceMode === 'external' ? 'external' : 'internal',
    heatingMode,
    maxIterations: Math.max(1, Math.min(20, Math.floor(Number(fuel.maxIterations ?? 16)))),
  };
}

function normalizeFertilizerSettings(settings: AppSettings): FertilizerSettings {
  const fertilizer = settings.fertilizer ?? DEFAULT_FERTILIZER_SETTINGS;
  return {
    ...DEFAULT_FERTILIZER_SETTINGS,
    ...fertilizer,
    sourceMode: fertilizer.sourceMode === 'external' ? 'external' : 'internal',
    nurseryNutrientsPerSec: Math.max(0, Number(fertilizer.nurseryNutrientsPerSec ?? 12)),
    maxIterations: Math.max(1, Math.min(12, Math.floor(Number(fertilizer.maxIterations ?? 4)))),
  };
}

const STEAM_PER_HEAT_PER_SEC = 3;
const STEAM_HEATING_PAD_BASE_HEAT_PER_SEC = 20;

function selectedSteamBoilerRecipe(recipePreferences: Record<string, string>): Recipe | undefined {
  const preferred = recipePreferences.steam;
  if (preferred && recipeById[preferred]) return recipeById[preferred];
  return recipeById.steam_boiler_low;
}

function steamOutputPerMinute(recipe: Recipe | undefined): number {
  if (!recipe) return 0;
  return outputPerRun(recipe, 'steam') * (60 / recipe.timeSec);
}

function steamHeatInputPerSec(recipe: Recipe | undefined): number {
  return recipe?.heatInputPerSec ?? 0;
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function createItemStat(itemId: string): ItemStat {
  return {
    itemId,
    requested: 0,
    consumed: 0,
    produced: 0,
    purchased: 0,
    initialPurchased: 0,
    reused: 0,
    surplus: 0,
    discarded: 0,
    targetRequested: 0,
    targetActual: 0,
    purchaseCostCopperPerMin: 0,
    initialCostCopper: 0,
    revenueCopperPerMin: 0,
  };
}

function addToRecord(record: Record<string, number>, key: string, value: number): void {
  if (Math.abs(value) <= EPS) return;
  const next = (record[key] ?? 0) + value;
  if (Math.abs(next) <= EPS) delete record[key];
  else record[key] = next;
}

function addToMap(map: Map<string, number>, key: string, value: number): void {
  if (Math.abs(value) <= EPS) return;
  const next = (map.get(key) ?? 0) + value;
  if (Math.abs(next) <= EPS) map.delete(key);
  else map.set(key, next);
}

function addRun(map: RunMap, recipeId: string, runsPerMinute: number): void {
  if (runsPerMinute <= EPS) return;
  addToMap(map, recipeId, runsPerMinute);
}

function cloneRunMap(map: RunMap): RunMap {
  return new Map([...map.entries()].filter(([, value]) => value > EPS));
}

function runRatePerMachine(recipe: Recipe, productionSpeedMultiplier: number): number {
  return (60 / recipe.timeSec) * productionSpeedMultiplier;
}

function outputPerRun(recipe: Recipe, itemId: string): number {
  const output = recipe.outputs.find((x) => x.itemId === itemId);
  if (!output) return 0;
  return output.amount * (output.probability ?? 1);
}

function outputRatePerMachine(recipe: Recipe, itemId: string, productionSpeedMultiplier: number): number {
  return outputPerRun(recipe, itemId) * runRatePerMachine(recipe, productionSpeedMultiplier);
}

function shouldRound(mode: MachineRoundingMode, isFinal: boolean): boolean {
  if (mode === 'all') return true;
  if (mode === 'intermediate' && !isFinal) return true;
  return false;
}

function roundQuantity(rate: number): number {
  return Math.ceil((rate - EPS) / 0.01) * 0.01;
}

function isNurserySeedInput(recipe: Recipe, itemId: string): boolean {
  return recipe.machineId === 'nursery' && itemId.endsWith('_seeds');
}

function heatConsumerBasePerMachinePerSecond(machineId: string): number {
  return HEAT_CONSUMER_BY_MACHINE_ID[machineId]?.heatPerSec ?? 0;
}

function heatPerMachinePerSecond(machineId: string): number {
  return HEAT_CONSUMER_BY_MACHINE_ID[machineId]?.heatPerSec ?? 0;
}

function mapsAlmostEqual(a: RunMap, b: RunMap): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a.entries()) {
    if (Math.abs(value - (b.get(key) ?? 0)) > 0.000001) return false;
  }
  return true;
}

function endpointKey(endpoint: CalculatedEndpoint): string {
  if (endpoint.type === 'recipe') return 'recipe:' + endpoint.recipeId;
  if (endpoint.type === 'itemSource') return 'source:' + endpoint.sourceMode + ':' + endpoint.itemId;
  return 'sink:' + endpoint.sinkMode + ':' + endpoint.itemId;
}

function normalizeVisibleRate(rate: number): number {
  return Math.abs(rate) <= VISIBLE_RATE_EPS ? 0 : rate;
}

function isSolverResidualRate(rate: number): boolean {
  return Number.isFinite(rate) && rate > EPS && rate < SOLVER_RESIDUAL_RATE_EPS;
}

function getItemPhysicalState(itemId: string): ItemPhysicalState {
  return itemById[itemId]?.physicalState;
}

function isPipelineItem(itemId: string): boolean {
  return getItemPhysicalState(itemId) === 'liquid';
}

function flowTransportForItem(
  itemId: string,
  rate: number,
  conveyorItemsPerMinute: number,
): { belts: number; transportKind: FlowTransportKind; transportUnits: number } {
  if (isPipelineItem(itemId)) return { belts: 1, transportKind: 'pipeline', transportUnits: 1 };
  const belts = rate > EPS ? Math.max(1, safeCeil(rate / conveyorItemsPerMinute)) : 0;
  return { belts, transportKind: 'belt', transportUnits: belts };
}


function planItemNameJa(itemId: string): string {
  return itemById[itemId]?.name.ja ?? itemId;
}

function planRecipeNameJa(recipeId: string): string {
  return recipeById[recipeId]?.name.ja ?? recipeId;
}

function isFinitePlanNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasInvalidPlanNumber(value: unknown): boolean {
  return typeof value !== 'number' || !Number.isFinite(value);
}

function isInvalidFlowForStatus(flow: CalculatedFlow): boolean {
  return hasInvalidPlanNumber(flow.rate) || hasInvalidPlanNumber(flow.belts) || hasInvalidPlanNumber(flow.transportUnits);
}

function hasInvalidNumberRecord(record: Record<string, number> | undefined): boolean {
  if (!record) return false;
  return Object.values(record).some((value) => hasInvalidPlanNumber(value));
}

function collectInvalidNumericRecipeIds(result: CalculationResult): Set<string> {
  const ids = new Set<string>();
  for (const stat of Object.values(result.recipeStats)) {
    if (
      hasInvalidPlanNumber(stat.theoreticalMachines) ||
      hasInvalidPlanNumber(stat.actualMachines) ||
      hasInvalidPlanNumber(stat.runsPerMinute) ||
      hasInvalidNumberRecord(stat.inputRates) ||
      hasInvalidNumberRecord(stat.outputRates) ||
      hasInvalidNumberRecord(stat.surplusOutputRates) ||
      hasInvalidNumberRecord(stat.discardedOutputRates)
    ) {
      ids.add(stat.recipeId);
    }
  }
  for (const flow of result.flows) {
    if (!isInvalidFlowForStatus(flow)) continue;
    if (flow.from.type === 'recipe') ids.add(flow.from.recipeId);
    if (flow.to.type === 'recipe') ids.add(flow.to.recipeId);
  }
  return ids;
}

type InvalidCycleStep = {
  fromRecipeId: string;
  toRecipeId: string;
  itemId: string;
  role: CalculatedFlowRole;
};

function rotateCycleKey(recipeIds: string[]): string {
  if (recipeIds.length === 0) return '';
  let best = recipeIds.join('>');
  for (let i = 1; i < recipeIds.length; i += 1) {
    const candidate = recipeIds.slice(i).concat(recipeIds.slice(0, i)).join('>');
    if (candidate < best) best = candidate;
  }
  const reversed = [...recipeIds].reverse();
  for (let i = 0; i < reversed.length; i += 1) {
    const candidate = reversed.slice(i).concat(reversed.slice(0, i)).join('>');
    if (candidate < best) best = candidate;
  }
  return best;
}

function cycleToTextJa(steps: InvalidCycleStep[]): string {
  if (steps.length === 0) return '';
  const parts: string[] = [planRecipeNameJa(steps[0].fromRecipeId)];
  for (const step of steps) {
    parts.push(planItemNameJa(step.itemId) + ' -> ' + planRecipeNameJa(step.toRecipeId));
  }
  return parts.join(' -> ');
}

function cycleToMessageJa(steps: InvalidCycleStep[]): string {
  const firstItem = steps[0]?.itemId;
  if (firstItem) return planItemNameJa(firstItem) + '\u304c\u5faa\u74b0\u3057\u3066\u3044\u307e\u3059\u3002';
  return '\u30ec\u30b7\u30d4\u304c\u5faa\u74b0\u3057\u3066\u3044\u307e\u3059\u3002';
}

function buildInvalidCycleSummaries(result: CalculationResult): CalculationErrorSummary[] {
  const invalidEdges: InvalidCycleStep[] = [];
  for (const flow of result.flows) {
    if (!isInvalidFlowForStatus(flow)) continue;
    if (flow.from.type !== 'recipe' || flow.to.type !== 'recipe') continue;
    invalidEdges.push({
      fromRecipeId: flow.from.recipeId,
      toRecipeId: flow.to.recipeId,
      itemId: flow.itemId,
      role: flow.role,
    });
  }

  const byFrom = new Map<string, InvalidCycleStep[]>();
  for (const edge of invalidEdges) {
    const group = byFrom.get(edge.fromRecipeId) ?? [];
    group.push(edge);
    byFrom.set(edge.fromRecipeId, group);
  }

  const summaries: CalculationErrorSummary[] = [];
  const seen = new Set<string>();
  const maxDepth = 8;

  function dfs(startRecipeId: string, currentRecipeId: string, path: InvalidCycleStep[], visited: Set<string>) {
    if (path.length >= maxDepth) return;
    for (const edge of byFrom.get(currentRecipeId) ?? []) {
      if (edge.toRecipeId === startRecipeId) {
        const cycle = [...path, edge];
        const recipeIds = cycle.map((step) => step.fromRecipeId);
        const key = rotateCycleKey(recipeIds);
        if (seen.has(key)) continue;
        seen.add(key);
        const itemIds = [...new Set(cycle.map((step) => step.itemId))];
        const fullRecipeIds = [...new Set(cycle.flatMap((step) => [step.fromRecipeId, step.toRecipeId]))];
        const cycleTextJa = cycleToTextJa(cycle).replace(/\u001a/g, ' -> ');
        summaries.push({
          code: 'RECIPE_CYCLE_INVALID',
          messageJa: cycleToMessageJa(cycle),
          messageEn: 'A recipe cycle was detected, so the calculation cannot be trusted.',
          cycleTextJa,
          cycleTextEn: fullRecipeIds.map((recipeId) => recipeById[recipeId]?.name.en ?? recipeId).join(' -> '),
          itemIds,
          recipeIds: fullRecipeIds,
        });
        continue;
      }
      if (visited.has(edge.toRecipeId)) continue;
      const nextVisited = new Set(visited);
      nextVisited.add(edge.toRecipeId);
      dfs(startRecipeId, edge.toRecipeId, [...path, edge], nextVisited);
    }
  }

  for (const recipeId of byFrom.keys()) {
    dfs(recipeId, recipeId, [], new Set([recipeId]));
  }

  return summaries.slice(0, 8);
}

function buildInvalidNumericSummary(result: CalculationResult): CalculationErrorSummary | undefined {
  const affectedItemIds = new Set<string>();
  const affectedRecipeIds = collectInvalidNumericRecipeIds(result);

  for (const flow of result.flows) {
    if (!isInvalidFlowForStatus(flow)) continue;
    affectedItemIds.add(flow.itemId);
  }
  for (const stat of Object.values(result.itemStats)) {
    const values = [stat.requested, stat.consumed, stat.produced, stat.purchased, stat.initialPurchased, stat.reused, stat.surplus, stat.discarded, stat.targetRequested, stat.targetActual, stat.purchaseCostCopperPerMin, stat.initialCostCopper, stat.revenueCopperPerMin];
    if (values.some((value) => hasInvalidPlanNumber(value))) affectedItemIds.add(stat.itemId);
  }

  if (affectedItemIds.size === 0 && affectedRecipeIds.size === 0) return undefined;

  return {
    code: 'INVALID_NUMERIC_RESULT',
    messageJa: '\u6709\u9650\u6570\u3067\u306f\u306a\u3044\u8a08\u7b97\u7d50\u679c\u304c\u767a\u751f\u3057\u305f\u305f\u3081\u3001\u8a08\u7b97\u4e0d\u80fd\u3067\u3059\u3002',
    messageEn: 'The result contains non-finite numbers, so the calculation is invalid.',
    itemIds: [...affectedItemIds],
    recipeIds: [...affectedRecipeIds],
  };
}

function finalizeCalculationStatus(result: CalculationResult): CalculationResult {
  const cycleSummaries = buildInvalidCycleSummaries(result);
  const invalidNumericSummary = buildInvalidNumericSummary(result);
  const errorSummaries = [...(result.errorSummaries ?? []), ...cycleSummaries];
  if (invalidNumericSummary) errorSummaries.push(invalidNumericSummary);

  if (errorSummaries.length <= 0) {
    return { ...result, calculationStatus: 'ok', errorSummaries: [] };
  }

  return {
    ...result,
    calculationStatus: 'invalid',
    errorSummaries,
  };
}

export function calculate(input: CalculateInput): CalculationResult {
  const startedAt = nowMs();
  const fuelSettings = normalizeFuelSettings(input.settings);
  const fertilizerSettings = normalizeFertilizerSettings(input.settings);
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const heatConsumptionMultiplier = getHeatConsumptionMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const sellPriceMultiplier = getSellPriceMultiplier(input.abilities, 'shop');
  const fuelHeatValueMultiplier = getFuelHeatValueMultiplier(input.abilities);
  const fertilizerNutritionMultiplier = getFertilizerNutritionMultiplier(input.abilities);
  const selectedFertilizerNutrientsPerSec = fertilizerSettings.enabled
    ? Math.max(0, Number(FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID[fertilizerSettings.fertilizerItemId] ?? fertilizerSettings.nurseryNutrientsPerSec))
    : Math.max(0, Number(fertilizerSettings.nurseryNutrientsPerSec));

  function nurseryNutrientsRequiredPerRun(recipe: Recipe): number {
    if (recipe.machineId !== 'nursery') return 0;
    return Math.max(0, recipe.timeSec * DEFAULT_FERTILIZER_SETTINGS.nurseryNutrientsPerSec);
  }

  function runRateForRecipe(recipe: Recipe): number {
    if (recipe.machineId === 'nursery') {
      const nutrientsRequired = nurseryNutrientsRequiredPerRun(recipe);
      if (nutrientsRequired > EPS && selectedFertilizerNutrientsPerSec > EPS) {
        return (60 * selectedFertilizerNutrientsPerSec * productionSpeedMultiplier) / nutrientsRequired;
      }
    }
    return runRatePerMachine(recipe, productionSpeedMultiplier);
  }

  function outputRateForRecipe(recipe: Recipe, itemId: string): number {
    return outputPerRun(recipe, itemId) * runRateForRecipe(recipe);
  }

  const lockedRuns: RunMap = new Map();
  const locks: TargetLock[] = [];
  const directTargetPurchases: DirectTargetPurchase[] = [];

  for (const target of input.targets) {
    const targetValue = Number(target.value);
    if (!Number.isFinite(targetValue) || targetValue <= EPS) continue;
    const itemId = target.outputItemId;
    if (!itemId) continue;
    const recipe = target.recipeId && recipeById[target.recipeId] ? recipeById[target.recipeId] : chooseRecipeForItem(itemId, input.recipePreferences);
    if (!recipe) {
      directTargetPurchases.push({ itemId, rate: targetValue, targetId: target.id });
      continue;
    }
    const outputRate = outputRateForRecipe(recipe, itemId);
    if (outputRate <= EPS) {
      directTargetPurchases.push({ itemId, rate: targetValue, targetId: target.id });
      continue;
    }
    const machineRunRate = runRateForRecipe(recipe);
    let requestedRate: number;
    let actualMachines: number;
    if (target.mode === 'machines') {
      actualMachines = targetValue;
      requestedRate = actualMachines * outputRate;
    } else {
      requestedRate = targetValue;
      const theoreticalMachines = requestedRate / outputRate;
      actualMachines = shouldRound(input.settings.machineRounding, true) ? safeCeil(theoreticalMachines) : theoreticalMachines;
    }
    const runsPerMinute = actualMachines * machineRunRate;
    const actualRate = outputPerRun(recipe, itemId) * runsPerMinute;
    addRun(lockedRuns, recipe.id, runsPerMinute);
    locks.push({ recipeId: recipe.id, itemId, targetId: target.id, requestedRate, actualRate, runsPerMinute });
  }

  function analyzeRuns(runs: RunMap, injectedFuelRate: number): RunAnalysis {
    const demandLots: DemandLot[] = [];
    const demandByItem = new Map<string, number>();
    const byproductSupplyByItem = new Map<string, number>();
    const heatByRecipe = new Map<string, number>();
    const steamByRecipe = new Map<string, number>();
    const fertilizerNutrientsByRecipe = new Map<string, number>();
    let heatRequiredPerMin = 0;
    let steamRequiredPerMin = 0;
    let fertilizerNutrientsRequiredPerMin = 0;

    function addDemand(lot: DemandLot): void {
      if (lot.rate <= EPS) return;
      demandLots.push(lot);
      addToMap(demandByItem, lot.itemId, lot.rate);
    }

    for (const [recipeId, runsPerMinute] of runs.entries()) {
      const recipe = recipeById[recipeId];
      if (!recipe || runsPerMinute <= EPS) continue;
      const machineRunRate = runRateForRecipe(recipe);
      const actualMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
      const heatPerSec = heatPerMachinePerSecond(recipe.machineId);
      const baseHeatPerSec = heatConsumerBasePerMachinePerSecond(recipe.machineId);
      if (fuelSettings.enabled && heatPerSec > EPS) {
        if (fuelSettings.heatingMode === 'steam' && baseHeatPerSec > EPS) {
          const steamRate = actualMachines * (STEAM_HEATING_PAD_BASE_HEAT_PER_SEC + baseHeatPerSec * heatConsumptionMultiplier) * STEAM_PER_HEAT_PER_SEC;
          if (steamRate > EPS) {
            steamRequiredPerMin += steamRate;
            steamByRecipe.set(recipe.id, steamRate);
          }
        } else {
          const recipeHeat = actualMachines * heatPerSec * 60 * heatConsumptionMultiplier;
          if (recipeHeat > EPS) {
            heatRequiredPerMin += recipeHeat;
            heatByRecipe.set(recipe.id, recipeHeat);
          }
        }
      }
      const recipeNutrients = fertilizerSettings.enabled && recipe.machineId === 'nursery'
        ? runsPerMinute * nurseryNutrientsRequiredPerRun(recipe)
        : 0;
      if (recipeNutrients > EPS) {
        fertilizerNutrientsRequiredPerMin += recipeNutrients;
        fertilizerNutrientsByRecipe.set(recipe.id, recipeNutrients);
      }
      for (const recipeInput of recipe.inputs) {
        if (isNurserySeedInput(recipe, recipeInput.itemId)) continue;
        addDemand({ itemId: recipeInput.itemId, rate: recipeInput.amount * runsPerMinute, consumerRecipeId: recipe.id, role: 'material' });
      }
      for (const output of recipe.outputs) {
        addToMap(byproductSupplyByItem, output.itemId, output.amount * (output.probability ?? 1) * runsPerMinute);
      }
    }
    if (fuelSettings.enabled && fuelSettings.heatingMode === 'steam' && steamRequiredPerMin > EPS) {
      const steamBoiler = selectedSteamBoilerRecipe(input.recipePreferences);
      const steamPerMin = steamOutputPerMinute(steamBoiler);
      const heatPerSec = steamHeatInputPerSec(steamBoiler);
      if (steamBoiler && steamPerMin > EPS && heatPerSec > EPS) {
        heatRequiredPerMin = (steamRequiredPerMin / steamPerMin) * heatPerSec * 60;
        heatByRecipe.set(steamBoiler.id, heatRequiredPerMin);
      }
    }


    if (fuelSettings.enabled && injectedFuelRate > EPS && fuelSettings.sourceMode === 'internal' && heatRequiredPerMin > EPS) {
      for (const [recipeId, recipeHeat] of heatByRecipe.entries()) {
        addDemand({ itemId: fuelSettings.fuelItemId, rate: injectedFuelRate * (recipeHeat / heatRequiredPerMin), consumerRecipeId: recipeId, role: 'fuel' });
      }
    }

    let fertilizerRequiredPerMin = 0;
    if (fertilizerSettings.enabled && fertilizerNutrientsRequiredPerMin > EPS) {
      const nutrientValue = FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerSettings.fertilizerItemId] ?? 0;
      const effectiveNutrientValue = nutrientValue * fertilizerNutritionMultiplier;
      if (effectiveNutrientValue > EPS) {
        fertilizerRequiredPerMin = fertilizerNutrientsRequiredPerMin / effectiveNutrientValue;
        if (fertilizerSettings.sourceMode === 'internal') {
          for (const [recipeId, nutrients] of fertilizerNutrientsByRecipe.entries()) {
            addDemand({ itemId: fertilizerSettings.fertilizerItemId, rate: fertilizerRequiredPerMin * (nutrients / fertilizerNutrientsRequiredPerMin), consumerRecipeId: recipeId, role: 'fertilizer' });
          }
        }
      }
    }

    return {
      demandLots,
      demandByItem,
      byproductSupplyByItem,
      heatByRecipe,
      steamByRecipe,
      fertilizerNutrientsByRecipe,
      heatRequiredPerMin,
      steamRequiredPerMin,
      steamBoilerRecipeId: steamRequiredPerMin > EPS ? selectedSteamBoilerRecipe(input.recipePreferences)?.id : undefined,
      fertilizerNutrientsRequiredPerMin,
      fertilizerRequiredPerMin,
    };
  }

  function desiredRunsFromAnalysis(analysis: RunAnalysis): RunMap {
    const desired = cloneRunMap(lockedRuns);
    for (const [itemId, demandRate] of analysis.demandByItem.entries()) {
      if (demandRate <= EPS) continue;
      const byproductSupply = input.settings.defaultSurplusPolicy === 'reuse' ? (analysis.byproductSupplyByItem.get(itemId) ?? 0) : 0;
      const netRate = Math.max(0, demandRate - byproductSupply);
      if (netRate <= EPS) continue;
      const recipe = chooseRecipeForItem(itemId, input.recipePreferences);
      if (!recipe) continue;
      const outputRate = outputRateForRecipe(recipe, itemId);
      if (outputRate <= EPS) continue;
      const theoreticalMachines = netRate / outputRate;
      const actualMachines = shouldRound(input.settings.machineRounding, false) ? safeCeil(theoreticalMachines) : theoreticalMachines;
      addRun(desired, recipe.id, actualMachines * runRateForRecipe(recipe));
    }
    return desired;
  }

function consumeSupplyLots(lots: SupplyLot[] | undefined, rate: number): number {
  const sourceLots = lots ?? [];
  let remaining = rate;
  for (const lot of sourceLots) {
    if (remaining <= EPS) break;
    if (lot.rate <= EPS) continue;
    const take = Math.min(lot.rate, remaining);
    lot.rate -= take;
    remaining -= take;
  }
  return remaining;
}

function buildSupplyLots(runs: RunMap): Map<string, SupplyLot[]> {
  const lotsByItem = new Map<string, SupplyLot[]>();
  for (const [recipeId, runsPerMinute] of runs.entries()) {
    const recipe = recipeById[recipeId];
    if (!recipe || runsPerMinute <= EPS) continue;
    for (const output of recipe.outputs) {
      const rate = output.amount * (output.probability ?? 1) * runsPerMinute;
      if (rate <= EPS) continue;
      const lot: SupplyLot = { recipeId: recipe.id, itemId: output.itemId, rate, originalRate: rate };
      const lots = lotsByItem.get(output.itemId) ?? [];
      lots.push(lot);
      lotsByItem.set(output.itemId, lots);
    }
  }
  return lotsByItem;
}

function pruneRunsWithUnusedOutputs(candidateRuns: RunMap, injectedFuelRate: number): RunMap {
  let current = cloneRunMap(candidateRuns);

  function consumeLotsForPrune(lots: SupplyLot[] | undefined, rate: number, usedOutputByRecipe: Set<string>): number {
    const sourceLots = lots ?? [];
    let remaining = rate;
    for (const lot of sourceLots) {
      if (remaining <= EPS) break;
      if (lot.rate <= EPS) continue;
      const take = Math.min(lot.rate, remaining);
      if (take > EPS) usedOutputByRecipe.add(lot.recipeId);
      lot.rate -= take;
      remaining -= take;
    }
    return remaining;
  }

  for (let pass = 0; pass < MAX_SOLVE_ITERATIONS; pass += 1) {
    const analysis = analyzeRuns(current, injectedFuelRate);
    const lotsByItem = buildSupplyLots(current);
    const usedOutputByRecipe = new Set<string>();

    for (const lock of locks) {
      consumeLotsForPrune(lotsByItem.get(lock.itemId), lock.actualRate, usedOutputByRecipe);
    }

    for (const demand of analysis.demandLots) {
      consumeLotsForPrune(lotsByItem.get(demand.itemId), demand.rate, usedOutputByRecipe);
    }

    const reductions = new Map<string, number>();
    for (const lots of lotsByItem.values()) {
      for (const lot of lots) {
        if (lot.rate <= EPS) continue;
        if (lot.rate < lot.originalRate - 0.000001) continue;
        if (usedOutputByRecipe.has(lot.recipeId)) continue;
        const currentRuns = current.get(lot.recipeId) ?? 0;
        const lockedRunsForRecipe = lockedRuns.get(lot.recipeId) ?? 0;
        const removableRuns = currentRuns - lockedRunsForRecipe;
        if (removableRuns <= EPS) continue;
        const recipe = recipeById[lot.recipeId];
        if (!recipe) continue;
        const perRun = outputPerRun(recipe, lot.itemId);
        if (perRun <= EPS) continue;
        const reduceBy = Math.min(removableRuns, lot.rate / perRun);
        if (reduceBy > EPS) addToMap(reductions, lot.recipeId, reduceBy);
      }
    }

    if (reductions.size === 0) return current;
    const next = cloneRunMap(current);
    for (const [recipeId, reduceBy] of reductions.entries()) {
      const lockedRunsForRecipe = lockedRuns.get(recipeId) ?? 0;
      const currentRuns = next.get(recipeId) ?? 0;
      const nextRuns = Math.max(lockedRunsForRecipe, currentRuns - reduceBy);
      if (nextRuns <= EPS) next.delete(recipeId);
      else next.set(recipeId, nextRuns);
    }
    if (mapsAlmostEqual(current, next)) return next;
    current = next;
  }
  return current;
}



  function addDemandRuns(map: RunMap, itemId: string, missingRate: number): void {
    if (missingRate <= EPS) return;
    const recipe = chooseRecipeForItem(itemId, input.recipePreferences);
    if (!recipe) return;
    const outputRate = outputRateForRecipe(recipe, itemId);
    if (outputRate <= EPS) return;
    const theoreticalMachines = missingRate / outputRate;
    const actualMachines = shouldRound(input.settings.machineRounding, false) ? safeCeil(theoreticalMachines) : theoreticalMachines;
    addRun(map, recipe.id, actualMachines * runRateForRecipe(recipe));
  }

  function findUnresolvedAutoDemands(runs: RunMap, injectedFuelRate: number): { analysis: RunAnalysis; missingByItem: Map<string, number> } {
    const analysis = analyzeRuns(runs, injectedFuelRate);
    const lotsByItem = buildSupplyLots(runs);

    for (const lock of locks) {
      consumeSupplyLots(lotsByItem.get(lock.itemId), lock.actualRate);
    }

    const missingByItem = new Map<string, number>();
    for (const demand of analysis.demandLots) {
      let remaining = consumeSupplyLots(lotsByItem.get(demand.itemId), demand.rate);
      if (remaining <= EPS) continue;
      const recipe = chooseRecipeForItem(demand.itemId, input.recipePreferences);
      if (!recipe) continue;
      addToMap(missingByItem, demand.itemId, remaining);
    }

    return { analysis, missingByItem };
  }


  function resolveUnmetAutoDemands(candidateRuns: RunMap, injectedFuelRate: number): RunMap {
  let current = cloneRunMap(candidateRuns);
  for (let pass = 0; pass < MAX_SOLVE_ITERATIONS; pass += 1) {
    const { missingByItem } = findUnresolvedAutoDemands(current, injectedFuelRate);
    if (missingByItem.size === 0) return current;

    const next = cloneRunMap(current);
    for (const [itemId, missingRate] of missingByItem.entries()) {
      addDemandRuns(next, itemId, missingRate);
    }

    if (mapsAlmostEqual(current, next)) return next;
    current = next;
  }
  return current;
}


  function solveRuns(injectedFuelRate: number): { runs: RunMap; analysis: RunAnalysis; iterations: number; queueMax: number } {
    let runs = cloneRunMap(lockedRuns);
    let analysis = analyzeRuns(runs, injectedFuelRate);
    let queueMax = runs.size;
    let iterations = 0;

    for (let i = 0; i < MAX_SOLVE_ITERATIONS; i += 1) {
      iterations = i + 1;
      let desired = desiredRunsFromAnalysis(analysis);
      desired = pruneRunsWithUnusedOutputs(desired, injectedFuelRate);
      desired = resolveUnmetAutoDemands(desired, injectedFuelRate);
      // resolveUnmetAutoDemands can add a byproduct producer that makes another
      // primary-output recipe unnecessary. Prune again before accepting the plan.
      desired = pruneRunsWithUnusedOutputs(desired, injectedFuelRate);
      desired = resolveUnmetAutoDemands(desired, injectedFuelRate);
      queueMax = Math.max(queueMax, desired.size);

      const nextAnalysis = analyzeRuns(desired, injectedFuelRate);
      if (mapsAlmostEqual(runs, desired)) {
        runs = desired;
        analysis = nextAnalysis;
        break;
      }

      runs = desired;
      analysis = nextAnalysis;
    }

    return { runs, analysis, iterations, queueMax };
  }

  function buildPlan(injectedFuelRate: number): CalculationResult {
    const solved = solveRuns(injectedFuelRate);
    const { runs, analysis } = solved;
    const itemStats: Record<string, ItemStat> = {};
    const recipeStats: Record<string, RecipeStat> = {};
    const flows: CalculatedFlow[] = [];
    const warnings: PlanWarning[] = [];
    const invalidRootItemIds = new Set<string>();
    const residualUnresolvedFlows: ResidualUnresolvedFlow[] = [];

    function markInvalidRoot(itemId: string): void {
      invalidRootItemIds.add(itemId);
    }

    function stat(itemId: string): ItemStat {
      itemStats[itemId] ??= createItemStat(itemId);
      return itemStats[itemId];
    }

    function addResidualUnresolvedFlow(itemId: string, rate: number, consumerRecipeId: string, role: CalculatedFlowRole): void {
      if (rate < RESIDUAL_REPORT_RATE_EPS) return;
      residualUnresolvedFlows.push({
        itemId,
        itemNameJa: planItemNameJa(itemId),
        rate,
        consumerRecipeId,
        consumerRecipeNameJa: planRecipeNameJa(consumerRecipeId),
        role,
        threshold: SOLVER_RESIDUAL_RATE_EPS,
        reason: 'solver_residual_below_threshold',
      });
    }

    function addFlow(from: CalculatedEndpoint, to: CalculatedEndpoint, itemId: string, rate: number, role: CalculatedFlowRole): void {
      const cleanRate = normalizeVisibleRate(rate);
      if (cleanRate <= 0) return;
      const idBase = endpointKey(from) + '->' + endpointKey(to) + ':' + itemId + ':' + role;
      const existing = flows.find((flow) => flow.id === idBase);
      if (existing) {
        existing.rate = normalizeVisibleRate(existing.rate + cleanRate);
        if (existing.rate <= 0) {
          flows.splice(flows.indexOf(existing), 1);
          return;
        }
        const transport = flowTransportForItem(itemId, existing.rate, conveyorItemsPerMinute);
        existing.belts = transport.belts;
        existing.transportKind = transport.transportKind;
        existing.transportUnits = transport.transportUnits;
        return;
      }
      const transport = flowTransportForItem(itemId, cleanRate, conveyorItemsPerMinute);
      flows.push({
        id: idBase,
        from,
        to,
        itemId,
        rate: cleanRate,
        belts: transport.belts,
        transportKind: transport.transportKind,
        transportUnits: transport.transportUnits,
        role,
      });
    }

    function addPurchase(itemId: string, rate: number): boolean {
      if (rate <= EPS) return true;
      const rounded = roundQuantity(rate);
      const s = stat(itemId);
      const buyPrice = itemById[itemId]?.buyPriceCopper;
      if (buyPrice === undefined) return false;
      s.purchased += rounded;
      s.purchaseCostCopperPerMin += rounded * buyPrice;
      return true;
    }

    function addInitialPurchase(itemId: string, count: number): void {
      if (count <= EPS) return;
      const buyPrice = itemById[itemId]?.buyPriceCopper;
      if (buyPrice === undefined) {
        markInvalidRoot(itemId);
        return;
      }
      const s = stat(itemId);
      s.initialPurchased += count;
      s.initialCostCopper += count * buyPrice;
    }

    const supplyLotsByItem = new Map<string, SupplyLot[]>();
    const targetReservedByItem = new Map<string, number>();


    const steamBoilerRecipeId = analysis.steamBoilerRecipeId;
    if (steamBoilerRecipeId && analysis.steamRequiredPerMin > EPS) {
      const steamBoiler = recipeById[steamBoilerRecipeId];
      const steamPerMin = steamOutputPerMinute(steamBoiler);
      const boilerMachines = steamPerMin > EPS ? analysis.steamRequiredPerMin / steamPerMin : 0;
      recipeStats[steamBoilerRecipeId] = {
        recipeId: steamBoilerRecipeId,
        machineId: steamBoiler?.machineId ?? 'steam_boiler',
        theoreticalMachines: boilerMachines,
        actualMachines: boilerMachines,
        runsPerMinute: boilerMachines,
        inputRates: {},
        outputRates: { steam: analysis.steamRequiredPerMin },
        surplusOutputRates: {},
        discardedOutputRates: {},
        targetIds: [],
      };
    }
    for (const [recipeId, runsPerMinute] of runs.entries()) {
      const recipe = recipeById[recipeId];
      if (!recipe || runsPerMinute <= EPS) continue;
      const machineRunRate = runRateForRecipe(recipe);
      const actualMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
      recipeStats[recipe.id] = {
        recipeId: recipe.id,
        machineId: recipe.machineId,
        theoreticalMachines: actualMachines,
        actualMachines,
        runsPerMinute,
        inputRates: {},
        outputRates: {},
        surplusOutputRates: {},
        discardedOutputRates: {},
        targetIds: [],
      };
    }

    for (const lock of locks) {
      const s = stat(lock.itemId);
      s.targetRequested += lock.requestedRate;
      s.targetActual += lock.actualRate;
      addToMap(targetReservedByItem, lock.itemId, lock.actualRate);
      const rs = recipeStats[lock.recipeId];
      if (rs && !rs.targetIds.includes(lock.targetId)) rs.targetIds.push(lock.targetId);
      addFlow({ type: 'recipe', recipeId: lock.recipeId }, { type: 'itemSink', itemId: lock.itemId, sinkMode: 'final' }, lock.itemId, lock.actualRate, 'finalOutput');
    }

    for (const target of directTargetPurchases) {
      const s = stat(target.itemId);
      s.targetRequested += target.rate;
      s.targetActual += target.rate;
      if (isBuyableItem(target.itemId)) {
        addPurchase(target.itemId, target.rate);
        addFlow({ type: 'itemSource', itemId: target.itemId, sourceMode: 'buy' }, { type: 'itemSink', itemId: target.itemId, sinkMode: 'final' }, target.itemId, target.rate, 'finalOutput');
      } else {
        markInvalidRoot(target.itemId);
        addFlow({ type: 'itemSource', itemId: target.itemId, sourceMode: 'unresolved' }, { type: 'itemSink', itemId: target.itemId, sinkMode: 'final' }, target.itemId, target.rate, 'finalOutput');
      }
    }

    for (const [recipeId, runsPerMinute] of runs.entries()) {
      const recipe = recipeById[recipeId];
      const rs = recipeStats[recipeId];
      if (!recipe || !rs || runsPerMinute <= EPS) continue;
      for (const recipeInput of recipe.inputs) {
        if (isNurserySeedInput(recipe, recipeInput.itemId)) {
          const machineRunRate = runRateForRecipe(recipe);
          const actualMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
          addInitialPurchase(recipeInput.itemId, recipeInput.amount * actualMachines);
          continue;
        }
        addToRecord(rs.inputRates, recipeInput.itemId, recipeInput.amount * runsPerMinute);
      }
      for (const output of recipe.outputs) {
        const rate = output.amount * (output.probability ?? 1) * runsPerMinute;
        const lot: SupplyLot = { recipeId: recipe.id, itemId: output.itemId, rate, originalRate: rate };
        const lots = supplyLotsByItem.get(output.itemId) ?? [];
        lots.push(lot);
        supplyLotsByItem.set(output.itemId, lots);
        stat(output.itemId).produced += rate;
        addToRecord(rs.outputRates, output.itemId, rate);
      }
    }

    // Final outputs consume matching recipe output before ordinary demands do.
    for (const [itemId, reserved] of targetReservedByItem.entries()) {
      consumeSupplyLots(supplyLotsByItem.get(itemId), reserved);
    }

    for (const demand of analysis.demandLots) {
      let remaining = demand.rate;
      const s = stat(demand.itemId);
      s.requested += demand.rate;
      s.consumed += demand.rate;
      const consumer = { type: 'recipe', recipeId: demand.consumerRecipeId } as const;
      const demandRole: CalculatedFlowRole = demand.role === 'fuel' ? 'fuel' : demand.role === 'fertilizer' ? 'fertilizer' : 'material';

      for (const lot of supplyLotsByItem.get(demand.itemId) ?? []) {
        if (remaining <= EPS) break;
        if (lot.rate <= EPS) continue;
        const take = Math.min(lot.rate, remaining);
        lot.rate -= take;
        remaining -= take;
        if (demand.role === 'material') s.reused += take;
        addFlow({ type: 'recipe', recipeId: lot.recipeId }, consumer, demand.itemId, take, demandRole);
      }

      if (remaining > EPS) {
        const recipe = chooseRecipeForItem(demand.itemId, input.recipePreferences);
        if (recipe && isSolverResidualRate(remaining)) {
          addResidualUnresolvedFlow(demand.itemId, remaining, demand.consumerRecipeId, demandRole);
        } else if (isBuyableItem(demand.itemId)) {
          addPurchase(demand.itemId, remaining);
          addFlow({ type: 'itemSource', itemId: demand.itemId, sourceMode: 'buy' }, consumer, demand.itemId, remaining, demandRole);
        } else {
          markInvalidRoot(demand.itemId);
          addFlow({ type: 'itemSource', itemId: demand.itemId, sourceMode: 'unresolved' }, consumer, demand.itemId, remaining, demandRole);
        }
      }
    }
    if (steamBoilerRecipeId && analysis.steamRequiredPerMin > EPS) {
      for (const [recipeId, steamRate] of analysis.steamByRecipe.entries()) {
        addFlow({ type: 'recipe', recipeId: steamBoilerRecipeId }, { type: 'recipe', recipeId }, 'steam', steamRate, 'steam');
      }
    }


    if (fuelSettings.enabled && injectedFuelRate > EPS && fuelSettings.sourceMode === 'external' && analysis.heatRequiredPerMin > EPS) {
      for (const [recipeId, heat] of analysis.heatByRecipe.entries()) {
        const rate = injectedFuelRate * (heat / analysis.heatRequiredPerMin);
        const s = stat(fuelSettings.fuelItemId);
        s.requested += rate;
        s.consumed += rate;
        addFlow({ type: 'itemSource', itemId: fuelSettings.fuelItemId, sourceMode: 'external' }, { type: 'recipe', recipeId }, fuelSettings.fuelItemId, rate, 'fuel');
      }
    }

    if (fertilizerSettings.enabled && analysis.fertilizerRequiredPerMin > EPS && fertilizerSettings.sourceMode === 'external' && analysis.fertilizerNutrientsRequiredPerMin > EPS) {
      for (const [recipeId, nutrients] of analysis.fertilizerNutrientsByRecipe.entries()) {
        const rate = analysis.fertilizerRequiredPerMin * (nutrients / analysis.fertilizerNutrientsRequiredPerMin);
        const s = stat(fertilizerSettings.fertilizerItemId);
        s.requested += rate;
        s.consumed += rate;
        addFlow({ type: 'itemSource', itemId: fertilizerSettings.fertilizerItemId, sourceMode: 'external' }, { type: 'recipe', recipeId }, fertilizerSettings.fertilizerItemId, rate, 'fertilizer');
      }
    }

    for (const [itemId, lots] of supplyLotsByItem.entries()) {
      for (const lot of lots) {
        const leftoverRate = normalizeVisibleRate(lot.rate);
        if (leftoverRate <= 0) continue;
        const rs = recipeStats[lot.recipeId];
        const s = stat(itemId);
        s.surplus += leftoverRate;
        if (rs) addToRecord(rs.surplusOutputRates, itemId, leftoverRate);
        addFlow({ type: 'recipe', recipeId: lot.recipeId }, { type: 'itemSink', itemId, sinkMode: 'surplus' }, itemId, leftoverRate, 'surplus');
      }
    }

    for (const itemId of new Set(input.targets.map((target) => target.outputItemId).filter(Boolean))) {
      const s = stat(itemId as string);
      const sellPrice = itemById[itemId as string]?.sellPriceCopper;
      if (sellPrice !== undefined) s.revenueCopperPerMin = s.targetActual * sellPrice * sellPriceMultiplier;
    }

    if (fuelSettings.enabled && (FUEL_HEAT_VALUE_BY_ITEM_ID[fuelSettings.fuelItemId] ?? 0) <= EPS) {
      warnings.push({ messageJa: fuelSettings.fuelItemId + ' の燃料熱量が未定義です。', messageEn: 'Fuel heat value is not defined for ' + fuelSettings.fuelItemId + '.' });
    }
    if (fertilizerSettings.enabled && analysis.fertilizerNutrientsRequiredPerMin > EPS) {
      const nutrientValue = FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerSettings.fertilizerItemId] ?? 0;
      const nutrientsPerSec = FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID[fertilizerSettings.fertilizerItemId] ?? 0;
      if (nutrientValue <= EPS) warnings.push({ messageJa: fertilizerSettings.fertilizerItemId + ' の肥料栄養値が未定義です。', messageEn: 'Fertilizer nutrient value is not defined for ' + fertilizerSettings.fertilizerItemId + '.' });
      if (nutrientsPerSec <= EPS) warnings.push({ messageJa: fertilizerSettings.fertilizerItemId + ' の毎秒肥料栄養値が未定義です。', messageEn: 'Fertilizer nutrients/sec is not defined for ' + fertilizerSettings.fertilizerItemId + '.' });
    }

    let initialCostCopper = 0;
    let runningCostCopperPerMin = 0;
    let revenueCopperPerMin = 0;
    for (const s of Object.values(itemStats)) {
      initialCostCopper += s.initialCostCopper;
      runningCostCopperPerMin += s.purchaseCostCopperPerMin;
      revenueCopperPerMin += s.revenueCopperPerMin;
    }

    const fuelHeatValue = FUEL_HEAT_VALUE_BY_ITEM_ID[fuelSettings.fuelItemId] ?? 0;
    const effectiveFuelHeatValue = fuelHeatValue * fuelHeatValueMultiplier;
    const fuelRequiredPerMin = fuelSettings.enabled && effectiveFuelHeatValue > EPS ? analysis.heatRequiredPerMin / effectiveFuelHeatValue : 0;

    const conveyorEdges = flows
      .filter((flow) => flow.to.type === 'recipe' && (flow.role === 'material' || flow.role === 'byproductReuse' || flow.role === 'fuel' || flow.role === 'fertilizer'))
      .map((flow): ConveyorEdgeStat => ({
        id: flow.id,
        fromItemId: flow.itemId,
        toRecipeId: flow.to.type === 'recipe' ? flow.to.recipeId : '',
        rate: flow.rate,
        belts: flow.belts,
        transportKind: flow.transportKind,
        transportUnits: flow.transportUnits,
        fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
        sourceKind: flow.from.type === 'recipe' ? 'recipe' : 'item',
        role: flow.role === 'byproductReuse' ? 'byproduct' : flow.role === 'fuel' ? 'fuel' : flow.role === 'fertilizer' ? 'fertilizer' : 'material',
      }));

    const outputEdges = flows
      .filter((flow) => flow.from.type === 'recipe' && flow.to.type === 'itemSink')
      .map((flow): OutputEdgeStat => ({
        id: flow.id,
        fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : '',
        toItemId: flow.itemId,
        rate: flow.rate,
        byproduct: flow.role === 'discard',
        discarded: flow.role === 'discard',
      }));

    return {
      itemStats,
      recipeStats,
      flows,
      conveyorEdges,
      outputEdges,
      warnings,
      residualUnresolvedFlows,
      errorSummaries: invalidRootItemIds.size > 0 ? [{
        code: 'UNRESOLVED_ROOT_ITEM',
        messageJa: '仕入価格もレシピもない根本アイテムがあるため、計算不能です。',
        messageEn: 'The plan has root items with neither a recipe nor a buy price.',
        itemIds: [...invalidRootItemIds],
      }] : [],
      calculationStatus: invalidRootItemIds.size > 0 ? 'invalid' : 'ok',
      totals: {
        initialCostCopper,
        runningCostCopperPerMin,
        purchaseCostCopperPerMin: runningCostCopperPerMin,
        revenueCopperPerMin,
        profitCopperPerMin: revenueCopperPerMin - runningCostCopperPerMin,
        conveyorItemsPerMinute,
        productionSpeedMultiplier,
        heatConsumptionMultiplier,
        sellPriceMultiplier,
        fuelHeatValueMultiplier,
        fertilizerNutritionMultiplier,
        heatRequiredPerMin: analysis.heatRequiredPerMin,
        fuelRequiredPerMin,
        fuelItemId: fuelSettings.fuelItemId,
        fertilizerNutrientsRequiredPerMin: analysis.fertilizerNutrientsRequiredPerMin,
        fertilizerRequiredPerMin: analysis.fertilizerRequiredPerMin,
        fertilizerItemId: fertilizerSettings.fertilizerItemId,
        byproductIterations: solved.iterations,
        queueSteps: solved.iterations,
        queueMax: solved.queueMax,
      },
    };
  }

  let result = buildPlan(0);
  let fuelIterations = 0;
  let fuelConverged = !fuelSettings.enabled;
  let fuelConvergenceDelta = 0;
  const fuelIterationTrace: NonNullable<CalculationResult['totals']['fuelIterationTrace']> = [];

  function appendFuelTrace(injectedFuelRate: number, nextFuelRate: number): void {
    fuelIterations = fuelIterationTrace.length + 1;
    fuelConvergenceDelta = Math.abs(nextFuelRate - injectedFuelRate);
    fuelIterationTrace.push({
      iteration: fuelIterations,
      injectedFuelRate,
      nextFuelRate,
      delta: fuelConvergenceDelta,
    });
  }

  function isFuelConverged(delta: number): boolean {
    return delta <= FUEL_CONVERGENCE_EPS;
  }

  if (fuelSettings.enabled) {
    const baseFuelRate = result.totals.fuelRequiredPerMin;
    appendFuelTrace(0, baseFuelRate);

    if (isFuelConverged(fuelConvergenceDelta)) {
      fuelConverged = true;
    } else {
      const firstInjectedFuelRate = baseFuelRate;
      const firstResult = buildPlan(firstInjectedFuelRate);
      const firstNextFuelRate = firstResult.totals.fuelRequiredPerMin;
      appendFuelTrace(firstInjectedFuelRate, firstNextFuelRate);

      const fuelExpansionRatio =
        Math.abs(firstInjectedFuelRate) > EPS ? (firstNextFuelRate - baseFuelRate) / firstInjectedFuelRate : Number.NaN;
      const estimatedFuelRate =
        Number.isFinite(fuelExpansionRatio) &&
        fuelExpansionRatio > -FUEL_ESTIMATION_RATIO_LIMIT &&
        fuelExpansionRatio < FUEL_ESTIMATION_RATIO_LIMIT
          ? baseFuelRate / (1 - fuelExpansionRatio)
          : Number.NaN;

      if (Number.isFinite(estimatedFuelRate) && estimatedFuelRate >= 0) {
        result = buildPlan(estimatedFuelRate);
        appendFuelTrace(estimatedFuelRate, result.totals.fuelRequiredPerMin);
        fuelConverged = isFuelConverged(fuelConvergenceDelta);
      } else {
        result = firstResult;
        fuelConverged = isFuelConverged(fuelConvergenceDelta);
      }

      while (!fuelConverged && fuelIterations < fuelSettings.maxIterations) {
        const injectedFuelRate = result.totals.fuelRequiredPerMin;
        result = buildPlan(injectedFuelRate);
        appendFuelTrace(injectedFuelRate, result.totals.fuelRequiredPerMin);
        fuelConverged = isFuelConverged(fuelConvergenceDelta);
      }
    }
  }

  const fuelHitMaxIterations = fuelSettings.enabled && !fuelConverged && fuelIterations >= fuelSettings.maxIterations;

  const finalResult: CalculationResult = {
    ...result,
    totals: {
      ...result.totals,
      fuelIterations,
      fuelConverged,
      fuelHitMaxIterations,
      fuelConvergenceDelta,
      fuelIterationTrace,
      calculationMs: Math.max(0, nowMs() - startedAt),
    },
  };
  return finalizeCalculationStatus(buildInitialInvestment(finalResult, input, productionSpeedMultiplier, conveyorItemsPerMinute));
}

export function calculateWithDebug(input: CalculateInput): CalculationDebugResult {
  const result = calculate(input);
  const issues: CalculationDebugIssue[] = [];
  const debugItemNameJa = (itemId: string): string => itemById[itemId]?.name.ja ?? itemId;
  const debugRecipeNameJa = (recipeId: string): string => recipeById[recipeId]?.name.ja ?? recipeId;
  function isFiniteDebugNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
  }
  function invalidNumberFields(record: Record<string, unknown>, fields: string[]): string[] {
    return fields.filter((field) => !isFiniteDebugNumber(record[field]));
  }
  function debugEndpointJa(endpoint: CalculatedEndpoint): string {
    if (endpoint.type === 'recipe') return '\u30ec\u30b7\u30d4:' + debugRecipeNameJa(endpoint.recipeId);
    if (endpoint.type === 'itemSource') {
      const sourceLabel = endpoint.sourceMode === 'external'
        ? '外部生産:'
        : endpoint.sourceMode === 'buy'
          ? '購入:'
          : '未解決:';
      return sourceLabel + debugItemNameJa(endpoint.itemId);
    }
    if (endpoint.type === 'itemSink') {
      const sinkLabel = endpoint.sinkMode === 'final' ? '\u6700\u7d42\u51fa\u529b' : endpoint.sinkMode === 'surplus' ? '\u4f59\u5270' : '\u7834\u68c4';
      return sinkLabel + ':' + debugItemNameJa(endpoint.itemId);
    }
    return '\u4e0d\u660e';
  }
  function compactDebugFlow(flow: CalculatedFlow) {
    return {
      id: flow.id,
      itemId: flow.itemId,
      itemNameJa: debugItemNameJa(flow.itemId),
      role: flow.role,
      from: debugEndpointJa(flow.from),
      to: debugEndpointJa(flow.to),
      rate: flow.rate,
      belts: flow.belts,
      transportKind: flow.transportKind,
      transportUnits: flow.transportUnits,
      invalidFields: invalidNumberFields(flow as unknown as Record<string, unknown>, ['rate', 'belts', 'transportUnits']),
    };
  }
  const flowsByRole: Record<string, number> = {};
  const flowsByTransport: Record<string, number> = {};
  const purchasedAutoCraftableFlows: CalculationDebugLog['purchasedAutoCraftableFlows'] = [];

  for (const flow of result.flows) {
    flowsByRole[flow.role] = (flowsByRole[flow.role] ?? 0) + 1;
    flowsByTransport[flow.transportKind] = (flowsByTransport[flow.transportKind] ?? 0) + 1;

    if (flow.from.type === 'itemSource' && flow.from.sourceMode === 'buy' && flow.to.type === 'recipe') {
      const selectedRecipe = chooseRecipeForItem(flow.itemId, input.recipePreferences);
      if (selectedRecipe && flow.rate > 0.000001) {
        purchasedAutoCraftableFlows.push({
          itemId: flow.itemId,
          rate: flow.rate,
          consumerRecipeId: flow.to.recipeId,
          selectedRecipeId: selectedRecipe.id,
          role: flow.role,
        });
      }
    }
  }

  if (purchasedAutoCraftableFlows.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'AUTO_CRAFTABLE_ITEM_PURCHASED',
      messageJa: 'auto設定で生産レシピがあるアイテムが購入扱いに落ちています。solverで未解決需要が残っている可能性があります。',
      messageEn: 'An auto item with a craftable recipe was purchased. The solver may have left an unresolved demand.',
      data: purchasedAutoCraftableFlows,
    });
  }


  const debugFuelSettings = input.settings.fuel;
  if (debugFuelSettings?.enabled && debugFuelSettings.sourceMode === 'internal') {
    const fuelStat = result.itemStats[debugFuelSettings.fuelItemId];
    if ((fuelStat?.purchased ?? 0) > EPS) {
      issues.push({
        severity: 'warning',
        code: 'FUEL_CRAFT_FELL_BACK_TO_PURCHASE',
        messageJa: '燃料供給が内部生産ですが、燃料アイテムの一部または全部が購入扱いに落ちています。燃料レシピ解決または循環を確認してください。',
        messageEn: 'Fuel supply is set to internal, but some or all of the fuel item fell back to purchase. Check fuel recipe resolution or cycles.',
        data: {
          fuelItemId: debugFuelSettings.fuelItemId,
          purchased: fuelStat?.purchased ?? 0,
          produced: fuelStat?.produced ?? 0,
        },
      });
    }
  }

  if (result.totals.fuelHitMaxIterations) {
    issues.push({
      severity: 'info',
      code: 'FUEL_HIT_MAX_ITERATIONS',
      messageJa: '燃料計算が最大反復回数に到達しました。fuelIterationTrace の delta を確認してください。',
      messageEn: 'Fuel calculation reached the maximum iteration count. Check fuelIterationTrace deltas.',
      data: {
        fuelIterations: result.totals.fuelIterations,
        fuelConvergenceDelta: result.totals.fuelConvergenceDelta,
        fuelIterationTrace: result.totals.fuelIterationTrace,
      },
    });
  }

  for (const stat of Object.values(result.itemStats)) {
    if (stat.surplus > EPS && stat.discarded > EPS) {
      issues.push({
        severity: 'warning',
        code: 'ITEM_HAS_BOTH_SURPLUS_AND_DISCARD',
        messageJa: '同じアイテムに余剰と破棄が同時に出ています。主生成物余りと副産物余りが混在していないか確認してください。',
        messageEn: 'The same item has both surplus and discard. Check whether primary leftovers and byproduct leftovers are mixed.',
        data: {
          itemId: stat.itemId,
          surplus: stat.surplus,
          discarded: stat.discarded,
          surplusFlows: result.flows
            .filter((flow) => flow.itemId === stat.itemId && flow.role === 'surplus')
            .map((flow) => ({
              fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
              rate: flow.rate,
            })),
          discardFlows: result.flows
            .filter((flow) => flow.itemId === stat.itemId && flow.role === 'discard')
            .map((flow) => ({
              fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
              rate: flow.rate,
            })),
          reuseFlows: result.flows
            .filter((flow) => flow.itemId === stat.itemId && flow.role === 'byproductReuse')
            .map((flow) => ({
              fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
              toRecipeId: flow.to.type === 'recipe' ? flow.to.recipeId : undefined,
              rate: flow.rate,
            })),
        },
      });
    }
  }

  const invalidNumericFlows = result.flows.filter((flow) =>
    invalidNumberFields(flow as unknown as Record<string, unknown>, ['rate', 'belts', 'transportUnits']).length > 0,
  );
  if (invalidNumericFlows.length > 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_NUMERIC_FLOW',
      messageJa: '\u6709\u9650\u6570\u3067\u306f\u306a\u3044\u6d41\u91cf\u30fb\u642c\u9001\u672c\u6570\u306e\u30d5\u30ed\u30fc\u304c\u3042\u308a\u307e\u3059\u3002',
      messageEn: 'Some flows have non-finite rate or transport numbers.',
      data: invalidNumericFlows.map(compactDebugFlow),
    });
  }

  const itemNumericFields: Array<keyof ItemStat> = [
    'requested',
    'consumed',
    'produced',
    'purchased',
    'initialPurchased',
    'reused',
    'surplus',
    'discarded',
    'targetRequested',
    'targetActual',
    'purchaseCostCopperPerMin',
    'initialCostCopper',
    'revenueCopperPerMin',
  ];
  const invalidItemStats = Object.values(result.itemStats)
    .map((stat) => ({
      itemId: stat.itemId,
      itemNameJa: debugItemNameJa(stat.itemId),
      invalidFields: invalidNumberFields(stat as unknown as Record<string, unknown>, itemNumericFields as string[]),
      stat,
    }))
    .filter((entry) => entry.invalidFields.length > 0);
  if (invalidItemStats.length > 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_NUMERIC_ITEM_STAT',
      messageJa: '\u6709\u9650\u6570\u3067\u306f\u306a\u3044\u30a2\u30a4\u30c6\u30e0\u96c6\u8a08\u304c\u3042\u308a\u307e\u3059\u3002',
      messageEn: 'Some item statistics contain non-finite numbers.',
      data: invalidItemStats,
    });
  }

  function invalidRateRecordEntries(record: Record<string, number>): Array<{ itemId: string; itemNameJa: string; value: number }> {
    return Object.entries(record)
      .filter(([, value]) => !isFiniteDebugNumber(value))
      .map(([itemId, value]) => ({ itemId, itemNameJa: debugItemNameJa(itemId), value }));
  }

  const invalidRecipeStats = Object.values(result.recipeStats)
    .map((stat) => {
      const invalidFields = invalidNumberFields(stat as unknown as Record<string, unknown>, [
        'theoreticalMachines',
        'actualMachines',
        'runsPerMinute',
      ]);
      const invalidRecords = {
        inputRates: invalidRateRecordEntries(stat.inputRates),
        outputRates: invalidRateRecordEntries(stat.outputRates),
        surplusOutputRates: invalidRateRecordEntries(stat.surplusOutputRates),
        discardedOutputRates: invalidRateRecordEntries(stat.discardedOutputRates),
      };
      const hasInvalidRecord = Object.values(invalidRecords).some((entries) => entries.length > 0);
      return {
        recipeId: stat.recipeId,
        recipeNameJa: debugRecipeNameJa(stat.recipeId),
        invalidFields,
        invalidRecords,
        stat,
        hasInvalidRecord,
      };
    })
    .filter((entry) => entry.invalidFields.length > 0 || entry.hasInvalidRecord);
  if (invalidRecipeStats.length > 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_NUMERIC_RECIPE_STAT',
      messageJa: '\u6709\u9650\u6570\u3067\u306f\u306a\u3044\u30ec\u30b7\u30d4\u96c6\u8a08\u304c\u3042\u308a\u307e\u3059\u3002',
      messageEn: 'Some recipe statistics contain non-finite numbers.',
      data: invalidRecipeStats,
    });
  }


  if (invalidNumericFlows.length > 0) {
    const affectedItemIds = [...new Set(invalidNumericFlows.map((flow) => flow.itemId))].sort();
    const affectedRecipeIds = [
      ...new Set(
        invalidNumericFlows.flatMap((flow) => [
          flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
          flow.to.type === 'recipe' ? flow.to.recipeId : undefined,
        ]).filter((value): value is string => typeof value === 'string'),
      ),
    ].sort();

    issues.push({
      severity: 'warning',
      code: 'INVALID_NUMERIC_CONTEXT',
      messageJa: '非数値が発生しているアイテム・レシピの概要です。',
      messageEn: 'Summary of items and recipes affected by invalid numeric values.',
      data: {
        affectedItems: affectedItemIds.map((itemId) => ({ itemId, itemNameJa: debugItemNameJa(itemId) })),
        affectedRecipes: affectedRecipeIds.map((recipeId) => ({ recipeId, recipeNameJa: debugRecipeNameJa(recipeId) })),
        invalidFlowCount: invalidNumericFlows.length,
        invalidItemStatCount: invalidItemStats.length,
        invalidRecipeStatCount: invalidRecipeStats.length,
      },
    });
  }

  if (invalidNumericFlows.length > 0) {
    const recipeEdges = result.flows.filter((flow) => flow.from.type === 'recipe' && flow.to.type === 'recipe');
    const invalidRecipeIds = new Set<string>();
    for (const flow of invalidNumericFlows) {
      if (flow.from.type === 'recipe') invalidRecipeIds.add(flow.from.recipeId);
      if (flow.to.type === 'recipe') invalidRecipeIds.add(flow.to.recipeId);
    }
    const adjacency = new Map<string, Array<{ toRecipeId: string; itemId: string; itemNameJa: string; role: CalculatedFlowRole; invalid: boolean }>>();
    for (const flow of recipeEdges) {
      if (flow.from.type !== 'recipe' || flow.to.type !== 'recipe') continue;
      const list = adjacency.get(flow.from.recipeId) ?? [];
      list.push({
        toRecipeId: flow.to.recipeId,
        itemId: flow.itemId,
        itemNameJa: debugItemNameJa(flow.itemId),
        role: flow.role,
        invalid: invalidNumericFlows.some((invalidFlow) => invalidFlow.id === flow.id),
      });
      adjacency.set(flow.from.recipeId, list);
    }
    const cycles: unknown[] = [];
    const seenCycles = new Set<string>();
    function dfs(startRecipeId: string, currentRecipeId: string, path: Array<{ recipeId: string; recipeNameJa: string; viaItemId?: string; viaItemNameJa?: string; role?: CalculatedFlowRole; invalid?: boolean }>, depth: number): void {
      if (cycles.length >= 12 || depth > 8) return;
      for (const edge of adjacency.get(currentRecipeId) ?? []) {
        if (edge.toRecipeId === startRecipeId) {
          const cycle = [
            ...path,
            {
              recipeId: startRecipeId,
              recipeNameJa: debugRecipeNameJa(startRecipeId),
              viaItemId: edge.itemId,
              viaItemNameJa: edge.itemNameJa,
              role: edge.role,
              invalid: edge.invalid,
            },
          ];
          const key = cycle.map((step) => step.recipeId).join('>');
          const hasInvalidStep = cycle.some((step) => step.invalid === true);
          if (!seenCycles.has(key) && hasInvalidStep) {
            seenCycles.add(key);
            cycles.push({
              cycleTextJa: cycle
                .map((step) =>
                  step.viaItemNameJa ? step.viaItemNameJa + '→' + step.recipeNameJa : step.recipeNameJa,
                )
                .join(' → '),
              invalidStepCount: cycle.filter((step) => step.invalid === true).length,
              steps: cycle,
            });
          }
          continue;
        }
        if (path.some((step) => step.recipeId === edge.toRecipeId)) continue;
        dfs(
          startRecipeId,
          edge.toRecipeId,
          [
            ...path,
            {
              recipeId: edge.toRecipeId,
              recipeNameJa: debugRecipeNameJa(edge.toRecipeId),
              viaItemId: edge.itemId,
              viaItemNameJa: edge.itemNameJa,
              role: edge.role,
              invalid: edge.invalid,
            },
          ],
          depth + 1,
        );
      }
    }
    for (const recipeId of invalidRecipeIds) {
      dfs(recipeId, recipeId, [{ recipeId, recipeNameJa: debugRecipeNameJa(recipeId) }], 0);
      if (cycles.length >= 12) break;
    }
    if (cycles.length > 0) {
      issues.push({
        severity: 'warning',
        code: 'SUSPECT_RECIPE_CYCLE_WITH_INVALID_NUMBERS',
        messageJa: '\u975e\u6570\u5024\u30d5\u30ed\u30fc\u306b\u95a2\u9023\u3059\u308b\u5faa\u74b0\u5019\u88dc\u304c\u3042\u308a\u307e\u3059\u3002',
        messageEn: 'Recipe cycles related to invalid numeric flows were detected.',
        data: cycles,
      });
    }
  }

  if (input.settings.fuel?.enabled && input.settings.fuel.sourceMode === 'internal' && invalidNumericFlows.some((flow) => flow.itemId === input.settings.fuel?.fuelItemId || flow.role === 'fuel')) {
    issues.push({
      severity: 'warning',
      code: 'FUEL_CRAFT_CHAIN_INVALID_NUMERIC',
      messageJa: '\u81ea\u4f5c\u71c3\u6599\u30e9\u30a4\u30f3\u306e\u4e2d\u3067\u975e\u6570\u5024\u30d5\u30ed\u30fc\u304c\u767a\u751f\u3057\u3066\u3044\u307e\u3059\u3002',
      messageEn: 'Invalid numeric flows were detected inside the crafted fuel chain.',
      data: {
        fuelItemId: input.settings.fuel.fuelItemId,
        fuelItemNameJa: debugItemNameJa(input.settings.fuel.fuelItemId),
        invalidFuelRelatedFlows: invalidNumericFlows
          .filter((flow) => flow.itemId === input.settings.fuel?.fuelItemId || flow.role === 'fuel')
          .map(compactDebugFlow),
      },
    });
  }

  const fertilizerFlowTotal = result.flows
    .filter((flow) => flow.role === 'fertilizer')
    .reduce((sum, flow) => sum + flow.rate, 0);
  const fertilizerDelta = Math.abs(fertilizerFlowTotal - result.totals.fertilizerRequiredPerMin);
  if (fertilizerDelta > 0.001) {
    issues.push({
      severity: 'warning',
      code: 'FERTILIZER_FLOW_TOTAL_MISMATCH',
      messageJa: '肥料の必要量と肥料フロー合計が一致していません。',
      messageEn: 'Fertilizer required rate does not match the total fertilizer flow rate.',
      data: {
        fertilizerItemId: result.totals.fertilizerItemId,
        fertilizerRequiredPerMin: result.totals.fertilizerRequiredPerMin,
        fertilizerFlowTotal,
        delta: fertilizerDelta,
      },
    });
  }

  const invalidNumericFlowIds = new Set(invalidNumericFlows.map((flow) => flow.id));
  const invalidTransportFlows = result.flows.filter((flow) => {
    if (invalidNumericFlowIds.has(flow.id)) return false;
    if (!isFiniteDebugNumber(flow.rate) || !isFiniteDebugNumber(flow.belts) || !isFiniteDebugNumber(flow.transportUnits)) return false;
    if (flow.transportKind === 'pipeline') return flow.transportUnits !== 1 || flow.belts !== 1;
    return flow.transportKind === 'belt' && flow.transportUnits !== flow.belts;
  });
  if (invalidTransportFlows.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'FLOW_TRANSPORT_UNITS_MISMATCH',
      messageJa: '搬送種別と搬送本数の整合が取れていないフローがあります。',
      messageEn: 'Some flows have inconsistent transport kind and transport unit counts.',
      data: invalidTransportFlows.map((flow) => ({
        id: flow.id,
        itemId: flow.itemId,
        role: flow.role,
        rate: flow.rate,
        belts: flow.belts,
        transportKind: flow.transportKind,
        transportUnits: flow.transportUnits,
      })),
    });
  }

  const debugLog: CalculationDebugLog = {
    generatedAt: new Date().toISOString(),
    input: JSON.parse(JSON.stringify(input)) as CalculateInput,
    totals: result.totals,
    warnings: result.warnings,
    issues,
    summary: {
      itemCount: Object.keys(result.itemStats).length,
      recipeCount: Object.keys(result.recipeStats).length,
      flowCount: result.flows.length,
      flowsByRole,
      flowsByTransport,
      purchasedAutoCraftableCount: purchasedAutoCraftableFlows.length,
    },
    initialInvestment: result.initialInvestment,
    residualUnresolvedFlows: result.residualUnresolvedFlows ?? [],
    purchasedAutoCraftableFlows,
    flows: result.flows,
    itemStats: Object.values(result.itemStats).sort((a, b) => a.itemId.localeCompare(b.itemId)),
    recipeStats: Object.values(result.recipeStats).sort((a, b) => a.recipeId.localeCompare(b.recipeId)),
  };

  return { result, debugLog };
}

export function getByproductKeys(): Array<{ key: string; recipeId: string; itemId: string }> {
  return [];
}
