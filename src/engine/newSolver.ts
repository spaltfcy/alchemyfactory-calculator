import { RECIPES, recipeById } from '../data/recipes';
import { itemById } from '../data/items';
import { chooseRecipeForItem, isBuyableItem } from './itemSourceResolver';
import {
  calculate as calculateLegacy,
  calculateWithDebug as calculateLegacyWithDebug,
  type CalculateInput,
  type CalculationDebugResult,
  type CalculationResult,
  type CalculatedFlow,
} from './legacyCalculate';

export type SolverEngineId = 'legacy-v0610' | 'linear-v070-alpha';

export type SolverRunSummary = {
  engineId: SolverEngineId;
  calculationStatus: CalculationResult['calculationStatus'];
  errorCodes: string[];
  flowCount: number;
  itemStatCount: number;
  recipeStatCount: number;
  residualUnresolvedFlowCount: number;
  totals: Pick<
    CalculationResult['totals'],
    | 'initialCostCopper'
    | 'runningCostCopperPerMin'
    | 'purchaseCostCopperPerMin'
    | 'revenueCopperPerMin'
    | 'profitCopperPerMin'
    | 'heatRequiredPerMin'
    | 'fuelRequiredPerMin'
    | 'fertilizerNutrientsRequiredPerMin'
    | 'fertilizerRequiredPerMin'
  >;
};

export type SolverComparisonDiff = {
  calculationStatusChanged: boolean;
  errorCodesChanged: boolean;
  flowCountDelta: number;
  itemStatCountDelta: number;
  recipeStatCountDelta: number;
  residualUnresolvedFlowCountDelta: number;
  totalDeltas: Record<string, number>;
  changedRecipeRuns: Array<{
    recipeId: string;
    legacyRunsPerMinute: number;
    newRunsPerMinute: number;
    delta: number;
  }>;
  changedItemRates: Array<{
    itemId: string;
    field: 'requested' | 'produced' | 'consumed' | 'purchased' | 'surplus' | 'discarded';
    legacyRate: number;
    newRate: number;
    delta: number;
  }>;
  flowKeyDelta: {
    onlyInLegacy: string[];
    onlyInNew: string[];
  };
};

export type SelectedRecipeCycleDiagnostic = {
  id: string;
  recipeIds: string[];
  itemIds: string[];
  buyableInputItemIds: string[];
  liquidItemIds: string[];
  descriptionJa: string;
  descriptionEn: string;
};

export type DependencyGraphDiagnostic = {
  recipeNodeCount: number;
  dependencyEdgeCount: number;
  selectedProducerEdgeCount: number;
  stronglyConnectedComponentCount: number;
  cyclicComponentCount: number;
};

export type LinearModelDiagnostics = {
  mode: 'diagnostic-only';
  noteJa: string;
  noteEn: string;
  plannedPolicies: {
    selectedRecipesAreFixedByDefault: boolean;
    alternateRecipeCompletionDefault: 'off';
    cycleInputIsAutomatic: boolean;
    liquidSurplusPolicy: 'avoid_zero_surplus_first_then_warn';
    byproductFuelUseDefault: 'off';
    probabilityOutputs: 'expected_value';
    integerRoundingPass: 'after_theoretical_solution';
  };
  graph: DependencyGraphDiagnostic;
  activePlanGraph: DependencyGraphDiagnostic;
  allRecipeGraph: DependencyGraphDiagnostic;
  cyclicComponents: SelectedRecipeCycleDiagnostic[];
  activePlanCyclicComponents: SelectedRecipeCycleDiagnostic[];
  allRecipeCyclicComponents: SelectedRecipeCycleDiagnostic[];
  liquidOutputRecipeIds: string[];
};

export type SolverComparison = {
  generatedAt: string;
  activeEngine: SolverEngineId;
  legacy: SolverRunSummary;
  next: SolverRunSummary;
  diff: SolverComparisonDiff;
  linearModelDiagnostics: LinearModelDiagnostics;
};

export type NewSolverResult = {
  result: CalculationResult;
  engineId: SolverEngineId;
  linearModelDiagnostics?: LinearModelDiagnostics;
};

