import type {
  AbilitySettings,
  AppSettings,
  FertilizerSettings,
  FuelSettings,
  MachineRoundingMode,
  ProductionTarget,
  Recipe,
} from '../types';
import { RECIPES, recipeById, DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing } from '../data/recipes';
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
export type OutputEdgeStat = { id: string; fromRecipeId: string; toItemId: string; rate: number; byproduct: boolean; discarded: boolean };
export type PlanWarning = { messageJa: string; messageEn: string };

export type CalculationResult = {
  itemStats: Record<string, ItemStat>;
  recipeStats: Record<string, RecipeStat>;
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

type WorkRole = 'target' | 'material' | 'fuel' | 'fertilizer';
type DemandLot = { itemId: string; rate: number; consumerRecipeId?: string; role: WorkRole };
type OutputLot = { recipeId: string; itemId: string; rate: number; byproduct: boolean; primary: boolean };
type SupplyLot = { recipeId: string; itemId: string; rate: number; byproduct: boolean };
type RunMap = Map<string, number>;

type TargetLock = {
  recipeId: string;
  itemId: string;
  targetId: string;
  requestedRate: number;
  actualRate: number;
  runsPerMinute: number;
};

type RunAnalysis = {
  demandLots: DemandLot[];
  demandByItem: Map<string, number>;
  byproductSupplyByItem: Map<string, number>;
  outputLots: OutputLot[];
  heatRequiredPerMin: number;
  fertilizerNutrientsRequiredPerMin: number;
  fertilizerRequiredPerMin: number;
};

const EPS = 1e-9;
const MAX_SOLVE_ITERATIONS = 80;
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

function calculationNowMs(): number {
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
  record[key] = (record[key] ?? 0) + value;
  if (Math.abs(record[key]) <= EPS) delete record[key];
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

function runRatePerMachine(recipe: Recipe, productionSpeedMultiplier: number): number {
  return (60 / recipe.timeSec) * productionSpeedMultiplier;
}

function outputPerRun(recipe: Recipe, itemId: string): number {
  const output = recipe.outputs.find((x) => x.itemId === itemId);
  if (!output) return 0;
  return output.amount * (output.probability ?? 1);
}

function getOutputRatePerMachine(recipe: Recipe, itemId: string, productionSpeedMultiplier: number): number {
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

function cloneRunMap(map: RunMap): RunMap {
  return new Map([...map.entries()].filter(([, value]) => value > EPS));
}

export function calculate(input: CalculateInput): CalculationResult {
  const calculationStartedAtMs = calculationNowMs();
  const fuelSettings = normalizeFuelSettings(input.settings);
  const fertilizerSettings = normalizeFertilizerSettings(input.settings);
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const heatConsumptionMultiplier = getHeatConsumptionMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const sellPriceMultiplier = getSellPriceMultiplier(input.abilities, 'shop');
  const fuelHeatValueMultiplier = getFuelHeatValueMultiplier(input.abilities);
  const fertilizerNutritionMultiplier = getFertilizerNutritionMultiplier(input.abilities);

  function buildTargetLocks(): { lockedRuns: RunMap; locks: TargetLock[]; directTargetPurchases: Array<{ itemId: string; rate: number; targetId: string }> } {
    const lockedRuns: RunMap = new Map();
    const locks: TargetLock[] = [];
    const directTargetPurchases: Array<{ itemId: string; rate: number; targetId: string }> = [];
    for (const target of input.targets) {
      const outputItemId = target.outputItemId;
      if (!outputItemId) continue;
      const recipe = target.recipeId && recipeById[target.recipeId]
        ? recipeById[target.recipeId]
        : chooseRecipeForItem(outputItemId, input.recipePreferences);
      if (!recipe) {
        const rate = Math.max(0, target.value);
        directTargetPurchases.push({ itemId: outputItemId, rate, targetId: target.id });
        continue;
      }
      const outputRate = getOutputRatePerMachine(recipe, outputItemId, productionSpeedMultiplier);
      if (outputRate <= EPS) {
        directTargetPurchases.push({ itemId: outputItemId, rate: Math.max(0, target.value), targetId: target.id });
        continue;
      }
      const machineRunRate = runRatePerMachine(recipe, productionSpeedMultiplier);
      let actualMachines: number;
      let requestedRate: number;
      if (target.mode === 'machines') {
        actualMachines = Math.max(0, target.value);
        requestedRate = actualMachines * outputRate;
      } else {
        requestedRate = Math.max(0, target.value);
        const theoreticalMachines = requestedRate / outputRate;
        actualMachines = shouldRound(input.settings.machineRounding, true) ? safeCeil(theoreticalMachines) : theoreticalMachines;
      }
      const runsPerMinute = actualMachines * machineRunRate;
      const actualRate = outputPerRun(recipe, outputItemId) * runsPerMinute;
      addRun(lockedRuns, recipe.id, runsPerMinute);
      locks.push({ recipeId: recipe.id, itemId: outputItemId, targetId: target.id, requestedRate, actualRate, runsPerMinute });
    }
    return { lockedRuns, locks, directTargetPurchases };
  }

  const { lockedRuns, locks, directTargetPurchases } = buildTargetLocks();

  function analyzeRuns(runs: RunMap, injectedFuelRate: number): RunAnalysis {
    const demandLots: DemandLot[] = [];
    const demandByItem = new Map<string, number>();
    const byproductSupplyByItem = new Map<string, number>();
    const outputLots: OutputLot[] = [];
    let heatRequiredPerMin = 0;
    let fertilizerNutrientsRequiredPerMin = 0;

    function addDemand(lot: DemandLot): void {
      if (lot.rate <= EPS) return;
      demandLots.push(lot);
      addToMap(demandByItem, lot.itemId, lot.rate);
    }

    for (const [recipeId, runsPerMinute] of runs.entries()) {
      if (runsPerMinute <= EPS) continue;
      const recipe = recipeById[recipeId];
      if (!recipe) continue;
      const machineRunRate = runRatePerMachine(recipe, productionSpeedMultiplier);
      const actualMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
      const heatPerSec = heatPerMachinePerSecond(recipe.machineId, fuelSettings);
      if (fuelSettings.enabled && heatPerSec > EPS) heatRequiredPerMin += actualMachines * heatPerSec * 60 * heatConsumptionMultiplier;
      if (fertilizerSettings.enabled && recipe.machineId === 'nursery') {
        fertilizerNutrientsRequiredPerMin += actualMachines * fertilizerSettings.nurseryNutrientsPerSec * 60;
      }
      for (const recipeInput of recipe.inputs) {
        if (isNurserySeedInput(recipe, recipeInput.itemId)) continue;
        addDemand({ itemId: recipeInput.itemId, rate: recipeInput.amount * runsPerMinute, consumerRecipeId: recipe.id, role: 'material' });
      }
      for (const output of recipe.outputs) {
        const rate = output.amount * (output.probability ?? 1) * runsPerMinute;
        const primary = output.itemId === recipe.primaryOutputId;
        const byproduct = !primary;
        outputLots.push({ recipeId: recipe.id, itemId: output.itemId, rate, primary, byproduct });
        if (byproduct) addToMap(byproductSupplyByItem, output.itemId, rate);
      }
    }

    if (fuelSettings.enabled && injectedFuelRate > EPS && fuelSettings.fuelSourceMode === 'craft') {
      addDemand({ itemId: fuelSettings.fuelItemId, rate: injectedFuelRate, role: 'fuel' });
    }

    let fertilizerRequiredPerMin = 0;
    if (fertilizerSettings.enabled && fertilizerNutrientsRequiredPerMin > EPS) {
      const nutrientValue = FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerSettings.fertilizerItemId] ?? 0;
      const effectiveNutrientValue = nutrientValue * fertilizerNutritionMultiplier;
      if (effectiveNutrientValue > EPS) {
        fertilizerRequiredPerMin = fertilizerNutrientsRequiredPerMin / effectiveNutrientValue;
        if (fertilizerSettings.fertilizerSourceMode === 'craft') {
          addDemand({ itemId: fertilizerSettings.fertilizerItemId, rate: fertilizerRequiredPerMin, role: 'fertilizer' });
        }
      }
    }

    return { demandLots, demandByItem, byproductSupplyByItem, outputLots, heatRequiredPerMin, fertilizerNutrientsRequiredPerMin, fertilizerRequiredPerMin };
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
      const outputRate = getOutputRatePerMachine(recipe, itemId, productionSpeedMultiplier);
      if (outputRate <= EPS) continue;
      const theoreticalMachines = netRate / outputRate;
      const actualMachines = shouldRound(input.settings.machineRounding, false) ? safeCeil(theoreticalMachines) : theoreticalMachines;
      const runsPerMinute = actualMachines * runRatePerMachine(recipe, productionSpeedMultiplier);
      addRun(desired, recipe.id, runsPerMinute);
    }
    return desired;
  }

  function solveRuns(injectedFuelRate: number): { runs: RunMap; analysis: RunAnalysis; byproductIterations: number; queueSteps: number; queueMax: number } {
    let runs = cloneRunMap(lockedRuns);
    let analysis = analyzeRuns(runs, injectedFuelRate);
    let byproductIterations = 0;
    let queueMax = 0;
    for (let i = 0; i < MAX_SOLVE_ITERATIONS; i += 1) {
      byproductIterations = i + 1;
      const desired = desiredRunsFromAnalysis(analysis);
      queueMax = Math.max(queueMax, desired.size);
      if (mapsAlmostEqual(runs, desired)) {
        runs = desired;
        analysis = analyzeRuns(runs, injectedFuelRate);
        break;
      }
      runs = desired;
      analysis = analyzeRuns(runs, injectedFuelRate);
    }
    return { runs, analysis, byproductIterations, queueSteps: byproductIterations, queueMax };
  }

  function buildPlan(injectedFuelRate: number): CalculationResult {
    const solved = solveRuns(injectedFuelRate);
    const { runs, analysis } = solved;
    const itemStats: Record<string, ItemStat> = {};
    const recipeStats: Record<string, RecipeStat> = {};
    const conveyorEdgesByKey: Record<string, ConveyorEdgeStat> = {};
    const outputEdgesByKey: Record<string, OutputEdgeStat> = {};
    const warnings: PlanWarning[] = [];

    function stat(itemId: string): ItemStat {
      itemStats[itemId] ??= createItemStat(itemId);
      return itemStats[itemId];
    }

    function recipeStat(recipe: Recipe, runsPerMinute: number): RecipeStat {
      const machineRunRate = runRatePerMachine(recipe, productionSpeedMultiplier);
      const actualMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
      recipeStats[recipe.id] ??= {
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
      return recipeStats[recipe.id];
    }

    function addConveyorEdge(itemId: string, recipeId: string, rate: number, fromRecipeId?: string, role: ConveyorEdgeStat['role'] = 'material'): void {
      if (rate <= EPS) return;
      const sourceKey = fromRecipeId ? 'recipe:' + fromRecipeId : 'item';
      const id = sourceKey + ':' + itemId + '->' + recipeId + ':' + role;
      const current = conveyorEdgesByKey[id];
      if (current) {
        current.rate += rate;
        current.belts = safeCeil(current.rate / conveyorItemsPerMinute);
        return;
      }
      conveyorEdgesByKey[id] = {
        id,
        fromItemId: itemId,
        toRecipeId: recipeId,
        rate,
        belts: safeCeil(rate / conveyorItemsPerMinute),
        fromRecipeId,
        sourceKind: fromRecipeId ? 'recipe' : 'item',
        role,
      };
    }

    function addOutputEdge(recipeId: string, itemId: string, rate: number, byproduct: boolean, discarded: boolean): void {
      if (rate <= EPS) return;
      const suffix = discarded ? ':discard' : '';
      const id = recipeId + '->' + itemId + suffix;
      const current = outputEdgesByKey[id];
      if (current) {
        current.rate += rate;
        return;
      }
      outputEdgesByKey[id] = { id, fromRecipeId: recipeId, toItemId: itemId, rate, byproduct, discarded };
    }

    function purchaseItem(itemId: string, rate: number): void {
      if (rate <= EPS) return;
      const roundedRate = roundQuantity(rate, input.settings);
      const s = stat(itemId);
      s.purchased += roundedRate;
      const buyPrice = economyByItemId[itemId]?.buyPriceCopper;
      if (buyPrice !== undefined) {
        s.purchaseCostCopperPerMin += roundedRate * buyPrice;
      } else {
        warnings.push({
          messageJa: itemId + ' は購入扱いですが購入価格が未定義です。',
          messageEn: itemId + ' is purchased, but buy price is not defined.',
        });
      }
    }

    function addInitialPurchase(itemId: string, count: number): void {
      if (count <= EPS) return;
      const sourceMode = input.itemSourceModes[itemId] ?? 'auto';
      if (sourceMode === 'stock') return;
      const s = stat(itemId);
      s.initialPurchased += count;
      const buyPrice = economyByItemId[itemId]?.buyPriceCopper;
      if (buyPrice !== undefined) {
        s.initialCostCopper += count * buyPrice;
      } else {
        warnings.push({
          messageJa: itemId + ' は初期投入扱いですが購入価格が未定義です。',
          messageEn: itemId + ' is a setup input, but buy price is not defined.',
        });
      }
    }

    const primaryLotsByItem = new Map<string, SupplyLot[]>();
    const byproductLotsByItem = new Map<string, SupplyLot[]>();
    const targetReservedByItem = new Map<string, number>();

    for (const lock of locks) {
      const s = stat(lock.itemId);
      s.targetRequested += lock.requestedRate;
      s.targetActual += lock.actualRate;
      addToMap(targetReservedByItem, lock.itemId, lock.actualRate);
      const rs = recipeStats[lock.recipeId];
      if (rs && !rs.targetIds.includes(lock.targetId)) rs.targetIds.push(lock.targetId);
    }

    for (const target of directTargetPurchases) {
      const s = stat(target.itemId);
      s.targetRequested += target.rate;
      s.targetActual += target.rate;
      purchaseItem(target.itemId, target.rate);
    }

    for (const [recipeId, runsPerMinute] of runs.entries()) {
      if (runsPerMinute <= EPS) continue;
      const recipe = recipeById[recipeId];
      if (!recipe) continue;
      const rs = recipeStat(recipe, runsPerMinute);
      for (const recipeInput of recipe.inputs) {
        if (isNurserySeedInput(recipe, recipeInput.itemId)) {
          const machineRunRate = runRatePerMachine(recipe, productionSpeedMultiplier);
          const actualMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
          addInitialPurchase(recipeInput.itemId, recipeInput.amount * actualMachines);
          continue;
        }
        const rate = recipeInput.amount * runsPerMinute;
        addToRecord(rs.inputRates, recipeInput.itemId, rate);
      }
      for (const output of recipe.outputs) {
        const rate = output.amount * (output.probability ?? 1) * runsPerMinute;
        const primary = output.itemId === recipe.primaryOutputId;
        const byproduct = !primary;
        const lot: SupplyLot = { recipeId: recipe.id, itemId: output.itemId, rate, byproduct };
        const map = primary ? primaryLotsByItem : byproductLotsByItem;
        const lots = map.get(output.itemId) ?? [];
        lots.push(lot);
        map.set(output.itemId, lots);
        const s = stat(output.itemId);
        s.produced += rate;
        addToRecord(rs.outputRates, output.itemId, rate);
        addOutputEdge(recipe.id, output.itemId, rate, byproduct, false);
      }
    }

    for (const [itemId, reserved] of targetReservedByItem.entries()) {
      let remaining = reserved;
      const primaryLots = primaryLotsByItem.get(itemId) ?? [];
      for (const lot of primaryLots) {
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

      if (input.settings.defaultSurplusPolicy === 'reuse') {
        const byproductLots = byproductLotsByItem.get(demand.itemId) ?? [];
        for (const lot of byproductLots) {
          if (remaining <= EPS) break;
          if (lot.rate <= EPS) continue;
          const take = Math.min(lot.rate, remaining);
          lot.rate -= take;
          remaining -= take;
          s.reused += take;
          if (demand.consumerRecipeId) addConveyorEdge(demand.itemId, demand.consumerRecipeId, take, lot.recipeId, 'byproduct');
        }
      }

      const primaryLots = primaryLotsByItem.get(demand.itemId) ?? [];
      for (const lot of primaryLots) {
        if (remaining <= EPS) break;
        if (lot.rate <= EPS) continue;
        const take = Math.min(lot.rate, remaining);
        lot.rate -= take;
        remaining -= take;
        if (demand.consumerRecipeId) addConveyorEdge(demand.itemId, demand.consumerRecipeId, take, lot.recipeId, demand.role === 'fuel' ? 'fuel' : demand.role === 'fertilizer' ? 'fertilizer' : 'material');
      }

      if (remaining > EPS) {
        const sourceMode = input.itemSourceModes[demand.itemId] ?? 'auto';
        if (sourceMode !== 'stock') purchaseItem(demand.itemId, remaining);
        if (demand.consumerRecipeId) addConveyorEdge(demand.itemId, demand.consumerRecipeId, remaining, undefined, demand.role === 'fuel' ? 'fuel' : demand.role === 'fertilizer' ? 'fertilizer' : 'material');
      }
    }

    if (fuelSettings.enabled && injectedFuelRate > EPS && fuelSettings.fuelSourceMode === 'buy') {
      const s = stat(fuelSettings.fuelItemId);
      s.requested += injectedFuelRate;
      s.consumed += injectedFuelRate;
      purchaseItem(fuelSettings.fuelItemId, injectedFuelRate);
    }

    if (fertilizerSettings.enabled && analysis.fertilizerRequiredPerMin > EPS && fertilizerSettings.fertilizerSourceMode === 'buy') {
      const s = stat(fertilizerSettings.fertilizerItemId);
      s.requested += analysis.fertilizerRequiredPerMin;
      s.consumed += analysis.fertilizerRequiredPerMin;
      purchaseItem(fertilizerSettings.fertilizerItemId, analysis.fertilizerRequiredPerMin);
    }

    for (const [itemId, lots] of primaryLotsByItem.entries()) {
      for (const lot of lots) {
        if (lot.rate <= EPS) continue;
        const s = stat(itemId);
        s.surplus += lot.rate;
        const rs = recipeStats[lot.recipeId];
        if (rs) addToRecord(rs.surplusOutputRates, itemId, lot.rate);
      }
    }

    for (const [itemId, lots] of byproductLotsByItem.entries()) {
      for (const lot of lots) {
        if (lot.rate <= EPS) continue;
        const s = stat(itemId);
        s.surplus += lot.rate;
        s.discarded += lot.rate;
        const rs = recipeStats[lot.recipeId];
        if (rs) {
          addToRecord(rs.surplusOutputRates, itemId, lot.rate);
          addToRecord(rs.discardedOutputRates, itemId, lot.rate);
        }
        addOutputEdge(lot.recipeId, itemId, lot.rate, true, true);
      }
    }

    for (const itemId of new Set(input.targets.map((target) => target.outputItemId).filter(Boolean))) {
      const s = stat(itemId as string);
      const sellPrice = economyByItemId[itemId as string]?.sellPriceCopper;
      if (sellPrice !== undefined) s.revenueCopperPerMin = s.targetActual * sellPrice * sellPriceMultiplier;
    }

    if (fuelSettings.enabled && (FUEL_HEAT_VALUE_BY_ITEM_ID[fuelSettings.fuelItemId] ?? 0) <= EPS) {
      warnings.push({
        messageJa: fuelSettings.fuelItemId + ' の燃料熱量が未定義です。',
        messageEn: 'Fuel heat value is not defined for ' + fuelSettings.fuelItemId + '.',
      });
    }
    if (fertilizerSettings.enabled && analysis.fertilizerNutrientsRequiredPerMin > EPS) {
      const nutrientValue = FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerSettings.fertilizerItemId] ?? 0;
      if (nutrientValue <= EPS) {
        warnings.push({
          messageJa: fertilizerSettings.fertilizerItemId + ' の肥料栄養値が未定義です。',
          messageEn: 'Fertilizer nutrient value is not defined for ' + fertilizerSettings.fertilizerItemId + '.',
        });
      }
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

    return {
      itemStats,
      recipeStats,
      conveyorEdges: Object.values(conveyorEdgesByKey),
      outputEdges: Object.values(outputEdgesByKey),
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
        byproductIterations: solved.byproductIterations,
        queueSteps: solved.queueSteps,
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
      calculationMs: Math.max(0, calculationNowMs() - calculationStartedAtMs),
    },
  };
}

export function getByproductKeys(): Array<{ key: string; recipeId: string; itemId: string }> {
  return RECIPES.flatMap((recipe) =>
    recipe.outputs
      .filter((output) => output.itemId !== recipe.primaryOutputId)
      .map((output) => ({ key: recipe.id + ':' + output.itemId, recipeId: recipe.id, itemId: output.itemId })),
  );
}
