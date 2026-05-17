import type {
  AppSettings,
  Recipe,
} from '../types';
import { getRecipesProducing, recipeById } from '../data/recipes';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import {
  getConveyorItemsPerMinute,
  getAlchemyOutputMultiplierForMachine,
  getFertilizerNutritionMultiplier,
  getFuelHeatValueMultiplier,
  getHeatConsumptionMultiplier,
  getProductionSpeedMultiplier,
  getSellPriceMultiplier,
} from '../data/abilityTables';
import { FUEL_HEAT_VALUE_BY_ITEM_ID, HEAT_CONSUMER_BY_MACHINE_ID } from '../data/heat';
import { FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID, FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID } from '../data/fertilizer';
import { getEffectiveRecipeForCalculation, getEffectiveRecipeMachineId, getEffectiveRecipeTimeSec } from '../data/effectiveRecipes';
import { safeCeil } from '../utils/format';
import { chooseRecipeForItem, isBuyableItem } from './itemSourceResolver';
import type {
  CalculatedEndpoint,
  CalculatedFlow,
  CalculatedFlowRole,
  CalculateInput,
  CalculationErrorSummary,
  CalculationResult,
  ConveyorEdgeStat,
  FlowTransportKind,
  ItemStat,
  OutputEdgeStat,
  PlanWarning,
  RecipeStat,
} from './calculationTypes';
import type { SolverDiagnostics, SelectedRecipeCycleDiagnostic } from './solverDiagnostics';

const EPS = 1e-9;
const MAX_REASONABLE_RATE = 1e18;
const BALANCE_SOLVER_VERSION = '0.9.28' as const;
const BALANCE_SOLVER_MODE = 'structured-balance-v09280';


function structuredQueueSafetyLimit(input: CalculateInput, diagnostics: SolverDiagnostics): number {
  const activeRecipeCount = Math.max(
    1,
    diagnostics.diagnosticBalanceModel?.summary?.activeRecipeCount ?? 0,
    diagnostics.graph?.recipeNodeCount ?? 0,
    input.targets.length,
  );
  const dependencyEdgeCount = Math.max(
    1,
    diagnostics.graph?.dependencyEdgeCount ?? 0,
    diagnostics.activePlanGraph?.dependencyEdgeCount ?? 0,
    diagnostics.diagnosticBalanceModel?.summary?.activeItemCount ?? 0,
  );
  const cyclePenalty = Math.max(0, diagnostics.activePlanCyclicComponents?.length ?? 0) * activeRecipeCount;
  return Math.max(32, activeRecipeCount * dependencyEdgeCount * 4 + activeRecipeCount * 8 + cyclePenalty + input.targets.length * 16);
}

type RunMap = Map<string, number>;
type DemandLot = { itemId: string; rate: number; consumerRecipeId: string; role: CalculatedFlowRole };
type SupplyLot = { recipeId: string; itemId: string; rate: number; originalRate: number };
type SourceMode = 'buy' | 'external' | 'cycleInput' | 'unresolved';
type SourceKind = 'materialBuy' | 'fuelBuy' | 'fertilizerBuy' | 'fuelExternal' | 'fertilizerExternal';
type SourceRole = Extract<CalculatedFlowRole, 'material' | 'fuel' | 'fertilizer'>;
type SourceLot = {
  key: string;
  itemId: string;
  role: SourceRole;
  sourceKind: SourceKind;
  sourceMode: Extract<SourceMode, 'buy' | 'external'>;
  rate: number;
};
type CycleInputLot = {
  key: string;
  itemId: string;
  role: 'material';
  sourceMode: 'cycleInput';
  rate: number;
};
type SourceBucket = Map<string, SourceLot>;
type CycleInputBucket = Map<string, CycleInputLot>;
type AlternateRecipeUse = { itemId: string; selectedRecipeId: string; alternateRecipeId: string; reason: 'selected_recipe_cycle'; rateAdded: number };
type SelectedRecipeCycleBlock = { itemId: string; selectedRecipeId: string; consumerRecipeId: string; reason: 'alternate_recipe_disabled' | 'no_alternate_recipe'; rateBlocked: number; cycleRecipeIds: string[]; cycleItemIds: string[] };
type ByproductFuelUse = { itemId: string; producerRecipeId: string; consumerRecipeId: string; rate: number; preferredFuelEquivalentRate: number };

type StructuredBalanceTrace = {
  mode: 'structured-balance-v09280';
  version: typeof BALANCE_SOLVER_VERSION;
  iterations?: number;
  queueSafetyLimit?: number;
  queueGuardMode?: 'graph-size-derived';
  cycleInputItemIds?: string[];
  cycleInputRates?: Record<string, number>;
  unresolvedItemIds?: string[];
  sourceBuckets?: {
    materialBuy: Record<string, number>;
    fuelBuy: Record<string, number>;
    fertilizerBuy: Record<string, number>;
    fuelExternal: Record<string, number>;
    fertilizerExternal: Record<string, number>;
  };
  coProductReconciliation?: CoProductReconciliationTrace;
  alternateRecipeCompletion: {
    enabled: boolean;
    uses: AlternateRecipeUse[];
    blockedCycles: SelectedRecipeCycleBlock[];
  };
  byproductFuel: {
    enabled: boolean;
    uses: ByproductFuelUse[];
  };
  specialResourceSolution?: SpecialResourceSolutionTrace;
  notesJa: string[];
  notesEn: string[];
};

export type StructuredBalanceSolveResult = {
  result: CalculationResult;
  trace: StructuredBalanceTrace;
};

function addToMap(map: Map<string, number>, key: string, value: number): void {
  if (Math.abs(value) <= EPS) return;
  const next = (map.get(key) ?? 0) + value;
  if (Math.abs(next) <= EPS) map.delete(key);
  else map.set(key, next);
}

function addToRecord(record: Record<string, number>, key: string, value: number): void {
  if (Math.abs(value) <= EPS) return;
  const next = (record[key] ?? 0) + value;
  if (Math.abs(next) <= EPS) delete record[key];
  else record[key] = next;
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


export function getThermalExtractorHeight(settings: AppSettings): number {
  const raw = Number(settings.thermalExtractor?.height ?? 256);
  if (!Number.isFinite(raw)) return 256;
  return Math.floor(raw);
}

export function getThermalExtractorBonusPercent(settings: AppSettings): number {
  return Math.min(200, Math.max(0, getThermalExtractorHeight(settings)) * 25 / 32);
}

export function getThermalExtractorHeightMultiplier(settings: AppSettings): number {
  return 1 + getThermalExtractorBonusPercent(settings) / 100;
}

function thermalHeightMultiplierForRecipe(recipe: Recipe, input: CalculateInput): number {
  return getEffectiveRecipeMachineId(recipe, input.settings) === 'thermal_extractor'
    ? getThermalExtractorHeightMultiplier(input.settings)
    : 1;
}

function alchemyOutputMultiplierForRecipe(recipe: Recipe, input: CalculateInput): number {
  return getAlchemyOutputMultiplierForMachine(getEffectiveRecipeMachineId(recipe, input.settings), input.abilities);
}

function createRecipeStat(recipe: Recipe, runsPerMinute: number, input: CalculateInput, productionSpeedMultiplier: number, conveyorItemsPerMinute: number): RecipeStat {
  const machineRunRate = runRateForRecipe(recipe, input, productionSpeedMultiplier, conveyorItemsPerMinute);
  const theoreticalMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
  const effectiveMachineId = getEffectiveRecipeMachineId(recipe, input.settings);
  const thermalHeightMultiplier = thermalHeightMultiplierForRecipe(recipe, input);
  const alchemyOutputMultiplier = alchemyOutputMultiplierForRecipe(recipe, input);
  return {
    recipeId: recipe.id,
    machineId: effectiveMachineId,
    theoreticalMachines,
    actualMachines: theoreticalMachines,
    runsPerMinute,
    inputRates: {},
    outputRates: {},
    netRates: {},
    surplusOutputRates: {},
    discardedOutputRates: {},
    targetIds: [],
    factorySpeedMultiplier: productionSpeedMultiplier,
    thermalHeightMultiplier,
    thermalExtractorHeight: effectiveMachineId === 'thermal_extractor' ? getThermalExtractorHeight(input.settings) : undefined,
    thermalExtractorBonusPercent: effectiveMachineId === 'thermal_extractor' ? getThermalExtractorBonusPercent(input.settings) : undefined,
    alchemyOutputMultiplier,
    effectiveOutputPerMinuteMultiplier: productionSpeedMultiplier * thermalHeightMultiplier * alchemyOutputMultiplier,
  };
}

function recipeTotalOutputAmount(recipe: Recipe, input: CalculateInput): number {
  return recipe.outputs.reduce((sum, output) => sum + output.amount * (output.probability ?? 1) * alchemyOutputMultiplierForRecipe(recipe, input), 0);
}

function runRateForRecipe(recipe: Recipe, input: CalculateInput, productionSpeedMultiplier: number, conveyorItemsPerMinute: number): number {
  const baseRunRate = 60 / getEffectiveRecipeTimeSec(recipe, input.settings);
  const thermalHeightMultiplier = thermalHeightMultiplierForRecipe(recipe, input);
  const baseWithSpeed = baseRunRate * productionSpeedMultiplier * thermalHeightMultiplier;
  const nutrientInputPerRun = Math.max(0, recipe.nutrientInputPerRun ?? 0);
  if (!input.settings.fertilizer?.enabled || nutrientInputPerRun <= EPS) return baseWithSpeed;

  if (recipe.nutrientRunRateMode === 'logisticsCap') {
    const fertilizerItemId = input.settings.fertilizer.fertilizerItemId;
    const fertilizerNutrientsPerSec = Math.max(0, FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID[fertilizerItemId] ?? 0);
    const nutrientLimitedRunRate = fertilizerNutrientsPerSec > EPS ? (fertilizerNutrientsPerSec * 60) / nutrientInputPerRun : 0;
    const outputAmountPerRun = Math.max(EPS, recipeTotalOutputAmount(recipe, input));
    const logisticsLimitedRunRate = conveyorItemsPerMinute > EPS ? conveyorItemsPerMinute / outputAmountPerRun : 0;
    return Math.min(nutrientLimitedRunRate, logisticsLimitedRunRate);
  }

  if (recipe.nutrientRunRateMode === 'fixedTime') return baseRunRate * thermalHeightMultiplier;

  return baseWithSpeed;
}

function inputPerRun(recipe: Recipe, itemId: string): number {
  return recipe.inputs.reduce((sum, entry) => entry.kind !== 'paradoxableItem' && entry.itemId === itemId ? sum + entry.amount : sum, 0);
}

function outputPerRun(recipe: Recipe, itemId: string, input: CalculateInput): number {
  const multiplier = alchemyOutputMultiplierForRecipe(recipe, input);
  return recipe.outputs.reduce((sum, entry) => entry.itemId === itemId ? sum + entry.amount * (entry.probability ?? 1) * multiplier : sum, 0);
}

function rateBalancePerRun(recipe: Recipe, itemId: string, input: CalculateInput): number {
  return outputPerRun(recipe, itemId, input) - inputPerRun(recipe, itemId);
}

function positiveRatePerRun(recipe: Recipe, itemId: string, input: CalculateInput): number {
  return Math.max(0, rateBalancePerRun(recipe, itemId, input));
}

function recipeItemIds(recipe: Recipe): string[] {
  const ids = new Set<string>();
  for (const input of recipe.inputs) if (input.kind !== 'paradoxableItem') ids.add(input.itemId);
  for (const output of recipe.outputs) ids.add(output.itemId);
  return [...ids];
}

function isPipelineItem(itemId: string): boolean {
  if (itemId === 'steam') return true;
  return (itemById[itemId]?.physicalState ?? 'solid') === 'liquid';
}

function flowTransportForItem(itemId: string, rate: number, conveyorItemsPerMinute: number): { belts: number; transportKind: FlowTransportKind; transportUnits: number } {
  if (isPipelineItem(itemId)) return { belts: 1, transportKind: 'pipeline', transportUnits: 1 };
  const belts = rate > EPS ? Math.max(1, safeCeil(rate / conveyorItemsPerMinute)) : 0;
  return { belts, transportKind: 'belt', transportUnits: belts };
}

function endpointKey(endpoint: CalculatedEndpoint): string {
  if (endpoint.type === 'recipe') return 'recipe:' + endpoint.recipeId;
  if (endpoint.type === 'itemSource') return 'source:' + endpoint.sourceMode + ':' + endpoint.itemId;
  return 'sink:' + endpoint.sinkMode + ':' + endpoint.itemId;
}

function makeFlow(
  from: CalculatedEndpoint,
  to: CalculatedEndpoint,
  itemId: string,
  rate: number,
  role: CalculatedFlowRole,
  conveyorItemsPerMinute: number,
): CalculatedFlow | undefined {
  if (!Number.isFinite(rate) || rate <= EPS) return undefined;
  const transport = flowTransportForItem(itemId, rate, conveyorItemsPerMinute);
  return {
    id: endpointKey(from) + '->' + endpointKey(to) + ':' + itemId + ':' + role,
    from,
    to,
    itemId,
    rate,
    belts: transport.belts,
    transportKind: transport.transportKind,
    transportUnits: transport.transportUnits,
    role,
  };
}

function shouldRoundMachines(mode: AppSettings['machineRounding']): boolean {
  return mode === 'all' || mode === 'intermediate';
}

function isNonFiniteOrHuge(value: number): boolean {
  return !Number.isFinite(value) || Math.abs(value) > MAX_REASONABLE_RATE;
}

function mapAlmostEqual(a: RunMap, b: RunMap): boolean {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const key of keys) {
    if (Math.abs((a.get(key) ?? 0) - (b.get(key) ?? 0)) > 0.000001) return false;
  }
  return true;
}

