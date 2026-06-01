import { CAULDRON_INPUT_VALUES, CAULDRON_TARGETS } from './cauldronData';
import type { CauldronInputTuple } from './cauldronTypes';
import type { CauldronRuntimeCandidate } from './cauldronCandidateSearch';
import { itemById } from '../data/items';
import type { CauldronInputPreference } from '../types';

const CURRENCY_ITEM_IDS = new Set(['copper_coin', 'silver_coin', 'gold_coin']);

export type CauldronInputSupplyProfile = {
  itemId: string;
  cauldronValue: number;
  requiredPerMin: number;
  routeTier: number;
  currencyInputCount: number;
  purchaseOnlyInputCount: number;
  purchaseCopperPerMin: number;
  purchaseCopperPerItem: number;
  plantInputCount: number;
  plantProcessedInputCount: number;
  nonPlantExpensiveInputCount: number;
  plantOverpayCauldronValue: number;
  nonPlantOverpayCauldronValue: number;
};

export type CauldronCandidateStaticBurden = {
  currencyInputCount: number;
  purchaseOnlyInputCount: number;
  purchaseCopperPerMin: number;
  purchaseCopperPerOutput: number;
  plantInputCount: number;
  plantProcessedInputCount: number;
  nonPlantExpensiveInputCount: number;
  plantOverpayCauldronValue: number;
  nonPlantOverpayCauldronValue: number;
  worstInputRouteTier: number;
  inputRouteTierSum: number;
};

function preferenceOf(itemId: string): CauldronInputPreference | undefined {
  const preference = itemById[itemId]?.cauldronInputPreference;
  return preference === 'exclude' ? undefined : preference;
}

function isPlantPreference(preference: CauldronInputPreference | undefined): boolean {
  return preference === 'nursery_output'
    || preference === 'nursery_processed'
    || preference === 'nursery_burned'
    || preference === 'nursery_multi_processed';
}

function isPlantProcessedPreference(preference: CauldronInputPreference | undefined): boolean {
  return preference === 'nursery_processed'
    || preference === 'nursery_burned'
    || preference === 'nursery_multi_processed';
}

function routeTierForItem(itemId: string): number {
  const item = itemById[itemId];
  const preference = preferenceOf(itemId);
  if (!item || CAULDRON_INPUT_VALUES[itemId] === undefined) return 90;
  if (CURRENCY_ITEM_IDS.has(itemId)) return 85;

  switch (preference) {
    case 'nursery_output':
      return 10;
    case 'nursery_processed':
      return 12;
    case 'nursery_burned':
      return 14;
    case 'nursery_multi_processed':
      return 18;
    case 'cauldron_producible': {
      const target = CAULDRON_TARGETS[itemId]?.targetValue;
      if (target !== undefined && target <= 1_000) return 28;
      if (target !== undefined && target <= 10_000) return 36;
      return 48;
    }
    case 'world_tree_derived':
      return 58;
    case 'purchased_raw':
      return 62;
    case 'purchased_processed':
      return 66;
    case 'purchased_burned':
      return 68;
    case 'purchased_multi_processed':
      return 72;
    default:
      if (item.buyPriceCopper !== undefined) return 70;
      return 55;
  }
}

function isPurchaseOnlyInput(itemId: string): boolean {
  const item = itemById[itemId];
  const preference = preferenceOf(itemId);
  if (!item) return false;
  return CURRENCY_ITEM_IDS.has(itemId)
    || item.buyPriceCopper !== undefined
    || preference === 'purchased_raw'
    || preference === 'purchased_processed'
    || preference === 'purchased_burned'
    || preference === 'purchased_multi_processed';
}

function isNonPlantExpensiveInput(itemId: string): boolean {
  const item = itemById[itemId];
  const preference = preferenceOf(itemId);
  if (!item) return true;
  if (isPlantPreference(preference)) return false;
  if (CURRENCY_ITEM_IDS.has(itemId)) return true;
  if (preference === 'world_tree_derived') return true;
  if (preference?.startsWith('purchased')) return true;
  const target = CAULDRON_TARGETS[itemId]?.targetValue;
  return target !== undefined && target > 10_000;
}

export function cauldronInputSupplyProfile(itemId: string, requiredPerMin: number, targetValue: number): CauldronInputSupplyProfile {
  const item = itemById[itemId];
  const preference = preferenceOf(itemId);
  const value = CAULDRON_INPUT_VALUES[itemId]?.value ?? 0;
  const purchaseCopperPerItem = item?.buyPriceCopper ?? 0;
  const overpay = Math.max(0, value - targetValue);
  const isPlant = isPlantPreference(preference);
  return {
    itemId,
    cauldronValue: value,
    requiredPerMin,
    routeTier: routeTierForItem(itemId),
    currencyInputCount: CURRENCY_ITEM_IDS.has(itemId) ? 1 : 0,
    purchaseOnlyInputCount: isPurchaseOnlyInput(itemId) ? 1 : 0,
    purchaseCopperPerMin: purchaseCopperPerItem * requiredPerMin,
    purchaseCopperPerItem,
    plantInputCount: isPlant ? 1 : 0,
    plantProcessedInputCount: isPlantProcessedPreference(preference) ? 1 : 0,
    nonPlantExpensiveInputCount: isNonPlantExpensiveInput(itemId) ? 1 : 0,
    plantOverpayCauldronValue: isPlant ? overpay : 0,
    nonPlantOverpayCauldronValue: isPlant ? 0 : overpay,
  };
}

