import type { CalculationResult } from '../calculationTypes';
import type { PlanCycleComponent, PlanModel } from './planModel';

export type PlannerUnsupportedReason = {
  code: string;
  messageJa: string;
  messageEn: string;
  data?: unknown;
};

export type MaterialPlannerTraceStep = {
  phase: string;
  messageJa: string;
  messageEn: string;
  data?: unknown;
};

export type MaterialPlannerShadowResult = {
  status: 'ok' | 'partial' | 'unsupported';
  mode: 'shadow-dag-v0960' | 'structured-material-v09230';
  planSummary: PlanModel['summary'];
  recipeRuns: Record<string, number>;
  itemDemand: Record<string, number>;
  itemProduced: Record<string, number>;
  purchased: Record<string, number>;
  unresolved: Record<string, number>;
  surplus: Record<string, number>;
  discarded: Record<string, number>;
  cycleComponents: PlanCycleComponent[];
  unsupportedReasons: PlannerUnsupportedReason[];
  trace: MaterialPlannerTraceStep[];
  noteJa: string;
  noteEn: string;
};

export type PlannerNumericDiff = {
  id: string;
  field: string;
  reference: number;
  shadow: number;
  delta: number;
};

export type PlannerComparisonResult = {
  status: 'match' | 'diff' | 'not-compared';
  mode: 'structured-adoption-v09230';
  epsilon: { absolute: number; relative: number };
  summary: {
    referenceRecipeCount: number;
    structuredRecipeCount: number;
    referenceItemCount: number;
    structuredItemCount: number;
    recipeDiffCount: number;
    itemDiffCount: number;
    sourceDiffCount: number;
    unsupportedCycleCount: number;
  };
  recipeDiffs: PlannerNumericDiff[];
  itemDiffs: PlannerNumericDiff[];
  sourceDiffs: PlannerNumericDiff[];
  reasonCandidates: PlannerUnsupportedReason[];
  noteJa: string;
  noteEn: string;
};

export type MaterialPlannerShadowArtifact = {
  enabled: true;
  mode: 'shadow-dag-v0960' | 'structured-material-v09230';
  planModel: PlanModel;
  shadowResult: MaterialPlannerShadowResult;
  comparison: PlannerComparisonResult;
  cycleComponents: PlanCycleComponent[];
  acceptedResultSummary: {
    recipeCount: number;
    itemCount: number;
    flowCount: number;
    calculationStatus: CalculationResult['calculationStatus'];
  };
};


export type StructuredMaterialPlan = MaterialPlannerShadowResult & {
  mode: 'structured-material-v09230';
  acceptedResultStatus: CalculationResult['calculationStatus'];
  cycleDecisions: PlanModel['dependencyGraph']['cycleDecisions'];
  fallbackUsed: boolean;
  fallbackReason?: string;
  structuredResultAdopted?: boolean;
  acceptedResultEngine?: string;
};
