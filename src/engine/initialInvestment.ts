import type { AppSettings, Recipe } from '../types';
import { recipeById } from '../data/recipes';
import { itemById } from '../data/items';
import { resolveItemSource } from './itemSourceResolver';
import { safeCeil } from '../utils/format';
import type {
  CalculateInput,
  CalculationResult,
  RecipeStat,
  InitialInvestmentEndpoint,
  InitialInvestmentFlow,
  InitialInvestmentTransportKind,
  InitialInvestmentGroup,
  InitialInvestmentData,
} from './calculationTypes';

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

function flowBelts(rate: number, conveyorItemsPerMinute: number): number {
  const capacity = Math.max(1, conveyorItemsPerMinute || 60);
  return Math.max(1, safeCeil(rate / capacity));
}

function transportKindForItem(itemId: string): InitialInvestmentTransportKind {
  const physicalState = itemById[itemId]?.physicalState;
  return physicalState === 'liquid' ? 'pipeline' : 'belt';
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
  const belts = flowBelts(rate, conveyorItemsPerMinute);
  const transportKind = transportKindForItem(itemId);
  group.flows.push({
    id,
    from,
    to,
    itemId,
    rate,
    belts,
    transportKind,
    transportUnits: transportKind === 'pipeline' ? 1 : belts,
    role: 'material',
  });
}

function endpointKey(endpoint: InitialInvestmentEndpoint): string {
  if (endpoint.type === 'recipe') return 'recipe:' + endpoint.recipeId;
  if (endpoint.type === 'itemSource') return 'source:' + endpoint.sourceMode + ':' + endpoint.itemId;
  return 'sink:' + endpoint.sinkMode + ':' + endpoint.itemId;
}

function addUnresolvedStartupItem(group: InitialInvestmentGroup, itemId: string): void {
  if (!group.unresolvedItemIds.includes(itemId)) group.unresolvedItemIds.push(itemId);
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
    addUnresolvedStartupItem(group, itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: 'unresolved' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
    return;
  }

  const resolved = resolveItemSource(itemId, {
    recipePreferences: input.recipePreferences,
    blockedRecipeIds,
    isRecipeAllowed: (candidate) => !isSelfSustainingForItem(candidate, itemId) && outputRatePerMachine(candidate, itemId, 1) > EPS,
  });

  if (resolved.kind === 'purchase') {
    group.purchasedItemIds.push(itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: 'buy' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
    return;
  }

  if (resolved.kind === 'unresolved') {
    addUnresolvedStartupItem(group, itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: 'unresolved' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
    return;
  }

  const recipe = resolved.recipe;

  const key = recipe.id + ':' + itemId;
  if (visitedKeys.has(key)) {
    addUnresolvedStartupItem(group, itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: 'unresolved' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
    return;
  }

  const outputRate = outputRatePerMachine(recipe, itemId, productionSpeedMultiplier);
  if (outputRate <= EPS) {
    addUnresolvedStartupItem(group, itemId);
    addFlow(group, { type: 'itemSource', itemId, sourceMode: 'unresolved' }, consumer, itemId, demandRate, conveyorItemsPerMinute);
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
  const empty: InitialInvestmentData = { groups: [], requiredByRecipe: {}, purchasedItemIds: [], unresolvedItemIds: [] };
  if (!enabled) return { ...baseResult, initialInvestment: empty };

  const result: CalculationResult = {
    ...baseResult,
    itemStats: { ...baseResult.itemStats },
    totals: { ...baseResult.totals },
  };

  const data: InitialInvestmentData = { groups: [], requiredByRecipe: {}, purchasedItemIds: [], unresolvedItemIds: [] };
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
      unresolvedItemIds: [],
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
    group.unresolvedItemIds = [...new Set(group.unresolvedItemIds)];
    for (const itemId of group.purchasedItemIds) purchasedItemIds.add(itemId);
    for (const itemId of group.unresolvedItemIds) {
      if (!data.unresolvedItemIds.includes(itemId)) data.unresolvedItemIds.push(itemId);
    }
    if (group.flows.length > 0 || group.purchasedItemIds.length > 0) data.groups.push(group);
  }

  data.purchasedItemIds = [...purchasedItemIds];
  for (const itemId of data.purchasedItemIds) {
    const stat = ensureItemStat(result, itemId);
    const price = itemById[itemId]?.buyPriceCopper ?? 0;
    stat.initialPurchased += 1;
    stat.initialCostCopper += price;
    result.totals.initialCostCopper += price;
  }

  result.initialInvestment = data;
  if (data.unresolvedItemIds.length > 0) {
    result.calculationStatus = 'invalid';
    result.errorSummaries = [
      ...(result.errorSummaries ?? []),
      {
        code: 'UNRESOLVED_INITIAL_INVESTMENT_ITEM',
        messageJa: '初期投資ラインに仕入価格もレシピもない根本アイテムがあります。',
        messageEn: 'The startup line has root items with neither a recipe nor a buy price.',
        itemIds: data.unresolvedItemIds,
      },
    ];
  }
  return result;
}

