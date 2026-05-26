import { CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
import {
  findPlantDerivedCauldronCandidatesForOutput,
  isPlantDerivedCauldronInputItem,
  plantDerivedCauldronInputCount,
  type CauldronRuntimeCandidate,
} from './cauldronCandidateSearch';
import type { CauldronMachineId, CauldronOptimizationResult, CauldronOptimizedPlan, CauldronOptimizedPlanIssue, CauldronPlanItem } from './cauldronTypes';
import type { CalculationResult, CalculatedFlow, ItemStat, RecipeStat } from '../engine/calculate';
import type { AppSettings, LocalizedText, Recipe } from '../types';
import { itemById } from '../data/items';
import { chooseRecipeForItem } from '../engine/itemSourceResolver';
import { flowTransportForItem } from '../engine/flowTransport';

const MAX_DEPTH = 9;

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
      sourceKind: 'startup' | 'plantDerivedInput' | 'unresolved';
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
        ja: `${name.ja} は植物系・植物加工品だけでは3入力候補が見つかりませんでした。候補プール: ${plantDerivedCauldronInputCount()}件`,
        en: `No three-input plant-derived cauldron candidate was found for ${name.en}. Pool: ${plantDerivedCauldronInputCount()} items.`,
      };
    case 'INPUT_NOT_PLANT_DERIVED':
      return { ja: `${name.ja} は植物由来の錬金釜入力候補ではありません。`, en: `${name.en} is not a plant-derived cauldron input candidate.` };
    case 'CYCLE':
      return { ja: `${name.ja} の探索中に循環しました。`, en: `A cycle was detected while expanding ${name.en}.` };
    case 'DEPTH_LIMIT':
      return { ja: `${name.ja} の探索が深さ上限に達しました。`, en: `Expansion for ${name.en} reached the depth limit.` };
    case 'NO_NORMAL_RECIPE':
      return { ja: `${name.ja} を通過展開する通常レシピがありません。`, en: `No normal recipe was found to bridge through ${name.en}.` };
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
  sourceKind: 'startup' | 'plantDerivedInput' | 'unresolved',
  reason?: LocalizedText,
): CauldronPlanNode {
  const name = itemName(itemId);
  return {
    kind: 'source',
    itemId,
    amount,
    sourceKind,
    reason: reason ?? (sourceKind === 'startup'
      ? { ja: `${name.ja} は起動入力として扱います。`, en: `${name.en} is treated as a startup input.` }
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

function resolveCauldronInput(itemId: string, amount: number): ResolveResult {
  if (!isPlantDerivedCauldronInputItem(itemId)) {
    const failure = makeFailure('INPUT_NOT_PLANT_DERIVED', itemId);
    return { ok: false, node: sourceNode(itemId, amount, 'unresolved', failure.message), failures: [failure] };
  }
  return { ok: true, node: sourceNode(itemId, amount, 'plantDerivedInput'), failures: [] };
}

function resolveCauldronOutput(
  itemId: string,
  amount: number,
  policy: CauldronPlannerPolicy,
): ResolveResult {
  if (!CAULDRON_TARGETS[itemId]) return failedResult('NOT_CAULDRON_TARGET', itemId, policy, amount);
  const candidates = findPlantDerivedCauldronCandidatesForOutput(itemId);
  if (candidates.length === 0) return failedResult('NO_CAULDRON_CANDIDATE', itemId, policy, amount);

  const candidateFailures: CauldronOnlyFailure[] = [];
  for (const candidate of candidates) {
    const children: CauldronPlanChild[] = [];
    const failures: CauldronOnlyFailure[] = [];
    candidate.inputItemIds.forEach((childItemId, index) => {
      const slotIndex = index as 0 | 1 | 2;
      const child = resolveCauldronInput(childItemId, amount);
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
  if (!recipe) return failedResult('NO_NORMAL_RECIPE', itemId, policy, amount);
  const outputAmount = recipeOutputAmount(recipe, itemId);
  if (outputAmount <= 0) return failedResult('NO_NORMAL_RECIPE', itemId, policy, amount);

  const runsPerMinute = amount / outputAmount;
  const children: CauldronPlanChild[] = [];
  const failures: CauldronOnlyFailure[] = [];

  for (const input of recipe.inputs) {
    if (input.kind === 'paradoxableItem') {
      failures.push(makeFailure('UNSUPPORTED_RECIPE_INPUT', itemId));
      continue;
    }
    const childAmount = input.amount * runsPerMinute;
    const child = resolveOutputItem(input.itemId, childAmount, policy, recipePreferences, depth - 1, path, memo);
    if (!child.ok) failures.push(...child.failures);
    children.push({ itemId: input.itemId, amount: childAmount, node: child.node ?? sourceNode(input.itemId, childAmount, 'unresolved') });
  }

  const node: CauldronPlanNode = { kind: 'normal', itemId, amount, recipe, recipeId: recipe.id, runsPerMinute, children };
  return { ok: failures.length === 0, node, failures };
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
    const cauldron = resolveCauldronOutput(itemId, amount, policy);
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

function emptyTotals(settings: AppSettings): CalculationResult['totals'] {
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

function sourceModeForSourceKind(sourceKind: 'startup' | 'plantDerivedInput' | 'unresolved'): 'cycleInput' | 'plantDerivedInput' | 'unresolved' {
  if (sourceKind === 'startup') return 'cycleInput';
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
  sourceMode: 'cycleInput' | 'plantDerivedInput' | 'unresolved' = 'unresolved',
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

function buildCalculationResult(root: CauldronPlanNode, settings: AppSettings, machineId: CauldronMachineId, ok: boolean, failures: CauldronOnlyFailure[], mode: CauldronResolveMode): CalculationResult {
  const itemStats: Record<string, ItemStat> = {};
  const recipeStats: Record<string, RecipeStat> = {};
  const flows: CalculatedFlow[] = [];
  let nodeIndex = 0;

  function visit(node: CauldronPlanNode, parentRecipeId?: string, parentSlotIndex?: number, pathKey = 'root'): string | undefined {
    if (node.kind === 'source') {
      const stat = addItemStat(itemStats, node.itemId);
      if (node.sourceKind === 'startup') stat.initialPurchased += node.amount;
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
    totals: emptyTotals(settings),
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
      status: node.sourceKind === 'startup' ? 'startup' : node.sourceKind === 'plantDerivedInput' ? 'plantDerivedInput' : 'missing',
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
    candidateCount: node.kind === 'cauldron' ? findPlantDerivedCauldronCandidatesForOutput(node.itemId).length : undefined,
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

function countNodes(node: CauldronPlanNode): { recipes: number; edges: number; depth: number; missing: string[]; initial: string[] } {
  if (node.kind === 'source') {
    return { recipes: 0, edges: 0, depth: 0, missing: node.sourceKind === 'unresolved' ? [node.itemId] : [], initial: node.sourceKind === 'startup' ? [node.itemId] : [] };
  }
  let recipes = 1;
  let edges = node.children.length + 1;
  let depth = 1;
  const missing: string[] = [];
  const initial: string[] = [];
  for (const child of node.children) {
    const next = countNodes(child.node);
    recipes += next.recipes;
    edges += next.edges;
    depth = Math.max(depth, next.depth + 1);
    missing.push(...next.missing);
    initial.push(...next.initial);
  }
  return { recipes, edges, depth, missing, initial };
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
    summary: { ja: resolved.ok ? '錬金釜候補があります。' : '未解決を含む候補です。', en: resolved.ok ? 'A cauldron candidate was found.' : 'The candidate contains unresolved inputs.' },
    targetRatePerMinute: amount,
    selectedInputItemIds: resolved.node.kind === 'cauldron' ? [...resolved.node.candidate.inputItemIds] as [string, string, string] : undefined,
    root: rootPlan,
    metrics: {
      selfContained: resolved.ok,
      noSurplus: true,
      hasConstantSupply: false,
      hasMissing: !resolved.ok || counts.missing.length > 0,
      hasBlockingSurplus: false,
      startupCostCopper: 0,
      purchaseCostCopperPerMin: 0,
      initialItemIds: Array.from(new Set(counts.initial)),
      purchasedItemIds: [],
      externalItemIds: [],
      unresolvedItemIds: Array.from(new Set(counts.missing.length ? counts.missing : resolved.ok ? [] : [options.targetItemId])),
      surplusItemIds: [],
      coinSurplusItemIds: [],
      sellableSurplusItemIds: [],
      blockingSurplusItemIds: [],
      recipeCount: counts.recipes,
      edgeCount: counts.edges,
      depth: counts.depth,
      machineCount: counts.recipes,
      heatRequiredPerMin: 0,
      fuelRequiredPerMin: 0,
      fertilizerRequiredPerMin: 0,
    },
    issues,
  };

  return { result, optimization: { targetItemId: options.targetItemId, targetLabel, bestPlan, plans: [bestPlan] } };
}
