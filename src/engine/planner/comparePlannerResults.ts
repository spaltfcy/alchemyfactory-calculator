import type { MaterialPlannerShadowResult, PlannerComparisonResult } from './materialPlannerTypes';

const ABS_EPS = 1e-7;
const REL_EPS = 1e-6;

export function buildStructuredAdoptionComparison(shadow: MaterialPlannerShadowResult): PlannerComparisonResult {
  return {
    status: 'not-compared',
    mode: 'structured-adoption-v09210',
    epsilon: { absolute: ABS_EPS, relative: REL_EPS },
    summary: {
      referenceRecipeCount: 0,
      structuredRecipeCount: Object.keys(shadow.recipeRuns).length,
      referenceItemCount: 0,
      structuredItemCount: new Set([
        ...Object.keys(shadow.itemDemand),
        ...Object.keys(shadow.itemProduced),
        ...Object.keys(shadow.purchased),
        ...Object.keys(shadow.surplus),
        ...Object.keys(shadow.discarded),
      ]).size,
      recipeDiffCount: 0,
      itemDiffCount: 0,
      sourceDiffCount: 0,
      unsupportedCycleCount: shadow.cycleComponents.length,
    },
    recipeDiffs: [],
    itemDiffs: [],
    sourceDiffs: [],
    reasonCandidates: shadow.unsupportedReasons,
    noteJa: 'v0.9.21では旧比較solverを削除し、ここにはstructured resultの採用状態だけを記録します。',
    noteEn: 'In v0.9.21, the retired comparison solver was removed. This artifact records only structured result adoption.',
  };
}
