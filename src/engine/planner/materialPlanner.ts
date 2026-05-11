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


export function solveStructuredMaterialPlan(planModel: PlanModel, legacyAlphaResult: CalculationResult) {
  const base = runMaterialPlannerShadow(planModel, legacyAlphaResult);
  const cycleDecisions = planModel.dependencyGraph.cycleDecisions;
  const acceptedResult: CalculationResult = {
    ...legacyAlphaResult,
    cycleDecisions: cycleDecisions.map((decision) => ({
      componentId: decision.componentId,
      classification: decision.classification,
      candidateClassification: decision.candidateClassification,
      itemIds: decision.itemIds,
      recipeIds: decision.recipeIds,
      requiredInitialItems: decision.requiredInitialItems,
      runningExternalInputs: decision.runningExternalInputs,
      safeForMainResult: decision.safeForMainResult,
      reasonJa: decision.reasonJa,
      reasonEn: decision.reasonEn,
    })),
  };

  const structuredPlan = {
    ...base,
    mode: 'structured-material-v0970' as const,
    status: cycleDecisions.some((decision) => decision.classification === 'unsupported' || decision.classification === 'invalid') ? 'partial' as const : base.status,
    cycleComponents: planModel.dependencyGraph.cycleComponents,
    cycleDecisions,
    acceptedResultStatus: acceptedResult.calculationStatus,
    legacyFallbackUsed: true,
    legacyFallbackReason: 'v0.9.7 promotes the structured planner decision model and result contract while preserving the alpha numeric result as the compatibility baseline until the final DAG numeric solver is enabled.',
    trace: [
      ...base.trace,
      {
        phase: 'cycleDecisions',
        messageJa: 'cycleComponentsを本番判定用のcycleDecisionsへ変換しました。安全に扱える循環だけsafeForMainResult=trueにします。',
        messageEn: 'Converted cycleComponents into production-oriented cycleDecisions. Only cycles proven safe are marked safeForMainResult=true.',
        data: cycleDecisions,
      },
      {
        phase: 'structuredResultContract',
        messageJa: 'v0.9.7ではCalculationResultへcycleDecisionsを追加し、Graph/Table/Debugが同じResultを読む構造に寄せています。数値本体は互換性のためalpha結果を基準にしています。',
        messageEn: 'v0.9.7 adds cycleDecisions to CalculationResult and aligns Graph/Table/Debug around the same result contract. Numeric rates still use the alpha-compatible baseline for safety.',
      },
    ],
    noteJa: 'v0.9.7のStructuredMaterialPlanはPlanModel/cycleDecisions/Result契約を本番構造へ昇格します。数値解は互換性維持のためalpha baselineを利用します。',
    noteEn: 'The v0.9.7 StructuredMaterialPlan promotes PlanModel/cycleDecisions/Result contract to the production structure. Numeric solving still uses the alpha baseline for compatibility.',
  };

  return { result: acceptedResult, structuredPlan };
}