function cycleInputItemIds(diagnostics: SolverDiagnostics): Set<string> {
  return new Set(diagnostics.activePlanCyclicComponents.flatMap((cycle: SelectedRecipeCycleDiagnostic) => cycle.buyableInputItemIds));
}

function machineHeatPerRun(recipe: Recipe, input: CalculateInput, productionSpeedMultiplier: number): number {
  const heatPerSec = HEAT_CONSUMER_BY_MACHINE_ID[getEffectiveRecipeMachineId(recipe, input.settings)]?.heatPerSec ?? 0;
  if (heatPerSec <= EPS) return 0;
  const runsPerMachine = runRateForRecipe(recipe, input, productionSpeedMultiplier, getConveyorItemsPerMinute(input.abilities));
  if (runsPerMachine <= EPS) return 0;
  return (heatPerSec * 60 * getHeatConsumptionMultiplier(input.abilities)) / runsPerMachine;
}

function recipeHeatInputPerRun(recipe: Recipe, input: CalculateInput, productionSpeedMultiplier: number): number {
  const heatPerSec = recipe.heatInputPerSec ?? 0;
  if (heatPerSec <= EPS) return 0;
  const runsPerMachine = runRateForRecipe(recipe, input, productionSpeedMultiplier, getConveyorItemsPerMinute(input.abilities));
  if (runsPerMachine <= EPS) return 0;
  return (heatPerSec * 60 * getHeatConsumptionMultiplier(input.abilities)) / runsPerMachine;
}

function usesSteamHeating(input: CalculateInput): boolean {
  return Boolean(input.settings.fuel?.enabled && input.settings.fuel.heatingMode === 'steam');
}

function fuelHeatPerRun(recipe: Recipe, input: CalculateInput, productionSpeedMultiplier: number): number {
  if (!input.settings.fuel?.enabled) return 0;
  const directMachineHeat = usesSteamHeating(input) ? 0 : machineHeatPerRun(recipe, input, productionSpeedMultiplier);
  return directMachineHeat + recipeHeatInputPerRun(recipe, input, productionSpeedMultiplier);
}

function steamRequiredPerRun(recipe: Recipe, input: CalculateInput, productionSpeedMultiplier: number): number {
  if (!usesSteamHeating(input)) return 0;
  const heatPerRun = machineHeatPerRun(recipe, input, productionSpeedMultiplier);
  return heatPerRun > EPS ? heatPerRun / 20 : 0;
}

function fertilizerNutrientsPerRun(recipe: Recipe, input: CalculateInput): number {
  if (!input.settings.fertilizer?.enabled) return 0;
  return Math.max(0, recipe.nutrientInputPerRun ?? 0);
}

function addRunForDemand(runs: RunMap, recipe: Recipe, itemId: string, missingRate: number, input: CalculateInput, productionSpeedMultiplier: number, conveyorItemsPerMinute: number): void {
  const effectiveRecipe = getEffectiveRecipeForCalculation(recipe, input.settings);
  const perRun = positiveRatePerRun(effectiveRecipe, itemId, input);
  if (perRun <= EPS) return;
  let neededRuns = missingRate / perRun;
  if (shouldRoundMachines(input.settings.machineRounding)) {
    const machineRunRate = runRateForRecipe(recipe, input, productionSpeedMultiplier, conveyorItemsPerMinute);
    const machines = machineRunRate > EPS ? safeCeil(neededRuns / machineRunRate) : 0;
    neededRuns = machines * machineRunRate;
  }
  addToMap(runs, recipe.id, neededRuns);
}

function initialRunsFromTargets(input: CalculateInput, productionSpeedMultiplier: number, conveyorItemsPerMinute: number): { runs: RunMap; targetRuns: Map<string, number>; targetRates: Map<string, number>; invalidTargets: string[]; invalidNetOutputTargets: Array<{ itemId: string; recipeId: string }> } {
  const runs: RunMap = new Map();
  const targetRuns = new Map<string, number>();
  const targetRates = new Map<string, number>();
  const invalidTargets: string[] = [];
  const invalidNetOutputTargets: Array<{ itemId: string; recipeId: string }> = [];
  const requiredRunsByRecipeAndOutput = new Map<string, Map<string, number>>();

  function addRequiredRun(recipeId: string, outputItemId: string, runsPerMinute: number): void {
    if (runsPerMinute <= EPS) return;
    const byOutput = requiredRunsByRecipeAndOutput.get(recipeId) ?? new Map<string, number>();
    byOutput.set(outputItemId, (byOutput.get(outputItemId) ?? 0) + runsPerMinute);
    requiredRunsByRecipeAndOutput.set(recipeId, byOutput);
  }

  for (const target of input.targets) {
    const targetValue = Number(target.value);
    if (!Number.isFinite(targetValue) || targetValue <= EPS || !target.outputItemId) continue;
    const recipe = target.recipeId && recipeById[target.recipeId]
      ? recipeById[target.recipeId]
      : chooseRecipeForItem(target.outputItemId, input.recipePreferences);
    if (!recipe) {
      invalidTargets.push(target.outputItemId);
      targetRates.set(target.outputItemId, (targetRates.get(target.outputItemId) ?? 0) + targetValue);
      continue;
    }
    const effectiveRecipe = getEffectiveRecipeForCalculation(recipe, input.settings);
    let runsPerMinute: number;
    let targetRate: number;
    if (target.mode === 'machines') {
      runsPerMinute = Math.max(0, targetValue) * runRateForRecipe(recipe, input, productionSpeedMultiplier, conveyorItemsPerMinute);
      const perRun = positiveRatePerRun(effectiveRecipe, target.outputItemId, input);
      if (perRun <= EPS) {
        invalidNetOutputTargets.push({ itemId: target.outputItemId, recipeId: recipe.id });
        continue;
      }
      targetRate = perRun * runsPerMinute;
    } else {
      const perRun = positiveRatePerRun(effectiveRecipe, target.outputItemId, input);
      if (perRun <= EPS) {
        invalidNetOutputTargets.push({ itemId: target.outputItemId, recipeId: recipe.id });
        continue;
      }
      runsPerMinute = targetValue / perRun;
      if (shouldRoundMachines(input.settings.machineRounding)) {
        const machineRunRate = runRateForRecipe(recipe, input, productionSpeedMultiplier, conveyorItemsPerMinute);
        const machines = machineRunRate > EPS ? safeCeil(runsPerMinute / machineRunRate) : 0;
        runsPerMinute = machines * machineRunRate;
      }
      targetRate = positiveRatePerRun(effectiveRecipe, target.outputItemId, input) * runsPerMinute;
    }
    addRequiredRun(recipe.id, target.outputItemId, runsPerMinute);
    targetRates.set(target.outputItemId, (targetRates.get(target.outputItemId) ?? 0) + targetRate);
  }

  // Multi-output targets that use the same recipe are satisfied by the same recipe runs.
  // Same-output targets are additive; different outputs share the recipe line and use the max required run.
  for (const [recipeId, byOutput] of requiredRunsByRecipeAndOutput.entries()) {
    const requiredRuns = Math.max(...byOutput.values());
    if (Number.isFinite(requiredRuns) && requiredRuns > EPS) {
      runs.set(recipeId, requiredRuns);
      targetRuns.set(recipeId, requiredRuns);
    }
  }

  return { runs, targetRuns, targetRates, invalidTargets, invalidNetOutputTargets };
}
function analyzeRuns(runs: RunMap, input: CalculateInput, productionSpeedMultiplier: number): { produced: Map<string, number>; consumed: Map<string, number>; demandLots: DemandLot[]; heatRequiredPerMin: number; steamRequiredPerMin: number; fertilizerNutrientsRequiredPerMin: number } {
  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  const demandLots: DemandLot[] = [];
  let heatRequiredPerMin = 0;
  let steamRequiredPerMin = 0;
  let fertilizerNutrientsRequiredPerMin = 0;

  function addDemand(recipeId: string, itemId: string, rate: number, role: CalculatedFlowRole): void {
    if (rate <= EPS) return;
    addToMap(consumed, itemId, rate);
    demandLots.push({ itemId, rate, consumerRecipeId: recipeId, role });
  }

  for (const [recipeId, runsPerMinute] of runs.entries()) {
    const baseRecipe = recipeById[recipeId];
    if (!baseRecipe || runsPerMinute <= EPS) continue;
    const recipe = getEffectiveRecipeForCalculation(baseRecipe, input.settings);
    for (const itemId of recipeItemIds(recipe)) {
      const difference = rateBalancePerRun(recipe, itemId, input) * runsPerMinute;
      if (difference > EPS) addToMap(produced, itemId, difference);
      else if (difference < -EPS) addDemand(recipe.id, itemId, -difference, 'material');
    }
    const heatPerRun = fuelHeatPerRun(recipe, input, productionSpeedMultiplier);
    if (heatPerRun > EPS) heatRequiredPerMin += heatPerRun * runsPerMinute;
    const steamPerRun = steamRequiredPerRun(recipe, input, productionSpeedMultiplier);
    if (steamPerRun > EPS) {
      const steamRate = steamPerRun * runsPerMinute;
      steamRequiredPerMin += steamRate;
      addDemand(recipe.id, 'steam', steamRate, 'steam');
    }
    const nutrientsPerRun = fertilizerNutrientsPerRun(recipe, input);
    if (nutrientsPerRun > EPS) fertilizerNutrientsRequiredPerMin += nutrientsPerRun * runsPerMinute;
  }

  // Fuel and fertilizer are solved as special resources.
  // analyzeRuns() only returns material demands plus heat/nutrient requirements.

  return { produced, consumed, demandLots, heatRequiredPerMin, steamRequiredPerMin, fertilizerNutrientsRequiredPerMin };
}

