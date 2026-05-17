export * from './calculationTypes';

import {
  buildSolverDiagnostics,
  buildSolverDiagnosticsForAcceptedResult,
  type SolverDiagnostics,
} from './solverDiagnostics';
import { calculateStructuredBalance } from './structuredBalanceSolver';
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
import { HEAT_CONSUMER_BY_MACHINE_ID } from '../data/heat';
import { buildRecipeDataAudit } from '../data/recipeDataAudit';
import { chooseRecipeForItem } from './itemSourceResolver';
import { buildPlanModel } from './planner/planModel';
import { solveStructuredMaterialPlan } from './planner/materialPlanner';
import { buildStructuredAdoptionComparison } from './planner/comparePlannerResults';

const EPS = 1e-9;

export type SolvePlanOptions = {
  debug?: boolean;
};

export type SolvePlanResult = {
  result: CalculationResult;
  debugLog?: CalculationDebugResult['debugLog'];
};

const SOLVE_PLAN_MODE = 'solvePlan-v09240';
const SOLVE_PLAN_VERSION = '0.9.24';

function enabledTargetCount(input: CalculateInput): number {
  return input.targets.filter((target) => (target.enabled ?? true) !== false).length;
}

function disabledTargetCount(input: CalculateInput): number {
  return input.targets.filter((target) => (target.enabled ?? true) === false).length;
}

function diagnosticComparisonFor(result: CalculationResult, solverDiagnostics: ReturnType<typeof buildSolverDiagnostics> | undefined) {
  const diagnosticSummary = solverDiagnostics?.diagnosticBalanceModel?.summary;
  const resultRecipeIds = Object.keys(result.recipeStats).sort((a, b) => a.localeCompare(b));
  const resultItemIds = Object.keys(result.itemStats).sort((a, b) => a.localeCompare(b));
  const diagnosticRecipeIds = [...(solverDiagnostics?.diagnosticBalanceModel?.activeRecipeIds ?? [])].sort((a, b) => a.localeCompare(b));
  const diagnosticItemIds = [...(solverDiagnostics?.diagnosticBalanceModel?.activeItemIds ?? [])].sort((a, b) => a.localeCompare(b));
  const resultRecipeSet = new Set(resultRecipeIds);
  const resultItemSet = new Set(resultItemIds);
  const diagnosticRecipeSet = new Set(diagnosticRecipeIds);
  const diagnosticItemSet = new Set(diagnosticItemIds);
  const missingResultRecipeIds = resultRecipeIds.filter((recipeId) => !diagnosticRecipeSet.has(recipeId));
  const missingResultItemIds = resultItemIds.filter((itemId) => !diagnosticItemSet.has(itemId));
  const unusedCandidateRecipeIds = diagnosticRecipeIds.filter((recipeId) => !resultRecipeSet.has(recipeId));
  const unusedCandidateItemIds = diagnosticItemIds.filter((itemId) => !resultItemSet.has(itemId));
  const resultRecipeCount = resultRecipeIds.length;
  const resultItemCount = resultItemIds.length;
  const diagnosticActiveRecipeCount = diagnosticSummary?.activeRecipeCount;
  const diagnosticActiveItemCount = diagnosticSummary?.activeItemCount;
  const activeRecipeDelta = typeof diagnosticActiveRecipeCount === 'number' ? diagnosticActiveRecipeCount - resultRecipeCount : undefined;
  const activeItemDelta = typeof diagnosticActiveItemCount === 'number' ? diagnosticActiveItemCount - resultItemCount : undefined;
  const severeMismatch = missingResultRecipeIds.length > 0 || missingResultItemIds.length > 0;
  const candidateOnlyMismatch = !severeMismatch && (unusedCandidateRecipeIds.length > 0 || unusedCandidateItemIds.length > 0);
  return {
    resultFlowCount: result.flows.length,
    resultRecipeCount,
    resultItemCount,
    diagnosticActiveRecipeCount,
    diagnosticActiveItemCount,
    diagnosticTargetCount: diagnosticSummary?.targetCount,
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
      candidateRecipes: diagnosticRecipeIds,
      unusedCandidateRecipes: unusedCandidateRecipeIds,
    },
    itemSets: {
      activePlanItems: resultItemIds,
      candidateItems: diagnosticItemIds,
      unusedCandidateItems: unusedCandidateItemIds,
    },
    comparisonSeverity: severeMismatch ? 'warning' : candidateOnlyMismatch ? 'info' : 'none',
    diagnosticsOrigin: 'solvePlan-debug-solver-diagnostics-v09240',
    noteJa: 'active/candidate/unusedを明示し、実result側のrecipe/itemが診断モデルに欠けている場合のみ強い警告にします。',
    noteEn: 'Separates active/candidate/unused diagnostics. A strong warning is emitted only when recipes/items from the actual result are missing from the diagnostic model.',
  };
}


