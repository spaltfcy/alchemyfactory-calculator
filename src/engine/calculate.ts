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

export type ConveyorEdgeStat = { id: string; fromItemId: string; toRecipeId: string; rate: number; belts: number };
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
type WorkDemand = {
  itemId: string;
  rate: number;
  isFinal: boolean;
  forcedRecipeId?: string;
  targetId?: string;
  consumerRecipeId?: string;
  role: WorkRole;
};

type SurplusLot = {
  recipeId: string;
  itemId: string;
  rate: number;
  byproduct: boolean;
  projected?: boolean;
};

type BuildPlanResult = CalculationResult & {
  reusableByproductLots: SurplusLot[];
};

const EPS = 1e-9;
const MAX_QUEUE_STEPS = 200000;

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

function roundQuantity(rate: number, settings: AppSettings): number {
  const stepText = settings.quantityRoundingStep ?? 'none';
  if (stepText === 'none') return rate;
  const step = Number(stepText);
  if (!Number.isFinite(step) || step <= 0) return rate;
  return Math.ceil((rate - EPS) / step) * step;
}

function getOutputRatePerMachine(recipe: Recipe, itemId: string, productionSpeedMultiplier: number): number {
  const output = recipe.outputs.find((x) => x.itemId === itemId);
  if (!output) return 0;
  return output.amount * (output.probability ?? 1) * (60 / recipe.timeSec) * productionSpeedMultiplier;
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

function calculateHeatRequiredPerMin(
  recipeStats: Record<string, RecipeStat>,
  fuelSettings: FuelSettings,
  heatConsumptionMultiplier: number,
): number {
  let total = 0;
  for (const rs of Object.values(recipeStats)) {
    const heatPerSec = heatPerMachinePerSecond(rs.machineId, fuelSettings);
    if (heatPerSec <= 0) continue;
    total += rs.actualMachines * heatPerSec * 60 * heatConsumptionMultiplier;
  }
  return total;
}

function calculateFertilizerNutrientsRequiredPerMin(
  recipeStats: Record<string, RecipeStat>,
  fertilizerSettings: FertilizerSettings,
): number {
  if (!fertilizerSettings.enabled) return 0;
  let total = 0;
  for (const rs of Object.values(recipeStats)) {
    if (rs.machineId !== 'nursery') continue;
    total += rs.actualMachines * fertilizerSettings.nurseryNutrientsPerSec * 60;
  }
  return total;
}

function calculationNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

function signature(result: CalculationResult): string {
  const recipes = Object.values(result.recipeStats)
    .map((rs) => rs.recipeId + ':' + rs.runsPerMinute.toFixed(6))
    .sort()
    .join('|');
  const purchases = Object.values(result.itemStats)
    .filter((s) => s.purchased > EPS)
    .map((s) => s.itemId + ':' + s.purchased.toFixed(6))
    .sort()
    .join('|');
  return recipes + '//' + purchases;
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

  function buildPlan(injectedFuelRate: number, seedLots: SurplusLot[], byproductIteration: number): BuildPlanResult {
    const itemStats: Record<string, ItemStat> = {};
    const recipeStats: Record<string, RecipeStat> = {};
    const conveyorEdgesByKey: Record<string, ConveyorEdgeStat> = {};
    const outputEdgesByKey: Record<string, OutputEdgeStat> = {};
    const warnings: PlanWarning[] = [];
    const surplusLotsByItemId: Record<string, SurplusLot[]> = {};
    const reusableByproductLots: SurplusLot[] = [];
    let queueSteps = 0;
    let queueMax = 0;

    for (const lot of seedLots) {
      if (lot.rate <= EPS) continue;
      surplusLotsByItemId[lot.itemId] ??= [];
      surplusLotsByItemId[lot.itemId].push({ ...lot, projected: true });
    }

    function stat(itemId: string): ItemStat {
      itemStats[itemId] ??= createItemStat(itemId);
      return itemStats[itemId];
    }

    function addSurplusLot(recipeId: string, itemId: string, rate: number, byproduct: boolean): void {
      if (rate <= EPS) return;
      const lot: SurplusLot = { recipeId, itemId, rate, byproduct };
      surplusLotsByItemId[itemId] ??= [];
      surplusLotsByItemId[itemId].push(lot);
      if (byproduct) reusableByproductLots.push({ ...lot });
    }

    function consumeSurplus(itemId: string, rate: number): number {
      if (rate <= EPS || input.settings.defaultSurplusPolicy !== 'reuse') return 0;
      const lots = surplusLotsByItemId[itemId];
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
      }
      surplusLotsByItemId[itemId] = lots.filter((lot) => lot.rate > EPS);
      if (consumed > EPS) {
        const s = stat(itemId);
        s.reused += consumed;
        s.surplus = Math.max(0, s.surplus - consumed);
      }
      return consumed;
    }

    function addConveyorEdge(itemId: string, recipeId: string, rate: number): void {
      if (rate <= EPS) return;
      const id = itemId + '->' + recipeId;
      const current = conveyorEdgesByKey[id];
      if (current) {
        current.rate += rate;
        current.belts = safeCeil(current.rate / conveyorItemsPerMinute);
        return;
      }
      conveyorEdgesByKey[id] = { id, fromItemId: itemId, toRecipeId: recipeId, rate, belts: safeCeil(rate / conveyorItemsPerMinute) };
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
      const roundedRate = roundQuantity(rate, input.settings);
      const s = stat(itemId);
      s.purchased += roundedRate;
      const buyPrice = economyByItemId[itemId]?.buyPriceCopper;
      if (buyPrice !== undefined) {
        s.purchaseCostCopperPerMin += roundedRate * buyPrice;
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

    const queue: WorkDemand[] = [];
    let queueIndex = 0;

    function enqueue(demand: WorkDemand): void {
      if (demand.rate <= EPS) return;
      queue.push(demand);
      queueMax = Math.max(queueMax, queue.length - queueIndex);
    }

    function processQueue(): void {
      while (queueIndex < queue.length) {
        if (queueSteps > MAX_QUEUE_STEPS) {
          warnings.push({
            messageJa: '計算ステップ数が上限を超えたため、以降の未解決素材は購入扱いにしました。',
            messageEn: 'The calculation step limit was exceeded. Remaining unresolved materials were treated as purchased.',
          });
          for (; queueIndex < queue.length; queueIndex += 1) {
            const demand = queue[queueIndex];
            purchaseItem(demand.itemId, demand.rate);
          }
          break;
        }
        queueSteps += 1;
        const demand = queue[queueIndex++];
        let rate = demand.rate;
        const s = stat(demand.itemId);
        s.requested += rate;

        const reused = demand.role === 'material' || demand.role === 'target' ? consumeSurplus(demand.itemId, rate) : 0;
        if (reused > EPS) rate -= reused;
        if (rate <= EPS) continue;

        const itemSourceMode = input.itemSourceModes[demand.itemId] ?? 'auto';
        if (itemSourceMode === 'buy' || itemSourceMode === 'stock') {
          if (itemSourceMode === 'buy') purchaseItem(demand.itemId, rate);
          continue;
        }

        const recipe = demand.forcedRecipeId ? recipeById[demand.forcedRecipeId] : chooseRecipeForItem(demand.itemId, input.recipePreferences);
        if (!recipe) {
          purchaseItem(demand.itemId, rate);
          continue;
        }

        const outputRatePerMachine = getOutputRatePerMachine(recipe, demand.itemId, productionSpeedMultiplier);
        if (outputRatePerMachine <= EPS) {
          warnings.push({
            messageJa: recipe.id + ' は ' + demand.itemId + ' を出力しません。',
            messageEn: recipe.id + ' does not output ' + demand.itemId + '.',
          });
          purchaseItem(demand.itemId, rate);
          continue;
        }

        const theoreticalMachines = rate / outputRatePerMachine;
        const actualMachines = shouldRound(input.settings.machineRounding, demand.isFinal) ? safeCeil(theoreticalMachines) : theoreticalMachines;
        const runsPerMinute = actualMachines * (60 / recipe.timeSec) * productionSpeedMultiplier;
        const rs = recipeStat(recipe);
        rs.theoreticalMachines += theoreticalMachines;
        rs.actualMachines += actualMachines;
        rs.runsPerMinute += runsPerMinute;
        if (demand.targetId && !rs.targetIds.includes(demand.targetId)) rs.targetIds.push(demand.targetId);

        for (const recipeInput of recipe.inputs) {
          if (isNurserySeedInput(recipe, recipeInput.itemId)) {
            addInitialPurchase(recipeInput.itemId, recipeInput.amount * actualMachines);
            continue;
          }
          const inputRate = recipeInput.amount * runsPerMinute;
          addToRecord(rs.inputRates, recipeInput.itemId, inputRate);
          stat(recipeInput.itemId).consumed += inputRate;
          addConveyorEdge(recipeInput.itemId, recipe.id, inputRate);
          enqueue({ itemId: recipeInput.itemId, rate: inputRate, isFinal: false, consumerRecipeId: recipe.id, role: 'material' });
        }

        for (const output of recipe.outputs) {
          const outputRate = output.amount * (output.probability ?? 1) * runsPerMinute;
          const byproduct = output.itemId !== demand.itemId;
          addToRecord(rs.outputRates, output.itemId, outputRate);
          addOutputEdge(recipe.id, output.itemId, outputRate, byproduct, false);
          const os = stat(output.itemId);
          os.produced += outputRate;
          if (output.itemId === demand.itemId) {
            const surplus = Math.max(0, outputRate - rate);
            if (surplus > EPS) {
              os.surplus += surplus;
              addToRecord(rs.surplusOutputRates, output.itemId, surplus);
              if (!demand.isFinal) addSurplusLot(recipe.id, output.itemId, surplus, false);
            }
          } else if (input.settings.defaultSurplusPolicy === 'reuse') {
            os.surplus += outputRate;
            addToRecord(rs.surplusOutputRates, output.itemId, outputRate);
            addSurplusLot(recipe.id, output.itemId, outputRate, true);
          } else {
            os.discarded += outputRate;
            addToRecord(rs.discardedOutputRates, output.itemId, outputRate);
            addOutputEdge(recipe.id, output.itemId, outputRate, true, true);
          }
        }
      }
    }

    for (const target of input.targets) {
      const outputItemId = target.outputItemId;
      if (!outputItemId) continue;
      const recipe = chooseRecipeForItem(outputItemId, input.recipePreferences);
      if (!recipe) {
        const requested = Math.max(0, target.value);
        stat(outputItemId).targetRequested += requested;
        enqueue({ itemId: outputItemId, rate: requested, isFinal: true, targetId: target.id, role: 'target' });
        continue;
      }
      const outputRatePerMachine = getOutputRatePerMachine(recipe, outputItemId, productionSpeedMultiplier);
      if (outputRatePerMachine <= EPS) continue;
      if (target.mode === 'machines') {
        const actualMachines = Math.max(0, target.value);
        const targetRate = actualMachines * outputRatePerMachine;
        stat(outputItemId).targetRequested += targetRate;
        stat(outputItemId).targetActual += targetRate;
        enqueue({ itemId: outputItemId, rate: targetRate, isFinal: true, forcedRecipeId: recipe.id, targetId: target.id, role: 'target' });
      } else {
        const requestedRate = Math.max(0, target.value);
        stat(outputItemId).targetRequested += requestedRate;
        enqueue({ itemId: outputItemId, rate: requestedRate, isFinal: true, forcedRecipeId: recipe.id, targetId: target.id, role: 'target' });
      }
    }

    if (fuelSettings.enabled && injectedFuelRate > EPS) {
      if (fuelSettings.fuelSourceMode === 'buy') purchaseItem(fuelSettings.fuelItemId, injectedFuelRate);
      else enqueue({ itemId: fuelSettings.fuelItemId, rate: injectedFuelRate, isFinal: false, targetId: 'fuel', role: 'fuel' });
    }

    processQueue();

    let fertilizerNutrientsRequiredPerMin = calculateFertilizerNutrientsRequiredPerMin(recipeStats, fertilizerSettings);
    let fertilizerRequiredPerMin = 0;
    if (fertilizerSettings.enabled && fertilizerNutrientsRequiredPerMin > EPS) {
      const nutrientValue = FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerSettings.fertilizerItemId] ?? 0;
      const effectiveNutrientValue = nutrientValue * fertilizerNutritionMultiplier;
      if (effectiveNutrientValue > EPS) {
        fertilizerRequiredPerMin = fertilizerNutrientsRequiredPerMin / effectiveNutrientValue;
        if (fertilizerSettings.fertilizerSourceMode === 'buy') purchaseItem(fertilizerSettings.fertilizerItemId, fertilizerRequiredPerMin);
        else enqueue({ itemId: fertilizerSettings.fertilizerItemId, rate: fertilizerRequiredPerMin, isFinal: false, targetId: 'fertilizer', role: 'fertilizer' });
        processQueue();
        fertilizerNutrientsRequiredPerMin = calculateFertilizerNutrientsRequiredPerMin(recipeStats, fertilizerSettings);
      } else {
        warnings.push({
          messageJa: fertilizerSettings.fertilizerItemId + ' の肥料栄養値が未定義です。',
          messageEn: 'Fertilizer nutrient value is not defined for ' + fertilizerSettings.fertilizerItemId + '.',
        });
      }
    }

    for (const lots of Object.values(surplusLotsByItemId)) {
      for (const lot of lots) {
        if (!lot.byproduct || lot.projected || lot.rate <= EPS) continue;
        const os = stat(lot.itemId);
        os.discarded += lot.rate;
        const rs = recipeStats[lot.recipeId];
        if (rs) addToRecord(rs.discardedOutputRates, lot.itemId, lot.rate);
        addOutputEdge(lot.recipeId, lot.itemId, lot.rate, true, true);
      }
    }

    const finalItemIds = new Set(input.targets.map((target) => target.outputItemId).filter(Boolean));
    for (const itemId of finalItemIds) {
      const s = stat(itemId as string);
      s.targetActual = Math.max(s.targetActual, s.produced, s.targetRequested);
      const sellPrice = economyByItemId[itemId as string]?.sellPriceCopper;
      if (sellPrice !== undefined) s.revenueCopperPerMin = s.targetActual * sellPrice * sellPriceMultiplier;
    }

    const heatRequiredPerMin = fuelSettings.enabled ? calculateHeatRequiredPerMin(recipeStats, fuelSettings, heatConsumptionMultiplier) : 0;
    const fuelHeatValue = FUEL_HEAT_VALUE_BY_ITEM_ID[fuelSettings.fuelItemId] ?? 0;
    const effectiveFuelHeatValue = fuelHeatValue * fuelHeatValueMultiplier;
    const fuelRequiredPerMin = fuelSettings.enabled && effectiveFuelHeatValue > EPS ? heatRequiredPerMin / effectiveFuelHeatValue : 0;
    if (fuelSettings.enabled && fuelHeatValue <= EPS) {
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

    return {
      itemStats,
      recipeStats,
      conveyorEdges: Object.values(conveyorEdgesByKey),
      outputEdges: Object.values(outputEdgesByKey),
      warnings,
      reusableByproductLots,
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
        heatRequiredPerMin,
        fuelRequiredPerMin,
        fuelItemId: fuelSettings.fuelItemId,
        fertilizerNutrientsRequiredPerMin,
        fertilizerRequiredPerMin,
        fertilizerItemId: fertilizerSettings.fertilizerItemId,
        byproductIterations: byproductIteration,
        queueSteps,
        queueMax,
      },
    };
  }

  function calculateOnce(injectedFuelRate: number): BuildPlanResult {
    let result = buildPlan(injectedFuelRate, [], 0);
    if (input.settings.defaultSurplusPolicy !== 'reuse') return result;

    let previousSignature = signature(result);
    let seedLots = result.reusableByproductLots;
    const maxByproductIterations = Math.max(1, Math.min(8, fertilizerSettings.maxIterations || 4));
    for (let i = 1; i <= maxByproductIterations; i += 1) {
      const next = buildPlan(injectedFuelRate, seedLots, i);
      const nextSignature = signature(next);
      result = next;
      if (nextSignature === previousSignature) break;
      previousSignature = nextSignature;
      seedLots = next.reusableByproductLots;
    }
    return result;
  }

  let result: BuildPlanResult;
  let fuelIterations = 0;
  if (!fuelSettings.enabled) {
    result = calculateOnce(0);
  } else {
    let injectedFuelRate = 0;
    result = calculateOnce(0);
    for (let i = 0; i < fuelSettings.maxIterations; i += 1) {
      fuelIterations = i + 1;
      const nextFuelRate = result.totals.fuelRequiredPerMin;
      result = calculateOnce(nextFuelRate);
      if (Math.abs(nextFuelRate - injectedFuelRate) < 0.0001) break;
      injectedFuelRate = nextFuelRate;
    }
  }

  const finalResult: CalculationResult = {
    itemStats: result.itemStats,
    recipeStats: result.recipeStats,
    conveyorEdges: result.conveyorEdges,
    outputEdges: result.outputEdges,
    warnings: result.warnings,
    totals: {
      ...result.totals,
      fuelIterations,
      calculationMs: Math.max(0, calculationNowMs() - calculationStartedAtMs),
    },
  };
  return finalResult;
}

export function getByproductKeys(): Array<{ key: string; recipeId: string; itemId: string }> {
  return RECIPES.flatMap((recipe) =>
    recipe.outputs
      .filter((output) => output.itemId !== recipe.primaryOutputId)
      .map((output) => ({ key: recipe.id + ':' + output.itemId, recipeId: recipe.id, itemId: output.itemId })),
  );
}
