import { ITEMS, itemById } from '../data/items';
import { economyByItemId } from '../data/economy';
import { getRecipeCandidatesForItem } from '../engine/itemSourceResolver';
import { recipeById } from '../data/recipes';
import { calculate } from '../engine/calculate';
import type { CalculatedFlow, CalculationResult, ItemStat, RecipeStat } from '../engine/calculate';
import type { AbilitySettings, AppSettings, LocalizedText, ProductionTarget, Recipe, RecipeInput, SurplusPolicy } from '../types';
import { text } from '../i18n';
import { flowTransportForItem } from '../engine/flowTransport';
import { CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
import { generateCauldronCandidatesForOutput } from './cauldronMath';
import type {
  CauldronCandidate,
  CauldronInputTuple,
  CauldronOptimizationResult,
  CauldronOptimizedPlan,
  CauldronOptimizedPlanIssue,
  CauldronOptimizedPlanMetrics,
  CauldronPlanItem,
  CauldronState,
} from './cauldronTypes';

const EPS = 0.000001;
const COIN_ITEM_IDS = new Set(['copper_coin', 'silver_coin', 'gold_coin']);
const MAX_TREE_DEPTH = 8;

type PlanBuildOptions = {
  targetItemId: string;
  targetRatePerMinute: number;
  state: CauldronState;
  settings: AppSettings;
  abilities: AbilitySettings;
  recipePreferences: Record<string, string>;
  surplusPolicies: Record<string, SurplusPolicy>;
  startupItemIds: string[];
  maxCandidates?: number;
};

type CandidateBuildInput =
  | { source: 'cauldron'; candidate: CauldronCandidate }
  | { source: 'normal'; recipe: Recipe };

function labelForItem(itemId: string): LocalizedText {
  return itemById[itemId]?.name ?? { ja: itemId, en: itemId };
}

function itemNames(itemIds: string[]): LocalizedText {
  const labels = [...new Set(itemIds)].map((itemId) => labelForItem(itemId));
  return {
    ja: labels.map((label) => label.ja).join('、'),
    en: labels.map((label) => label.en).join(', '),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function positiveItemStats(result: CalculationResult, key: keyof Omit<ItemStat, 'itemId'>): string[] {
  return Object.values(result.itemStats)
    .filter((stat) => Math.abs(Number(stat[key] ?? 0)) > EPS)
    .map((stat) => stat.itemId);
}

function makeTarget(itemId: string, value: number, recipeId = ''): ProductionTarget {
  return {
    id: `cauldron-plan:${itemId}:${recipeId || 'auto'}`,
    enabled: true,
    recipeId,
    outputItemId: itemId,
    mode: 'rate',
    value: Math.max(EPS, value),
  };
}

function clonePlannerSettings(settings: AppSettings): AppSettings {
  return {
    ...settings,
    machineRounding: 'none',
    defaultSurplusPolicy: 'reuse',
    showSurplus: true,
    showDiscardedByproducts: true,
    showInitialInvestmentLines: true,
    allowAlternateRecipeCompletion: true,
    minimizeSurplusWithAlternateRecipes: true,
    useByproductFuel: true,
    fuel: {
      ...settings.fuel,
      enabled: true,
      sourceMode: 'internal',
    },
    fertilizer: {
      ...settings.fertilizer,
      enabled: true,
      sourceMode: 'internal',
    },
  };
}

function recipeOutputAmount(recipe: Recipe, itemId: string): number {
  return recipe.outputs
    .filter((output) => output.itemId === itemId)
    .reduce((sum, output) => sum + output.amount * (output.probability ?? 1), 0);
}

function normalRecipeCandidates(itemId: string, recipePreferences: Record<string, string>): Recipe[] {
  return getRecipeCandidatesForItem(itemId, recipePreferences).filter(
    (recipe) => recipe.machineId !== 'cauldron' && recipe.machineId !== 'advanced_cauldron' && !recipe.internal,
  );
}

function firstNormalRecipe(itemId: string, recipePreferences: Record<string, string>): Recipe | undefined {
  return normalRecipeCandidates(itemId, recipePreferences)[0];
}

function itemInputs(recipe: Recipe): Array<{ itemId: string; amount: number }> {
  return recipe.inputs
    .filter((input): input is RecipeInput & { itemId: string } => input.kind !== 'paradoxableItem')
    .map((input) => ({ itemId: input.itemId, amount: input.amount }));
}

function buildStartupItem(itemId: string, amount: number): CauldronPlanItem {
  return {
    itemId,
    label: labelForItem(itemId),
    amount,
    status: 'startup',
    reason: { ja: '初期投入として扱います。', en: 'Provided as a startup input.' },
    children: [],
  };
}

function buildMissingItem(itemId: string, amount: number): CauldronPlanItem {
  return {
    itemId,
    label: labelForItem(itemId),
    amount,
    status: 'missing',
    reason: { ja: '通常レシピまたは錬金釜候補で解決できません。', en: 'No normal recipe or cauldron candidate could resolve this item.' },
    children: [],
  };
}

function buildItemTree(
  itemId: string,
  amount: number,
  options: PlanBuildOptions,
  startupSet: Set<string>,
  depth: number,
  seen: Set<string>,
): CauldronPlanItem {
  if (startupSet.has(itemId)) return buildStartupItem(itemId, amount);
  if (seen.has(itemId)) {
    return {
      itemId,
      label: labelForItem(itemId),
      amount,
      status: 'cycle',
      reason: { ja: '循環を検出しました。初期投入候補として扱います。', en: 'Cycle detected; treat as a startup candidate.' },
      children: [],
    };
  }
  if (depth <= 0) {
    return {
      itemId,
      label: labelForItem(itemId),
      amount,
      status: 'depthLimit',
      reason: { ja: '探索上限に達しました。', en: 'Depth limit reached.' },
      children: [],
    };
  }

  const nextSeen = new Set(seen);
  nextSeen.add(itemId);
  const normalRecipe = firstNormalRecipe(itemId, options.recipePreferences);
  if (normalRecipe) {
    const outputAmount = recipeOutputAmount(normalRecipe, itemId);
    const runs = outputAmount > EPS ? amount / outputAmount : amount;
    return {
      itemId,
      label: labelForItem(itemId),
      amount,
      status: 'normal',
      reason: { ja: `通常レシピ ${normalRecipe.id} で展開します。`, en: `Expanded through normal recipe ${normalRecipe.id}.` },
      recipeId: normalRecipe.id,
      children: itemInputs(normalRecipe).map((input) => buildItemTree(input.itemId, input.amount * runs, options, startupSet, depth - 1, nextSeen)),
    };
  }

  if (CAULDRON_TARGETS[itemId]) {
    const candidate = generateCauldronCandidatesForOutput(itemId, {
      allowDuplicateInputs: options.state.allowDuplicateInputs,
      maxCandidates: 1,
    })[0];
    if (candidate) {
      const counts = countInputs(candidate.inputItemIds);
      return {
        itemId,
        label: labelForItem(itemId),
        amount,
        status: 'cauldronTarget',
        reason: { ja: '錬金釜候補で展開します。', en: 'Expanded through a cauldron candidate.' },
        candidateCount: 1,
        children: Object.entries(counts).map(([childItemId, count]) => buildItemTree(childItemId, count * amount, options, startupSet, depth - 1, nextSeen)),
      };
    }
  }

  return buildMissingItem(itemId, amount);
}

function countInputs(inputItemIds: CauldronInputTuple): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const itemId of inputItemIds) counts[itemId] = (counts[itemId] ?? 0) + 1;
  return counts;
}

function treeDepth(root: CauldronPlanItem): number {
  if (root.children.length === 0) return 1;
  return 1 + Math.max(...root.children.map(treeDepth));
}

function makeCauldronRoot(candidate: CauldronCandidate, options: PlanBuildOptions, startupSet: Set<string>): CauldronPlanItem {
  const counts = countInputs(candidate.inputItemIds);
  return {
    itemId: candidate.outputItemId,
    label: labelForItem(candidate.outputItemId),
    amount: options.targetRatePerMinute,
    status: 'cauldronTarget',
    reason: { ja: '選択中の錬金釜候補です。', en: 'Selected cauldron candidate.' },
    candidateCount: 1,
    children: Object.entries(counts).map(([itemId, count]) => buildItemTree(itemId, count * options.targetRatePerMinute, options, startupSet, MAX_TREE_DEPTH, new Set([candidate.outputItemId]))),
  };
}

function makeNormalRoot(recipe: Recipe, options: PlanBuildOptions, startupSet: Set<string>): CauldronPlanItem {
  const outputAmount = recipeOutputAmount(recipe, options.targetItemId);
  const runs = outputAmount > EPS ? options.targetRatePerMinute / outputAmount : options.targetRatePerMinute;
  return {
    itemId: options.targetItemId,
    label: labelForItem(options.targetItemId),
    amount: options.targetRatePerMinute,
    status: 'normal',
    reason: { ja: `通常レシピ ${recipe.id} を使います。`, en: `Uses normal recipe ${recipe.id}.` },
    recipeId: recipe.id,
    children: itemInputs(recipe).map((input) => buildItemTree(input.itemId, input.amount * runs, options, startupSet, MAX_TREE_DEPTH, new Set([options.targetItemId]))),
  };
}

function candidateTargets(input: CandidateBuildInput, options: PlanBuildOptions): ProductionTarget[] {
  if (input.source === 'normal') return [makeTarget(options.targetItemId, options.targetRatePerMinute, input.recipe.id)];
  const startupSet = new Set(options.startupItemIds);
  const counts = countInputs(input.candidate.inputItemIds);
  return Object.entries(counts)
    .filter(([itemId]) => !startupSet.has(itemId))
    .map(([itemId, count]) => makeTarget(itemId, count * options.targetRatePerMinute));
}

function calculateCandidate(input: CandidateBuildInput, options: PlanBuildOptions): CalculationResult {
  return calculate({
    targets: candidateTargets(input, options),
    settings: clonePlannerSettings(options.settings),
    abilities: options.abilities,
    recipePreferences: options.recipePreferences,
    surplusPolicies: options.surplusPolicies,
  });
}

function flowSourceItems(result: CalculationResult, sourceMode: 'buy' | 'external' | 'unresolved' | 'cycleInput'): string[] {
  return unique(result.flows
    .filter((flow) => flow.from.type === 'itemSource' && flow.from.sourceMode === sourceMode && flow.rate > EPS)
    .map((flow) => flow.itemId));
}

function startupCostCopper(itemId: string, amount: number): number {
  const economy = economyByItemId[itemId];
  const price = economy?.buyPriceCopper ?? economy?.sellPriceCopper ?? 0;
  return Math.max(0, amount) * price;
}

function startupInputsForCandidate(input: CandidateBuildInput, options: PlanBuildOptions): { itemIds: string[]; costCopper: number } {
  if (input.source !== 'cauldron') return { itemIds: [], costCopper: 0 };
  const startupSet = new Set(options.startupItemIds);
  const counts = countInputs(input.candidate.inputItemIds);
  const entries = Object.entries(counts).filter(([itemId]) => startupSet.has(itemId));
  return {
    itemIds: entries.map(([itemId]) => itemId),
    costCopper: entries.reduce((sum, [itemId, count]) => sum + startupCostCopper(itemId, count * options.targetRatePerMinute), 0),
  };
}

function metricsFromResult(
  result: CalculationResult,
  root: CauldronPlanItem,
  extraRecipeCount: number,
  extraEdgeCount: number,
  extraInitialItemIds: string[],
  extraStartupCostCopper: number,
): CauldronOptimizedPlanMetrics {
  const purchasedItemIds = unique([...positiveItemStats(result, 'purchased'), ...flowSourceItems(result, 'buy')]);
  const externalItemIds = flowSourceItems(result, 'external');
  const unresolvedItemIds = flowSourceItems(result, 'unresolved');
  const initialItemIds = unique([...positiveItemStats(result, 'initialPurchased'), ...flowSourceItems(result, 'cycleInput'), ...extraInitialItemIds]);
  const surplusItemIds = unique([...positiveItemStats(result, 'surplus'), ...positiveItemStats(result, 'discarded')]);
  const coinSurplusItemIds = surplusItemIds.filter((itemId) => COIN_ITEM_IDS.has(itemId));
  const sellableSurplusItemIds = surplusItemIds.filter((itemId) => !COIN_ITEM_IDS.has(itemId) && economyByItemId[itemId]?.sellPriceCopper !== undefined);
  const blockingSurplusItemIds = surplusItemIds.filter((itemId) => !COIN_ITEM_IDS.has(itemId) && economyByItemId[itemId]?.sellPriceCopper === undefined);
  const recipeStats = Object.values(result.recipeStats);
  const machineCount = recipeStats.reduce((sum, stat) => sum + Math.max(0, stat.actualMachines || stat.theoreticalMachines || 0), 0);
  const hasConstantSupply = purchasedItemIds.length > 0 || externalItemIds.length > 0;
  const hasMissing = unresolvedItemIds.length > 0 || result.calculationStatus === 'invalid';

  return {
    selfContained: !hasMissing && !hasConstantSupply,
    noSurplus: surplusItemIds.length === 0,
    hasConstantSupply,
    hasMissing,
    hasBlockingSurplus: blockingSurplusItemIds.length > 0,
    startupCostCopper: (result.totals.initialCostCopper ?? 0) + extraStartupCostCopper,
    purchaseCostCopperPerMin: result.totals.purchaseCostCopperPerMin ?? 0,
    initialItemIds,
    purchasedItemIds,
    externalItemIds,
    unresolvedItemIds,
    surplusItemIds,
    coinSurplusItemIds,
    sellableSurplusItemIds,
    blockingSurplusItemIds,
    recipeCount: recipeStats.length + extraRecipeCount,
    edgeCount: result.flows.length + extraEdgeCount,
    depth: treeDepth(root),
    machineCount: machineCount + extraRecipeCount,
    heatRequiredPerMin: result.totals.heatRequiredPerMin ?? 0,
    fuelRequiredPerMin: result.totals.fuelRequiredPerMin ?? 0,
    fertilizerRequiredPerMin: result.totals.fertilizerRequiredPerMin ?? 0,
  };
}

function issueList(metrics: CauldronOptimizedPlanMetrics, input: CandidateBuildInput): CauldronOptimizedPlanIssue[] {
  const issues: CauldronOptimizedPlanIssue[] = [];
  if (!metrics.hasMissing && !metrics.hasConstantSupply && metrics.noSurplus) {
    issues.push({
      code: 'COMPLETE_CLOSED',
      severity: 'info',
      message: { ja: '燃料・肥料込みで閉鎖でき、常時供給と余剰はありません。', en: 'Closed including fuel and fertilizer, with no constant supply or surplus.' },
    });
  }
  if (metrics.initialItemIds.length > 0) {
    const names = itemNames(metrics.initialItemIds);
    issues.push({
      code: 'INITIAL_INPUT',
      severity: 'info',
      itemIds: metrics.initialItemIds,
      message: { ja: `初期投入があります: ${names.ja}`, en: `Startup inputs: ${names.en}` },
    });
  }
  if (metrics.hasMissing) {
    const names = itemNames(metrics.unresolvedItemIds);
    issues.push({
      code: 'MISSING',
      severity: 'error',
      itemIds: metrics.unresolvedItemIds,
      message: { ja: `完結できない材料があります: ${names.ja || '計算不能'}`, en: `Unresolved materials: ${names.en || 'calculation invalid'}` },
    });
  }
  if (metrics.hasConstantSupply) {
    const ids = unique([...metrics.purchasedItemIds, ...metrics.externalItemIds]);
    const names = itemNames(ids);
    issues.push({
      code: 'CONSTANT_SUPPLY',
      severity: 'warning',
      itemIds: ids,
      message: { ja: `常時購入または外部供給があります: ${names.ja}`, en: `Constant purchase or external supply: ${names.en}` },
    });
  }
  if (metrics.blockingSurplusItemIds.length > 0) {
    const names = itemNames(metrics.blockingSurplusItemIds);
    issues.push({
      code: 'SURPLUS',
      severity: 'warning',
      itemIds: metrics.blockingSurplusItemIds,
      message: { ja: `売却不能な余剰があります: ${names.ja}`, en: `Unsellable surplus: ${names.en}` },
    });
  }
  if (metrics.sellableSurplusItemIds.length > 0) {
    const names = itemNames(metrics.sellableSurplusItemIds);
    issues.push({
      code: 'SELLABLE_SURPLUS',
      severity: 'warning',
      itemIds: metrics.sellableSurplusItemIds,
      message: { ja: `売却可能な余剰があります: ${names.ja}`, en: `Sellable surplus: ${names.en}` },
    });
  }
  if (metrics.coinSurplusItemIds.length > 0) {
    const names = itemNames(metrics.coinSurplusItemIds);
    issues.push({
      code: 'COIN_SURPLUS',
      severity: 'info',
      itemIds: metrics.coinSurplusItemIds,
      message: { ja: `コイン余剰があります: ${names.ja}`, en: `Coin surplus: ${names.en}` },
    });
  }
  if (input.source === 'cauldron' && input.candidate.targetTimeSec === undefined) {
    issues.push({
      code: 'TIME_UNVERIFIED',
      severity: 'info',
      message: { ja: '錬金釜の処理時間が未確認のため、工程評価は材料側を優先しています。', en: 'Cauldron processing time is unverified, so scoring prioritizes the material side.' },
    });
  }
  return issues;
}

function planStatus(metrics: CauldronOptimizedPlanMetrics): CauldronOptimizedPlan['status'] {
  if (metrics.hasMissing) return 'blocked';
  if (metrics.selfContained && metrics.noSurplus) return metrics.startupCostCopper > EPS || metrics.initialItemIds.length > 0 ? 'closed' : 'perfect';
  return 'warning';
}

function scorePlan(metrics: CauldronOptimizedPlanMetrics, input: CandidateBuildInput): number {
  let score = 0;
  if (!metrics.hasMissing) score += 1_000_000_000;
  if (metrics.selfContained) score += 200_000_000;
  if (metrics.noSurplus) score += 100_000_000;
  if (!metrics.hasBlockingSurplus) score += 20_000_000;
  if (metrics.surplusItemIds.length === metrics.coinSurplusItemIds.length && metrics.surplusItemIds.length > 0) score += 5_000_000;
  if (metrics.surplusItemIds.length === metrics.coinSurplusItemIds.length + metrics.sellableSurplusItemIds.length && metrics.surplusItemIds.length > 0) score += 1_000_000;
  score -= metrics.purchasedItemIds.length * 40_000_000;
  score -= metrics.externalItemIds.length * 40_000_000;
  score -= metrics.unresolvedItemIds.length * 80_000_000;
  score -= metrics.blockingSurplusItemIds.length * 10_000_000;
  score -= metrics.sellableSurplusItemIds.length * 1_000_000;
  score -= metrics.coinSurplusItemIds.length * 100_000;
  score -= metrics.startupCostCopper * 0.01;
  score -= metrics.purchaseCostCopperPerMin * 1000;
  score -= metrics.recipeCount * 10_000;
  score -= metrics.edgeCount * 1000;
  score -= metrics.depth * 3000;
  score -= metrics.machineCount * 100;
  score -= metrics.heatRequiredPerMin * 0.01;
  score -= metrics.fertilizerRequiredPerMin * 100;
  if (input.source === 'cauldron') score -= (input.candidate.distanceRatio ?? 0) * 100_000;
  return score;
}

function planTitle(input: CandidateBuildInput, targetItemId: string): LocalizedText {
  if (input.source === 'normal') {
    return { ja: `通常レシピ: ${input.recipe.name.ja}`, en: `Normal recipe: ${input.recipe.name.en}` };
  }
  const names = input.candidate.inputItemIds.map((itemId) => text(labelForItem(itemId), 'ja')).join(' + ');
  const namesEn = input.candidate.inputItemIds.map((itemId) => text(labelForItem(itemId), 'en')).join(' + ');
  return {
    ja: `錬金釜: ${names} -> ${labelForItem(targetItemId).ja}`,
    en: `Cauldron: ${namesEn} -> ${labelForItem(targetItemId).en}`,
  };
}

function planSummary(metrics: CauldronOptimizedPlanMetrics): LocalizedText {
  if (metrics.hasMissing) return { ja: '完結できない材料があります。警告付き候補です。', en: 'Some materials are unresolved. This candidate is shown with warnings.' };
  if (metrics.selfContained && metrics.noSurplus) return { ja: '完全閉鎖・余剰なしの候補です。', en: 'Closed candidate with no surplus.' };
  if (!metrics.selfContained && metrics.noSurplus) return { ja: '余剰はありませんが、常時供給があります。', en: 'No surplus, but constant supply remains.' };
  if (metrics.selfContained) return { ja: '完結していますが、余剰があります。', en: 'Self-contained, but surplus remains.' };
  return { ja: '常時供給と余剰を含む候補です。', en: 'Candidate includes constant supply and surplus.' };
}

function buildPlan(input: CandidateBuildInput, options: PlanBuildOptions): CauldronOptimizedPlan | undefined {
  const startupSet = new Set(options.startupItemIds);
  const root = input.source === 'cauldron'
    ? makeCauldronRoot(input.candidate, options, startupSet)
    : makeNormalRoot(input.recipe, options, startupSet);
  let result: CalculationResult;
  try {
    result = calculateCandidate(input, options);
  } catch {
    return undefined;
  }
  const extraRecipeCount = input.source === 'cauldron' ? 1 : 0;
  const extraEdgeCount = input.source === 'cauldron' ? new Set(input.candidate.inputItemIds).size + 1 : 0;
  const startupInputs = startupInputsForCandidate(input, options);
  const metrics = metricsFromResult(result, root, extraRecipeCount, extraEdgeCount, startupInputs.itemIds, startupInputs.costCopper);
  const issues = issueList(metrics, input);
  const status = planStatus(metrics);
  const score = scorePlan(metrics, input);
  return {
    id: input.source === 'cauldron' ? input.candidate.id : `normal:${input.recipe.id}`,
    rank: 0,
    source: input.source,
    status,
    score,
    targetItemId: options.targetItemId,
    targetLabel: labelForItem(options.targetItemId),
    title: planTitle(input, options.targetItemId),
    summary: planSummary(metrics),
    targetRatePerMinute: options.targetRatePerMinute,
    selectedInputItemIds: input.source === 'cauldron' ? input.candidate.inputItemIds : undefined,
    cauldronCandidateId: input.source === 'cauldron' ? input.candidate.id : undefined,
    cauldronDistanceRatio: input.source === 'cauldron' ? input.candidate.distanceRatio : undefined,
    root,
    metrics,
    issues,
  };
}

export function optimizeCauldronTarget(options: PlanBuildOptions): CauldronOptimizationResult {
  const candidates: CandidateBuildInput[] = [];
  if (CAULDRON_TARGETS[options.targetItemId]) {
    for (const candidate of generateCauldronCandidatesForOutput(options.targetItemId, {
      allowDuplicateInputs: options.state.allowDuplicateInputs,
      maxCandidates: Math.max(1, options.maxCandidates ?? options.state.maxCandidates),
    })) {
      candidates.push({ source: 'cauldron', candidate });
    }
  }
  for (const recipe of normalRecipeCandidates(options.targetItemId, options.recipePreferences).slice(0, 8)) {
    candidates.push({ source: 'normal', recipe });
  }

  const plans = candidates
    .map((candidate) => buildPlan(candidate, options))
    .filter((plan): plan is CauldronOptimizedPlan => Boolean(plan))
    .sort((a, b) => b.score - a.score || a.metrics.recipeCount - b.metrics.recipeCount || a.id.localeCompare(b.id))
    .slice(0, 10)
    .map((plan, index) => ({ ...plan, rank: index + 1 }));

  return {
    targetItemId: options.targetItemId,
    targetLabel: labelForItem(options.targetItemId),
    bestPlan: plans[0],
    plans,
  };
}


// v0.10.9: strict closed-line planner for the Cauldron tab.
// This planner is intentionally isolated from the normal Graph tab calculation path.
// It has two stages:
// 1. resolve the requested production item by trying cauldron routes before normal recipes.
// 2. for each cauldron route, search the three input items from staged candidate pools and resolve those inputs too.
const CLOSED_LINE_MAX_DEPTH = 10;
const CLOSED_LINE_MAX_PER_TIER = 36;
const CLOSED_LINE_EPS = 0.000001;
const CLOSED_LINE_REQUIRED_CAULDRON_ITEM_IDS = new Set(['clay', 'salt', 'coke']);

type ClosedLinePlanBundle = {
  optimization: CauldronOptimizationResult;
  result: CalculationResult;
};

type ClosedTreeMetrics = {
  missingItemIds: string[];
  initialItemIds: string[];
  purchasedItemIds: string[];
  cycleItemIds: string[];
  depthLimitItemIds: string[];
  cauldronDataMissingItemIds: string[];
  cauldronItemIds: string[];
  recipeIds: string[];
  depth: number;
  cauldronNodeCount: number;
  normalNodeCount: number;
  sourceTierPenalty: number;
};

type ClosedCandidateTier = {
  id: NonNullable<CauldronPlanItem['sourceTier']>;
  itemIds: string[];
  penalty: number;
};

function closedUnique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isSeedItem(itemId: string): boolean {
  return itemById[itemId]?.category === 'seed';
}

function isCauldronValueItem(itemId: string): boolean {
  return CAULDRON_INPUT_VALUES[itemId] !== undefined;
}

function recipeInputsAreInSet(recipe: Recipe, set: Set<string>): boolean {
  const inputs = itemInputs(recipe);
  return inputs.length > 0 && inputs.every((input) => set.has(input.itemId));
}

function derivedItemSetFromSeeds(): Set<string> {
  const derived = new Set<string>();
  for (const item of ITEMS) {
    if (item.category === 'seed') derived.add(item.id);
  }

  let changed = true;
  let guard = 0;
  while (changed && guard < 8) {
    guard += 1;
    changed = false;
    for (const recipe of normalRecipeCandidatesForAll()) {
      if (!recipeInputsAreInSet(recipe, derived)) continue;
      for (const output of recipe.outputs) {
        if (derived.has(output.itemId)) continue;
        derived.add(output.itemId);
        changed = true;
      }
    }
  }
  return derived;
}

function derivedItemSetFromPurchases(): Set<string> {
  const derived = new Set<string>();
  for (const item of ITEMS) {
    if (item.buyPriceCopper !== undefined) derived.add(item.id);
  }

  let changed = true;
  let guard = 0;
  while (changed && guard < 8) {
    guard += 1;
    changed = false;
    for (const recipe of normalRecipeCandidatesForAll()) {
      if (!recipeInputsAreInSet(recipe, derived)) continue;
      for (const output of recipe.outputs) {
        if (derived.has(output.itemId)) continue;
        derived.add(output.itemId);
        changed = true;
      }
    }
  }
  return derived;
}

let cachedNormalRecipesForClosedPlanner: Recipe[] | undefined;
function normalRecipeCandidatesForAll(): Recipe[] {
  if (cachedNormalRecipesForClosedPlanner) return cachedNormalRecipesForClosedPlanner;
  const recipes: Recipe[] = [];
  const seen = new Set<string>();
  for (const item of ITEMS) {
    for (const recipe of normalRecipeCandidates(item.id, {})) {
      if (seen.has(recipe.id)) continue;
      seen.add(recipe.id);
      recipes.push(recipe);
    }
  }
  cachedNormalRecipesForClosedPlanner = recipes;
  return recipes;
}

let cachedPlantDerivedForClosedPlanner: Set<string> | undefined;
function plantDerivedItemIds(): Set<string> {
  cachedPlantDerivedForClosedPlanner = cachedPlantDerivedForClosedPlanner ?? derivedItemSetFromSeeds();
  return cachedPlantDerivedForClosedPlanner;
}

let cachedPurchaseDerivedForClosedPlanner: Set<string> | undefined;
function purchaseDerivedItemIds(): Set<string> {
  cachedPurchaseDerivedForClosedPlanner = cachedPurchaseDerivedForClosedPlanner ?? derivedItemSetFromPurchases();
  return cachedPurchaseDerivedForClosedPlanner;
}

function sourceTierForInputPool(itemIds: string[], plantSet: Set<string>, purchaseSet: Set<string>): NonNullable<CauldronPlanItem['sourceTier']> {
  const hasPurchase = itemIds.some((itemId) => purchaseSet.has(itemId));
  const allPlant = itemIds.length > 0 && itemIds.every((itemId) => plantSet.has(itemId));
  if (hasPurchase) return 'purchasable-derived';
  if (allPlant) return 'plant-derived';
  return 'mixed';
}

function closedCandidateTiers(plannedItemIds: Set<string>): ClosedCandidateTier[] {
  const plantSet = plantDerivedItemIds();
  const purchaseSet = purchaseDerivedItemIds();
  const cauldronPlanned = [...plannedItemIds].filter(isCauldronValueItem);
  const plantDerived = [...plantSet].filter(isCauldronValueItem);
  const purchaseDerived = [...purchaseSet].filter(isCauldronValueItem);
  const allValues = Object.keys(CAULDRON_INPUT_VALUES).filter(isCauldronValueItem);

  return [
    { id: 'cauldron-planned' as const, itemIds: cauldronPlanned, penalty: 0 },
    { id: 'plant-derived' as const, itemIds: closedUnique([...cauldronPlanned, ...plantDerived]), penalty: 10 },
    { id: 'purchasable-derived' as const, itemIds: closedUnique([...cauldronPlanned, ...plantDerived, ...purchaseDerived]), penalty: 1_000 },
    { id: 'all-values' as const, itemIds: allValues, penalty: 10_000 },
  ].filter((tier) => tier.itemIds.length >= 1);
}

function analyzeClosedTree(root: CauldronPlanItem): ClosedTreeMetrics {
  const metrics: ClosedTreeMetrics = {
    missingItemIds: [],
    initialItemIds: [],
    purchasedItemIds: [],
    cycleItemIds: [],
    depthLimitItemIds: [],
    cauldronDataMissingItemIds: [],
    cauldronItemIds: [],
    recipeIds: [],
    depth: 1,
    cauldronNodeCount: 0,
    normalNodeCount: 0,
    sourceTierPenalty: 0,
  };

  function walk(node: CauldronPlanItem, depth: number): void {
    metrics.depth = Math.max(metrics.depth, depth);
    if (node.status === 'missing') {
      metrics.missingItemIds.push(node.itemId);
      if (itemById[node.itemId]?.buyPriceCopper !== undefined) metrics.purchasedItemIds.push(node.itemId);
      if (CLOSED_LINE_REQUIRED_CAULDRON_ITEM_IDS.has(node.itemId) && !CAULDRON_TARGETS[node.itemId]) metrics.cauldronDataMissingItemIds.push(node.itemId);
    }
    if (node.status === 'depthLimit') {
      metrics.depthLimitItemIds.push(node.itemId);
      metrics.missingItemIds.push(node.itemId);
    }
    if (node.status === 'startup') metrics.initialItemIds.push(node.itemId);
    if (node.status === 'cycle') {
      metrics.cycleItemIds.push(node.itemId);
      metrics.missingItemIds.push(node.itemId);
    }
    if (node.status === 'cauldronTarget') {
      metrics.cauldronItemIds.push(node.itemId);
      metrics.cauldronNodeCount += 1;
      if (node.sourceTier === 'purchasable-derived') metrics.sourceTierPenalty += 1_000;
      if (node.sourceTier === 'all-values') metrics.sourceTierPenalty += 10_000;
      if (node.sourceTier === 'plant-derived') metrics.sourceTierPenalty += 10;
      if (node.sourceTier === 'mixed') metrics.sourceTierPenalty += 100;
    }
    if (node.status === 'normal') {
      metrics.normalNodeCount += 1;
      if (node.recipeId) metrics.recipeIds.push(node.recipeId);
    }
    for (const child of node.children) walk(child, depth + 1);
  }

  walk(root, 1);
  metrics.missingItemIds = closedUnique(metrics.missingItemIds);
  metrics.initialItemIds = closedUnique(metrics.initialItemIds);
  metrics.purchasedItemIds = closedUnique(metrics.purchasedItemIds);
  metrics.cycleItemIds = closedUnique(metrics.cycleItemIds);
  metrics.depthLimitItemIds = closedUnique(metrics.depthLimitItemIds);
  metrics.cauldronDataMissingItemIds = closedUnique(metrics.cauldronDataMissingItemIds);
  metrics.cauldronItemIds = closedUnique(metrics.cauldronItemIds);
  metrics.recipeIds = closedUnique(metrics.recipeIds);
  return metrics;
}

function closedTreeScore(root: CauldronPlanItem): number {
  const metrics = analyzeClosedTree(root);
  return (
    metrics.missingItemIds.length * 1_000_000 +
    metrics.purchasedItemIds.length * 250_000 +
    metrics.cycleItemIds.length * 750_000 +
    metrics.cauldronDataMissingItemIds.length * 900_000 +
    metrics.depthLimitItemIds.length * 500_000 +
    metrics.sourceTierPenalty +
    metrics.depth * 100 +
    metrics.normalNodeCount * 25 +
    metrics.cauldronNodeCount * 40
  );
}

function closedDepthLimitItem(itemId: string, amount: number): CauldronPlanItem {
  return {
    itemId,
    label: labelForItem(itemId),
    amount,
    status: 'depthLimit',
    reason: { ja: '閉鎖ライン探索の深さ上限に達しました。', en: 'Closed-line search depth limit reached.' },
    children: [],
  };
}

function closedMissingItem(itemId: string, amount: number, reason?: LocalizedText): CauldronPlanItem {
  const buyable = itemById[itemId]?.buyPriceCopper !== undefined;
  return {
    itemId,
    label: labelForItem(itemId),
    amount,
    status: 'missing',
    reason: reason ?? (buyable
      ? { ja: '購入はできますが、閉鎖ラインでは常時購入扱いになるため未完結です。', en: 'Buyable, but constant purchase is not a closed line.' }
      : { ja: '錬金釜候補・通常レシピ・初期投入のいずれでも解決できません。', en: 'Could not resolve through cauldron, normal recipes, or startup input.' }),
    children: [],
  };
}

function closedCauldronDataMissingItem(itemId: string, amount: number): CauldronPlanItem {
  return closedMissingItem(itemId, amount, {
    ja: '錬金釜で作る前提の材料ですが、錬金釜ターゲット値が未登録です。通常レシピへ自動フォールバックしません。',
    en: 'This material is expected to be made by cauldron, but its cauldron target value is not registered. It will not silently fall back to a normal recipe.',
  });
}

function closedStartupItem(itemId: string, amount: number, reason?: LocalizedText): CauldronPlanItem {
  return {
    itemId,
    label: labelForItem(itemId),
    amount,
    status: 'startup',
    reason: reason ?? { ja: '初期投入として扱います。', en: 'Provided as a startup input.' },
    children: [],
  };
}

function closedCycleItem(itemId: string, amount: number): CauldronPlanItem {
  return {
    itemId,
    label: labelForItem(itemId),
    amount,
    status: 'cycle',
    reason: { ja: '循環を検出しました。収支計算で余剰が証明できないため未完結です。', en: 'Cycle detected. It is incomplete unless the final balance proves surplus production.' },
    children: [],
  };
}

function closedRecipeNode(itemId: string, amount: number, recipe: Recipe, options: PlanBuildOptions, startupSet: Set<string>, depth: number, seen: Set<string>, plannedItemIds: Set<string>): CauldronPlanItem {
  const outputAmount = recipeOutputAmount(recipe, itemId);
  const runs = outputAmount > CLOSED_LINE_EPS ? amount / outputAmount : amount;
  const nextSeen = new Set(seen);
  nextSeen.add(itemId);
  const children = itemInputs(recipe).map((input) => closedResolveItem(input.itemId, input.amount * runs, options, startupSet, depth - 1, nextSeen, plannedItemIds));
  return {
    itemId,
    label: labelForItem(itemId),
    amount,
    status: 'normal',
    reason: { ja: `通常レシピ ${recipe.id} で展開します。`, en: `Expanded through normal recipe ${recipe.id}.` },
    recipeId: recipe.id,
    children,
  };
}

function closedFindCauldronNode(itemId: string, amount: number, options: PlanBuildOptions, startupSet: Set<string>, depth: number, seen: Set<string>, plannedItemIds: Set<string>): CauldronPlanItem | undefined {
  if (!CAULDRON_TARGETS[itemId]) return undefined;
  const nextPlanned = new Set(plannedItemIds);
  nextPlanned.add(itemId);
  const tried = new Set<string>();
  const candidateNodes: Array<{ node: CauldronPlanItem; score: number; distance: number }> = [];
  const tiers = closedCandidateTiers(nextPlanned);

  for (const tier of tiers) {
    const candidates = generateCauldronCandidatesForOutput(itemId, {
      allowDuplicateInputs: options.state.allowDuplicateInputs,
      maxCandidates: Math.max(CLOSED_LINE_MAX_PER_TIER, options.maxCandidates ?? CLOSED_LINE_MAX_PER_TIER),
      inputItemIds: tier.itemIds,
    });
    for (const candidate of candidates) {
      if (tried.has(candidate.id)) continue;
      tried.add(candidate.id);
      const inputCounts = countInputs(candidate.inputItemIds);
      const nextSeen = new Set(seen);
      nextSeen.add(itemId);
      const children = Object.entries(inputCounts).map(([childItemId, count]) =>
        closedResolveItem(childItemId, amount * count, options, startupSet, depth - 1, nextSeen, nextPlanned),
      );
      const tierId = tier.id === 'purchasable-derived'
        ? sourceTierForInputPool(candidate.inputItemIds, plantDerivedItemIds(), purchaseDerivedItemIds())
        : tier.id;
      const node: CauldronPlanItem = {
        itemId,
        label: labelForItem(itemId),
        amount,
        status: 'cauldronTarget',
        reason: {
          ja: `錬金釜候補 ${candidate.inputItemIds.map((id) => labelForItem(id).ja).join(' + ')} で展開します。`,
          en: `Expanded through cauldron candidate ${candidate.inputItemIds.map((id) => labelForItem(id).en).join(' + ')}.`,
        },
        candidateCount: candidates.length,
        selectedInputItemIds: candidate.inputItemIds,
        sourceTier: tierId,
        children,
      };
      candidateNodes.push({ node, score: closedTreeScore(node) + tier.penalty, distance: candidate.distanceRatio });
    }
    const tierBest = candidateNodes
      .filter((entry) => entry.node.sourceTier === tier.id || tier.id === 'purchasable-derived')
      .sort((a, b) => a.score - b.score || a.distance - b.distance)[0];
    if (tierBest && analyzeClosedTree(tierBest.node).missingItemIds.length === 0) return tierBest.node;
  }

  return candidateNodes.sort((a, b) => a.score - b.score || a.distance - b.distance)[0]?.node;
}

function closedResolveItem(itemId: string, amount: number, options: PlanBuildOptions, startupSet: Set<string>, depth: number, seen: Set<string>, plannedItemIds: Set<string>): CauldronPlanItem {
  if (startupSet.has(itemId)) return closedStartupItem(itemId, amount);
  if (isSeedItem(itemId)) {
    return closedStartupItem(itemId, amount, { ja: '種は初期投入として扱います。', en: 'Seeds are treated as startup input.' });
  }
  if (seen.has(itemId)) return closedCycleItem(itemId, amount);
  if (depth <= 0) return closedDepthLimitItem(itemId, amount);
  if (CLOSED_LINE_REQUIRED_CAULDRON_ITEM_IDS.has(itemId) && !CAULDRON_TARGETS[itemId]) {
    return closedCauldronDataMissingItem(itemId, amount);
  }

  const cauldronNode = closedFindCauldronNode(itemId, amount, options, startupSet, depth, seen, plannedItemIds);
  const cauldronScore = cauldronNode ? closedTreeScore(cauldronNode) : Number.POSITIVE_INFINITY;

  const normalNodes = normalRecipeCandidates(itemId, options.recipePreferences)
    .slice(0, 4)
    .map((recipe) => closedRecipeNode(itemId, amount, recipe, options, startupSet, depth, seen, plannedItemIds));
  const normalBest = normalNodes.sort((a, b) => closedTreeScore(a) - closedTreeScore(b))[0];
  const normalScore = normalBest ? closedTreeScore(normalBest) + 250 : Number.POSITIVE_INFINITY;

  if (cauldronNode && cauldronScore <= normalScore) return cauldronNode;
  if (normalBest) return normalBest;
  if (cauldronNode) return cauldronNode;
  return closedMissingItem(itemId, amount);
}

function buildClosedRoot(options: PlanBuildOptions): CauldronPlanItem {
  const startupSet = new Set(options.startupItemIds);
  return closedResolveItem(options.targetItemId, options.targetRatePerMinute, options, startupSet, CLOSED_LINE_MAX_DEPTH, new Set(), new Set());
}

function metricsFromClosedTree(root: CauldronPlanItem, result: CalculationResult): CauldronOptimizedPlanMetrics {
  const tree = analyzeClosedTree(root);
  const surplusItemIds = positiveItemStats(result, 'surplus');
  const coinSurplusItemIds = surplusItemIds.filter((itemId) => COIN_ITEM_IDS.has(itemId));
  const sellableSurplusItemIds = surplusItemIds.filter((itemId) => !COIN_ITEM_IDS.has(itemId) && economyByItemId[itemId]?.sellPriceCopper !== undefined);
  const blockingSurplusItemIds = surplusItemIds.filter((itemId) => !COIN_ITEM_IDS.has(itemId) && economyByItemId[itemId]?.sellPriceCopper === undefined);
  const recipeStats = Object.values(result.recipeStats);
  const machineCount = recipeStats.reduce((sum, stat) => sum + Math.max(0, stat.actualMachines || stat.theoreticalMachines || 0), 0);
  const hasMissing = tree.missingItemIds.length > 0 || tree.purchasedItemIds.length > 0 || tree.cycleItemIds.length > 0 || tree.depthLimitItemIds.length > 0 || tree.cauldronDataMissingItemIds.length > 0 || root.status === 'depthLimit';
  const hasConstantSupply = tree.purchasedItemIds.length > 0;
  return {
    selfContained: !hasMissing && !hasConstantSupply,
    noSurplus: surplusItemIds.length === 0,
    hasConstantSupply,
    hasMissing,
    hasBlockingSurplus: blockingSurplusItemIds.length > 0,
    startupCostCopper: tree.initialItemIds.reduce((sum, itemId) => sum + startupCostCopper(itemId, 1), 0),
    purchaseCostCopperPerMin: 0,
    initialItemIds: tree.initialItemIds,
    purchasedItemIds: tree.purchasedItemIds,
    externalItemIds: [],
    unresolvedItemIds: closedUnique([...tree.missingItemIds, ...tree.cycleItemIds, ...tree.depthLimitItemIds, ...tree.cauldronDataMissingItemIds]),
    surplusItemIds,
    coinSurplusItemIds,
    sellableSurplusItemIds,
    blockingSurplusItemIds,
    recipeCount: tree.normalNodeCount + tree.cauldronNodeCount,
    edgeCount: result.flows.length,
    depth: tree.depth,
    machineCount,
    heatRequiredPerMin: result.totals.heatRequiredPerMin ?? 0,
    fuelRequiredPerMin: result.totals.fuelRequiredPerMin ?? 0,
    fertilizerRequiredPerMin: result.totals.fertilizerRequiredPerMin ?? 0,
  };
}

function closedPlanIssues(metrics: CauldronOptimizedPlanMetrics, root: CauldronPlanItem, options: PlanBuildOptions): CauldronOptimizedPlanIssue[] {
  const issues: CauldronOptimizedPlanIssue[] = [];
  if (metrics.selfContained) {
    issues.push({
      code: 'COMPLETE_CLOSED',
      severity: 'info',
      message: { ja: '錬金釜候補・通常レシピ・初期投入だけで閉鎖候補を構成しています。', en: 'Built a closed candidate from cauldron candidates, normal recipes, and startup inputs only.' },
    });
  }
  if (metrics.initialItemIds.length > 0) {
    const names = itemNames(metrics.initialItemIds);
    issues.push({ code: 'INITIAL_INPUT', severity: 'info', itemIds: metrics.initialItemIds, message: { ja: `初期投入: ${names.ja}`, en: `Startup input: ${names.en}` } });
  }
  if (metrics.hasMissing) {
    const names = itemNames(closedUnique([...metrics.unresolvedItemIds, ...metrics.purchasedItemIds]));
    issues.push({ code: 'MISSING', severity: 'error', itemIds: closedUnique([...metrics.unresolvedItemIds, ...metrics.purchasedItemIds]), message: { ja: `閉鎖できない材料があります: ${names.ja || root.itemId}`, en: `Unresolved closed-line materials: ${names.en || root.itemId}` } });
  }
  const treeMetrics = analyzeClosedTree(root);
  if (treeMetrics.cycleItemIds.length > 0) {
    const names = itemNames(treeMetrics.cycleItemIds);
    issues.push({ code: 'CYCLE_UNPROVEN', severity: 'error', itemIds: treeMetrics.cycleItemIds, message: { ja: `循環補填ではなく収支証明が必要です: ${names.ja}`, en: `Cycle requires balance proof, not a placeholder source: ${names.en}` } });
  }
  if (treeMetrics.cauldronDataMissingItemIds.length > 0) {
    const names = itemNames(treeMetrics.cauldronDataMissingItemIds);
    issues.push({ code: 'CAULDRON_DATA_MISSING', severity: 'error', itemIds: treeMetrics.cauldronDataMissingItemIds, message: { ja: `錬金釜ターゲット値が未登録です: ${names.ja}`, en: `Missing cauldron target values: ${names.en}` } });
  }
  if (options.settings.fuel.enabled && options.settings.fuel.sourceMode === 'internal') {
    issues.push({ code: 'INITIAL_INPUT', severity: 'info', itemIds: [options.settings.fuel.fuelItemId], message: { ja: `燃料は設定値を内製対象にしています: ${labelForItem(options.settings.fuel.fuelItemId).ja}`, en: `Fuel follows settings as internal: ${labelForItem(options.settings.fuel.fuelItemId).en}` } });
  }
  if (options.settings.fertilizer.enabled && options.settings.fertilizer.sourceMode === 'internal') {
    issues.push({ code: 'INITIAL_INPUT', severity: 'info', itemIds: [options.settings.fertilizer.fertilizerItemId], message: { ja: `肥料は設定値を内製対象にしています: ${labelForItem(options.settings.fertilizer.fertilizerItemId).ja}`, en: `Fertilizer follows settings as internal: ${labelForItem(options.settings.fertilizer.fertilizerItemId).en}` } });
  }
  return issues;
}

function closedPlanStatus(metrics: CauldronOptimizedPlanMetrics): CauldronOptimizedPlan['status'] {
  if (metrics.hasMissing) return 'blocked';
  if (metrics.selfContained && metrics.noSurplus) return metrics.initialItemIds.length > 0 ? 'closed' : 'perfect';
  return 'warning';
}

function closedPlanScore(metrics: CauldronOptimizedPlanMetrics): number {
  let score = 0;
  if (!metrics.hasMissing) score += 1_000_000_000;
  if (metrics.selfContained) score += 250_000_000;
  if (metrics.noSurplus) score += 50_000_000;
  score -= metrics.unresolvedItemIds.length * 80_000_000;
  score -= metrics.purchasedItemIds.length * 40_000_000;
  score -= metrics.recipeCount * 10_000;
  score -= metrics.depth * 1_000;
  return score;
}

function closedOutputRateForRecipe(recipe: Recipe, itemId: string): number {
  const amount = recipeOutputAmount(recipe, itemId);
  return recipe.timeSec > CLOSED_LINE_EPS ? amount * 60 / recipe.timeSec : 0;
}

function closedRecipeDisplayName(node: CauldronPlanItem, recipe?: Recipe): LocalizedText {
  if (node.status === 'cauldronTarget') {
    const label = labelForItem(node.itemId);
    return { ja: `${label.ja}（錬金釜）`, en: `${label.en} (Cauldron)` };
  }
  return recipe?.name ?? labelForItem(node.itemId);
}

function closedEmptyItemStat(itemId: string): ItemStat {
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

function closedAddItemStat(stats: Record<string, ItemStat>, itemId: string): ItemStat {
  stats[itemId] = stats[itemId] ?? closedEmptyItemStat(itemId);
  return stats[itemId];
}

function closedFlowTransport(itemId: string, rate: number): ReturnType<typeof flowTransportForItem> {
  return flowTransportForItem(itemId, rate, 60);
}


function closedResultTotals(options: PlanBuildOptions): CalculationResult['totals'] {
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
    fuelItemId: options.settings.fuel.fuelItemId,
    fertilizerNutrientsRequiredPerMin: 0,
    fertilizerRequiredPerMin: 0,
    fertilizerItemId: options.settings.fertilizer.fertilizerItemId,
    calculationMs: 0,
    queueSteps: 0,
    queueMax: 0,
  };
}

function closedBlockedResult(root: CauldronPlanItem, analysis: ClosedTreeMetrics, options: PlanBuildOptions): CalculationResult {
  const itemStats: Record<string, ItemStat> = {};
  const rootStat = closedEmptyItemStat(root.itemId);
  rootStat.targetRequested = root.amount;
  itemStats[root.itemId] = rootStat;
  const unresolved = closedUnique([
    ...analysis.missingItemIds,
    ...analysis.purchasedItemIds,
    ...analysis.cycleItemIds,
    ...analysis.depthLimitItemIds,
    ...analysis.cauldronDataMissingItemIds,
  ]);
  return {
    itemStats,
    recipeStats: {},
    flows: [],
    conveyorEdges: [],
    outputEdges: [],
    warnings: [
      {
        messageJa: '閉鎖ラインとして未完結のため、誤ったグラフは表示しません。上のレシピ案とエラー理由を確認してください。',
        messageEn: 'The closed-line plan is incomplete, so an incorrect graph is not rendered. Check the recipe plan and error reasons above.',
      },
    ],
    calculationStatus: 'invalid',
    errorSummaries: [
      {
        code: 'CAULDRON_CLOSED_LINE_BLOCKED',
        messageJa: '閉鎖ラインとして解決できません。循環補填や未登録の錬金釜ターゲットは材料供給として扱いません。',
        messageEn: 'The closed line could not be resolved. Cycle placeholders and missing cauldron target values are not treated as material supply.',
        itemIds: unresolved,
      },
    ],
    totals: closedResultTotals(options),
  };
}

function buildClosedResultFromTree(root: CauldronPlanItem, options: PlanBuildOptions): CalculationResult {
  const initialAnalysis = analyzeClosedTree(root);
  const blocked = initialAnalysis.missingItemIds.length > 0
    || initialAnalysis.purchasedItemIds.length > 0
    || initialAnalysis.cycleItemIds.length > 0
    || initialAnalysis.depthLimitItemIds.length > 0
    || initialAnalysis.cauldronDataMissingItemIds.length > 0;
  if (blocked) return closedBlockedResult(root, initialAnalysis, options);

  const itemStats: Record<string, ItemStat> = {};
  const recipeStats: Record<string, RecipeStat> = {};
  const flows: CalculatedFlow[] = [];
  let flowSerial = 0;
  const recipeUseCount: Record<string, number> = {};

  function addFlow(from: CalculatedFlow['from'], to: CalculatedFlow['to'], itemId: string, rate: number, role: CalculatedFlow['role']): void {
    if (rate <= CLOSED_LINE_EPS) return;
    const transport = closedFlowTransport(itemId, rate);
    flows.push({
      id: `closed-cauldron-flow:${flowSerial += 1}:${itemId}`,
      from,
      to,
      itemId,
      rate,
      belts: transport.belts,
      transportKind: transport.transportKind,
      transportUnits: transport.transportUnits,
      role,
    });
  }

  function recipeIdForNode(node: CauldronPlanItem): string | undefined {
    if (node.status === 'normal' && node.recipeId) {
      const count = recipeUseCount[node.recipeId] ?? 0;
      recipeUseCount[node.recipeId] = count + 1;
      return count === 0 ? node.recipeId : `${node.recipeId}:closed:${count}`;
    }
    if (node.status === 'cauldronTarget') {
      const inputKey = node.selectedInputItemIds?.join('+') || 'auto';
      const id = `cauldron:closed:${options.state.machineId}:${node.itemId}:${inputKey}`;
      const count = recipeUseCount[id] ?? 0;
      recipeUseCount[id] = count + 1;
      return count === 0 ? id : `${id}:${count}`;
    }
    return undefined;
  }

  function visit(node: CauldronPlanItem, parentRecipeId?: string, isRoot = false): string | undefined {
    const recipeId = recipeIdForNode(node);
    if (!recipeId) {
      const stat = closedAddItemStat(itemStats, node.itemId);
      if (node.status === 'startup') stat.initialPurchased += node.amount;
      if (node.status === 'missing' || node.status === 'depthLimit') stat.purchased += node.amount;
      if (parentRecipeId) {
        addFlow(
          { type: 'itemSource', itemId: node.itemId, sourceMode: node.status === 'startup' ? 'cycleInput' : 'unresolved' },
          { type: 'recipe', recipeId: parentRecipeId },
          node.itemId,
          node.amount,
          'material',
        );
        closedAddItemStat(itemStats, node.itemId).consumed += node.amount;
      }
      return undefined;
    }

    const recipe = node.recipeId ? recipeById[node.recipeId] : undefined;
    const inputRates: Record<string, number> = {};
    for (const child of node.children) {
      inputRates[child.itemId] = (inputRates[child.itemId] ?? 0) + child.amount;
      visit(child, recipeId, false);
      closedAddItemStat(itemStats, child.itemId).consumed += child.amount;
    }

    const outputRates = { [node.itemId]: node.amount };
    const netRates = { [node.itemId]: node.amount };
    for (const [itemId, rate] of Object.entries(inputRates)) {
      netRates[itemId] = (netRates[itemId] ?? 0) - rate;
    }
    const perMachineProductionRate = recipe ? closedOutputRateForRecipe(recipe, node.itemId) : (node.status === 'cauldronTarget' ? 1 : node.amount);
    const theoreticalMachines = perMachineProductionRate > CLOSED_LINE_EPS ? node.amount / perMachineProductionRate : 0;
    recipeStats[recipeId] = {
      recipeId,
      machineId: node.status === 'cauldronTarget' ? options.state.machineId : recipe?.machineId ?? 'unknown',
      displayName: closedRecipeDisplayName(node, recipe),
      theoreticalMachines,
      actualMachines: theoreticalMachines,
      runsPerMinute: node.amount,
      positiveNetProductionRate: node.amount,
      perMachineProductionRate,
      inputRates,
      outputRates,
      netRates,
      surplusOutputRates: {},
      discardedOutputRates: {},
      targetIds: isRoot ? [node.itemId] : [],
    };

    const outStat = closedAddItemStat(itemStats, node.itemId);
    outStat.produced += node.amount;
    if (isRoot) {
      outStat.targetRequested += node.amount;
      outStat.targetActual += node.amount;
      addFlow({ type: 'recipe', recipeId }, { type: 'itemSink', itemId: node.itemId, sinkMode: 'final' }, node.itemId, node.amount, 'finalOutput');
    } else if (parentRecipeId) {
      addFlow({ type: 'recipe', recipeId }, { type: 'recipe', recipeId: parentRecipeId }, node.itemId, node.amount, 'material');
    }
    return recipeId;
  }

  visit(root, undefined, true);
  const analysis = analyzeClosedTree(root);
  const hasMissing = analysis.missingItemIds.length > 0 || analysis.purchasedItemIds.length > 0 || analysis.cycleItemIds.length > 0 || analysis.depthLimitItemIds.length > 0 || analysis.cauldronDataMissingItemIds.length > 0;
  return {
    itemStats,
    recipeStats,
    flows,
    conveyorEdges: [],
    outputEdges: [],
    warnings: [],
    calculationStatus: hasMissing ? 'invalid' : 'ok',
    errorSummaries: hasMissing
      ? [{ code: 'CAULDRON_CLOSED_LINE_UNRESOLVED', messageJa: '閉鎖ラインとして解決できない材料があります。', messageEn: 'Some materials could not be resolved as a closed line.', itemIds: closedUnique([...analysis.missingItemIds, ...analysis.purchasedItemIds]) }]
      : [],
    totals: {
      ...closedResultTotals(options),
      initialCostCopper: analysis.initialItemIds.reduce((sum, itemId) => sum + startupCostCopper(itemId, 1), 0),
    },
  };
}

export function optimizeCauldronTargetWithResult(options: PlanBuildOptions): ClosedLinePlanBundle {
  const targetLabel = labelForItem(options.targetItemId);
  const root = buildClosedRoot(options);
  const result = buildClosedResultFromTree(root, options);
  const metrics = metricsFromClosedTree(root, result);
  const status = closedPlanStatus(metrics);
  const plan: CauldronOptimizedPlan = {
    id: `closed-line:${options.targetItemId}`,
    rank: 1,
    source: CAULDRON_TARGETS[options.targetItemId] ? 'cauldron' : 'normal',
    status,
    score: closedPlanScore(metrics),
    targetItemId: options.targetItemId,
    targetLabel,
    title: { ja: `${targetLabel.ja} 閉鎖ライン`, en: `${targetLabel.en} closed line` },
    summary: metrics.hasMissing
      ? { ja: '錬金釜候補を優先して通常レシピへフォールバックしましたが、未解決材料があります。', en: 'Tried cauldron candidates first and then normal recipes, but some materials remain unresolved.' }
      : { ja: '錬金釜候補を優先し、3入力も含めて通常レシピ/初期投入まで再帰的に解決しました。', en: 'Resolved recursively from cauldron candidates through their three inputs, normal recipes, and startup inputs.' },
    targetRatePerMinute: options.targetRatePerMinute,
    selectedInputItemIds: root.selectedInputItemIds,
    cauldronCandidateId: root.status === 'cauldronTarget' ? `closed-line:${options.targetItemId}:${root.selectedInputItemIds?.join('+') ?? 'auto'}` : undefined,
    cauldronDistanceRatio: undefined,
    root,
    metrics,
    issues: closedPlanIssues(metrics, root, options),
  };
  return {
    optimization: {
      targetItemId: options.targetItemId,
      targetLabel,
      bestPlan: plan,
      plans: [plan],
    },
    result,
  };
}