function structuredDiagnosticsFromPlanModel(planModel: ReturnType<typeof buildPlanModel>): SolverDiagnostics {
  const activeRecipeIds = [...planModel.dependencyGraph.activeRecipeIds].sort((a, b) => a.localeCompare(b));
  const activeItemIds = [...new Set(planModel.dependencyGraph.edges.map((edge) => edge.itemId))].sort((a, b) => a.localeCompare(b));
  const cycleDiagnostics = planModel.dependencyGraph.cycleComponents.map((cycle) => ({
    id: cycle.id,
    recipeIds: cycle.recipeIds,
    itemIds: cycle.itemIds,
    buyableInputItemIds: cycle.buyableItemIds,
    liquidItemIds: [],
    descriptionJa: cycle.cycleTextJa,
    descriptionEn: cycle.cycleTextEn,
  }));
  const graphSummary = {
    recipeNodeCount: activeRecipeIds.length,
    dependencyEdgeCount: planModel.dependencyGraph.edges.length,
    selectedProducerEdgeCount: planModel.dependencyGraph.edges.length,
    stronglyConnectedComponentCount: activeRecipeIds.length,
    cyclicComponentCount: cycleDiagnostics.length,
  };
  return {
    mode: 'solver-diagnostics-only',
    noteJa: 'Structured plannerの通常経路用にPlanModelから作る最小診断情報です。これは採用solverそのものではなく、診断用モデルです。',
    noteEn: 'Minimal diagnostics derived from PlanModel for the structured normal path. This is a diagnostic model, not the accepted solver itself.',
    plannedPolicies: {
      selectedRecipesAreFixedByDefault: true,
      alternateRecipeCompletionDefault: 'off',
      cycleInputIsAutomatic: true,
      liquidSurplusPolicy: 'avoid_zero_surplus_first_then_warn',
      byproductFuelUseDefault: 'off',
      probabilityOutputs: 'expected_value',
      integerRoundingPass: 'after_theoretical_solution',
    },
    graph: graphSummary,
    activePlanGraph: graphSummary,
    allRecipeGraph: graphSummary,
    cyclicComponents: cycleDiagnostics,
    activePlanCyclicComponents: cycleDiagnostics,
    allRecipeCyclicComponents: cycleDiagnostics,
    liquidOutputRecipeIds: [],
    diagnosticBalanceModel: {
      status: 'constraint-model-diagnostic-only',
      activeRecipeIds,
      activeItemIds,
      targetItemIds: planModel.targets.calculation.map((target) => target.outputItemId),
      summary: {
        variableCount: 0,
        constraintCount: 0,
        variableCountsByKind: {},
        constraintCountsByKind: {},
        activeRecipeCount: activeRecipeIds.length,
        activeItemCount: activeItemIds.length,
        liquidActiveItemCount: 0,
        targetCount: planModel.targets.calculation.length,
      },
      variables: [],
      constraints: [],
      candidates: { cycleInput: [], liquidSurplus: [], alternateRecipe: [], byproductFuel: [] },
      objectivePlan: [],
    },
  };
}

