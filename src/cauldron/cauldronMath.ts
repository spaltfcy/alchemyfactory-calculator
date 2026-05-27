import { CAULDRON_INPUT_ITEM_IDS, CAULDRON_INPUT_VALUES, CAULDRON_TARGET_ITEM_IDS, CAULDRON_TARGETS } from './cauldronData';
import type { CauldronCandidate, CauldronInputTuple, CauldronPrediction, CauldronTargetEntry } from './cauldronTypes';

const EPS = 1e-9;

export function normalizeCauldronInputTuple(inputItemIds: string[]): CauldronInputTuple {
  const [a = '', b = '', c = ''] = inputItemIds;
  return [a, b, c];
}

export function duplicatePenaltyForInputs(inputItemIds: CauldronInputTuple): number {
  const uniqueCount = new Set(inputItemIds).size;
  if (uniqueCount <= 1) return 0.5;
  if (uniqueCount === 2) return 0.65;
  return 1;
}

export function sortedCauldronTargets(): CauldronTargetEntry[] {
  return CAULDRON_TARGET_ITEM_IDS.map((itemId) => CAULDRON_TARGETS[itemId]).sort(
    (a, b) => a.targetValue - b.targetValue || a.itemId.localeCompare(b.itemId),
  );
}

export function cauldronScoreRangeForTarget(itemId: string): { lowerExclusive?: number; upperInclusive?: number } | undefined {
  const targets = sortedCauldronTargets();
  const index = targets.findIndex((target) => target.itemId === itemId);
  if (index < 0) return undefined;
  const current = targets[index];
  const prev = targets[index - 1];
  const next = targets[index + 1];
  return {
    lowerExclusive: prev ? (prev.targetValue + current.targetValue) / 2 : undefined,
    upperInclusive: next ? (current.targetValue + next.targetValue) / 2 : undefined,
  };
}

export function resolveCauldronOutputItemId(score: number): string | undefined {
  if (!Number.isFinite(score)) return undefined;
  let best: CauldronTargetEntry | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const target of sortedCauldronTargets()) {
    const distance = Math.abs(target.targetValue - score) * (target.multiplier ?? 1);
    if (
      distance + EPS < bestDistance ||
      (Math.abs(distance - bestDistance) <= EPS && best && target.targetValue < best.targetValue)
    ) {
      best = target;
      bestDistance = distance;
    }
  }
  return best?.itemId;
}

export function predictCauldron(inputItemIds: CauldronInputTuple): CauldronPrediction {
  const missingInputItemIds = inputItemIds.filter((itemId) => !CAULDRON_INPUT_VALUES[itemId]);
  const rawScore = inputItemIds.reduce((sum, itemId) => sum + (CAULDRON_INPUT_VALUES[itemId]?.value ?? 0), 0);
  const duplicatePenalty = duplicatePenaltyForInputs(inputItemIds);
  const adjustedScore = rawScore * duplicatePenalty;
  const outputItemId = missingInputItemIds.length === 0 ? resolveCauldronOutputItemId(adjustedScore) : undefined;
  const target = outputItemId ? CAULDRON_TARGETS[outputItemId] : undefined;
  return {
    inputItemIds,
    rawScore,
    duplicatePenalty,
    adjustedScore,
    outputItemId,
    targetValue: target?.targetValue,
    distance: target ? Math.abs(target.targetValue - adjustedScore) : undefined,
    missingInputItemIds: [...new Set(missingInputItemIds)],
  };
}

export function cauldronCandidateId(outputItemId: string, inputItemIds: CauldronInputTuple): string {
  return `cauldron:auto:${outputItemId}:${inputItemIds.join('+')}`;
}

export function generateCauldronCandidatesForOutput(
  outputItemId: string,
  options?: {
    allowDuplicateInputs?: boolean;
    maxCandidates?: number;
    inputItemIds?: string[];
  },
): CauldronCandidate[] {
  const target = CAULDRON_TARGETS[outputItemId];
  if (!target) return [];

  const inputItemIds = [...new Set(options?.inputItemIds ?? CAULDRON_INPUT_ITEM_IDS)]
    .filter((itemId) => itemId !== outputItemId && CAULDRON_INPUT_VALUES[itemId]);
  const allowDuplicateInputs = options?.allowDuplicateInputs ?? true;
  const candidates: CauldronCandidate[] = [];

  for (let i = 0; i < inputItemIds.length; i += 1) {
    for (let j = allowDuplicateInputs ? i : i + 1; j < inputItemIds.length; j += 1) {
      for (let k = allowDuplicateInputs ? j : j + 1; k < inputItemIds.length; k += 1) {
        const inputTuple: CauldronInputTuple = [inputItemIds[i], inputItemIds[j], inputItemIds[k]];
        const prediction = predictCauldron(inputTuple);
        if (prediction.outputItemId !== outputItemId || prediction.distance === undefined || prediction.targetValue === undefined) continue;
        const distanceRatio = target.targetValue === 0 ? 0 : prediction.distance / target.targetValue;
        candidates.push({
          ...prediction,
          id: cauldronCandidateId(outputItemId, inputTuple),
          outputItemId,
          targetValue: target.targetValue,
          distance: prediction.distance,
          distanceRatio,
          valueEfficiency: prediction.adjustedScore > 0 ? target.targetValue / prediction.adjustedScore : Number.POSITIVE_INFINITY,
          targetStatus: target.status,
          targetTimeSec: target.timeSec,
          targetHeatPerSec: target.heatPerSec,
        });
      }
    }
  }

  candidates.sort(
    (a, b) =>
      a.distanceRatio - b.distanceRatio ||
      Math.abs(1 - a.valueEfficiency) - Math.abs(1 - b.valueEfficiency) ||
      b.duplicatePenalty - a.duplicatePenalty ||
      a.inputItemIds.join('|').localeCompare(b.inputItemIds.join('|')),
  );

  return candidates.slice(0, Math.max(1, Math.floor(options?.maxCandidates ?? 20)));
}
