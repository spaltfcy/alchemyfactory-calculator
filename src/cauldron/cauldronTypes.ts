import type { LocalizedText } from '../types';

export type CauldronDataStatus = 'unverified' | 'verified' | 'conflict';
export type CauldronObservedStatus = 'todo' | 'matched' | 'mismatch' | 'unknown';
export type CauldronMachineId = 'cauldron' | 'advanced_cauldron';

export type CauldronValueEntry = {
  itemId: string;
  value: number;
  status: CauldronDataStatus;
  note?: string;
};

export type CauldronTargetEntry = {
  itemId: string;
  targetValue: number;
  status: CauldronDataStatus;
  timeSec?: number;
  heatPerSec?: number;
  note?: string;
};

export type CauldronInputTuple = [string, string, string];

export type CauldronPrediction = {
  inputItemIds: CauldronInputTuple;
  rawScore: number;
  duplicatePenalty: number;
  adjustedScore: number;
  outputItemId?: string;
  targetValue?: number;
  distance?: number;
  missingInputItemIds: string[];
};

export type CauldronCandidate = CauldronPrediction & {
  id: string;
  outputItemId: string;
  targetValue: number;
  distance: number;
  distanceRatio: number;
  valueEfficiency: number;
  targetStatus: CauldronDataStatus;
  targetTimeSec?: number;
  targetHeatPerSec?: number;
};

export type CauldronObservedCase = {
  id: string;
  inputItemIds: CauldronInputTuple;
  predictedOutputItemId?: string;
  observedOutputItemId?: string;
  predictedScore: number;
  observedTimeSec?: number;
  observedHeatPerSec?: number;
  machineId?: CauldronMachineId;
  status: CauldronObservedStatus;
  note?: string;
  createdAt: string;
};

export type CauldronPlanItemStatus = 'startup' | 'normal' | 'cauldronTarget' | 'handCauldron' | 'missing' | 'cycle' | 'depthLimit';

export type CauldronPlanItem = {
  itemId: string;
  label: LocalizedText;
  amount: number;
  status: CauldronPlanItemStatus;
  reason: LocalizedText;
  recipeId?: string;
  candidateCount?: number;
  children: CauldronPlanItem[];
};

export type CauldronTargetPlan = {
  targetItemId: string;
  targetLabel: LocalizedText;
  status: 'provisional' | 'blocked' | 'startup';
  confidence: 'verified' | 'partiallyVerified' | 'predictedOnly' | 'blocked';
  root: CauldronPlanItem;
  missingItemIds: string[];
  cauldronCandidateItemIds: string[];
};

export type CauldronState = {
  inputItemIds: CauldronInputTuple;
  machineId: CauldronMachineId;
  candidateIndex: number;
  candidateTargetItemId: string;
  maxCandidates: number;
  allowDuplicateInputs: boolean;
  targetItemIdsText: string;
  startupItemIdsText: string;
  observedOutputItemId: string;
  observedTimeSec: string;
  observedHeatPerSec: string;
  observedStatus: CauldronObservedStatus;
  observedNote: string;
};
