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
import { FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID } from '../data/fertilizer';
import { safeCeil } from '../utils/format';
import { chooseRecipeForItem, isBuyableItem } from './itemSourceResolver';
import { calculate as calculateLegacy } from './legacyCalculate';
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
} from './legacyCalculate';
import type { LinearModelDiagnostics, SelectedRecipeCycleDiagnostic } from './newSolver';

const EPS = 1e-9;
const MAX_ALPHA_ITERATIONS = 160;
const MAX_REASONABLE_RATE = 1e18;
const BALANCE_SOLVER_VERSION = '0.7.0-alpha.6' as const;
const BALANCE_SOLVER_MODE = 'balance-iterative-alpha6';

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
type ByproductFuelUse = { itemId: string; consumerRecipeId: string; rate: number; preferredFuelEquivalentRate: number };

type AlphaSolveTrace = {
  mode: 'balance-iterative-alpha6' | 'legacy-fallback';
  version: typeof BALANCE_SOLVER_VERSION;
  fallbackReason?: string;
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
  };
  byproductFuel: {
    enabled: boolean;
    uses: ByproductFuelUse[];
  };
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

function createRecipeStat(recipe: Recipe, runsPerMinute: number, productionSpeedMultiplier: number): RecipeStat {
  const machineRunRate = runRateForRecipe(recipe, productionSpeedMultiplier);
  const theoreticalMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
  return {
    recipeId: recipe.id,
    machineId: recipe.machineId,
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

function runRateForRecipe(recipe: Recipe, productionSpeedMultiplier: number): number {
  return (60 / recipe.timeSec) * productionSpeedMultiplier;
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
  const heatPerSec = HEAT_CONSUMER_BY_MACHINE_ID[recipe.machineId]?.heatPerSec ?? 0;
  if (heatPerSec <= EPS) return 0;
  const runsPerMachine = runRateForRecipe(recipe, productionSpeedMultiplier);
  if (runsPerMachine <= EPS) return 0;
  return (heatPerSec * 60 * getHeatConsumptionMultiplier(input.abilities)) / runsPerMachine;
}

function fertilizerNutrientsPerRun(recipe: Recipe, input: CalculateInput): number {
  if (!input.settings.fertilizer?.enabled || recipe.machineId !== 'nursery') return 0;
  return Math.max(0, recipe.timeSec * 12);
}

function addRunForDemand(runs: RunMap, recipe: Recipe, itemId: string, missingRate: number, input: CalculateInput, productionSpeedMultiplier: number): void {
  const perRun = outputPerRun(recipe, itemId);
  if (perRun <= EPS) return;
  let neededRuns = missingRate / perRun;
  if (shouldRoundMachines(input.settings.machineRounding)) {
    const machineRunRate = runRateForRecipe(recipe, productionSpeedMultiplier);
    const machines = machineRunRate > EPS ? safeCeil(neededRuns / machineRunRate) : 0;
    neededRuns = machines * machineRunRate;
  }
  addToMap(runs, recipe.id, neededRuns);
}

function initialRunsFromTargets(input: CalculateInput, productionSpeedMultiplier: number): { runs: RunMap; targetRuns: Map<string, number>; targetRates: Map<string, number>; invalidTargets: string[] } {
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
      runsPerMinute = Math.max(0, targetValue) * runRateForRecipe(recipe, productionSpeedMultiplier);
      targetRate = outputPerRun(recipe, target.outputItemId) * runsPerMinute;
    } else {
      const perRun = outputPerRun(recipe, target.outputItemId);
      if (perRun <= EPS) {
        invalidTargets.push(target.outputItemId);
        continue;
      }
      runsPerMinute = targetValue / perRun;
      if (shouldRoundMachines(input.settings.machineRounding)) {
        const machineRunRate = runRateForRecipe(recipe, productionSpeedMultiplier);
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
    const recipe = recipeById[recipeId];
    if (!recipe || runsPerMinute <= EPS) continue;
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

  if (input.settings.fuel?.enabled && heatRequiredPerMin > EPS) {
    const fuelItemId = input.settings.fuel.fuelItemId;
    const heatValue = (FUEL_HEAT_VALUE_BY_ITEM_ID[fuelItemId] ?? 0) * getFuelHeatValueMultiplier(input.abilities);
    if (heatValue > EPS) {
      const fuelRate = heatRequiredPerMin / heatValue;
      for (const [recipeId, runsPerMinute] of runs.entries()) {
        const recipe = recipeById[recipeId];
        if (!recipe || runsPerMinute <= EPS) continue;
        const recipeHeat = fuelHeatPerRun(recipe, input, productionSpeedMultiplier) * runsPerMinute;
        if (recipeHeat > EPS) addDemand(recipe.id, fuelItemId, fuelRate * (recipeHeat / heatRequiredPerMin), 'fuel');
      }
    }
  }

  if (input.settings.fertilizer?.enabled && fertilizerNutrientsRequiredPerMin > EPS) {
    const fertilizerItemId = input.settings.fertilizer.fertilizerItemId;
    const nutrientValue = (FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerItemId] ?? 0) * getFertilizerNutritionMultiplier(input.abilities);
    if (nutrientValue > EPS) {
      const fertilizerRate = fertilizerNutrientsRequiredPerMin / nutrientValue;
      for (const [recipeId, runsPerMinute] of runs.entries()) {
        const recipe = recipeById[recipeId];
        if (!recipe || runsPerMinute <= EPS) continue;
        const recipeNutrients = fertilizerNutrientsPerRun(recipe, input) * runsPerMinute;
        if (recipeNutrients > EPS) addDemand(recipe.id, fertilizerItemId, fertilizerRate * (recipeNutrients / fertilizerNutrientsRequiredPerMin), 'fertilizer');
      }
    }
  }

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

function chooseAlternateRecipeForItem(itemId: string, selectedRecipe: Recipe | undefined, diagnostics: LinearModelDiagnostics): Recipe | undefined {
  const cycleRecipeIds = recipeIdsInActiveCycles(diagnostics);
  const alternatives = getRecipesProducing(itemId)
    .filter((recipe) => recipe.id !== selectedRecipe?.id)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return alternatives.find((recipe) => !cycleRecipeIds.has(recipe.id)) ?? alternatives[0];
}

function solveRunMap(input: CalculateInput, diagnostics: LinearModelDiagnostics): {
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
} {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const { runs, targetRuns, targetRates, invalidTargets } = initialRunsFromTargets(input, productionSpeedMultiplier);
  const sources: SourceBucket = new Map();
  const cycleInputs: CycleInputBucket = new Map();
  const unresolved = new Set<string>(invalidTargets);
  const cycleInputIds = cycleInputItemIds(diagnostics);
  const activeCycleRecipeIds = recipeIdsInActiveCycles(diagnostics);
  const alternateRecipeUses: AlternateRecipeUse[] = [];
  let heatRequiredPerMin = 0;
  let fertilizerNutrientsRequiredPerMin = 0;

  for (let iteration = 0; iteration < MAX_ALPHA_ITERATIONS; iteration += 1) {
    const analysis = analyzeRuns(runs, input, productionSpeedMultiplier);
    heatRequiredPerMin = analysis.heatRequiredPerMin;
    fertilizerNutrientsRequiredPerMin = analysis.fertilizerNutrientsRequiredPerMin;

    const nextRuns: RunMap = new Map(runs);
    const supplyLotsByItem = buildSupplyLots(runs);
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
      let remaining = consumeRecipeLots(supplyLotsByItem.get(demand.itemId), demand.rate).remaining;

      if (demand.role === 'fuel') {
        const byproductFuel = consumeByproductFuelLots(supplyLotsByItem, demand.itemId, remaining, input);
        remaining = byproductFuel.remainingPreferredFuelRate;
      }

      if (demand.role === 'material') {
        remaining = consumeCycleInputBucket(cycleInputLots, demand.itemId, remaining).remaining;
        remaining = consumeSourceBucket(sourceLots, demand.itemId, 'material', ['materialBuy'], remaining).remaining;
      } else if (demand.role === 'fuel') {
        remaining = consumeSourceBucket(sourceLots, demand.itemId, 'fuel', ['fuelExternal'], remaining).remaining;
      } else if (demand.role === 'fertilizer') {
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
          addRunForDemand(nextRuns, fuelRecipe, demand.itemId, remaining, input, productionSpeedMultiplier);
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
          addRunForDemand(nextRuns, fertilizerRecipe, demand.itemId, remaining, input, productionSpeedMultiplier);
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
      if (
        input.settings.allowAlternateRecipeCompletion
        && selectedRecipe
        && activeCycleRecipeIds.has(selectedRecipe.id)
      ) {
        const alternate = chooseAlternateRecipeForItem(demand.itemId, selectedRecipe, diagnostics);
        if (alternate) {
          recipeToUse = alternate;
          alternateRecipeUses.push({
            itemId: demand.itemId,
            selectedRecipeId: selectedRecipe.id,
            alternateRecipeId: alternate.id,
            reason: 'selected_recipe_cycle',
            rateAdded: remaining,
          });
        }
      }

      if (recipeToUse) {
        addRunForDemand(nextRuns, recipeToUse, demand.itemId, remaining, input, productionSpeedMultiplier);
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
      return { runs, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: iteration + 1, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin, alternateRecipeUses };
    }

    if (!changed || mapAlmostEqual(runs, nextRuns)) {
      return { runs: nextRuns, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: iteration + 1, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin, alternateRecipeUses };
    }
    runs.clear();
    for (const [recipeId, rate] of nextRuns.entries()) runs.set(recipeId, rate);
  }

  unresolved.add('__solver_did_not_converge__');
  return { runs, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: MAX_ALPHA_ITERATIONS, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin, alternateRecipeUses };
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
  // The alpha.6 balance solver handles ordinary material/source/cycle-input balances.
  // Internal fuel/fertilizer self-dependency still falls back to the legacy-compatible engine until the full v0.8 replacement.
  const fallbackTraceBase = {
    version: BALANCE_SOLVER_VERSION,
    alternateRecipeCompletion: { enabled: input.settings.allowAlternateRecipeCompletion, uses: [] as AlternateRecipeUse[] },
    byproductFuel: { enabled: input.settings.useByproductFuel, uses: [] as ByproductFuelUse[] },
  };

  if (input.settings.fuel?.enabled && input.settings.fuel.sourceMode === 'internal') {
    return {
      result: calculateLegacy(input),
      trace: {
        ...fallbackTraceBase,
        mode: 'legacy-fallback',
        fallbackReason: 'internal_fuel_not_yet_active_in_alpha6',
        notesJa: ['v0.7.0-alpha.6 では内部燃料の完全な収支solver化はまだ比較用フォールバックです。'],
        notesEn: ['v0.7.0-alpha.6 still uses the legacy-compatible fallback for internal fuel.'],
      },
    };
  }
  if (input.settings.fertilizer?.enabled && input.settings.fertilizer.sourceMode === 'internal') {
    return {
      result: calculateLegacy(input),
      trace: {
        ...fallbackTraceBase,
        mode: 'legacy-fallback',
        fallbackReason: 'internal_fertilizer_not_yet_active_in_alpha6',
        notesJa: ['v0.7.0-alpha.6 では内部肥料の完全な収支solver化はまだ比較用フォールバックです。'],
        notesEn: ['v0.7.0-alpha.6 still uses the legacy-compatible fallback for internal fertilizer.'],
      },
    };
  }

  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const sellPriceMultiplier = getSellPriceMultiplier(input.abilities, 'shop');
  const solved = solveRunMap(input, diagnostics);
  const itemStats: Record<string, ItemStat> = {};
  const recipeStats: Record<string, RecipeStat> = {};
  const flows: CalculatedFlow[] = [];
  const warnings: PlanWarning[] = [];
  const purchaseCostByItem = new Map<string, number>();
  const byproductFuelUses: ByproductFuelUse[] = [];

  function stat(itemId: string): ItemStat {
    itemStats[itemId] ??= createItemStat(itemId);
    return itemStats[itemId];
  }

  function pushFlow(flow: CalculatedFlow | undefined): void {
    if (flow) flows.push(flow);
  }

  for (const [recipeId, runsPerMinute] of solved.runs.entries()) {
    const recipe = recipeById[recipeId];
    if (!recipe || runsPerMinute <= EPS) continue;
    const recipeStat = createRecipeStat(recipe, runsPerMinute, productionSpeedMultiplier);
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

  for (const source of solved.sources.values()) {
    const s = stat(source.itemId);
    s.purchased += source.rate;
    const cost = sourceCostCopper(source);
    s.purchaseCostCopperPerMin += cost;
    addToMap(purchaseCostByItem, source.itemId, cost);
  }
  for (const cycleInput of solved.cycleInputs.values()) {
    const s = stat(cycleInput.itemId);
    s.purchased += cycleInput.rate;
    const cost = sourceCostCopper(cycleInput);
    s.purchaseCostCopperPerMin += cost;
    addToMap(purchaseCostByItem, cycleInput.itemId, cost);
  }

  const analysis = analyzeRuns(solved.runs, input, productionSpeedMultiplier);
  const supplyLotsByItem = buildSupplyLots(solved.runs);

  for (const [itemId, targetRate] of solved.targetRates.entries()) {
    const consumed = consumeRecipeLots(supplyLotsByItem.get(itemId), targetRate);
    for (const use of consumed.uses) {
      pushFlow(makeFlow({ type: 'recipe', recipeId: use.recipeId }, { type: 'itemSink', itemId, sinkMode: 'final' }, itemId, use.rate, 'finalOutput', conveyorItemsPerMinute));
    }
  }

  const sourceAvailable = cloneSourceBucket(solved.sources);
  const cycleInputAvailable = cloneCycleInputBucket(solved.cycleInputs);
  const sortedDemandLots = [...analysis.demandLots].sort((a, b) => {
    const priority = (role: CalculatedFlowRole): number => role === 'material' ? 0 : role === 'fuel' ? 1 : role === 'fertilizer' ? 2 : 3;
    return priority(a.role) - priority(b.role);
  });

  for (const demand of sortedDemandLots) {
    const s = stat(demand.itemId);
    s.requested += demand.rate;
    s.consumed += demand.rate;
    const consumer = { type: 'recipe', recipeId: demand.consumerRecipeId } as const;

    const recipeUse = consumeRecipeLots(supplyLotsByItem.get(demand.itemId), demand.rate);
    let remaining = recipeUse.remaining;
    for (const use of recipeUse.uses) {
      if (demand.role === 'material') s.reused += use.rate;
      pushFlow(makeFlow({ type: 'recipe', recipeId: use.recipeId }, consumer, use.itemId, use.rate, demand.role, conveyorItemsPerMinute));
    }

    if (demand.role === 'fuel') {
      const byproductFuel = consumeByproductFuelLots(supplyLotsByItem, demand.itemId, remaining, input);
      remaining = byproductFuel.remainingPreferredFuelRate;
      for (const use of byproductFuel.uses) {
        const fuelUse = { ...use, consumerRecipeId: demand.consumerRecipeId };
        byproductFuelUses.push(fuelUse);
        const fuelStat = stat(use.itemId);
        fuelStat.consumed += use.rate;
        pushFlow(makeFlow({ type: 'recipe', recipeId: 'byproduct-fuel' }, consumer, use.itemId, use.rate, 'fuel', conveyorItemsPerMinute));
      }
    }

    if (demand.role === 'material') {
      const cycleUse = consumeCycleInputBucket(cycleInputAvailable, demand.itemId, remaining);
      remaining = cycleUse.remaining;
      for (const use of cycleUse.uses) {
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: 'cycleInput' }, consumer, use.itemId, use.rate, 'material', conveyorItemsPerMinute));
      }

      const sourceUse = consumeSourceBucket(sourceAvailable, demand.itemId, 'material', ['materialBuy'], remaining);
      remaining = sourceUse.remaining;
      for (const use of sourceUse.uses) {
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: use.sourceMode }, consumer, use.itemId, use.rate, 'material', conveyorItemsPerMinute));
      }
    } else if (demand.role === 'fuel') {
      const sourceUse = consumeSourceBucket(sourceAvailable, demand.itemId, 'fuel', ['fuelExternal'], remaining);
      remaining = sourceUse.remaining;
      for (const use of sourceUse.uses) {
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: 'external' }, consumer, use.itemId, use.rate, 'fuel', conveyorItemsPerMinute));
      }
    } else if (demand.role === 'fertilizer') {
      const sourceUse = consumeSourceBucket(sourceAvailable, demand.itemId, 'fertilizer', ['fertilizerExternal'], remaining);
      remaining = sourceUse.remaining;
      for (const use of sourceUse.uses) {
        pushFlow(makeFlow({ type: 'itemSource', itemId: use.itemId, sourceMode: 'external' }, consumer, use.itemId, use.rate, 'fertilizer', conveyorItemsPerMinute));
      }
    }

    if (remaining > 0.000001) solved.unresolved.add(demand.itemId);
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

  const invalidRootItemIds = [...solved.unresolved].filter((itemId) => !itemId.startsWith('__'));
  const errorSummaries: CalculationErrorSummary[] = [];
  if (invalidRootItemIds.length > 0) {
    errorSummaries.push({
      code: 'UNRESOLVED_ROOT_ITEM',
      messageJa: invalidRootItemIds.map((itemId) => itemById[itemId]?.name.ja ?? itemId).join(' / ') + ' の入手方法がありません。',
      messageEn: 'No source is available for: ' + invalidRootItemIds.join(' / '),
      itemIds: invalidRootItemIds,
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

  const cycleInputRates = ratesByItem(solved.cycleInputs);
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
      fuelRequiredPerMin: input.settings.fuel?.enabled && input.settings.fuel.fuelItemId
        ? (analysis.heatRequiredPerMin / Math.max(EPS, (FUEL_HEAT_VALUE_BY_ITEM_ID[input.settings.fuel.fuelItemId] ?? 0) * getFuelHeatValueMultiplier(input.abilities)))
        : 0,
      fuelItemId: input.settings.fuel?.fuelItemId ?? '',
      fertilizerNutrientsRequiredPerMin: analysis.fertilizerNutrientsRequiredPerMin,
      fertilizerRequiredPerMin: input.settings.fertilizer?.enabled && input.settings.fertilizer.fertilizerItemId
        ? (analysis.fertilizerNutrientsRequiredPerMin / Math.max(EPS, (FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[input.settings.fertilizer.fertilizerItemId] ?? 0) * getFertilizerNutritionMultiplier(input.abilities)))
        : 0,
      fertilizerItemId: input.settings.fertilizer?.fertilizerItemId ?? '',
      fuelIterations: 0,
      fuelConverged: true,
      fuelHitMaxIterations: false,
      fuelConvergenceDelta: 0,
      byproductIterations: solved.iterations,
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
        materialBuy: sourceRatesByKind(solved.sources, 'materialBuy'),
        fuelExternal: sourceRatesByKind(solved.sources, 'fuelExternal'),
        fertilizerExternal: sourceRatesByKind(solved.sources, 'fertilizerExternal'),
      },
      alternateRecipeCompletion: {
        enabled: input.settings.allowAlternateRecipeCompletion,
        uses: solved.alternateRecipeUses,
      },
      byproductFuel: {
        enabled: input.settings.useByproductFuel,
        uses: byproductFuelUses,
      },
      notesJa: ['v0.7.0-alpha.6 の収支ベース反復solver結果です。完全な線形計画ソルバではありません。燃料/肥料の外部ソースは role 別に分離しています。'],
      notesEn: ['Balance-based iterative solver result for v0.7.0-alpha.6. This is not a full linear-programming solver. External fuel/fertilizer sources are separated by role.'],
    },
  };
}
