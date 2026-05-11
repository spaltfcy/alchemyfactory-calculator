export * from './calculationTypes';

import {
  buildLinearModelDiagnostics,
  calculateWithNewSolver,
} from './newSolver';
import {
  type CalculateInput,
  type CalculationDebugIssue,
  type CalculationDebugLog,
  type CalculationDebugResult,
  type CalculationResult,
  type CalculatedFlow,
  type ItemStat,
  type RecipeStat,
} from './calculationTypes';
import { itemById } from '../data/items';
import { recipeById } from '../data/recipes';
import { chooseRecipeForItem } from './itemSourceResolver';
import { buildPlanModel } from './planner/planModel';
import { runMaterialPlannerShadow, solveStructuredMaterialPlan } from './planner/materialPlanner';
import { comparePlannerResults } from './planner/comparePlannerResults';

const EPS = 1e-9;

export type SolvePlanOptions = {
  debug?: boolean;
};

export type SolvePlanResult = {
  result: CalculationResult;
  debugLog?: CalculationDebugResult['debugLog'];
};

const SOLVE_PLAN_MODE = 'solvePlan-v0980';
const SOLVE_PLAN_VERSION = '0.9.8';

function enabledTargetCount(input: CalculateInput): number {
  return input.targets.filter((target) => (target.enabled ?? true) !== false).length;
}

function disabledTargetCount(input: CalculateInput): number {
  return input.targets.filter((target) => (target.enabled ?? true) === false).length;
}

function diagnosticComparisonFor(result: CalculationResult, linearModelDiagnostics: ReturnType<typeof buildLinearModelDiagnostics> | undefined) {
  const linearSummary = linearModelDiagnostics?.linearBalanceModel?.summary;
  const resultRecipeIds = Object.keys(result.recipeStats).sort((a, b) => a.localeCompare(b));
  const resultItemIds = Object.keys(result.itemStats).sort((a, b) => a.localeCompare(b));
  const linearRecipeIds = [...(linearModelDiagnostics?.linearBalanceModel?.activeRecipeIds ?? [])].sort((a, b) => a.localeCompare(b));
  const linearItemIds = [...(linearModelDiagnostics?.linearBalanceModel?.activeItemIds ?? [])].sort((a, b) => a.localeCompare(b));
  const resultRecipeSet = new Set(resultRecipeIds);
  const resultItemSet = new Set(resultItemIds);
  const linearRecipeSet = new Set(linearRecipeIds);
  const linearItemSet = new Set(linearItemIds);
  const missingResultRecipeIds = resultRecipeIds.filter((recipeId) => !linearRecipeSet.has(recipeId));
  const missingResultItemIds = resultItemIds.filter((itemId) => !linearItemSet.has(itemId));
  const unusedCandidateRecipeIds = linearRecipeIds.filter((recipeId) => !resultRecipeSet.has(recipeId));
  const unusedCandidateItemIds = linearItemIds.filter((itemId) => !resultItemSet.has(itemId));
  const resultRecipeCount = resultRecipeIds.length;
  const resultItemCount = resultItemIds.length;
  const linearActiveRecipeCount = linearSummary?.activeRecipeCount;
  const linearActiveItemCount = linearSummary?.activeItemCount;
  const activeRecipeDelta = typeof linearActiveRecipeCount === 'number' ? linearActiveRecipeCount - resultRecipeCount : undefined;
  const activeItemDelta = typeof linearActiveItemCount === 'number' ? linearActiveItemCount - resultItemCount : undefined;
  const severeMismatch = missingResultRecipeIds.length > 0 || missingResultItemIds.length > 0;
  const candidateOnlyMismatch = !severeMismatch && (unusedCandidateRecipeIds.length > 0 || unusedCandidateItemIds.length > 0);
  return {
    resultFlowCount: result.flows.length,
    resultRecipeCount,
    resultItemCount,
    linearActiveRecipeCount,
    linearActiveItemCount,
    linearTargetCount: linearSummary?.targetCount,
    activeRecipeDelta,
    activeItemDelta,
    severeMismatch,
    candidateOnlyMismatch,
    missingResultRecipeIds,
    missingResultItemIds,
    unusedCandidateRecipeIds,
    unusedCandidateItemIds,
    unusedCandidateRecipeCount: unusedCandidateRecipeIds.length,
    unusedCandidateItemCount: unusedCandidateItemIds.length,
    recipeSets: {
      activePlanRecipes: resultRecipeIds,
      candidateRecipes: linearRecipeIds,
      unusedCandidateRecipes: unusedCandidateRecipeIds,
    },
    itemSets: {
      activePlanItems: resultItemIds,
      candidateItems: linearItemIds,
      unusedCandidateItems: unusedCandidateItemIds,
    },
    comparisonSeverity: severeMismatch ? 'warning' : candidateOnlyMismatch ? 'info' : 'none',
    diagnosticsOrigin: 'solvePlan-debug-linear-model-v0980',
    noteJa: 'v0.9.8ではactive/candidate/unusedを明示し、MaterialPlanner shadow comparisonを追加します。実result側のrecipe/itemが診断モデルに欠けている場合のみ強い警告にします。',
    noteEn: 'v0.9.8 explicitly separates active/candidate/unused diagnostics and adds MaterialPlanner shadow comparison. A strong warning is emitted only when recipes/items from the actual result are missing from the diagnostic model.',
  };
}

