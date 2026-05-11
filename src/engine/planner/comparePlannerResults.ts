import type { CalculationResult } from '../calculationTypes';
import type { MaterialPlannerShadowResult, PlannerComparisonResult, PlannerNumericDiff } from './materialPlannerTypes';

const ABS_EPS = 1e-7;
const REL_EPS = 1e-6;

function closeEnough(a: number, b: number): boolean {
  const delta = Math.abs(a - b);
  if (delta <= ABS_EPS) return true;
  return delta <= Math.max(Math.abs(a), Math.abs(b), 1) * REL_EPS;
}

function diffRecord(alpha: Record<string, number>, shadow: Record<string, number>, field: string): PlannerNumericDiff[] {
  const ids = [...new Set([...Object.keys(alpha), ...Object.keys(shadow)])].sort((a, b) => a.localeCompare(b));
  const diffs: PlannerNumericDiff[] = [];
  for (const id of ids) {
    const a = alpha[id] ?? 0;
    const s = shadow[id] ?? 0;
    if (!closeEnough(a, s)) diffs.push({ id, field, alpha: a, shadow: s, delta: Number((s - a).toPrecision(12)) });
  }
  return diffs;
}

function alphaRecipeRuns(result: CalculationResult): Record<string, number> {
  return Object.fromEntries(Object.entries(result.recipeStats).map(([recipeId, stat]) => [recipeId, stat.runsPerMinute]));
}

function alphaItemField(result: CalculationResult, field: 'consumed' | 'produced' | 'purchased' | 'surplus' | 'discarded'): Record<string, number> {
  return Object.fromEntries(Object.entries(result.itemStats).map(([itemId, stat]) => [itemId, stat[field]]));
}

export function comparePlannerResults(alphaResult: CalculationResult, shadow: MaterialPlannerShadowResult): PlannerComparisonResult {
  const recipeDiffs = diffRecord(alphaRecipeRuns(alphaResult), shadow.recipeRuns, 'runsPerMinute');
  const itemDiffs = [
    ...diffRecord(alphaItemField(alphaResult, 'consumed'), shadow.itemDemand, 'consumed'),
    ...diffRecord(alphaItemField(alphaResult, 'produced'), shadow.itemProduced, 'produced'),
    ...diffRecord(alphaItemField(alphaResult, 'surplus'), shadow.surplus, 'surplus'),
    ...diffRecord(alphaItemField(alphaResult, 'discarded'), shadow.discarded, 'discarded'),
  ];
  const sourceDiffs = diffRecord(alphaItemField(alphaResult, 'purchased'), shadow.purchased, 'purchased');
  const diffCount = recipeDiffs.length + itemDiffs.length + sourceDiffs.length;
  return {
    status: diffCount > 0 ? 'diff' : 'match',
    mode: 'alpha-vs-shadow-v0960',
    epsilon: { absolute: ABS_EPS, relative: REL_EPS },
    summary: {
      alphaRecipeCount: Object.keys(alphaResult.recipeStats).length,
      shadowRecipeCount: Object.keys(shadow.recipeRuns).length,
      alphaItemCount: Object.keys(alphaResult.itemStats).length,
      shadowItemCount: new Set([
        ...Object.keys(shadow.itemDemand),
        ...Object.keys(shadow.itemProduced),
        ...Object.keys(shadow.purchased),
        ...Object.keys(shadow.surplus),
        ...Object.keys(shadow.discarded),
      ]).size,
      recipeDiffCount: recipeDiffs.length,
      itemDiffCount: itemDiffs.length,
      sourceDiffCount: sourceDiffs.length,
      unsupportedCycleCount: shadow.cycleComponents.length,
    },
    recipeDiffs,
    itemDiffs,
    sourceDiffs,
    reasonCandidates: shadow.unsupportedReasons,
    noteJa: 'v0.9.6ではalpha solverを正としてshadow plannerとの差分を出します。DAG独立計算への切替前に差分箇所を特定するためのログです。',
    noteEn: 'v0.9.6 treats the alpha solver as the accepted result and reports differences against the shadow planner before switching to the independent DAG planner.',
  };
}
