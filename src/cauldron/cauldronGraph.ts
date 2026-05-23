import type { CalculationResult, CalculatedFlow, ItemStat, RecipeStat } from '../engine/calculate';
import type { Lang } from '../types';
import { itemById } from '../data/items';
import { text } from '../i18n';
import { CAULDRON_TARGETS } from './cauldronData';
import { generateCauldronCandidatesForOutput, normalizeCauldronInputTuple, predictCauldron } from './cauldronMath';
import type { CauldronCandidate, CauldronInputTuple, CauldronMachineId, CauldronPrediction, CauldronState } from './cauldronTypes';

export type CauldronGraphRequest = {
  enabled?: boolean;
  machineId?: CauldronMachineId;
  targetItemId?: string;
  inputItemIds?: string[];
  candidateIndex?: number;
  maxCandidates?: number;
  allowDuplicateInputs?: boolean;
};

export type NormalizedCauldronGraphRequest = {
  enabled: boolean;
  machineId: CauldronMachineId;
  targetItemId: string;
  inputItemIds?: CauldronInputTuple;
  candidateIndex: number;
  maxCandidates: number;
  allowDuplicateInputs: boolean;
};

export type CauldronGraphBuildSummary = {
  status: 'ok' | 'invalid';
  code?: string;
  messageJa?: string;
  messageEn?: string;
  machineId: CauldronMachineId;
  targetItemId: string;
  selectedInputItemIds: CauldronInputTuple;
  selectedOutputItemId?: string;
  candidateCount: number;
  selectedCandidateIndex: number;
  score: number;
  duplicatePenalty: number;
  targetValue?: number;
  distance?: number;
  timeSec?: number;
  outputPerMinute?: number;
  graphNodeCount: number;
  graphEdgeCount: number;
};

export type CauldronGraphBuildResult = {
  request: NormalizedCauldronGraphRequest;
  prediction: CauldronPrediction;
  selectedCandidate?: CauldronCandidate;
  candidates: CauldronCandidate[];
  result: CalculationResult;
  summary: CauldronGraphBuildSummary;
};

const EMPTY_TOTALS: CalculationResult['totals'] = {
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
  fuelItemId: 'charcoal_powder',
  fertilizerNutrientsRequiredPerMin: 0,
  fertilizerRequiredPerMin: 0,
  fertilizerItemId: 'basic_fertilizer',
};

function itemLabel(itemId: string): { ja: string; en: string } {
  return itemById[itemId]?.name ?? { ja: itemId, en: itemId };
}

function itemName(itemId: string, lang: Lang): string {
  return text(itemLabel(itemId), lang);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const next = Math.floor(Number(value));
  if (!Number.isFinite(next)) return fallback;
  return Math.max(min, Math.min(max, next));
}

export function normalizeCauldronGraphRequest(value: unknown, fallback?: Partial<CauldronState>): NormalizedCauldronGraphRequest {
  const source = (value && typeof value === 'object' ? value : {}) as Partial<CauldronGraphRequest>;
  const fallbackMachineId = fallback?.machineId ?? 'cauldron';
  const machineId: CauldronMachineId = source.machineId === 'advanced_cauldron' ? 'advanced_cauldron' : fallbackMachineId;
  const targetItemId = String(source.targetItemId ?? fallback?.candidateTargetItemId ?? 'perfect_diamond');
  const rawInputs = Array.isArray(source.inputItemIds) ? source.inputItemIds.map(String) : undefined;
  const inputItemIds = rawInputs ? normalizeCauldronInputTuple(rawInputs) : undefined;
  return {
    enabled: source.enabled !== false,
    machineId,
    targetItemId,
    inputItemIds,
    candidateIndex: clampInteger(source.candidateIndex ?? fallback?.candidateIndex, 0, 0, 9999),
    maxCandidates: clampInteger(source.maxCandidates ?? fallback?.maxCandidates, 20, 1, 500),
    allowDuplicateInputs: source.allowDuplicateInputs ?? fallback?.allowDuplicateInputs ?? true,
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

function addStat(stats: Record<string, ItemStat>, itemId: string): ItemStat {
  stats[itemId] = stats[itemId] ?? emptyItemStat(itemId);
  return stats[itemId];
}

function countInputs(inputItemIds: CauldronInputTuple): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const itemId of inputItemIds) {
    if (!itemId) continue;
    counts[itemId] = (counts[itemId] ?? 0) + 1;
  }
  return counts;
}

function buildRecipeDisplayName(outputItemId: string | undefined): { ja: string; en: string } {
  if (!outputItemId) return { ja: '錬金釜候補', en: 'Cauldron candidate' };
  const label = itemLabel(outputItemId);
  return {
    ja: `${label.ja}（錬金釜）`,
    en: `${label.en} (Cauldron)`,
  };
}

