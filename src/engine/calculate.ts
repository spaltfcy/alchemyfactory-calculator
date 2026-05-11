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

const EPS = 1e-9;

export type SolvePlanOptions = {
  debug?: boolean;
};

export type SolvePlanResult = {
  result: CalculationResult;
  debugLog?: CalculationDebugResult['debugLog'];
};

const SOLVE_PLAN_MODE = 'solvePlan-v0930';
const SOLVE_PLAN_VERSION = '0.9.3';

function enabledTargetCount(input: CalculateInput): number {
  return input.targets.filter((target) => (target.enabled ?? true) !== false).length;
}

function disabledTargetCount(input: CalculateInput): number {
  return input.targets.filter((target) => (target.enabled ?? true) === false).length;
}

function diagnosticComparisonFor(result: CalculationResult, linearModelDiagnostics: ReturnType<typeof buildLinearModelDiagnostics> | undefined) {
  const linearSummary = linearModelDiagnostics?.linearBalanceModel?.summary;
  return {
    resultFlowCount: result.flows.length,
    resultRecipeCount: Object.keys(result.recipeStats).length,
    resultItemCount: Object.keys(result.itemStats).length,
    linearActiveRecipeCount: linearSummary?.activeRecipeCount,
    linearActiveItemCount: linearSummary?.activeItemCount,
    linearTargetCount: linearSummary?.targetCount,
    noteJa: 'v0.9.3では実計算とDEBUG診断をsolvePlan経由に寄せています。linearModelDiagnosticsはまだ診断用モデルですが、実resultとの比較値を併記します。',
    noteEn: 'v0.9.3 routes normal and DEBUG calculation through solvePlan. linearModelDiagnostics is still diagnostic-only, so comparison counts are included.',
  };
}

export function solvePlan(input: CalculateInput, options: SolvePlanOptions = {}): SolvePlanResult {
  const debug = options.debug === true;
  const linearModelDiagnostics = debug ? buildLinearModelDiagnostics(input) : undefined;
  const newSolverResult = calculateWithNewSolver(input, linearModelDiagnostics);
  const result = newSolverResult.result;

  if (!debug) return { result };

  const debugLog = buildDebugLogFromResult(input, result);
  const diagnostics = newSolverResult.linearModelDiagnostics ?? linearModelDiagnostics;
  const extendedDebugLog = {
    ...debugLog,
    resultEngine: newSolverResult.engineId,
    solverEngine: newSolverResult.engineId,
    solver: {
      mode: SOLVE_PLAN_MODE,
      version: SOLVE_PLAN_VERSION,
      debug,
      resultEngine: newSolverResult.engineId,
      solverEngine: newSolverResult.engineId,
      diagnosticsMode: diagnostics?.mode,
      normalizedTargetCount: input.targets.length,
      calculationTargetCount: input.targets.length,
      enabledTargetCount: enabledTargetCount(input),
      disabledTargetCount: disabledTargetCount(input),
    },
    diagnosticComparison: diagnosticComparisonFor(result, diagnostics),
    linearModelDiagnostics: diagnostics,
    alphaBalanceTrace: newSolverResult.alphaBalanceTrace,
  } as CalculationDebugResult['debugLog'] & {
    resultEngine: typeof newSolverResult.engineId;
    solverEngine: typeof newSolverResult.engineId;
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
