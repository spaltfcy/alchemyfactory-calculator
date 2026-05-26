import { CAULDRON_INPUT_ITEM_IDS, CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
import type { CauldronInputTuple } from './cauldronTypes';
import { ITEMS } from '../data/items';
import { RECIPES } from '../data/recipes';

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

function recipeHasOnlyKnownItemInputs(recipeId: string, known: Set<string>): boolean {
  const recipe = RECIPES.find((candidate) => candidate.id === recipeId);
  if (!recipe || recipe.internal) return false;
  if (recipe.inputs.length === 0) return false;
  return recipe.inputs.every((input) => input.kind !== 'paradoxableItem' && known.has(input.itemId));
}

function buildPlantDerivedItemIds(): string[] {
  const known = new Set<string>();
  for (const item of ITEMS) {
    if (item.category === 'seed') known.add(item.id);
  }

  for (let pass = 0; pass < 16; pass += 1) {
    let changed = false;
    for (const recipe of RECIPES) {
      if (recipe.internal) continue;
      if (recipe.inputs.length === 0) continue;
      if (!recipe.inputs.every((input) => input.kind !== 'paradoxableItem' && known.has(input.itemId))) continue;
      for (const output of recipe.outputs) {
        if (output.amount <= 0) continue;
        if (!known.has(output.itemId)) {
          known.add(output.itemId);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Keep the list human-oriented but deterministic. Cauldron values are filtered by callers.
  return [...known].sort((a, b) => a.localeCompare(b));
}

const plantDerivedItemIds = buildPlantDerivedItemIds();

export const PLANT_DERIVED_CAULDRON_INPUT_ITEM_IDS = plantDerivedItemIds
  .filter((itemId) => CAULDRON_INPUT_VALUES[itemId])
  .sort((a, b) => CAULDRON_INPUT_VALUES[a].value - CAULDRON_INPUT_VALUES[b].value || a.localeCompare(b));

export function isPlantDerivedCauldronInputItem(itemId: string): boolean {
  return PLANT_DERIVED_CAULDRON_INPUT_ITEM_IDS.includes(itemId);
}

function sortRuntimeCandidates(candidates: CauldronRuntimeCandidate[]): CauldronRuntimeCandidate[] {
  return candidates.sort((a, b) => {
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

export function findPlantDerivedCauldronCandidatesForOutput(outputItemId: string, options: { maxCandidates?: number } = {}): CauldronRuntimeCandidate[] {
  return findCauldronCandidatesForOutput(outputItemId, {
    maxCandidates: options.maxCandidates,
    inputItemIds: PLANT_DERIVED_CAULDRON_INPUT_ITEM_IDS,
  });
}

export function plantDerivedCauldronInputCount(): number {
  return PLANT_DERIVED_CAULDRON_INPUT_ITEM_IDS.length;
}