function candidateFromRequest(request: NormalizedCauldronGraphRequest): { prediction: CauldronPrediction; selectedCandidate?: CauldronCandidate; candidates: CauldronCandidate[] } {
  if (request.inputItemIds) {
    const prediction = predictCauldron(request.inputItemIds);
    return { prediction, candidates: [] };
  }
  const candidates = generateCauldronCandidatesForOutput(request.targetItemId, {
    allowDuplicateInputs: request.allowDuplicateInputs,
    maxCandidates: request.maxCandidates,
  });
  const selectedCandidate = candidates[Math.min(request.candidateIndex, Math.max(0, candidates.length - 1))];
  if (selectedCandidate) return { prediction: selectedCandidate, selectedCandidate, candidates };
  const prediction = predictCauldron(['', '', '']);
  return { prediction, candidates };
}

function cauldronGraphError(code: string, ja: string, en: string): { status: 'invalid'; code: string; messageJa: string; messageEn: string } {
  return { status: 'invalid', code, messageJa: ja, messageEn: en };
}

function validateCauldronBuild(
  request: NormalizedCauldronGraphRequest,
  prediction: CauldronPrediction,
  selectedCandidate: CauldronCandidate | undefined,
  candidates: CauldronCandidate[],
  outputItemId: string | undefined,
  outputPerMinute: number | undefined,
): { status: 'ok' | 'invalid'; code?: string; messageJa?: string; messageEn?: string } {
  if (prediction.missingInputItemIds.length > 0) {
    return cauldronGraphError(
      'CAULDRON_INPUT_VALUE_MISSING',
      '錬金釜入力値が未登録のアイテムがあります。',
      'Some cauldron input values are not registered.',
    );
  }
  if (!request.inputItemIds && !selectedCandidate) {
    return cauldronGraphError(
      'CAULDRON_NO_CANDIDATE',
      '指定ターゲットに一致する錬金釜候補がありません。',
      'No cauldron candidate matches the requested target.',
    );
  }
  if (!outputItemId) {
    return cauldronGraphError(
      'CAULDRON_OUTPUT_UNRESOLVED',
      '錬金釜出力を特定できません。',
      'The cauldron output could not be resolved.',
    );
  }
  if (request.targetItemId && outputItemId !== request.targetItemId) {
    return cauldronGraphError(
      'CAULDRON_TARGET_MISMATCH',
      '指定ターゲットと錬金釜予測出力が一致していません。',
      'The requested target does not match the predicted cauldron output.',
    );
  }
  if (outputPerMinute === undefined) {
    return cauldronGraphError(
      'CAULDRON_TIME_UNVERIFIED',
      '錬金釜の処理時間が未確認のため、通常グラフ形式の/min表示を確定できません。',
      'The cauldron processing time is unverified, so /min graph display cannot be confirmed.',
    );
  }
  return { status: 'ok' };
}

