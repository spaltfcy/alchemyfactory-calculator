import type {
  AbilitySettings,
  AppSettings,
  FertilizerSettings,
  FuelSettings,
  MachineRoundingMode,
  ProductionTarget,
  Recipe,
} from '../types';
import {
  RECIPES,
  recipeById,
  DEFAULT_RECIPE_BY_ITEM_ID,
  getRecipesProducing,
} from '../data/recipes';
import { economyByItemId } from '../data/economy';
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
  resolveHeatMachineId,
} from '../data/heat';
import { FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID } from '../data/fertilizer';
import { safeCeil } from '../utils/format';

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
  | { type: 'itemSource'; itemId: string; sourceMode: 'buy' | 'stock' }
  | { type: 'itemSink'; itemId: string; sinkMode: 'final' | 'discard' | 'surplus' };

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
  role: CalculatedFlowRole;
};

export type ConveyorEdgeStat = {
  id: string;
  fromItemId: string;
  toRecipeId: string;
  rate: number;
  belts: number;
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

export type CalculationResult = {
  itemStats: Record<string, ItemStat>;
  recipeStats: Record<string, RecipeStat>;
  flows: CalculatedFlow[];
  conveyorEdges: ConveyorEdgeStat[];
  outputEdges: OutputEdgeStat[];
  warnings: PlanWarning[];
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
  itemSourceModes: Record<string, string>;
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
    purchasedAutoCraftableCount: number;
  };
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
type SupplyLot = { recipeId: string; itemId: string; rate: number; originalRate: number; byproduct: boolean; primary: boolean };
type RunMap = Map<string, number>;
type TargetLock = { recipeId: string; itemId: string; targetId: string; requestedRate: number; actualRate: number; runsPerMinute: number };
type DirectTargetPurchase = { itemId: string; rate: number; targetId: string };
type RunAnalysis = {
  demandLots: DemandLot[];
  demandByItem: Map<string, number>;
  byproductSupplyByItem: Map<string, number>;
  heatByRecipe: Map<string, number>;
  fertilizerNutrientsByRecipe: Map<string, number>;
  heatRequiredPerMin: number;
  fertilizerNutrientsRequiredPerMin: number;
  fertilizerRequiredPerMin: number;
};

const EPS = 1e-9;
const MAX_SOLVE_ITERATIONS = 120;

const DEFAULT_FUEL_SETTINGS: FuelSettings = {
  enabled: true,
  fuelItemId: 'charcoal_powder',
  fuelSourceMode: 'craft',
  crucibleVariant: 'crucible',
  crucibleOverheadHeatPerSec: 0.4,
  otherOverheadHeatPerSec: 1,
  maxIterations: 8,
};

const DEFAULT_FERTILIZER_SETTINGS: FertilizerSettings = {
  enabled: false,
  fertilizerItemId: 'basic_fertilizer',
  fertilizerSourceMode: 'craft',
  nurseryNutrientsPerSec: 12,
  maxIterations: 4,
};

function normalizeFuelSettings(settings: AppSettings): FuelSettings {
  return {
    ...DEFAULT_FUEL_SETTINGS,
    ...(settings.fuel ?? {}),
    crucibleOverheadHeatPerSec: Math.max(0, Number(settings.fuel?.crucibleOverheadHeatPerSec ?? 0.4)),
    otherOverheadHeatPerSec: Math.max(0, Number(settings.fuel?.otherOverheadHeatPerSec ?? 1)),
    maxIterations: Math.max(1, Math.min(20, Math.floor(Number(settings.fuel?.maxIterations ?? 8)))),
  };
}

function normalizeFertilizerSettings(settings: AppSettings): FertilizerSettings {
  return {
    ...DEFAULT_FERTILIZER_SETTINGS,
    ...(settings.fertilizer ?? {}),
    nurseryNutrientsPerSec: Math.max(0, Number(settings.fertilizer?.nurseryNutrientsPerSec ?? 12)),
    maxIterations: Math.max(1, Math.min(12, Math.floor(Number(settings.fertilizer?.maxIterations ?? 4)))),
  };
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

function chooseRecipeForItem(itemId: string, recipePreferences: Record<string, string>): Recipe | undefined {
  const preferred = recipePreferences[itemId];
  if (preferred && recipeById[preferred]) return recipeById[preferred];
  const defaultRecipeId = DEFAULT_RECIPE_BY_ITEM_ID[itemId];
  if (defaultRecipeId && recipeById[defaultRecipeId]) return recipeById[defaultRecipeId];
  return getRecipesProducing(itemId)[0];
}

function shouldRound(mode: MachineRoundingMode, isFinal: boolean): boolean {
  if (mode === 'all') return true;
  if (mode === 'intermediate' && !isFinal) return true;
  return false;
}

function roundQuantity(rate: number, settings: AppSettings): number {
  const stepText = settings.quantityRoundingStep ?? 'none';
  if (stepText === 'none') return rate;
  const step = Number(stepText);
  if (!Number.isFinite(step) || step <= 0) return rate;
  return Math.ceil((rate - EPS) / step) * step;
}

function isNurserySeedInput(recipe: Recipe, itemId: string): boolean {
  return recipe.machineId === 'nursery' && itemId.endsWith('_seeds');
}

function heatPerMachinePerSecond(machineId: string, fuelSettings: FuelSettings): number {
  const heatMachineId = resolveHeatMachineId(machineId, fuelSettings.crucibleVariant);
  const config = HEAT_CONSUMER_BY_MACHINE_ID[heatMachineId];
  if (!config) return 0;
  const overhead = config.overheadKind === 'crucible' ? fuelSettings.crucibleOverheadHeatPerSec : fuelSettings.otherOverheadHeatPerSec;
  return config.heatPerSec + overhead;
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

  const lockedRuns: RunMap = new Map();
  const locks: TargetLock[] = [];
  const directTargetPurchases: DirectTargetPurchase[] = [];

  for (const target of input.targets) {
    const itemId = target.outputItemId;
    if (!itemId) continue;
    const recipe = target.recipeId && recipeById[target.recipeId] ? recipeById[target.recipeId] : chooseRecipeForItem(itemId, input.recipePreferences);
    if (!recipe) {
      directTargetPurchases.push({ itemId, rate: Math.max(0, target.value), targetId: target.id });
      continue;
    }
    const outputRate = outputRatePerMachine(recipe, itemId, productionSpeedMultiplier);
    if (outputRate <= EPS) {
      directTargetPurchases.push({ itemId, rate: Math.max(0, target.value), targetId: target.id });
      continue;
    }
    const machineRunRate = runRatePerMachine(recipe, productionSpeedMultiplier);
    let requestedRate: number;
    let actualMachines: number;
    if (target.mode === 'machines') {
      actualMachines = Math.max(0, target.value);
      requestedRate = actualMachines * outputRate;
    } else {
      requestedRate = Math.max(0, target.value);
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
    const fertilizerNutrientsByRecipe = new Map<string, number>();
    let heatRequiredPerMin = 0;
    let fertilizerNutrientsRequiredPerMin = 0;

    function addDemand(lot: DemandLot): void {
      if (lot.rate <= EPS) return;
      demandLots.push(lot);
      addToMap(demandByItem, lot.itemId, lot.rate);
    }

    for (const [recipeId, runsPerMinute] of runs.entries()) {
      const recipe = recipeById[recipeId];
      if (!recipe || runsPerMinute <= EPS) continue;
      const machineRunRate = runRatePerMachine(recipe, productionSpeedMultiplier);
      const actualMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
      const heatPerSec = heatPerMachinePerSecond(recipe.machineId, fuelSettings);
      const recipeHeat = fuelSettings.enabled && heatPerSec > EPS ? actualMachines * heatPerSec * 60 * heatConsumptionMultiplier : 0;
      if (recipeHeat > EPS) {
        heatRequiredPerMin += recipeHeat;
        heatByRecipe.set(recipe.id, recipeHeat);
      }
      const recipeNutrients = fertilizerSettings.enabled && recipe.machineId === 'nursery'
        ? actualMachines * fertilizerSettings.nurseryNutrientsPerSec * 60
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
        const primary = output.itemId === recipe.primaryOutputId;
        if (!primary) addToMap(byproductSupplyByItem, output.itemId, output.amount * (output.probability ?? 1) * runsPerMinute);
      }
    }

    if (fuelSettings.enabled && injectedFuelRate > EPS && fuelSettings.fuelSourceMode === 'craft' && heatRequiredPerMin > EPS) {
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
        if (fertilizerSettings.fertilizerSourceMode === 'craft') {
          for (const [recipeId, nutrients] of fertilizerNutrientsByRecipe.entries()) {
            addDemand({ itemId: fertilizerSettings.fertilizerItemId, rate: fertilizerRequiredPerMin * (nutrients / fertilizerNutrientsRequiredPerMin), consumerRecipeId: recipeId, role: 'fertilizer' });
          }
        }
      }
    }

    return { demandLots, demandByItem, byproductSupplyByItem, heatByRecipe, fertilizerNutrientsByRecipe, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin, fertilizerRequiredPerMin };
  }

  function desiredRunsFromAnalysis(analysis: RunAnalysis): RunMap {
    const desired = cloneRunMap(lockedRuns);
    for (const [itemId, demandRate] of analysis.demandByItem.entries()) {
      if (demandRate <= EPS) continue;
      const sourceMode = input.itemSourceModes[itemId] ?? 'auto';
      if (sourceMode === 'buy' || sourceMode === 'stock') continue;
      const byproductSupply = input.settings.defaultSurplusPolicy === 'reuse' ? (analysis.byproductSupplyByItem.get(itemId) ?? 0) : 0;
      const netRate = Math.max(0, demandRate - byproductSupply);
      if (netRate <= EPS) continue;
      const recipe = chooseRecipeForItem(itemId, input.recipePreferences);
      if (!recipe) continue;
      const outputRate = outputRatePerMachine(recipe, itemId, productionSpeedMultiplier);
      if (outputRate <= EPS) continue;
      const theoreticalMachines = netRate / outputRate;
      const actualMachines = shouldRound(input.settings.machineRounding, false) ? safeCeil(theoreticalMachines) : theoreticalMachines;
      addRun(desired, recipe.id, actualMachines * runRatePerMachine(recipe, productionSpeedMultiplier));
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

function pruneRunsWithUnusedPrimaryOutputs(candidateRuns: RunMap, injectedFuelRate: number): RunMap {
  let current = cloneRunMap(candidateRuns);

  function consumeLotsForPrune(
    lots: SupplyLot[] | undefined,
    rate: number,
    usedOutputByRecipe: Set<string>,
  ): number {
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
    const primaryLotsByItem = new Map<string, SupplyLot[]>();
    const byproductLotsByItem = new Map<string, SupplyLot[]>();
    const usedOutputByRecipe = new Set<string>();

    for (const [recipeId, runsPerMinute] of current.entries()) {
      const recipe = recipeById[recipeId];
      if (!recipe || runsPerMinute <= EPS) continue;
      for (const output of recipe.outputs) {
        const rate = output.amount * (output.probability ?? 1) * runsPerMinute;
        if (rate <= EPS) continue;
        const primary = output.itemId === recipe.primaryOutputId;
        const lot: SupplyLot = {
          recipeId: recipe.id,
          itemId: output.itemId,
          rate,
          originalRate: rate,
          byproduct: !primary,
          primary,
        };
        const map = primary ? primaryLotsByItem : byproductLotsByItem;
        const lots = map.get(output.itemId) ?? [];
        lots.push(lot);
        map.set(output.itemId, lots);
      }
    }

    for (const lock of locks) {
      consumeLotsForPrune(primaryLotsByItem.get(lock.itemId), lock.actualRate, usedOutputByRecipe);
    }

    for (const demand of analysis.demandLots) {
      let remaining = demand.rate;
      if (input.settings.defaultSurplusPolicy === 'reuse') {
        remaining = consumeLotsForPrune(byproductLotsByItem.get(demand.itemId), remaining, usedOutputByRecipe);
      }
      remaining = consumeLotsForPrune(primaryLotsByItem.get(demand.itemId), remaining, usedOutputByRecipe);
    }

    const reductions = new Map<string, number>();
    for (const [, lots] of primaryLotsByItem.entries()) {
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
        const runsForUnusedOutput = lot.rate / perRun;
        const reduceBy = Math.min(removableRuns, runsForUnusedOutput);
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
    const sourceMode = input.itemSourceModes[itemId] ?? 'auto';
    if (sourceMode === 'buy' || sourceMode === 'stock') return;
    const recipe = chooseRecipeForItem(itemId, input.recipePreferences);
    if (!recipe) return;
    const outputRate = outputRatePerMachine(recipe, itemId, productionSpeedMultiplier);
    if (outputRate <= EPS) return;
    const theoreticalMachines = missingRate / outputRate;
    const actualMachines = shouldRound(input.settings.machineRounding, false) ? safeCeil(theoreticalMachines) : theoreticalMachines;
    addRun(map, recipe.id, actualMachines * runRatePerMachine(recipe, productionSpeedMultiplier));
  }

  function findUnresolvedAutoDemands(runs: RunMap, injectedFuelRate: number): { analysis: RunAnalysis; missingByItem: Map<string, number> } {
    const analysis = analyzeRuns(runs, injectedFuelRate);
    const primaryLotsByItem = new Map<string, SupplyLot[]>();
    const byproductLotsByItem = new Map<string, SupplyLot[]>();

    for (const [recipeId, runsPerMinute] of runs.entries()) {
      const recipe = recipeById[recipeId];
      if (!recipe || runsPerMinute <= EPS) continue;
      for (const output of recipe.outputs) {
        const rate = output.amount * (output.probability ?? 1) * runsPerMinute;
        if (rate <= EPS) continue;
        const primary = output.itemId === recipe.primaryOutputId;
        const lot: SupplyLot = { recipeId: recipe.id, itemId: output.itemId, rate, originalRate: rate, byproduct: !primary, primary };
        const map = primary ? primaryLotsByItem : byproductLotsByItem;
        const lots = map.get(output.itemId) ?? [];
        lots.push(lot);
        map.set(output.itemId, lots);
      }
    }

    for (const lock of locks) {
      consumeSupplyLots(primaryLotsByItem.get(lock.itemId), lock.actualRate);
    }

    const missingByItem = new Map<string, number>();
    for (const demand of analysis.demandLots) {
      let remaining = demand.rate;
      if (input.settings.defaultSurplusPolicy === 'reuse') {
        remaining = consumeSupplyLots(byproductLotsByItem.get(demand.itemId), remaining);
      }
      remaining = consumeSupplyLots(primaryLotsByItem.get(demand.itemId), remaining);
      if (remaining <= EPS) continue;
      const sourceMode = input.itemSourceModes[demand.itemId] ?? 'auto';
      if (sourceMode !== 'auto') continue;
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
      desired = pruneRunsWithUnusedPrimaryOutputs(desired, injectedFuelRate);
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

    function stat(itemId: string): ItemStat {
      itemStats[itemId] ??= createItemStat(itemId);
      return itemStats[itemId];
    }

    function addFlow(from: CalculatedEndpoint, to: CalculatedEndpoint, itemId: string, rate: number, role: CalculatedFlowRole): void {
      if (rate <= EPS) return;
      const idBase = endpointKey(from) + '->' + endpointKey(to) + ':' + itemId + ':' + role;
      const existing = flows.find((flow) => flow.id === idBase);
      if (existing) {
        existing.rate += rate;
        existing.belts = safeCeil(existing.rate / conveyorItemsPerMinute);
        return;
      }
      flows.push({ id: idBase, from, to, itemId, rate, belts: safeCeil(rate / conveyorItemsPerMinute), role });
    }

    function addPurchase(itemId: string, rate: number): void {
      if (rate <= EPS) return;
      const rounded = roundQuantity(rate, input.settings);
      const s = stat(itemId);
      s.purchased += rounded;
      const buyPrice = economyByItemId[itemId]?.buyPriceCopper;
      if (buyPrice !== undefined) s.purchaseCostCopperPerMin += rounded * buyPrice;
      else warnings.push({ messageJa: itemId + ' は購入扱いですが購入価格が未定義です。', messageEn: itemId + ' is purchased, but buy price is not defined.' });
    }

    function addInitialPurchase(itemId: string, count: number): void {
      if (count <= EPS) return;
      const sourceMode = input.itemSourceModes[itemId] ?? 'auto';
      if (sourceMode === 'stock') return;
      const s = stat(itemId);
      s.initialPurchased += count;
      const buyPrice = economyByItemId[itemId]?.buyPriceCopper;
      if (buyPrice !== undefined) s.initialCostCopper += count * buyPrice;
      else warnings.push({ messageJa: itemId + ' は初期投入扱いですが購入価格が未定義です。', messageEn: itemId + ' is a setup input, but buy price is not defined.' });
    }

    const primaryLotsByItem = new Map<string, SupplyLot[]>();
    const byproductLotsByItem = new Map<string, SupplyLot[]>();
    const targetReservedByItem = new Map<string, number>();

    for (const [recipeId, runsPerMinute] of runs.entries()) {
      const recipe = recipeById[recipeId];
      if (!recipe || runsPerMinute <= EPS) continue;
      const machineRunRate = runRatePerMachine(recipe, productionSpeedMultiplier);
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
      addPurchase(target.itemId, target.rate);
      addFlow({ type: 'itemSource', itemId: target.itemId, sourceMode: 'buy' }, { type: 'itemSink', itemId: target.itemId, sinkMode: 'final' }, target.itemId, target.rate, 'finalOutput');
    }

    for (const [recipeId, runsPerMinute] of runs.entries()) {
      const recipe = recipeById[recipeId];
      const rs = recipeStats[recipeId];
      if (!recipe || !rs || runsPerMinute <= EPS) continue;
      for (const recipeInput of recipe.inputs) {
        if (isNurserySeedInput(recipe, recipeInput.itemId)) {
          const machineRunRate = runRatePerMachine(recipe, productionSpeedMultiplier);
          const actualMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
          addInitialPurchase(recipeInput.itemId, recipeInput.amount * actualMachines);
          continue;
        }
        addToRecord(rs.inputRates, recipeInput.itemId, recipeInput.amount * runsPerMinute);
      }
      for (const output of recipe.outputs) {
        const rate = output.amount * (output.probability ?? 1) * runsPerMinute;
        const primary = output.itemId === recipe.primaryOutputId;
        const lot: SupplyLot = { recipeId: recipe.id, itemId: output.itemId, rate, originalRate: rate, byproduct: !primary, primary };
        const map = primary ? primaryLotsByItem : byproductLotsByItem;
        const lots = map.get(output.itemId) ?? [];
        lots.push(lot);
        map.set(output.itemId, lots);
        stat(output.itemId).produced += rate;
        addToRecord(rs.outputRates, output.itemId, rate);
      }
    }

    // Final outputs consume the corresponding primary supply before ordinary demands do.
    for (const [itemId, reserved] of targetReservedByItem.entries()) {
      let remaining = reserved;
      for (const lot of primaryLotsByItem.get(itemId) ?? []) {
        if (remaining <= EPS) break;
        const take = Math.min(lot.rate, remaining);
        lot.rate -= take;
        remaining -= take;
      }
    }

    for (const demand of analysis.demandLots) {
      let remaining = demand.rate;
      const s = stat(demand.itemId);
      s.requested += demand.rate;
      s.consumed += demand.rate;
      const consumer = { type: 'recipe', recipeId: demand.consumerRecipeId } as const;
      const demandRole: CalculatedFlowRole = demand.role === 'fuel' ? 'fuel' : demand.role === 'fertilizer' ? 'fertilizer' : 'material';

      if (input.settings.defaultSurplusPolicy === 'reuse') {
        for (const lot of byproductLotsByItem.get(demand.itemId) ?? []) {
          if (remaining <= EPS) break;
          if (lot.rate <= EPS) continue;
          const take = Math.min(lot.rate, remaining);
          lot.rate -= take;
          remaining -= take;
          s.reused += take;
          addFlow({ type: 'recipe', recipeId: lot.recipeId }, consumer, demand.itemId, take, demand.role === 'material' ? 'byproductReuse' : demandRole);
        }
      }

      for (const lot of primaryLotsByItem.get(demand.itemId) ?? []) {
        if (remaining <= EPS) break;
        if (lot.rate <= EPS) continue;
        const take = Math.min(lot.rate, remaining);
        lot.rate -= take;
        remaining -= take;
        addFlow({ type: 'recipe', recipeId: lot.recipeId }, consumer, demand.itemId, take, demandRole);
      }

      if (remaining > 0.000001) {
        const mode = input.itemSourceModes[demand.itemId] === 'stock' ? 'stock' : 'buy';
        if (mode === 'buy') addPurchase(demand.itemId, remaining);
        addFlow({ type: 'itemSource', itemId: demand.itemId, sourceMode: mode }, consumer, demand.itemId, remaining, demandRole);
      }
    }

    if (fuelSettings.enabled && injectedFuelRate > EPS && fuelSettings.fuelSourceMode === 'buy' && analysis.heatRequiredPerMin > EPS) {
      for (const [recipeId, heat] of analysis.heatByRecipe.entries()) {
        const rate = injectedFuelRate * (heat / analysis.heatRequiredPerMin);
        const s = stat(fuelSettings.fuelItemId);
        s.requested += rate;
        s.consumed += rate;
        addPurchase(fuelSettings.fuelItemId, rate);
        addFlow({ type: 'itemSource', itemId: fuelSettings.fuelItemId, sourceMode: 'buy' }, { type: 'recipe', recipeId }, fuelSettings.fuelItemId, rate, 'fuel');
      }
    }

    if (fertilizerSettings.enabled && analysis.fertilizerRequiredPerMin > EPS && fertilizerSettings.fertilizerSourceMode === 'buy' && analysis.fertilizerNutrientsRequiredPerMin > EPS) {
      for (const [recipeId, nutrients] of analysis.fertilizerNutrientsByRecipe.entries()) {
        const rate = analysis.fertilizerRequiredPerMin * (nutrients / analysis.fertilizerNutrientsRequiredPerMin);
        const s = stat(fertilizerSettings.fertilizerItemId);
        s.requested += rate;
        s.consumed += rate;
        addPurchase(fertilizerSettings.fertilizerItemId, rate);
        addFlow({ type: 'itemSource', itemId: fertilizerSettings.fertilizerItemId, sourceMode: 'buy' }, { type: 'recipe', recipeId }, fertilizerSettings.fertilizerItemId, rate, 'fertilizer');
      }
    }

    for (const [itemId, lots] of primaryLotsByItem.entries()) {
      for (const lot of lots) {
        if (lot.rate <= EPS) continue;
        const rs = recipeStats[lot.recipeId];
        const s = stat(itemId);
        s.surplus += lot.rate;
        if (rs) addToRecord(rs.surplusOutputRates, itemId, lot.rate);
        addFlow({ type: 'recipe', recipeId: lot.recipeId }, { type: 'itemSink', itemId, sinkMode: 'surplus' }, itemId, lot.rate, 'surplus');
      }
    }

    for (const [itemId, lots] of byproductLotsByItem.entries()) { for (const lot of lots) { if (lot.rate <= EPS) continue; const rs = recipeStats[lot.recipeId]; const s = stat(itemId); s.discarded += lot.rate; if (rs) { addToRecord(rs.discardedOutputRates, itemId, lot.rate); } addFlow({ type: 'recipe', recipeId: lot.recipeId }, { type: 'itemSink', itemId, sinkMode: 'discard' }, itemId, lot.rate, 'discard'); } }

    for (const itemId of new Set(input.targets.map((target) => target.outputItemId).filter(Boolean))) {
      const s = stat(itemId as string);
      const sellPrice = economyByItemId[itemId as string]?.sellPriceCopper;
      if (sellPrice !== undefined) s.revenueCopperPerMin = s.targetActual * sellPrice * sellPriceMultiplier;
    }

    if (fuelSettings.enabled && (FUEL_HEAT_VALUE_BY_ITEM_ID[fuelSettings.fuelItemId] ?? 0) <= EPS) {
      warnings.push({ messageJa: fuelSettings.fuelItemId + ' の燃料熱量が未定義です。', messageEn: 'Fuel heat value is not defined for ' + fuelSettings.fuelItemId + '.' });
    }
    if (fertilizerSettings.enabled && analysis.fertilizerNutrientsRequiredPerMin > EPS) {
      const nutrientValue = FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerSettings.fertilizerItemId] ?? 0;
      if (nutrientValue <= EPS) warnings.push({ messageJa: fertilizerSettings.fertilizerItemId + ' の肥料栄養値が未定義です。', messageEn: 'Fertilizer nutrient value is not defined for ' + fertilizerSettings.fertilizerItemId + '.' });
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
  if (fuelSettings.enabled) {
    let injectedFuelRate = 0;
    for (let i = 0; i < fuelSettings.maxIterations; i += 1) {
      fuelIterations = i + 1;
      const nextFuelRate = result.totals.fuelRequiredPerMin;
      result = buildPlan(nextFuelRate);
      if (Math.abs(nextFuelRate - injectedFuelRate) < 0.0001) break;
      injectedFuelRate = nextFuelRate;
    }
  }

  return {
    ...result,
    totals: {
      ...result.totals,
      fuelIterations,
      calculationMs: Math.max(0, nowMs() - startedAt),
    },
  };
}

export function calculateWithDebug(input: CalculateInput): CalculationDebugResult {
  const result = calculate(input);
  const issues: CalculationDebugIssue[] = [];
  const flowsByRole: Record<string, number> = {};
  const purchasedAutoCraftableFlows: CalculationDebugLog['purchasedAutoCraftableFlows'] = [];

  for (const flow of result.flows) {
    flowsByRole[flow.role] = (flowsByRole[flow.role] ?? 0) + 1;

    if (flow.from.type === 'itemSource' && flow.from.sourceMode === 'buy' && flow.to.type === 'recipe') {
      const sourceMode = input.itemSourceModes[flow.itemId] ?? 'auto';
      const selectedRecipe = chooseRecipeForItem(flow.itemId, input.recipePreferences);
      if (sourceMode === 'auto' && selectedRecipe && flow.rate > 0.000001) {
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

  for (const stat of Object.values(result.itemStats)) {
    if (stat.surplus > EPS && stat.discarded > EPS) {
      issues.push({
        severity: 'warning',
        code: 'ITEM_HAS_BOTH_SURPLUS_AND_DISCARD',
        messageJa: '同じアイテムに余剰と破棄が同時に出ています。主生成物余りと副産物余りが混在していないか確認してください。',
        messageEn: 'The same item has both surplus and discard. Check whether primary leftovers and byproduct leftovers are mixed.',
        data: { itemId: stat.itemId, surplus: stat.surplus, discarded: stat.discarded },
      });
    }
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
      purchasedAutoCraftableCount: purchasedAutoCraftableFlows.length,
    },
    purchasedAutoCraftableFlows,
    flows: result.flows,
    itemStats: Object.values(result.itemStats).sort((a, b) => a.itemId.localeCompare(b.itemId)),
    recipeStats: Object.values(result.recipeStats).sort((a, b) => a.recipeId.localeCompare(b.recipeId)),
  };

  return { result, debugLog };
}

export function getByproductKeys(): Array<{ key: string; recipeId: string; itemId: string }> {
  return RECIPES.flatMap((recipe) =>
    recipe.outputs
      .filter((output) => output.itemId !== recipe.primaryOutputId)
      .map((output) => ({ key: recipe.id + ':' + output.itemId, recipeId: recipe.id, itemId: output.itemId })),
  );
}
