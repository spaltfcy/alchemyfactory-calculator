import type {
  AbilitySettings,
  AppSettings,
  ItemSourceMode,
  MachineRoundingMode,
  ProductionTarget,
  Recipe,
  SurplusPolicy,
} from '../types';
import { RECIPES, recipeById, DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing } from '../data/recipes';
import { economyByItemId } from '../data/economy';
import { getConveyorItemsPerMinute, getProductionSpeedMultiplier, getSellPriceMultiplier } from '../data/abilityTables';
import { safeCeil } from '../utils/format';

export type ItemStat = {
  itemId: string;
  requested: number;
  consumed: number;
  produced: number;
  purchased: number;
  reused: number;
  surplus: number;
  discarded: number;
  targetRequested: number;
  targetActual: number;
  purchaseCostCopperPerMin: number;
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

export type PlanWarning = {
  messageJa: string;
  messageEn: string;
};

export type CalculationResult = {
  itemStats: Record<string, ItemStat>;
  recipeStats: Record<string, RecipeStat>;
  conveyorEdges: ConveyorEdgeStat[];
  outputEdges: OutputEdgeStat[];
  warnings: PlanWarning[];
  totals: {
    purchaseCostCopperPerMin: number;
    revenueCopperPerMin: number;
    profitCopperPerMin: number;
    conveyorItemsPerMinute: number;
    productionSpeedMultiplier: number;
    sellPriceMultiplier: number;
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

function createItemStat(itemId: string): ItemStat {
  return {
    itemId,
    requested: 0,
    consumed: 0,
    produced: 0,
    purchased: 0,
    reused: 0,
    surplus: 0,
    discarded: 0,
    targetRequested: 0,
    targetActual: 0,
    purchaseCostCopperPerMin: 0,
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

function getOutputRate(recipe: Recipe, itemId: string, runsPerMinute: number): number {
  const output = recipe.outputs.find((x) => x.itemId === itemId);
  if (!output) return 0;
  return output.amount * (output.probability ?? 1) * runsPerMinute;
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

function surplusPolicyKey(recipeId: string, itemId: string): string {
  return `${recipeId}:${itemId}`;
}

export function calculate(input: CalculateInput): CalculationResult {
  const itemStats: Record<string, ItemStat> = {};
  const recipeStats: Record<string, RecipeStat> = {};
  const conveyorEdgesByKey: Record<string, ConveyorEdgeStat> = {};
  const outputEdgesByKey: Record<string, OutputEdgeStat> = {};
  const warnings: PlanWarning[] = [];
  const availableSurplus: Record<string, number> = {};
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(input.abilities);
  const sellPriceMultiplier = getSellPriceMultiplier(input.abilities, input.settings.sellMode);
  const visiting = new Set<string>();

  function stat(itemId: string): ItemStat {
    itemStats[itemId] ??= createItemStat(itemId);
    return itemStats[itemId];
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

  function addOutputEdge(recipeId: string, itemId: string, rate: number, byproduct: boolean, discarded: boolean): void {
    if (rate <= 0) return;
    const suffix = discarded ? ':discard' : '';
    const id = `${recipeId}->${itemId}${suffix}`;
    const current = outputEdgesByKey[id];
    if (current) {
      current.rate += rate;
      return;
    }
    outputEdgesByKey[id] = {
      id,
      fromRecipeId: recipeId,
      toItemId: itemId,
      rate,
      byproduct,
      discarded,
    };
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
    if (buyPrice !== undefined) s.purchaseCostCopperPerMin += rate * buyPrice;
    else {
      warnings.push({
        messageJa: `${itemId} は購入扱いですが購入価格が未定義です。`,
        messageEn: `${itemId} is purchased, but buy price is not defined.`,
      });
    }
  }

  function requestItem(itemId: string, rate: number, isFinal: boolean, forcedRecipeId?: string, targetId?: string): void {
    if (rate <= 0) return;
    const s = stat(itemId);
    s.requested += rate;

    const reusable = Math.min(availableSurplus[itemId] ?? 0, rate);
    if (reusable > 0) {
      availableSurplus[itemId] -= reusable;
      s.reused += reusable;
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
    const actualMachines = shouldRound(input.settings.machineRounding, isFinal) ? safeCeil(theoreticalMachines) : theoreticalMachines;
    const runsPerMinute = actualMachines * (60 / recipe.timeSec) * productionSpeedMultiplier;
    const rs = recipeStat(recipe);
    rs.theoreticalMachines += theoreticalMachines;
    rs.actualMachines += actualMachines;
    rs.runsPerMinute += runsPerMinute;
    if (targetId && !rs.targetIds.includes(targetId)) rs.targetIds.push(targetId);

    for (const recipeInput of recipe.inputs) {
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
          if (!isFinal) availableSurplus[output.itemId] = (availableSurplus[output.itemId] ?? 0) + surplus;
        }
      } else {
        const key = surplusPolicyKey(recipe.id, output.itemId);
        const policy = input.surplusPolicies[key] ?? input.settings.defaultSurplusPolicy;
        if (policy === 'reuse') {
          os.surplus += outputRate;
          availableSurplus[output.itemId] = (availableSurplus[output.itemId] ?? 0) + outputRate;
          addToRecord(rs.surplusOutputRates, output.itemId, outputRate);
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
    const recipe = recipeById[target.recipeId];
    if (!recipe) continue;
    const outputItemId = target.outputItemId || recipe.primaryOutputId;
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
      const actual = stat(outputItemId).produced;
      // 同じアイテムの複数ターゲットがある場合は「今回分」の算出が難しいため、後段で総量から再設定します。
      void actual;
    }
  }

  // 最終出力は itemId ごとに実生産量で合算します。
  const finalItemIds = new Set(input.targets.map((target) => target.outputItemId || recipeById[target.recipeId]?.primaryOutputId).filter(Boolean));
  for (const itemId of finalItemIds) {
    const s = stat(itemId as string);
    s.targetActual = Math.max(s.targetActual, s.produced);
    const sellPrice = economyByItemId[itemId as string]?.sellPriceCopper;
    if (sellPrice !== undefined) {
      s.revenueCopperPerMin = s.targetActual * sellPrice * sellPriceMultiplier;
    }
  }

  let purchaseCostCopperPerMin = 0;
  let revenueCopperPerMin = 0;
  for (const s of Object.values(itemStats)) {
    purchaseCostCopperPerMin += s.purchaseCostCopperPerMin;
    revenueCopperPerMin += s.revenueCopperPerMin;
  }

  return {
    itemStats,
    recipeStats,
    conveyorEdges: Object.values(conveyorEdgesByKey),
    outputEdges: Object.values(outputEdgesByKey),
    warnings,
    totals: {
      purchaseCostCopperPerMin,
      revenueCopperPerMin,
      profitCopperPerMin: revenueCopperPerMin - purchaseCostCopperPerMin,
      conveyorItemsPerMinute,
      productionSpeedMultiplier,
      sellPriceMultiplier,
    },
  };
}

export function getByproductKeys(): Array<{ key: string; recipeId: string; itemId: string }> {
  return RECIPES.flatMap((recipe) =>
    recipe.outputs
      .filter((output) => output.itemId !== recipe.primaryOutputId)
      .map((output) => ({ key: `${recipe.id}:${output.itemId}`, recipeId: recipe.id, itemId: output.itemId })),
  );
}
