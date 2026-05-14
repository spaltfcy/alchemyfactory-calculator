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

export function runMaterialPlannerShadow(planModel: PlanModel, structuredBaseResult: CalculationResult): MaterialPlannerShadowResult {
  const recipeRuns = positiveRecord(Object.entries(structuredBaseResult.recipeStats).map(([recipeId, stat]) => [recipeId, stat.runsPerMinute]));
  const itemDemand = positiveRecord(Object.entries(structuredBaseResult.itemStats).map(([itemId, stat]) => [itemId, stat.consumed]));
  const itemProduced = positiveRecord(Object.entries(structuredBaseResult.itemStats).map(([itemId, stat]) => [itemId, stat.produced]));
  const purchased = positiveRecord(Object.entries(structuredBaseResult.itemStats).map(([itemId, stat]) => [itemId, stat.purchased]));
  const unresolved = positiveRecord((structuredBaseResult.residualUnresolvedFlows ?? []).map((flow) => [flow.itemId, flow.rate]));
  const surplus = positiveRecord(Object.entries(structuredBaseResult.itemStats).map(([itemId, stat]) => [itemId, stat.surplus]));
  const discarded = positiveRecord(Object.entries(structuredBaseResult.itemStats).map(([itemId, stat]) => [itemId, stat.discarded]));
  const unsupportedReasons: PlannerUnsupportedReason[] = planModel.dependencyGraph.cycleComponents.map((cycle) => ({
    code: 'SHADOW_CYCLE_COMPONENT_DETECTED',
    messageJa: 'structured planner が循環成分を検出しました。cycleDecisionとして本番Resultへ反映し、安全なcycleInputは初期投資扱いにします。',
    messageEn: 'The structured planner detected a cycle component. It is applied to the production result as a cycleDecision; safe cycleInput decisions become startup input.',
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
        messageJa: 'structured plannerのmaterial summaryを生成します。legacy alphaはv0.9.19以降、DEBUG経路でも実行しません。',
        messageEn: 'Builds a material summary for the structured planner. Legacy alpha is DEBUG comparison only.',
      },
    ],
    noteJa: 'MaterialPlannerはstructured planner結果の材料サマリです。DAG/cycle/source分類をログ化し、legacy alphaとはDEBUG比較します。',
    noteEn: 'The MaterialPlanner summary belongs to the accepted structured planner result. It logs DAG/cycle/source classification and compares against legacy alpha for DEBUG only.',
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
    role: 'cycleInput',
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

function buildStructuredAcceptedResult(planModel: PlanModel, structuredBaseResult: CalculationResult): CalculationResult {
  const cycleDecisions = planModel.dependencyGraph.cycleDecisions;
  const safeCycleInputs = cycleDecisions.filter((decision) => decision.classification === 'cycleInput' && decision.safeForMainResult);
  const allDecisionsSafe = cycleDecisions.length > 0 && cycleDecisions.every((decision) => decision.safeForMainResult);
  const canPromoteCycleInput = safeCycleInputs.length > 0 && allDecisionsSafe && structuredBaseResult.calculationStatus === 'invalid' && cycleErrorsOnly(structuredBaseResult);
  const result: CalculationResult = {
    ...structuredBaseResult,
    itemStats: Object.fromEntries(Object.entries(structuredBaseResult.itemStats).map(([itemId, stat]) => [itemId, cloneItemStat(stat)])),
    recipeStats: { ...structuredBaseResult.recipeStats },
    flows: [...structuredBaseResult.flows],
    conveyorEdges: [...structuredBaseResult.conveyorEdges],
    outputEdges: [...structuredBaseResult.outputEdges],
    warnings: [...structuredBaseResult.warnings],
    residualUnresolvedFlows: structuredBaseResult.residualUnresolvedFlows ? [...structuredBaseResult.residualUnresolvedFlows] : undefined,
    errorSummaries: structuredBaseResult.errorSummaries ? [...structuredBaseResult.errorSummaries] : undefined,
    totals: { ...structuredBaseResult.totals },
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

export function solveStructuredMaterialPlan(planModel: PlanModel, structuredBaseResult: CalculationResult) {
  const base = runMaterialPlannerShadow(planModel, structuredBaseResult);
  const cycleDecisions = planModel.dependencyGraph.cycleDecisions;
  const acceptedResult = buildStructuredAcceptedResult(planModel, structuredBaseResult);

  const structuredPlan = {
    ...base,
    mode: 'structured-material-v09190' as const,
    status: acceptedResult.calculationStatus === 'invalid' ? 'partial' as const : 'ok' as const,
    cycleComponents: planModel.dependencyGraph.cycleComponents,
    cycleDecisions,
    acceptedResultStatus: acceptedResult.calculationStatus,
    legacyFallbackUsed: false,
    structuredResultAdopted: true,
    acceptedResultEngine: 'structured-material-v09190',
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
        messageJa: 'StructuredBalanceSolverで生成したCalculationResultへcycleDecisionを反映して採用しています。legacy alphaはv0.9.19以降、DEBUG経路でも実行しません。',
        messageEn: 'The CalculationResult produced by StructuredBalanceSolver is accepted after applying cycle decisions. Legacy alpha is not executed in DEBUG mode since v0.9.19.',
        data: { acceptedResultStatus: acceptedResult.calculationStatus, legacyFallbackUsed: false },
      },
    ],
    noteJa: 'StructuredMaterialPlanのcycleDecisionsをResultへ反映し、安全なcycleInputは初期投資ラインとしてOK resultに昇格します。',
    noteEn: 'StructuredMaterialPlan cycleDecisions are applied to the result; safe cycleInput decisions are promoted to OK results with initial-investment lines.',
  };

  return { result: acceptedResult, structuredPlan };
}
