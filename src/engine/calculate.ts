import type {
  AbilitySettings,
  AppSettings,
  FuelSettings,
  ItemSourceMode,
  MachineRoundingMode,
  ProductionTarget,
  Recipe,
  SurplusPolicy,
} from '../types';
import { RECIPES, recipeById, DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing } from '../data/recipes';
import { economyByItemId } from '../data/economy';
import {
  getConveyorItemsPerMinute,
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
    heatRequiredPerMin: number;
    fuelRequiredPerMin: number;
    fuelItemId: string;
    fuelIterations?: number;
    calculationMs?: number;
  };
};

export type CalculateInput = {
  targets: ProductionTarget[];
  settings: AppSettings;
  abilities: AbilitySettings;
  recipePreferences: Record<string, string>;
  surplusPolicies: Record<string, SurplusPolicy>;
  itemSourceModes: Record<string, ItemSourceMode>;
};

type SurplusLot = {
  recipeId: string;
  itemId: string;
  rate: number;
  byproduct: boolean;
};

const DEFAULT_FUEL_SETTINGS: FuelSettings = {
  enabled: true,
  fuelItemId: 'charcoal_powder',
  fuelSourceMode: 'craft',
  crucibleVariant: 'crucible',
  crucibleOverheadHeatPerSec: 0.4,
  otherOverheadHeatPerSec: 1,
  maxIterations: 8,
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
  record[key] = (record[key] ?? 0) + value;
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

  const overhead =
    config.overheadKind === 'crucible'
      ? fuelSettings.crucibleOverheadHeatPerSec
      : fuelSettings.otherOverheadHeatPerSec;

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

function calculationNowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

function attachCalculationDebugTotals(
  result: CalculationResult,
  fuelIterations: number,
  startedAtMs: number,
): CalculationResult {
  result.totals.fuelIterations = fuelIterations;
  result.totals.calculationMs = Math.max(0, calculationNowMs() - startedAtMs);
  return result;
}

export function calculate(input: CalculateInput): CalculationResult {
  const calculationStartedAtMs = calculationNowMs();
const fuelSettings = normalizeFuelSettings(input.settings);
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const heatConsumptionMultiplier = getHeatConsumptionMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const sellPriceMultiplier = getSellPriceMultiplier(input.abilities, 'shop');
  const fuelHeatValueMultiplier = getFuelHeatValueMultiplier(input.abilities);

  function calculateOnce(injectedFuelRate: number): CalculationResult {
    const itemStats: Record<string, ItemStat> = {};
    const recipeStats: Record<string, RecipeStat> = {};
    const conveyorEdgesByKey: Record<string, ConveyorEdgeStat> = {};
    const outputEdgesByKey: Record<string, OutputEdgeStat> = {};
    const warnings: PlanWarning[] = [];
    const surplusLotsByItemId: Record<string, SurplusLot[]> = {};
    const visiting = new Set<string>();

    function stat(itemId: string): ItemStat {
      itemStats[itemId] ??= createItemStat(itemId);
      return itemStats[itemId];
    }

    function addSurplusLot(recipeId: string, itemId: string, rate: number, byproduct: boolean): void {
      if (rate <= 1e-9) return;
      surplusLotsByItemId[itemId] ??= [];
      surplusLotsByItemId[itemId].push({ recipeId, itemId, rate, byproduct });
    }

    function consumeSurplus(itemId: string, rate: number): number {
      if (rate <= 0) return 0;

      const lots = surplusLotsByItemId[itemId];
      if (!lots?.length) return 0;

      let remaining = rate;
      let consumed = 0;

      for (const lot of lots) {
        if (remaining <= 1e-9) break;
        if (lot.rate <= 1e-9) continue;

        const take = Math.min(lot.rate, remaining);
        lot.rate -= take;
        remaining -= take;
        consumed += take;
      }

      surplusLotsByItemId[itemId] = lots.filter((lot) => lot.rate > 1e-9);

      if (consumed > 0) {
        const s = stat(itemId);
        s.reused += consumed;
        s.surplus = Math.max(0, s.surplus - consumed);
      }

      return consumed;
    }

    function addConveyorEdge(itemId: string, recipeId: string, rate: number): void {
      if (rate <= 0) return;

      const id = `${itemId}->${recipeId}`;
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
      };
    }

    function addOutputEdge(
      recipeId: string,
      itemId: string,
      rate: number,
      byproduct: boolean,
      discarded: boolean,
    ): void {
      if (rate <= 0) return;

      const suffix = discarded ? ':discard' : '';
      const id = `${recipeId}->${itemId}${suffix}`;
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
      const s = stat(itemId);
      s.purchased += rate;

      const buyPrice = economyByItemId[itemId]?.buyPriceCopper;
      if (buyPrice !== undefined) {
        s.purchaseCostCopperPerMin += rate * buyPrice;
        return;
      }

      warnings.push({
        messageJa: `${itemId} は購入扱いですが購入価格が未定義です。`,
        messageEn: `${itemId} is purchased, but buy price is not defined.`,
      });
    }

    function addInitialPurchase(itemId: string, count: number): void {
      if (count <= 0) return;

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
        messageJa: `${itemId} は初期投入扱いですが購入価格が未定義です。`,
        messageEn: `${itemId} is a setup input, but buy price is not defined.`,
      });
    }

    function requestItem(
      itemId: string,
      rate: number,
      isFinal: boolean,
      forcedRecipeId?: string,
      targetId?: string,
    ): void {
      if (rate <= 0) return;

      const s = stat(itemId);
      s.requested += rate;

      const reusable = consumeSurplus(itemId, rate);
      if (reusable > 0) {
        rate -= reusable;
      }

      if (rate <= 1e-9) return;

      const sourceMode = input.itemSourceModes[itemId] ?? 'auto';
      if (sourceMode === 'buy' || sourceMode === 'stock') {
        if (sourceMode === 'buy') purchaseItem(itemId, rate);
        return;
      }

      const recipe = forcedRecipeId ? recipeById[forcedRecipeId] : chooseRecipeForItem(itemId, input.recipePreferences);
      if (!recipe) {
        purchaseItem(itemId, rate);
        return;
      }

      if (visiting.has(itemId)) {
        warnings.push({
          messageJa: `${itemId} のレシピが循環している可能性があるため購入扱いにしました。`,
          messageEn: `${itemId} may be in a recursive recipe loop, so it was treated as purchased.`,
        });
        purchaseItem(itemId, rate);
        return;
      }

      const outputRatePerMachine = getOutputRatePerMachine(recipe, itemId, productionSpeedMultiplier);
      if (outputRatePerMachine <= 0) {
        warnings.push({
          messageJa: `${recipe.id} は ${itemId} を出力しません。`,
          messageEn: `${recipe.id} does not output ${itemId}.`,
        });
        purchaseItem(itemId, rate);
        return;
      }

      visiting.add(itemId);

      const theoreticalMachines = rate / outputRatePerMachine;
      const actualMachines = shouldRound(input.settings.machineRounding, isFinal)
        ? safeCeil(theoreticalMachines)
        : theoreticalMachines;
      const runsPerMinute = actualMachines * (60 / recipe.timeSec) * productionSpeedMultiplier;

      const rs = recipeStat(recipe);
      rs.theoreticalMachines += theoreticalMachines;
      rs.actualMachines += actualMachines;
      rs.runsPerMinute += runsPerMinute;

      if (targetId && !rs.targetIds.includes(targetId)) rs.targetIds.push(targetId);

      for (const recipeInput of recipe.inputs) {
        if (isNurserySeedInput(recipe, recipeInput.itemId)) {
          addInitialPurchase(recipeInput.itemId, recipeInput.amount * actualMachines);
          continue;
        }

        const inputRate = recipeInput.amount * runsPerMinute;

        addToRecord(rs.inputRates, recipeInput.itemId, inputRate);
        stat(recipeInput.itemId).consumed += inputRate;
        addConveyorEdge(recipeInput.itemId, recipe.id, inputRate);
        requestItem(recipeInput.itemId, inputRate, false);
      }

      for (const output of recipe.outputs) {
        const outputRate = output.amount * (output.probability ?? 1) * runsPerMinute;
        const byproduct = output.itemId !== itemId;

        addToRecord(rs.outputRates, output.itemId, outputRate);
        addOutputEdge(recipe.id, output.itemId, outputRate, byproduct, false);

        const os = stat(output.itemId);
        os.produced += outputRate;

        if (output.itemId === itemId) {
          const surplus = Math.max(0, outputRate - rate);

          if (surplus > 1e-9) {
            os.surplus += surplus;
            addToRecord(rs.surplusOutputRates, output.itemId, surplus);

            if (!isFinal) {
              addSurplusLot(recipe.id, output.itemId, surplus, false);
            }
          }
        } else {
          const policy = input.settings.defaultSurplusPolicy;

          if (policy === 'reuse') {
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

      visiting.delete(itemId);
    }

    for (const target of input.targets) {
      const outputItemId = target.outputItemId;
      if (!outputItemId) continue;

      const recipe = chooseRecipeForItem(outputItemId, input.recipePreferences);
      if (!recipe) {
        stat(outputItemId).targetRequested += Math.max(0, target.value);
        requestItem(outputItemId, Math.max(0, target.value), true, undefined, target.id);
        continue;
      }

      const outputRatePerMachine = getOutputRatePerMachine(recipe, outputItemId, productionSpeedMultiplier);
      if (outputRatePerMachine <= 0) continue;

      if (target.mode === 'machines') {
        const actualMachines = Math.max(0, target.value);
        const targetRate = actualMachines * outputRatePerMachine;

        stat(outputItemId).targetRequested += targetRate;
        stat(outputItemId).targetActual += targetRate;
        requestItem(outputItemId, targetRate, true, recipe.id, target.id);
      } else {
        const requestedRate = Math.max(0, target.value);

        stat(outputItemId).targetRequested += requestedRate;
        requestItem(outputItemId, requestedRate, true, recipe.id, target.id);
      }
    }

    if (fuelSettings.enabled && injectedFuelRate > 1e-9) {
      if (fuelSettings.fuelSourceMode === 'buy') {
        purchaseItem(fuelSettings.fuelItemId, injectedFuelRate);
      } else {
        requestItem(fuelSettings.fuelItemId, injectedFuelRate, false, undefined, 'fuel');
      }
    }

    // 再利用設定でも、最終的に一切使われなかった副産物は破棄表示へ回す。
    for (const lots of Object.values(surplusLotsByItemId)) {
      for (const lot of lots) {
        if (!lot.byproduct || lot.rate <= 1e-9) continue;

        const os = stat(lot.itemId);
        os.discarded += lot.rate;

        const rs = recipeStats[lot.recipeId];
        if (rs) {
          addToRecord(rs.discardedOutputRates, lot.itemId, lot.rate);
        }

        addOutputEdge(lot.recipeId, lot.itemId, lot.rate, true, true);
      }
    }

    const finalItemIds = new Set(input.targets.map((target) => target.outputItemId).filter(Boolean));

    for (const itemId of finalItemIds) {
      const s = stat(itemId as string);
      s.targetActual = Math.max(s.targetActual, s.produced);

      const sellPrice = economyByItemId[itemId as string]?.sellPriceCopper;
      if (sellPrice !== undefined) {
        s.revenueCopperPerMin = s.targetActual * sellPrice * sellPriceMultiplier;
      }
    }

    const heatRequiredPerMin = fuelSettings.enabled
      ? calculateHeatRequiredPerMin(recipeStats, fuelSettings, heatConsumptionMultiplier)
      : 0;

    const fuelHeatValue = FUEL_HEAT_VALUE_BY_ITEM_ID[fuelSettings.fuelItemId] ?? 0;
    const effectiveFuelHeatValue = fuelHeatValue * fuelHeatValueMultiplier;
    const fuelRequiredPerMin =
      fuelSettings.enabled && effectiveFuelHeatValue > 0 ? heatRequiredPerMin / effectiveFuelHeatValue : 0;

    if (fuelSettings.enabled && fuelHeatValue <= 0) {
      warnings.push({
        messageJa: `${fuelSettings.fuelItemId} の燃料熱量が未定義です。`,
        messageEn: `Fuel heat value is not defined for ${fuelSettings.fuelItemId}.`,
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
    };
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

    if (Math.abs(nextFuelRate - injectedFuelRate) < 0.0001) {
      break;
    }

    injectedFuelRate = nextFuelRate;
  }

  return attachCalculationDebugTotals(result, fuelIterations, calculationStartedAtMs);
}

export function getByproductKeys(): Array<{ key: string; recipeId: string; itemId: string }> {
  return RECIPES.flatMap((recipe) =>
    recipe.outputs
      .filter((output) => output.itemId !== recipe.primaryOutputId)
      .map((output) => ({ key: `${recipe.id}:${output.itemId}`, recipeId: recipe.id, itemId: output.itemId })),
  );
}
