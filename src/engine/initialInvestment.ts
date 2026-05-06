import type { AppSettings, Recipe } from '../types';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing, recipeById } from '../data/recipes';
import { economyByItemId } from '../data/economy';
import { safeCeil } from '../utils/format';
import type { CalculateInput, CalculationResult, RecipeStat } from './calculate';

export type InitialInvestmentEndpoint =
  | { type: 'recipe'; recipeId: string }
  | { type: 'itemSource'; itemId: string; sourceMode: 'buy' | 'stock' }
  | { type: 'itemSink'; itemId: string; sinkMode: 'initial' };

export type InitialInvestmentFlow = {
  id: string;
  from: InitialInvestmentEndpoint;
  to: InitialInvestmentEndpoint;
  itemId: string;
  rate: number;
  belts: number;
  role: 'material';
};

export type InitialInvestmentGroup = {
  id: string;
  targetRecipeId: string;
  requiredItemIds: string[];
  flows: InitialInvestmentFlow[];
  recipeStats: Record<string, RecipeStat>;
  purchasedItemIds: string[];
};

export type InitialInvestmentData = {
  groups: InitialInvestmentGroup[];
  requiredByRecipe: Record<string, string[]>;
  purchasedItemIds: string[];
};

const EPS = 1e-9;
const MAX_DEPTH = 24;

function runRatePerMachine(recipe: Recipe, productionSpeedMultiplier: number): number {
  return (60 / recipe.timeSec) * productionSpeedMultiplier;
}

function outputPerRun(recipe: Recipe, itemId: string): number {
  const output = recipe.outputs.find((entry) => entry.itemId === itemId);
  if (!output) return 0;
  return output.amount * (output.probability ?? 1);
}

function outputRatePerMachine(recipe: Recipe, itemId: string, productionSpeedMultiplier: number): number {
  return outputPerRun(recipe, itemId) * runRatePerMachine(recipe, productionSpeedMultiplier);
}

function inputAmountPerRun(recipe: Recipe, itemId: string): number {
  return recipe.inputs.filter((entry) => entry.itemId === itemId).reduce((sum, entry) => sum + entry.amount, 0);
}

function isSelfSustainingForItem(recipe: Recipe, itemId: string): boolean {
  return inputAmountPerRun(recipe, itemId) > EPS && outputPerRun(recipe, itemId) + EPS >= inputAmountPerRun(recipe, itemId);
}

function chooseStartupRecipe(itemId: string, input: CalculateInput, blockedRecipeIds: Set<string>): Recipe | undefined {
  const candidates: Recipe[] = [];
  const preferred = input.recipePreferences[itemId];
  if (preferred && recipeById[preferred]) candidates.push(recipeById[preferred]);
  const defaultRecipeId = DEFAULT_RECIPE_BY_ITEM_ID[itemId];
  if (defaultRecipeId && recipeById[defaultRecipeId]) candidates.push(recipeById[defaultRecipeId]);
  candidates.push(...getRecipesProducing(itemId));

  const seen = new Set<string>();
  for (const recipe of candidates) {
    if (!recipe || seen.has(recipe.id)) continue;
    seen.add(recipe.id);
    if (blockedRecipeIds.has(recipe.id)) continue;
    if (isSelfSustainingForItem(recipe, itemId)) continue;
    if (outputRatePerMachine(recipe, itemId, 1) <= EPS) continue;
    return recipe;
  }
  return undefined;
}

function flowBelts(rate: number, conveyorItemsPerMinute: number): number {
  const capacity = Math.max(1, conveyorItemsPerMinute || 60);
  return Math.max(1, safeCeil(rate / capacity));
}

