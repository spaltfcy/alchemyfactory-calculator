import { CAULDRON_INPUT_ITEM_IDS, CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
import { calcBaseCauldronHeatPerSec, calcBaseCauldronTimeSec } from './cauldronPhysics';
import type { CauldronInputTuple } from './cauldronTypes';
import { ITEMS, itemById } from '../data/items';
import { CAULDRON_INPUT_PREFERENCE_ORDER } from '../types';
import type { CauldronInputPreference } from '../types';

const EPS = 1e-9;

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
};

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

  return best ? { outputItemId: best.outputItemId, weightedDistance: best.weightedDistance, adjustedScore, rawScore, duplicatePenalty } : undefined;
}

function predictCauldronOutputForAdjustedScore(adjustedScore: number): string | undefined {
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
  return best?.outputItemId;
}

type AcceptedAdjustedRange = { min: number; max: number };
const acceptedRangeCache = new Map<string, AcceptedAdjustedRange>();

function acceptedAdjustedRangeForOutput(outputItemId: string): AcceptedAdjustedRange | undefined {
  const target = CAULDRON_TARGETS[outputItemId];
  if (!target) return undefined;
  const cached = acceptedRangeCache.get(outputItemId);
  if (cached) return cached;
  const center = target.targetValue;
  if (predictCauldronOutputForAdjustedScore(center) !== outputItemId) return undefined;
  const maxTarget = Math.max(...Object.values(CAULDRON_TARGETS).map((entry) => entry.targetValue).filter(Number.isFinite));

  let lowBad = 0;
  if (predictCauldronOutputForAdjustedScore(lowBad) === outputItemId) {
    lowBad = 0;
  } else {
    let lo = 0;
    let hi = center;
    for (let i = 0; i < 64; i += 1) {
      const mid = (lo + hi) / 2;
      if (predictCauldronOutputForAdjustedScore(mid) === outputItemId) hi = mid;
      else lo = mid;
    }
    lowBad = hi;
  }

  let high = Math.max(center * 2 + 1, maxTarget * 1.25 + 1);
  while (predictCauldronOutputForAdjustedScore(high) === outputItemId && high < maxTarget * 8 + 1_000) high *= 2;
  let lo = center;
  let hi = high;
  for (let i = 0; i < 64; i += 1) {
    const mid = (lo + hi) / 2;
    if (predictCauldronOutputForAdjustedScore(mid) === outputItemId) lo = mid;
    else hi = mid;
  }

  const range = { min: Math.max(0, lowBad - 1e-7), max: lo + 1e-7 };
  acceptedRangeCache.set(outputItemId, range);
  return range;
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

  // 06. 錬金釜から作れるアイテム。明示分類が無いターゲットはこの扱いにする。
  if (item.cauldronTargetValue !== undefined) return CAULDRON_INPUT_PREFERENCE_ORDER.cauldron_producible;

  // 08. 購入品そのもの。種を直接釜に入れる場合もここに落ちるため、かなり低優先になる。
  if (item.buyPriceCopper !== undefined) return CAULDRON_INPUT_PREFERENCE_ORDER.purchased_raw;

  return undefined;
}

function cauldronInputCandidateRank(itemId: string): number {
  return cauldronInputPreferenceRank(itemId) ?? CAULDRON_INPUT_EXCLUDE_RANK;
}

function cauldronInputScreenRank(itemId: string): number {
  // Keep this only as a stable display/debug fallback. The runtime planner now
  // evaluates material burden after it expands candidate inputs, so low target
  // values must not be allowed to outrank cheaper and cleaner material routes.
  return cauldronInputCandidateRank(itemId);
}

export const PREFERRED_CAULDRON_INPUT_ITEM_IDS = ITEMS
  .filter((item) => item.cauldronValue !== undefined && cauldronInputPreferenceRank(item.id) !== undefined)
  .map((item) => item.id)
  .sort((a, b) => {
    const rank = cauldronInputCandidateRank(a) - cauldronInputCandidateRank(b);
    if (rank !== 0) return rank;
    return CAULDRON_INPUT_VALUES[a].value - CAULDRON_INPUT_VALUES[b].value || a.localeCompare(b);
  });

// Backward-compatible alias for the current planner. The pool is no longer limited to plant-derived items.
export const PLANT_DERIVED_CAULDRON_INPUT_ITEM_IDS = PREFERRED_CAULDRON_INPUT_ITEM_IDS;

export function isPreferredCauldronInputItem(itemId: string): boolean {
  return cauldronInputPreferenceRank(itemId) !== undefined && CAULDRON_INPUT_VALUES[itemId] !== undefined;
}

export function isPlantDerivedCauldronInputItem(itemId: string): boolean {
  return isPreferredCauldronInputItem(itemId);
}

function cauldronCandidatePreferenceRanks(candidate: CauldronRuntimeCandidate): number[] {
  return candidate.inputItemIds.map(cauldronInputScreenRank);
}

function cauldronCandidateWorstPreferenceRank(candidate: CauldronRuntimeCandidate): number {
  return Math.max(...cauldronCandidatePreferenceRanks(candidate));
}

function cauldronCandidatePreferenceRankSum(candidate: CauldronRuntimeCandidate): number {
  return cauldronCandidatePreferenceRanks(candidate).reduce((sum, rank) => sum + rank, 0);
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

function buildRuntimeCandidate(outputItemId: string, inputItemIds: CauldronInputTuple, prediction: NonNullable<ReturnType<typeof predictCauldronOutput>>): CauldronRuntimeCandidate {
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
  };
}