const ACTIVE_ENGINE: SolverEngineId = 'linear-v070-alpha';
const EPS = 1e-9;
const MAX_CHANGED_ROWS = 60;

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function recipeNameJa(recipeId: string): string {
  return recipeById[recipeId]?.name.ja ?? recipeId;
}

function itemNameJa(itemId: string): string {
  return itemById[itemId]?.name.ja ?? itemId;
}

function collectErrorCodes(result: CalculationResult): string[] {
  return uniqueSorted((result.errorSummaries ?? []).map((summary) => summary.code));
}

function summarizeResult(engineId: SolverEngineId, result: CalculationResult): SolverRunSummary {
  return {
    engineId,
    calculationStatus: result.calculationStatus ?? 'ok',
    errorCodes: collectErrorCodes(result),
    flowCount: result.flows.length,
    itemStatCount: Object.keys(result.itemStats).length,
    recipeStatCount: Object.keys(result.recipeStats).length,
    residualUnresolvedFlowCount: result.residualUnresolvedFlows?.length ?? 0,
    totals: {
      initialCostCopper: result.totals.initialCostCopper,
      runningCostCopperPerMin: result.totals.runningCostCopperPerMin,
      purchaseCostCopperPerMin: result.totals.purchaseCostCopperPerMin,
      revenueCopperPerMin: result.totals.revenueCopperPerMin,
      profitCopperPerMin: result.totals.profitCopperPerMin,
      heatRequiredPerMin: result.totals.heatRequiredPerMin,
      fuelRequiredPerMin: result.totals.fuelRequiredPerMin,
      fertilizerNutrientsRequiredPerMin: result.totals.fertilizerNutrientsRequiredPerMin,
      fertilizerRequiredPerMin: result.totals.fertilizerRequiredPerMin,
    },
  };
}

function delta(a: number, b: number): number {
  const value = b - a;
  return Math.abs(value) <= EPS ? 0 : value;
}

function makeFlowKey(flow: CalculatedFlow): string {
  const from = flow.from.type === 'recipe'
    ? 'recipe:' + flow.from.recipeId
    : flow.from.type === 'itemSource'
      ? 'source:' + flow.from.sourceMode + ':' + flow.from.itemId
      : 'sink:' + flow.from.sinkMode + ':' + flow.from.itemId;
  const to = flow.to.type === 'recipe'
    ? 'recipe:' + flow.to.recipeId
    : flow.to.type === 'itemSource'
      ? 'source:' + flow.to.sourceMode + ':' + flow.to.itemId
      : 'sink:' + flow.to.sinkMode + ':' + flow.to.itemId;
  return from + '->' + to + ':' + flow.itemId + ':' + flow.role;
}

