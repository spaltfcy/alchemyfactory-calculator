import { CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
import {
  findCauldronCandidatesForOutput,
  isPreferredCauldronInputItem,
  cauldronInputCount,
  cauldronInputPreferenceRank,
  cauldronAdjustedScore,
  cauldronRawScore,
  duplicatePenaltyForCauldronInput,
  type CauldronRuntimeCandidate,
} from './cauldronCandidateSearch';
import type { CauldronCandidateSelectionKey, CauldronMachineId, CauldronObjectiveViolation, CauldronOptimizationResult, CauldronOptimizedPlan, CauldronOptimizedPlanIssue, CauldronPlanItem } from './cauldronTypes';
import type { CalculationResult, CalculatedFlow, ItemStat, RecipeStat } from '../engine/calculate';
import type { AbilitySettings, AppSettings, CauldronInputPreference, ExternalSourceMode, LocalizedText, Recipe } from '../types';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { getRecipesProducing, recipeById } from '../data/recipes';
import { FUEL_HEAT_VALUE_BY_ITEM_ID, FUEL_ITEM_IDS, HEAT_CONSUMER_BY_MACHINE_ID } from '../data/heat';
import { FERTILIZER_ITEM_IDS, FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID } from '../data/fertilizer';
import { getConveyorItemsPerMinute, getFertilizerNutritionMultiplier, getFuelHeatValueMultiplier, getHeatConsumptionMultiplier, getProductionSpeedMultiplier } from '../data/abilityTables';
import { calcEffectiveCauldronStats } from './cauldronPhysics';
import { chooseRecipeForItem } from '../engine/itemSourceResolver';
import { flowTransportForItem } from '../engine/flowTransport';

const MAX_DEPTH = 9;
const MAX_RUNTIME_CANDIDATES_TO_EXPAND = 120;

export type CauldronPlannerPolicy = {
  allowNormalForNonCauldronTarget: boolean;
  allowNormalFallbackAfterCauldronFailure: boolean;
  allowStartupSeeds: boolean;
  allowPartialGraph: boolean;
};

export const CAULDRON_PLANNER_POLICY: CauldronPlannerPolicy = {
  allowNormalForNonCauldronTarget: true,
  allowNormalFallbackAfterCauldronFailure: true,
  allowStartupSeeds: true,
  allowPartialGraph: true,
};

export type CauldronPlannerFailureCode =
  | 'NOT_CAULDRON_TARGET'
  | 'NO_CAULDRON_CANDIDATE'
  | 'INPUT_NOT_PLANT_DERIVED'
  | 'CYCLE'
  | 'DEPTH_LIMIT'
  | 'NO_NORMAL_RECIPE'
  | 'NO_NURSERY_RECIPE'
  | 'UNSUPPORTED_RECIPE_INPUT';

type CauldronPlannerFailure = {
  code: CauldronPlannerFailureCode;
  itemId: string;
  message: LocalizedText;
  candidate?: readonly [string, string, string];
  children?: CauldronPlannerFailure[];
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
  failures: CauldronPlannerFailure[];
};

type ResolveMemo = Map<string, ResolveResult>;

export type CauldronPlannerResult = {
  result: CalculationResult;
  optimization: CauldronOptimizationResult;
};

function itemName(itemId: string): LocalizedText {
  return itemById[itemId]?.name ?? { ja: itemId, en: itemId };
}

function isSeedItem(itemId: string): boolean {
  return itemById[itemId]?.category === 'seed';
}

function failureMessage(code: CauldronPlannerFailureCode, itemId: string): LocalizedText {
  const name = itemName(itemId);
  switch (code) {
    case 'NOT_CAULDRON_TARGET':
      return { ja: `${name.ja} は錬金釜の出力ターゲットではありません。`, en: `${name.en} is not a cauldron output target.` };
    case 'NO_CAULDRON_CANDIDATE':
      return {
        ja: `${name.ja} は現在の錬金釜入力候補では3入力候補が見つかりませんでした。候補プール: ${cauldronInputCount()}件`,
        en: `No three-input cauldron candidate was found for ${name.en} in the current input pool. Pool: ${cauldronInputCount()} items.`,
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

function makeFailure(code: CauldronPlannerFailureCode, itemId: string, candidate?: readonly [string, string, string], children?: CauldronPlannerFailure[]): CauldronPlannerFailure {
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

function failedResult(code: CauldronPlannerFailureCode, itemId: string, policy: CauldronPlannerPolicy, amount: number, extraFailures: CauldronPlannerFailure[] = []): ResolveResult {
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


function isCauldronMachineId(machineId: string): boolean {
  return machineId === 'cauldron' || machineId === 'advanced_cauldron';
}

function cauldronInputTupleFromRecipe(recipe: Recipe): [string, string, string] | undefined {
  const itemInputs = recipe.inputs.filter((input) => input.kind !== 'paradoxableItem').map((input) => input.itemId);
  if (itemInputs.length !== 3) return undefined;
  if (!itemInputs.every((itemId) => CAULDRON_INPUT_VALUES[itemId] !== undefined)) return undefined;
  return [itemInputs[0], itemInputs[1], itemInputs[2]];
}

function cauldronStatsForTargetItem(
  itemId: string,
  productionSpeedMultiplier: number,
  heatConsumptionMultiplier: number,
) {
  const target = CAULDRON_TARGETS[itemId];
  if (!target) return undefined;
  return calcEffectiveCauldronStats(target.targetValue, productionSpeedMultiplier, heatConsumptionMultiplier);
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
  const failures: CauldronPlannerFailure[] = [];

  for (const startup of extraStartupItems) {
    children.push({
      itemId: startup.itemId,
      amount: startup.amount,
      node: sourceNode(startup.itemId, startup.amount, 'startup'),
    });
  }

  let cauldronSlotIndex = 0;
  for (const input of recipe.inputs) {
    if (input.kind === 'paradoxableItem') {
      failures.push(makeFailure('UNSUPPORTED_RECIPE_INPUT', itemId));
      continue;
    }
    const slotIndex = isCauldronMachineId(recipe.machineId) && cauldronSlotIndex < 3 ? cauldronSlotIndex as 0 | 1 | 2 : undefined;
    if (isCauldronMachineId(recipe.machineId)) cauldronSlotIndex += 1;
    const childAmount = input.amount * runsPerMinute;
    if (recipe.machineId === 'nursery' && isSeedItem(input.itemId)) {
      children.push({ slotIndex, itemId: input.itemId, amount: 1, node: sourceNode(input.itemId, 1, 'startup') });
      continue;
    }
    const child = resolveOutputItem(input.itemId, childAmount, policy, recipePreferences, depth - 1, path, memo);
    if (!child.ok) failures.push(...child.failures);
    children.push({ slotIndex, itemId: input.itemId, amount: childAmount, node: child.node ?? sourceNode(input.itemId, childAmount, 'unresolved') });
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
      if (selectRecipe(itemId, recipePreferences)) return resolveNormalOutput(itemId, amount, policy, recipePreferences, depth, nextPath, memo);
      if (!isPreferredCauldronInputItem(itemId)) {
        const failure = makeFailure('INPUT_NOT_PLANT_DERIVED', itemId);
        return { ok: false, node: sourceNode(itemId, amount, 'unresolved', failure.message), failures: [failure] };
      }
      return { ok: true, node: sourceNode(itemId, amount, 'plantDerivedInput'), failures: [] };
  }
}

type CandidateAttempt = {
  candidate: CauldronRuntimeCandidate;
  node: CauldronPlanNode;
  failures: CauldronPlannerFailure[];
  selectionKey: CauldronCandidateSelectionKey;
};

type CauldronInputRouteMetrics = {
  worstTier: number;
  tierSum: number;
  cauldronDepth: number;
};

function collectNodeSourceKinds(node: CauldronPlanNode): { purchased: Set<string>; unresolved: Set<string>; plantDerivedInput: Set<string> } {
  const buckets = { purchased: new Set<string>(), unresolved: new Set<string>(), plantDerivedInput: new Set<string>() };
  function visit(current: CauldronPlanNode): void {
    if (current.kind === 'source') {
      if (current.sourceKind === 'purchase') buckets.purchased.add(current.itemId);
      if (current.sourceKind === 'unresolved') buckets.unresolved.add(current.itemId);
      if (current.sourceKind === 'plantDerivedInput') buckets.plantDerivedInput.add(current.itemId);
      return;
    }
    for (const child of current.children) visit(child.node);
  }
  visit(node);
  return buckets;
}

function isLowTargetCauldronIntermediate(itemId: string): boolean {
  const targetValue = CAULDRON_TARGETS[itemId]?.targetValue;
  return targetValue !== undefined && targetValue <= 1_000;
}

function isMidTargetCauldronIntermediate(itemId: string): boolean {
  const targetValue = CAULDRON_TARGETS[itemId]?.targetValue;
  return targetValue !== undefined && targetValue > 1_000 && targetValue <= 10_000;
}

function cauldronNodeDepth(node: CauldronPlanNode): number {
  if (node.kind === 'source') return 0;
  const own = node.kind === 'cauldron' || isCauldronMachineId(node.recipe.machineId) ? 1 : 0;
  let childMax = 0;
  for (const child of node.children) childMax = Math.max(childMax, cauldronNodeDepth(child.node));
  return own + childMax;
}

function inputRouteTier(itemId: string, node: CauldronPlanNode, failureCount: number): number {
  if (failureCount > 0) return 90;
  if (node.kind === 'source') {
    if (node.sourceKind === 'unresolved') return 90;
    if (node.sourceKind === 'purchase') return 80;
    if (node.sourceKind === 'startup') return 18;
    if (node.sourceKind === 'plantDerivedInput') return 26;
  }
  const counts = countNodes(node);
  if (counts.missing.length > 0) return 90;
  if (counts.purchased.length > 0) return 80;
  if (isLowTargetCauldronIntermediate(itemId)) return counts.depth <= 3 ? 14 : 22;
  if (node.kind === 'cauldron') return isMidTargetCauldronIntermediate(itemId) ? 36 : 55;
  if (node.kind === 'normal' && isCauldronMachineId(node.recipe.machineId)) return isMidTargetCauldronIntermediate(itemId) ? 36 : 55;
  if (counts.recipes <= 2 && counts.depth <= 3) return 20;
  if (counts.recipes <= 4 && counts.depth <= 5) return 32;
  if (counts.initial.length > 0) return 38;
  return 50;
}

function collectInputRouteMetrics(node: CauldronPlanNode, failures: CauldronPlannerFailure[]): CauldronInputRouteMetrics {
  if (node.kind !== 'cauldron') return { worstTier: 0, tierSum: 0, cauldronDepth: cauldronNodeDepth(node) };
  const tiers = node.children.map((child) => inputRouteTier(child.itemId, child.node, failures.length));
  return {
    worstTier: tiers.length > 0 ? Math.max(...tiers) : 90,
    tierSum: tiers.reduce((sum, tier) => sum + tier, 0),
    cauldronDepth: cauldronNodeDepth(node),
  };
}

function selectionKeyForCandidateAttempt(candidate: CauldronRuntimeCandidate, node: CauldronPlanNode, failures: CauldronPlannerFailure[]): CauldronCandidateSelectionKey {
  const buckets = collectNodeSourceKinds(node);
  const counts = countNodes(node);
  const route = collectInputRouteMetrics(node, failures);
  const unresolvedCount = buckets.unresolved.size + failures.length;
  const constantPurchaseCount = buckets.purchased.size;
  const plantDerivedInputCount = buckets.plantDerivedInput.size;
  const classRank = unresolvedCount > 0
    ? 5
    : constantPurchaseCount > 0
      ? 4
      : 0;
  const preferenceRanks = candidate.inputItemIds.map((itemId) => cauldronInputPreferenceRank(itemId) ?? 999);
  return {
    classRank,
    unresolvedCount,
    constantPurchaseCount,
    existingReuseCount: 0,
    alreadyProducedReuseCount: 0,
    plantDerivedInputCount,
    fertilizerOpenCount: 0,
    fuelOpenCount: 0,
    heatOpenCount: 0,
    worstInputPreferenceRank: Math.max(...preferenceRanks),
    worstInputRouteTier: route.worstTier,
    inputRouteTierSum: route.tierSum,
    cauldronChainDepth: route.cauldronDepth,
    supportClosureRank: 0,
    routeRecipeCount: counts.recipes,
    routeDepth: counts.depth,
    duplicateInputCount: candidate.duplicateItemCount,
    overTargetInputCount: candidate.overTargetInputCount,
    weightedDistance: candidate.weightedDistance,
    adjustedScore: candidate.adjustedScore,
  };
}

function compareCandidateSelectionKey(a: CauldronCandidateSelectionKey, b: CauldronCandidateSelectionKey): number {
  const fields: Array<keyof CauldronCandidateSelectionKey> = [
    'classRank',
    'unresolvedCount',
    'constantPurchaseCount',
    'existingReuseCount',
    'alreadyProducedReuseCount',
    'worstInputRouteTier',
    'inputRouteTierSum',
    'cauldronChainDepth',
    'supportClosureRank',
    'routeRecipeCount',
    'routeDepth',
    'plantDerivedInputCount',
    'fertilizerOpenCount',
    'fuelOpenCount',
    'heatOpenCount',
    'worstInputPreferenceRank',
    'duplicateInputCount',
    'overTargetInputCount',
    'weightedDistance',
    'adjustedScore',
  ];
  for (const field of fields) {
    const diff = a[field] - b[field];
    if (Math.abs(diff) > 1e-9) return diff;
  }
  return 0;
}

function compareCandidateAttempt(a: CandidateAttempt, b: CandidateAttempt): number {
  const key = compareCandidateSelectionKey(a.selectionKey, b.selectionKey);
  if (key !== 0) return key;
  return a.candidate.inputItemIds.join('\u0000').localeCompare(b.candidate.inputItemIds.join('\u0000'));
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
  const allCandidates = findCauldronCandidatesForOutput(itemId, { maxCandidates: MAX_RUNTIME_CANDIDATES_TO_EXPAND * 6 });
  const candidates = allCandidates
    .filter((candidate) => allowNestedCauldronInputs || !candidate.inputItemIds.some(isCauldronProducibleInput))
    .slice(0, MAX_RUNTIME_CANDIDATES_TO_EXPAND);
  if (candidates.length === 0) return failedResult('NO_CAULDRON_CANDIDATE', itemId, policy, amount);

  const attempts: CandidateAttempt[] = [];
  const candidateFailures: CauldronPlannerFailure[] = [];
  for (const candidate of candidates) {
    const children: CauldronPlanChild[] = [];
    const failures: CauldronPlannerFailure[] = [];
    candidate.inputItemIds.forEach((childItemId, index) => {
      const slotIndex = index as 0 | 1 | 2;
      const child = resolveCauldronInputMaterial(childItemId, amount, policy, recipePreferences, depth - 1, path, memo);
      if (!child.ok) failures.push(...child.failures);
      children.push({ slotIndex, itemId: childItemId, amount, node: child.node ?? sourceNode(childItemId, amount, 'unresolved') });
    });

    const node: CauldronPlanNode = { kind: 'cauldron', itemId, amount, candidate, children };
    attempts.push({ candidate, node, failures, selectionKey: selectionKeyForCandidateAttempt(candidate, node, failures) });
    if (failures.length > 0) candidateFailures.push(makeFailure('INPUT_NOT_PLANT_DERIVED', itemId, candidate.inputItemIds, failures));
  }

  attempts.sort(compareCandidateAttempt);
  const best = attempts[0];
  if (best && best.failures.length === 0) return { ok: true, node: best.node, failures: [] };
  if (policy.allowPartialGraph && best) return { ok: false, node: best.node, failures: best.failures.length > 0 ? best.failures : [makeFailure('NO_CAULDRON_CANDIDATE', itemId)] };

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

  const memoKey = `${itemId}:${amount.toFixed(6)}:${depth}`;
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

function emptyTotals(settings: AppSettings, abilities: AbilitySettings, overrides: Partial<CalculationResult['totals']> = {}): CalculationResult['totals'] {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(abilities);
  const heatConsumptionMultiplier = getHeatConsumptionMultiplier(abilities);
  const conveyorItemsPerMinute = getConveyorItemsPerMinute(abilities);
  const fuelHeatValueMultiplier = getFuelHeatValueMultiplier(abilities);
  const fertilizerNutritionMultiplier = getFertilizerNutritionMultiplier(abilities);
  return {
    initialCostCopper: 0,
    runningCostCopperPerMin: 0,
    purchaseCostCopperPerMin: 0,
    revenueCopperPerMin: 0,
    profitCopperPerMin: 0,
    conveyorItemsPerMinute,
    productionSpeedMultiplier,
    heatConsumptionMultiplier,
    sellPriceMultiplier: 1,
    fuelHeatValueMultiplier,
    fertilizerNutritionMultiplier,
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
  if (node.kind === 'normal') {
    if (isCauldronMachineId(node.recipe.machineId)) return `cauldron:official:${node.recipeId}:${pathKey}`;
    return `normal:${node.recipeId}`;
  }
  if (node.kind === 'cauldron') return `cauldron:phase1:${machineId}:${node.itemId}:${node.candidate.inputItemIds.join('+')}:${pathKey}`;
  return `source:${node.sourceKind}:${node.itemId}`;
}

function isStartupSourceNode(node: CauldronPlanNode): boolean {
  return node.kind === 'source' && node.sourceKind === 'startup';
}

function addRate(target: Record<string, number>, itemId: string, rate: number): void {
  if (!Number.isFinite(rate) || rate === 0) return;
  target[itemId] = (target[itemId] ?? 0) + rate;
}

function addRates(target: Record<string, number>, source: Record<string, number>): void {
  for (const [itemId, rate] of Object.entries(source)) addRate(target, itemId, rate);
}

function makeRecipeStat(
  node: Extract<CauldronPlanNode, { kind: 'normal' | 'cauldron' }>,
  recipeId: string,
  machineId: CauldronMachineId,
  productionSpeedMultiplier: number,
  heatConsumptionMultiplier: number,
): RecipeStat {
  const resolvedMachineId = node.kind === 'normal' ? node.recipe.machineId : machineId;
  const isCauldronMachine = isCauldronMachineId(resolvedMachineId);
  const inputRates: Record<string, number> = {};
  for (const child of node.children) {
    if (isStartupSourceNode(child.node)) continue;
    addRate(inputRates, child.itemId, child.amount);
  }

  const outputRates: Record<string, number> = {};
  if (node.kind === 'normal') {
    for (const output of node.recipe.outputs) {
      addRate(outputRates, output.itemId, output.amount * (output.probability ?? 1) * node.runsPerMinute);
    }
  } else {
    addRate(outputRates, node.itemId, node.amount);
  }

  const cauldronTarget = isCauldronMachine ? CAULDRON_TARGETS[node.itemId] : undefined;
  const officialCauldronInputTuple = node.kind === 'normal' && isCauldronMachine ? cauldronInputTupleFromRecipe(node.recipe) : undefined;
  const cauldronInputTuple = node.kind === 'cauldron' ? node.candidate.inputItemIds : officialCauldronInputTuple;
  const cauldronRaw = node.kind === 'cauldron'
    ? node.candidate.rawScore
    : cauldronInputTuple
      ? cauldronRawScore(cauldronInputTuple)
      : undefined;
  const cauldronDuplicatePenalty = node.kind === 'cauldron'
    ? node.candidate.duplicatePenalty
    : cauldronInputTuple
      ? duplicatePenaltyForCauldronInput(cauldronInputTuple)
      : undefined;
  const cauldronAdjusted = node.kind === 'cauldron'
    ? node.candidate.adjustedScore
    : cauldronInputTuple
      ? cauldronAdjustedScore(cauldronInputTuple)
      : undefined;
  const cauldronStats = cauldronTarget
    ? calcEffectiveCauldronStats(cauldronTarget.targetValue, productionSpeedMultiplier, heatConsumptionMultiplier)
    : undefined;

  const outputRate = isCauldronMachine && cauldronStats
    ? cauldronStats.outputPerMin
    : node.kind === 'normal'
      ? recipeOutputRate(node.recipe, node.itemId) * productionSpeedMultiplier
      : 1;
  const runsPerMinute = node.kind === 'normal' ? node.runsPerMinute : node.amount;
  const actualMachines = outputRate > 0 ? node.amount / outputRate : node.amount;
  const surplusOutputRates: Record<string, number> = {};

  return {
    recipeId,
    machineId: resolvedMachineId,
    displayName: node.kind === 'normal' ? node.recipe.name : itemName(node.itemId),
    theoreticalMachines: actualMachines,
    actualMachines,
    runsPerMinute,
    positiveNetProductionRate: node.amount,
    perMachineProductionRate: outputRate || 1,
    inputRates,
    outputRates,
    netRates: { ...outputRates },
    surplusOutputRates,
    discardedOutputRates: {},
    targetIds: [node.itemId],
    cauldronTargetValue: cauldronTarget?.targetValue,
    cauldronInputRawScore: cauldronRaw,
    cauldronInputAdjustedScore: cauldronAdjusted,
    cauldronDuplicatePenalty,
    cauldronBaseTimeSec: cauldronStats?.baseTimeSec,
    cauldronBaseHeatPerSec: cauldronStats?.baseHeatPerSec,
    cauldronEffectiveTimeSec: cauldronStats?.effectiveTimeSec,
    cauldronEffectiveHeatPerSec: cauldronStats?.effectiveHeatPerSec,
    cauldronOutputPerMin: cauldronStats?.outputPerMin,
    cauldronHeatPerMinPerMachine: cauldronStats?.heatPerMinPerMachine,
    factorySpeedMultiplier: productionSpeedMultiplier,
    heatConsumptionMultiplier,
  };
}

function mergeRecipeStat(existing: RecipeStat, addition: RecipeStat): void {
  existing.theoreticalMachines += addition.theoreticalMachines;
  existing.actualMachines += addition.actualMachines;
  existing.runsPerMinute += addition.runsPerMinute;
  existing.positiveNetProductionRate += addition.positiveNetProductionRate;
  addRates(existing.inputRates, addition.inputRates);
  addRates(existing.outputRates, addition.outputRates);
  addRates(existing.netRates, addition.netRates);
  addRates(existing.surplusOutputRates, addition.surplusOutputRates);
  addRates(existing.discardedOutputRates, addition.discardedOutputRates);
  existing.targetIds = Array.from(new Set([...existing.targetIds, ...addition.targetIds]));
  existing.cauldronTargetValue ??= addition.cauldronTargetValue;
  existing.cauldronInputRawScore ??= addition.cauldronInputRawScore;
  existing.cauldronInputAdjustedScore ??= addition.cauldronInputAdjustedScore;
  existing.cauldronDuplicatePenalty ??= addition.cauldronDuplicatePenalty;
  existing.cauldronBaseTimeSec ??= addition.cauldronBaseTimeSec;
  existing.cauldronBaseHeatPerSec ??= addition.cauldronBaseHeatPerSec;
  existing.cauldronEffectiveTimeSec ??= addition.cauldronEffectiveTimeSec;
  existing.cauldronEffectiveHeatPerSec ??= addition.cauldronEffectiveHeatPerSec;
  existing.cauldronOutputPerMin ??= addition.cauldronOutputPerMin;
  existing.cauldronHeatPerMinPerMachine ??= addition.cauldronHeatPerMinPerMachine;
  existing.heatConsumptionMultiplier ??= addition.heatConsumptionMultiplier;
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

function recipeHeatRequiredPerMin(recipe: Recipe, runsPerMinute: number, heatConsumptionMultiplier: number): number {
  const heatPerSecond = (HEAT_CONSUMER_BY_MACHINE_ID[recipe.machineId]?.heatPerSec ?? 0) + (recipe.heatInputPerSec ?? 0);
  if (!Number.isFinite(heatPerSecond) || heatPerSecond <= 0 || runsPerMinute <= 0 || recipe.timeSec <= 0) return 0;
  return heatPerSecond * heatConsumptionMultiplier * recipe.timeSec * runsPerMinute;
}

function cauldronStatsForNode(node: Extract<CauldronPlanNode, { kind: 'cauldron' }>, productionSpeedMultiplier: number, heatConsumptionMultiplier: number) {
  const target = CAULDRON_TARGETS[node.itemId];
  return calcEffectiveCauldronStats(target?.targetValue ?? node.candidate.targetValue ?? 1, productionSpeedMultiplier, heatConsumptionMultiplier);
}

function cauldronHeatRequiredPerMinForTarget(itemId: string, amount: number, productionSpeedMultiplier: number, heatConsumptionMultiplier: number): number {
  if (amount <= 0) return 0;
  const stats = cauldronStatsForTargetItem(itemId, productionSpeedMultiplier, heatConsumptionMultiplier);
  if (!stats) return 0;
  const machineCount = stats.outputPerMin > 0 ? amount / stats.outputPerMin : amount;
  return stats.heatPerMinPerMachine * machineCount;
}

function cauldronHeatRequiredPerMin(node: Extract<CauldronPlanNode, { kind: 'cauldron' }>, productionSpeedMultiplier: number, heatConsumptionMultiplier: number): number {
  return cauldronHeatRequiredPerMinForTarget(node.itemId, node.amount, productionSpeedMultiplier, heatConsumptionMultiplier);
}

function collectPlannerTotals(node: CauldronPlanNode, settings: AppSettings, abilities: AbilitySettings): PlannerTotals {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(abilities);
  const heatConsumptionMultiplier = getHeatConsumptionMultiplier(abilities);
  const fuelHeatValueMultiplier = getFuelHeatValueMultiplier(abilities);
  const fertilizerNutritionMultiplier = getFertilizerNutritionMultiplier(abilities);
  const totals: PlannerTotals = {
    initialCostCopper: 0,
    purchaseCostCopperPerMin: 0,
    heatRequiredPerMin: 0,
    fuelRequiredPerMin: 0,
    fertilizerNutrientsRequiredPerMin: 0,
    fertilizerRequiredPerMin: 0,
  };

  const seenStartupItems = new Set<string>();

  function addFromNode(current: CauldronPlanNode): void {
    if (current.kind === 'source') {
      const price = itemById[current.itemId]?.buyPriceCopper ?? 0;
      if (current.sourceKind === 'startup' && !seenStartupItems.has(current.itemId)) {
        seenStartupItems.add(current.itemId);
        totals.initialCostCopper += price * current.amount;
      }
      if (current.sourceKind === 'purchase') totals.purchaseCostCopperPerMin += price * current.amount;
      return;
    }

    if (current.kind === 'normal') {
      if (isCauldronMachineId(current.recipe.machineId)) {
        totals.heatRequiredPerMin += cauldronHeatRequiredPerMinForTarget(current.itemId, current.amount, productionSpeedMultiplier, heatConsumptionMultiplier);
      } else {
        totals.heatRequiredPerMin += recipeHeatRequiredPerMin(current.recipe, current.runsPerMinute, heatConsumptionMultiplier);
      }
      const nutrients = Math.max(0, current.recipe.nutrientInputPerRun ?? 0) * current.runsPerMinute;
      if (Number.isFinite(nutrients) && nutrients > 0) totals.fertilizerNutrientsRequiredPerMin += nutrients;
    } else {
      totals.heatRequiredPerMin += cauldronHeatRequiredPerMin(current, productionSpeedMultiplier, heatConsumptionMultiplier);
    }

    for (const child of current.children) addFromNode(child.node);
  }

  addFromNode(node);

  const fuelHeatValue = (FUEL_HEAT_VALUE_BY_ITEM_ID[settings.fuel.fuelItemId] ?? 0) * fuelHeatValueMultiplier;
  if (fuelHeatValue > 0) totals.fuelRequiredPerMin = totals.heatRequiredPerMin / fuelHeatValue;

  const fertilizerValue = (FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[settings.fertilizer.fertilizerItemId] ?? 0) * fertilizerNutritionMultiplier;
  if (fertilizerValue > 0) totals.fertilizerRequiredPerMin = totals.fertilizerNutrientsRequiredPerMin / fertilizerValue;

  return totals;
}

function buildCalculationResult(root: CauldronPlanNode, settings: AppSettings, abilities: AbilitySettings, machineId: CauldronMachineId, ok: boolean, failures: CauldronPlannerFailure[]): CalculationResult {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(abilities);
  const heatConsumptionMultiplier = getHeatConsumptionMultiplier(abilities);
  const itemStats: Record<string, ItemStat> = {};
  const recipeStats: Record<string, RecipeStat> = {};
  const flows: CalculatedFlow[] = [];
  const seenInitialItems = new Set<string>();

  function addOrMergeFlow(flow: CalculatedFlow): void {
    if (flow.displayRateLabel || flow.role === 'finalOutput' || flow.role === 'surplus' || flow.role === 'discard') {
      flows.push(flow);
      return;
    }
    const key = JSON.stringify({ from: flow.from, to: flow.to, itemId: flow.itemId, role: flow.role, transportKind: flow.transportKind });
    const existing = flows.find((candidate) => {
      if (candidate.displayRateLabel || candidate.role === 'finalOutput' || candidate.role === 'surplus' || candidate.role === 'discard') return false;
      const candidateKey = JSON.stringify({ from: candidate.from, to: candidate.to, itemId: candidate.itemId, role: candidate.role, transportKind: candidate.transportKind });
      return candidateKey === key;
    });
    if (!existing) {
      flows.push(flow);
      return;
    }
    existing.rate += flow.rate;
    const transport = flowTransportForItem(existing.itemId, existing.rate, 60);
    existing.belts = transport.belts;
    existing.transportKind = transport.transportKind;
    existing.transportUnits = transport.transportUnits;
  }

  function addRecipeOccurrence(node: Extract<CauldronPlanNode, { kind: 'normal' | 'cauldron' }>, recipeId: string): void {
    const addition = makeRecipeStat(node, recipeId, machineId, productionSpeedMultiplier, heatConsumptionMultiplier);
    if (recipeStats[recipeId]) mergeRecipeStat(recipeStats[recipeId], addition);
    else recipeStats[recipeId] = addition;
  }

  function addSurplusFlow(recipeId: string, itemId: string, rate: number): void {
    if (rate <= 0) return;
    const transport = flowTransportForItem(itemId, rate, 60);
    flows.push({
      id: `cauldron-planner:${recipeId}:surplus:${itemId}:${flows.length}`,
      from: { type: 'recipe', recipeId },
      to: { type: 'itemSink', itemId, sinkMode: 'surplus' },
      itemId,
      rate,
      belts: transport.belts,
      transportKind: transport.transportKind,
      transportUnits: transport.transportUnits,
      role: 'surplus',
    });
  }

  function rebuildProducedAndSurplusFromRecipeStats(): void {
    for (const stat of Object.values(itemStats)) {
      stat.produced = 0;
      stat.surplus = 0;
    }

    for (const recipeStat of Object.values(recipeStats)) {
      recipeStat.surplusOutputRates = {};
      for (const [itemId, rate] of Object.entries(recipeStat.outputRates)) {
        addItemStat(itemStats, itemId).produced += rate;
      }
    }

    for (const stat of Object.values(itemStats)) {
      const surplus = Math.max(0, (stat.produced ?? 0) - (stat.consumed ?? 0) - (stat.targetActual ?? 0));
      if (surplus <= 1e-6) continue;
      stat.surplus = surplus;
      let remaining = surplus;
      for (const [recipeId, recipeStat] of Object.entries(recipeStats)) {
        const outputRate = recipeStat.outputRates[stat.itemId] ?? 0;
        if (outputRate <= 0 || remaining <= 1e-6) continue;
        const flowRate = Math.min(outputRate, remaining);
        addRate(recipeStat.surplusOutputRates, stat.itemId, flowRate);
        addSurplusFlow(recipeId, stat.itemId, flowRate);
        remaining -= flowRate;
      }
    }
  }

  function visit(node: CauldronPlanNode, parentRecipeId?: string, parentSlotIndex?: number, pathKey = 'root'): string | undefined {
    if (node.kind === 'source') {
      const stat = addItemStat(itemStats, node.itemId);
      const price = itemById[node.itemId]?.buyPriceCopper ?? 0;
      if (node.sourceKind === 'startup') {
        if (!seenInitialItems.has(node.itemId)) {
          seenInitialItems.add(node.itemId);
          stat.initialPurchased += node.amount;
          stat.initialCostCopper += price * node.amount;
        }
        return undefined;
      }
      if (node.sourceKind === 'purchase') {
        stat.purchased += node.amount;
        stat.purchaseCostCopperPerMin += price * node.amount;
      }
      if (parentRecipeId) {
        addOrMergeFlow(makeFlow(
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

    const recipeId = recipeIdForNode(node, pathKey, machineId);
    if (node.kind === 'normal') {
      const existing = recipeStats[recipeId];
      if (existing && !existing.targetIds.includes(node.itemId)) {
        existing.targetIds = Array.from(new Set([...existing.targetIds, node.itemId]));
        return recipeId;
      }
    }
    addRecipeOccurrence(node, recipeId);
    const produced = addItemStat(itemStats, node.itemId);
    produced.produced += node.amount;
    if (!parentRecipeId) {
      produced.targetRequested += node.amount;
      produced.targetActual += node.amount;
    }

    node.children.forEach((child, childIndex) => {
      if (isStartupSourceNode(child.node)) {
        visit(child.node, recipeId, child.slotIndex, `${pathKey}.${childIndex}`);
        return;
      }
      const consumed = addItemStat(itemStats, child.itemId);
      consumed.consumed += child.amount;
      const childRecipeId = visit(child.node, recipeId, child.slotIndex, `${pathKey}.${childIndex}`);
      if (child.node.kind !== 'source') {
        addOrMergeFlow(makeFlow(`cauldron-planner:${recipeId}:slot${child.slotIndex ?? childIndex}:${child.itemId}:${flows.length}`, childRecipeId, recipeId, child.itemId, child.amount, child.slotIndex));
      }
    });


    if (parentRecipeId) return recipeId;
    addOrMergeFlow({
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
  rebuildProducedAndSurplusFromRecipeStats();

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
    totals: emptyTotals(settings, abilities, collectPlannerTotals(root, settings, abilities)),
  };
}


type SupportProductionProfile = {
  role: 'fuel' | 'fertilizer';
  itemId: string;
  result: CalculationResult;
  sourceEndpoint: CalculatedFlow['from'];
  heatPerItemPerMin: number;
  fertilizerNutrientsPerItemPerMin: number;
  unresolvedItemIds: string[];
};

type SupportClosureSolution = {
  finite: boolean;
  fuelFinite: boolean;
  fertilizerFinite: boolean;
  fuelClosed: boolean;
  fertilizerClosed: boolean;
  mode: 'none' | 'fuel-only' | 'fertilizer-only' | 'direct-2x2';
  fuelSourceMode: ExternalSourceMode;
  fertilizerSourceMode: ExternalSourceMode;
  fuelItemId: string;
  fertilizerItemId: string;
  selectedFuelItemId: string;
  selectedFertilizerItemId: string;
  fuelRequiredPerMin: number;
  fertilizerRequiredPerMin: number;
  fuelSuppliedPerMin: number;
  fertilizerSuppliedPerMin: number;
  fuelHeatValue: number;
  fertilizerNutritionValue: number;
  baseHeatRequiredPerMin: number;
  baseFertilizerNutrientsRequiredPerMin: number;
  fuelProductionHeatPerMinPerItem: number;
  fuelProductionNutrientsPerMinPerItem: number;
  fertilizerProductionHeatPerMinPerItem: number;
  fertilizerProductionNutrientsPerMinPerItem: number;
  candidatesTried: number;
  determinant?: number;
};

type SupportClosureApplication = {
  solution: SupportClosureSolution;
  fuelProfile?: SupportProductionProfile;
  fertilizerProfile?: SupportProductionProfile;
  fuelBaseReuseRank?: number;
  fertilizerBaseReuseRank?: number;
};

function plannerRecipeBaseRecipeId(plannerRecipeId: string): string | undefined {
  if (plannerRecipeId.startsWith('normal:')) return plannerRecipeId.split(':')[1];
  if (plannerRecipeId.startsWith('cauldron:official:')) return plannerRecipeId.split(':')[2];
  return undefined;
}

function recipeStatHeatRequiredPerMin(stat: RecipeStat): number {
  if (isCauldronMachineId(stat.machineId)) {
    const heatPerMinPerMachine = Number(stat.cauldronHeatPerMinPerMachine ?? 0);
    return heatPerMinPerMachine > 0 ? heatPerMinPerMachine * Math.max(0, Number(stat.actualMachines) || 0) : 0;
  }
  const baseRecipeId = plannerRecipeBaseRecipeId(stat.recipeId);
  const recipe = baseRecipeId ? recipeById[baseRecipeId] : undefined;
  if (!recipe) return 0;
  const heatPerSecond = (HEAT_CONSUMER_BY_MACHINE_ID[recipe.machineId]?.heatPerSec ?? 0) + (recipe.heatInputPerSec ?? 0);
  if (!Number.isFinite(heatPerSecond) || heatPerSecond <= 0) return 0;
  return heatPerSecond * (stat.heatConsumptionMultiplier ?? 1) * recipe.timeSec * Math.max(0, stat.runsPerMinute || 0);
}

function recipeStatFertilizerNutrientsRequiredPerMin(stat: RecipeStat): number {
  const baseRecipeId = plannerRecipeBaseRecipeId(stat.recipeId);
  const recipe = baseRecipeId ? recipeById[baseRecipeId] : undefined;
  if (!recipe) return 0;
  const nutrients = Math.max(0, Number(recipe.nutrientInputPerRun ?? 0)) * Math.max(0, Number(stat.runsPerMinute) || 0);
  return Number.isFinite(nutrients) ? nutrients : 0;
}

function scaleNumberRecord(source: Record<string, number>, multiplier: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) out[key] = value * multiplier;
  return out;
}

function mergeItemStat(target: ItemStat, addition: ItemStat): void {
  target.requested += addition.requested;
  target.consumed += addition.consumed;
  target.produced += addition.produced;
  target.purchased += addition.purchased;
  target.initialPurchased += addition.initialPurchased;
  target.reused += addition.reused;
  target.surplus += addition.surplus;
  target.discarded += addition.discarded;
  target.targetRequested += addition.targetRequested;
  target.targetActual += addition.targetActual;
  target.purchaseCostCopperPerMin += addition.purchaseCostCopperPerMin;
  target.initialCostCopper += addition.initialCostCopper;
  target.revenueCopperPerMin += addition.revenueCopperPerMin;
}

function scaledItemStat(stat: ItemStat, multiplier: number): ItemStat {
  return {
    itemId: stat.itemId,
    requested: stat.requested * multiplier,
    consumed: stat.consumed * multiplier,
    produced: stat.produced * multiplier,
    purchased: stat.purchased * multiplier,
    initialPurchased: stat.initialPurchased * multiplier,
    reused: stat.reused * multiplier,
    surplus: stat.surplus * multiplier,
    discarded: stat.discarded * multiplier,
    targetRequested: 0,
    targetActual: 0,
    purchaseCostCopperPerMin: stat.purchaseCostCopperPerMin * multiplier,
    initialCostCopper: stat.initialCostCopper * multiplier,
    revenueCopperPerMin: stat.revenueCopperPerMin * multiplier,
  };
}

function scaledRecipeStat(stat: RecipeStat, multiplier: number): RecipeStat {
  return {
    ...stat,
    theoreticalMachines: stat.theoreticalMachines * multiplier,
    actualMachines: stat.actualMachines * multiplier,
    runsPerMinute: stat.runsPerMinute * multiplier,
    positiveNetProductionRate: stat.positiveNetProductionRate * multiplier,
    inputRates: scaleNumberRecord(stat.inputRates, multiplier),
    outputRates: scaleNumberRecord(stat.outputRates, multiplier),
    netRates: scaleNumberRecord(stat.netRates, multiplier),
    surplusOutputRates: scaleNumberRecord(stat.surplusOutputRates, multiplier),
    discardedOutputRates: scaleNumberRecord(stat.discardedOutputRates, multiplier),
  };
}

function scaledFlow(flow: CalculatedFlow, multiplier: number, prefix: string): CalculatedFlow {
  const rate = flow.rate * multiplier;
  const transport = flowTransportForItem(flow.itemId, rate, 60);
  return {
    ...flow,
    id: `${prefix}:${flow.id}`,
    rate,
    belts: transport.belts,
    transportKind: transport.transportKind,
    transportUnits: transport.transportUnits,
  };
}

function endpointKey(endpoint: CalculatedFlow['from'] | CalculatedFlow['to']): string {
  return JSON.stringify(endpoint);
}

function mergeOrPushFlow(result: CalculationResult, flow: CalculatedFlow): void {
  const existing = result.flows.find((current) => (
    current.itemId === flow.itemId
    && current.role === flow.role
    && current.displayRateLabel === flow.displayRateLabel
    && endpointKey(current.from) === endpointKey(flow.from)
    && endpointKey(current.to) === endpointKey(flow.to)
  ));
  if (!existing) {
    result.flows.push(flow);
    return;
  }
  existing.rate += flow.rate;
  const transport = flowTransportForItem(existing.itemId, existing.rate, 60);
  existing.belts = transport.belts;
  existing.transportKind = transport.transportKind;
  existing.transportUnits = transport.transportUnits;
}

function addRoleFlow(result: CalculationResult, role: 'fuel' | 'fertilizer', sourceEndpoint: CalculatedFlow['from'], recipeId: string, itemId: string, rate: number, flowIndex: number): void {
  if (!Number.isFinite(rate) || rate <= OBJECTIVE_EPS) return;
  const transport = flowTransportForItem(itemId, rate, 60);
  result.flows.push({
    id: `cauldron-support:${role}:${recipeId}:${itemId}:${flowIndex}`,
    from: sourceEndpoint,
    to: { type: 'recipe', recipeId },
    itemId,
    rate,
    belts: transport.belts,
    transportKind: transport.transportKind,
    transportUnits: transport.transportUnits,
    role,
  });
  addItemStat(result.itemStats, itemId).consumed += rate;
}

function mergeSupportProfileResult(result: CalculationResult, profile: SupportProductionProfile, multiplier: number): CalculatedFlow['from'] {
  const prefix = `support-${profile.role}-${profile.itemId}`;
  let sourceEndpoint = profile.sourceEndpoint;
  for (const stat of Object.values(profile.result.itemStats)) {
    const scaled = scaledItemStat(stat, multiplier);
    mergeItemStat(addItemStat(result.itemStats, scaled.itemId), scaled);
  }
  for (const [recipeId, stat] of Object.entries(profile.result.recipeStats)) {
    const scaled = scaledRecipeStat(stat, multiplier);
    if (result.recipeStats[recipeId]) mergeRecipeStat(result.recipeStats[recipeId], scaled);
    else result.recipeStats[recipeId] = scaled;
  }
  for (const flow of profile.result.flows) {
    if (flow.role === 'finalOutput' && flow.itemId === profile.itemId) {
      sourceEndpoint = flow.from;
      continue;
    }
    mergeOrPushFlow(result, scaledFlow(flow, multiplier, prefix));
  }
  return sourceEndpoint;
}

function supportEndpointFromProfileResult(result: CalculationResult, itemId: string): CalculatedFlow['from'] {
  const finalFlow = result.flows.find((flow) => flow.role === 'finalOutput' && flow.itemId === itemId);
  if (finalFlow) return finalFlow.from;
  const stat = result.itemStats[itemId];
  if ((stat?.purchased ?? 0) > OBJECTIVE_EPS) return { type: 'itemSource', itemId, sourceMode: 'buy' };
  return { type: 'itemSource', itemId, sourceMode: 'unresolved' };
}

function buildSupportProductionProfile(
  role: 'fuel' | 'fertilizer',
  itemId: string,
  settings: AppSettings,
  abilities: AbilitySettings,
  machineId: CauldronMachineId,
  recipePreferences: Record<string, string>,
): SupportProductionProfile | undefined {
  if (!itemId) return undefined;
  const resolved = resolveOutputItem(itemId, 1, CAULDRON_PLANNER_POLICY, recipePreferences, MAX_DEPTH, new Set(), new Map());
  if (!resolved.node) return undefined;
  const result = buildCalculationResult(resolved.node, settings, abilities, machineId, resolved.ok, resolved.failures);
  return {
    role,
    itemId,
    result,
    sourceEndpoint: supportEndpointFromProfileResult(result, itemId),
    heatPerItemPerMin: Number(result.totals.heatRequiredPerMin ?? 0),
    fertilizerNutrientsPerItemPerMin: Number(result.totals.fertilizerNutrientsRequiredPerMin ?? 0),
    unresolvedItemIds: Object.values(result.itemStats).filter((stat) => (stat.requested > 0 || stat.consumed > 0) && stat.produced <= OBJECTIVE_EPS && stat.purchased <= OBJECTIVE_EPS).map((stat) => stat.itemId),
  };
}

function uniqueSupportItemIds(primaryItemId: string, candidates: string[]): string[] {
  const out: string[] = [];
  if (primaryItemId) out.push(primaryItemId);
  for (const itemId of candidates) {
    if (!out.includes(itemId)) out.push(itemId);
  }
  return out;
}

function supportSourceModeForRole(role: 'fuel' | 'fertilizer', settings: AppSettings, override?: ExternalSourceMode): ExternalSourceMode {
  if (override === 'internal' || override === 'external') return override;
  const configured = role === 'fuel' ? settings.fuel?.sourceMode : settings.fertilizer?.sourceMode;
  return configured === 'external' ? 'external' : 'internal';
}

function evaluateSupportPair(input: {
  baseHeat: number;
  baseNutrients: number;
  fuelItemId: string;
  fertilizerItemId: string;
  fuelSourceMode: ExternalSourceMode;
  fertilizerSourceMode: ExternalSourceMode;
  fuelHeatValue: number;
  fertilizerNutritionValue: number;
  fuelProfile?: SupportProductionProfile;
  fertilizerProfile?: SupportProductionProfile;
}): SupportClosureSolution {
  const hf = input.fuelSourceMode === 'internal' ? (input.fuelProfile?.heatPerItemPerMin ?? 0) : 0;
  const nf = input.fuelSourceMode === 'internal' ? (input.fuelProfile?.fertilizerNutrientsPerItemPerMin ?? 0) : 0;
  const hg = input.fertilizerSourceMode === 'internal' ? (input.fertilizerProfile?.heatPerItemPerMin ?? 0) : 0;
  const ng = input.fertilizerSourceMode === 'internal' ? (input.fertilizerProfile?.fertilizerNutrientsPerItemPerMin ?? 0) : 0;

  const fuelEnabled = Boolean(input.fuelItemId && input.fuelHeatValue > OBJECTIVE_EPS);
  const fertilizerEnabled = Boolean(input.fertilizerItemId && input.fertilizerNutritionValue > OBJECTIVE_EPS);
  let finite = true;
  let fuelFinite = true;
  let fertilizerFinite = true;
  let mode: SupportClosureSolution['mode'] = 'none';
  let determinant: number | undefined;
  let fuelRequiredPerMin = 0;
  let fertilizerRequiredPerMin = 0;

  if (!fuelEnabled && input.baseHeat > OBJECTIVE_EPS) {
    finite = false;
    fuelFinite = false;
  }
  if (!fertilizerEnabled && input.baseNutrients > OBJECTIVE_EPS) {
    finite = false;
    fertilizerFinite = false;
  }
  if (input.fuelSourceMode === 'internal' && fuelEnabled && !input.fuelProfile) {
    finite = false;
    fuelFinite = false;
  }
  if (input.fertilizerSourceMode === 'internal' && fertilizerEnabled && !input.fertilizerProfile) {
    finite = false;
    fertilizerFinite = false;
  }

  if (finite && fuelEnabled && fertilizerEnabled && (input.baseHeat > OBJECTIVE_EPS || input.baseNutrients > OBJECTIVE_EPS || hf > OBJECTIVE_EPS || nf > OBJECTIVE_EPS || hg > OBJECTIVE_EPS || ng > OBJECTIVE_EPS)) {
    mode = 'direct-2x2';
    const a11 = 1 - hf / input.fuelHeatValue;
    const a12 = -hg / input.fuelHeatValue;
    const a21 = -nf / input.fertilizerNutritionValue;
    const a22 = 1 - ng / input.fertilizerNutritionValue;
    const b1 = input.baseHeat / input.fuelHeatValue;
    const b2 = input.baseNutrients / input.fertilizerNutritionValue;
    determinant = a11 * a22 - a12 * a21;
    if (Math.abs(determinant) <= 1e-12) {
      finite = false;
      fuelFinite = false;
      fertilizerFinite = false;
    } else {
      fuelRequiredPerMin = (b1 * a22 - a12 * b2) / determinant;
      fertilizerRequiredPerMin = (a11 * b2 - b1 * a21) / determinant;
    }
  } else if (finite && fuelEnabled && input.baseHeat > OBJECTIVE_EPS) {
    mode = 'fuel-only';
    const denominator = input.fuelHeatValue - hf;
    if (denominator <= OBJECTIVE_EPS) {
      finite = false;
      fuelFinite = false;
    } else fuelRequiredPerMin = input.baseHeat / denominator;
  } else if (finite && fertilizerEnabled && input.baseNutrients > OBJECTIVE_EPS) {
    mode = 'fertilizer-only';
    const denominator = input.fertilizerNutritionValue - ng;
    if (denominator <= OBJECTIVE_EPS) {
      finite = false;
      fertilizerFinite = false;
    } else fertilizerRequiredPerMin = input.baseNutrients / denominator;
  }

  if (!Number.isFinite(fuelRequiredPerMin) || fuelRequiredPerMin < -OBJECTIVE_EPS) {
    finite = false;
    fuelFinite = false;
  }
  if (!Number.isFinite(fertilizerRequiredPerMin) || fertilizerRequiredPerMin < -OBJECTIVE_EPS) {
    finite = false;
    fertilizerFinite = false;
  }

  if (!finite) {
    fuelRequiredPerMin = Math.max(0, input.baseHeat / Math.max(OBJECTIVE_EPS, input.fuelHeatValue));
    fertilizerRequiredPerMin = Math.max(0, input.baseNutrients / Math.max(OBJECTIVE_EPS, input.fertilizerNutritionValue));
  } else {
    fuelRequiredPerMin = Math.max(0, fuelRequiredPerMin);
    fertilizerRequiredPerMin = Math.max(0, fertilizerRequiredPerMin);
  }

  const fuelClosed = fuelFinite && (fuelRequiredPerMin <= OBJECTIVE_EPS || input.fuelSourceMode === 'external' || Boolean(input.fuelProfile));
  const fertilizerClosed = fertilizerFinite && (fertilizerRequiredPerMin <= OBJECTIVE_EPS || input.fertilizerSourceMode === 'external' || Boolean(input.fertilizerProfile));

  return {
    finite,
    fuelFinite,
    fertilizerFinite,
    fuelClosed,
    fertilizerClosed,
    mode,
    fuelSourceMode: input.fuelSourceMode,
    fertilizerSourceMode: input.fertilizerSourceMode,
    fuelItemId: input.fuelItemId,
    fertilizerItemId: input.fertilizerItemId,
    selectedFuelItemId: input.fuelItemId,
    selectedFertilizerItemId: input.fertilizerItemId,
    fuelRequiredPerMin,
    fertilizerRequiredPerMin,
    fuelSuppliedPerMin: fuelClosed ? fuelRequiredPerMin : 0,
    fertilizerSuppliedPerMin: fertilizerClosed ? fertilizerRequiredPerMin : 0,
    fuelHeatValue: input.fuelHeatValue,
    fertilizerNutritionValue: input.fertilizerNutritionValue,
    baseHeatRequiredPerMin: input.baseHeat,
    baseFertilizerNutrientsRequiredPerMin: input.baseNutrients,
    fuelProductionHeatPerMinPerItem: hf,
    fuelProductionNutrientsPerMinPerItem: nf,
    fertilizerProductionHeatPerMinPerItem: hg,
    fertilizerProductionNutrientsPerMinPerItem: ng,
    candidatesTried: 1,
    determinant,
  };
}

function supportBaseReuseRank(base: CalculationResult, itemId: string): number {
  if (!itemId) return 9;
  const stat = base.itemStats[itemId];
  if (!stat) return 6;
  if ((stat.surplus ?? 0) > OBJECTIVE_EPS) return 0;
  if ((stat.targetActual ?? 0) > OBJECTIVE_EPS) return 1;
  if ((stat.produced ?? 0) > OBJECTIVE_EPS) return 2;
  if ((stat.reused ?? 0) > OBJECTIVE_EPS) return 3;
  return 6;
}

function supportProfileComplexity(profile?: SupportProductionProfile): number {
  if (!profile) return 9999;
  const recipeCount = Object.keys(profile.result.recipeStats).length;
  const unresolvedCount = profile.unresolvedItemIds.length;
  const purchaseCount = Object.values(profile.result.itemStats).filter((stat) => (stat.purchased ?? 0) > OBJECTIVE_EPS).length;
  return recipeCount + unresolvedCount * 100 + purchaseCount * 20;
}

function supportSolutionSortKey(application: SupportClosureApplication): number[] {
  const solution = application.solution;
  const fuelProfile = application.fuelProfile;
  const fertilizerProfile = application.fertilizerProfile;
  const fuelUnresolved = fuelProfile?.unresolvedItemIds.length ?? 0;
  const fertilizerUnresolved = fertilizerProfile?.unresolvedItemIds.length ?? 0;
  return [
    solution.fuelClosed ? 0 : 1,
    solution.fertilizerClosed ? 0 : 1,
    solution.finite ? 0 : 1,
    application.fuelBaseReuseRank ?? 6,
    application.fertilizerBaseReuseRank ?? 6,
    fuelUnresolved + fertilizerUnresolved,
    solution.fuelSourceMode === 'internal' ? 0 : 1,
    solution.fertilizerSourceMode === 'internal' ? 0 : 1,
    supportProfileComplexity(fuelProfile) + supportProfileComplexity(fertilizerProfile),
    solution.fuelRequiredPerMin + solution.fertilizerRequiredPerMin,
  ];
}

function compareSupportApplication(a: SupportClosureApplication | undefined, b: SupportClosureApplication): SupportClosureApplication {
  if (!a) return b;
  const ak = supportSolutionSortKey(a);
  const bk = supportSolutionSortKey(b);
  for (let i = 0; i < Math.max(ak.length, bk.length); i += 1) {
    const av = ak[i] ?? 0;
    const bv = bk[i] ?? 0;
    if (bv < av) return b;
    if (bv > av) return a;
  }
  return a;
}

function solveSupportClosure(
  base: CalculationResult,
  settings: AppSettings,
  abilities: AbilitySettings,
  machineId: CauldronMachineId,
  recipePreferences: Record<string, string>,
  sourceModes?: { fuelSourceMode?: ExternalSourceMode; fertilizerSourceMode?: ExternalSourceMode },
): SupportClosureApplication {
  const fuelSourceMode = supportSourceModeForRole('fuel', settings, sourceModes?.fuelSourceMode);
  const fertilizerSourceMode = supportSourceModeForRole('fertilizer', settings, sourceModes?.fertilizerSourceMode);
  const fuelEnabled = Boolean(settings.fuel?.enabled);
  const fertilizerEnabled = Boolean(settings.fertilizer?.enabled);
  const fuelCandidates = fuelEnabled ? uniqueSupportItemIds(settings.fuel?.fuelItemId ?? '', FUEL_ITEM_IDS) : [''];
  const fertilizerCandidates = fertilizerEnabled ? uniqueSupportItemIds(settings.fertilizer?.fertilizerItemId ?? '', FERTILIZER_ITEM_IDS) : [''];
  const baseHeat = fuelEnabled ? Number(base.totals.heatRequiredPerMin ?? 0) : 0;
  const baseNutrients = fertilizerEnabled ? Number(base.totals.fertilizerNutrientsRequiredPerMin ?? 0) : 0;
  const fuelHeatMultiplier = getFuelHeatValueMultiplier(abilities);
  const fertilizerMultiplier = getFertilizerNutritionMultiplier(abilities);
  const fuelProfiles = new Map<string, SupportProductionProfile | undefined>();
  const fertilizerProfiles = new Map<string, SupportProductionProfile | undefined>();

  let best: SupportClosureApplication | undefined;
  let candidatesTried = 0;
  for (const fuelItemId of fuelCandidates) {
    const fuelHeatValue = fuelItemId ? (FUEL_HEAT_VALUE_BY_ITEM_ID[fuelItemId] ?? 0) * fuelHeatMultiplier : 0;
    if (fuelSourceMode === 'internal' && fuelItemId && !fuelProfiles.has(fuelItemId)) {
      fuelProfiles.set(fuelItemId, buildSupportProductionProfile('fuel', fuelItemId, settings, abilities, machineId, recipePreferences));
    }
    const fuelProfile = fuelSourceMode === 'internal' ? fuelProfiles.get(fuelItemId) : undefined;
    for (const fertilizerItemId of fertilizerCandidates) {
      const fertilizerNutritionValue = fertilizerItemId ? (FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerItemId] ?? 0) * fertilizerMultiplier : 0;
      if (fertilizerSourceMode === 'internal' && fertilizerItemId && !fertilizerProfiles.has(fertilizerItemId)) {
        fertilizerProfiles.set(fertilizerItemId, buildSupportProductionProfile('fertilizer', fertilizerItemId, settings, abilities, machineId, recipePreferences));
      }
      const fertilizerProfile = fertilizerSourceMode === 'internal' ? fertilizerProfiles.get(fertilizerItemId) : undefined;
      candidatesTried += 1;
      const solution = evaluateSupportPair({
        baseHeat,
        baseNutrients,
        fuelItemId,
        fertilizerItemId,
        fuelSourceMode,
        fertilizerSourceMode,
        fuelHeatValue,
        fertilizerNutritionValue,
        fuelProfile,
        fertilizerProfile,
      });
      solution.candidatesTried = candidatesTried;
      best = compareSupportApplication(best, {
        solution,
        fuelProfile,
        fertilizerProfile,
        fuelBaseReuseRank: supportBaseReuseRank(base, fuelItemId),
        fertilizerBaseReuseRank: supportBaseReuseRank(base, fertilizerItemId),
      });
    }
  }

  if (best) {
    best.solution.candidatesTried = candidatesTried;
    return best;
  }

  return {
    solution: {
      finite: true,
      fuelFinite: true,
      fertilizerFinite: true,
      fuelClosed: true,
      fertilizerClosed: true,
      mode: 'none',
      fuelSourceMode,
      fertilizerSourceMode,
      fuelItemId: '',
      fertilizerItemId: '',
      selectedFuelItemId: '',
      selectedFertilizerItemId: '',
      fuelRequiredPerMin: 0,
      fertilizerRequiredPerMin: 0,
      fuelSuppliedPerMin: 0,
      fertilizerSuppliedPerMin: 0,
      fuelHeatValue: 0,
      fertilizerNutritionValue: 0,
      baseHeatRequiredPerMin: baseHeat,
      baseFertilizerNutrientsRequiredPerMin: baseNutrients,
      fuelProductionHeatPerMinPerItem: 0,
      fuelProductionNutrientsPerMinPerItem: 0,
      fertilizerProductionHeatPerMinPerItem: 0,
      fertilizerProductionNutrientsPerMinPerItem: 0,
      candidatesTried,
    },
  };
}

function collectSupportDemandByRecipe(result: CalculationResult): { heatByRecipeId: Record<string, number>; nutrientsByRecipeId: Record<string, number>; totalHeat: number; totalNutrients: number } {
  const heatByRecipeId: Record<string, number> = {};
  const nutrientsByRecipeId: Record<string, number> = {};
  let totalHeat = 0;
  let totalNutrients = 0;
  for (const [recipeId, stat] of Object.entries(result.recipeStats)) {
    const heat = recipeStatHeatRequiredPerMin(stat);
    const nutrients = recipeStatFertilizerNutrientsRequiredPerMin(stat);
    if (heat > OBJECTIVE_EPS) {
      heatByRecipeId[recipeId] = heat;
      totalHeat += heat;
    }
    if (nutrients > OBJECTIVE_EPS) {
      nutrientsByRecipeId[recipeId] = nutrients;
      totalNutrients += nutrients;
    }
  }
  return { heatByRecipeId, nutrientsByRecipeId, totalHeat, totalNutrients };
}

function applySupportClosure(base: CalculationResult, application: SupportClosureApplication, settings: AppSettings): CalculationResult {
  const result: CalculationResult = {
    ...base,
    itemStats: { ...base.itemStats },
    recipeStats: { ...base.recipeStats },
    flows: [...base.flows],
    totals: { ...base.totals },
    warnings: [...base.warnings],
    errorSummaries: [...(base.errorSummaries ?? [])],
  };
  const solution = application.solution;
  let fuelSource: CalculatedFlow['from'] | undefined;
  let fertilizerSource: CalculatedFlow['from'] | undefined;

  if (solution.fuelClosed && solution.fuelRequiredPerMin > OBJECTIVE_EPS) {
    if (solution.fuelSourceMode === 'external') fuelSource = { type: 'itemSource', itemId: solution.fuelItemId, sourceMode: 'external' };
    else if (application.fuelProfile) fuelSource = mergeSupportProfileResult(result, application.fuelProfile, solution.fuelRequiredPerMin);
  }
  if (solution.fertilizerClosed && solution.fertilizerRequiredPerMin > OBJECTIVE_EPS) {
    if (solution.fertilizerSourceMode === 'external') fertilizerSource = { type: 'itemSource', itemId: solution.fertilizerItemId, sourceMode: 'external' };
    else if (application.fertilizerProfile) fertilizerSource = mergeSupportProfileResult(result, application.fertilizerProfile, solution.fertilizerRequiredPerMin);
  }

  const demand = collectSupportDemandByRecipe(result);
  if (solution.fuelClosed && fuelSource && solution.fuelRequiredPerMin > OBJECTIVE_EPS && demand.totalHeat > OBJECTIVE_EPS) {
    let i = 0;
    for (const [recipeId, heat] of Object.entries(demand.heatByRecipeId)) {
      addRoleFlow(result, 'fuel', fuelSource, recipeId, solution.fuelItemId, solution.fuelRequiredPerMin * (heat / demand.totalHeat), i++);
    }
  }
  if (solution.fertilizerClosed && fertilizerSource && solution.fertilizerRequiredPerMin > OBJECTIVE_EPS && demand.totalNutrients > OBJECTIVE_EPS) {
    let i = 0;
    for (const [recipeId, nutrients] of Object.entries(demand.nutrientsByRecipeId)) {
      addRoleFlow(result, 'fertilizer', fertilizerSource, recipeId, solution.fertilizerItemId, solution.fertilizerRequiredPerMin * (nutrients / demand.totalNutrients), i++);
    }
  }

  result.totals.heatRequiredPerMin = demand.totalHeat;
  result.totals.fertilizerNutrientsRequiredPerMin = demand.totalNutrients;
  result.totals.fuelRequiredPerMin = solution.fuelRequiredPerMin;
  result.totals.fertilizerRequiredPerMin = solution.fertilizerRequiredPerMin;
  result.totals.fuelItemId = solution.fuelItemId || result.totals.fuelItemId;
  result.totals.fertilizerItemId = solution.fertilizerItemId || result.totals.fertilizerItemId;
  return result;
}


function supportClosureObjectiveViolations(application: SupportClosureApplication): CauldronObjectiveViolation[] {
  const out: CauldronObjectiveViolation[] = [];
  const solution = application.solution;
  const hasDemand = solution.baseHeatRequiredPerMin > OBJECTIVE_EPS || solution.baseFertilizerNutrientsRequiredPerMin > OBJECTIVE_EPS;
  if (hasDemand && !solution.fuelFinite) {
    out.push(violation(
      'FUEL_SUPPORT_CLOSURE_NOT_FINITE',
      [solution.fuelItemId].filter(Boolean),
      '燃料の線形閉鎖が有限解になりませんでした。燃料の自己増幅または無効な熱量を確認してください。',
      'Linear fuel closure did not produce a finite solution. Check self-amplifying fuel demand or invalid heat value.',
      { details: { solution } },
    ));
  }
  if (hasDemand && !solution.fertilizerFinite) {
    out.push(violation(
      'FERTILIZER_SUPPORT_CLOSURE_NOT_FINITE',
      [solution.fertilizerItemId].filter(Boolean),
      '肥料の線形閉鎖が有限解になりませんでした。肥料の自己増幅または無効な栄養値を確認してください。',
      'Linear fertilizer closure did not produce a finite solution. Check self-amplifying fertilizer demand or invalid nutrient value.',
      { details: { solution } },
    ));
  }
  if (solution.fuelSourceMode === 'internal' && solution.fuelRequiredPerMin > OBJECTIVE_EPS && application.fuelProfile?.unresolvedItemIds.length) {
    out.push(violation(
      'FUEL_PROFILE_UNRESOLVED',
      application.fuelProfile.unresolvedItemIds,
      `燃料生産プロファイルに未解決入力があります: ${namesText(application.fuelProfile.unresolvedItemIds, 'ja')}`,
      `Fuel production profile has unresolved inputs: ${namesText(application.fuelProfile.unresolvedItemIds, 'en')}`,
      { details: { fuelItemId: solution.fuelItemId } },
    ));
  }
  if (solution.fertilizerSourceMode === 'internal' && solution.fertilizerRequiredPerMin > OBJECTIVE_EPS && application.fertilizerProfile?.unresolvedItemIds.length) {
    out.push(violation(
      'FERTILIZER_PROFILE_UNRESOLVED',
      application.fertilizerProfile.unresolvedItemIds,
      `肥料生産プロファイルに未解決入力があります: ${namesText(application.fertilizerProfile.unresolvedItemIds, 'ja')}`,
      `Fertilizer production profile has unresolved inputs: ${namesText(application.fertilizerProfile.unresolvedItemIds, 'en')}`,
      { details: { fertilizerItemId: solution.fertilizerItemId } },
    ));
  }
  return out;
}

function blockedResult(targetItemId: string, settings: AppSettings, abilities: AbilitySettings, failures: CauldronPlannerFailure[]): CalculationResult {
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
    totals: emptyTotals(settings, abilities),
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
    candidateCount: node.kind === 'cauldron' ? findCauldronCandidatesForOutput(node.itemId).length : undefined,
    selectedInputItemIds: node.kind === 'cauldron' ? [...node.candidate.inputItemIds] as [string, string, string] : undefined,
    children: node.children.filter((child) => !isStartupSourceNode(child.node)).map((child) => planItemFromNode(child.node)),
  };
}

function formatFailureCandidate(candidate: readonly [string, string, string] | undefined, lang: 'ja' | 'en'): string {
  if (!candidate) return '';
  const items = candidate.map((itemId) => itemName(itemId)[lang]).join(' + ');
  return lang === 'ja' ? `候補: ${items}` : `Candidate: ${items}`;
}

function failureDetailText(failure: CauldronPlannerFailure, lang: 'ja' | 'en', depth = 0): string {
  const indent = '  '.repeat(depth);
  const lines = [`${indent}${failure.message[lang]}`];
  const candidateLine = formatFailureCandidate(failure.candidate, lang);
  if (candidateLine) lines.push(`${indent}${candidateLine}`);
  for (const child of (failure.children ?? []).slice(0, 12)) {
    lines.push(failureDetailText(child, lang, depth + 1));
  }
  return lines.join('\n');
}

function collectFailureItemIds(failure: CauldronPlannerFailure, output = new Set<string>()): string[] {
  output.add(failure.itemId);
  for (const candidateItemId of failure.candidate ?? []) output.add(candidateItemId);
  for (const child of failure.children ?? []) collectFailureItemIds(child, output);
  return [...output];
}

function issueFromFailure(failure: CauldronPlannerFailure): CauldronOptimizedPlanIssue {
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
  let edges = node.children.filter((child) => !isStartupSourceNode(child.node)).length + 1;
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

const OBJECTIVE_EPS = 1e-6;

type ObjectiveSourceBuckets = {
  purchased: Set<string>;
  unresolved: Set<string>;
  plantDerivedInput: Set<string>;
};

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function namesText(itemIds: string[], lang: 'ja' | 'en'): string {
  return itemIds.map((itemId) => itemName(itemId)[lang]).join(lang === 'ja' ? '、' : ', ');
}

function collectSourceBuckets(node: CauldronPlanNode, buckets: ObjectiveSourceBuckets): void {
  if (node.kind === 'source') {
    if (node.sourceKind === 'purchase') buckets.purchased.add(node.itemId);
    if (node.sourceKind === 'unresolved') buckets.unresolved.add(node.itemId);
    if (node.sourceKind === 'plantDerivedInput') buckets.plantDerivedInput.add(node.itemId);
    return;
  }
  for (const child of node.children) collectSourceBuckets(child.node, buckets);
}

function canonicalRecipeKey(recipeId: string): string {
  if (recipeId.startsWith('normal:')) {
    const parts = recipeId.split(':');
    if (parts.length >= 2) return `normal:${parts[1]}`;
  }
  return recipeId;
}

function violation(
  code: CauldronObjectiveViolation['code'],
  itemIds: string[],
  messageJa: string,
  messageEn: string,
  options: { recipeIds?: string[]; details?: Record<string, unknown>; severity?: CauldronObjectiveViolation['severity'] } = {},
): CauldronObjectiveViolation {
  return {
    code,
    severity: options.severity ?? 'error',
    message: { ja: messageJa, en: messageEn },
    itemIds: uniqueSorted(itemIds),
    recipeIds: options.recipeIds ? uniqueSorted(options.recipeIds) : undefined,
    details: options.details,
  };
}


function flowRateByRole(result: CalculationResult, itemId: string, role: CalculatedFlow['role']): number {
  return result.flows
    .filter((flow) => flow.role === role && flow.itemId === itemId)
    .reduce((sum, flow) => sum + Math.max(0, Number(flow.rate) || 0), 0);
}

function formatRate(value: number): string {
  if (!Number.isFinite(value)) return '?';
  return String(Math.round(value * 10000) / 10000);
}

function collectObjectiveViolations(root: CauldronPlanNode, result: CalculationResult): CauldronObjectiveViolation[] {
  const violations: CauldronObjectiveViolation[] = [];
  const sourceBuckets: ObjectiveSourceBuckets = { purchased: new Set(), unresolved: new Set(), plantDerivedInput: new Set() };
  collectSourceBuckets(root, sourceBuckets);

  const purchased = uniqueSorted(sourceBuckets.purchased);
  if (purchased.length > 0) {
    violations.push(violation(
      'CONSTANT_PURCHASE',
      purchased,
      `常時購入が残っています: ${namesText(purchased, 'ja')}`,
      `Constant purchases remain: ${namesText(purchased, 'en')}`,
    ));
  }

  const unresolved = uniqueSorted(sourceBuckets.unresolved);
  if (unresolved.length > 0) {
    violations.push(violation(
      'UNRESOLVED_INPUT',
      unresolved,
      `未解決入力が残っています: ${namesText(unresolved, 'ja')}`,
      `Unresolved inputs remain: ${namesText(unresolved, 'en')}`,
    ));
  }

  const plantDerivedInput = uniqueSorted(sourceBuckets.plantDerivedInput);
  if (plantDerivedInput.length > 0) {
    violations.push(violation(
      'EXTERNAL_PLANT_INPUT',
      plantDerivedInput,
      `錬金釜入力が常時供給扱いのままです: ${namesText(plantDerivedInput, 'ja')}`,
      `Cauldron inputs are still treated as constant supply: ${namesText(plantDerivedInput, 'en')}`,
    ));
  }

  const surplus = uniqueSorted(Object.values(result.itemStats)
    .filter((stat) => Number(stat.surplus ?? 0) > OBJECTIVE_EPS)
    .map((stat) => stat.itemId));
  if (surplus.length > 0) {
    violations.push(violation(
      'SURPLUS_OUTPUT',
      surplus,
      `需要へ再利用されていない余剰が残っています: ${namesText(surplus, 'ja')}`,
      `Surplus remains without being reused by demand: ${namesText(surplus, 'en')}`,
      { severity: 'error' },
    ));
  }

  const discarded = uniqueSorted(Object.values(result.itemStats)
    .filter((stat) => Number(stat.discarded ?? 0) > OBJECTIVE_EPS)
    .map((stat) => stat.itemId));
  if (discarded.length > 0) {
    violations.push(violation(
      'DISCARDED_OUTPUT',
      discarded,
      `破棄出力が残っています: ${namesText(discarded, 'ja')}`,
      `Discarded outputs remain: ${namesText(discarded, 'en')}`,
    ));
  }

  const duplicateCanonicalRecipeIds = Object.keys(result.recipeStats)
    .reduce<Record<string, string[]>>((groups, recipeId) => {
      const key = canonicalRecipeKey(recipeId);
      if (!groups[key]) groups[key] = [];
      groups[key].push(recipeId);
      return groups;
    }, {});
  const duplicateRecipeIds = Object.values(duplicateCanonicalRecipeIds)
    .filter((recipeIds) => recipeIds.length > 1)
    .flat();
  if (duplicateRecipeIds.length > 0) {
    violations.push(violation(
      'DUPLICATE_RECIPE_NODE',
      [],
      `同一通常レシピが複数ノードに分かれています: ${duplicateRecipeIds.join('、')}`,
      `The same normal recipe is split into multiple nodes: ${duplicateRecipeIds.join(', ')}`,
      { recipeIds: duplicateRecipeIds, details: { canonicalGroups: duplicateCanonicalRecipeIds } },
    ));
  }

  const cauldronInputSlotMismatches = Object.entries(result.recipeStats)
    .filter(([, stat]) => isCauldronMachineId(stat.machineId))
    .map(([recipeId]) => {
      const slotFlows = result.flows.filter((flow) => flow.to.type === 'recipe' && flow.to.recipeId === recipeId && flow.role === 'material' && typeof flow.displayRateLabel === 'string' && flow.displayRateLabel.startsWith('slot '));
      return { recipeId, slotCount: slotFlows.length, itemIds: slotFlows.map((flow) => flow.itemId) };
    })
    .filter((entry) => entry.slotCount !== 3);
  if (cauldronInputSlotMismatches.length > 0) {
    violations.push(violation(
      'CAULDRON_INPUT_SLOT_MISMATCH',
      cauldronInputSlotMismatches.flatMap((entry) => entry.itemIds),
      '錬金釜ノードの入力slot数が3本ではありません。',
      'A cauldron recipe node does not have exactly three input slot flows.',
      { recipeIds: cauldronInputSlotMismatches.map((entry) => entry.recipeId), details: { mismatches: cauldronInputSlotMismatches } },
    ));
  }

  const initialInvestmentFlows = result.flows.filter((flow) => flow.from.type === 'itemSource' && flow.from.sourceMode === 'cycleInput');
  if (initialInvestmentFlows.length > 0) {
    violations.push(violation(
      'INITIAL_INVESTMENT_FLOW',
      initialInvestmentFlows.map((flow) => flow.itemId),
      '初期投資が /min フローとしてグラフに出ています。',
      'Initial investment is emitted as a /min graph flow.',
      { details: { flowIds: initialInvestmentFlows.map((flow) => flow.id) } },
    ));
  }

  const fuelRequiredPerMin = Number(result.totals.fuelRequiredPerMin ?? 0);
  const fuelItemId = result.totals.fuelItemId;
  if (fuelItemId && fuelRequiredPerMin > OBJECTIVE_EPS) {
    const fuelFlowTotal = flowRateByRole(result, fuelItemId, 'fuel');
    if (fuelFlowTotal + OBJECTIVE_EPS < fuelRequiredPerMin) {
      violations.push(violation(
        'FUEL_NOT_CLOSED',
        [fuelItemId],
        `燃料需要が内製フローで閉じていません: ${itemName(fuelItemId).ja} 必要 ${formatRate(fuelRequiredPerMin)}/min、供給 ${formatRate(fuelFlowTotal)}/min`,
        `Fuel demand is not closed by internal flows: ${itemName(fuelItemId).en} required ${formatRate(fuelRequiredPerMin)}/min, supplied ${formatRate(fuelFlowTotal)}/min`,
        { details: { fuelItemId, requiredPerMin: fuelRequiredPerMin, suppliedPerMin: fuelFlowTotal } },
      ));
    }
  }

  const fertilizerRequiredPerMin = Number(result.totals.fertilizerRequiredPerMin ?? 0);
  const fertilizerItemId = result.totals.fertilizerItemId;
  if (fertilizerItemId && fertilizerRequiredPerMin > OBJECTIVE_EPS) {
    const fertilizerFlowTotal = flowRateByRole(result, fertilizerItemId, 'fertilizer');
    if (fertilizerFlowTotal + OBJECTIVE_EPS < fertilizerRequiredPerMin) {
      violations.push(violation(
        'FERTILIZER_NOT_CLOSED',
        [fertilizerItemId],
        `肥料需要が内製フローで閉じていません: ${itemName(fertilizerItemId).ja} 必要 ${formatRate(fertilizerRequiredPerMin)}/min、供給 ${formatRate(fertilizerFlowTotal)}/min`,
        `Fertilizer demand is not closed by internal flows: ${itemName(fertilizerItemId).en} required ${formatRate(fertilizerRequiredPerMin)}/min, supplied ${formatRate(fertilizerFlowTotal)}/min`,
        { details: { fertilizerItemId, requiredPerMin: fertilizerRequiredPerMin, suppliedPerMin: fertilizerFlowTotal } },
      ));
    }
  }

  return violations;
}

function issueFromObjectiveViolation(entry: CauldronObjectiveViolation): CauldronOptimizedPlanIssue {
  return {
    code: entry.code,
    severity: entry.severity,
    message: entry.message,
    itemIds: entry.itemIds,
  };
}

function appendObjectiveErrors(result: CalculationResult, violations: CauldronObjectiveViolation[]): CalculationResult {
  const blocking = violations.filter((entry) => entry.severity === 'error');
  if (blocking.length === 0) return result;
  return {
    ...result,
    calculationStatus: 'invalid',
    errorSummaries: [
      ...(result.errorSummaries ?? []),
      ...blocking.map((entry) => ({
        code: `CAULDRON_OBJECTIVE_${entry.code}`,
        messageJa: entry.message.ja,
        messageEn: entry.message.en,
        itemIds: entry.itemIds,
        recipeIds: entry.recipeIds,
      })),
    ],
  };
}

export function planCauldronTarget(options: {
  targetItemId: string;
  amount: number;
  machineId: CauldronMachineId;
  settings: AppSettings;
  abilities: AbilitySettings;
  recipePreferences?: Record<string, string>;
  fuelSourceMode?: ExternalSourceMode;
  fertilizerSourceMode?: ExternalSourceMode;
}): CauldronPlannerResult {
  const rawAmount = Number(options.amount);
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 1;
  const policy = CAULDRON_PLANNER_POLICY;
  const recipePreferences = options.recipePreferences ?? {};
  const resolved = resolveOutputItem(options.targetItemId, amount, policy, recipePreferences);
  const targetLabel = itemName(options.targetItemId);

  if (!resolved.node) {
    const result = blockedResult(options.targetItemId, options.settings, options.abilities, resolved.failures);
    const issues = resolved.failures.slice(0, 10).map(issueFromFailure);
    return {
      result,
      optimization: {
        targetItemId: options.targetItemId,
        targetLabel,
        bestPlan: {
          id: `cauldron:bridge:${options.targetItemId}:blocked`,
          rank: 1,
          source: 'cauldron',
          status: 'blocked',
          score: Number.POSITIVE_INFINITY,
          targetItemId: options.targetItemId,
          targetLabel,
          title: { ja: `${targetLabel.ja}（錬金釜Bridge）`, en: `${targetLabel.en} (Cauldron bridge)` },
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

  const rawResult = buildCalculationResult(resolved.node, options.settings, options.abilities, options.machineId, resolved.ok, resolved.failures);
  const supportClosure = solveSupportClosure(rawResult, options.settings, options.abilities, options.machineId, recipePreferences, { fuelSourceMode: options.fuelSourceMode, fertilizerSourceMode: options.fertilizerSourceMode });
  const supportClosedResult = applySupportClosure(rawResult, supportClosure, options.settings);
  const objectiveViolations = [
    ...collectObjectiveViolations(resolved.node, supportClosedResult),
    ...supportClosureObjectiveViolations(supportClosure),
  ];
  const result = appendObjectiveErrors(supportClosedResult, objectiveViolations);
  const blockingObjectiveViolations = objectiveViolations.filter((entry) => entry.severity === 'error');
  const hasBlockingObjectiveViolations = blockingObjectiveViolations.length > 0;
  const counts = countNodes(resolved.node);
  const rootPlan = planItemFromNode(resolved.node);
  const surplusItemIds = uniqueSorted(Object.values(result.itemStats)
    .filter((stat) => Number(stat.surplus ?? 0) > OBJECTIVE_EPS || Number(stat.discarded ?? 0) > OBJECTIVE_EPS)
    .map((stat) => stat.itemId));
  const issues: CauldronOptimizedPlanIssue[] = [
    ...(resolved.ok ? [] : resolved.failures.slice(0, 10).map(issueFromFailure)),
    ...objectiveViolations.map(issueFromObjectiveViolation),
  ];
  const objectiveOk = resolved.ok && !hasBlockingObjectiveViolations;

  const bestPlan: CauldronOptimizedPlan = {
    id: `cauldron:bridge:${options.targetItemId}`,
    rank: 1,
    source: 'cauldron',
    status: objectiveOk ? (objectiveViolations.length > 0 ? 'warning' : 'closed') : 'blocked',
    score: objectiveOk ? objectiveViolations.length : Number.POSITIVE_INFINITY,
    targetItemId: options.targetItemId,
    targetLabel,
    title: targetLabel,
    summary: { ja: objectiveOk ? (objectiveViolations.length > 0 ? '目的違反の警告を含む候補です。' : '初期投資を除き外部供給なしの候補です。') : '目的違反または未解決を含む候補です。', en: objectiveOk ? (objectiveViolations.length > 0 ? 'The candidate contains objective warnings.' : 'The candidate has no external supply except initial investment.') : 'The candidate contains objective violations or unresolved inputs.' },
    targetRatePerMinute: amount,
    selectedInputItemIds: resolved.node.kind === 'cauldron' ? [...resolved.node.candidate.inputItemIds] as [string, string, string] : undefined,
    root: rootPlan,
    metrics: {
      selfContained: objectiveOk && counts.purchased.length === 0,
      noSurplus: surplusItemIds.length === 0,
      hasConstantSupply: counts.purchased.length > 0,
      hasMissing: !resolved.ok || counts.missing.length > 0,
      hasBlockingSurplus: false,
      startupCostCopper: result.totals.initialCostCopper,
      purchaseCostCopperPerMin: result.totals.purchaseCostCopperPerMin,
      initialItemIds: Array.from(new Set(counts.initial)),
      purchasedItemIds: Array.from(new Set(counts.purchased)),
      externalItemIds: Array.from(new Set(counts.purchased)),
      unresolvedItemIds: Array.from(new Set(counts.missing.length ? counts.missing : resolved.ok ? [] : [options.targetItemId])),
      surplusItemIds,
      coinSurplusItemIds: [],
      sellableSurplusItemIds: [],
      blockingSurplusItemIds: surplusItemIds,
      recipeCount: counts.recipes,
      edgeCount: counts.edges,
      depth: counts.depth,
      machineCount: counts.recipes,
      heatRequiredPerMin: result.totals.heatRequiredPerMin,
      fuelRequiredPerMin: result.totals.fuelRequiredPerMin,
      fertilizerRequiredPerMin: result.totals.fertilizerRequiredPerMin,
      hasObjectiveViolations: objectiveViolations.length > 0,
      objectiveViolationCount: objectiveViolations.length,
      objectiveViolationCodes: objectiveViolations.map((entry) => entry.code),
      objectiveViolations,
    },
    issues,
  };

  return { result, optimization: { targetItemId: options.targetItemId, targetLabel, bestPlan, plans: [bestPlan] } };
}