function addRecipeStat(group: InitialInvestmentGroup, recipe: Recipe, runsPerMinute: number, productionSpeedMultiplier: number): void {
  const machineRunRate = runRatePerMachine(recipe, productionSpeedMultiplier);
  const theoreticalMachines = machineRunRate > EPS ? runsPerMinute / machineRunRate : 0;
  const inputRates: Record<string, number> = {};
  const outputRates: Record<string, number> = {};
  for (const entry of recipe.inputs) inputRates[entry.itemId] = (inputRates[entry.itemId] ?? 0) + entry.amount * runsPerMinute;
  for (const entry of recipe.outputs) outputRates[entry.itemId] = (outputRates[entry.itemId] ?? 0) + entry.amount * (entry.probability ?? 1) * runsPerMinute;

  const existing = group.recipeStats[recipe.id];
  if (!existing) {
    group.recipeStats[recipe.id] = {
      recipeId: recipe.id,
      machineId: recipe.machineId,
      theoreticalMachines,
      actualMachines: theoreticalMachines,
      runsPerMinute,
      inputRates,
      outputRates,
      surplusOutputRates: {},
      discardedOutputRates: {},
      targetIds: [],
    };
    return;
  }

  existing.theoreticalMachines += theoreticalMachines;
  existing.actualMachines += theoreticalMachines;
  existing.runsPerMinute += runsPerMinute;
  for (const [itemId, rate] of Object.entries(inputRates)) existing.inputRates[itemId] = (existing.inputRates[itemId] ?? 0) + rate;
  for (const [itemId, rate] of Object.entries(outputRates)) existing.outputRates[itemId] = (existing.outputRates[itemId] ?? 0) + rate;
}

function addFlow(
  group: InitialInvestmentGroup,
  from: InitialInvestmentEndpoint,
  to: InitialInvestmentEndpoint,
  itemId: string,
  rate: number,
  conveyorItemsPerMinute: number,
): void {
  if (rate <= EPS) return;
  const id =
    'initial:' +
    group.id +
    ':' +
    endpointKey(from) +
    '->' +
    endpointKey(to) +
    ':' +
    itemId;
  group.flows.push({ id, from, to, itemId, rate, belts: flowBelts(rate, conveyorItemsPerMinute), role: 'material' });
}

function endpointKey(endpoint: InitialInvestmentEndpoint): string {
  if (endpoint.type === 'recipe') return 'recipe:' + endpoint.recipeId;
  if (endpoint.type === 'itemSource') return 'source:' + endpoint.sourceMode + ':' + endpoint.itemId;
  return 'sink:' + endpoint.sinkMode + ':' + endpoint.itemId;
}

