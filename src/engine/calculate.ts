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
  fromRecipeId?: string;
  rate: number;
  belts: number;
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


function sumHeatRequiredPerMin(recipeStats: Record<string, RecipeStat>, fuelSettings: FuelSettings, heatConsumptionMultiplier: number): number {
  let total = 0;
  for (const stat of Object.values(recipeStats)) {
    const heatPerSec = heatPerMachinePerSecond(stat.machineId, fuelSettings);
    if (heatPerSec > 0 && stat.actualMachines > 0) {
      total += heatPerSec * stat.actualMachines * 60 * heatConsumptionMultiplier;
    }
  }
  return total;
}

function attachCalculationDebugTotals(result: CalculationResult, fuelIterations: number, calculationStartedAtMs: number): CalculationResult {
  return {
    ...result,
    totals: {
      ...result.totals,
      fuelIterations,
      calculationMs: Math.max(0, calculationNowMs() - calculationStartedAtMs),
    },
  };
}

export function calculate(input: CalculateInput): CalculationResult {
  const calculationStartedAtMs = calculationNowMs();
  const fuelSettings = normalizeFuelSettings(input.settings);
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const heatConsumptionMultiplier = getHeatConsumptionMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const sellPriceMultiplier = getSellPriceMultiplier(input.abilities, 'shop');
  const fuelHeatValueMultiplier = getFuelHeatValueMultiplier(input.abilities);
  const reuseByproducts = input.settings.defaultSurplusPolicy === 'reuse';
  const EPS = 1e-7;
  const MAX_QUEUE_STEPS = 200000;
  const MAX_BYPRODUCT_ITERATIONS = 24;

  type Demand = {
    itemId: string;
    rate: number;
    isFinal: boolean;
    forcedRecipeId?: string;
    targetId?: string;
    consumerRecipeId?: string;
  };

  type CreditLot = {
    recipeId: string;
    itemId: string;
    rate: number;
    byproduct: boolean;
  };

  type BuildOutput = {
    result: CalculationResult;
    generatedCredits: CreditLot[];
    queueSteps: number;
    queueMax: number;
  };

  function cloneCredits(credits: CreditLot[]): CreditLot[] {
    return credits
      .filter((lot) => lot.rate > EPS)
      .map((lot) => ({ ...lot }));
  }

  function creditSignature(credits: CreditLot[]): string {
    const sums = new Map<string, number>();
    for (const lot of credits) {
      if (lot.rate <= EPS) continue;
      const key = lot.recipeId + '|' + lot.itemId + '|' + (lot.byproduct ? 'b' : 'p');
      sums.set(key, (sums.get(key) ?? 0) + lot.rate);
    }
    return [...sums.entries()]
      .map(([key, value]) => key + ':' + Math.round(value * 1000000) / 1000000)
      .sort()
      .join(';');
  }

  function addCredit(credits: CreditLot[], recipeId: string, itemId: string, rate: number, byproduct: boolean): void {
    if (rate <= EPS) return;
    const existing = credits.find((lot) => lot.recipeId === recipeId && lot.itemId === itemId && lot.byproduct === byproduct);
    if (existing) existing.rate += rate;
    else credits.push({ recipeId, itemId, rate, byproduct });
  }

  function byproductPolicy(recipeId: string, itemId: string): string {
    return input.surplusPolicies[recipeId + ':' + itemId] ?? input.settings.defaultSurplusPolicy;
  }

  function calculateOnce(injectedFuelRate: number): CalculationResult {
    let seedCredits: CreditLot[] = [];
    let built: BuildOutput | undefined;
    let iterations = 0;

    for (let i = 0; i < MAX_BYPRODUCT_ITERATIONS; i += 1) {
      iterations = i + 1;
      built = buildPlan(injectedFuelRate, seedCredits);
      if (!reuseByproducts) break;
      const generatedSignature = creditSignature(built.generatedCredits);
      const seedSignature = creditSignature(seedCredits);
      if (generatedSignature === seedSignature) break;
      seedCredits = cloneCredits(built.generatedCredits);
    }

    if (!built) built = buildPlan(injectedFuelRate, seedCredits);
    (built.result.totals as Record<string, unknown>).byproductIterations = iterations;
    (built.result.totals as Record<string, unknown>).queueSteps = built.queueSteps;
    (built.result.totals as Record<string, unknown>).queueMax = built.queueMax;
    return built.result;
  }

  function buildPlan(injectedFuelRate: number, seedCredits: CreditLot[]): BuildOutput {
    const itemStats: Record<string, ItemStat> = {};
    const recipeStats: Record<string, RecipeStat> = {};
    const conveyorEdgesByKey: Record<string, ConveyorEdgeStat> = {};
    const outputEdgesByKey: Record<string, OutputEdgeStat> = {};
    const warnings: PlanWarning[] = [];
    const generatedCredits: CreditLot[] = [];
    const creditLotsByItemId: Record<string, CreditLot[]> = {};
    const queue: Demand[] = [];
    let queueSteps = 0;
    let queueMax = 0;

    for (const lot of cloneCredits(seedCredits)) {
      creditLotsByItemId[lot.itemId] ??= [];
      creditLotsByItemId[lot.itemId].push(lot);
    }

    function stat(itemId: string): ItemStat {
      itemStats[itemId] ??= createItemStat(itemId);
      return itemStats[itemId];
    }

    function addConveyorEdge(itemId: string, recipeId: string, rate: number, fromRecipeId?: string): void {
      if (rate <= EPS) return;
      const sourceKey = fromRecipeId ? 'recipe:' + fromRecipeId : 'item:' + itemId;
      const id = sourceKey + '->' + itemId + '->' + recipeId;
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
        fromRecipeId,
        sourceKind: fromRecipeId ? 'recipe' : 'item',
        rate,
        belts: safeCeil(rate / conveyorItemsPerMinute),
      } as ConveyorEdgeStat;
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

    function recipeStat(recipe: Recipe): RecipeStat {
      recipeStats[recipe.id] ??= {
        recipeId: recipe.id,
        machineId: recipe.machineId,
        theoreticalMachines: 0,
        actualMachines: 0,
        runsPerMinute: 0,
        inputRates: {},
        outputRates: {},
        surplusOutputRates: {},
        discardedOutputRates: {},
        targetIds: [],
      };
      return recipeStats[recipe.id];
    }

    function purchaseItem(itemId: string, rate: number): void {
      if (rate <= EPS) return;
      const s = stat(itemId);
      s.purchased += rate;
      const buyPrice = economyByItemId[itemId]?.buyPriceCopper;
      if (buyPrice !== undefined) {
        s.purchaseCostCopperPerMin += rate * buyPrice;
        return;
      }
      warnings.push({
        messageJa: itemId + ' は購入扱いですが購入価格が未定義です。',
        messageEn: itemId + ' is purchased, but buy price is not defined.',
      });
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
        return;
      }
      warnings.push({
        messageJa: itemId + ' は初期投入扱いですが購入価格が未定義です。',
        messageEn: itemId + ' is a setup input, but buy price is not defined.',
      });
    }

    function enqueue(demand: Demand): void {
      if (demand.rate <= EPS) return;
      queue.push(demand);
      if (queue.length > queueMax) queueMax = queue.length;
    }

    function consumeCredits(itemId: string, rate: number, consumerRecipeId?: string): number {
      if (!reuseByproducts || rate <= EPS) return 0;
      const lots = creditLotsByItemId[itemId];
      if (!lots?.length) return 0;
      let remaining = rate;
      let consumed = 0;
      for (const lot of lots) {
        if (remaining <= EPS) break;
        if (lot.rate <= EPS) continue;
        const take = Math.min(lot.rate, remaining);
        lot.rate -= take;
        remaining -= take;
        consumed += take;
        if (consumerRecipeId) addConveyorEdge(itemId, consumerRecipeId, take, lot.recipeId);
      }
      creditLotsByItemId[itemId] = lots.filter((lot) => lot.rate > EPS);
      if (consumed > EPS) stat(itemId).reused += consumed;
      return consumed;
    }

    function fulfillDemand(demand: Demand): void {
      const originalRate = demand.rate;
      const s = stat(demand.itemId);
      s.requested += originalRate;
      let remaining = originalRate;

      const reused = consumeCredits(demand.itemId, remaining, demand.consumerRecipeId);
      remaining -= reused;
      if (remaining <= EPS) return;

      const sourceMode = input.itemSourceModes[demand.itemId] ?? 'auto';
      if (sourceMode === 'buy' || sourceMode === 'stock') {
        if (demand.consumerRecipeId) addConveyorEdge(demand.itemId, demand.consumerRecipeId, remaining);
        if (sourceMode === 'buy') purchaseItem(demand.itemId, remaining);
        return;
      }

      const recipe = demand.forcedRecipeId ? recipeById[demand.forcedRecipeId] : chooseRecipeForItem(demand.itemId, input.recipePreferences);
      if (!recipe) {
        if (demand.consumerRecipeId) addConveyorEdge(demand.itemId, demand.consumerRecipeId, remaining);
        purchaseItem(demand.itemId, remaining);
        return;
      }

      const outputRatePerMachine = getOutputRatePerMachine(recipe, demand.itemId, productionSpeedMultiplier);
      if (outputRatePerMachine <= EPS) {
        warnings.push({
          messageJa: recipe.id + ' は ' + demand.itemId + ' を出力しません。',
          messageEn: recipe.id + ' does not output ' + demand.itemId + '.',
        });
        if (demand.consumerRecipeId) addConveyorEdge(demand.itemId, demand.consumerRecipeId, remaining);
        purchaseItem(demand.itemId, remaining);
        return;
      }

      const theoreticalMachines = remaining / outputRatePerMachine;
      const actualMachines = shouldRound(input.settings.machineRounding, demand.isFinal) ? safeCeil(theoreticalMachines) : theoreticalMachines;
      const runsPerMinute = actualMachines * (60 / recipe.timeSec) * productionSpeedMultiplier;
      const rs = recipeStat(recipe);
      rs.theoreticalMachines += theoreticalMachines;
      rs.actualMachines += actualMachines;
      rs.runsPerMinute += runsPerMinute;
      if (demand.targetId && !rs.targetIds.includes(demand.targetId)) rs.targetIds.push(demand.targetId);

      if (demand.consumerRecipeId) addConveyorEdge(demand.itemId, demand.consumerRecipeId, remaining, recipe.id);

      for (const recipeInput of recipe.inputs) {
        if (isNurserySeedInput(recipe, recipeInput.itemId)) {
          addInitialPurchase(recipeInput.itemId, recipeInput.amount * actualMachines);
          continue;
        }
        const inputRate = recipeInput.amount * runsPerMinute;
        addToRecord(rs.inputRates, recipeInput.itemId, inputRate);
        stat(recipeInput.itemId).consumed += inputRate;
        enqueue({ itemId: recipeInput.itemId, rate: inputRate, isFinal: false, consumerRecipeId: recipe.id });
      }

      for (const output of recipe.outputs) {
        const outputRate = output.amount * (output.probability ?? 1) * runsPerMinute;
        const byproduct = output.itemId !== demand.itemId;
        addToRecord(rs.outputRates, output.itemId, outputRate);
        addOutputEdge(recipe.id, output.itemId, outputRate, byproduct, false);
        stat(output.itemId).produced += outputRate;

        if (output.itemId === demand.itemId) {
          const surplus = Math.max(0, outputRate - remaining);
          if (surplus > EPS) {
            addToRecord(rs.surplusOutputRates, output.itemId, surplus);
            if (!demand.isFinal && reuseByproducts) addCredit(generatedCredits, recipe.id, output.itemId, surplus, false);
            else stat(output.itemId).surplus += surplus;
          }
          continue;
        }

        const policy = byproductPolicy(recipe.id, output.itemId);
        if (policy === 'reuse') {
          addToRecord(rs.surplusOutputRates, output.itemId, outputRate);
          addCredit(generatedCredits, recipe.id, output.itemId, outputRate, true);
        } else {
          stat(output.itemId).discarded += outputRate;
          addToRecord(rs.discardedOutputRates, output.itemId, outputRate);
          addOutputEdge(recipe.id, output.itemId, outputRate, true, true);
        }
      }
    }

    for (const target of input.targets) {
      const outputItemId = target.outputItemId;
      if (!outputItemId) continue;
      const recipe = chooseRecipeForItem(outputItemId, input.recipePreferences);
      let targetRate = Math.max(0, target.value);
      let forcedRecipeId: string | undefined;
      if (recipe) {
        const outputRatePerMachine = getOutputRatePerMachine(recipe, outputItemId, productionSpeedMultiplier);
        if (target.mode === 'machines') {
          targetRate = Math.max(0, target.value) * outputRatePerMachine;
          forcedRecipeId = recipe.id;
        } else {
          forcedRecipeId = recipe.id;
        }
      }
      const s = stat(outputItemId);
      s.targetRequested += targetRate;
      enqueue({ itemId: outputItemId, rate: targetRate, isFinal: true, forcedRecipeId, targetId: target.id });
    }

    if (fuelSettings.enabled && injectedFuelRate > EPS) {
      if (fuelSettings.fuelSourceMode === 'buy') {
        purchaseItem(fuelSettings.fuelItemId, injectedFuelRate);
      } else {
        enqueue({ itemId: fuelSettings.fuelItemId, rate: injectedFuelRate, isFinal: false, targetId: 'fuel' });
      }
    }

    while (queue.length > 0) {
      queueSteps += 1;
      if (queueSteps > MAX_QUEUE_STEPS) {
        warnings.push({
          messageJa: '計算ステップ数が上限を超えたため、途中で停止しました。レシピ循環の可能性があります。',
          messageEn: 'Calculation stopped because the step limit was exceeded. There may be a recipe cycle.',
        });
        break;
      }
      const demand = queue.shift();
      if (demand) fulfillDemand(demand);
    }

    for (const lots of Object.values(creditLotsByItemId)) {
      for (const lot of lots) {
        if (lot.rate <= EPS) continue;
        const os = stat(lot.itemId);
        os.surplus += lot.rate;
        const rs = recipeStats[lot.recipeId];
        if (lot.byproduct) {
          os.discarded += lot.rate;
          if (rs) addToRecord(rs.discardedOutputRates, lot.itemId, lot.rate);
          addOutputEdge(lot.recipeId, lot.itemId, lot.rate, true, true);
        }
      }
    }

    const finalItemIds = new Set(input.targets.map((target) => target.outputItemId).filter(Boolean));
    for (const itemId of finalItemIds) {
      const s = stat(itemId as string);
      s.targetActual = Math.max(s.targetActual, s.produced, s.targetRequested);
      const sellPrice = economyByItemId[itemId as string]?.sellPriceCopper;
      if (sellPrice !== undefined) {
        s.revenueCopperPerMin = s.targetActual * sellPrice * sellPriceMultiplier;
      }
    }

    const heatRequiredPerMin = fuelSettings.enabled ? sumHeatRequiredPerMin(recipeStats, fuelSettings, heatConsumptionMultiplier) : 0;
    const fuelHeatValue = FUEL_HEAT_VALUE_BY_ITEM_ID[fuelSettings.fuelItemId] ?? 0;
    const effectiveFuelHeatValue = fuelHeatValue * fuelHeatValueMultiplier;
    const fuelRequiredPerMin = fuelSettings.enabled && effectiveFuelHeatValue > 0 ? heatRequiredPerMin / effectiveFuelHeatValue : 0;
    if (fuelSettings.enabled && fuelHeatValue <= 0) {
      warnings.push({
        messageJa: fuelSettings.fuelItemId + ' の燃料熱量が未定義です。',
        messageEn: 'Fuel heat value is not defined for ' + fuelSettings.fuelItemId + '.',
      });
    }

    let initialCostCopper = 0;
    let runningCostCopperPerMin = 0;
    let revenueCopperPerMin = 0;
    for (const s of Object.values(itemStats)) {
      initialCostCopper += s.initialCostCopper;
      runningCostCopperPerMin += s.purchaseCostCopperPerMin;
      revenueCopperPerMin += s.revenueCopperPerMin;
    }

    const result = {
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
        heatRequiredPerMin,
        fuelRequiredPerMin,
        fuelItemId: fuelSettings.fuelItemId,
      },
    } as CalculationResult;

    return { result, generatedCredits, queueSteps, queueMax };
  }

  if (!fuelSettings.enabled) {
    return attachCalculationDebugTotals(calculateOnce(0), 0, calculationStartedAtMs);
  }

  let injectedFuelRate = 0;
  let result = calculateOnce(0);
  let fuelIterations = 0;
  for (let i = 0; i < fuelSettings.maxIterations; i += 1) {
    fuelIterations = i + 1;
    const nextFuelRate = result.totals.fuelRequiredPerMin;
    result = calculateOnce(nextFuelRate);
    if (Math.abs(nextFuelRate - injectedFuelRate) < 0.0001) break;
    injectedFuelRate = nextFuelRate;
  }
  return attachCalculationDebugTotals(result, fuelIterations, calculationStartedAtMs);
}

export function getByproductKeys(): Array<{ key: string; recipeId: string; itemId: string }> {
  return RECIPES.flatMap((recipe) =>
    recipe.outputs
      .filter((output) => output.itemId !== recipe.primaryOutputId)
      .map((output) => ({ key: recipe.id + ':' + output.itemId, recipeId: recipe.id, itemId: output.itemId })),
  );
}