export function cauldronCandidateStaticBurden(candidate: Pick<CauldronRuntimeCandidate, 'inputItemIds' | 'targetValue'>, requiredPerMin = 1): CauldronCandidateStaticBurden {
  const profiles = candidate.inputItemIds.map((itemId) => cauldronInputSupplyProfile(itemId, requiredPerMin, candidate.targetValue));
  return {
    currencyInputCount: profiles.reduce((sum, p) => sum + p.currencyInputCount, 0),
    purchaseOnlyInputCount: profiles.reduce((sum, p) => sum + p.purchaseOnlyInputCount, 0),
    purchaseCopperPerMin: profiles.reduce((sum, p) => sum + p.purchaseCopperPerMin, 0),
    purchaseCopperPerOutput: profiles.reduce((sum, p) => sum + p.purchaseCopperPerItem, 0),
    plantInputCount: profiles.reduce((sum, p) => sum + p.plantInputCount, 0),
    plantProcessedInputCount: profiles.reduce((sum, p) => sum + p.plantProcessedInputCount, 0),
    nonPlantExpensiveInputCount: profiles.reduce((sum, p) => sum + p.nonPlantExpensiveInputCount, 0),
    plantOverpayCauldronValue: profiles.reduce((sum, p) => sum + p.plantOverpayCauldronValue, 0),
    nonPlantOverpayCauldronValue: profiles.reduce((sum, p) => sum + p.nonPlantOverpayCauldronValue, 0),
    worstInputRouteTier: profiles.length > 0 ? Math.max(...profiles.map((p) => p.routeTier)) : 90,
    inputRouteTierSum: profiles.reduce((sum, p) => sum + p.routeTier, 0),
  };
}

export function cauldronCandidateMaterialSortKey(candidate: CauldronRuntimeCandidate): number[] {
  const burden = cauldronCandidateStaticBurden(candidate);
  return [
    burden.currencyInputCount,
    burden.purchaseOnlyInputCount,
    burden.purchaseCopperPerOutput,
    burden.nonPlantExpensiveInputCount,
    burden.nonPlantOverpayCauldronValue,
    burden.worstInputRouteTier,
    burden.inputRouteTierSum,
    candidate.duplicateItemCount,
    candidate.maxDuplicateCount,
    candidate.overTargetInputCount,
    candidate.weightedDistance,
    candidate.adjustedScore,
  ];
}

export function compareCauldronCandidatesByMaterialBurden(a: CauldronRuntimeCandidate, b: CauldronRuntimeCandidate): number {
  const ak = cauldronCandidateMaterialSortKey(a);
  const bk = cauldronCandidateMaterialSortKey(b);
  for (let i = 0; i < Math.max(ak.length, bk.length); i += 1) {
    const diff = (ak[i] ?? 0) - (bk[i] ?? 0);
    if (Math.abs(diff) > 1e-9) return diff;
  }
  return a.inputItemIds.join('\u0000').localeCompare(b.inputItemIds.join('\u0000'));
}

function dominatesCandidate(a: CauldronRuntimeCandidate, b: CauldronRuntimeCandidate): boolean {
  const ak = cauldronCandidateMaterialSortKey(a);
  const bk = cauldronCandidateMaterialSortKey(b);
  let strictlyBetter = false;
  for (let i = 0; i < Math.max(ak.length, bk.length); i += 1) {
    const av = ak[i] ?? 0;
    const bv = bk[i] ?? 0;
    if (av > bv + 1e-9) return false;
    if (av < bv - 1e-9) strictlyBetter = true;
  }
  return strictlyBetter;
}

export function pruneDominatedCauldronCandidates(candidates: CauldronRuntimeCandidate[]): CauldronRuntimeCandidate[] {
  const sorted = [...candidates].sort(compareCauldronCandidatesByMaterialBurden);
  const kept: CauldronRuntimeCandidate[] = [];
  for (const candidate of sorted) {
    if (kept.some((existing) => dominatesCandidate(existing, candidate))) continue;
    kept.push(candidate);
  }
  return kept;
}

export function candidateContainsInput(candidate: CauldronRuntimeCandidate, inputItemIds: CauldronInputTuple): boolean {
  const a = [...candidate.inputItemIds].sort().join('\u0000');
  const b = [...inputItemIds].sort().join('\u0000');
  return a === b;
}