function buildStartupSupply(
  itemId: string,
  demandRate: number,
  consumer: InitialInvestmentEndpoint,
  group: InitialInvestmentGroup,
  input: CalculateInput,
  productionSpeedMultiplier: number,
  conveyorItemsPerMinute: number,
  blockedRecipeIds: Set<string>,
  visitedKeys: Set<string>,
  depth: number,
): void {
  if (demandRate <= EPS) return;
  if (depth > MAX_DEPTH) {
    group.purchasedItemIds.push(itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: 'buy' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
    return;
  }

  const sourceMode = input.itemSourceModes[itemId] ?? 'auto';
  if (sourceMode === 'buy' || sourceMode === 'stock') {
    if (sourceMode === 'buy') group.purchasedItemIds.push(itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: sourceMode === 'stock' ? 'stock' : 'buy' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
    return;
  }

  const recipe = chooseStartupRecipe(itemId, input, blockedRecipeIds);
  if (!recipe) {
    group.purchasedItemIds.push(itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: 'buy' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
    return;
  }

  const key = recipe.id + ':' + itemId;
  if (visitedKeys.has(key)) {
    group.purchasedItemIds.push(itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: 'buy' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
    return;
  }

  const outputRate = outputRatePerMachine(recipe, itemId, productionSpeedMultiplier);
  if (outputRate <= EPS) {
    group.purchasedItemIds.push(itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: 'buy' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
    return;
  }

  const machineCount = Math.max(1, safeCeil(demandRate / outputRate));
  const runsPerMinute = machineCount * runRatePerMachine(recipe, productionSpeedMultiplier);
  addRecipeStat(group, recipe, runsPerMinute, productionSpeedMultiplier);
  addFlow(group, { type: 'recipe', recipeId: recipe.id }, consumer, itemId, outputPerRun(recipe, itemId) * runsPerMinute, conveyorItemsPerMinute);

  visitedKeys.add(key);
  for (const recipeInput of recipe.inputs) {
    buildStartupSupply(
      recipeInput.itemId,
      recipeInput.amount * runsPerMinute,
      { type: 'recipe', recipeId: recipe.id },
      group,
      input,
      productionSpeedMultiplier,
      conveyorItemsPerMinute,
      blockedRecipeIds,
      visitedKeys,
      depth + 1,
    );
  }
  visitedKeys.delete(key);
}

function ensureItemStat(result: CalculationResult, itemId: string) {
  const existing = result.itemStats[itemId];
  if (existing) return existing;
  const stat = {
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
  result.itemStats[itemId] = stat;
  return stat;
}

export function buildInitialInvestment(
  baseResult: CalculationResult,
  input: CalculateInput,
  productionSpeedMultiplier: number,
  conveyorItemsPerMinute: number,
): CalculationResult {
  const enabled = input.settings.showInitialInvestmentLines !== false;
  const empty: InitialInvestmentData = { groups: [], requiredByRecipe: {}, purchasedItemIds: [] };
  if (!enabled) return { ...baseResult, initialInvestment: empty };

  const result: CalculationResult = {
    ...baseResult,
    itemStats: { ...baseResult.itemStats },
    totals: { ...baseResult.totals },
  };

  const data: InitialInvestmentData = { groups: [], requiredByRecipe: {}, purchasedItemIds: [] };
  const purchasedItemIds = new Set<string>();

  for (const recipeStat of Object.values(baseResult.recipeStats)) {
    if ((recipeStat.runsPerMinute ?? 0) <= EPS) continue;
    const recipe = recipeById[recipeStat.recipeId];
    if (!recipe) continue;
    const requiredItemIds = [...new Set(recipe.inputs.map((entry) => entry.itemId))].filter((itemId) => isSelfSustainingForItem(recipe, itemId));
    if (requiredItemIds.length === 0) continue;

    data.requiredByRecipe[recipe.id] = requiredItemIds;
    const group: InitialInvestmentGroup = {
      id: 'startup-' + recipe.id,
      targetRecipeId: recipe.id,
      requiredItemIds,
      flows: [],
      recipeStats: {},
      purchasedItemIds: [],
    };
    const blocked = new Set<string>([recipe.id]);
    for (const itemId of requiredItemIds) {
      const startupRate = inputAmountPerRun(recipe, itemId) * runRatePerMachine(recipe, productionSpeedMultiplier);
      buildStartupSupply(
        itemId,
        startupRate,
        { type: 'itemSink', itemId, sinkMode: 'initial' },
        group,
        input,
        productionSpeedMultiplier,
        conveyorItemsPerMinute,
        blocked,
        new Set<string>(),
        0,
      );
    }

    group.purchasedItemIds = [...new Set(group.purchasedItemIds)];
    for (const itemId of group.purchasedItemIds) purchasedItemIds.add(itemId);
    if (group.flows.length > 0 || group.purchasedItemIds.length > 0) data.groups.push(group);
  }

  data.purchasedItemIds = [...purchasedItemIds];
  for (const itemId of data.purchasedItemIds) {
    const stat = ensureItemStat(result, itemId);
    const price = economyByItemId[itemId]?.buyPriceCopper ?? 0;
    stat.initialPurchased += 1;
    stat.initialCostCopper += price;
    result.totals.initialCostCopper += price;
  }

  result.initialInvestment = data;
  return result;
}
