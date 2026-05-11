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
  mode: 'shadow-dag-v0960' | 'structured-material-v0970' | 'structured-material-v0980' | 'structured-material-v0990' | 'structured-material-v09110';
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
  alpha: number;
  shadow: number;
  delta: number;
};

export type PlannerComparisonResult = {
  status: 'match' | 'diff' | 'not-compared';
  mode: 'alpha-vs-shadow-v0960' | 'legacy-alpha-vs-structured-v0970' | 'legacy-alpha-vs-structured-v0980' | 'legacy-alpha-vs-structured-v0990' | 'legacy-alpha-vs-structured-v09110';
  epsilon: { absolute: number; relative: number };
  summary: {
    alphaRecipeCount: number;
    shadowRecipeCount: number;
    alphaItemCount: number;
    shadowItemCount: number;
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
  mode: 'shadow-dag-v0960' | 'structured-material-v0970' | 'structured-material-v0980' | 'structured-material-v0990' | 'structured-material-v09110';
  planModel: PlanModel;
  shadowResult: MaterialPlannerShadowResult;
  comparison: PlannerComparisonResult;
  cycleComponents: PlanCycleComponent[];
  alphaResultSummary: {
    recipeCount: number;
    itemCount: number;
    flowCount: number;
    calculationStatus: CalculationResult['calculationStatus'];
  };
};


export type StructuredMaterialPlan = MaterialPlannerShadowResult & {
  mode: 'structured-material-v0970' | 'structured-material-v0980' | 'structured-material-v0990' | 'structured-material-v09110';
  acceptedResultStatus: CalculationResult['calculationStatus'];
  cycleDecisions: PlanModel['dependencyGraph']['cycleDecisions'];
  legacyFallbackUsed: boolean;
  legacyFallbackReason?: string;
  structuredResultAdopted?: boolean;
  acceptedResultEngine?: string;
};

export type LegacyAlphaComparisonArtifact = {
  enabled: boolean;
  mode: 'legacy-alpha-vs-structured-v0970' | 'legacy-alpha-vs-structured-v0980' | 'legacy-alpha-vs-structured-v0990' | 'legacy-alpha-vs-structured-v09110';
  comparison: PlannerComparisonResult;
  numericComparison?: PlannerComparisonResult;
  statusComparison?: {
    status: 'match' | 'changed';
    legacyStatus?: CalculationResult['calculationStatus'];
    structuredStatus?: CalculationResult['calculationStatus'];
    acceptedStatus?: CalculationResult['calculationStatus'];
  };
  acceptedResultEngine?: string;
  legacyAlphaSummary: {
    recipeCount: number;
    itemCount: number;
    flowCount: number;
    calculationStatus: CalculationResult['calculationStatus'];
  };
  structuredSummary: {
    recipeCount: number;
    itemCount: number;
    flowCount: number;
    calculationStatus: CalculationResult['calculationStatus'];
  };
  noteJa: string;
  noteEn: string;
};