function buildSupplyLots(runs: RunMap, input: CalculateInput): Map<string, SupplyLot[]> {
  const map = new Map<string, SupplyLot[]>();
  for (const [recipeId, runsPerMinute] of runs.entries()) {
    const baseRecipe = recipeById[recipeId];
    if (!baseRecipe || runsPerMinute <= EPS) continue;
    const recipe = getEffectiveRecipeForCalculation(baseRecipe, input.settings);
    for (const itemId of recipeItemIds(recipe)) {
      const rate = positiveRatePerRun(recipe, itemId, input) * runsPerMinute;
      if (rate <= EPS) continue;
      const lots = map.get(itemId) ?? [];
      lots.push({ recipeId, itemId, rate, originalRate: rate });
      map.set(itemId, lots);
    }
  }
  return map;
}

function addRunToMap(runs: RunMap, recipeId: string, runsPerMinute: number): void {
  addToMap(runs, recipeId, runsPerMinute);
}

function addRunForDemandWithTracking(
  runs: RunMap,
  trackedRuns: RunMap,
  recipe: Recipe,
  itemId: string,
  missingRate: number,
  input: CalculateInput,
  productionSpeedMultiplier: number,
  conveyorItemsPerMinute: number,
): void {
  const before = runs.get(recipe.id) ?? 0;
  addRunForDemand(runs, recipe, itemId, missingRate, input, productionSpeedMultiplier, conveyorItemsPerMinute);
  const delta = (runs.get(recipe.id) ?? 0) - before;
  if (delta > EPS) addRunToMap(trackedRuns, recipe.id, delta);
}

function addProjectedRecipeOutputs(supplyLotsByItem: Map<string, SupplyLot[]>, recipe: Recipe, runsDelta: number, input: CalculateInput): void {
  if (!Number.isFinite(runsDelta) || runsDelta <= EPS) return;
  const effectiveRecipe = getEffectiveRecipeForCalculation(recipe, input.settings);
  for (const itemId of recipeItemIds(effectiveRecipe)) {
    const rate = positiveRatePerRun(effectiveRecipe, itemId, input) * runsDelta;
    if (rate <= EPS) continue;
    const lots = supplyLotsByItem.get(itemId) ?? [];
    lots.push({ recipeId: recipe.id, itemId, rate, originalRate: rate });
    supplyLotsByItem.set(itemId, lots);
  }
}

function addRunForDemandWithProjection(
  runs: RunMap,
  supplyLotsByItem: Map<string, SupplyLot[]>,
  recipe: Recipe,
  itemId: string,
  missingRate: number,
  input: CalculateInput,
  productionSpeedMultiplier: number,
  conveyorItemsPerMinute: number,
): number {
  const before = runs.get(recipe.id) ?? 0;
  addRunForDemand(runs, recipe, itemId, missingRate, input, productionSpeedMultiplier, conveyorItemsPerMinute);
  const delta = (runs.get(recipe.id) ?? 0) - before;
  if (delta > EPS) addProjectedRecipeOutputs(supplyLotsByItem, recipe, delta, input);
  return Math.max(0, delta);
}

function consumeLots(lots: SupplyLot[] | undefined, rate: number): number {
  let remaining = rate;
  for (const lot of lots ?? []) {
    if (remaining <= EPS) break;
    if (lot.rate <= EPS) continue;
    const take = Math.min(lot.rate, remaining);
    lot.rate -= take;
    remaining -= take;
  }
  return remaining;
}

function sourceKey(kind: SourceKind, itemId: string, role: SourceRole): string {
  return kind + ':' + role + ':' + itemId;
}

function addSource(
  sourceMap: SourceBucket,
  sourceKind: SourceKind,
  itemId: string,
  role: SourceRole,
  rate: number,
  sourceMode: Extract<SourceMode, 'buy' | 'external'>,
): void {
  if (rate <= EPS) return;
  const key = sourceKey(sourceKind, itemId, role);
  const existing = sourceMap.get(key);
  const nextRate = (existing?.rate ?? 0) + rate;
  if (Math.abs(nextRate) <= EPS) sourceMap.delete(key);
  else sourceMap.set(key, { key, itemId, role, sourceKind, sourceMode, rate: nextRate });
}

function addCycleInput(cycleInputs: CycleInputBucket, itemId: string, rate: number): void {
  if (rate <= EPS) return;
  const key = 'cycleInput:material:' + itemId;
  const existing = cycleInputs.get(key);
  const nextRate = (existing?.rate ?? 0) + rate;
  if (Math.abs(nextRate) <= EPS) cycleInputs.delete(key);
  else cycleInputs.set(key, { key, itemId, role: 'material', sourceMode: 'cycleInput', rate: nextRate });
}

function ratesByItem<T extends { itemId: string; rate: number }>(bucket: Map<string, T>): Record<string, number> {
  const record: Record<string, number> = {};
  for (const lot of bucket.values()) addToRecord(record, lot.itemId, lot.rate);
  return record;
}

function sourceRatesByKind(sourceMap: SourceBucket, kind: SourceKind): Record<string, number> {
  const record: Record<string, number> = {};
  for (const lot of sourceMap.values()) {
    if (lot.sourceKind === kind) addToRecord(record, lot.itemId, lot.rate);
  }
  return record;
}

function cloneSourceBucket(sourceMap: SourceBucket): SourceBucket {
  return new Map([...sourceMap.entries()].map(([key, lot]) => [key, { ...lot }]));
}

function cloneCycleInputBucket(cycleInputs: CycleInputBucket): CycleInputBucket {
  return new Map([...cycleInputs.entries()].map(([key, lot]) => [key, { ...lot }]));
}

function sourceUseCostCopper(use: SourceUse): number {
  if (use.sourceKind === 'fuelExternal' || use.sourceKind === 'fertilizerExternal') return 0;
  return use.rate * (itemById[use.itemId]?.buyPriceCopper ?? 0);
}

function sourceUseRatesByKind(sourceUses: SourceUse[], kind: SourceKind | 'cycleInput'): Record<string, number> {
  const record: Record<string, number> = {};
  for (const use of sourceUses) {
    if (use.sourceKind === kind) addToRecord(record, use.itemId, use.rate);
  }
  return record;
}

function sourceUseRate(sourceUses: SourceUse[], itemId: string, role: SourceRole, sourceKind: SourceKind | 'cycleInput'): number {
  return sourceUses.reduce((sum, use) => sum + (use.itemId === itemId && use.role === role && use.sourceKind === sourceKind ? use.rate : 0), 0);
}

type SourceUse = { itemId: string; rate: number; sourceMode: Extract<SourceMode, 'buy' | 'external' | 'cycleInput'>; sourceKind: SourceKind | 'cycleInput'; role: SourceRole };

function isNurseryStartupSeedDemand(consumerRecipeId: string, itemId: string, input: CalculateInput): boolean {
  const baseRecipe = recipeById[consumerRecipeId];
  if (!baseRecipe) return false;
  const recipe = getEffectiveRecipeForCalculation(baseRecipe, input.settings);
  return recipe.machineId === 'nursery' && itemById[itemId]?.category === 'seed' && isBuyableItem(itemId);
}


function consumeSourceBucket(
  sourceMap: SourceBucket,
  itemId: string,
  role: SourceRole,
  sourceKinds: SourceKind[],
  rate: number,
): { remaining: number; uses: SourceUse[] } {
  let remaining = rate;
  const uses: SourceUse[] = [];
  for (const lot of sourceMap.values()) {
    if (remaining <= EPS) break;
    if (lot.itemId !== itemId || lot.role !== role || !sourceKinds.includes(lot.sourceKind) || lot.rate <= EPS) continue;
    const take = Math.min(lot.rate, remaining);
    lot.rate -= take;
    remaining -= take;
    uses.push({ itemId, rate: take, sourceMode: lot.sourceMode, sourceKind: lot.sourceKind, role });
  }
  return { remaining, uses };
}

function consumeCycleInputBucket(cycleInputs: CycleInputBucket, itemId: string, rate: number): { remaining: number; uses: SourceUse[] } {
  let remaining = rate;
  const uses: SourceUse[] = [];
  for (const lot of cycleInputs.values()) {
    if (remaining <= EPS) break;
    if (lot.itemId !== itemId || lot.rate <= EPS) continue;
    const take = Math.min(lot.rate, remaining);
    lot.rate -= take;
    remaining -= take;
    uses.push({ itemId, rate: take, sourceMode: 'cycleInput', sourceKind: 'cycleInput', role: 'material' });
  }
  return { remaining, uses };
}

function consumeRecipeLots(lots: SupplyLot[] | undefined, rate: number): { remaining: number; uses: Array<{ recipeId: string; itemId: string; rate: number }> } {
  let remaining = rate;
  const uses: Array<{ recipeId: string; itemId: string; rate: number }> = [];
  for (const lot of lots ?? []) {
    if (remaining <= EPS) break;
    if (lot.rate <= EPS) continue;
    const take = Math.min(lot.rate, remaining);
    lot.rate -= take;
    remaining -= take;
    uses.push({ recipeId: lot.recipeId, itemId: lot.itemId, rate: take });
  }
  return { remaining, uses };
}

function fuelHeatValue(itemId: string, input: CalculateInput): number {
  return (FUEL_HEAT_VALUE_BY_ITEM_ID[itemId] ?? 0) * getFuelHeatValueMultiplier(input.abilities);
}

function consumeByproductFuelLots(
  supplyLotsByItem: Map<string, SupplyLot[]>,
  preferredFuelItemId: string,
  preferredFuelRate: number,
  input: CalculateInput,
): { remainingPreferredFuelRate: number; uses: ByproductFuelUse[] } {
  const preferredHeat = fuelHeatValue(preferredFuelItemId, input);
  if (!input.settings.useByproductFuel || preferredFuelRate <= EPS || preferredHeat <= EPS) {
    return { remainingPreferredFuelRate: preferredFuelRate, uses: [] };
  }
  let remainingHeat = preferredFuelRate * preferredHeat;
  const uses: ByproductFuelUse[] = [];
  for (const [itemId, lots] of supplyLotsByItem.entries()) {
    if (remainingHeat <= EPS) break;
    const heatValue = fuelHeatValue(itemId, input);
    if (heatValue <= EPS) continue;
    for (const lot of lots) {
      if (remainingHeat <= EPS) break;
      if (lot.rate <= EPS) continue;
      const take = Math.min(lot.rate, remainingHeat / heatValue);
      if (take <= EPS) continue;
      lot.rate -= take;
      const heatTaken = take * heatValue;
      remainingHeat -= heatTaken;
      uses.push({
        itemId,
        producerRecipeId: lot.recipeId,
        consumerRecipeId: '',
        rate: take,
        preferredFuelEquivalentRate: heatTaken / preferredHeat,
      });
    }
  }
  return { remainingPreferredFuelRate: remainingHeat / preferredHeat, uses };
}

function recipeIdsInActiveCycles(diagnostics: SolverDiagnostics): Set<string> {
  return new Set(diagnostics.activePlanCyclicComponents.flatMap((cycle) => cycle.recipeIds));
}

function activeCycleForRecipe(recipeId: string, diagnostics: SolverDiagnostics): SelectedRecipeCycleDiagnostic | undefined {
  return diagnostics.activePlanCyclicComponents.find((cycle) => cycle.recipeIds.includes(recipeId));
}

function cycleBreakers(cycle: SelectedRecipeCycleDiagnostic | undefined): string[] {
  return (cycle?.buyableInputItemIds ?? []).filter((itemId) => isBuyableItem(itemId));
}

function addSelectedRecipeCycleBlock(blocks: SelectedRecipeCycleBlock[], block: SelectedRecipeCycleBlock): void {
  const existing = blocks.find((entry) =>
    entry.itemId === block.itemId
    && entry.selectedRecipeId === block.selectedRecipeId
    && entry.consumerRecipeId === block.consumerRecipeId
    && entry.reason === block.reason
  );
  if (existing) {
    existing.rateBlocked += block.rateBlocked;
    return;
  }
  blocks.push(block);
}