function compareResults(legacy: CalculationResult, next: CalculationResult): SolverComparisonDiff {
  const legacySummary = summarizeResult('legacy-v0610', legacy);
  const nextSummary = summarizeResult('linear-v070-alpha', next);
  const totalDeltas: Record<string, number> = {};
  for (const key of Object.keys(legacySummary.totals) as Array<keyof SolverRunSummary['totals']>) {
    totalDeltas[key] = delta(legacySummary.totals[key], nextSummary.totals[key]);
  }

  const recipeIds = uniqueSorted([...Object.keys(legacy.recipeStats), ...Object.keys(next.recipeStats)]);
  const changedRecipeRuns = recipeIds.flatMap((recipeId) => {
    const legacyRunsPerMinute = legacy.recipeStats[recipeId]?.runsPerMinute ?? 0;
    const newRunsPerMinute = next.recipeStats[recipeId]?.runsPerMinute ?? 0;
    const d = delta(legacyRunsPerMinute, newRunsPerMinute);
    return d === 0 ? [] : [{ recipeId, legacyRunsPerMinute, newRunsPerMinute, delta: d }];
  }).slice(0, MAX_CHANGED_ROWS);

  const fields: Array<'requested' | 'produced' | 'consumed' | 'purchased' | 'surplus' | 'discarded'> = [
    'requested',
    'produced',
    'consumed',
    'purchased',
    'surplus',
    'discarded',
  ];
  const itemIds = uniqueSorted([...Object.keys(legacy.itemStats), ...Object.keys(next.itemStats)]);
  const changedItemRates = itemIds.flatMap((itemId) => {
    return fields.flatMap((field) => {
      const legacyRate = legacy.itemStats[itemId]?.[field] ?? 0;
      const newRate = next.itemStats[itemId]?.[field] ?? 0;
      const d = delta(legacyRate, newRate);
      return d === 0 ? [] : [{ itemId, field, legacyRate, newRate, delta: d }];
    });
  }).slice(0, MAX_CHANGED_ROWS);

  const legacyFlowKeys = new Set(legacy.flows.map(makeFlowKey));
  const newFlowKeys = new Set(next.flows.map(makeFlowKey));
  const onlyInLegacy = [...legacyFlowKeys].filter((key) => !newFlowKeys.has(key)).slice(0, MAX_CHANGED_ROWS);
  const onlyInNew = [...newFlowKeys].filter((key) => !legacyFlowKeys.has(key)).slice(0, MAX_CHANGED_ROWS);

  return {
    calculationStatusChanged: legacySummary.calculationStatus !== nextSummary.calculationStatus,
    errorCodesChanged: legacySummary.errorCodes.join('\n') !== nextSummary.errorCodes.join('\n'),
    flowCountDelta: nextSummary.flowCount - legacySummary.flowCount,
    itemStatCountDelta: nextSummary.itemStatCount - legacySummary.itemStatCount,
    recipeStatCountDelta: nextSummary.recipeStatCount - legacySummary.recipeStatCount,
    residualUnresolvedFlowCountDelta:
      nextSummary.residualUnresolvedFlowCount - legacySummary.residualUnresolvedFlowCount,
    totalDeltas,
    changedRecipeRuns,
    changedItemRates,
    flowKeyDelta: {
      onlyInLegacy,
      onlyInNew,
    },
  };
}

type DependencyEdge = { fromRecipeId: string; toRecipeId: string; itemId: string; selected: boolean };

type DependencyGraphScope = 'all-recipes' | 'active-plan';

type DependencyGraphData = {
  scope: DependencyGraphScope;
  recipeIds: string[];
  edges: DependencyEdge[];
};

function buildSelectedDependencyEdge(recipeId: string, input: CalculateInput): DependencyEdge[] {
  const recipe = recipeById[recipeId];
  if (!recipe) return [];
  return recipe.inputs.flatMap((recipeInput) => {
    const selectedProducer = chooseRecipeForItem(recipeInput.itemId, input.recipePreferences);
    if (!selectedProducer) return [];
    return [{
      fromRecipeId: recipe.id,
      toRecipeId: selectedProducer.id,
      itemId: recipeInput.itemId,
      selected: true,
    }];
  });
}

function initialTargetRecipeIds(input: CalculateInput): string[] {
  const ids = input.targets.flatMap((target) => {
    if (!target.outputItemId) return [];
    if (target.recipeId && recipeById[target.recipeId]) return [target.recipeId];
    const selected = chooseRecipeForItem(target.outputItemId, input.recipePreferences);
    return selected ? [selected.id] : [];
  });
  return uniqueSorted(ids);
}

function buildDependencyGraph(input: CalculateInput, scope: DependencyGraphScope): DependencyGraphData {
  if (scope === 'all-recipes') {
    const recipeIds = RECIPES.map((recipe) => recipe.id);
    const edges = recipeIds.flatMap((recipeId) => buildSelectedDependencyEdge(recipeId, input));
    return { scope, recipeIds, edges };
  }

  const visited = new Set<string>();
  const edges: DependencyEdge[] = [];
  const stack = initialTargetRecipeIds(input);

  while (stack.length > 0) {
    const recipeId = stack.pop();
    if (!recipeId || visited.has(recipeId)) continue;
    visited.add(recipeId);
    for (const edge of buildSelectedDependencyEdge(recipeId, input)) {
      edges.push(edge);
      if (!visited.has(edge.toRecipeId)) stack.push(edge.toRecipeId);
    }
  }

  return { scope, recipeIds: uniqueSorted(visited), edges };
}

