import { CAULDRON_INPUT_ITEM_IDS, CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
import type { CauldronInputTuple } from './cauldronTypes';

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

function candidatePriority(inputItemIds: CauldronInputTuple): number {
  // Lower is better. Prefer candidates whose inputs can themselves be cauldron targets;
  // this is only a search order hint. The planner still validates each slot recursively.
  const targetCount = inputItemIds.filter((itemId) => CAULDRON_TARGETS[itemId]).length;
  const uniqueCount = new Set(inputItemIds).size;
  return (3 - targetCount) * 100 + (3 - uniqueCount);
}

function sortRuntimeCandidates(candidates: CauldronRuntimeCandidate[]): CauldronRuntimeCandidate[] {
  return candidates.sort((a, b) => {
    const priority = candidatePriority(a.inputItemIds) - candidatePriority(b.inputItemIds);
    if (priority !== 0) return priority;
    const distance = a.weightedDistance - b.weightedDistance;
    if (Math.abs(distance) > EPS) return distance;
    const duplicate = b.duplicatePenalty - a.duplicatePenalty;
    if (Math.abs(duplicate) > EPS) return duplicate;
    const score = a.adjustedScore - b.adjustedScore;
    if (Math.abs(score) > EPS) return score;
    return a.inputItemIds.join('\u0000').localeCompare(b.inputItemIds.join('\u0000'));
  });
}

const candidateCache = new Map<string, CauldronRuntimeCandidate[]>();

export function findCauldronCandidatesForOutput(outputItemId: string, options: { maxCandidates?: number } = {}): CauldronRuntimeCandidate[] {
  if (!CAULDRON_TARGETS[outputItemId]) return [];
  const maxCandidates = Math.max(1, Math.floor(options.maxCandidates ?? 200));
  const cacheKey = `${outputItemId}:${maxCandidates}`;
  const cached = candidateCache.get(cacheKey);
  if (cached) return cached;

  const itemIds = CAULDRON_INPUT_ITEM_IDS;
  const candidates: CauldronRuntimeCandidate[] = [];
  const searchLimit = Math.max(maxCandidates * 8, maxCandidates);

  outer:
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
        if (candidates.length >= searchLimit) break outer;
      }
    }
  }

  const sorted = sortRuntimeCandidates(candidates).slice(0, maxCandidates);
  candidateCache.set(cacheKey, sorted);
  return sorted;
}