export function solvePlan(input: CalculateInput, options: SolvePlanOptions = {}): SolvePlanResult {
  const debug = options.debug === true;
  const planModel = buildPlanModel(input);
  const linearModelDiagnostics = debug ? buildLinearModelDiagnostics(input) : undefined;
  const newSolverResult = calculateWithNewSolver(input, linearModelDiagnostics);
  const structuredSolve = solveStructuredMaterialPlan(planModel, newSolverResult.result);
  const result = structuredSolve.result;

  if (!debug) return { result };

  const debugLog = buildDebugLogFromResult(input, result);
  const diagnostics = newSolverResult.linearModelDiagnostics ?? linearModelDiagnostics;
  const diagnosticComparison = diagnosticComparisonFor(result, diagnostics);
  const shadowResult = runMaterialPlannerShadow(planModel, newSolverResult.result);
  const plannerComparison = comparePlannerResults(newSolverResult.result, shadowResult);
  const structuredComparison = comparePlannerResults(newSolverResult.result, structuredSolve.structuredPlan);
  const materialPlannerShadow = {
    enabled: true as const,
    mode: 'structured-material-v0980' as const,
    planModel,
    shadowResult: structuredSolve.structuredPlan,
    structuredPlan: structuredSolve.structuredPlan,
    comparison: plannerComparison,
    cycleComponents: structuredSolve.structuredPlan.cycleComponents,
    cycleDecisions: structuredSolve.structuredPlan.cycleDecisions,
    alphaResultSummary: {
      recipeCount: Object.keys(newSolverResult.result.recipeStats).length,
      itemCount: Object.keys(newSolverResult.result.itemStats).length,
      flowCount: newSolverResult.result.flows.length,
      calculationStatus: newSolverResult.result.calculationStatus,
    },
  };
  const legacyAlphaComparison = {
    enabled: true as const,
    mode: 'legacy-alpha-vs-structured-v0980' as const,
    comparison: structuredComparison,
    legacyAlphaSummary: materialPlannerShadow.alphaResultSummary,
    structuredSummary: {
      recipeCount: Object.keys(result.recipeStats).length,
      itemCount: Object.keys(result.itemStats).length,
      flowCount: result.flows.length,
      calculationStatus: result.calculationStatus,
    },
    noteJa: 'v0.9.8ではStructuredMaterialPlan由来のResultを採用し、alpha solverはDEBUG時のlegacy比較として記録します。',
    noteEn: 'v0.9.8 adopts the StructuredMaterialPlan-derived result and records the alpha solver as a legacy DEBUG comparison.',
  };
  const extendedDebugLog = {
    ...debugLog,
    issues: diagnosticComparison.severeMismatch
      ? [
          ...debugLog.issues,
          {
            severity: 'warning' as const,
            code: 'LINEAR_DIAGNOSTIC_RESULT_DELTA',
            messageJa: '実計算結果に存在するrecipe/itemがlinearModelDiagnosticsに欠けています。診断モデルの乖離候補として確認してください。',
            messageEn: 'Some recipes/items from the actual result are missing from linearModelDiagnostics. Please inspect this as a diagnostic model mismatch candidate.',
            data: diagnosticComparison,
          },
        ]
      : debugLog.issues,
    resultEngine: 'structured-material-v0980',
    solverEngine: 'structured-material-v0980',
    solver: {
      mode: SOLVE_PLAN_MODE,
      version: SOLVE_PLAN_VERSION,
      debug,
      resultEngine: 'structured-material-v0980',
      solverEngine: 'structured-material-v0980',
      diagnosticsMode: diagnostics?.mode,
      normalizedTargetCount: input.targets.length,
      calculationTargetCount: input.targets.length,
      enabledTargetCount: enabledTargetCount(input),
      disabledTargetCount: disabledTargetCount(input),
      planModelSummary: planModel.summary,
      materialPlannerShadowMode: materialPlannerShadow.mode,
      materialPlannerShadowStatus: structuredSolve.structuredPlan.status,
    },
    diagnosticComparison,
    materialPlannerShadow,
    structuredMaterialPlan: structuredSolve.structuredPlan,
    cycleDecisions: structuredSolve.structuredPlan.cycleDecisions,
    legacyAlphaComparison,
    planModel,
    linearModelDiagnostics: diagnostics ? {
      ...diagnostics,
      linearBalanceModel: {
        ...diagnostics.linearBalanceModel,
        recipeSets: diagnosticComparison.recipeSets,
        itemSets: diagnosticComparison.itemSets,
      },
    } : diagnostics,
    alphaBalanceTrace: newSolverResult.alphaBalanceTrace,
  } as CalculationDebugResult['debugLog'] & {
    resultEngine: string;
    solverEngine: string;
    linearModelDiagnostics: typeof diagnostics;
    alphaBalanceTrace: typeof newSolverResult.alphaBalanceTrace;
  };

  return { result, debugLog: extendedDebugLog };
}

