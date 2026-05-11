import type { CalculationResult } from '../calculationTypes';
import type { PlanModel } from './planModel';
import type { MaterialPlannerShadowResult, PlannerUnsupportedReason } from './materialPlannerTypes';

function positiveRecord(entries: Array<[string, number]>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of entries) {
    if (Number.isFinite(value) && Math.abs(value) > 1e-9) result[key] = value;
  }
  return result;
}

export function runMaterialPlannerShadow(planModel: PlanModel, alphaResult: CalculationResult): MaterialPlannerShadowResult {
  const recipeRuns = positiveRecord(Object.entries(alphaResult.recipeStats).map(([recipeId, stat]) => [recipeId, stat.runsPerMinute]));
  const itemDemand = positiveRecord(Object.entries(alphaResult.itemStats).map(([itemId, stat]) => [itemId, stat.consumed]));
  const itemProduced = positiveRecord(Object.entries(alphaResult.itemStats).map(([itemId, stat]) => [itemId, stat.produced]));
  const purchased = positiveRecord(Object.entries(alphaResult.itemStats).map(([itemId, stat]) => [itemId, stat.purchased]));
  const unresolved = positiveRecord((alphaResult.residualUnresolvedFlows ?? []).map((flow) => [flow.itemId, flow.rate]));
  const surplus = positiveRecord(Object.entries(alphaResult.itemStats).map(([itemId, stat]) => [itemId, stat.surplus]));
  const discarded = positiveRecord(Object.entries(alphaResult.itemStats).map(([itemId, stat]) => [itemId, stat.discarded]));
  const unsupportedReasons: PlannerUnsupportedReason[] = planModel.dependencyGraph.cycleComponents.map((cycle) => ({
    code: 'SHADOW_CYCLE_COMPONENT_DETECTED',
    messageJa: 'shadow planner が循環成分を検出しました。v0.9.6では分類のみ行い、本番結果はalpha solverを採用します。',
    messageEn: 'The shadow planner detected a cycle component. v0.9.6 classifies it only; the production result still comes from the alpha solver.',
    data: cycle,
  }));
  const status = unsupportedReasons.length > 0 ? 'partial' : 'ok';
  return {
    status,
    mode: 'shadow-dag-v0960',
    planSummary: planModel.summary,
    recipeRuns,
    itemDemand,
    itemProduced,
    purchased,
    unresolved,
    surplus,
    discarded,
    cycleComponents: planModel.dependencyGraph.cycleComponents,
    unsupportedReasons,
    trace: [
      {
        phase: 'buildPlanModel',
        messageJa: 'CalculateInputをPlanModelに正規化しました。',
        messageEn: 'Normalized CalculateInput into PlanModel.',
        data: planModel.summary,
      },
      {
        phase: 'activeDependencyGraph',
        messageJa: '選択レシピ依存グラフと循環成分を検出しました。',
        messageEn: 'Detected selected recipe dependency graph and cycle components.',
        data: {
          activeRecipeIds: planModel.dependencyGraph.activeRecipeIds,
          dependencyEdgeCount: planModel.dependencyGraph.edges.length,
          cycleComponentCount: planModel.dependencyGraph.cycleComponents.length,
        },
      },
      {
        phase: 'shadowResult',
        messageJa: 'v0.9.6ではalpha結果を基準にshadow比較用のmaterial summaryを生成します。DAG独立解法への本番切替はv0.9.7で行います。',
        messageEn: 'v0.9.6 builds a material summary for shadow comparison using the alpha result as the accepted baseline. Production switch to the independent DAG solver is planned for v0.9.7.',
      },
    ],
    noteJa: 'v0.9.6のMaterialPlannerは本番切替前のshadow比較版です。DAG/cycle/source分類をログ化し、計算結果そのものはalpha solverを正として比較します。',
    noteEn: 'The v0.9.6 MaterialPlanner is a pre-switch shadow comparison. It logs DAG/cycle/source classifications and compares against the alpha solver as the accepted production result.',
  };
}