function chooseAlternateRecipeForItem(itemId: string, selectedRecipe: Recipe | undefined, diagnostics: SolverDiagnostics): Recipe | undefined {
  const cycleRecipeIds = recipeIdsInActiveCycles(diagnostics);
  const alternatives = getRecipesProducing(itemId)
    .filter((recipe) => recipe.id !== selectedRecipe?.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return alternatives.find((recipe) => !cycleRecipeIds.has(recipe.id)) ?? alternatives[0];
}


function selectedRecipeCycleCanBeBrokenByInputAlternate(recipe: Recipe, input: CalculateInput, diagnostics: SolverDiagnostics): boolean {
  const activeCycleRecipeIds = recipeIdsInActiveCycles(diagnostics);
  if (!activeCycleRecipeIds.has(recipe.id)) return false;

  for (const recipeInput of recipe.inputs) {
    if (recipeInput.kind === 'paradoxableItem') continue;
    const selectedInputRecipe = chooseRecipeForItem(recipeInput.itemId, input.recipePreferences);
    if (!selectedInputRecipe || !activeCycleRecipeIds.has(selectedInputRecipe.id)) continue;
    const alternate = chooseAlternateRecipeForItem(recipeInput.itemId, selectedInputRecipe, diagnostics);
    if (alternate && alternate.id !== selectedInputRecipe.id && !activeCycleRecipeIds.has(alternate.id)) return true;
  }

  return false;
}


type SolveRunMapResult = {
  runs: RunMap;
  targetRuns: Map<string, number>;
  targetRates: Map<string, number>;
  sources: SourceBucket;
  cycleInputs: CycleInputBucket;
  unresolved: Set<string>;
  iterations: number;
  queueSafetyLimit: number;
  heatRequiredPerMin: number;
  steamRequiredPerMin: number;
  fertilizerNutrientsRequiredPerMin: number;
  alternateRecipeUses: AlternateRecipeUse[];
  selectedRecipeCycleBlocks: SelectedRecipeCycleBlock[];
  invalidNetOutputTargets: Array<{ itemId: string; recipeId: string }>;
  fuelRuns: RunMap;
  fertilizerRuns: RunMap;
};

type SpecialItemCost = {
  itemId: string;
  runs: RunMap;
  sources: SourceBucket;
  cycleInputs: CycleInputBucket;
  unresolved: Set<string>;
  heatPerItemPerMin: number;
  nutrientsPerItemPerMin: number;
  iterations: number;
  queueSafetyLimit: number;
};

type SpecialResourceSolutionTrace = {
  mode: 'none' | 'fuel-only' | 'fertilizer-only' | 'direct-2x2';
  finite: boolean;
  baseHeatRequiredPerMin: number;
  baseFertilizerNutrientsRequiredPerMin: number;
  fuelItemId: string;
  fertilizerItemId: string;
  fuelHeatValue: number;
  fertilizerNutritionValue: number;
  fuelProductionHeatPerMinPerItem: number;
  fuelProductionNutrientsPerMinPerItem: number;
  fertilizerProductionHeatPerMinPerItem: number;
  fertilizerProductionNutrientsPerMinPerItem: number;
  determinant?: number;
  fuelRequiredPerMin: number;
  fertilizerRequiredPerMin: number;
  invalidResourceItemIds?: string[];
};

type SpecialResourceApplication = {
  solution: SpecialResourceSolutionTrace;
  fuelCost?: SpecialItemCost;
  fertilizerCost?: SpecialItemCost;
};

type CoProductReduction = {
  recipeId: string;
  beforeRunsPerMinute: number;
  afterRunsPerMinute: number;
  reducedRunsPerMinute: number;
  surplusBeforeByItemId: Record<string, number>;
};

type CoProductReconciliationTrace = {
  mode: 'co-product-reconcile-v09240';
  applied: boolean;
  iterations: number;
  reductions: CoProductReduction[];
  skippedReason?: string;
};


function estimateDemandByItemForRuns(
  runs: RunMap,
  targetRates: Map<string, number>,
  input: CalculateInput,
  solution: SpecialResourceSolutionTrace,
  productionSpeedMultiplier: number,
): Map<string, number> {
  const analysis = analyzeRuns(runs, input, productionSpeedMultiplier);
  const demand = new Map<string, number>();
  for (const [itemId, rate] of analysis.consumed.entries()) addToMap(demand, itemId, rate);
  for (const [itemId, rate] of targetRates.entries()) addToMap(demand, itemId, rate);
  for (const lot of buildSpecialDemandLots(runs, input, solution, productionSpeedMultiplier)) addToMap(demand, lot.itemId, lot.rate);
  return demand;
}

function estimateSurplusByItemForRuns(
  runs: RunMap,
  targetRates: Map<string, number>,
  input: CalculateInput,
  solution: SpecialResourceSolutionTrace,
  productionSpeedMultiplier: number,
): Map<string, number> {
  const analysis = analyzeRuns(runs, input, productionSpeedMultiplier);
  const demand = estimateDemandByItemForRuns(runs, targetRates, input, solution, productionSpeedMultiplier);
  const surplus = new Map<string, number>();
  for (const [itemId, produced] of analysis.produced.entries()) {
    const extra = produced - (demand.get(itemId) ?? 0);
    if (extra > 0.000001) surplus.set(itemId, extra);
  }
  return surplus;
}

function reconcileCoProductsAfterSpecialResources(
  base: SolveRunMapResult,
  input: CalculateInput,
  solution: SpecialResourceSolutionTrace,
): { solved: SolveRunMapResult; trace: CoProductReconciliationTrace } {
  if (!solution.finite) {
    return {
      solved: base,
      trace: { mode: 'co-product-reconcile-v09240', applied: false, iterations: 0, reductions: [], skippedReason: 'special resource solution is not finite' },
    };
  }

  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const runs = cloneRunMapValues(base.runs);
  const reductions: CoProductReduction[] = [];
  let applied = false;
  let iterations = 0;
  const maxPasses = Math.max(4, Math.min(32, runs.size * 2 + 4));

  for (let pass = 0; pass < maxPasses; pass += 1) {
    iterations = pass + 1;
    const surplus = estimateSurplusByItemForRuns(runs, base.targetRates, input, solution, productionSpeedMultiplier);
    let changed = false;

    for (const [recipeId, currentRuns] of [...runs.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      if (currentRuns <= EPS) continue;
      const baseRecipe = recipeById[recipeId];
      if (!baseRecipe) continue;
      const recipe = getEffectiveRecipeForCalculation(baseRecipe, input.settings);
      const positiveOutputItemIds = recipeItemIds(recipe).filter((itemId) => positiveRatePerRun(recipe, itemId, input) > EPS);
      if (positiveOutputItemIds.length < 2) continue;
      const minimumRuns = base.targetRuns.get(recipeId) ?? 0;
      const maxRemovableByTarget = Math.max(0, currentRuns - minimumRuns);
      if (maxRemovableByTarget <= EPS) continue;

      let removableRuns = Number.POSITIVE_INFINITY;
      const surplusBeforeByItemId: Record<string, number> = {};
      for (const itemId of positiveOutputItemIds) {
        const perRun = positiveRatePerRun(recipe, itemId, input);
        if (perRun <= EPS) continue;
        const itemSurplus = surplus.get(itemId) ?? 0;
        surplusBeforeByItemId[itemId] = itemSurplus;
        if (itemSurplus <= 0.000001) {
          removableRuns = 0;
          break;
        }
        removableRuns = Math.min(removableRuns, itemSurplus / perRun);
      }
      if (!Number.isFinite(removableRuns)) continue;
      const delta = Math.min(removableRuns, maxRemovableByTarget);
      if (delta <= 0.000001) continue;

      const after = currentRuns - delta;
      if (after <= EPS) runs.delete(recipeId);
      else runs.set(recipeId, after);
      reductions.push({
        recipeId,
        beforeRunsPerMinute: currentRuns,
        afterRunsPerMinute: Math.max(0, after),
        reducedRunsPerMinute: delta,
        surplusBeforeByItemId,
      });
      applied = true;
      changed = true;
    }

    if (!changed) break;
  }

  const analysis = analyzeRuns(runs, input, productionSpeedMultiplier);
  return {
    solved: {
      ...base,
      runs,
      heatRequiredPerMin: analysis.heatRequiredPerMin,
      steamRequiredPerMin: analysis.steamRequiredPerMin,
      fertilizerNutrientsRequiredPerMin: analysis.fertilizerNutrientsRequiredPerMin,
    },
    trace: {
      mode: 'co-product-reconcile-v09240',
      applied,
      iterations,
      reductions,
    },
  };
}

function solveRunMap(input: CalculateInput, diagnostics: SolverDiagnostics): SolveRunMapResult {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const { runs, targetRuns, targetRates, invalidTargets, invalidNetOutputTargets } = initialRunsFromTargets(input, productionSpeedMultiplier, conveyorItemsPerMinute);
  const sources: SourceBucket = new Map();
  const cycleInputs: CycleInputBucket = new Map();
  const fuelRuns: RunMap = new Map();
  const fertilizerRuns: RunMap = new Map();
  const unresolved = new Set<string>(invalidTargets);
  if (invalidNetOutputTargets.length > 0) unresolved.add('__net_output_not_positive__');
  const cycleInputIds = cycleInputItemIds(diagnostics);
  const activeCycleRecipeIds = recipeIdsInActiveCycles(diagnostics);
  const alternateRecipeUses: AlternateRecipeUse[] = [];
  const selectedRecipeCycleBlocks: SelectedRecipeCycleBlock[] = [];
  let heatRequiredPerMin = 0;
  let steamRequiredPerMin = 0;
  let fertilizerNutrientsRequiredPerMin = 0;

  const queueSafetyLimit = structuredQueueSafetyLimit(input, diagnostics);
  for (let iteration = 0; iteration < queueSafetyLimit; iteration += 1) {
    const analysis = analyzeRuns(runs, input, productionSpeedMultiplier);
    heatRequiredPerMin = analysis.heatRequiredPerMin;
    steamRequiredPerMin = analysis.steamRequiredPerMin;
    fertilizerNutrientsRequiredPerMin = analysis.fertilizerNutrientsRequiredPerMin;

    const nextRuns: RunMap = new Map(runs);
    const supplyLotsByItem = buildSupplyLots(runs, input);
    const fuelSupplyLotsByItem = buildSupplyLots(fuelRuns, input);
    const fertilizerSupplyLotsByItem = buildSupplyLots(fertilizerRuns, input);
    const sourceLots = cloneSourceBucket(sources);
    const cycleInputLots = cloneCycleInputBucket(cycleInputs);

    // Reserve target outputs first. A target is a final sink, not a reusable supply.
    for (const [itemId, targetRate] of targetRates.entries()) {
      const consumed = consumeRecipeLots(supplyLotsByItem.get(itemId), targetRate);
      if (consumed.remaining > 0.000001) unresolved.add(itemId);
    }

    let changed = false;
    const sortedDemandLots = [...analysis.demandLots].sort((a, b) => {
      const priority = (role: CalculatedFlowRole): number => role === 'material' ? 0 : role === 'steam' ? 1 : role === 'fuel' ? 2 : role === 'fertilizer' ? 3 : 4;
      return priority(a.role) - priority(b.role);
    });

    for (const demand of sortedDemandLots) {
      let remaining = demand.rate;

      if (demand.role === 'material' || demand.role === 'steam') {
        remaining = consumeRecipeLots(supplyLotsByItem.get(demand.itemId), remaining).remaining;
        if (demand.role === 'material') {
          remaining = consumeCycleInputBucket(cycleInputLots, demand.itemId, remaining).remaining;
          remaining = consumeSourceBucket(sourceLots, demand.itemId, 'material', ['materialBuy'], remaining).remaining;
        }
      } else if (demand.role === 'fuel') {
        // Fuel is intentionally isolated from ordinary material supply. Internal fuel lines
        // are tracked separately, and generic byproducts are only usable when useByproductFuel is ON.
        remaining = consumeRecipeLots(fuelSupplyLotsByItem.get(demand.itemId), remaining).remaining;
        if (input.settings.useByproductFuel) {
          remaining = consumeByproductFuelLots(supplyLotsByItem, demand.itemId, remaining, input).remainingPreferredFuelRate;
        }
        remaining = consumeSourceBucket(sourceLots, demand.itemId, 'fuel', ['fuelBuy', 'fuelExternal'], remaining).remaining;
      } else if (demand.role === 'fertilizer') {
        // Fertilizer has its own internal/external source path and must not consume arbitrary material outputs.
        remaining = consumeRecipeLots(fertilizerSupplyLotsByItem.get(demand.itemId), remaining).remaining;
        remaining = consumeSourceBucket(sourceLots, demand.itemId, 'fertilizer', ['fertilizerBuy', 'fertilizerExternal'], remaining).remaining;
      }

      if (remaining <= 0.000001) continue;

      if (demand.role === 'fuel') {
        if (input.settings.fuel?.enabled && input.settings.fuel.sourceMode === 'external' && demand.itemId === input.settings.fuel.fuelItemId) {
          addSource(sources, 'fuelExternal', demand.itemId, 'fuel', remaining, 'external');
          changed = true;
          continue;
        }
        const fuelRecipe = chooseRecipeForItem(demand.itemId, input.recipePreferences);
        if (fuelRecipe) {
          addRunForDemandWithTracking(nextRuns, fuelRuns, fuelRecipe, demand.itemId, remaining, input, productionSpeedMultiplier, conveyorItemsPerMinute);
          changed = true;
          continue;
        }
        if (isBuyableItem(demand.itemId)) {
          addSource(sources, 'fuelBuy', demand.itemId, 'fuel', remaining, 'buy');
          changed = true;
          continue;
        }
        unresolved.add(demand.itemId);
        continue;
      }

      if (demand.role === 'fertilizer') {
        if (input.settings.fertilizer?.enabled && input.settings.fertilizer.sourceMode === 'external' && demand.itemId === input.settings.fertilizer.fertilizerItemId) {
          addSource(sources, 'fertilizerExternal', demand.itemId, 'fertilizer', remaining, 'external');
          changed = true;
          continue;
        }
        const fertilizerRecipe = chooseRecipeForItem(demand.itemId, input.recipePreferences);
        if (fertilizerRecipe) {
          addRunForDemandWithTracking(nextRuns, fertilizerRuns, fertilizerRecipe, demand.itemId, remaining, input, productionSpeedMultiplier, conveyorItemsPerMinute);
          changed = true;
          continue;
        }
        if (isBuyableItem(demand.itemId)) {
          addSource(sources, 'fertilizerBuy', demand.itemId, 'fertilizer', remaining, 'buy');
          changed = true;
          continue;
        }
        unresolved.add(demand.itemId);
        continue;
      }

      if (demand.role === 'material' && cycleInputIds.has(demand.itemId) && isBuyableItem(demand.itemId)) {
        addCycleInput(cycleInputs, demand.itemId, remaining);
        changed = true;
        continue;
      }

      const selectedRecipe = chooseRecipeForItem(demand.itemId, input.recipePreferences);
      let recipeToUse = selectedRecipe;
      if (selectedRecipe && activeCycleRecipeIds.has(selectedRecipe.id)) {
        const cycle = activeCycleForRecipe(selectedRecipe.id, diagnostics);
        const breakers = cycleBreakers(cycle);

        // A selected recipe cycle is valid when the cycle itself has a buyable input
        // that can be used as a cycleInput breaker. Example:
        //   purchased gold_coin -> gold_ingot_2 -> gold_ingot -> gold_coin target.
        // In that case the demanded item (gold_ingot) does not need to be buyable.
        if (breakers.length === 0) {
          if (input.settings.allowAlternateRecipeCompletion) {
            const alternate = chooseAlternateRecipeForItem(demand.itemId, selectedRecipe, diagnostics);
            if (alternate && alternate.id !== selectedRecipe.id) {
              recipeToUse = alternate;
              alternateRecipeUses.push({
                itemId: demand.itemId,
                selectedRecipeId: selectedRecipe.id,
                alternateRecipeId: alternate.id,
                reason: 'selected_recipe_cycle',
                rateAdded: remaining,
              });
            } else if (selectedRecipeCycleCanBeBrokenByInputAlternate(selectedRecipe, input, diagnostics)) {
              // Allow repeated expansion when the recipe itself has no alternate producer, but one of
              // its cyclic inputs can be completed by an alternate recipe outside the cycle.
              // Example: charcoal_powder_from_charcoal exposes charcoal, whose selected cyclic producer
              // coke_and_charcoal can be replaced by charcoal_from_plank.
              recipeToUse = selectedRecipe;
            } else if ((runs.get(selectedRecipe.id) ?? 0) <= EPS) {
              // Allow one expansion step so the actual cycle-closing input can be evaluated.
              recipeToUse = selectedRecipe;
            } else {
              addSelectedRecipeCycleBlock(selectedRecipeCycleBlocks, {
                itemId: demand.itemId,
                selectedRecipeId: selectedRecipe.id,
                consumerRecipeId: demand.consumerRecipeId,
                reason: 'no_alternate_recipe',
                rateBlocked: remaining,
                cycleRecipeIds: cycle?.recipeIds ?? [selectedRecipe.id],
                cycleItemIds: cycle?.itemIds ?? [demand.itemId],
              });
              unresolved.add('__selected_recipe_cycle_unresolved__');
              continue;
            }
          } else {
            addSelectedRecipeCycleBlock(selectedRecipeCycleBlocks, {
              itemId: demand.itemId,
              selectedRecipeId: selectedRecipe.id,
              consumerRecipeId: demand.consumerRecipeId,
              reason: 'alternate_recipe_disabled',
              rateBlocked: remaining,
              cycleRecipeIds: cycle?.recipeIds ?? [selectedRecipe.id],
              cycleItemIds: cycle?.itemIds ?? [demand.itemId],
            });
            unresolved.add('__alternate_recipe_required_but_disabled__');
            continue;
          }
        }
      }

      if (recipeToUse) {
        addRunForDemandWithProjection(nextRuns, supplyLotsByItem, recipeToUse, demand.itemId, remaining, input, productionSpeedMultiplier, conveyorItemsPerMinute);
        changed = true;
        continue;
      }
      if (demand.role === 'material' && isBuyableItem(demand.itemId)) {
        addSource(sources, 'materialBuy', demand.itemId, 'material', remaining, 'buy');
        changed = true;
        continue;
      }
      unresolved.add(demand.itemId);
    }

    const sourceRates = [...sources.values()].map((lot) => lot.rate);
    const cycleInputRates = [...cycleInputs.values()].map((lot) => lot.rate);
    if ([...nextRuns.values()].some(isNonFiniteOrHuge) || sourceRates.some(isNonFiniteOrHuge) || cycleInputRates.some(isNonFiniteOrHuge)) {
      unresolved.add('__non_finite_or_huge__');
      return { runs, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: iteration + 1, queueSafetyLimit, heatRequiredPerMin, steamRequiredPerMin, fertilizerNutrientsRequiredPerMin, alternateRecipeUses, selectedRecipeCycleBlocks, invalidNetOutputTargets, fuelRuns, fertilizerRuns };
    }

    if (!changed || mapAlmostEqual(runs, nextRuns)) {
      return { runs: nextRuns, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: iteration + 1, queueSafetyLimit, heatRequiredPerMin, steamRequiredPerMin, fertilizerNutrientsRequiredPerMin, alternateRecipeUses, selectedRecipeCycleBlocks, invalidNetOutputTargets, fuelRuns, fertilizerRuns };
    }
    runs.clear();
    for (const [recipeId, rate] of nextRuns.entries()) runs.set(recipeId, rate);
  }

  unresolved.add('__solver_did_not_converge__');
  return { runs, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: queueSafetyLimit, queueSafetyLimit, heatRequiredPerMin, steamRequiredPerMin, fertilizerNutrientsRequiredPerMin, alternateRecipeUses, selectedRecipeCycleBlocks, invalidNetOutputTargets, fuelRuns, fertilizerRuns };
}


function cloneRunMapValues(runs: RunMap): RunMap {
  return new Map(runs);
}

function scaleRunMapInto(target: RunMap, source: RunMap, multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier <= EPS) return;
  for (const [recipeId, rate] of source.entries()) addToMap(target, recipeId, rate * multiplier);
}

function scaleSourceBucketInto(target: SourceBucket, source: SourceBucket, multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier <= EPS) return;
  for (const lot of source.values()) addSource(target, lot.sourceKind, lot.itemId, lot.role, lot.rate * multiplier, lot.sourceMode);
}

