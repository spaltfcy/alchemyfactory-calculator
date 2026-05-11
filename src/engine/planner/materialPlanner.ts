import type { CalculationResult, InitialInvestmentData, InitialInvestmentFlow, ItemStat } from '../calculationTypes';
import type { PlanCycleDecision, PlanModel } from './planModel';
import type { MaterialPlannerShadowResult, PlannerUnsupportedReason } from './materialPlannerTypes';
import { itemById } from '../../data/items';

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


function cloneItemStat(stat: ItemStat): ItemStat {
  return { ...stat };
}

function ensureItemStat(result: CalculationResult, itemId: string): ItemStat {
  const current = result.itemStats[itemId];
  if (current) return current;
  const next: ItemStat = {
    itemId,
    requested: 0,
    consumed: 0,
    produced: 0,
    purchased: 0,
    initialPurchased: 0,
    reused: 0,
    surplus: 0,
    discarded: 0,
    targetRequested: 0,
    targetActual: 0,
    purchaseCostCopperPerMin: 0,
    initialCostCopper: 0,
    revenueCopperPerMin: 0,
  };
  result.itemStats[itemId] = next;
  return next;
}

function cycleErrorsOnly(result: CalculationResult): boolean {
  const summaries = result.errorSummaries ?? [];
  if (summaries.length === 0) return false;
  const cycleCodes = new Set(['RECIPE_CYCLE_INVALID', 'ALTERNATE_RECIPE_REQUIRED_BUT_DISABLED']);
  return summaries.every((summary) => cycleCodes.has(summary.code));
}

function initialInvestmentFlowFor(componentId: string, recipeId: string, itemId: string, amount: number): InitialInvestmentFlow {
  return {
    id: 'cycle-startup:' + componentId + ':' + itemId + ':' + recipeId,
    from: { type: 'itemSource', itemId, sourceMode: 'cycleInput' },
    to: { type: 'recipe', recipeId },
    itemId,
    rate: amount,
    belts: 0,
    transportKind: 'belt',
    transportUnits: 0,
    role: 'material',
  };
}

function appendCycleInitialInvestment(base: InitialInvestmentData | undefined, decisions: PlanCycleDecision[]): InitialInvestmentData {
  const next: InitialInvestmentData = base
    ? {
        groups: [...base.groups],
        requiredByRecipe: Object.fromEntries(Object.entries(base.requiredByRecipe).map(([recipeId, itemIds]) => [recipeId, [...itemIds]])),
        purchasedItemIds: [...base.purchasedItemIds],
        unresolvedItemIds: [...base.unresolvedItemIds],
      }
    : { groups: [], requiredByRecipe: {}, purchasedItemIds: [], unresolvedItemIds: [] };

  for (const decision of decisions) {
    if (decision.classification !== 'cycleInput' || !decision.safeForMainResult) continue;
    const targetRecipeId = decision.recipeIds[0] ?? 'cycle-input';
    const requiredItemIds = Object.keys(decision.requiredInitialItems).filter((itemId) => (decision.requiredInitialItems[itemId] ?? 0) > 0);
    if (requiredItemIds.length === 0) continue;
    const existing = new Set(next.requiredByRecipe[targetRecipeId] ?? []);
    for (const itemId of requiredItemIds) existing.add(itemId);
    next.requiredByRecipe[targetRecipeId] = [...existing].sort((a, b) => a.localeCompare(b));
    next.groups.push({
      id: 'cycle-startup-' + decision.componentId,
      targetRecipeId,
      requiredItemIds,
      flows: requiredItemIds.map((itemId) => initialInvestmentFlowFor(decision.componentId, targetRecipeId, itemId, decision.requiredInitialItems[itemId] ?? 1)),
      recipeStats: {},
      purchasedItemIds: [],
      unresolvedItemIds: [],
    });
  }
  return next;
}