export function solvePlan(input: CalculateInput, options: SolvePlanOptions = {}): SolvePlanResult {
  const debug = options.debug === true;
  const planModel = buildPlanModel(input);
  const structuredDiagnostics = structuredDiagnosticsFromPlanModel(planModel);
  const structuredBalance = calculateStructuredBalance(input, structuredDiagnostics);
  const structuredSolve = solveStructuredMaterialPlan(planModel, structuredBalance.result);
  const result = structuredSolve.result;

  if (!debug) return { result };

  const diagnostics = buildSolverDiagnosticsForAcceptedResult(input, result, planModel);
  const debugLog = buildDebugLogFromResult(input, result);
  const diagnosticComparison = diagnosticComparisonFor(result, diagnostics);
  const structuredAdoptionComparison = buildStructuredAdoptionComparison(structuredSolve.structuredPlan);
  const acceptedResultSummary = {
    recipeCount: Object.keys(result.recipeStats).length,
    itemCount: Object.keys(result.itemStats).length,
    flowCount: result.flows.length,
    calculationStatus: result.calculationStatus,
  };
  const materialPlannerShadow = {
    enabled: true as const,
    mode: 'structured-material-v09240' as const,
    planModel,
    shadowResult: structuredSolve.structuredPlan,
    structuredPlan: structuredSolve.structuredPlan,
    comparison: structuredAdoptionComparison,
    cycleComponents: structuredSolve.structuredPlan.cycleComponents,
    cycleDecisions: structuredSolve.structuredPlan.cycleDecisions,
    acceptedResultSummary,
  };
  const solverIdentity = {
    acceptedSolverCore: 'structured-balance' as const,
    acceptedPlannerCore: 'structured-material-plan' as const,
    acceptedResultEngine: 'structured-material-v09240' as const,
    solvePlanMode: SOLVE_PLAN_MODE,
    solvePlanVersion: SOLVE_PLAN_VERSION,
    diagnosticModelOnly: true as const,
    linearProgrammingSolved: false as const,
    retiredComparisonPathRemoved: true as const,
    retiredComparisonPathCalled: false as const,
    noteJa: 'v0.9.24では、実計算はStructuredBalanceSolverとStructuredMaterialPlanの採用結果です。診断モデルは制約形式で状態を説明するためのもので、線形計画ソルバとして解いていません。',
    noteEn: 'In v0.9.24, the accepted calculation result comes from StructuredBalanceSolver plus StructuredMaterialPlan. The diagnostic model explains constraints but is not solved as a linear-programming solver.',
  };
  const extendedDebugLog = {
    ...debugLog,
    issues: diagnosticComparison.severeMismatch
      ? [
          ...debugLog.issues,
          {
            severity: 'warning' as const,
            code: 'SOLVER_DIAGNOSTIC_RESULT_DELTA',
            messageJa: '実計算結果に存在するrecipe/itemがsolverDiagnosticsに欠けています。診断モデルの乖離候補として確認してください。',
            messageEn: 'Some recipes/items from the actual result are missing from solverDiagnostics. Please inspect this as a diagnostic model mismatch candidate.',
            data: diagnosticComparison,
          },
        ]
      : debugLog.issues,
    resultEngine: 'structured-material-v09240',
    solverEngine: 'structured-material-v09240',
    solver: {
      mode: SOLVE_PLAN_MODE,
      version: SOLVE_PLAN_VERSION,
      debug,
      resultEngine: 'structured-material-v09240',
      solverEngine: 'structured-material-v09240',
      diagnosticsMode: diagnostics?.mode,
      normalizedTargetCount: input.targets.length,
      calculationTargetCount: input.targets.length,
      enabledTargetCount: enabledTargetCount(input),
      disabledTargetCount: disabledTargetCount(input),
      planModelSummary: planModel.summary,
      materialPlannerShadowMode: materialPlannerShadow.mode,
      materialPlannerShadowStatus: structuredSolve.structuredPlan.status,
      acceptedSolverCore: solverIdentity.acceptedSolverCore,
      acceptedPlannerCore: solverIdentity.acceptedPlannerCore,
      diagnosticModelOnly: solverIdentity.diagnosticModelOnly,
      linearProgrammingSolved: solverIdentity.linearProgrammingSolved,
      normalPathRetiredComparisonCalled: false,
      debugRetiredComparisonCalled: false,
    },
    diagnosticComparison,
    solverIdentity,
    materialPlannerShadow,
    structuredBalanceTrace: structuredBalance.trace,
    structuredMaterialPlan: structuredSolve.structuredPlan,
    cycleDecisions: structuredSolve.structuredPlan.cycleDecisions,
    planModel,
    solverDiagnostics: diagnostics ? {
      ...diagnostics,
      diagnosticBalanceModel: {
        ...diagnostics.diagnosticBalanceModel,
        recipeSets: diagnosticComparison.recipeSets,
        itemSets: diagnosticComparison.itemSets,
      },
    } : diagnostics,
  } as CalculationDebugResult['debugLog'] & {
    resultEngine: string;
    solverEngine: string;
    solverDiagnostics: typeof diagnostics;
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


function buildEffectiveRecipeRateAudit(result: CalculationResult): NonNullable<CalculationDebugLog['effectiveRecipeRateAudit']> {
  const divideRates = (rates: Record<string, number>, divisor: number): Record<string, number> => {
    if (!Number.isFinite(divisor) || Math.abs(divisor) <= EPS) return {};
    const out: Record<string, number> = {};
    for (const [itemId, value] of Object.entries(rates)) {
      if (Number.isFinite(value)) out[itemId] = value / divisor;
    }
    return out;
  };
  return Object.values(result.recipeStats)
    .sort((a, b) => a.recipeId.localeCompare(b.recipeId))
    .map((stat) => {
      const divisor = Math.abs(stat.theoreticalMachines) > EPS
        ? stat.theoreticalMachines
        : Math.abs(stat.actualMachines) > EPS
          ? stat.actualMachines
          : 0;
      return {
        recipeId: stat.recipeId,
        machineId: stat.machineId,
        theoreticalMachines: stat.theoreticalMachines,
        actualMachines: stat.actualMachines,
        machineExecutionsPerMinute: divisor > EPS ? stat.runsPerMinute / divisor : stat.runsPerMinute,
        positiveNetProductionRate: stat.positiveNetProductionRate,
        perMachineProductionRate: stat.perMachineProductionRate,
        machineInputRatesPerMinute: divideRates(stat.inputRates, divisor),
        machineOutputRatesPerMinute: divideRates(stat.outputRates, divisor),
        machineNetRatesPerMinute: divideRates(stat.netRates, divisor),
        factorySpeedMultiplier: stat.factorySpeedMultiplier,
        thermalHeightMultiplier: stat.thermalHeightMultiplier,
        thermalExtractorHeight: stat.thermalExtractorHeight,
        thermalExtractorBonusPercent: stat.thermalExtractorBonusPercent,
        alchemyOutputMultiplier: stat.alchemyOutputMultiplier,
        effectiveOutputPerMinuteMultiplier: stat.effectiveOutputPerMinuteMultiplier,
      };
    });
}


function buildHeatRequiredByRecipeAudit(result: CalculationResult): NonNullable<CalculationDebugLog['heatRequiredByRecipe']> {
  const out: NonNullable<CalculationDebugLog['heatRequiredByRecipe']> = {};
  const heatConsumptionMultiplier = Number(result.totals.heatConsumptionMultiplier ?? 1);
  const finiteHeatMultiplier = Number.isFinite(heatConsumptionMultiplier) ? heatConsumptionMultiplier : 1;
  const stats = Object.values(result.recipeStats).sort((a, b) => a.recipeId.localeCompare(b.recipeId));
  for (const stat of stats) {
    const recipe = recipeById[stat.recipeId];
    const heatPerSecond = (HEAT_CONSUMER_BY_MACHINE_ID[stat.machineId]?.heatPerSec ?? 0) + (recipe?.heatInputPerSec ?? 0);
    if (!Number.isFinite(heatPerSecond) || heatPerSecond <= EPS) continue;
    const machineBasis = Math.abs(stat.theoreticalMachines) > EPS
      ? stat.theoreticalMachines
      : Math.abs(stat.actualMachines) > EPS
        ? stat.actualMachines
        : 0;
    if (!Number.isFinite(machineBasis) || Math.abs(machineBasis) <= EPS) continue;
    const machineHeatRequiredPerMinute = heatPerSecond * 60 * finiteHeatMultiplier;
    const heatRequiredPerMin = machineHeatRequiredPerMinute * machineBasis;
    if (!Number.isFinite(heatRequiredPerMin) || heatRequiredPerMin <= EPS) continue;
    const recipeTimeSec = Number(recipe?.timeSec ?? 0);
    const baseHeatPerRun = Number.isFinite(recipeTimeSec) && recipeTimeSec > EPS ? heatPerSecond * recipeTimeSec : 0;
    const machineExecutionsPerMinute = stat.runsPerMinute / machineBasis;
    const effectiveHeatPerRun = Math.abs(stat.runsPerMinute) > EPS ? heatRequiredPerMin / stat.runsPerMinute : 0;
    out[stat.recipeId] = {
      recipeId: stat.recipeId,
      machineId: stat.machineId,
      theoreticalMachines: stat.theoreticalMachines,
      actualMachines: stat.actualMachines,
      runsPerMinute: stat.runsPerMinute,
      machineExecutionsPerMinute,
      heatPerSecond,
      machineHeatRequiredPerMinute,
      heatConsumptionMultiplier: finiteHeatMultiplier,
      baseHeatPerRun,
      effectiveHeatPerRun,
      heatRequiredPerMin,
    };
  }
  return out;
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

  const multiOutputBothSurplus = Object.values(result.recipeStats)
    .map((stat) => ({
      recipeId: stat.recipeId,
      recipeNameJa: debugRecipeNameJa(stat.recipeId),
      surplusOutputs: Object.entries(stat.surplusOutputRates)
        .filter(([, rate]) => Number(rate) > 0.000001)
        .map(([itemId, rate]) => ({ itemId, itemNameJa: debugItemNameJa(itemId), rate })),
    }))
    .filter((entry) => {
      const recipe = recipeById[entry.recipeId];
      return (recipe?.outputs.length ?? 0) >= 2 && entry.surplusOutputs.length >= 2;
    });
  const hasBlockingMultiOutputProblem =
    result.calculationStatus === 'invalid'
    || (result.errorSummaries?.length ?? 0) > 0
    || Object.values(result.recipeStats).some((stat) => Object.values(stat.discardedOutputRates).some((rate) => Number(rate) > 0.000001));
  if (hasBlockingMultiOutputProblem && multiOutputBothSurplus.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'MULTI_OUTPUT_MULTIPLE_OUTPUTS_SURPLUS',
      messageJa: '多出力レシピで複数の出力が同時に余剰になっており、同時に未解決・破棄などの問題候補があります。',
      messageEn: 'A multi-output recipe has multiple surplus outputs while the result also has unresolved or discard-related problem candidates.',
      data: multiOutputBothSurplus,
    });
  }

  const discardWhileConsumed = Object.values(result.itemStats)
    .filter((stat) => {
      const explicitPolicy = input.surplusPolicies[stat.itemId];
      const policy = explicitPolicy === 'reuse' || explicitPolicy === 'discard'
        ? explicitPolicy
        : input.settings.defaultSurplusPolicy;
      return policy !== 'discard' && stat.consumed > 0.000001 && stat.discarded > 0.000001;
    })
    .map((stat) => ({
      itemId: stat.itemId,
      itemNameJa: debugItemNameJa(stat.itemId),
      consumed: stat.consumed,
      discarded: stat.discarded,
    }));
  if (discardWhileConsumed.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'DISCARD_WHILE_ITEM_CONSUMED',
      messageJa: '同じアイテムを消費している一方で破棄しています。供給lotの再割当不足の可能性があります。',
      messageEn: 'An item is consumed while another lot of the same item is discarded. Supply-lot reassignment may be incomplete.',
      data: discardWhileConsumed,
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
    effectiveRecipeRateAudit: buildEffectiveRecipeRateAudit(result),
    heatRequiredByRecipe: buildHeatRequiredByRecipeAudit(result),
    dataAudit: buildRecipeDataAudit(),
  };
}

export function calculateWithDebug(input: CalculateInput): CalculationDebugResult {
  const solved = solvePlan(input, { debug: true });
  return {
    result: solved.result,
    debugLog: solved.debugLog ?? buildDebugLogFromResult(input, solved.result),
  };
}