export function buildCauldronGraphResult(rawRequest: unknown, fallback?: Partial<CauldronState>): CauldronGraphBuildResult {
  const request = normalizeCauldronGraphRequest(rawRequest, fallback);
  const { prediction, selectedCandidate, candidates } = candidateFromRequest(request);
  const outputItemId = prediction.outputItemId;
  const target = outputItemId ? CAULDRON_TARGETS[outputItemId] : undefined;
  const timeSec = selectedCandidate?.targetTimeSec ?? target?.timeSec;
  const outputPerMinute = timeSec && timeSec > 0 ? 60 / timeSec : undefined;
  const validation = validateCauldronBuild(request, prediction, selectedCandidate, candidates, outputItemId, outputPerMinute);
  const canBuildTimedGraph = validation.status === 'ok' && outputItemId !== undefined && outputPerMinute !== undefined;
  const inputCounts = countInputs(prediction.inputItemIds);
  const recipeId = `cauldron:auto:${request.machineId}:${outputItemId ?? 'unknown'}:${prediction.inputItemIds.filter(Boolean).join('+') || 'unresolved'}`;
  const itemStats: Record<string, ItemStat> = {};
  const flows: CalculatedFlow[] = [];
  const inputRates: Record<string, number> = {};
  const outputRates: Record<string, number> = {};

  if (canBuildTimedGraph) {
    for (const [itemId, amount] of Object.entries(inputCounts)) {
      const rate = amount * outputPerMinute;
      inputRates[itemId] = rate;
      const stat = addStat(itemStats, itemId);
      stat.consumed += rate;
      flows.push({
        id: `cauldron-flow:${recipeId}:in:${itemId}`,
        from: { type: 'itemSource', itemId, sourceMode: 'external' },
        to: { type: 'recipe', recipeId },
        itemId,
        rate,
        belts: 0,
        transportKind: 'belt',
        transportUnits: 0,
        role: 'material',
      });
    }

    outputRates[outputItemId] = outputPerMinute;
    const outputStat = addStat(itemStats, outputItemId);
    outputStat.produced += outputPerMinute;
    outputStat.targetRequested = outputPerMinute;
    outputStat.targetActual = outputPerMinute;
    flows.push({
      id: `cauldron-flow:${recipeId}:out:${outputItemId}`,
      from: { type: 'recipe', recipeId },
      to: { type: 'itemSink', itemId: outputItemId, sinkMode: 'final' },
      itemId: outputItemId,
      rate: outputPerMinute,
      belts: 0,
      transportKind: 'belt',
      transportUnits: 0,
      role: 'finalOutput',
    });
  }

  const recipeStat: RecipeStat = {
    recipeId,
    machineId: request.machineId,
    displayName: buildRecipeDisplayName(outputItemId),
    theoreticalMachines: canBuildTimedGraph ? 1 : 0,
    actualMachines: canBuildTimedGraph ? 1 : 0,
    runsPerMinute: canBuildTimedGraph ? outputPerMinute : 0,
    positiveNetProductionRate: canBuildTimedGraph ? outputPerMinute : 0,
    perMachineProductionRate: canBuildTimedGraph ? outputPerMinute : 0,
    inputRates,
    outputRates,
    netRates: { ...outputRates },
    surplusOutputRates: {},
    discardedOutputRates: {},
    targetIds: outputItemId ? [outputItemId] : [],
  };

  const errorSummaries = validation.status === 'ok' ? [] : [{
    code: validation.code ?? 'CAULDRON_GRAPH_INVALID',
    messageJa: validation.messageJa ?? '錬金釜グラフを生成できません。',
    messageEn: validation.messageEn ?? 'The cauldron graph could not be generated.',
  }];

  const result: CalculationResult = {
    itemStats,
    recipeStats: canBuildTimedGraph ? { [recipeId]: recipeStat } : {},
    flows,
    conveyorEdges: [],
    outputEdges: [],
    warnings: [],
    calculationStatus: validation.status,
    errorSummaries,
    totals: {
      ...EMPTY_TOTALS,
      calculationMs: 0,
      queueSteps: 0,
      queueMax: 0,
    },
  };

  const summary: CauldronGraphBuildSummary = {
    status: validation.status,
    code: validation.code,
    messageJa: validation.messageJa,
    messageEn: validation.messageEn,
    machineId: request.machineId,
    targetItemId: request.targetItemId,
    selectedInputItemIds: prediction.inputItemIds,
    selectedOutputItemId: outputItemId,
    candidateCount: candidates.length,
    selectedCandidateIndex: selectedCandidate ? Math.min(request.candidateIndex, Math.max(0, candidates.length - 1)) : -1,
    score: prediction.adjustedScore,
    duplicatePenalty: prediction.duplicatePenalty,
    targetValue: prediction.targetValue,
    distance: prediction.distance,
    timeSec,
    outputPerMinute,
    graphNodeCount: Object.keys(itemStats).length + (canBuildTimedGraph ? 1 : 0),
    graphEdgeCount: flows.length,
  };

  return { request, prediction, selectedCandidate, candidates, result, summary };
}

export function cauldronRequestFromState(state: CauldronState): CauldronGraphRequest {
  return {
    enabled: true,
    machineId: state.machineId,
    targetItemId: state.candidateTargetItemId,
    candidateIndex: state.candidateIndex,
    maxCandidates: state.maxCandidates,
    allowDuplicateInputs: state.allowDuplicateInputs,
  };
}

export function cauldronStateFromRequest(current: CauldronState, rawRequest: unknown): CauldronState {
  const request = normalizeCauldronGraphRequest(rawRequest, current);
  const built = buildCauldronGraphResult(request, current);
  return {
    ...current,
    machineId: request.machineId,
    candidateTargetItemId: request.targetItemId,
    candidateIndex: request.candidateIndex,
    maxCandidates: request.maxCandidates,
    allowDuplicateInputs: request.allowDuplicateInputs,
    inputItemIds: built.prediction.inputItemIds,
  };
}

export function cauldronGraphSummaryText(build: CauldronGraphBuildResult, lang: Lang): string {
  const output = build.summary.selectedOutputItemId ? itemName(build.summary.selectedOutputItemId, lang) : '-';
  const input = build.summary.selectedInputItemIds.map((itemId) => itemName(itemId, lang)).join(' + ');
  return lang === 'ja'
    ? `${input} → ${output}`
    : `${input} -> ${output}`;
}
