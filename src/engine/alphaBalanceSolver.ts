import type {
  AppSettings,
  Recipe,
} from '../types';
import { recipeById } from '../data/recipes';
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

type RunMap = Map<string, number>;
type DemandLot = { itemId: string; rate: number; consumerRecipeId: string; role: CalculatedFlowRole };
type SupplyLot = { recipeId: string; itemId: string; rate: number; originalRate: number };
type SourceMode = 'buy' | 'external' | 'cycleInput' | 'unresolved';
type SourceBucket = Map<string, number>;

type AlphaSolveTrace = {
  mode: 'balance-iterative-alpha4' | 'legacy-fallback';
  fallbackReason?: string;
  iterations?: number;
  cycleInputItemIds?: string[];
  cycleInputRates?: Record<string, number>;
  unresolvedItemIds?: string[];
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

function addSource(sourceMap: SourceBucket, itemId: string, rate: number): void {
  addToMap(sourceMap, itemId, rate);
}

function solveRunMap(input: CalculateInput, diagnostics: LinearModelDiagnostics): { runs: RunMap; targetRuns: Map<string, number>; targetRates: Map<string, number>; sources: SourceBucket; cycleInputs: SourceBucket; unresolved: Set<string>; iterations: number; heatRequiredPerMin: number; fertilizerNutrientsRequiredPerMin: number } {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const { runs, targetRuns, targetRates, invalidTargets } = initialRunsFromTargets(input, productionSpeedMultiplier);
  const sources: SourceBucket = new Map();
  const cycleInputs: SourceBucket = new Map();
  const unresolved = new Set<string>(invalidTargets);
  const cycleInputIds = cycleInputItemIds(diagnostics);
  let heatRequiredPerMin = 0;
  let fertilizerNutrientsRequiredPerMin = 0;

  for (let iteration = 0; iteration < MAX_ALPHA_ITERATIONS; iteration += 1) {
    const analysis = analyzeRuns(runs, input, productionSpeedMultiplier);
    heatRequiredPerMin = analysis.heatRequiredPerMin;
    fertilizerNutrientsRequiredPerMin = analysis.fertilizerNutrientsRequiredPerMin;

    const nextRuns: RunMap = new Map(runs);
    const produced = new Map(analysis.produced);
    for (const [itemId, sourceRate] of sources.entries()) addToMap(produced, itemId, sourceRate);
    for (const [itemId, sourceRate] of cycleInputs.entries()) addToMap(produced, itemId, sourceRate);
    const required = new Map(analysis.consumed);
    for (const [itemId, targetRate] of targetRates.entries()) addToMap(required, itemId, targetRate);

    let changed = false;
    for (const [itemId, requiredRate] of required.entries()) {
      const missingRate = requiredRate - (produced.get(itemId) ?? 0);
      if (missingRate <= 0.000001) continue;

      const externalFuelDemand = input.settings.fuel?.enabled
        && input.settings.fuel.sourceMode === 'external'
        && itemId === input.settings.fuel.fuelItemId;
      const externalFertilizerDemand = input.settings.fertilizer?.enabled
        && input.settings.fertilizer.sourceMode === 'external'
        && itemId === input.settings.fertilizer.fertilizerItemId;
      if (externalFuelDemand || externalFertilizerDemand) {
        addSource(sources, itemId, missingRate);
        changed = true;
        continue;
      }

      if (cycleInputIds.has(itemId) && isBuyableItem(itemId)) {
        addSource(cycleInputs, itemId, missingRate);
        changed = true;
        continue;
      }
      const selectedRecipe = chooseRecipeForItem(itemId, input.recipePreferences);
      if (selectedRecipe) {
        addRunForDemand(nextRuns, selectedRecipe, itemId, missingRate, input, productionSpeedMultiplier);
        changed = true;
        continue;
      }
      if (isBuyableItem(itemId)) {
        addSource(sources, itemId, missingRate);
        changed = true;
        continue;
      }
      unresolved.add(itemId);
    }

    if ([...nextRuns.values()].some(isNonFiniteOrHuge) || [...sources.values()].some(isNonFiniteOrHuge) || [...cycleInputs.values()].some(isNonFiniteOrHuge)) {
      unresolved.add('__non_finite_or_huge__');
      return { runs, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: iteration + 1, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin };
    }

    if (!changed || mapAlmostEqual(runs, nextRuns)) {
      return { runs: nextRuns, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: iteration + 1, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin };
    }
    runs.clear();
    for (const [recipeId, rate] of nextRuns.entries()) runs.set(recipeId, rate);
  }

  unresolved.add('__solver_did_not_converge__');
  return { runs, targetRuns, targetRates, sources, cycleInputs, unresolved, iterations: MAX_ALPHA_ITERATIONS, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin };
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
  // The alpha.4 solver handles ordinary material/source/cycle-input balances. Internal fuel/fertilizer
  // self-dependency still falls back to the legacy-compatible engine until the full v0.8 replacement.
  if (input.settings.fuel?.enabled && input.settings.fuel.sourceMode === 'internal') {
    return {
      result: calculateLegacy(input),
      trace: {
        mode: 'legacy-fallback',
        fallbackReason: 'internal_fuel_not_yet_active_in_alpha4',
        notesJa: ['v0.7.0-alpha.4 では内部燃料の完全線形化はまだ比較用フォールバックです。'],
        notesEn: ['v0.7.0-alpha.4 still uses the legacy-compatible fallback for internal fuel.'],
      },
    };
  }
  if (input.settings.fertilizer?.enabled && input.settings.fertilizer.sourceMode === 'internal') {
    return {
      result: calculateLegacy(input),
      trace: {
        mode: 'legacy-fallback',
        fallbackReason: 'internal_fertilizer_not_yet_active_in_alpha4',
        notesJa: ['v0.7.0-alpha.4 では内部肥料の完全線形化はまだ比較用フォールバックです。'],
        notesEn: ['v0.7.0-alpha.4 still uses the legacy-compatible fallback for internal fertilizer.'],
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

  for (const [itemId, sourceRate] of solved.sources.entries()) {
    const s = stat(itemId);
    s.purchased += sourceRate;
    const cost = sourceRate * (itemById[itemId]?.buyPriceCopper ?? 0);
    s.purchaseCostCopperPerMin += cost;
    addToMap(purchaseCostByItem, itemId, cost);
  }
  for (const [itemId, sourceRate] of solved.cycleInputs.entries()) {
    const s = stat(itemId);
    s.purchased += sourceRate;
    const cost = sourceRate * (itemById[itemId]?.buyPriceCopper ?? 0);
    s.purchaseCostCopperPerMin += cost;
    addToMap(purchaseCostByItem, itemId, cost);
  }

  const analysis = analyzeRuns(solved.runs, input, productionSpeedMultiplier);
  const supplyLotsByItem = buildSupplyLots(solved.runs);

  for (const [itemId, targetRate] of solved.targetRates.entries()) {
    let remaining = targetRate;
    for (const lot of supplyLotsByItem.get(itemId) ?? []) {
      if (remaining <= EPS) break;
      if (lot.rate <= EPS) continue;
      const take = Math.min(lot.rate, remaining);
      lot.rate -= take;
      remaining -= take;
      pushFlow(makeFlow({ type: 'recipe', recipeId: lot.recipeId }, { type: 'itemSink', itemId, sinkMode: 'final' }, itemId, take, 'finalOutput', conveyorItemsPerMinute));
    }
  }

  const sourceAvailable = new Map(solved.sources);
  const cycleInputAvailable = new Map(solved.cycleInputs);
  for (const demand of analysis.demandLots) {
    const s = stat(demand.itemId);
    s.requested += demand.rate;
    s.consumed += demand.rate;
    let remaining = demand.rate;
    const consumer = { type: 'recipe', recipeId: demand.consumerRecipeId } as const;
    for (const lot of supplyLotsByItem.get(demand.itemId) ?? []) {
      if (remaining <= EPS) break;
      if (lot.rate <= EPS) continue;
      const take = Math.min(lot.rate, remaining);
      lot.rate -= take;
      remaining -= take;
      if (demand.role === 'material') s.reused += take;
      pushFlow(makeFlow({ type: 'recipe', recipeId: lot.recipeId }, consumer, demand.itemId, take, demand.role, conveyorItemsPerMinute));
    }
    const cycleRate = Math.min(remaining, cycleInputAvailable.get(demand.itemId) ?? 0);
    if (cycleRate > EPS) {
      cycleInputAvailable.set(demand.itemId, (cycleInputAvailable.get(demand.itemId) ?? 0) - cycleRate);
      remaining -= cycleRate;
      pushFlow(makeFlow({ type: 'itemSource', itemId: demand.itemId, sourceMode: 'cycleInput' }, consumer, demand.itemId, cycleRate, demand.role, conveyorItemsPerMinute));
    }
    const sourceRate = Math.min(remaining, sourceAvailable.get(demand.itemId) ?? 0);
    if (sourceRate > EPS) {
      sourceAvailable.set(demand.itemId, (sourceAvailable.get(demand.itemId) ?? 0) - sourceRate);
      remaining -= sourceRate;
      const sourceMode: SourceMode = demand.role === 'fuel' || demand.role === 'fertilizer' ? 'external' : 'buy';
      pushFlow(makeFlow({ type: 'itemSource', itemId: demand.itemId, sourceMode }, consumer, demand.itemId, sourceRate, demand.role, conveyorItemsPerMinute));
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
      messageJa: '新solverの計算が上限回数内に収束しませんでした。',
      messageEn: 'The new solver did not converge within the iteration limit.',
    });
  }
  if (solved.unresolved.has('__non_finite_or_huge__')) {
    errorSummaries.push({
      code: 'INTERNAL_ERROR_NON_FINITE_RESULT',
      messageJa: '新solverで有限ではない、または異常に大きい値が発生しました。',
      messageEn: 'The new solver produced a non-finite or excessively large value.',
    });
  }

  if (solved.cycleInputs.size > 0) {
    warnings.push({
      messageJa: '循環補填として ' + [...solved.cycleInputs.keys()].map((itemId) => itemById[itemId]?.name.ja ?? itemId).join(' / ') + ' を投入します。',
      messageEn: 'Cycle input is used for: ' + [...solved.cycleInputs.keys()].join(' / '),
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
      mode: 'balance-iterative-alpha4',
      iterations: solved.iterations,
      cycleInputItemIds: [...solved.cycleInputs.keys()],
      cycleInputRates: Object.fromEntries(solved.cycleInputs.entries()),
      unresolvedItemIds: invalidRootItemIds,
      notesJa: ['v0.7.0-alpha.5 の収支ベース反復solver結果です。完全な線形計画ソルバではありません。内部燃料/肥料など一部はレガシー互換フォールバックします。'],
      notesEn: ['Balance-based iterative solver result for v0.7.0-alpha.5. This is not a full linear-programming solver. Some cases still use the legacy-compatible fallback.'],
    },
  };
}