export function calculate(input: CalculateInput): CalculationResult {
  return solvePlan(input, { debug: false }).result;
}

function isFiniteDebugNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function invalidNumberFields(record: Record<string, unknown>, fields: string[]): string[] {
  return fields.filter((field) => !isFiniteDebugNumber(record[field]));
}

function debugItemNameJa(itemId: string): string {
  return itemById[itemId]?.name.ja ?? itemId;
}

function debugRecipeNameJa(recipeId: string): string {
  return recipeById[recipeId]?.name.ja ?? recipeId;
}

function debugEndpointJa(endpoint: CalculatedFlow['from'] | CalculatedFlow['to']): string {
  if (endpoint.type === 'recipe') return 'レシピ:' + debugRecipeNameJa(endpoint.recipeId);
  if (endpoint.type === 'itemSource') {
    const sourceLabel = endpoint.sourceMode === 'external'
      ? '外部生産:'
      : endpoint.sourceMode === 'cycleInput'
        ? '循環補填:'
        : endpoint.sourceMode === 'buy'
          ? '購入:'
          : '未解決:';
    return sourceLabel + debugItemNameJa(endpoint.itemId);
  }
  if (endpoint.type === 'itemSink') {
    const sinkLabel = endpoint.sinkMode === 'final' ? '最終出力' : endpoint.sinkMode === 'surplus' ? '余剰' : '破棄';
    return sinkLabel + ':' + debugItemNameJa(endpoint.itemId);
  }
  return '不明';
}

function compactDebugFlow(flow: CalculatedFlow) {
  return {
    id: flow.id,
    itemId: flow.itemId,
    itemNameJa: debugItemNameJa(flow.itemId),
    role: flow.role,
    from: debugEndpointJa(flow.from),
    to: debugEndpointJa(flow.to),
    rate: flow.rate,
    belts: flow.belts,
    transportKind: flow.transportKind,
    transportUnits: flow.transportUnits,
    invalidFields: invalidNumberFields(flow as unknown as Record<string, unknown>, ['rate', 'belts', 'transportUnits']),
  };
}

function invalidRateRecordEntries(record: Record<string, number>): Array<{ itemId: string; itemNameJa: string; value: number }> {
  return Object.entries(record)
    .filter(([, value]) => !isFiniteDebugNumber(value))
    .map(([itemId, value]) => ({ itemId, itemNameJa: debugItemNameJa(itemId), value }));
}

