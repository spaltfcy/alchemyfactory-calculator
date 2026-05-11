import type {
  AppSettings,
  Recipe,
} from '../types';
import { getRecipesProducing, recipeById } from '../data/recipes';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import {
  getConveyorItemsPerMinute,
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
import type { LinearModelDiagnostics, SelectedRecipeCycleDiagnostic } from './newSolver';

const EPS = 1e-9;
const MAX_ALPHA_ITERATIONS = 160;
const MAX_REASONABLE_RATE = 1e18;
const BALANCE_SOLVER_VERSION = '0.8.11' as const;
const BALANCE_SOLVER_MODE = 'balance-special-resource-v0811';

type RunMap = Map<string, number>;
type DemandLot = { itemId: string; rate: number; consumerRecipeId: string; role: CalculatedFlowRole };
type SupplyLot = { recipeId: string; itemId: string; rate: number; originalRate: number };
type SourceMode = 'buy' | 'external' | 'cycleInput' | 'unresolved';
type SourceKind = 'materialBuy' | 'fuelExternal' | 'fertilizerExternal';
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

type AlphaSolveTrace = {
  mode: 'balance-special-resource-v0811';
  version: typeof BALANCE_SOLVER_VERSION;
  iterations?: number;
  cycleInputItemIds?: string[];
  cycleInputRates?: Record<string, number>;
  unresolvedItemIds?: string[];
  sourceBuckets?: {
    materialBuy: Record<string, number>;
    fuelExternal: Record<string, number>;
    fertilizerExternal: Record<string, number>;
  };
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

export type AlphaBalanceSolveResult = {
  result: CalculationResult;
  trace: AlphaSolveTrace;
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

function createRecipeStat(recipe: Recipe, runsPerMinute: number, input: CalculateInput, productionSpeedMultiplier: number, conveyorItemsPerMinute: number): RecipeStat {
  const machineRunRate = runRateForRecipe(recipe, input, productionSpeedMultiplier, conveyorItemsPerMinute);
  const theoreticalMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
  return {
    recipeId: recipe.id,
    machineId: getEffectiveRecipeMachineId(recipe, input.settings),
    theoreticalMachines,
    actualMachines: theoreticalMachines,
    runsPerMinute,
    inputRates: {},
    outputRates: {},
    surplusOutputRates: {},
    discardedOutputRates: {},
    targetIds: [],
  };
}

function recipeTotalOutputAmount(recipe: Recipe): number {
  return recipe.outputs.reduce((sum, output) => sum + output.amount * (output.probability ?? 1), 0);
}

function runRateForRecipe(recipe: Recipe, input: CalculateInput, productionSpeedMultiplier: number, conveyorItemsPerMinute: number): number {
  const baseRunRate = 60 / getEffectiveRecipeTimeSec(recipe, input.settings);
  const nutrientInputPerRun = Math.max(0, recipe.nutrientInputPerRun ?? 0);
  if (!input.settings.fertilizer?.enabled || nutrientInputPerRun <= EPS) return baseRunRate * productionSpeedMultiplier;

  if (recipe.nutrientRunRateMode === 'logisticsCap') {
    const fertilizerItemId = input.settings.fertilizer.fertilizerItemId;
    const fertilizerNutrientsPerSec = Math.max(0, FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID[fertilizerItemId] ?? 0);
    const nutrientLimitedRunRate = fertilizerNutrientsPerSec > EPS ? (fertilizerNutrientsPerSec * 60) / nutrientInputPerRun : 0;
    const outputAmountPerRun = Math.max(EPS, recipeTotalOutputAmount(recipe));
    const logisticsLimitedRunRate = conveyorItemsPerMinute > EPS ? conveyorItemsPerMinute / outputAmountPerRun : 0;
    return Math.min(nutrientLimitedRunRate, logisticsLimitedRunRate);
  }

  if (recipe.nutrientRunRateMode === 'fixedTime') return baseRunRate;

  return baseRunRate * productionSpeedMultiplier;
}

function outputPerRun(recipe: Recipe, itemId: string): number {
  const output = recipe.outputs.find((entry) => entry.itemId === itemId);
  if (!output) return 0;
  return output.amount * (output.probability ?? 1);
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

function cycleInputItemIds(diagnostics: LinearModelDiagnostics): Set<string> {
  return new Set(diagnostics.activePlanCyclicComponents.flatMap((cycle: SelectedRecipeCycleDiagnostic) => cycle.buyableInputItemIds));
}

function fuelHeatPerRun(recipe: Recipe, input: CalculateInput, productionSpeedMultiplier: number): number {
  if (!input.settings.fuel?.enabled) return 0;
  const heatPerSec = HEAT_CONSUMER_BY_MACHINE_ID[getEffectiveRecipeMachineId(recipe, input.settings)]?.heatPerSec ?? 0;
  if (heatPerSec <= EPS) return 0;
  const runsPerMachine = runRateForRecipe(recipe, input, productionSpeedMultiplier, getConveyorItemsPerMinute(input.abilities));
  if (runsPerMachine <= EPS) return 0;
  return (heatPerSec * 60 * getHeatConsumptionMultiplier(input.abilities)) / runsPerMachine;
}

function fertilizerNutrientsPerRun(recipe: Recipe, input: CalculateInput): number {
  if (!input.settings.fertilizer?.enabled) return 0;
  return Math.max(0, recipe.nutrientInputPerRun ?? 0);
}

function addRunForDemand(runs: RunMap, recipe: Recipe, itemId: string, missingRate: number, input: CalculateInput, productionSpeedMultiplier: number, conveyorItemsPerMinute: number): void {
  const perRun = outputPerRun(recipe, itemId);
  if (perRun <= EPS) return;
  let neededRuns = missingRate / perRun;
  if (shouldRoundMachines(input.settings.machineRounding)) {
    const machineRunRate = runRateForRecipe(recipe, input, productionSpeedMultiplier, conveyorItemsPerMinute);
    const machines = machineRunRate > EPS ? safeCeil(neededRuns / machineRunRate) : 0;
    neededRuns = machines * machineRunRate;
  }
  addToMap(runs, recipe.id, neededRuns);
}

function initialRunsFromTargets(input: CalculateInput, productionSpeedMultiplier: number, conveyorItemsPerMinute: number): { runs: RunMap; targetRuns: Map<string, number>; targetRates: Map<string, number>; invalidTargets: string[] } {
  const runs: RunMap = new Map();
  const targetRuns = new Map<string, number>();
  const targetRates = new Map<string, number>();
  const invalidTargets: string[] = [];

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
    let runsPerMinute: number;
    let targetRate: number;
    if (target.mode === 'machines') {
      runsPerMinute = Math.max(0, targetValue) * runRateForRecipe(recipe, input, productionSpeedMultiplier, conveyorItemsPerMinute);
      targetRate = outputPerRun(recipe, target.outputItemId) * runsPerMinute;
    } else {
      const perRun = outputPerRun(recipe, target.outputItemId);
      if (perRun <= EPS) {
        invalidTargets.push(target.outputItemId);
        continue;
      }
      runsPerMinute = targetValue / perRun;
      if (shouldRoundMachines(input.settings.machineRounding)) {
        const machineRunRate = runRateForRecipe(recipe, input, productionSpeedMultiplier, conveyorItemsPerMinute);
        const machines = machineRunRate > EPS ? safeCeil(runsPerMinute / machineRunRate) : 0;
        runsPerMinute = machines * machineRunRate;
      }
      targetRate = outputPerRun(recipe, target.outputItemId) * runsPerMinute;
    }
    addToMap(runs, recipe.id, runsPerMinute);
    addToMap(targetRuns, recipe.id, runsPerMinute);
    targetRates.set(target.outputItemId, (targetRates.get(target.outputItemId) ?? 0) + targetRate);
  }
  return { runs, targetRuns, targetRates, invalidTargets };
}

function analyzeRuns(runs: RunMap, input: CalculateInput, productionSpeedMultiplier: number): { produced: Map<string, number>; consumed: Map<string, number>; demandLots: DemandLot[]; heatRequiredPerMin: number; fertilizerNutrientsRequiredPerMin: number } {
  const produced = new Map<string, number>();
  const consumed = new Map<string, number>();
  const demandLots: DemandLot[] = [];
  let heatRequiredPerMin = 0;
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
    for (const output of recipe.outputs) {
      addToMap(produced, output.itemId, output.amount * (output.probability ?? 1) * runsPerMinute);
    }
    for (const recipeInput of recipe.inputs) {
      addDemand(recipe.id, recipeInput.itemId, recipeInput.amount * runsPerMinute, 'material');
    }
    const heatPerRun = fuelHeatPerRun(recipe, input, productionSpeedMultiplier);
    if (heatPerRun > EPS) heatRequiredPerMin += heatPerRun * runsPerMinute;
    const nutrientsPerRun = fertilizerNutrientsPerRun(recipe, input);
    if (nutrientsPerRun > EPS) fertilizerNutrientsRequiredPerMin += nutrientsPerRun * runsPerMinute;
  }

  // Fuel and fertilizer are solved as special resources.
  // analyzeRuns() only returns material demands plus heat/nutrient requirements.

  return { produced, consumed, demandLots, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin };
}

function buildSupplyLots(runs: RunMap): Map<string, SupplyLot[]> {
  const map = new Map<string, SupplyLot[]>();
  for (const [recipeId, runsPerMinute] of runs.entries()) {
    const recipe = recipeById[recipeId];
    if (!recipe || runsPerMinute <= EPS) continue;
    for (const output of recipe.outputs) {
      const rate = output.amount * (output.probability ?? 1) * runsPerMinute;
      if (rate <= EPS) continue;
      const lots = map.get(output.itemId) ?? [];
      lots.push({ recipeId, itemId: output.itemId, rate, originalRate: rate });
      map.set(output.itemId, lots);
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

function recipeIdsInActiveCycles(diagnostics: LinearModelDiagnostics): Set<string> {
  return new Set(diagnostics.activePlanCyclicComponents.flatMap((cycle) => cycle.recipeIds));
}

function activeCycleForRecipe(recipeId: string, diagnostics: LinearModelDiagnostics): SelectedRecipeCycleDiagnostic | undefined {
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

function chooseAlternateRecipeForItem(itemId: string, selectedRecipe: Recipe | undefined, diagnostics: LinearModelDiagnostics): Recipe | undefined {
  const cycleRecipeIds = recipeIdsInActiveCycles(diagnostics);
  const alternatives = getRecipesProducing(itemId)
    .filter((recipe) => recipe.id !== selectedRecipe?.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return alternatives.find((recipe) => !cycleRecipeIds.has(recipe.id)) ?? alternatives[0];
}


type SolveRunMapResult = {
  runs: RunMap;
  targetRuns: Map<string, number>;
  targetRates: Map<string, number>;
  sources: SourceBucket;
  cycleInputs: CycleInputBucket;
  unresolved: Set<string>;
  iterations: number;
  heatRequiredPerMin: number;
  fertilizerNutrientsRequiredPerMin: number;
  alternateRecipeUses: AlternateRecipeUse[];
  selectedRecipeCycleBlocks: SelectedRecipeCycleBlock[];
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
};

type SpecialResourceSolutionTrace = {
  mode: 'none' | 'fuel-only' | 'fertilizer-only' | 'linear-2x2';
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

function solveRunMap(input: CalculateInput, diagnostics: LinearModelDiagnostics): SolveRunMapResult {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const { runs, targetRuns, targetRates, invalidTargets } = initialRunsFromTargets(input, productionSpeedMultiplier, conveyorItemsPerMinute);
  const sources: SourceBucket = new Map();
  const cycleInputs: CycleInputBucket = new Map();
  const fuelRuns: RunMap = new Map();
  const fertilizerRuns: RunMap = new Map();
  const unresolved = new Set<string>(invalidTargets);
  const cycleInputIds = cycleInputItemIds(diagnostics);
  const activeCycleRecipeIds = recipeIdsInActiveCycles(diagnostics);
  const alternateRecipeUses: AlternateRecipeUse[] = [];
  const selectedRecipeCycleBlocks: SelectedRecipeCycleBlock[] = [];
  let heatRequiredPerMin = 0;
  let fertilizerNutrientsRequiredPerMin = 0;

  for (let iteration = 0; iteration < MAX_ALPHA_ITERATIONS; iteration += 1) {
    const analysis = analyzeRuns(runs, input, productionSpeedMultiplier);
    heatRequiredPerMin = analysis.heatRequiredPerMin;
    fertilizerNutrientsRequiredPerMin = analysis.fertilizerNutrientsRequiredPerMin;

    const nextRuns: RunMap = new Map(runs);
    const supplyLotsByItem = buildSupplyLots(runs);
    const fuelSupplyLotsByItem = buildSupplyLots(fuelRuns);
    const fertilizerSupplyLotsByItem = buildSupplyLots(fertilizerRuns);
    const sourceLots = cloneSourceBucket(sources);
    const cycleInputLots = cloneCycleInputBucket(cycleInputs);

    // Reserve target outputs first. A target is a final sink, not a reusable supply.
    for (const [itemId, targetRate] of targetRates.entries()) {
      const consumed = consumeRecipeLots(supplyLotsByItem.get(itemId), targetRate);
      if (consumed.remaining > 0.000001) unresolved.add(itemId);
    }

    let changed = false;
    const sortedDemandLots = [...analysis.demandLots].sort((a, b) => {
      const priority = (role: CalculatedFlowRole): number => role === 'material' ? 0 : role === 'fuel' ? 1 : role === 'fertilizer' ? 2 : 3;
      return priority(a.role) - priority(b.role);
    });

    for (const demand of sortedDemandLots) {
      let remaining = demand.rate;

      if (demand.role === 'material') {
        remaining = consumeRecipeLots(supplyLotsByItem.get(demand.itemId), remaining).remaining;
        remaining = consumeCycleInputBucket(cycleInputLots, demand.itemId, remaining).remaining;
        remaining = consumeSourceBucket(sourceLots, demand.itemId, 'material', ['materialBuy'], remaining).remaining;
      } else if (demand.role === 'fuel') {
        // Fuel is intentionally isolated from ordinary material supply. Internal fuel lines
        // are tracked separately, and generic byproducts are only usable when useByproductFuel is ON.
        remaining = consumeRecipeLots(fuelSupplyLotsByItem.get(demand.itemId), remaining).remaining;
        if (input.settings.useByproductFuel) {
          remaining = consumeByproductFuelLots(supplyLotsByItem, demand.itemId, remaining, input).remainingPreferredFuelRate;
        }
        remaining = consumeSourceBucket(sourceLots, demand.itemId, 'fuel', ['fuelExternal'], remaining).remaining;
      } else if (demand.role === 'fertilizer') {
        // Fertilizer has its own internal/external source path and must not consume arbitrary material outputs.
        remaining = consumeRecipeLots(fertilizerSupplyLotsByItem.get(demand.itemId), remaining).remaining;
        remaining = consumeSourceBucket(sourceLots, demand.itemId, 'fertilizer', ['fertilizerExternal'], remaining).remaining;
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
          addSource(sources, 'materialBuy', demand.itemId, 'material', remaining, 'buy');
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
          addSource(sources, 'materialBuy', demand.itemId, 'material', remaining, 'buy');
          changed = true;
          continue;
        }
        unresolved.add(demand.itemId);
        continue;
      }

      if (cycleInputIds.has(demand.itemId) && isBuyableItem(demand.itemId)) {
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
            } else if ((runs.get(selectedRecipe.id) ?? 0) <= EPS) {
              // Allow one expansion step so the actual cycle-closing input can be evaluated.
              // Example: charcoal_powder has no alternate producer, but expanding it exposes charcoal,
              // whose selected cyclic producer can be replaced by charcoal_from_plank.
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
        addRunForDemand(nextRuns, recipeToUse, demand.itemId, remaining, input, productionSpeedMultiplier, conveyorItemsPerMinute);
        changed = true;
        continue;
      }
      if (isBuyableItem(demand.itemId)) {
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
      return { runs, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: iteration + 1, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin, alternateRecipeUses, selectedRecipeCycleBlocks, fuelRuns, fertilizerRuns };
    }

    if (!changed || mapAlmostEqual(runs, nextRuns)) {
      return { runs: nextRuns, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: iteration + 1, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin, alternateRecipeUses, selectedRecipeCycleBlocks, fuelRuns, fertilizerRuns };
    }
    runs.clear();
    for (const [recipeId, rate] of nextRuns.entries()) runs.set(recipeId, rate);
  }

  unresolved.add('__solver_did_not_converge__');
  return { runs, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: MAX_ALPHA_ITERATIONS, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin, alternateRecipeUses, selectedRecipeCycleBlocks, fuelRuns, fertilizerRuns };
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

function specialCostForItem(itemId: string, input: CalculateInput, diagnostics: LinearModelDiagnostics): SpecialItemCost {
  const recipe = chooseRecipeForItem(itemId, input.recipePreferences);
  if (!recipe) {
    const sources: SourceBucket = new Map();
    const unresolved = new Set<string>();
    if (isBuyableItem(itemId)) addSource(sources, 'materialBuy', itemId, 'material', 1, 'buy');
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
  };
}

function solveSpecialResources(base: SolveRunMapResult, input: CalculateInput, diagnostics: LinearModelDiagnostics): SpecialResourceApplication {
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
    fuelCost = specialCostForItem(fuelItemId, input, diagnostics);
  }
  if (hasBaseSpecialResourceDemand && fertilizerEnabled && input.settings.fertilizer?.sourceMode === 'internal') {
    fertilizerCost = specialCostForItem(fertilizerItemId, input, diagnostics);
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
    mode = 'linear-2x2';
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
    heatRequiredPerMin: analysis.heatRequiredPerMin,
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

export function calculateAlphaBalance(input: CalculateInput, diagnostics: LinearModelDiagnostics): AlphaBalanceSolveResult {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const sellPriceMultiplier = getSellPriceMultiplier(input.abilities, 'shop');
  const baseSolved = solveRunMap(input, diagnostics);
  const specialApplication = solveSpecialResources(baseSolved, input, diagnostics);
  const solved = applySpecialResourceApplication(baseSolved, input, specialApplication);
  const itemStats: Record<string, ItemStat> = {};
  const recipeStats: Record<string, RecipeStat> = {};
  const flows: CalculatedFlow[] = [];
  const warnings: PlanWarning[] = [];
  const purchaseCostByItem = new Map<string, number>();
  const byproductFuelUses: ByproductFuelUse[] = [];
  const actualSourceUses: SourceUse[] = [];

  function stat(itemId: string): ItemStat {
    itemStats[itemId] ??= createItemStat(itemId);
    return itemStats[itemId];
  }

  function pushFlow(flow: CalculatedFlow | undefined): void {
    if (flow) flows.push(flow);
  }

  for (const [recipeId, runsPerMinute] of solved.runs.entries()) {
    const baseRecipe = recipeById[recipeId];
    if (!baseRecipe || runsPerMinute <= EPS) continue;
    const recipe = getEffectiveRecipeForCalculation(baseRecipe, input.settings);
    const recipeStat = createRecipeStat(recipe, runsPerMinute, input, productionSpeedMultiplier, conveyorItemsPerMinute);
    recipeStats[recipeId] = recipeStat;
    for (const inputEntry of recipe.inputs) addToRecord(recipeStat.inputRates, inputEntry.itemId, inputEntry.amount * runsPerMinute);
    for (const output of recipe.outputs) {
      const rate = output.amount * (output.probability ?? 1) * runsPerMinute;
      addToRecord(recipeStat.outputRates, output.itemId, rate);
      stat(output.itemId).produced += rate;
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
  const supplyLotsByItem = buildSupplyLots(solved.runs);

  for (const [itemId, targetRate] of solved.targetRates.entries()) {
    const consumed = consumeRecipeLots(supplyLotsByItem.get(itemId), targetRate);
    for (const use of consumed.uses) {
      pushFlow(makeFlow({ type: 'recipe', recipeId: use.recipeId }, { type: 'itemSink', itemId, sinkMode: 'final' }, itemId, use.rate, 'finalOutput', conveyorItemsPerMinute));
    }
  }

  const sourceAvailable = cloneSourceBucket(solved.sources);
  const cycleInputAvailable = cloneCycleInputBucket(solved.cycleInputs);
  const sortedDemandLots = [...analysis.demandLots, ...specialDemandLots].sort((a, b) => {
    const priority = (role: CalculatedFlowRole): number => role === 'material' ? 0 : role === 'fuel' ? 1 : role === 'fertilizer' ? 2 : 3;
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

    if (demand.role === 'material') {
      const recipeUse = consumeRecipeLots(supplyLotsByItem.get(demand.itemId), remaining);
      remaining = recipeUse.remaining;
      for (const use of recipeUse.uses) {
        s.reused += use.rate;
        pushFlow(makeFlow({ type: 'recipe', recipeId: use.recipeId }, consumer, use.itemId, use.rate, 'material', conveyorItemsPerMinute));
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
      for (const use of sourceUse.uses) {
        actualSourceUses.push(use);
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: use.sourceMode }, consumer, use.itemId, use.rate, 'material', conveyorItemsPerMinute));
      }
    } else if (demand.role === 'fuel') {
      const sourceUse = consumeSourceBucket(sourceAvailable, demand.itemId, 'fuel', ['fuelExternal'], remaining);
      remaining = sourceUse.remaining;
      for (const use of sourceUse.uses) {
        actualSourceUses.push(use);
        const fuelStat = stat(use.itemId);
        fuelStat.requested += use.rate;
        fuelStat.consumed += use.rate;
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: 'external' }, consumer, use.itemId, use.rate, 'fuel', conveyorItemsPerMinute));
      }
    } else if (demand.role === 'fertilizer') {
      const sourceUse = consumeSourceBucket(sourceAvailable, demand.itemId, 'fertilizer', ['fertilizerExternal'], remaining);
      remaining = sourceUse.remaining;
      for (const use of sourceUse.uses) {
        actualSourceUses.push(use);
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: 'external' }, consumer, use.itemId, use.rate, 'fertilizer', conveyorItemsPerMinute));
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

  for (const [itemId, lots] of supplyLotsByItem.entries()) {
    for (const lot of lots) {
      if (lot.rate <= EPS) continue;
      const s = stat(itemId);
      s.surplus += lot.rate;
      s.discarded += lot.rate;
      const recipeStat = recipeStats[lot.recipeId];
      if (recipeStat) {
        addToRecord(recipeStat.surplusOutputRates, itemId, lot.rate);
        addToRecord(recipeStat.discardedOutputRates, itemId, lot.rate);
      }
      pushFlow(makeFlow({ type: 'recipe', recipeId: lot.recipeId }, { type: 'itemSink', itemId, sinkMode: 'discard' }, itemId, lot.rate, 'discard', conveyorItemsPerMinute));
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
      initialCostCopper: 0,
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
      queueMax: solved.runs.size,
    },
    residualUnresolvedFlows: [],
  };

  return {
    result,
    trace: {
      mode: BALANCE_SOLVER_MODE,
      version: BALANCE_SOLVER_VERSION,
      iterations: solved.iterations,
      cycleInputItemIds: Object.keys(cycleInputRates),
      cycleInputRates,
      unresolvedItemIds: invalidRootItemIds,
      sourceBuckets: {
        materialBuy: sourceUseRatesByKind(actualSourceUses, 'materialBuy'),
        fuelExternal: sourceUseRatesByKind(actualSourceUses, 'fuelExternal'),
        fertilizerExternal: sourceUseRatesByKind(actualSourceUses, 'fertilizerExternal'),
      },
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
      notesJa: ['v0.8.11 の収支ベースsolver結果です。燃料・肥料の内部生産は熱量/栄養値の特殊リソースとして直接解きます。特殊リソース不要時は内部燃料・肥料のコスト測定を省略し、設備グレード設定とパラドックス素材設定を反映します。'],
      notesEn: ['Balance-based solver result for v0.8.11. Internal fuel/fertilizer production is solved directly as heat/nutrient special resources. Internal fuel/fertilizer cost probes are skipped when no special resources are needed. Machine preferences and paradox input settings are applied.'],
    },
  };
}