function buildStructuredAcceptedResult(planModel: PlanModel, legacyAlphaResult: CalculationResult): CalculationResult {
  const cycleDecisions = planModel.dependencyGraph.cycleDecisions;
  const safeCycleInputs = cycleDecisions.filter((decision) => decision.classification === 'cycleInput' && decision.safeForMainResult);
  const allDecisionsSafe = cycleDecisions.length > 0 && cycleDecisions.every((decision) => decision.safeForMainResult);
  const canPromoteCycleInput = safeCycleInputs.length > 0 && allDecisionsSafe && legacyAlphaResult.calculationStatus === 'invalid' && cycleErrorsOnly(legacyAlphaResult);
  const result: CalculationResult = {
    ...legacyAlphaResult,
    itemStats: Object.fromEntries(Object.entries(legacyAlphaResult.itemStats).map(([itemId, stat]) => [itemId, cloneItemStat(stat)])),
    recipeStats: { ...legacyAlphaResult.recipeStats },
    flows: [...legacyAlphaResult.flows],
    conveyorEdges: [...legacyAlphaResult.conveyorEdges],
    outputEdges: [...legacyAlphaResult.outputEdges],
    warnings: [...legacyAlphaResult.warnings],
    residualUnresolvedFlows: legacyAlphaResult.residualUnresolvedFlows ? [...legacyAlphaResult.residualUnresolvedFlows] : undefined,
    errorSummaries: legacyAlphaResult.errorSummaries ? [...legacyAlphaResult.errorSummaries] : undefined,
    totals: { ...legacyAlphaResult.totals },
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

  if (safeCycleInputs.length > 0) {
    result.initialInvestment = appendCycleInitialInvestment(result.initialInvestment, safeCycleInputs);
    for (const decision of safeCycleInputs) {
      for (const [itemId, amount] of Object.entries(decision.requiredInitialItems)) {
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const stat = ensureItemStat(result, itemId);
        stat.initialPurchased += amount;
        const price = itemById[itemId]?.buyPriceCopper ?? 0;
        stat.initialCostCopper += price * amount;
        result.totals.initialCostCopper += price * amount;
      }
    }
    result.warnings = [
      ...result.warnings,
      {
        messageJa: '循環レシピに初期投入が必要です。初期投資ラインとして本流の毎分購入とは分けて表示します。',
        messageEn: 'A recipe cycle requires startup input. It is shown as an initial-investment line and is not mixed into per-minute purchases.',
      },
    ];
  }

  if (canPromoteCycleInput) {
    result.calculationStatus = 'ok';
    result.errorSummaries = (result.errorSummaries ?? []).filter((summary) => summary.code !== 'RECIPE_CYCLE_INVALID' && summary.code !== 'ALTERNATE_RECIPE_REQUIRED_BUT_DISABLED');
    if (result.errorSummaries.length === 0) delete result.errorSummaries;
  } else if (cycleDecisions.some((decision) => !decision.safeForMainResult)) {
    result.calculationStatus = 'invalid';
    const unsafe = cycleDecisions.filter((decision) => !decision.safeForMainResult);
    result.errorSummaries = [
      ...(result.errorSummaries ?? []),
      ...unsafe.map((decision) => ({
        code: decision.classification === 'unsupported' ? 'RECIPE_CYCLE_UNSUPPORTED' : 'RECIPE_CYCLE_INVALID',
        messageJa: decision.reasonJa,
        messageEn: decision.reasonEn,
        itemIds: decision.itemIds,
        recipeIds: decision.recipeIds,
      })),
    ];
  }

  return result;
}

export function solveStructuredMaterialPlan(planModel: PlanModel, legacyAlphaResult: CalculationResult) {
  const base = runMaterialPlannerShadow(planModel, legacyAlphaResult);
  const cycleDecisions = planModel.dependencyGraph.cycleDecisions;
  const acceptedResult = buildStructuredAcceptedResult(planModel, legacyAlphaResult);

  const structuredPlan = {
    ...base,
    mode: 'structured-material-v0980' as const,
    status: acceptedResult.calculationStatus === 'invalid' ? 'partial' as const : 'ok' as const,
    cycleComponents: planModel.dependencyGraph.cycleComponents,
    cycleDecisions,
    acceptedResultStatus: acceptedResult.calculationStatus,
    legacyFallbackUsed: false,
    structuredResultAdopted: true,
    acceptedResultEngine: 'structured-material-v0980',
    trace: [
      ...base.trace,
      {
        phase: 'cycleDecisions',
        messageJa: 'cycleComponentsを本番判定用のcycleDecisionsへ変換しました。safeForMainResult=trueのcycleInputは初期投資として採用します。',
        messageEn: 'Converted cycleComponents into production-oriented cycleDecisions. cycleInput decisions with safeForMainResult=true are adopted as initial investment.',
        data: cycleDecisions,
      },
      {
        phase: 'structuredResultAdoption',
        messageJa: 'v0.9.8ではStructuredMaterialPlan由来のCalculationResultを採用します。alpha solverはDEBUG比較用の互換ベースとしてのみ記録します。',
        messageEn: 'v0.9.8 adopts the CalculationResult produced from StructuredMaterialPlan. The alpha solver is recorded only as a DEBUG compatibility comparison baseline.',
        data: { acceptedResultStatus: acceptedResult.calculationStatus, legacyFallbackUsed: false },
      },
    ],
    noteJa: 'v0.9.8ではStructuredMaterialPlanのcycleDecisionsをResultへ反映し、安全なcycleInputは初期投資ラインとしてOK resultに昇格します。',
    noteEn: 'v0.9.8 applies StructuredMaterialPlan cycleDecisions to the result and promotes safe cycleInput decisions to OK results with initial-investment lines.',
  };

  return { result: acceptedResult, structuredPlan };
}