function buildDebugLogFromResult(input: CalculateInput, result: CalculationResult): CalculationDebugLog {
  const issues: CalculationDebugIssue[] = [];
  const flowsByRole: Record<string, number> = {};
  const flowsByTransport: Record<string, number> = {};
  const purchasedAutoCraftableFlows: CalculationDebugLog['purchasedAutoCraftableFlows'] = [];

  for (const flow of result.flows) {
    flowsByRole[flow.role] = (flowsByRole[flow.role] ?? 0) + 1;
    flowsByTransport[flow.transportKind] = (flowsByTransport[flow.transportKind] ?? 0) + 1;
    if (flow.from.type === 'itemSource' && (flow.from.sourceMode === 'buy' || flow.from.sourceMode === 'cycleInput') && flow.to.type === 'recipe') {
      const selectedRecipe = chooseRecipeForItem(flow.itemId, input.recipePreferences);
      if (selectedRecipe && flow.rate > EPS) {
        purchasedAutoCraftableFlows.push({
          itemId: flow.itemId,
          rate: flow.rate,
          consumerRecipeId: flow.to.recipeId,
          selectedRecipeId: selectedRecipe.id,
          role: flow.role,
        });
      }
    }
  }

  const nonCyclePurchasedAutoCraftableFlows = purchasedAutoCraftableFlows.filter((entry) => {
    const sourceFlow = result.flows.find((flow) =>
      flow.itemId === entry.itemId
      && flow.to.type === 'recipe'
      && flow.to.recipeId === entry.consumerRecipeId
      && flow.from.type === 'itemSource'
      && (flow.from.sourceMode === 'buy' || flow.from.sourceMode === 'cycleInput')
      && Math.abs(flow.rate - entry.rate) <= 0.000001,
    );
    return sourceFlow?.from.type !== 'itemSource' || sourceFlow.from.sourceMode !== 'cycleInput';
  });

  if (nonCyclePurchasedAutoCraftableFlows.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'AUTO_CRAFTABLE_ITEM_PURCHASED',
      messageJa: 'auto設定で生産レシピがあるアイテムが購入扱いに落ちています。solverで未解決需要が残っている可能性があります。',
      messageEn: 'An auto item with a craftable recipe was purchased. The solver may have left an unresolved demand.',
      data: nonCyclePurchasedAutoCraftableFlows,
    });
  }

  const invalidNumericFlows = result.flows.filter((flow) =>
    invalidNumberFields(flow as unknown as Record<string, unknown>, ['rate', 'belts', 'transportUnits']).length > 0,
  );
  if (invalidNumericFlows.length > 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_NUMERIC_FLOW',
      messageJa: '有限数ではない流量・搬送本数のフローがあります。',
      messageEn: 'Some flows have non-finite rate or transport numbers.',
      data: invalidNumericFlows.map(compactDebugFlow),
    });
  }

  const itemNumericFields: Array<keyof ItemStat> = [
    'requested',
    'consumed',
    'produced',
    'purchased',
    'initialPurchased',
    'reused',
    'surplus',
    'discarded',
    'targetRequested',
    'targetActual',
    'purchaseCostCopperPerMin',
    'initialCostCopper',
    'revenueCopperPerMin',
  ];
  const invalidItemStats = Object.values(result.itemStats)
    .map((stat) => ({
      itemId: stat.itemId,
      itemNameJa: debugItemNameJa(stat.itemId),
      invalidFields: invalidNumberFields(stat as unknown as Record<string, unknown>, itemNumericFields as string[]),
      stat,
    }))
    .filter((entry) => entry.invalidFields.length > 0);
  if (invalidItemStats.length > 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_NUMERIC_ITEM_STAT',
      messageJa: '有限数ではないアイテム集計があります。',
      messageEn: 'Some item statistics contain non-finite numbers.',
      data: invalidItemStats,
    });
  }

  const invalidRecipeStats = Object.values(result.recipeStats)
    .map((stat) => {
      const invalidFields = invalidNumberFields(stat as unknown as Record<string, unknown>, [
        'theoreticalMachines',
        'actualMachines',
        'runsPerMinute',
      ]);
      const invalidRecords = {
        inputRates: invalidRateRecordEntries(stat.inputRates),
        outputRates: invalidRateRecordEntries(stat.outputRates),
        surplusOutputRates: invalidRateRecordEntries(stat.surplusOutputRates),
        discardedOutputRates: invalidRateRecordEntries(stat.discardedOutputRates),
      };
      const hasInvalidRecord = Object.values(invalidRecords).some((entries) => entries.length > 0);
      return {
        recipeId: stat.recipeId,
        recipeNameJa: debugRecipeNameJa(stat.recipeId),
        invalidFields,
        invalidRecords,
        stat,
        hasInvalidRecord,
      };
    })
    .filter((entry) => entry.invalidFields.length > 0 || entry.hasInvalidRecord);
  if (invalidRecipeStats.length > 0) {
    issues.push({
      severity: 'error',
      code: 'INVALID_NUMERIC_RECIPE_STAT',
      messageJa: '有限数ではないレシピ集計があります。',
      messageEn: 'Some recipe statistics contain non-finite numbers.',
      data: invalidRecipeStats,
    });
  }

  const invalidTransportFlows = result.flows.filter((flow) => {
    if (invalidNumericFlows.some((invalid) => invalid.id === flow.id)) return false;
    if (!isFiniteDebugNumber(flow.rate) || !isFiniteDebugNumber(flow.belts) || !isFiniteDebugNumber(flow.transportUnits)) return false;
    if (flow.transportKind === 'pipeline') return flow.transportUnits !== 1 || flow.belts !== 1;
    return flow.transportKind === 'belt' && flow.transportUnits !== flow.belts;
  });
  if (invalidTransportFlows.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'FLOW_TRANSPORT_UNITS_MISMATCH',
      messageJa: '搬送種別と搬送本数の整合が取れていないフローがあります。',
      messageEn: 'Some flows have inconsistent transport kind and transport unit counts.',
      data: invalidTransportFlows.map((flow) => ({
        id: flow.id,
        itemId: flow.itemId,
        role: flow.role,
        rate: flow.rate,
        belts: flow.belts,
        transportKind: flow.transportKind,
        transportUnits: flow.transportUnits,
      })),
    });
  }

  const fertilizerFlowTotal = result.flows
    .filter((flow) => flow.role === 'fertilizer')
    .reduce((sum, flow) => sum + flow.rate, 0);
  const fertilizerDelta = Math.abs(fertilizerFlowTotal - result.totals.fertilizerRequiredPerMin);
  if (fertilizerDelta > 0.001) {
    issues.push({
      severity: 'warning',
      code: 'FERTILIZER_FLOW_TOTAL_MISMATCH',
      messageJa: '肥料の必要量と肥料フロー合計が一致していません。',
      messageEn: 'Fertilizer required rate does not match the total fertilizer flow rate.',
      data: {
        fertilizerItemId: result.totals.fertilizerItemId,
        fertilizerRequiredPerMin: result.totals.fertilizerRequiredPerMin,
        fertilizerFlowTotal,
        delta: fertilizerDelta,
      },
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    input: JSON.parse(JSON.stringify(input)) as CalculateInput,
    totals: result.totals,
    warnings: result.warnings,
    issues,
    summary: {
      itemCount: Object.keys(result.itemStats).length,
      recipeCount: Object.keys(result.recipeStats).length,
      flowCount: result.flows.length,
      flowsByRole,
      flowsByTransport,
      purchasedAutoCraftableCount: nonCyclePurchasedAutoCraftableFlows.length,
    },
    initialInvestment: result.initialInvestment,
    residualUnresolvedFlows: result.residualUnresolvedFlows ?? [],
    purchasedAutoCraftableFlows: nonCyclePurchasedAutoCraftableFlows,
    flows: result.flows,
    itemStats: Object.values(result.itemStats).sort((a, b) => a.itemId.localeCompare(b.itemId)),
    recipeStats: Object.values(result.recipeStats).sort((a, b) => a.recipeId.localeCompare(b.recipeId)),
  };
}

export function calculateWithDebug(input: CalculateInput): CalculationDebugResult {
  const solved = solvePlan(input, { debug: true });
  return {
    result: solved.result,
    debugLog: solved.debugLog ?? buildDebugLogFromResult(input, solved.result),
  };
}
