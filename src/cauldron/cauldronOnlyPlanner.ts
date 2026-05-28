import { CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
import {
  findPreferredCauldronCandidatesForOutput,
  isPreferredCauldronInputItem,
  preferredCauldronInputCount,
  type CauldronRuntimeCandidate,
} from './cauldronCandidateSearch';
import type { CauldronMachineId, CauldronOptimizationResult, CauldronOptimizedPlan, CauldronOptimizedPlanIssue, CauldronPlanItem } from './cauldronTypes';
import type { CalculationResult, CalculatedFlow, ItemStat, RecipeStat } from '../engine/calculate';
import type { AppSettings, CauldronInputPreference, LocalizedText, Recipe } from '../types';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { getRecipesProducing } from '../data/recipes';
import { FUEL_HEAT_VALUE_BY_ITEM_ID, HEAT_CONSUMER_BY_MACHINE_ID } from '../data/heat';
import { FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID } from '../data/fertilizer';
import { chooseRecipeForItem } from '../engine/itemSourceResolver';
import { flowTransportForItem } from '../engine/flowTransport';

const MAX_DEPTH = 9;
const MAX_RUNTIME_CANDIDATES_TO_EXPAND = 24;

export type CauldronResolveMode = 'cauldronOnly' | 'normalBridge';

export type CauldronPlannerPolicy = {
  mode: CauldronResolveMode;
  allowNormalForNonCauldronTarget: boolean;
  allowNormalFallbackAfterCauldronFailure: boolean;
  allowStartupSeeds: boolean;
  allowPartialGraph: boolean;
};

export const CAULDRON_ONLY_POLICY: CauldronPlannerPolicy = {
  mode: 'cauldronOnly',
  allowNormalForNonCauldronTarget: false,
  allowNormalFallbackAfterCauldronFailure: false,
  allowStartupSeeds: false,
  allowPartialGraph: false,
};

export const NORMAL_BRIDGE_POLICY: CauldronPlannerPolicy = {
  mode: 'normalBridge',
  allowNormalForNonCauldronTarget: true,
  allowNormalFallbackAfterCauldronFailure: false,
  allowStartupSeeds: true,
  allowPartialGraph: true,
};

export type CauldronOnlyFailureCode =
  | 'NOT_CAULDRON_TARGET'
  | 'NO_CAULDRON_CANDIDATE'
  | 'INPUT_NOT_PLANT_DERIVED'
  | 'CYCLE'
  | 'DEPTH_LIMIT'
  | 'NO_NORMAL_RECIPE'
  | 'NO_NURSERY_RECIPE'
  | 'UNSUPPORTED_RECIPE_INPUT';

type CauldronOnlyFailure = {
  code: CauldronOnlyFailureCode;
  itemId: string;
  message: LocalizedText;
  candidate?: readonly [string, string, string];
  children?: CauldronOnlyFailure[];
};

type CauldronPlanNode =
  | {
      kind: 'cauldron';
      itemId: string;
      amount: number;
      candidate: CauldronRuntimeCandidate;
      children: CauldronPlanChild[];
    }
  | {
      kind: 'normal';
      itemId: string;
      amount: number;
      recipe: Recipe;
      recipeId: string;
      runsPerMinute: number;
      children: CauldronPlanChild[];
    }
  | {
      kind: 'source';
      itemId: string;
      amount: number;
      sourceKind: 'startup' | 'purchase' | 'plantDerivedInput' | 'unresolved';
      reason: LocalizedText;
    };

type CauldronPlanChild = {
  slotIndex?: 0 | 1 | 2;
  itemId: string;
  amount: number;
  node: CauldronPlanNode;
};

type ResolveResult = {
  ok: boolean;
  node?: CauldronPlanNode;
  failures: CauldronOnlyFailure[];
};

type ResolveMemo = Map<string, ResolveResult>;

export type CauldronOnlyPlannerResult = {
  result: CalculationResult;
  optimization: CauldronOptimizationResult;
};

function itemName(itemId: string): LocalizedText {
  return itemById[itemId]?.name ?? { ja: itemId, en: itemId };
}

function isSeedItem(itemId: string): boolean {
  return itemById[itemId]?.category === 'seed';
}

function failureMessage(code: CauldronOnlyFailureCode, itemId: string): LocalizedText {
  const name = itemName(itemId);
  switch (code) {
    case 'NOT_CAULDRON_TARGET':
      return { ja: `${name.ja} は錬金釜の出力ターゲットではありません。`, en: `${name.en} is not a cauldron output target.` };
    case 'NO_CAULDRON_CANDIDATE':
      return {
        ja: `${name.ja} は現在の錬金釜入力候補では3入力候補が見つかりませんでした。候補プール: ${preferredCauldronInputCount()}件`,
        en: `No three-input cauldron candidate was found for ${name.en} in the current input pool. Pool: ${preferredCauldronInputCount()} items.`,
      };
    case 'INPUT_NOT_PLANT_DERIVED':
      return { ja: `${name.ja} は錬金釜入力候補ではありません。`, en: `${name.en} is not a cauldron input candidate.` };
    case 'CYCLE':
      return { ja: `${name.ja} の探索中に循環しました。`, en: `A cycle was detected while expanding ${name.en}.` };
    case 'DEPTH_LIMIT':
      return { ja: `${name.ja} の探索が深さ上限に達しました。`, en: `Expansion for ${name.en} reached the depth limit.` };
    case 'NO_NORMAL_RECIPE':
      return { ja: `${name.ja} を展開する通常レシピがありません。`, en: `No normal recipe was found to expand ${name.en}.` };
    case 'NO_NURSERY_RECIPE':
      return { ja: `${name.ja} を栽培する苗床レシピがありません。`, en: `No nursery recipe was found to grow ${name.en}.` };
    case 'UNSUPPORTED_RECIPE_INPUT':
      return { ja: `${name.ja} の通常レシピに未対応入力があります。`, en: `${name.en} has an unsupported normal recipe input.` };
  }
}

function makeFailure(code: CauldronOnlyFailureCode, itemId: string, candidate?: readonly [string, string, string], children?: CauldronOnlyFailure[]): CauldronOnlyFailure {
  return { code, itemId, message: failureMessage(code, itemId), candidate, children };
}

function sourceNode(
  itemId: string,
  amount: number,
  sourceKind: 'startup' | 'purchase' | 'plantDerivedInput' | 'unresolved',
  reason?: LocalizedText,
): CauldronPlanNode {
  const name = itemName(itemId);
  return {
    kind: 'source',
    itemId,
    amount,
    sourceKind,
    reason: reason ?? (sourceKind === 'startup'
      ? { ja: `${name.ja} は初期投資として扱います。`, en: `${name.en} is treated as initial investment.` }
      : sourceKind === 'purchase'
        ? { ja: `${name.ja} を常時購入します。`, en: `${name.en} is supplied by constant purchase.` }
        : sourceKind === 'plantDerivedInput'
          ? { ja: `${name.ja} を錬金釜入力に使います。`, en: `${name.en} is used as a cauldron input.` }
          : { ja: `${name.ja} は未解決です。`, en: `${name.en} is unresolved.` }),
  };
}

function failedResult(code: CauldronOnlyFailureCode, itemId: string, policy: CauldronPlannerPolicy, amount: number, extraFailures: CauldronOnlyFailure[] = []): ResolveResult {
  const failure = makeFailure(code, itemId);
  const failures = [failure, ...extraFailures];
  if (policy.allowPartialGraph) return { ok: false, node: sourceNode(itemId, amount, 'unresolved', failure.message), failures };
  return { ok: false, failures };
}

function recipeOutputAmount(recipe: Recipe, itemId: string): number {
  return recipe.outputs
    .filter((output) => output.itemId === itemId)
    .reduce((sum, output) => sum + output.amount * (output.probability ?? 1), 0);
}

function selectRecipe(itemId: string, recipePreferences: Record<string, string>): Recipe | undefined {
  return chooseRecipeForItem(itemId, recipePreferences);
}

function purchaseSource(itemId: string, amount: number): ResolveResult {
  return { ok: true, node: sourceNode(itemId, amount, 'purchase'), failures: [] };
}

function isPurchasable(itemId: string): boolean {
  return itemById[itemId]?.buyPriceCopper !== undefined;
}

function inferredCauldronInputPreference(itemId: string): CauldronInputPreference | undefined {
  const item = itemById[itemId];
  if (!item) return undefined;
  const explicit = item.cauldronInputPreference;
  if (explicit && explicit !== 'exclude') return explicit;
  if (CAULDRON_TARGETS[itemId]) return 'cauldron_producible';
  if (item.buyPriceCopper !== undefined) return 'purchased_raw';
  return explicit;
}


function isCauldronProducibleInput(itemId: string): boolean {
  return inferredCauldronInputPreference(itemId) === 'cauldron_producible';
}

function recipeProduces(recipe: Recipe, itemId: string): boolean {
  return recipeOutputAmount(recipe, itemId) > 0;
}

function selectMachineRecipe(itemId: string, machineId: string): Recipe | undefined {
  return getRecipesProducing(itemId).find((recipe) => recipe.machineId === machineId && recipeProduces(recipe, itemId));
}

function selectWorldTreeRecipe(itemId: string): Recipe | undefined {
  return selectMachineRecipe(itemId, 'world_tree_nursery');
}

function selectNurseryRecipe(itemId: string): Recipe | undefined {
  return selectMachineRecipe(itemId, 'nursery');
}

function resolveNormalRecipe(
  itemId: string,
  amount: number,
  recipe: Recipe,
  policy: CauldronPlannerPolicy,
  recipePreferences: Record<string, string>,
  depth: number,
  path: Set<string>,
  memo: ResolveMemo,
  extraStartupItems: readonly { itemId: string; amount: number }[] = [],
): ResolveResult {
  const outputAmount = recipeOutputAmount(recipe, itemId);
  if (outputAmount <= 0) return failedResult('NO_NORMAL_RECIPE', itemId, policy, amount);

  const runsPerMinute = amount / outputAmount;
  const children: CauldronPlanChild[] = [];
  const failures: CauldronOnlyFailure[] = [];

  for (const startup of extraStartupItems) {
    children.push({
      itemId: startup.itemId,
      amount: startup.amount,
      node: sourceNode(startup.itemId, startup.amount, 'startup'),
    });
  }

  for (const input of recipe.inputs) {
    if (input.kind === 'paradoxableItem') {
      failures.push(makeFailure('UNSUPPORTED_RECIPE_INPUT', itemId));
      continue;
    }
    const childAmount = input.amount * runsPerMinute;
    if (recipe.machineId === 'nursery' && isSeedItem(input.itemId)) {
      children.push({ itemId: input.itemId, amount: 1, node: sourceNode(input.itemId, 1, 'startup') });
      continue;
    }
    const child = resolveOutputItem(input.itemId, childAmount, policy, recipePreferences, depth - 1, path, memo);
    if (!child.ok) failures.push(...child.failures);
    children.push({ itemId: input.itemId, amount: childAmount, node: child.node ?? sourceNode(input.itemId, childAmount, 'unresolved') });
  }

  const node: CauldronPlanNode = { kind: 'normal', itemId, amount, recipe, recipeId: recipe.id, runsPerMinute, children };
  return { ok: failures.length === 0, node, failures };
}

function resolveNurseryOutput(
  itemId: string,
  amount: number,
  policy: CauldronPlannerPolicy,
  recipePreferences: Record<string, string>,
  depth: number,
  path: Set<string>,
  memo: ResolveMemo,
): ResolveResult {
  const recipe = selectNurseryRecipe(itemId);
  if (!recipe) return failedResult('NO_NURSERY_RECIPE', itemId, policy, amount);
  return resolveNormalRecipe(itemId, amount, recipe, policy, recipePreferences, depth, path, memo);
}

function resolveWorldTreeOutput(
  itemId: string,
  amount: number,
  policy: CauldronPlannerPolicy,
  recipePreferences: Record<string, string>,
  depth: number,
  path: Set<string>,
  memo: ResolveMemo,
): ResolveResult {
  const recipe = selectWorldTreeRecipe(itemId);
  if (!recipe) return failedResult('NO_NORMAL_RECIPE', itemId, policy, amount);
  const machine = machineById[recipe.machineId];
  const startupItems = (machine?.buildCost ?? [])
    .filter((cost) => isSeedItem(cost.itemId))
    .map((cost) => ({ itemId: cost.itemId, amount: cost.amount }));
  return resolveNormalRecipe(itemId, amount, recipe, policy, recipePreferences, depth, path, memo, startupItems);
}

function resolveCauldronInputMaterial(
  itemId: string,
  amount: number,
  policy: CauldronPlannerPolicy,
  recipePreferences: Record<string, string>,
  depth: number,
  path: Set<string>,
  memo: ResolveMemo,
): ResolveResult {
  if (depth <= 0) return failedResult('DEPTH_LIMIT', itemId, policy, amount);
  if (path.has(itemId)) return failedResult('CYCLE', itemId, policy, amount);

  const preference = inferredCauldronInputPreference(itemId);
  const nextPath = new Set(path);
  nextPath.add(itemId);

  switch (preference) {
    case 'nursery_output':
      return resolveNurseryOutput(itemId, amount, policy, recipePreferences, depth, nextPath, memo);
    case 'nursery_processed':
    case 'nursery_burned':
    case 'nursery_multi_processed':
    case 'purchased_processed':
    case 'purchased_burned':
    case 'purchased_multi_processed':
      return resolveNormalOutput(itemId, amount, policy, recipePreferences, depth, nextPath, memo);
    case 'cauldron_producible':
      return resolveCauldronOutput(itemId, amount, policy, recipePreferences, depth, nextPath, memo, false);
    case 'world_tree_derived':
      return resolveWorldTreeOutput(itemId, amount, policy, recipePreferences, depth, nextPath, memo);
    case 'purchased_raw':
      return purchaseSource(itemId, amount);
    default:
      if (isPurchasable(itemId)) return purchaseSource(itemId, amount);
      if (!isPreferredCauldronInputItem(itemId)) {
        const failure = makeFailure('INPUT_NOT_PLANT_DERIVED', itemId);
        return { ok: false, node: sourceNode(itemId, amount, 'unresolved', failure.message), failures: [failure] };
      }
      return { ok: true, node: sourceNode(itemId, amount, 'plantDerivedInput'), failures: [] };
  }
}

function resolveCauldronOutput(
  itemId: string,
  amount: number,
  policy: CauldronPlannerPolicy,
  recipePreferences: Record<string, string>,
  depth: number,
  path: Set<string>,
  memo: ResolveMemo,
  allowNestedCauldronInputs = true,
): ResolveResult {
  if (!CAULDRON_TARGETS[itemId]) return failedResult('NOT_CAULDRON_TARGET', itemId, policy, amount);
  const allCandidates = findPreferredCauldronCandidatesForOutput(itemId, { maxCandidates: MAX_RUNTIME_CANDIDATES_TO_EXPAND * 3 });
  const candidates = allCandidates
    .filter((candidate) => allowNestedCauldronInputs || !candidate.inputItemIds.some(isCauldronProducibleInput))
    .slice(0, MAX_RUNTIME_CANDIDATES_TO_EXPAND);
  if (candidates.length === 0) return failedResult('NO_CAULDRON_CANDIDATE', itemId, policy, amount);

  const candidateFailures: CauldronOnlyFailure[] = [];
  for (const candidate of candidates) {
    const children: CauldronPlanChild[] = [];
    const failures: CauldronOnlyFailure[] = [];
    candidate.inputItemIds.forEach((childItemId, index) => {
      const slotIndex = index as 0 | 1 | 2;
      const child = resolveCauldronInputMaterial(childItemId, amount, policy, recipePreferences, depth - 1, path, memo);
      if (!child.ok) failures.push(...child.failures);
      children.push({ slotIndex, itemId: childItemId, amount, node: child.node ?? sourceNode(childItemId, amount, 'unresolved') });
    });

    const node: CauldronPlanNode = { kind: 'cauldron', itemId, amount, candidate, children };
    if (failures.length === 0) return { ok: true, node, failures: [] };
    candidateFailures.push(makeFailure('INPUT_NOT_PLANT_DERIVED', itemId, candidate.inputItemIds, failures));
  }

  return { ok: false, failures: [makeFailure('NO_CAULDRON_CANDIDATE', itemId, undefined, candidateFailures.slice(0, 12))] };
}

function resolveNormalOutput(
  itemId: string,
  amount: number,
  policy: CauldronPlannerPolicy,
  recipePreferences: Record<string, string>,
  depth: number,
  path: Set<string>,
  memo: ResolveMemo,
): ResolveResult {
  const recipe = selectRecipe(itemId, recipePreferences);
  if (!recipe) {
    if (isPurchasable(itemId)) return purchaseSource(itemId, amount);
    return failedResult('NO_NORMAL_RECIPE', itemId, policy, amount);
  }
  return resolveNormalRecipe(itemId, amount, recipe, policy, recipePreferences, depth, path, memo);
}

function resolveOutputItem(
  itemId: string,
  amount: number,
  policy: CauldronPlannerPolicy,
  recipePreferences: Record<string, string>,
  depth = MAX_DEPTH,
  path = new Set<string>(),
  memo: ResolveMemo = new Map(),
): ResolveResult {
  if (depth <= 0) return failedResult('DEPTH_LIMIT', itemId, policy, amount);
  if (path.has(itemId)) return failedResult('CYCLE', itemId, policy, amount);
  if (policy.allowStartupSeeds && isSeedItem(itemId)) return { ok: true, node: sourceNode(itemId, amount, 'startup'), failures: [] };

  const memoKey = `${policy.mode}:${itemId}:${amount.toFixed(6)}:${depth}`;
  const cached = memo.get(memoKey);
  if (cached) return cached;

  const nextPath = new Set(path);
  nextPath.add(itemId);
  let result: ResolveResult;

  if (CAULDRON_TARGETS[itemId]) {
    const cauldron = resolveCauldronOutput(itemId, amount, policy, recipePreferences, depth, nextPath, memo, true);
    if (cauldron.ok || !policy.allowNormalFallbackAfterCauldronFailure) result = cauldron;
    else result = resolveNormalOutput(itemId, amount, policy, recipePreferences, depth, nextPath, memo);
  } else if (policy.allowNormalForNonCauldronTarget) {
    result = resolveNormalOutput(itemId, amount, policy, recipePreferences, depth, nextPath, memo);
  } else {
    result = failedResult('NOT_CAULDRON_TARGET', itemId, policy, amount);
  }

  memo.set(memoKey, result);
  return result;
}

function emptyTotals(settings: AppSettings, overrides: Partial<CalculationResult['totals']> = {}): CalculationResult['totals'] {
  return {
    initialCostCopper: 0,
    runningCostCopperPerMin: 0,
    purchaseCostCopperPerMin: 0,
    revenueCopperPerMin: 0,
    profitCopperPerMin: 0,
    conveyorItemsPerMinute: 60,
    productionSpeedMultiplier: 1,
    heatConsumptionMultiplier: 1,
    sellPriceMultiplier: 1,
    fuelHeatValueMultiplier: 1,
    fertilizerNutritionMultiplier: 1,
    heatRequiredPerMin: 0,
    fuelRequiredPerMin: 0,
    fuelItemId: settings.fuel.fuelItemId,
    fertilizerNutrientsRequiredPerMin: 0,
    fertilizerRequiredPerMin: 0,
    fertilizerItemId: settings.fertilizer.fertilizerItemId,
    calculationMs: 0,
    queueSteps: 0,
    queueMax: 0,
    ...overrides,
  };
}

function emptyItemStat(itemId: string): ItemStat {
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

function addItemStat(stats: Record<string, ItemStat>, itemId: string): ItemStat {
  if (!stats[itemId]) stats[itemId] = emptyItemStat(itemId);
  return stats[itemId];
}

function recipeOutputRate(recipe: Recipe, itemId: string): number {
  const outputAmount = recipeOutputAmount(recipe, itemId);
  if (outputAmount <= 0 || recipe.timeSec <= 0) return 0;
  return outputAmount * 60 / recipe.timeSec;
}

function recipeIdForNode(node: CauldronPlanNode, pathKey: string, machineId: CauldronMachineId): string {
  if (node.kind === 'normal') return `${node.recipeId}:phase15:${pathKey}`;
  if (node.kind === 'cauldron') return `cauldron:phase1:${machineId}:${node.itemId}:${pathKey}:${node.candidate.inputItemIds.join('+')}`;
  return `source:${node.sourceKind}:${node.itemId}:${pathKey}`;
}

function makeRecipeStat(node: Extract<CauldronPlanNode, { kind: 'normal' | 'cauldron' }>, recipeId: string, machineId: CauldronMachineId): RecipeStat {
  const inputRates: Record<string, number> = {};
  for (const child of node.children) inputRates[child.itemId] = (inputRates[child.itemId] ?? 0) + child.amount;
  const outputRate = node.kind === 'normal' ? recipeOutputRate(node.recipe, node.itemId) : 1;
  const runsPerMinute = node.kind === 'normal' ? node.runsPerMinute : node.amount;
  const actualMachines = outputRate > 0 ? node.amount / outputRate : node.amount;
  const cauldronTarget = node.kind === 'cauldron' ? CAULDRON_TARGETS[node.itemId] : undefined;
  return {
    recipeId,
    machineId: node.kind === 'normal' ? node.recipe.machineId : machineId,
    displayName: node.kind === 'normal' ? node.recipe.name : itemName(node.itemId),
    theoreticalMachines: actualMachines,
    actualMachines,
    runsPerMinute,
    positiveNetProductionRate: node.amount,
    perMachineProductionRate: outputRate || 1,
    inputRates,
    outputRates: { [node.itemId]: node.amount },
    netRates: { [node.itemId]: node.amount },
    surplusOutputRates: {},
    discardedOutputRates: {},
    targetIds: [node.itemId],
    cauldronTargetValue: cauldronTarget?.targetValue,
    cauldronInputRawScore: node.kind === 'cauldron' ? node.candidate.rawScore : undefined,
    cauldronInputAdjustedScore: node.kind === 'cauldron' ? node.candidate.adjustedScore : undefined,
    cauldronDuplicatePenalty: node.kind === 'cauldron' ? node.candidate.duplicatePenalty : undefined,
  };
}

function sourceModeForSourceKind(sourceKind: 'startup' | 'purchase' | 'plantDerivedInput' | 'unresolved'): 'cycleInput' | 'buy' | 'plantDerivedInput' | 'unresolved' {
  if (sourceKind === 'startup') return 'cycleInput';
  if (sourceKind === 'purchase') return 'buy';
  if (sourceKind === 'plantDerivedInput') return 'plantDerivedInput';
  return 'unresolved';
}

function cauldronInputValueText(itemId: string): string {
  const value = CAULDRON_INPUT_VALUES[itemId]?.value;
  if (!Number.isFinite(value)) return '錬金値 ?';
  return '錬金値 ' + String(value);
}


function makeFlow(
  id: string,
  fromRecipeId: string | undefined,
  toRecipeId: string,
  itemId: string,
  rate: number,
  slotIndex?: number,
  sourceMode: 'cycleInput' | 'buy' | 'plantDerivedInput' | 'unresolved' = 'unresolved',
): CalculatedFlow {
  const from = fromRecipeId
    ? { type: 'recipe' as const, recipeId: fromRecipeId }
    : { type: 'itemSource' as const, itemId, sourceMode };
  const transport = flowTransportForItem(itemId, rate, 60);
  return {
    id,
    from,
    to: { type: 'recipe', recipeId: toRecipeId },
    itemId,
    rate,
    belts: transport.belts,
    transportKind: transport.transportKind,
    transportUnits: transport.transportUnits,
    role: 'material',
    displayRateLabel: slotIndex === undefined ? undefined : `slot ${slotIndex + 1} ・ ${cauldronInputValueText(itemId)}`, 
  };
}


type PlannerTotals = {
  initialCostCopper: number;
  purchaseCostCopperPerMin: number;
  heatRequiredPerMin: number;
  fuelRequiredPerMin: number;
  fertilizerNutrientsRequiredPerMin: number;
  fertilizerRequiredPerMin: number;
};

function recipeHeatRequiredPerMin(recipe: Recipe, runsPerMinute: number): number {
  const heatPerSecond = (HEAT_CONSUMER_BY_MACHINE_ID[recipe.machineId]?.heatPerSec ?? 0) + (recipe.heatInputPerSec ?? 0);
  if (!Number.isFinite(heatPerSecond) || heatPerSecond <= 0 || runsPerMinute <= 0 || recipe.timeSec <= 0) return 0;
  return heatPerSecond * recipe.timeSec * runsPerMinute;
}

function cauldronHeatRequiredPerMin(node: Extract<CauldronPlanNode, { kind: 'cauldron' }>): number {
  const target = CAULDRON_TARGETS[node.itemId];
  const heatPerSecond = target?.heatPerSec ?? 0;
  if (!Number.isFinite(heatPerSecond) || heatPerSecond <= 0 || node.amount <= 0) return 0;
  const timeSec = target?.timeSec;
  const machineCount = Number.isFinite(timeSec) && (timeSec ?? 0) > 0 ? node.amount / (60 / (timeSec ?? 1)) : node.amount;
  return heatPerSecond * 60 * machineCount;
}

function collectPlannerTotals(node: CauldronPlanNode, settings: AppSettings): PlannerTotals {
  const totals: PlannerTotals = {
    initialCostCopper: 0,
    purchaseCostCopperPerMin: 0,
    heatRequiredPerMin: 0,
    fuelRequiredPerMin: 0,
    fertilizerNutrientsRequiredPerMin: 0,
    fertilizerRequiredPerMin: 0,
  };

  function addFromNode(current: CauldronPlanNode): void {
    if (current.kind === 'source') {
      const price = itemById[current.itemId]?.buyPriceCopper ?? 0;
      if (current.sourceKind === 'startup') totals.initialCostCopper += price * current.amount;
      if (current.sourceKind === 'purchase') totals.purchaseCostCopperPerMin += price * current.amount;
      return;
    }

    if (current.kind === 'normal') {
      totals.heatRequiredPerMin += recipeHeatRequiredPerMin(current.recipe, current.runsPerMinute);
      const nutrients = Math.max(0, current.recipe.nutrientInputPerRun ?? 0) * current.runsPerMinute;
      if (Number.isFinite(nutrients) && nutrients > 0) totals.fertilizerNutrientsRequiredPerMin += nutrients;
    } else {
      totals.heatRequiredPerMin += cauldronHeatRequiredPerMin(current);
    }

    for (const child of current.children) addFromNode(child.node);
  }

  addFromNode(node);

  const fuelHeatValue = FUEL_HEAT_VALUE_BY_ITEM_ID[settings.fuel.fuelItemId] ?? 0;
  if (fuelHeatValue > 0) totals.fuelRequiredPerMin = totals.heatRequiredPerMin / fuelHeatValue;

  const fertilizerValue = FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[settings.fertilizer.fertilizerItemId] ?? 0;
  if (fertilizerValue > 0) totals.fertilizerRequiredPerMin = totals.fertilizerNutrientsRequiredPerMin / fertilizerValue;

  return totals;
}

function buildCalculationResult(root: CauldronPlanNode, settings: AppSettings, machineId: CauldronMachineId, ok: boolean, failures: CauldronOnlyFailure[], mode: CauldronResolveMode): CalculationResult {
  const itemStats: Record<string, ItemStat> = {};
  const recipeStats: Record<string, RecipeStat> = {};
  const flows: CalculatedFlow[] = [];
  let nodeIndex = 0;

  function visit(node: CauldronPlanNode, parentRecipeId?: string, parentSlotIndex?: number, pathKey = 'root'): string | undefined {
    if (node.kind === 'source') {
      const stat = addItemStat(itemStats, node.itemId);
      const price = itemById[node.itemId]?.buyPriceCopper ?? 0;
      if (node.sourceKind === 'startup') {
        stat.initialPurchased += node.amount;
        stat.initialCostCopper += price * node.amount;
      }
      if (node.sourceKind === 'purchase') {
        stat.purchased += node.amount;
        stat.purchaseCostCopperPerMin += price * node.amount;
      }
      if (parentRecipeId) {
        flows.push(makeFlow(
          `cauldron-planner:${parentRecipeId}:source:${node.sourceKind}:${node.itemId}:slot${parentSlotIndex ?? 'x'}:${flows.length}`,
          undefined,
          parentRecipeId,
          node.itemId,
          node.amount,
          parentSlotIndex,
          sourceModeForSourceKind(node.sourceKind),
        ));
      }
      return undefined;
    }

    const recipeId = recipeIdForNode(node, `${pathKey}:${nodeIndex++}`, machineId);
    recipeStats[recipeId] = makeRecipeStat(node, recipeId, machineId);
    const produced = addItemStat(itemStats, node.itemId);
    produced.produced += node.amount;
    if (!parentRecipeId) {
      produced.targetRequested += node.amount;
      produced.targetActual += ok ? node.amount : 0;
    }

    node.children.forEach((child, childIndex) => {
      const consumed = addItemStat(itemStats, child.itemId);
      consumed.consumed += child.amount;
      const childRecipeId = visit(child.node, recipeId, child.slotIndex, `${pathKey}.${childIndex}`);
      if (child.node.kind !== 'source') {
        flows.push(makeFlow(`cauldron-planner:${recipeId}:slot${child.slotIndex ?? childIndex}:${child.itemId}:${flows.length}`, childRecipeId, recipeId, child.itemId, child.amount, child.slotIndex));
      }
    });

    if (parentRecipeId && parentSlotIndex !== undefined) return recipeId;
    flows.push({
      id: `cauldron-planner:${recipeId}:final:${node.itemId}`,
      from: { type: 'recipe', recipeId },
      to: { type: 'itemSink', itemId: node.itemId, sinkMode: 'final' },
      itemId: node.itemId,
      rate: node.amount,
      belts: flowTransportForItem(node.itemId, node.amount, 60).belts,
      transportKind: flowTransportForItem(node.itemId, node.amount, 60).transportKind,
      transportUnits: flowTransportForItem(node.itemId, node.amount, 60).transportUnits,
      role: 'finalOutput',
    });
    return recipeId;
  }

  visit(root);

  return {
    itemStats,
    recipeStats,
    flows,
    conveyorEdges: [],
    outputEdges: [],
    warnings: [],
    calculationStatus: ok ? 'ok' : 'invalid',
    errorSummaries: ok ? [] : [
      {
        code: failures[0]?.code ?? 'CAULDRON_PLANNER_FAILED',
        messageJa: failures[0]?.message.ja ?? '錬金釜探索に失敗しました。',
        messageEn: failures[0]?.message.en ?? 'Cauldron planning failed.',
        itemIds: Array.from(new Set(failures.flatMap((failure) => [failure.itemId, ...(failure.children ?? []).map((child) => child.itemId)]))),
      },
    ],
    totals: emptyTotals(settings, collectPlannerTotals(root, settings)),
  };
}

function blockedResult(targetItemId: string, settings: AppSettings, failures: CauldronOnlyFailure[]): CalculationResult {
  return {
    itemStats: {},
    recipeStats: {},
    flows: [],
    conveyorEdges: [],
    outputEdges: [],
    warnings: [],
    calculationStatus: 'invalid',
    errorSummaries: [
      {
        code: failures[0]?.code ?? 'CAULDRON_PLANNER_FAILED',
        messageJa: failures[0]?.message.ja ?? `${itemName(targetItemId).ja} の錬金釜探索に失敗しました。`,
        messageEn: failures[0]?.message.en ?? `Failed to search cauldron recipes for ${itemName(targetItemId).en}.`,
        itemIds: Array.from(new Set(failures.map((failure) => failure.itemId))),
      },
    ],
    totals: emptyTotals(settings),
  };
}

function planItemFromNode(node: CauldronPlanNode): CauldronPlanItem {
  if (node.kind === 'source') {
    return {
      itemId: node.itemId,
      label: itemName(node.itemId),
      amount: node.amount,
      status: node.sourceKind === 'startup' ? 'startup' : node.sourceKind === 'purchase' ? 'purchase' : node.sourceKind === 'plantDerivedInput' ? 'plantDerivedInput' : 'missing',
      reason: node.reason,
      children: [],
    };
  }
  return {
    itemId: node.itemId,
    label: itemName(node.itemId),
    amount: node.amount,
    status: node.kind === 'cauldron' ? 'cauldronTarget' : 'normal',
    reason: node.kind === 'cauldron'
      ? { ja: '錬金釜で作成します。', en: 'Produced with a cauldron.' }
      : { ja: '非錬金釜ターゲットを通常レシピで通過展開しています。', en: 'Non-cauldron target bridged through a normal recipe.' },
    recipeId: node.kind === 'normal' ? node.recipeId : undefined,
    candidateCount: node.kind === 'cauldron' ? findPreferredCauldronCandidatesForOutput(node.itemId).length : undefined,
    selectedInputItemIds: node.kind === 'cauldron' ? [...node.candidate.inputItemIds] as [string, string, string] : undefined,
    children: node.children.map((child) => planItemFromNode(child.node)),
  };
}

function formatFailureCandidate(candidate: readonly [string, string, string] | undefined, lang: 'ja' | 'en'): string {
  if (!candidate) return '';
  const items = candidate.map((itemId) => itemName(itemId)[lang]).join(' + ');
  return lang === 'ja' ? `候補: ${items}` : `Candidate: ${items}`;
}

function failureDetailText(failure: CauldronOnlyFailure, lang: 'ja' | 'en', depth = 0): string {
  const indent = '  '.repeat(depth);
  const lines = [`${indent}${failure.message[lang]}`];
  const candidateLine = formatFailureCandidate(failure.candidate, lang);
  if (candidateLine) lines.push(`${indent}${candidateLine}`);
  for (const child of (failure.children ?? []).slice(0, 12)) {
    lines.push(failureDetailText(child, lang, depth + 1));
  }
  return lines.join('\n');
}

function collectFailureItemIds(failure: CauldronOnlyFailure, output = new Set<string>()): string[] {
  output.add(failure.itemId);
  for (const candidateItemId of failure.candidate ?? []) output.add(candidateItemId);
  for (const child of failure.children ?? []) collectFailureItemIds(child, output);
  return [...output];
}

function issueFromFailure(failure: CauldronOnlyFailure): CauldronOptimizedPlanIssue {
  return {
    code: 'MISSING',
    severity: 'error',
    message: { ja: failureDetailText(failure, 'ja'), en: failureDetailText(failure, 'en') },
    itemIds: collectFailureItemIds(failure),
  };
}

function countNodes(node: CauldronPlanNode): { recipes: number; edges: number; depth: number; missing: string[]; initial: string[]; purchased: string[] } {
  if (node.kind === 'source') {
    return {
      recipes: 0,
      edges: 0,
      depth: 0,
      missing: node.sourceKind === 'unresolved' ? [node.itemId] : [],
      initial: node.sourceKind === 'startup' ? [node.itemId] : [],
      purchased: node.sourceKind === 'purchase' ? [node.itemId] : [],
    };
  }
  let recipes = 1;
  let edges = node.children.length + 1;
  let depth = 1;
  const missing: string[] = [];
  const initial: string[] = [];
  const purchased: string[] = [];
  for (const child of node.children) {
    const next = countNodes(child.node);
    recipes += next.recipes;
    edges += next.edges;
    depth = Math.max(depth, next.depth + 1);
    missing.push(...next.missing);
    initial.push(...next.initial);
    purchased.push(...next.purchased);
  }
  return { recipes, edges, depth, missing, initial, purchased };
}

export function planCauldronOnlyTarget(options: {
  targetItemId: string;
  amount: number;
  machineId: CauldronMachineId;
  settings: AppSettings;
  recipePreferences?: Record<string, string>;
  mode?: CauldronResolveMode;
}): CauldronOnlyPlannerResult {
  const amount = Math.max(1, Number(options.amount) || 1);
  const policy = options.mode === 'normalBridge' ? NORMAL_BRIDGE_POLICY : CAULDRON_ONLY_POLICY;
  const recipePreferences = options.recipePreferences ?? {};
  const resolved = resolveOutputItem(options.targetItemId, amount, policy, recipePreferences);
  const targetLabel = itemName(options.targetItemId);

  if (!resolved.node) {
    const result = blockedResult(options.targetItemId, options.settings, resolved.failures);
    const issues = resolved.failures.slice(0, 10).map(issueFromFailure);
    return {
      result,
      optimization: {
        targetItemId: options.targetItemId,
        targetLabel,
        bestPlan: {
          id: `cauldron:${policy.mode}:${options.targetItemId}:blocked`,
          rank: 1,
          source: 'cauldron',
          status: 'blocked',
          score: Number.POSITIVE_INFINITY,
          targetItemId: options.targetItemId,
          targetLabel,
          title: { ja: `${targetLabel.ja}（錬金釜 ${policy.mode}）`, en: `${targetLabel.en} (Cauldron ${policy.mode})` },
          summary: { ja: '候補を作れませんでした。', en: 'No candidate could be selected.' },
          targetRatePerMinute: amount,
          root: { itemId: options.targetItemId, label: targetLabel, amount, status: 'missing', reason: resolved.failures[0]?.message ?? { ja: '候補なし', en: 'No candidate' }, children: [] },
          metrics: {
            selfContained: false,
            noSurplus: true,
            hasConstantSupply: false,
            hasMissing: true,
            hasBlockingSurplus: false,
            startupCostCopper: 0,
            purchaseCostCopperPerMin: 0,
            initialItemIds: [],
            purchasedItemIds: [],
            externalItemIds: [],
            unresolvedItemIds: [options.targetItemId],
            surplusItemIds: [],
            coinSurplusItemIds: [],
            sellableSurplusItemIds: [],
            blockingSurplusItemIds: [],
            recipeCount: 0,
            edgeCount: 0,
            depth: 0,
            machineCount: 0,
            heatRequiredPerMin: 0,
            fuelRequiredPerMin: 0,
            fertilizerRequiredPerMin: 0,
          },
          issues,
        },
        plans: [],
      },
    };
  }

  const result = buildCalculationResult(resolved.node, options.settings, options.machineId, resolved.ok, resolved.failures, policy.mode);
  const counts = countNodes(resolved.node);
  const rootPlan = planItemFromNode(resolved.node);
  const issues: CauldronOptimizedPlanIssue[] = resolved.ok
    ? []
    : resolved.failures.slice(0, 10).map(issueFromFailure);

  const bestPlan: CauldronOptimizedPlan = {
    id: `cauldron:${policy.mode}:${options.targetItemId}`,
    rank: 1,
    source: 'cauldron',
    status: resolved.ok ? 'warning' : 'blocked',
    score: resolved.ok ? 0 : Number.POSITIVE_INFINITY,
    targetItemId: options.targetItemId,
    targetLabel,
    title: targetLabel,
    summary: { ja: resolved.ok ? (counts.purchased.length > 0 ? '常時購入を含む候補です。' : '初期投資を除き外部供給なしの候補です。') : '未解決を含む候補です。', en: resolved.ok ? (counts.purchased.length > 0 ? 'The candidate includes constant purchases.' : 'The candidate has no external supply except initial investment.') : 'The candidate contains unresolved inputs.' },
    targetRatePerMinute: amount,
    selectedInputItemIds: resolved.node.kind === 'cauldron' ? [...resolved.node.candidate.inputItemIds] as [string, string, string] : undefined,
    root: rootPlan,
    metrics: {
      selfContained: resolved.ok && counts.purchased.length === 0,
      noSurplus: true,
      hasConstantSupply: counts.purchased.length > 0,
      hasMissing: !resolved.ok || counts.missing.length > 0,
      hasBlockingSurplus: false,
      startupCostCopper: result.totals.initialCostCopper,
      purchaseCostCopperPerMin: result.totals.purchaseCostCopperPerMin,
      initialItemIds: Array.from(new Set(counts.initial)),
      purchasedItemIds: Array.from(new Set(counts.purchased)),
      externalItemIds: Array.from(new Set(counts.purchased)),
      unresolvedItemIds: Array.from(new Set(counts.missing.length ? counts.missing : resolved.ok ? [] : [options.targetItemId])),
      surplusItemIds: [],
      coinSurplusItemIds: [],
      sellableSurplusItemIds: [],
      blockingSurplusItemIds: [],
      recipeCount: counts.recipes,
      edgeCount: counts.edges,
      depth: counts.depth,
      machineCount: counts.recipes,
      heatRequiredPerMin: result.totals.heatRequiredPerMin,
      fuelRequiredPerMin: result.totals.fuelRequiredPerMin,
      fertilizerRequiredPerMin: result.totals.fertilizerRequiredPerMin,
    },
    issues,
  };

  return { result, optimization: { targetItemId: options.targetItemId, targetLabel, bestPlan, plans: [bestPlan] } };
}