function scaleCycleInputBucketInto(target: CycleInputBucket, source: CycleInputBucket, multiplier: number): void {
  if (!Number.isFinite(multiplier) || multiplier <= EPS) return;
  for (const lot of source.values()) addCycleInput(target, lot.itemId, lot.rate * multiplier);
}

function specialCostForItem(itemId: string, role: Extract<SourceRole, 'fuel' | 'fertilizer'>, input: CalculateInput, diagnostics: SolverDiagnostics): SpecialItemCost {
  const recipe = chooseRecipeForItem(itemId, input.recipePreferences);
  if (!recipe) {
    const sources: SourceBucket = new Map();
    const unresolved = new Set<string>();
    if (isBuyableItem(itemId)) addSource(sources, role === 'fuel' ? 'fuelBuy' : 'fertilizerBuy', itemId, role, 1, 'buy');
    else unresolved.add(itemId);
    return {
      itemId,
      runs: new Map(),
      sources,
      cycleInputs: new Map(),
      unresolved,
      heatPerItemPerMin: 0,
      nutrientsPerItemPerMin: 0,
      iterations: 0,
      queueSafetyLimit: 0,
    };
  }

  const costInput: CalculateInput = {
    ...input,
    targets: [{ id: 'special-cost-' + itemId, recipeId: recipe.id, outputItemId: itemId, mode: 'rate', value: 1 }],
  };
  const solved = solveRunMap(costInput, diagnostics);
  const analysis = analyzeRuns(solved.runs, input, getProductionSpeedMultiplier(input.abilities));
  return {
    itemId,
    runs: solved.runs,
    sources: solved.sources,
    cycleInputs: solved.cycleInputs,
    unresolved: solved.unresolved,
    heatPerItemPerMin: analysis.heatRequiredPerMin,
    nutrientsPerItemPerMin: analysis.fertilizerNutrientsRequiredPerMin,
    iterations: solved.iterations,
    queueSafetyLimit: solved.queueSafetyLimit,
  };
}

