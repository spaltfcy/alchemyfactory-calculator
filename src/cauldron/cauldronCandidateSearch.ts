import { CAULDRON_INPUT_ITEM_IDS, CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
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
  return candidate.inputItemIds.map(cauldronInputCandidateRank);
}

function cauldronCandidateWorstPreferenceRank(candidate: CauldronRuntimeCandidate): number {
  return Math.max(...cauldronCandidatePreferenceRanks(candidate));
}

function cauldronCandidatePreferenceRankSum(candidate: CauldronRuntimeCandidate): number {
  return cauldronCandidatePreferenceRanks(candidate).reduce((sum, rank) => sum + rank, 0);
}

function sortRuntimeCandidates(candidates: CauldronRuntimeCandidate[]): CauldronRuntimeCandidate[] {
  return candidates.sort((a, b) => {
    const worstRank = cauldronCandidateWorstPreferenceRank(a) - cauldronCandidateWorstPreferenceRank(b);
    if (worstRank !== 0) return worstRank;

    const rankSum = cauldronCandidatePreferenceRankSum(a) - cauldronCandidatePreferenceRankSum(b);
    if (rankSum !== 0) return rankSum;

    const duplicate = b.duplicatePenalty - a.duplicatePenalty;
    if (Math.abs(duplicate) > EPS) return duplicate;

    const distance = a.weightedDistance - b.weightedDistance;
    if (Math.abs(distance) > EPS) return distance;

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

export function findCauldronCandidatesForOutput(outputItemId: string, options: FindCandidateOptions = {}): CauldronRuntimeCandidate[] {
  if (!CAULDRON_TARGETS[outputItemId]) return [];
  const itemIds = normalizeInputPool(options.inputItemIds);
  const maxCandidates = options.maxCandidates === undefined ? undefined : Math.max(1, Math.floor(options.maxCandidates));
  const cacheKey = `${outputItemId}:${maxCandidates ?? 'all'}:${itemIds.join('|')}`;
  const cached = candidateCache.get(cacheKey);
  if (cached) return cached;

  const candidates: CauldronRuntimeCandidate[] = [];
  for (let i = 0; i < itemIds.length; i += 1) {
    for (let j = i; j < itemIds.length; j += 1) {
      for (let k = j; k < itemIds.length; k += 1) {
        const inputItemIds: CauldronInputTuple = [itemIds[i], itemIds[j], itemIds[k]];
        const prediction = predictCauldronOutput(inputItemIds);
        if (!prediction || prediction.outputItemId !== outputItemId) continue;
        candidates.push({
          outputItemId,
          inputItemIds,
          rawScore: prediction.rawScore,
          duplicatePenalty: prediction.duplicatePenalty,
          adjustedScore: prediction.adjustedScore,
          weightedDistance: prediction.weightedDistance,
        });
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

export function preferredCauldronInputCount(): number {
  return PREFERRED_CAULDRON_INPUT_ITEM_IDS.length;
}

export function plantDerivedCauldronInputCount(): number {
  return preferredCauldronInputCount();
}
