import { CAULDRON_INPUT_ITEM_IDS, CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
import { calcBaseCauldronHeatPerSec, calcBaseCauldronTimeSec } from './cauldronPhysics';
import type { CauldronInputTuple } from './cauldronTypes';
import { ITEMS, itemById } from '../data/items';
import { CAULDRON_INPUT_PREFERENCE_ORDER } from '../types';
import type { CauldronInputPreference } from '../types';

const EPS = 1e-9;
const CURRENCY_ITEM_IDS = new Set(['copper_coin', 'silver_coin', 'gold_coin']);

export type CauldronRuntimeCandidate = {
  outputItemId: string;
  inputItemIds: CauldronInputTuple;
  rawScore: number;
  duplicatePenalty: number;
  adjustedScore: number;
  weightedDistance: number;
  duplicateItemCount: number;
  maxDuplicateCount: number;
  overTargetInputCount: number;
  overTargetExcessTotal: number;
  overTargetExcessMax: number;
  targetValue: number;
  targetMultiplier: number;
  baseTimeSec: number;
  baseHeatPerSec: number;
  stageId?: CauldronCandidateStageId;
};

export type CauldronCandidateStageId =
  | 'plantSimple'
  | 'plantWithLightIntermediate'
  | 'lowCostPurchase'
  | 'mixedHighValue'
  | 'fallback';

export type CauldronCandidateStage = {
  id: CauldronCandidateStageId;
  label: string;
  inputItemIds: string[];
  reachable: boolean;
};

export type AcceptedAdjustedRange = { min: number; max: number };

export function duplicatePenaltyForCauldronInput(inputItemIds: CauldronInputTuple): number {
  const uniqueCount = new Set(inputItemIds).size;
  if (uniqueCount <= 1) return 0.5;
  if (uniqueCount === 2) return 0.65;
  return 1;
}

export function cauldronRawScore(inputItemIds: CauldronInputTuple): number | undefined {
  let total = 0;
  for (const itemId of inputItemIds) {
    const value = CAULDRON_INPUT_VALUES[itemId]?.value;
    if (!Number.isFinite(value)) return undefined;
    total += value;
  }
  return total;
}

export function cauldronAdjustedScore(inputItemIds: CauldronInputTuple): number | undefined {
  const rawScore = cauldronRawScore(inputItemIds);
  if (rawScore === undefined) return undefined;
  return rawScore * duplicatePenaltyForCauldronInput(inputItemIds);
}

export function predictCauldronOutput(inputItemIds: CauldronInputTuple): { outputItemId: string; weightedDistance: number; adjustedScore: number; rawScore: number; duplicatePenalty: number } | undefined {
  const rawScore = cauldronRawScore(inputItemIds);
  if (rawScore === undefined) return undefined;
  const duplicatePenalty = duplicatePenaltyForCauldronInput(inputItemIds);
  const adjustedScore = rawScore * duplicatePenalty;
  const best = predictCauldronOutputForAdjustedScoreDetailed(adjustedScore);
  return best ? { outputItemId: best.outputItemId, weightedDistance: best.weightedDistance, adjustedScore, rawScore, duplicatePenalty } : undefined;
}

function predictCauldronOutputForAdjustedScoreDetailed(adjustedScore: number): { outputItemId: string; weightedDistance: number; targetValue: number } | undefined {
  let best: { outputItemId: string; weightedDistance: number; targetValue: number } | undefined;

  for (const target of Object.values(CAULDRON_TARGETS)) {
    const multiplier = target.multiplier ?? 1;
    if (!Number.isFinite(target.targetValue) || !Number.isFinite(multiplier) || multiplier <= 0) continue;
    const weightedDistance = Math.abs(adjustedScore - target.targetValue) * multiplier;
    if (
      !best
      || weightedDistance < best.weightedDistance - EPS
      || (Math.abs(weightedDistance - best.weightedDistance) <= EPS && target.targetValue < best.targetValue)
      || (Math.abs(weightedDistance - best.weightedDistance) <= EPS && target.targetValue === best.targetValue && target.itemId.localeCompare(best.outputItemId) < 0)
    ) {
      best = { outputItemId: target.itemId, weightedDistance, targetValue: target.targetValue };
    }
  }

  return best;
}

function predictCauldronOutputForAdjustedScore(adjustedScore: number): string | undefined {
  return predictCauldronOutputForAdjustedScoreDetailed(adjustedScore)?.outputItemId;
}

const acceptedRangeCache = new Map<string, AcceptedAdjustedRange>();

export function acceptedAdjustedRangeForOutput(outputItemId: string): AcceptedAdjustedRange | undefined {
  const target = CAULDRON_TARGETS[outputItemId];
  if (!target) return undefined;
  const cached = acceptedRangeCache.get(outputItemId);
  if (cached) return cached;

  const center = target.targetValue;
  if (!Number.isFinite(center) || predictCauldronOutputForAdjustedScore(center) !== outputItemId) return undefined;

  const targetValues = Object.values(CAULDRON_TARGETS).map((entry) => entry.targetValue).filter((value) => Number.isFinite(value));
  const maxTarget = Math.max(center, ...targetValues);

  let low: number;
  if (predictCauldronOutputForAdjustedScore(0) === outputItemId) {
    low = 0;
  } else {
    let lo = 0;
    let hi = center;
    for (let i = 0; i < 64; i += 1) {
      const mid = (lo + hi) / 2;
      if (predictCauldronOutputForAdjustedScore(mid) === outputItemId) hi = mid;
      else lo = mid;
    }
    low = hi;
  }

  let highProbe = Math.max(center * 2 + 1, maxTarget * 1.25 + 1);
  let guard = 0;
  while (predictCauldronOutputForAdjustedScore(highProbe) === outputItemId && highProbe < maxTarget * 8 + 1_000 && guard < 32) {
    highProbe *= 2;
    guard += 1;
  }

  let lo = center;
  let hi = highProbe;
  for (let i = 0; i < 64; i += 1) {
    const mid = (lo + hi) / 2;
    if (predictCauldronOutputForAdjustedScore(mid) === outputItemId) lo = mid;
    else hi = mid;
  }

  const range = { min: Math.max(0, low - 1e-7), max: lo + 1e-7 };
  acceptedRangeCache.set(outputItemId, range);
  return range;
}

const CAULDRON_INPUT_EXCLUDE_RANK = 999;

function explicitCauldronInputPreferenceRank(itemId: string): number | undefined {
  const preference = itemById[itemId]?.cauldronInputPreference;
  if (!preference || preference === 'exclude') return undefined;
  return CAULDRON_INPUT_PREFERENCE_ORDER[preference as Exclude<CauldronInputPreference, 'exclude'>];
}

export function cauldronInputPreferenceRank(itemId: string): number | undefined {
  const item = itemById[itemId];
  if (!item || CAULDRON_INPUT_VALUES[itemId] === undefined) return undefined;

  const explicit = explicitCauldronInputPreferenceRank(itemId);
  if (explicit !== undefined) return explicit;

  if (item.cauldronTargetValue !== undefined) return CAULDRON_INPUT_PREFERENCE_ORDER.cauldron_producible;
  if (item.buyPriceCopper !== undefined) return CAULDRON_INPUT_PREFERENCE_ORDER.purchased_raw;

  return undefined;
}

function cauldronInputCandidateRank(itemId: string): number {
  return cauldronInputPreferenceRank(itemId) ?? CAULDRON_INPUT_EXCLUDE_RANK;
}

export const PREFERRED_CAULDRON_INPUT_ITEM_IDS = ITEMS
  .filter((item) => item.cauldronValue !== undefined && cauldronInputPreferenceRank(item.id) !== undefined)
  .map((item) => item.id)
  .sort((a, b) => {
    const rank = cauldronInputCandidateRank(a) - cauldronInputCandidateRank(b);
    if (rank !== 0) return rank;
    return CAULDRON_INPUT_VALUES[a].value - CAULDRON_INPUT_VALUES[b].value || a.localeCompare(b);
  });

export const PLANT_DERIVED_CAULDRON_INPUT_ITEM_IDS = PREFERRED_CAULDRON_INPUT_ITEM_IDS;

export function isPreferredCauldronInputItem(itemId: string): boolean {
  return cauldronInputPreferenceRank(itemId) !== undefined && CAULDRON_INPUT_VALUES[itemId] !== undefined;
}

export function isPlantDerivedCauldronInputItem(itemId: string): boolean {
  return isPreferredCauldronInputItem(itemId);
}

function duplicateMetrics(inputItemIds: CauldronInputTuple): { duplicateItemCount: number; maxDuplicateCount: number } {
  const counts = new Map<string, number>();
  for (const itemId of inputItemIds) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  const maxDuplicateCount = Math.max(...counts.values());
  return {
    duplicateItemCount: inputItemIds.length - counts.size,
    maxDuplicateCount,
  };
}

function overTargetMetrics(outputItemId: string, inputItemIds: CauldronInputTuple): { overTargetInputCount: number; overTargetExcessTotal: number; overTargetExcessMax: number } {
  const targetValue = CAULDRON_TARGETS[outputItemId]?.targetValue;
  if (!Number.isFinite(targetValue)) return { overTargetInputCount: 0, overTargetExcessTotal: 0, overTargetExcessMax: 0 };

  let overTargetInputCount = 0;
  let overTargetExcessTotal = 0;
  let overTargetExcessMax = 0;
  for (const itemId of inputItemIds) {
    const value = CAULDRON_INPUT_VALUES[itemId]?.value;
    if (!Number.isFinite(value)) continue;
    const excess = value - targetValue;
    if (excess <= EPS) continue;
    overTargetInputCount += 1;
    overTargetExcessTotal += excess;
    overTargetExcessMax = Math.max(overTargetExcessMax, excess);
  }
  return { overTargetInputCount, overTargetExcessTotal, overTargetExcessMax };
}

function buildRuntimeCandidate(outputItemId: string, inputItemIds: CauldronInputTuple, prediction: NonNullable<ReturnType<typeof predictCauldronOutput>>, stageId?: CauldronCandidateStageId): CauldronRuntimeCandidate {
  const target = CAULDRON_TARGETS[outputItemId];
  const targetValue = target?.targetValue ?? 0;
  return {
    outputItemId,
    inputItemIds,
    rawScore: prediction.rawScore,
    duplicatePenalty: prediction.duplicatePenalty,
    adjustedScore: prediction.adjustedScore,
    weightedDistance: prediction.weightedDistance,
    ...duplicateMetrics(inputItemIds),
    ...overTargetMetrics(outputItemId, inputItemIds),
    targetValue,
    targetMultiplier: target?.multiplier ?? 1,
    baseTimeSec: calcBaseCauldronTimeSec(targetValue),
    baseHeatPerSec: calcBaseCauldronHeatPerSec(targetValue),
    stageId,
  };
}

export function cauldronInputCount(): number {
  return CAULDRON_INPUT_ITEM_IDS.length;
}

export function preferredCauldronInputCount(): number {
  return PREFERRED_CAULDRON_INPUT_ITEM_IDS.length;
}

export function plantDerivedCauldronInputCount(): number {
  return preferredCauldronInputCount();
}

function inputPreference(itemId: string): CauldronInputPreference | undefined {
  const preference = itemById[itemId]?.cauldronInputPreference;
  return preference === 'exclude' ? undefined : preference;
}

function isPlantPreference(preference: CauldronInputPreference | undefined): boolean {
  return preference === 'nursery_output'
    || preference === 'nursery_processed'
    || preference === 'nursery_burned'
    || preference === 'nursery_multi_processed';
}

function isPlantSimplePreference(preference: CauldronInputPreference | undefined): boolean {
  return preference === 'nursery_output' || preference === 'nursery_processed' || preference === 'nursery_burned';
}

function isPurchasedPreference(preference: CauldronInputPreference | undefined): boolean {
  return preference === 'purchased_raw'
    || preference === 'purchased_processed'
    || preference === 'purchased_burned'
    || preference === 'purchased_multi_processed';
}

function isCurrencyItem(itemId: string): boolean {
  return CURRENCY_ITEM_IDS.has(itemId);
}

function inputItemIdsForStage(stageId: CauldronCandidateStageId, outputItemId: string): string[] {
  const all = PREFERRED_CAULDRON_INPUT_ITEM_IDS.filter((itemId) => itemId !== outputItemId && CAULDRON_INPUT_VALUES[itemId] !== undefined);
  const out = all.filter((itemId) => {
    const item = itemById[itemId];
    const preference = inputPreference(itemId);
    const target = CAULDRON_TARGETS[itemId]?.targetValue;
    const buyPrice = item?.buyPriceCopper;

    if (stageId === 'plantSimple') return isPlantSimplePreference(preference);
    if (stageId === 'plantWithLightIntermediate') {
      return isPlantPreference(preference) || (target !== undefined && target <= 1_000 && !isCurrencyItem(itemId));
    }
    if (stageId === 'lowCostPurchase') {
      return isPlantPreference(preference)
        || (target !== undefined && target <= 10_000 && !isCurrencyItem(itemId))
        || (isPurchasedPreference(preference) && !isCurrencyItem(itemId) && (buyPrice ?? Number.POSITIVE_INFINITY) <= 500);
    }
    if (stageId === 'mixedHighValue') {
      return isPlantPreference(preference)
        || preference === 'cauldron_producible'
        || preference === 'world_tree_derived'
        || (isPurchasedPreference(preference) && !isCurrencyItem(itemId));
    }
    return !isCurrencyItem(itemId) || outputItemId !== 'plank';
  });

  return [...new Set(out)].sort((a, b) => CAULDRON_INPUT_VALUES[a].value - CAULDRON_INPUT_VALUES[b].value || a.localeCompare(b));
}

function stageReachable(inputItemIds: readonly string[], range: AcceptedAdjustedRange): boolean {
  if (inputItemIds.length === 0) return false;
  const values = inputItemIds.map((itemId) => CAULDRON_INPUT_VALUES[itemId].value).sort((a, b) => a - b);
  const minAdjusted = values[0] * 3 * 0.5;
  const maxThree = [...values].sort((a, b) => b - a).slice(0, 3);
  const maxAdjusted = maxThree.length >= 3 ? maxThree.reduce((sum, value) => sum + value, 0) : values[values.length - 1] * 3 * 0.5;
  return maxAdjusted >= range.min - EPS && minAdjusted <= range.max + EPS;
}

export function cauldronCandidateStagesForOutput(outputItemId: string): CauldronCandidateStage[] {
  const range = acceptedAdjustedRangeForOutput(outputItemId);
  if (!range) return [];
  const stageIds: CauldronCandidateStageId[] = ['plantSimple', 'plantWithLightIntermediate', 'lowCostPurchase', 'mixedHighValue', 'fallback'];
  return stageIds.map((id) => {
    const inputItemIds = inputItemIdsForStage(id, outputItemId);
    return { id, label: id, inputItemIds, reachable: stageReachable(inputItemIds, range) };
  });
}

function lowerBoundByValue(itemIds: readonly string[], value: number, startIndex: number): number {
  let lo = startIndex;
  let hi = itemIds.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (CAULDRON_INPUT_VALUES[itemIds[mid]].value < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundByValue(itemIds: readonly string[], value: number, startIndex: number): number {
  let lo = startIndex;
  let hi = itemIds.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (CAULDRON_INPUT_VALUES[itemIds[mid]].value <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function* emitCandidateForTuple(outputItemId: string, inputItemIds: CauldronInputTuple, stageId: CauldronCandidateStageId): Generator<CauldronRuntimeCandidate> {
  const prediction = predictCauldronOutput(inputItemIds);
  if (!prediction || prediction.outputItemId !== outputItemId) return;
  yield buildRuntimeCandidate(outputItemId, inputItemIds, prediction, stageId);
}

export function* iterateCauldronCandidatesForOutputStage(outputItemId: string, stage: CauldronCandidateStage): Generator<CauldronRuntimeCandidate> {
  const range = acceptedAdjustedRangeForOutput(outputItemId);
  if (!range || !stage.reachable || stage.inputItemIds.length === 0) return;
  const itemIds = stage.inputItemIds;

  for (let i = 0; i < itemIds.length; i += 1) {
    const first = itemIds[i];
    const firstValue = CAULDRON_INPUT_VALUES[first].value;
    for (let j = i; j < itemIds.length; j += 1) {
      const second = itemIds[j];
      const baseRaw = firstValue + CAULDRON_INPUT_VALUES[second].value;

      if (i === j) {
        const thirdSame = second;
        const adjustedSame = (baseRaw + CAULDRON_INPUT_VALUES[thirdSame].value) * 0.5;
        if (adjustedSame >= range.min - EPS && adjustedSame <= range.max + EPS) {
          yield* emitCandidateForTuple(outputItemId, [first, second, thirdSame], stage.id);
        }

        const minThird = range.min / 0.65 - baseRaw;
        const maxThird = range.max / 0.65 - baseRaw;
        const from = lowerBoundByValue(itemIds, minThird, j + 1);
        const to = upperBoundByValue(itemIds, maxThird, j + 1);
        for (let k = from; k < to; k += 1) yield* emitCandidateForTuple(outputItemId, [first, second, itemIds[k]], stage.id);
      } else {
        const thirdEqualsSecond = second;
        const adjustedDuplicate = (baseRaw + CAULDRON_INPUT_VALUES[thirdEqualsSecond].value) * 0.65;
        if (adjustedDuplicate >= range.min - EPS && adjustedDuplicate <= range.max + EPS) {
          yield* emitCandidateForTuple(outputItemId, [first, second, thirdEqualsSecond], stage.id);
        }

        const minThird = range.min - baseRaw;
        const maxThird = range.max - baseRaw;
        const from = lowerBoundByValue(itemIds, minThird, j + 1);
        const to = upperBoundByValue(itemIds, maxThird, j + 1);
        for (let k = from; k < to; k += 1) yield* emitCandidateForTuple(outputItemId, [first, second, itemIds[k]], stage.id);
      }
    }
  }
}