function tarjan(recipeIds: string[], edges: DependencyEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const recipeId of recipeIds) adjacency.set(recipeId, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.fromRecipeId)) adjacency.set(edge.fromRecipeId, []);
    if (!adjacency.has(edge.toRecipeId)) adjacency.set(edge.toRecipeId, []);
    adjacency.get(edge.fromRecipeId)?.push(edge.toRecipeId);
  }

  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const components: string[][] = [];

  function strongConnect(v: string): void {
    indices.set(v, index);
    lowLink.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);

    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowLink.set(v, Math.min(lowLink.get(v) ?? 0, lowLink.get(w) ?? 0));
      } else if (onStack.has(w)) {
        lowLink.set(v, Math.min(lowLink.get(v) ?? 0, indices.get(w) ?? 0));
      }
    }

    if (lowLink.get(v) === indices.get(v)) {
      const component: string[] = [];
      while (stack.length > 0) {
        const w = stack.pop();
        if (!w) break;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      components.push(component.sort((a, b) => a.localeCompare(b)));
    }
  }

  for (const recipeId of recipeIds) {
    if (!indices.has(recipeId)) strongConnect(recipeId);
  }

  return components;
}

function hasSelfLoop(recipeId: string, edges: DependencyEdge[]): boolean {
  return edges.some((edge) => edge.fromRecipeId === recipeId && edge.toRecipeId === recipeId);
}

function buildCycleDiagnostics(graph: DependencyGraphData): { graph: DependencyGraphDiagnostic; cycles: SelectedRecipeCycleDiagnostic[] } {
  const components = tarjan(graph.recipeIds, graph.edges);
  const cyclicComponents = components.filter((component) => component.length > 1 || hasSelfLoop(component[0], graph.edges));
  const scopeLabelJa = graph.scope === 'active-plan' ? '今回の計画' : '全レシピ';
  const scopeLabelEn = graph.scope === 'active-plan' ? 'active plan' : 'all recipes';

  const cycles: SelectedRecipeCycleDiagnostic[] = cyclicComponents.map((recipeIdsInComponent, index) => {
    const recipeSet = new Set(recipeIdsInComponent);
    const internalEdges = graph.edges.filter((edge) => recipeSet.has(edge.fromRecipeId) && recipeSet.has(edge.toRecipeId));
    const itemIds = uniqueSorted(internalEdges.map((edge) => edge.itemId));
    const buyableInputItemIds = itemIds.filter((itemId) => isBuyableItem(itemId));
    const liquidItemIds = itemIds.filter((itemId) => itemById[itemId]?.physicalState === 'liquid');
    const recipeNames = recipeIdsInComponent.map(recipeNameJa).join(' / ');
    return {
      id: graph.scope + '-cycle-' + String(index + 1).padStart(2, '0'),
      recipeIds: recipeIdsInComponent,
      itemIds,
      buyableInputItemIds,
      liquidItemIds,
      descriptionJa:
        scopeLabelJa + 'の選択レシピ依存グラフ上の循環です: ' +
        recipeNames +
        (buyableInputItemIds.length > 0
          ? '。循環補填候補: ' + buyableInputItemIds.map(itemNameJa).join(' / ')
          : '。購入で切れる候補はありません。'),
      descriptionEn:
        'Selected recipe dependency cycle in ' + scopeLabelEn + ': ' +
        recipeIdsInComponent.join(' / ') +
        (buyableInputItemIds.length > 0
          ? '. Cycle input candidates: ' + buyableInputItemIds.join(' / ')
          : '. No buyable cycle input candidate.'),
    };
  });

  return {
    graph: {
      recipeNodeCount: graph.recipeIds.length,
      dependencyEdgeCount: graph.edges.length,
      selectedProducerEdgeCount: graph.edges.filter((edge) => edge.selected).length,
      stronglyConnectedComponentCount: components.length,
      cyclicComponentCount: cycles.length,
    },
    cycles,
  };
}

