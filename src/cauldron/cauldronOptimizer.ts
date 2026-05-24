import { itemById } from '../data/items';
import { economyByItemId } from '../data/economy';
import { getRecipeCandidatesForItem } from '../engine/itemSourceResolver';
import { calculate } from '../engine/calculate';
import type { CalculationResult, ItemStat } from '../engine/calculate';
import type { AbilitySettings, AppSettings, LocalizedText, ProductionTarget, Recipe, RecipeInput, SurplusPolicy } from '../types';
import { text } from '../i18n';
import { CAULDRON_TARGETS } from './cauldronData';
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