function solveSpecialResources(base: SolveRunMapResult, input: CalculateInput, diagnostics: SolverDiagnostics): SpecialResourceApplication {
  const fuelItemId = input.settings.fuel?.fuelItemId ?? '';
  const fertilizerItemId = input.settings.fertilizer?.fertilizerItemId ?? '';
  const fuelEnabled = Boolean(input.settings.fuel?.enabled && fuelItemId);
  const fertilizerEnabled = Boolean(input.settings.fertilizer?.enabled && fertilizerItemId);
  const fuelHeatValueTotal = fuelEnabled ? (FUEL_HEAT_VALUE_BY_ITEM_ID[fuelItemId] ?? 0) * getFuelHeatValueMultiplier(input.abilities) : 0;
  const fertilizerNutritionValueTotal = fertilizerEnabled ? (FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerItemId] ?? 0) * getFertilizerNutritionMultiplier(input.abilities) : 0;
  const baseHeat = fuelEnabled ? base.heatRequiredPerMin : 0;
  const baseNutrients = fertilizerEnabled ? base.fertilizerNutrientsRequiredPerMin : 0;

  let fuelCost: SpecialItemCost | undefined;
  let fertilizerCost: SpecialItemCost | undefined;
  const hasBaseSpecialResourceDemand = baseHeat > EPS || baseNutrients > EPS;
  if (hasBaseSpecialResourceDemand && fuelEnabled && input.settings.fuel?.sourceMode === 'internal') {
    fuelCost = specialCostForItem(fuelItemId, 'fuel', input, diagnostics);
  }
  if (hasBaseSpecialResourceDemand && fertilizerEnabled && input.settings.fertilizer?.sourceMode === 'internal') {
    fertilizerCost = specialCostForItem(fertilizerItemId, 'fertilizer', input, diagnostics);
  }

  const hf = fuelCost?.heatPerItemPerMin ?? 0;
  const nf = fuelCost?.nutrientsPerItemPerMin ?? 0;
  const hg = fertilizerCost?.heatPerItemPerMin ?? 0;
  const ng = fertilizerCost?.nutrientsPerItemPerMin ?? 0;

  let mode: SpecialResourceSolutionTrace['mode'] = 'none';
  let determinant: number | undefined;
  let finite = true;
  const invalidResourceItemIds: string[] = [];
  let fuelRequiredPerMin = 0;
  let fertilizerRequiredPerMin = 0;

  const fuelResourceNeeded = fuelEnabled && (baseHeat > EPS || (fertilizerEnabled && baseNutrients > EPS && hg > EPS));
  const fertilizerResourceNeeded = fertilizerEnabled && (baseNutrients > EPS || (fuelEnabled && baseHeat > EPS && nf > EPS));
  if (fuelResourceNeeded && fuelHeatValueTotal <= EPS) {
    finite = false;
    invalidResourceItemIds.push(fuelItemId);
  }
  if (fertilizerResourceNeeded && fertilizerNutritionValueTotal <= EPS) {
    finite = false;
    invalidResourceItemIds.push(fertilizerItemId);
  }

  if (finite && fuelEnabled && fertilizerEnabled && (baseHeat > EPS || baseNutrients > EPS)) {
    mode = 'direct-2x2';
    const a11 = 1 - hf / Math.max(EPS, fuelHeatValueTotal);
    const a12 = -hg / Math.max(EPS, fuelHeatValueTotal);
    const a21 = -nf / Math.max(EPS, fertilizerNutritionValueTotal);
    const a22 = 1 - ng / Math.max(EPS, fertilizerNutritionValueTotal);
    const b1 = baseHeat / Math.max(EPS, fuelHeatValueTotal);
    const b2 = baseNutrients / Math.max(EPS, fertilizerNutritionValueTotal);
    determinant = a11 * a22 - a12 * a21;
    if (Math.abs(determinant) <= 1e-12) finite = false;
    else {
      fuelRequiredPerMin = (b1 * a22 - a12 * b2) / determinant;
      fertilizerRequiredPerMin = (a11 * b2 - b1 * a21) / determinant;
    }
  } else if (finite && fuelEnabled && baseHeat > EPS) {
    mode = 'fuel-only';
    const denominator = fuelHeatValueTotal - hf;
    if (denominator <= EPS) finite = false;
    else fuelRequiredPerMin = baseHeat / denominator;
  } else if (finite && fertilizerEnabled && baseNutrients > EPS) {
    mode = 'fertilizer-only';
    const denominator = fertilizerNutritionValueTotal - ng;
    if (denominator <= EPS) finite = false;
    else fertilizerRequiredPerMin = baseNutrients / denominator;
  }

  if (!Number.isFinite(fuelRequiredPerMin) || fuelRequiredPerMin < -0.000001) finite = false;
  if (!Number.isFinite(fertilizerRequiredPerMin) || fertilizerRequiredPerMin < -0.000001) finite = false;
  if (!finite) {
    fuelRequiredPerMin = 0;
    fertilizerRequiredPerMin = 0;
  } else {
    fuelRequiredPerMin = Math.max(0, fuelRequiredPerMin);
    fertilizerRequiredPerMin = Math.max(0, fertilizerRequiredPerMin);
  }

  return {
    fuelCost,
    fertilizerCost,
    solution: {
      mode,
      finite,
      baseHeatRequiredPerMin: baseHeat,
      baseFertilizerNutrientsRequiredPerMin: baseNutrients,
      fuelItemId,
      fertilizerItemId,
      fuelHeatValue: fuelHeatValueTotal,
      fertilizerNutritionValue: fertilizerNutritionValueTotal,
      fuelProductionHeatPerMinPerItem: hf,
      fuelProductionNutrientsPerMinPerItem: nf,
      fertilizerProductionHeatPerMinPerItem: hg,
      fertilizerProductionNutrientsPerMinPerItem: ng,
      determinant,
      fuelRequiredPerMin,
      fertilizerRequiredPerMin,
      invalidResourceItemIds: [...new Set(invalidResourceItemIds)],
    },
  };
}

function applySpecialResourceApplication(base: SolveRunMapResult, input: CalculateInput, application: SpecialResourceApplication): SolveRunMapResult {
  const runs = cloneRunMapValues(base.runs);
  const sources = cloneSourceBucket(base.sources);
  const cycleInputs = cloneCycleInputBucket(base.cycleInputs);
  const unresolved = new Set(base.unresolved);
  const solution = application.solution;

  if (!solution.finite) {
    if ((solution.invalidResourceItemIds ?? []).length > 0) unresolved.add('__invalid_special_resource_item__');
    else unresolved.add('__special_resource_self_amplifying__');
  }

  const usesInternalFuelCost = solution.finite
    && input.settings.fuel?.enabled
    && input.settings.fuel.sourceMode === 'internal'
    && solution.fuelRequiredPerMin > EPS
    && Boolean(application.fuelCost);
  const usesInternalFertilizerCost = solution.finite
    && input.settings.fertilizer?.enabled
    && input.settings.fertilizer.sourceMode === 'internal'
    && solution.fertilizerRequiredPerMin > EPS
    && Boolean(application.fertilizerCost);

  if (usesInternalFuelCost) {
    for (const itemId of application.fuelCost?.unresolved ?? []) unresolved.add(itemId);
  }
  if (usesInternalFertilizerCost) {
    for (const itemId of application.fertilizerCost?.unresolved ?? []) unresolved.add(itemId);
  }

  if (solution.finite && input.settings.fuel?.enabled && solution.fuelRequiredPerMin > EPS) {
    if (input.settings.fuel.sourceMode === 'external') addSource(sources, 'fuelExternal', solution.fuelItemId, 'fuel', solution.fuelRequiredPerMin, 'external');
    else if (application.fuelCost) {
      scaleRunMapInto(runs, application.fuelCost.runs, solution.fuelRequiredPerMin);
      scaleSourceBucketInto(sources, application.fuelCost.sources, solution.fuelRequiredPerMin);
      scaleCycleInputBucketInto(cycleInputs, application.fuelCost.cycleInputs, solution.fuelRequiredPerMin);
    }
  }

  if (solution.finite && input.settings.fertilizer?.enabled && solution.fertilizerRequiredPerMin > EPS) {
    if (input.settings.fertilizer.sourceMode === 'external') addSource(sources, 'fertilizerExternal', solution.fertilizerItemId, 'fertilizer', solution.fertilizerRequiredPerMin, 'external');
    else if (application.fertilizerCost) {
      scaleRunMapInto(runs, application.fertilizerCost.runs, solution.fertilizerRequiredPerMin);
      scaleSourceBucketInto(sources, application.fertilizerCost.sources, solution.fertilizerRequiredPerMin);
      scaleCycleInputBucketInto(cycleInputs, application.fertilizerCost.cycleInputs, solution.fertilizerRequiredPerMin);
    }
  }

  const analysis = analyzeRuns(runs, input, getProductionSpeedMultiplier(input.abilities));
  return {
    ...base,
    runs,
    sources,
    cycleInputs,
    unresolved,
    iterations: base.iterations
      + (usesInternalFuelCost ? application.fuelCost?.iterations ?? 0 : 0)
      + (usesInternalFertilizerCost ? application.fertilizerCost?.iterations ?? 0 : 0),
    queueSafetyLimit: base.queueSafetyLimit
      + (usesInternalFuelCost ? application.fuelCost?.queueSafetyLimit ?? 0 : 0)
      + (usesInternalFertilizerCost ? application.fertilizerCost?.queueSafetyLimit ?? 0 : 0),
    heatRequiredPerMin: analysis.heatRequiredPerMin,
    steamRequiredPerMin: analysis.steamRequiredPerMin,
    fertilizerNutrientsRequiredPerMin: analysis.fertilizerNutrientsRequiredPerMin,
  };
}

function buildSpecialDemandLots(runs: RunMap, input: CalculateInput, solution: SpecialResourceSolutionTrace, productionSpeedMultiplier: number): DemandLot[] {
  const demands: DemandLot[] = [];
  if (!solution.finite) return demands;
  let totalHeat = 0;
  let totalNutrients = 0;
  const heatByRecipe = new Map<string, number>();
  const nutrientsByRecipe = new Map<string, number>();
  for (const [recipeId, runsPerMinute] of runs.entries()) {
    const baseRecipe = recipeById[recipeId];
    if (!baseRecipe || runsPerMinute <= EPS) continue;
    const recipe = getEffectiveRecipeForCalculation(baseRecipe, input.settings);
    const heat = fuelHeatPerRun(recipe, input, productionSpeedMultiplier) * runsPerMinute;
    const nutrients = fertilizerNutrientsPerRun(recipe, input) * runsPerMinute;
    if (heat > EPS) {
      heatByRecipe.set(recipeId, heat);
      totalHeat += heat;
    }
    if (nutrients > EPS) {
      nutrientsByRecipe.set(recipeId, nutrients);
      totalNutrients += nutrients;
    }
  }
  if (input.settings.fuel?.enabled && solution.fuelRequiredPerMin > EPS && totalHeat > EPS) {
    for (const [recipeId, heat] of heatByRecipe.entries()) {
      demands.push({ itemId: solution.fuelItemId, rate: solution.fuelRequiredPerMin * (heat / totalHeat), consumerRecipeId: recipeId, role: 'fuel' });
    }
  }
  if (input.settings.fertilizer?.enabled && solution.fertilizerRequiredPerMin > EPS && totalNutrients > EPS) {
    for (const [recipeId, nutrients] of nutrientsByRecipe.entries()) {
      demands.push({ itemId: solution.fertilizerItemId, rate: solution.fertilizerRequiredPerMin * (nutrients / totalNutrients), consumerRecipeId: recipeId, role: 'fertilizer' });
    }
  }
  return demands;
}

function buildConveyorAndOutputEdges(flows: CalculatedFlow[]): { conveyorEdges: ConveyorEdgeStat[]; outputEdges: OutputEdgeStat[] } {
  const conveyorEdges: ConveyorEdgeStat[] = [];
  const outputEdges: OutputEdgeStat[] = [];
  for (const flow of flows) {
    if (flow.to.type === 'recipe') {
      conveyorEdges.push({
        id: flow.id,
        fromItemId: flow.itemId,
        toRecipeId: flow.to.recipeId,
        rate: flow.rate,
        belts: flow.belts,
        transportKind: flow.transportKind,
        transportUnits: flow.transportUnits,
        fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
        sourceKind: flow.from.type === 'recipe' ? 'recipe' : 'item',
        role: flow.role === 'fuel' || flow.role === 'fertilizer' ? flow.role : flow.role === 'byproductReuse' ? 'byproduct' : 'material',
      });
    }
    if (flow.from.type === 'recipe' && flow.to.type === 'itemSink') {
      outputEdges.push({
        id: flow.id,
        fromRecipeId: flow.from.recipeId,
        toItemId: flow.itemId,
        rate: flow.rate,
        byproduct: flow.role === 'surplus' || flow.role === 'discard' || flow.role === 'byproductReuse',
        discarded: flow.role === 'discard',
      });
    }
  }
  return { conveyorEdges, outputEdges };
}