export function buildLinearModelDiagnostics(input: CalculateInput): LinearModelDiagnostics {
  const activeGraph = buildDependencyGraph(input, 'active-plan');
  const allRecipeGraph = buildDependencyGraph(input, 'all-recipes');
  const activeDiagnostics = buildCycleDiagnostics(activeGraph);
  const allDiagnostics = buildCycleDiagnostics(allRecipeGraph);

  const liquidOutputRecipeIds = RECIPES.filter((recipe) =>
    recipe.outputs.some((output) => itemById[output.itemId]?.physicalState === 'liquid'),
  ).map((recipe) => recipe.id);

  return {
    mode: 'diagnostic-only',
    noteJa:
      'v0.7.0-alpha.1 では、通常計算時の診断モデル生成を止め、ログ出力時だけ旧solver/新solver比較と線形収支化に向けた診断を生成します。計算結果は互換性維持のため旧solverと同じです。',
    noteEn:
      'v0.7.0-alpha.1 avoids diagnostic model generation during normal calculation and only generates legacy/new solver comparison diagnostics during log export. Runtime results intentionally remain legacy-compatible.',
    plannedPolicies: {
      selectedRecipesAreFixedByDefault: true,
      alternateRecipeCompletionDefault: 'off',
      cycleInputIsAutomatic: true,
      liquidSurplusPolicy: 'avoid_zero_surplus_first_then_warn',
      byproductFuelUseDefault: 'off',
      probabilityOutputs: 'expected_value',
      integerRoundingPass: 'after_theoretical_solution',
    },
    // Backward-compatible aliases: these now describe the active plan rather than every recipe in the data set.
    graph: activeDiagnostics.graph,
    cyclicComponents: activeDiagnostics.cycles,
    activePlanGraph: activeDiagnostics.graph,
    allRecipeGraph: allDiagnostics.graph,
    activePlanCyclicComponents: activeDiagnostics.cycles,
    allRecipeCyclicComponents: allDiagnostics.cycles,
    liquidOutputRecipeIds: uniqueSorted(liquidOutputRecipeIds),
  };
}

export function buildNewSolverResultFromLegacy(
  legacyResult: CalculationResult,
  diagnostics?: LinearModelDiagnostics,
): NewSolverResult {
  return {
    result: legacyResult,
    engineId: ACTIVE_ENGINE,
    linearModelDiagnostics: diagnostics,
  };
}

export function calculateWithNewSolver(input: CalculateInput): NewSolverResult {
  return buildNewSolverResultFromLegacy(calculateLegacy(input));
}

export function calculateWithNewSolverDebug(input: CalculateInput): CalculationDebugResult {
  const legacyDebug = calculateLegacyWithDebug(input);
  const linearModelDiagnostics = buildLinearModelDiagnostics(input);
  return {
    result: legacyDebug.result,
    debugLog: {
      ...legacyDebug.debugLog,
      solverEngine: ACTIVE_ENGINE,
      linearModelDiagnostics,
    } as CalculationDebugResult['debugLog'] & {
      solverEngine: SolverEngineId;
      linearModelDiagnostics: LinearModelDiagnostics;
    },
  };
}

export function buildSolverComparisonFromResults(
  legacyResult: CalculationResult,
  newResult: CalculationResult,
  linearModelDiagnostics: LinearModelDiagnostics,
): SolverComparison {
  return {
    generatedAt: new Date().toISOString(),
    activeEngine: ACTIVE_ENGINE,
    legacy: summarizeResult('legacy-v0610', legacyResult),
    next: summarizeResult('linear-v070-alpha', newResult),
    diff: compareResults(legacyResult, newResult),
    linearModelDiagnostics,
  };
}

export function buildSolverComparison(input: CalculateInput): SolverComparison {
  const legacy = calculateLegacy(input);
  const diagnostics = buildLinearModelDiagnostics(input);
  const next = buildNewSolverResultFromLegacy(legacy, diagnostics).result;
  return buildSolverComparisonFromResults(legacy, next, diagnostics);
}