function sortRuntimeCandidates(candidates: CauldronRuntimeCandidate[]): CauldronRuntimeCandidate[] {
  return candidates.sort((a, b) => {
    const duplicateItemCount = a.duplicateItemCount - b.duplicateItemCount;
    if (duplicateItemCount !== 0) return duplicateItemCount;

    const maxDuplicateCount = a.maxDuplicateCount - b.maxDuplicateCount;
    if (maxDuplicateCount !== 0) return maxDuplicateCount;

    const worstRank = cauldronCandidateWorstPreferenceRank(a) - cauldronCandidateWorstPreferenceRank(b);
    if (worstRank !== 0) return worstRank;

    const rankSum = cauldronCandidatePreferenceRankSum(a) - cauldronCandidatePreferenceRankSum(b);
    if (rankSum !== 0) return rankSum;

    const overTargetInputCount = a.overTargetInputCount - b.overTargetInputCount;
    if (overTargetInputCount !== 0) return overTargetInputCount;

    const overTargetExcessTotal = a.overTargetExcessTotal - b.overTargetExcessTotal;
    if (Math.abs(overTargetExcessTotal) > EPS) return overTargetExcessTotal;

    const distance = a.weightedDistance - b.weightedDistance;
    if (Math.abs(distance) > EPS) return distance;

    const overTargetExcessMax = a.overTargetExcessMax - b.overTargetExcessMax;
    if (Math.abs(overTargetExcessMax) > EPS) return overTargetExcessMax;

    const score = a.adjustedScore - b.adjustedScore;
    if (Math.abs(score) > EPS) return score;

    return a.inputItemIds.join('\u0000').localeCompare(b.inputItemIds.join('\u0000'));
  });
}

const candidateCache = new Map<string, CauldronRuntimeCandidate[]>();

type FindCandidateOptions = {
  maxCandidates?: number;
  inputItemIds?: readonly string[];
};

function normalizeInputPool(inputItemIds?: readonly string[]): string[] {
  const source = inputItemIds && inputItemIds.length > 0 ? inputItemIds : CAULDRON_INPUT_ITEM_IDS;
  return [...new Set(source)]
    .filter((itemId) => CAULDRON_INPUT_VALUES[itemId])
    .sort((a, b) => CAULDRON_INPUT_VALUES[a].value - CAULDRON_INPUT_VALUES[b].value || a.localeCompare(b));
}

function normalizeInputPoolForOutput(outputItemId: string, inputItemIds?: readonly string[]): string[] {
  // A cauldron recipe that consumes the same item it outputs is self-referential for
  // the current one-output planner. Remove it before generating triples so it never
  // appears in candidate lists, debug logs, or graphs. Duplicate input slots for
  // other items remain allowed because the game applies duplicate penalties.
  return normalizeInputPool(inputItemIds).filter((itemId) => itemId !== outputItemId);
}

export function findCauldronCandidatesForOutput(outputItemId: string, options: FindCandidateOptions = {}): CauldronRuntimeCandidate[] {
  if (!CAULDRON_TARGETS[outputItemId]) return [];
  const itemIds = normalizeInputPoolForOutput(outputItemId, options.inputItemIds);
  const maxCandidates = options.maxCandidates === undefined ? undefined : Math.max(1, Math.floor(options.maxCandidates));
  const cacheKey = `${outputItemId}:${maxCandidates ?? 'all'}:${itemIds.join('|')}`;
  const cached = candidateCache.get(cacheKey);
  if (cached) return cached;

  const candidates: CauldronRuntimeCandidate[] = [];
  const acceptedRange = acceptedAdjustedRangeForOutput(outputItemId);
  if (!acceptedRange) return [];
  for (let i = 0; i < itemIds.length; i += 1) {
    const vi = CAULDRON_INPUT_VALUES[itemIds[i]].value;
    for (let j = i; j < itemIds.length; j += 1) {
      const vj = CAULDRON_INPUT_VALUES[itemIds[j]].value;
      const duplicatePenaltyForPair = i === j ? 0.5 : 0.65;
      const pairMinRaw = acceptedRange.min / duplicatePenaltyForPair - vi - vj;
      const pairMaxRaw = acceptedRange.max / duplicatePenaltyForPair - vi - vj;
      const allDistinctMinRaw = acceptedRange.min - vi - vj;
      const allDistinctMaxRaw = acceptedRange.max - vi - vj;
      const minNeeded = Math.min(pairMinRaw, allDistinctMinRaw);
      const maxNeeded = Math.max(pairMaxRaw, allDistinctMaxRaw);
      let kStart = lowerBoundByValue(itemIds, minNeeded, j);
      const kEnd = upperBoundByValue(itemIds, maxNeeded, j);
      for (let k = kStart; k < kEnd; k += 1) {
        const inputItemIds: CauldronInputTuple = [itemIds[i], itemIds[j], itemIds[k]];
        const prediction = predictCauldronOutput(inputItemIds);
        if (!prediction || prediction.outputItemId !== outputItemId) continue;
        candidates.push(buildRuntimeCandidate(outputItemId, inputItemIds, prediction));
      }
    }
  }

  const sorted = sortRuntimeCandidates(candidates);
  const result = maxCandidates === undefined ? sorted : sorted.slice(0, maxCandidates);
  candidateCache.set(cacheKey, result);
  return result;
}

export function findPreferredCauldronCandidatesForOutput(outputItemId: string, options: { maxCandidates?: number } = {}): CauldronRuntimeCandidate[] {
  return findCauldronCandidatesForOutput(outputItemId, {
    maxCandidates: options.maxCandidates,
    inputItemIds: PREFERRED_CAULDRON_INPUT_ITEM_IDS,
  });
}

export function findPlantDerivedCauldronCandidatesForOutput(outputItemId: string, options: { maxCandidates?: number } = {}): CauldronRuntimeCandidate[] {
  return findPreferredCauldronCandidatesForOutput(outputItemId, options);
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