export function calculateStructuredBalance(input: CalculateInput, diagnostics: SolverDiagnostics): StructuredBalanceSolveResult {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const sellPriceMultiplier = getSellPriceMultiplier(input.abilities, 'shop');
  const baseSolved = solveRunMap(input, diagnostics);
  const specialApplication = solveSpecialResources(baseSolved, input, diagnostics);
  const appliedSolved = applySpecialResourceApplication(baseSolved, input, specialApplication);
  const coProductReconciliation = reconcileCoProductsAfterSpecialResources(appliedSolved, input, specialApplication.solution);
  const solved = coProductReconciliation.solved;
  const itemStats: Record<string, ItemStat> = {};
  const recipeStats: Record<string, RecipeStat> = {};
  const flows: CalculatedFlow[] = [];
  const warnings: PlanWarning[] = [];
  const purchaseCostByItem = new Map<string, number>();
  const byproductFuelUses: ByproductFuelUse[] = [];
  const actualSourceUses: SourceUse[] = [];
  const nurseryStartupSeedPurchases = new Map<string, { recipeId: string; itemId: string; count: number; costCopper: number }>();

  function stat(itemId: string): ItemStat {
    itemStats[itemId] ??= createItemStat(itemId);
    return itemStats[itemId];
  }

  function pushFlow(flow: CalculatedFlow | undefined): void {
    if (flow) flows.push(flow);
  }

  function registerNurseryStartupSeedPurchase(recipeId: string, itemId: string): void {
    const key = recipeId + ':' + itemId;
    if (nurseryStartupSeedPurchases.has(key)) return;
    const recipeStat = recipeStats[recipeId];
    const machineCount = Math.max(1, safeCeil(Math.max(0, recipeStat?.actualMachines ?? 1)));
    const price = itemById[itemId]?.buyPriceCopper ?? 0;
    nurseryStartupSeedPurchases.set(key, { recipeId, itemId, count: machineCount, costCopper: machineCount * price });
  }

  for (const [recipeId, runsPerMinute] of solved.runs.entries()) {
    const baseRecipe = recipeById[recipeId];
    if (!baseRecipe || runsPerMinute <= EPS) continue;
    const recipe = getEffectiveRecipeForCalculation(baseRecipe, input.settings);
    const recipeStat = createRecipeStat(recipe, runsPerMinute, input, productionSpeedMultiplier, conveyorItemsPerMinute);
    recipeStats[recipeId] = recipeStat;
    for (const inputEntry of recipe.inputs) addToRecord(recipeStat.inputRates, inputEntry.itemId, inputEntry.amount * runsPerMinute);
    for (const itemId of recipeItemIds(recipe)) {
      const rate = outputPerRun(recipe, itemId, input) * runsPerMinute;
      if (rate > EPS) addToRecord(recipeStat.outputRates, itemId, rate);
    }
    for (const itemId of recipeItemIds(recipe)) {
      const difference = rateBalancePerRun(recipe, itemId, input) * runsPerMinute;
      addToRecord(recipeStat.netRates, itemId, difference);
      if (difference > EPS) stat(itemId).produced += difference;
    }
  }

  const targetRecipeIdsByItem = new Map<string, string[]>();
  for (const target of input.targets) {
    const targetValue = Number(target.value);
    if (!Number.isFinite(targetValue) || targetValue <= EPS || !target.outputItemId) continue;
    const recipe = target.recipeId && recipeById[target.recipeId]
      ? recipeById[target.recipeId]
      : chooseRecipeForItem(target.outputItemId, input.recipePreferences);
    if (recipe && recipeStats[recipe.id] && !recipeStats[recipe.id].targetIds.includes(target.id)) {
      recipeStats[recipe.id].targetIds.push(target.id);
      const ids = targetRecipeIdsByItem.get(target.outputItemId) ?? [];
      ids.push(recipe.id);
      targetRecipeIdsByItem.set(target.outputItemId, ids);
    }
  }

  for (const [itemId, targetRate] of solved.targetRates.entries()) {
    const s = stat(itemId);
    s.targetRequested += targetRate;
    s.targetActual += targetRate;
    const sell = itemById[itemId]?.sellPriceCopper ?? 0;
    s.revenueCopperPerMin += targetRate * sell * sellPriceMultiplier;
  }

  function sourceCostCopper(lot: SourceLot | CycleInputLot): number {
    if ('sourceKind' in lot && (lot.sourceKind === 'fuelExternal' || lot.sourceKind === 'fertilizerExternal')) return 0;
    return lot.rate * (itemById[lot.itemId]?.buyPriceCopper ?? 0);
  }


  const analysis = analyzeRuns(solved.runs, input, productionSpeedMultiplier);
  const specialDemandLots = buildSpecialDemandLots(solved.runs, input, specialApplication.solution, productionSpeedMultiplier);
  const supplyLotsByItem = buildSupplyLots(solved.runs, input);

  for (const [itemId, targetRate] of solved.targetRates.entries()) {
    const consumed = consumeRecipeLots(supplyLotsByItem.get(itemId), targetRate);
    for (const use of consumed.uses) {
      pushFlow(makeFlow({ type: 'recipe', recipeId: use.recipeId }, { type: 'itemSink', itemId, sinkMode: 'final' }, itemId, use.rate, 'finalOutput', conveyorItemsPerMinute));
    }
  }

  const sourceAvailable = cloneSourceBucket(solved.sources);
  const cycleInputAvailable = cloneCycleInputBucket(solved.cycleInputs);
  const sortedDemandLots = [...analysis.demandLots, ...specialDemandLots].sort((a, b) => {
    const priority = (role: CalculatedFlowRole): number => role === 'material' ? 0 : role === 'steam' ? 1 : role === 'fuel' ? 2 : role === 'fertilizer' ? 3 : 4;
    return priority(a.role) - priority(b.role);
  });

  for (const demand of sortedDemandLots) {
    const s = stat(demand.itemId);
    if (demand.role !== 'fuel') {
      s.requested += demand.rate;
      s.consumed += demand.rate;
    }
    const consumer = { type: 'recipe', recipeId: demand.consumerRecipeId } as const;

    let remaining = demand.rate;

    if (demand.role === 'material' || demand.role === 'steam') {
      const recipeUse = consumeRecipeLots(supplyLotsByItem.get(demand.itemId), remaining);
      remaining = recipeUse.remaining;
      for (const use of recipeUse.uses) {
        s.reused += use.rate;
        pushFlow(makeFlow({ type: 'recipe', recipeId: use.recipeId }, consumer, use.itemId, use.rate, demand.role, conveyorItemsPerMinute));
      }
    } else if (demand.role === 'fuel') {
      if (input.settings.fuel?.sourceMode === 'internal') {
        const recipeUse = consumeRecipeLots(supplyLotsByItem.get(demand.itemId), remaining);
        remaining = recipeUse.remaining;
        for (const use of recipeUse.uses) {
          const fuelStat = stat(use.itemId);
          fuelStat.requested += use.rate;
          fuelStat.consumed += use.rate;
          pushFlow(makeFlow({ type: 'recipe', recipeId: use.recipeId }, consumer, use.itemId, use.rate, 'fuel', conveyorItemsPerMinute));
        }
      }

      if (false && solved.selectedRecipeCycleBlocks.length === 0 && solved.unresolved.size === 0 && input.settings.useByproductFuel) {
        const byproductFuel = consumeByproductFuelLots(supplyLotsByItem, demand.itemId, remaining, input);
        remaining = byproductFuel.remainingPreferredFuelRate;
        for (const use of byproductFuel.uses) {
          const fuelUse = { ...use, consumerRecipeId: demand.consumerRecipeId };
          byproductFuelUses.push(fuelUse);
          const fuelStat = stat(use.itemId);
          fuelStat.requested += use.rate;
          fuelStat.consumed += use.rate;
          pushFlow(makeFlow({ type: 'recipe', recipeId: use.producerRecipeId }, consumer, use.itemId, use.rate, 'fuel', conveyorItemsPerMinute));
        }
      }
    } else if (demand.role === 'fertilizer') {
      if (input.settings.fertilizer?.sourceMode === 'internal') {
        const recipeUse = consumeRecipeLots(supplyLotsByItem.get(demand.itemId), remaining);
        remaining = recipeUse.remaining;
        for (const use of recipeUse.uses) {
          pushFlow(makeFlow({ type: 'recipe', recipeId: use.recipeId }, consumer, use.itemId, use.rate, 'fertilizer', conveyorItemsPerMinute));
        }
      }
    }

    if (demand.role === 'material') {
      const cycleUse = consumeCycleInputBucket(cycleInputAvailable, demand.itemId, remaining);
      remaining = cycleUse.remaining;
      for (const use of cycleUse.uses) {
        actualSourceUses.push(use);
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: 'cycleInput' }, consumer, use.itemId, use.rate, 'material', conveyorItemsPerMinute));
      }

      const sourceUse = consumeSourceBucket(sourceAvailable, demand.itemId, 'material', ['materialBuy'], remaining);
      remaining = sourceUse.remaining;
      const isStartupSeed = isNurseryStartupSeedDemand(demand.consumerRecipeId, demand.itemId, input);
      for (const use of sourceUse.uses) {
        if (isStartupSeed && use.sourceMode === 'buy' && use.sourceKind === 'materialBuy') {
          registerNurseryStartupSeedPurchase(demand.consumerRecipeId, use.itemId);
        } else {
          actualSourceUses.push(use);
        }
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: use.sourceMode }, consumer, use.itemId, use.rate, 'material', conveyorItemsPerMinute));
      }
    } else if (demand.role === 'fuel') {
      const sourceUse = consumeSourceBucket(sourceAvailable, demand.itemId, 'fuel', ['fuelBuy', 'fuelExternal'], remaining);
      remaining = sourceUse.remaining;
      for (const use of sourceUse.uses) {
        actualSourceUses.push(use);
        const fuelStat = stat(use.itemId);
        fuelStat.requested += use.rate;
        fuelStat.consumed += use.rate;
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: use.sourceMode }, consumer, use.itemId, use.rate, 'fuel', conveyorItemsPerMinute));
      }
    } else if (demand.role === 'fertilizer') {
      const sourceUse = consumeSourceBucket(sourceAvailable, demand.itemId, 'fertilizer', ['fertilizerBuy', 'fertilizerExternal'], remaining);
      remaining = sourceUse.remaining;
      for (const use of sourceUse.uses) {
        actualSourceUses.push(use);
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: use.sourceMode }, consumer, use.itemId, use.rate, 'fertilizer', conveyorItemsPerMinute));
      }
    }

    if (remaining > 0.000001) solved.unresolved.add(demand.itemId);
  }

  for (const use of actualSourceUses) {
    const s = stat(use.itemId);
    s.purchased += use.rate;
    const cost = sourceUseCostCopper(use);
    s.purchaseCostCopperPerMin += cost;
    addToMap(purchaseCostByItem, use.itemId, cost);
  }

  let initialCostCopper = 0;
  const initialRequiredByRecipe: Record<string, string[]> = {};
  const initialPurchasedItemIds = new Set<string>();
  for (const purchase of nurseryStartupSeedPurchases.values()) {
    const s = stat(purchase.itemId);
    s.initialPurchased += purchase.count;
    s.initialCostCopper += purchase.costCopper;
    initialCostCopper += purchase.costCopper;
    initialPurchasedItemIds.add(purchase.itemId);
    const required = initialRequiredByRecipe[purchase.recipeId] ?? [];
    if (!required.includes(purchase.itemId)) required.push(purchase.itemId);
    initialRequiredByRecipe[purchase.recipeId] = required;
  }

  for (const [itemId, lots] of supplyLotsByItem.entries()) {
    for (const lot of lots) {
      if (lot.rate <= EPS) continue;
      const explicitPolicy = input.surplusPolicies[itemId];
      const policy = explicitPolicy === 'reuse' || explicitPolicy === 'discard'
        ? explicitPolicy
        : input.settings.defaultSurplusPolicy;
      const s = stat(itemId);
      s.surplus += lot.rate;
      const recipeStat = recipeStats[lot.recipeId];
      if (recipeStat) addToRecord(recipeStat.surplusOutputRates, itemId, lot.rate);
      if (policy === 'discard') {
        s.discarded += lot.rate;
        if (recipeStat) addToRecord(recipeStat.discardedOutputRates, itemId, lot.rate);
        pushFlow(makeFlow({ type: 'recipe', recipeId: lot.recipeId }, { type: 'itemSink', itemId, sinkMode: 'discard' }, itemId, lot.rate, 'discard', conveyorItemsPerMinute));
      } else {
        pushFlow(makeFlow({ type: 'recipe', recipeId: lot.recipeId }, { type: 'itemSink', itemId, sinkMode: 'surplus' }, itemId, lot.rate, 'surplus', conveyorItemsPerMinute));
      }
    }
  }

  const blockedCycleItemIds = new Set(solved.selectedRecipeCycleBlocks.flatMap((block) => block.cycleItemIds));
  const invalidRootItemIds = [...solved.unresolved].filter((itemId) => !itemId.startsWith('__') && !blockedCycleItemIds.has(itemId));
  const errorSummaries: CalculationErrorSummary[] = [];
  if (invalidRootItemIds.length > 0) {
    const shownRootItemIds = invalidRootItemIds.slice(0, 10);
    const hiddenRootCount = Math.max(0, invalidRootItemIds.length - shownRootItemIds.length);
    const suffixJa = hiddenRootCount > 0 ? ' ほか' + hiddenRootCount + '件' : '';
    const suffixEn = hiddenRootCount > 0 ? ' and ' + hiddenRootCount + ' more' : '';
    errorSummaries.push({
      code: 'UNRESOLVED_ROOT_ITEM',
      messageJa: shownRootItemIds.map((itemId) => itemById[itemId]?.name.ja ?? itemId).join(' / ') + suffixJa + ' の入手方法がありません。',
      messageEn: 'No source is available for: ' + shownRootItemIds.join(' / ') + suffixEn,
      itemIds: invalidRootItemIds,
    });
  }
  if (solved.unresolved.has('__net_output_not_positive__')) {
    const itemIds = [...new Set(solved.invalidNetOutputTargets.map((target) => target.itemId))];
    const recipeIds = [...new Set(solved.invalidNetOutputTargets.map((target) => target.recipeId))];
    errorSummaries.push({
      code: 'NET_OUTPUT_NOT_POSITIVE',
      messageJa: '選択レシピは指定アイテムを差引で生産しません。入力と確率出力の差を確認してください。',
      messageEn: 'The selected recipe does not produce the target item on balance. Check inputs and probabilistic outputs.',
      itemIds,
      recipeIds,
    });
  }
  if (solved.unresolved.has('__alternate_recipe_required_but_disabled__')) {
    errorSummaries.push({
      code: 'ALTERNATE_RECIPE_REQUIRED_BUT_DISABLED',
      messageJa: '選択レシピの循環を解くには代替レシピ補完が必要ですが、設定でOFFになっています。',
      messageEn: 'The selected recipe cycle requires alternate recipe completion, but that setting is disabled.',
      itemIds: [...new Set(solved.selectedRecipeCycleBlocks.map((block) => block.itemId))],
      recipeIds: [...new Set(solved.selectedRecipeCycleBlocks.flatMap((block) => block.cycleRecipeIds))],
    });
  }
  if (solved.unresolved.has('__selected_recipe_cycle_unresolved__')) {
    errorSummaries.push({
      code: 'SELECTED_RECIPE_CYCLE_UNRESOLVED',
      messageJa: '選択レシピの循環を代替レシピでも解けませんでした。',
      messageEn: 'The selected recipe cycle could not be resolved even with alternate recipes.',
      itemIds: [...new Set(solved.selectedRecipeCycleBlocks.map((block) => block.itemId))],
      recipeIds: [...new Set(solved.selectedRecipeCycleBlocks.flatMap((block) => block.cycleRecipeIds))],
    });
  }
  if (solved.unresolved.has('__solver_did_not_converge__')) {
    errorSummaries.push({
      code: 'INTERNAL_ERROR_SOLVER_DID_NOT_CONVERGE',
      messageJa: '収支ベースsolverの計算が上限回数内に収束しませんでした。',
      messageEn: 'The balance-based solver did not converge within the iteration limit.',
    });
  }
  if (solved.unresolved.has('__non_finite_or_huge__')) {
    errorSummaries.push({
      code: 'INTERNAL_ERROR_NON_FINITE_RESULT',
      messageJa: '収支ベースsolverで有限ではない、または異常に大きい値が発生しました。',
      messageEn: 'The balance-based solver produced a non-finite or excessively large value.',
    });
  }
  if (solved.unresolved.has('__invalid_special_resource_item__')) {
    const itemIds = specialApplication.solution.invalidResourceItemIds ?? [];
    errorSummaries.push({
      code: 'INVALID_SPECIAL_RESOURCE_ITEM',
      messageJa: '燃料または肥料に使えないアイテムが選択されています。燃料値・肥料値が設定されたアイテムを選んでください。',
      messageEn: 'An item that cannot be used as fuel or fertilizer is selected. Choose an item with fuel or fertilizer value.',
      itemIds,
    });
  }
  if (solved.unresolved.has('__special_resource_self_amplifying__')) {
    errorSummaries.push({
      code: 'SPECIAL_RESOURCE_SELF_AMPLIFYING',
      messageJa: '燃料・肥料の内部生産が自己増幅しているため、有限解がありません。燃料または肥料を外部生産にしてください。',
      messageEn: 'Internal fuel/fertilizer production is self-amplifying and has no finite solution. Use external production for fuel or fertilizer.',
    });
  }

  const cycleInputRates = sourceUseRatesByKind(actualSourceUses, 'cycleInput');
  if (Object.keys(cycleInputRates).length > 0) {
    warnings.push({
      messageJa: '循環補填として ' + Object.keys(cycleInputRates).map((itemId) => itemById[itemId]?.name.ja ?? itemId).join(' / ') + ' を投入します。',
      messageEn: 'Cycle input is used for: ' + Object.keys(cycleInputRates).join(' / '),
    });
  }
  if (solved.alternateRecipeUses.length > 0) {
    warnings.push({
      messageJa: '不足補完のため、代替レシピを使用しました。',
      messageEn: 'Alternate recipes were used to complete shortages.',
    });
  }
  if (byproductFuelUses.length > 0) {
    warnings.push({
      messageJa: '副産物を燃料として使用しました。',
      messageEn: 'Byproduct fuel was used.',
    });
  }

  const { conveyorEdges, outputEdges } = buildConveyorAndOutputEdges(flows);
  const purchaseCostCopperPerMin = Object.values(itemStats).reduce((sum, item) => sum + item.purchaseCostCopperPerMin, 0);
  const revenueCopperPerMin = Object.values(itemStats).reduce((sum, item) => sum + item.revenueCopperPerMin, 0);
  const actualFuelRequiredPerMin = input.settings.fuel?.enabled && input.settings.fuel.fuelItemId
    ? flows.filter((flow) => flow.role === 'fuel' && flow.itemId === input.settings.fuel?.fuelItemId).reduce((sum, flow) => sum + flow.rate, 0)
    : 0;
  const result: CalculationResult = {
    itemStats,
    recipeStats,
    flows,
    conveyorEdges,
    outputEdges,
    warnings,
    calculationStatus: errorSummaries.length > 0 ? 'invalid' : 'ok',
    errorSummaries,
    totals: {
      initialCostCopper,
      runningCostCopperPerMin: purchaseCostCopperPerMin,
      purchaseCostCopperPerMin,
      revenueCopperPerMin,
      profitCopperPerMin: revenueCopperPerMin - purchaseCostCopperPerMin,
      conveyorItemsPerMinute,
      productionSpeedMultiplier,
      heatConsumptionMultiplier: getHeatConsumptionMultiplier(input.abilities),
      sellPriceMultiplier,
      fuelHeatValueMultiplier: getFuelHeatValueMultiplier(input.abilities),
      fertilizerNutritionMultiplier: getFertilizerNutritionMultiplier(input.abilities),
      heatRequiredPerMin: analysis.heatRequiredPerMin,
      fuelRequiredPerMin: specialApplication.solution.fuelRequiredPerMin,
      fuelItemId: input.settings.fuel?.fuelItemId ?? '',
      fertilizerNutrientsRequiredPerMin: analysis.fertilizerNutrientsRequiredPerMin,
      fertilizerRequiredPerMin: specialApplication.solution.fertilizerRequiredPerMin,
      fertilizerItemId: input.settings.fertilizer?.fertilizerItemId ?? '',
      calculationMs: 0,
      queueSteps: solved.iterations,
      queueMax: solved.queueSafetyLimit,
    },
    residualUnresolvedFlows: [],
    initialInvestment: {
      groups: [],
      requiredByRecipe: initialRequiredByRecipe,
      purchasedItemIds: [...initialPurchasedItemIds],
      unresolvedItemIds: [],
    },
  };

  return {
    result,
    trace: {
      mode: BALANCE_SOLVER_MODE,
      version: BALANCE_SOLVER_VERSION,
      iterations: solved.iterations,
      queueSafetyLimit: solved.queueSafetyLimit,
      queueGuardMode: 'graph-size-derived',
      cycleInputItemIds: Object.keys(cycleInputRates),
      cycleInputRates,
      unresolvedItemIds: invalidRootItemIds,
      sourceBuckets: {
        materialBuy: sourceUseRatesByKind(actualSourceUses, 'materialBuy'),
        fuelBuy: sourceUseRatesByKind(actualSourceUses, 'fuelBuy'),
        fertilizerBuy: sourceUseRatesByKind(actualSourceUses, 'fertilizerBuy'),
        fuelExternal: sourceUseRatesByKind(actualSourceUses, 'fuelExternal'),
        fertilizerExternal: sourceUseRatesByKind(actualSourceUses, 'fertilizerExternal'),
      },
      coProductReconciliation: coProductReconciliation.trace,
      alternateRecipeCompletion: {
        enabled: input.settings.allowAlternateRecipeCompletion,
        uses: solved.alternateRecipeUses,
        blockedCycles: solved.selectedRecipeCycleBlocks,
      },
      byproductFuel: {
        enabled: input.settings.useByproductFuel,
        uses: byproductFuelUses,
      },
      specialResourceSolution: specialApplication.solution,
      notesJa: ['v0.9.28 の構造化収支solver結果です。燃料・肥料の内部生産は熱量/栄養値の特殊リソースとして直接解きます。特殊リソース不要時は内部燃料・肥料のコスト測定を省略し、設備グレード設定とパラドックス素材設定を反映します。'],
      notesEn: ['Structured balance solver result for v0.9.28. Internal fuel/fertilizer production is solved directly as heat/nutrient special resources. Internal fuel/fertilizer cost probes are skipped when no special resources are needed. Machine preferences and paradox input settings are applied.'],
    },
  };
}
