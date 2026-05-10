import { RECIPES, getRecipesProducing, recipeById } from '../data/recipes';
import type { Recipe } from '../types';
import { itemById } from '../data/items';
import { chooseRecipeForItem, isBuyableItem } from './itemSourceResolver';
import {
  getFertilizerNutritionMultiplier,
  getFuelHeatValueMultiplier,
  getHeatConsumptionMultiplier,
  getProductionSpeedMultiplier,
} from '../data/abilityTables';
import { FUEL_HEAT_VALUE_BY_ITEM_ID, HEAT_CONSUMER_BY_MACHINE_ID } from '../data/heat';
import { FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID, FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID } from '../data/fertilizer';
import { calculateAlphaBalance, type AlphaBalanceSolveResult } from './alphaBalanceSolver';
import type {
  CalculateInput,
  CalculationDebugResult,
  CalculationResult,
} from './calculationTypes';

export type SolverEngineId = 'balance-v081';

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

export type LinearModelVariableKind =
  | 'recipeRun'
  | 'itemSource'
  | 'cycleInput'
  | 'surplus'
  | 'discard'
  | 'liquidSurplus'
  | 'fuelDemand'
  | 'fertilizerDemand';

export type LinearModelVariable = {
  id: string;
  kind: LinearModelVariableKind;
  itemId?: string;
  recipeId?: string;
  sourceMode?: 'buy' | 'external' | 'cycleInput' | 'internalProduction';
  unit: 'runsPerMinute' | 'itemsPerMinute' | 'heatPerMinute' | 'nutrientsPerMinute';
  noteJa: string;
  noteEn: string;
};

export type LinearModelConstraintKind =
  | 'targetOutput'
  | 'itemBalance'
  | 'liquidSurplusZeroPreferred'
  | 'fuelHeatDemand'
  | 'fertilizerNutrientDemand';

export type LinearModelConstraintTerm = {
  variableId: string;
  coefficient: number;
};

export type LinearModelConstraint = {
  id: string;
  kind: LinearModelConstraintKind;
  relation: '=' | '>=';
  priority: 'hard' | 'preferred';
  itemId?: string;
  recipeId?: string;
  rhs: number;
  terms: LinearModelConstraintTerm[];
  noteJa: string;
  noteEn: string;
};

export type LinearModelCandidate = {
  itemId?: string;
  recipeId?: string;
  selectedRecipeId?: string;
  alternateRecipeIds?: string[];
  candidateRecipeIds?: string[];
  reasonJa: string;
  reasonEn: string;
};

export type LinearBalanceModelDiagnostics = {
  status: 'model-built-diagnostic-only';
  activeRecipeIds: string[];
  activeItemIds: string[];
  targetItemIds: string[];
  summary: {
    variableCount: number;
    constraintCount: number;
    variableCountsByKind: Record<string, number>;
    constraintCountsByKind: Record<string, number>;
    activeRecipeCount: number;
    activeItemCount: number;
    liquidActiveItemCount: number;
    targetCount: number;
  };
  variables: LinearModelVariable[];
  constraints: LinearModelConstraint[];
  candidates: {
    cycleInput: LinearModelCandidate[];
    liquidSurplus: LinearModelCandidate[];
    alternateRecipe: LinearModelCandidate[];
    byproductFuel: LinearModelCandidate[];
  };
  objectivePlan: Array<{
    priority: number;
    objective: string;
    noteJa: string;
    noteEn: string;
  }>;
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
  linearBalanceModel: LinearBalanceModelDiagnostics;
};


export type NewSolverResult = {
  result: CalculationResult;
  engineId: SolverEngineId;
  linearModelDiagnostics?: LinearModelDiagnostics;
  alphaBalanceTrace?: AlphaBalanceSolveResult['trace'];
};

const ACTIVE_ENGINE: SolverEngineId = 'balance-v081';
const EPS = 1e-9;

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function recipeNameJa(recipeId: string): string {
  return recipeById[recipeId]?.name.ja ?? recipeId;
}

function itemNameJa(itemId: string): string {
  return itemById[itemId]?.name.ja ?? itemId;
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


function variableId(kind: LinearModelVariableKind, key: string): string {
  return kind + ':' + key;
}

function addCount(record: Record<string, number>, key: string, value = 1): void {
  record[key] = (record[key] ?? 0) + value;
}

function outputPerRunForRecipe(recipe: Recipe, itemId: string): number {
  const output = recipe.outputs.find((x) => x.itemId === itemId);
  if (!output) return 0;
  return output.amount * (output.probability ?? 1);
}

function runRateForDiagnosticRecipe(recipe: Recipe, input: CalculateInput): number {
  const productionSpeedMultiplier = getProductionSpeedMultiplier(input.abilities);
  if (recipe.machineId === 'nursery') {
    const fertilizer = input.settings.fertilizer;
    const selectedNutrientsPerSec = fertilizer?.enabled
      ? Math.max(0, Number(FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID[fertilizer.fertilizerItemId] ?? fertilizer.nurseryNutrientsPerSec))
      : Math.max(0, Number(fertilizer?.nurseryNutrientsPerSec ?? 12));
    const nutrientsRequired = Math.max(0, recipe.timeSec * 12);
    if (nutrientsRequired > EPS && selectedNutrientsPerSec > EPS) {
      return (60 * selectedNutrientsPerSec * productionSpeedMultiplier) / nutrientsRequired;
    }
  }
  return (60 / recipe.timeSec) * productionSpeedMultiplier;
}

function outputRateForDiagnosticRecipe(recipe: Recipe, itemId: string, input: CalculateInput): number {
  return outputPerRunForRecipe(recipe, itemId) * runRateForDiagnosticRecipe(recipe, input);
}

function selectedSteamBoilerRecipe(input: CalculateInput): Recipe | undefined {
  const preferred = input.recipePreferences.steam;
  if (preferred && recipeById[preferred]) return recipeById[preferred];
  return recipeById.steam_boiler_low;
}

function collectSelectedRecipeClosure(seedRecipeIds: Iterable<string>, input: CalculateInput): string[] {
  const visited = new Set<string>();
  const stack = [...seedRecipeIds].filter((recipeId) => !!recipeById[recipeId]);
  while (stack.length > 0) {
    const recipeId = stack.pop();
    if (!recipeId || visited.has(recipeId)) continue;
    visited.add(recipeId);
    for (const edge of buildSelectedDependencyEdge(recipeId, input)) {
      if (!visited.has(edge.toRecipeId)) stack.push(edge.toRecipeId);
    }
  }
  return uniqueSorted(visited);
}

function modelRecipeIds(input: CalculateInput, activeGraph: DependencyGraphData): string[] {
  const seeds = new Set(activeGraph.recipeIds);
  if (input.settings.fuel?.enabled && input.settings.fuel.sourceMode === 'internal') {
    const fuelRecipe = chooseRecipeForItem(input.settings.fuel.fuelItemId, input.recipePreferences);
    if (fuelRecipe) seeds.add(fuelRecipe.id);
  }
  if (input.settings.fuel?.enabled && input.settings.fuel.heatingMode === 'steam') {
    const steamBoiler = selectedSteamBoilerRecipe(input);
    if (steamBoiler) seeds.add(steamBoiler.id);
  }
  if (input.settings.fertilizer?.enabled && input.settings.fertilizer.sourceMode === 'internal') {
    const fertilizerRecipe = chooseRecipeForItem(input.settings.fertilizer.fertilizerItemId, input.recipePreferences);
    if (fertilizerRecipe) seeds.add(fertilizerRecipe.id);
  }
  return collectSelectedRecipeClosure(seeds, input);
}

function targetDemandByItem(input: CalculateInput): Map<string, number> {
  const map = new Map<string, number>();
  for (const target of input.targets) {
    const targetValue = Number(target.value);
    if (!Number.isFinite(targetValue) || targetValue <= EPS || !target.outputItemId) continue;
    let demand = targetValue;
    const recipe = target.recipeId && recipeById[target.recipeId]
      ? recipeById[target.recipeId]
      : chooseRecipeForItem(target.outputItemId, input.recipePreferences);
    if (target.mode === 'machines' && recipe) {
      demand = targetValue * outputRateForDiagnosticRecipe(recipe, target.outputItemId, input);
    }
    map.set(target.outputItemId, (map.get(target.outputItemId) ?? 0) + demand);
  }
  return map;
}

function activeItemIdsForModel(recipeIds: string[], input: CalculateInput): string[] {
  const itemIds = new Set<string>();
  for (const recipeId of recipeIds) {
    const recipe = recipeById[recipeId];
    if (!recipe) continue;
    for (const recipeInput of recipe.inputs) itemIds.add(recipeInput.itemId);
    for (const output of recipe.outputs) itemIds.add(output.itemId);
  }
  for (const target of input.targets) {
    if (target.outputItemId) itemIds.add(target.outputItemId);
  }
  if (input.settings.fuel?.enabled) itemIds.add(input.settings.fuel.fuelItemId);
  if (input.settings.fertilizer?.enabled) itemIds.add(input.settings.fertilizer.fertilizerItemId);
  return uniqueSorted(itemIds);
}

function heatPerRunForRecipe(recipe: Recipe, input: CalculateInput): number {
  const heatPerSec = HEAT_CONSUMER_BY_MACHINE_ID[recipe.machineId]?.heatPerSec ?? 0;
  if (heatPerSec <= EPS) return 0;
  const heatConsumptionMultiplier = getHeatConsumptionMultiplier(input.abilities);
  const runRate = runRateForDiagnosticRecipe(recipe, input);
  if (runRate <= EPS) return 0;
  return (heatPerSec * 60 * heatConsumptionMultiplier) / runRate;
}

function nutrientsPerRunForRecipe(recipe: Recipe): number {
  if (recipe.machineId !== 'nursery') return 0;
  return Math.max(0, recipe.timeSec * 12);
}

function buildLinearBalanceModelDiagnostics(
  input: CalculateInput,
  activeGraph: DependencyGraphData,
  activeCycles: SelectedRecipeCycleDiagnostic[],
): LinearBalanceModelDiagnostics {
  const recipeIds = modelRecipeIds(input, activeGraph);
  const itemIds = activeItemIdsForModel(recipeIds, input);
  const targetDemand = targetDemandByItem(input);
  const targetItemIds = uniqueSorted(targetDemand.keys());
  const variables: LinearModelVariable[] = [];
  const constraints: LinearModelConstraint[] = [];
  const seenVariables = new Set<string>();

  function addVariable(variable: LinearModelVariable): string {
    if (!seenVariables.has(variable.id)) {
      seenVariables.add(variable.id);
      variables.push(variable);
    }
    return variable.id;
  }

  for (const recipeId of recipeIds) {
    addVariable({
      id: variableId('recipeRun', recipeId),
      kind: 'recipeRun',
      recipeId,
      unit: 'runsPerMinute',
      noteJa: recipeNameJa(recipeId) + ' の実行回数/min。',
      noteEn: 'Runs per minute for ' + recipeId + '.',
    });
  }

  const cycleInputItemIds = new Set(activeCycles.flatMap((cycle) => cycle.buyableInputItemIds));
  for (const itemId of itemIds) {
    const item = itemById[itemId];
    const isLiquid = item?.physicalState === 'liquid';
    const selectedProducer = chooseRecipeForItem(itemId, input.recipePreferences);
    if (isBuyableItem(itemId) && (!selectedProducer || cycleInputItemIds.has(itemId))) {
      addVariable({
        id: variableId(cycleInputItemIds.has(itemId) ? 'cycleInput' : 'itemSource', itemId),
        kind: cycleInputItemIds.has(itemId) ? 'cycleInput' : 'itemSource',
        itemId,
        sourceMode: cycleInputItemIds.has(itemId) ? 'cycleInput' : 'buy',
        unit: 'itemsPerMinute',
        noteJa: cycleInputItemIds.has(itemId)
          ? itemNameJa(itemId) + ' を循環補填として投入する量/min。'
          : itemNameJa(itemId) + ' を購入/外部投入する量/min。',
        noteEn: cycleInputItemIds.has(itemId)
          ? 'Cycle input rate for ' + itemId + '.'
          : 'Purchased/external source rate for ' + itemId + '.',
      });
    }
    addVariable({
      id: variableId(isLiquid ? 'liquidSurplus' : 'surplus', itemId),
      kind: isLiquid ? 'liquidSurplus' : 'surplus',
      itemId,
      unit: 'itemsPerMinute',
      noteJa: itemNameJa(itemId) + (isLiquid ? ' の液体余剰/min。原則0を目指します。' : ' の余剰/min。'),
      noteEn: (isLiquid ? 'Liquid surplus rate for ' : 'Surplus rate for ') + itemId + '.',
    });
    if (!isLiquid) {
      addVariable({
        id: variableId('discard', itemId),
        kind: 'discard',
        itemId,
        unit: 'itemsPerMinute',
        noteJa: itemNameJa(itemId) + ' の破棄/min。',
        noteEn: 'Discard rate for ' + itemId + '.',
      });
    }
  }

  if (input.settings.fuel?.enabled) {
    const fuelItemId = input.settings.fuel.fuelItemId;
    addVariable({
      id: variableId('fuelDemand', fuelItemId),
      kind: 'fuelDemand',
      itemId: fuelItemId,
      unit: 'itemsPerMinute',
      noteJa: itemNameJa(fuelItemId) + ' の燃料消費量/min。',
      noteEn: 'Fuel demand rate for ' + fuelItemId + '.',
    });
    if (input.settings.fuel.sourceMode === 'external') {
      addVariable({
        id: variableId('itemSource', 'fuel:' + fuelItemId),
        kind: 'itemSource',
        itemId: fuelItemId,
        sourceMode: 'external',
        unit: 'itemsPerMinute',
        noteJa: itemNameJa(fuelItemId) + ' を外部燃料として投入する量/min。',
        noteEn: 'External fuel source rate for ' + fuelItemId + '.',
      });
    }
  }

  if (input.settings.fertilizer?.enabled) {
    const fertilizerItemId = input.settings.fertilizer.fertilizerItemId;
    addVariable({
      id: variableId('fertilizerDemand', fertilizerItemId),
      kind: 'fertilizerDemand',
      itemId: fertilizerItemId,
      unit: 'itemsPerMinute',
      noteJa: itemNameJa(fertilizerItemId) + ' の肥料消費量/min。',
      noteEn: 'Fertilizer demand rate for ' + fertilizerItemId + '.',
    });
    if (input.settings.fertilizer.sourceMode === 'external') {
      addVariable({
        id: variableId('itemSource', 'fertilizer:' + fertilizerItemId),
        kind: 'itemSource',
        itemId: fertilizerItemId,
        sourceMode: 'external',
        unit: 'itemsPerMinute',
        noteJa: itemNameJa(fertilizerItemId) + ' を外部肥料として投入する量/min。',
        noteEn: 'External fertilizer source rate for ' + fertilizerItemId + '.',
      });
    }
  }

  for (const target of input.targets) {
    const targetValue = Number(target.value);
    if (!Number.isFinite(targetValue) || targetValue <= EPS || !target.outputItemId) continue;
    const recipe = target.recipeId && recipeById[target.recipeId]
      ? recipeById[target.recipeId]
      : chooseRecipeForItem(target.outputItemId, input.recipePreferences);
    if (!recipe) continue;
    const terms: LinearModelConstraintTerm[] = [];
    const recipeVariableId = variableId('recipeRun', recipe.id);
    if (target.mode === 'machines') {
      terms.push({ variableId: recipeVariableId, coefficient: 1 });
      constraints.push({
        id: 'target-machines:' + target.id,
        kind: 'targetOutput',
        relation: '=',
        priority: 'hard',
        itemId: target.outputItemId,
        recipeId: recipe.id,
        rhs: targetValue * runRateForDiagnosticRecipe(recipe, input),
        terms,
        noteJa: '目標設備台数から ' + recipeNameJa(recipe.id) + ' の実行回数を固定します。',
        noteEn: 'Fix recipe run rate from target machine count.',
      });
    } else {
      terms.push({ variableId: recipeVariableId, coefficient: outputPerRunForRecipe(recipe, target.outputItemId) });
      constraints.push({
        id: 'target-rate:' + target.id,
        kind: 'targetOutput',
        relation: '>=',
        priority: 'hard',
        itemId: target.outputItemId,
        recipeId: recipe.id,
        rhs: targetValue,
        terms,
        noteJa: itemNameJa(target.outputItemId) + ' の目標出力/minを満たす制約です。',
        noteEn: 'Target output rate constraint for ' + target.outputItemId + '.',
      });
    }
  }

  for (const itemId of itemIds) {
    const item = itemById[itemId];
    const isLiquid = item?.physicalState === 'liquid';
    const terms: LinearModelConstraintTerm[] = [];
    for (const recipeId of recipeIds) {
      const recipe = recipeById[recipeId];
      if (!recipe) continue;
      const outputAmount = outputPerRunForRecipe(recipe, itemId);
      if (outputAmount > EPS) terms.push({ variableId: variableId('recipeRun', recipe.id), coefficient: outputAmount });
      const inputAmount = recipe.inputs
        .filter((recipeInput) => recipeInput.itemId === itemId)
        .reduce((sum, recipeInput) => sum + recipeInput.amount, 0);
      if (inputAmount > EPS) terms.push({ variableId: variableId('recipeRun', recipe.id), coefficient: -inputAmount });
    }
    for (const variable of variables) {
      if (variable.itemId !== itemId) continue;
      if (variable.kind === 'itemSource' || variable.kind === 'cycleInput') terms.push({ variableId: variable.id, coefficient: 1 });
      if (variable.kind === 'fuelDemand' || variable.kind === 'fertilizerDemand') terms.push({ variableId: variable.id, coefficient: -1 });
    }
    terms.push({ variableId: variableId(isLiquid ? 'liquidSurplus' : 'surplus', itemId), coefficient: -1 });
    if (!isLiquid) terms.push({ variableId: variableId('discard', itemId), coefficient: -1 });
    constraints.push({
      id: 'item-balance:' + itemId,
      kind: 'itemBalance',
      relation: '=',
      priority: 'hard',
      itemId,
      rhs: targetDemand.get(itemId) ?? 0,
      terms,
      noteJa: itemNameJa(itemId) + ' の生産・消費・投入・余剰の収支制約です。',
      noteEn: 'Item balance constraint for ' + itemId + '.',
    });
    if (isLiquid) {
      constraints.push({
        id: 'liquid-surplus-zero:' + itemId,
        kind: 'liquidSurplusZeroPreferred',
        relation: '=',
        priority: 'preferred',
        itemId,
        rhs: 0,
        terms: [{ variableId: variableId('liquidSurplus', itemId), coefficient: 1 }],
        noteJa: itemNameJa(itemId) + ' の液体余剰を0に寄せる優先制約です。',
        noteEn: 'Preferred zero liquid surplus constraint for ' + itemId + '.',
      });
    }
  }

  if (input.settings.fuel?.enabled) {
    const terms: LinearModelConstraintTerm[] = [];
    for (const recipeId of recipeIds) {
      const recipe = recipeById[recipeId];
      if (!recipe) continue;
      const heatPerRun = heatPerRunForRecipe(recipe, input);
      if (heatPerRun > EPS) terms.push({ variableId: variableId('recipeRun', recipe.id), coefficient: heatPerRun });
    }
    const fuelItemId = input.settings.fuel.fuelItemId;
    const heatValue = (FUEL_HEAT_VALUE_BY_ITEM_ID[fuelItemId] ?? 0) * getFuelHeatValueMultiplier(input.abilities);
    terms.push({ variableId: variableId('fuelDemand', fuelItemId), coefficient: -heatValue });
    constraints.push({
      id: 'fuel-heat-demand:' + fuelItemId,
      kind: 'fuelHeatDemand',
      relation: '=',
      priority: 'hard',
      itemId: fuelItemId,
      rhs: 0,
      terms,
      noteJa: '熱需要と ' + itemNameJa(fuelItemId) + ' の燃料消費量を結びます。',
      noteEn: 'Connect heat demand to fuel consumption rate.',
    });
  }

  if (input.settings.fertilizer?.enabled) {
    const terms: LinearModelConstraintTerm[] = [];
    for (const recipeId of recipeIds) {
      const recipe = recipeById[recipeId];
      if (!recipe) continue;
      const nutrients = nutrientsPerRunForRecipe(recipe);
      if (nutrients > EPS) terms.push({ variableId: variableId('recipeRun', recipe.id), coefficient: nutrients });
    }
    const fertilizerItemId = input.settings.fertilizer.fertilizerItemId;
    const nutrientValue = (FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[fertilizerItemId] ?? 0) * getFertilizerNutritionMultiplier(input.abilities);
    terms.push({ variableId: variableId('fertilizerDemand', fertilizerItemId), coefficient: -nutrientValue });
    constraints.push({
      id: 'fertilizer-nutrient-demand:' + fertilizerItemId,
      kind: 'fertilizerNutrientDemand',
      relation: '=',
      priority: 'hard',
      itemId: fertilizerItemId,
      rhs: 0,
      terms,
      noteJa: '苗床の栄養需要と ' + itemNameJa(fertilizerItemId) + ' の肥料消費量を結びます。',
      noteEn: 'Connect nursery nutrient demand to fertilizer consumption rate.',
    });
  }

  const variableCountsByKind: Record<string, number> = {};
  for (const variable of variables) addCount(variableCountsByKind, variable.kind);
  const constraintCountsByKind: Record<string, number> = {};
  for (const constraint of constraints) addCount(constraintCountsByKind, constraint.kind);

  const cycleInputCandidates: LinearModelCandidate[] = activeCycles.flatMap((cycle) => cycle.buyableInputItemIds.map((itemId) => ({
    itemId,
    candidateRecipeIds: cycle.recipeIds,
    reasonJa: itemNameJa(itemId) + ' は循環 ' + cycle.recipeIds.map(recipeNameJa).join(' / ') + ' を購入/投入で切れる候補です。',
    reasonEn: itemId + ' can break the cycle ' + cycle.recipeIds.join(' / ') + ' as a purchased/input source.',
  })));

  const liquidSurplusCandidates: LinearModelCandidate[] = itemIds
    .filter((itemId) => itemById[itemId]?.physicalState === 'liquid')
    .map((itemId) => ({
      itemId,
      reasonJa: itemNameJa(itemId) + ' は液体/蒸気のため、余剰0を優先します。',
      reasonEn: itemId + ' is liquid/steam-like and should prefer zero surplus.',
    }));

  const alternateRecipeCandidates: LinearModelCandidate[] = itemIds.flatMap((itemId) => {
    const selectedRecipe = chooseRecipeForItem(itemId, input.recipePreferences);
    const alternates = getRecipesProducing(itemId).filter((recipe) => recipe.id !== selectedRecipe?.id);
    if (alternates.length <= 0) return [];
    return [{
      itemId,
      selectedRecipeId: selectedRecipe?.id,
      alternateRecipeIds: alternates.map((recipe) => recipe.id),
      reasonJa: itemNameJa(itemId) + ' は不足時に代替レシピ補完候補があります。デフォルトでは使用しません。',
      reasonEn: itemId + ' has alternate recipe completion candidates. They are disabled by default.',
    }];
  });

  const targetItemSet = new Set(targetItemIds);
  const byproductFuelCandidates: LinearModelCandidate[] = uniqueSorted(recipeIds.flatMap((recipeId) => {
    const recipe = recipeById[recipeId];
    if (!recipe) return [];
    return recipe.outputs
      .filter((output) => !targetItemSet.has(output.itemId) && (itemById[output.itemId]?.fuelValue ?? 0) > EPS)
      .map((output) => output.itemId);
  })).map((itemId) => ({
    itemId,
    reasonJa: itemNameJa(itemId) + ' は余剰時に燃料候補になります。ただし副産物燃料利用はデフォルトOFFです。',
    reasonEn: itemId + ' can be a byproduct fuel candidate, but byproduct fuel use is off by default.',
  }));

  return {
    status: 'model-built-diagnostic-only',
    activeRecipeIds: recipeIds,
    activeItemIds: itemIds,
    targetItemIds,
    summary: {
      variableCount: variables.length,
      constraintCount: constraints.length,
      variableCountsByKind,
      constraintCountsByKind,
      activeRecipeCount: recipeIds.length,
      activeItemCount: itemIds.length,
      liquidActiveItemCount: liquidSurplusCandidates.length,
      targetCount: input.targets.filter((target) => Number(target.value) > EPS).length,
    },
    variables,
    constraints,
    candidates: {
      cycleInput: cycleInputCandidates,
      liquidSurplus: liquidSurplusCandidates,
      alternateRecipe: alternateRecipeCandidates,
      byproductFuel: byproductFuelCandidates,
    },
    objectivePlan: [
      { priority: 1, objective: 'targetShortage=0', noteJa: '目標不足を最優先で0にします。', noteEn: 'Eliminate target shortage first.' },
      { priority: 2, objective: 'liquidSurplus=0', noteJa: '液体余剰を0に寄せます。', noteEn: 'Prefer zero liquid surplus.' },
      { priority: 3, objective: 'externalInput/cycleInput minimum', noteJa: '外部投入・循環補填を最小化します。', noteEn: 'Minimize external and cycle inputs.' },
      { priority: 4, objective: 'solidSurplus/discard minimum', noteJa: '固体余剰・破棄を最小化します。', noteEn: 'Minimize solid surplus/discard.' },
      { priority: 5, objective: 'recipeRuns minimum', noteJa: '余計なレシピ実行量を最小化します。', noteEn: 'Minimize unnecessary recipe runs.' },
      { priority: 6, objective: 'machineCount after rounding minimum', noteJa: '設備整数丸め後の台数を最小化します。', noteEn: 'Minimize machine count after integer rounding.' },
    ],
  };
}

export function buildLinearModelDiagnostics(input: CalculateInput): LinearModelDiagnostics {
  const activeGraph = buildDependencyGraph(input, 'active-plan');
  const allRecipeGraph = buildDependencyGraph(input, 'all-recipes');
  const activeDiagnostics = buildCycleDiagnostics(activeGraph);
  const allDiagnostics = buildCycleDiagnostics(allRecipeGraph);
  const linearBalanceModel = buildLinearBalanceModelDiagnostics(input, activeGraph, activeDiagnostics.cycles);

  const liquidOutputRecipeIds = RECIPES.filter((recipe) =>
    recipe.outputs.some((output) => itemById[output.itemId]?.physicalState === 'liquid'),
  ).map((recipe) => recipe.id);

  return {
    mode: 'diagnostic-only',
    noteJa:
      'v0.8.1 では、収支ベースsolver結果経路を通常計算に使い、ログ出力時はbalance solver単独の診断ログを出力します。',
    noteEn:
      'v0.8.1 uses the balance-based solver result path at runtime and emits balance-solver-only debug/log output.',
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
    linearBalanceModel,
  };
}

export function calculateWithNewSolver(input: CalculateInput, prebuiltDiagnostics?: LinearModelDiagnostics): NewSolverResult {
  const diagnostics = prebuiltDiagnostics ?? buildLinearModelDiagnostics(input);
  const alpha = calculateAlphaBalance(input, diagnostics);
  return {
    result: alpha.result,
    engineId: ACTIVE_ENGINE,
    linearModelDiagnostics: diagnostics,
    alphaBalanceTrace: alpha.trace,
  };
}

export function calculateWithNewSolverDebug(input: CalculateInput): CalculationDebugResult {
  const linearModelDiagnostics = buildLinearModelDiagnostics(input);
  const alpha = calculateAlphaBalance(input, linearModelDiagnostics);
  return {
    result: alpha.result,
    debugLog: {
      generatedAt: new Date().toISOString(),
      input: JSON.parse(JSON.stringify(input)) as CalculateInput,
      totals: alpha.result.totals,
      warnings: alpha.result.warnings,
      issues: [],
      summary: {
        itemCount: Object.keys(alpha.result.itemStats).length,
        recipeCount: Object.keys(alpha.result.recipeStats).length,
        flowCount: alpha.result.flows.length,
        flowsByRole: {},
        flowsByTransport: {},
        purchasedAutoCraftableCount: 0,
      },
      initialInvestment: alpha.result.initialInvestment,
      residualUnresolvedFlows: alpha.result.residualUnresolvedFlows ?? [],
      purchasedAutoCraftableFlows: [],
      flows: alpha.result.flows,
      itemStats: Object.values(alpha.result.itemStats).sort((a, b) => a.itemId.localeCompare(b.itemId)),
      recipeStats: Object.values(alpha.result.recipeStats).sort((a, b) => a.recipeId.localeCompare(b.recipeId)),
      solverEngine: ACTIVE_ENGINE,
      linearModelDiagnostics,
      alphaBalanceTrace: alpha.trace,
    } as CalculationDebugResult['debugLog'] & {
      solverEngine: SolverEngineId;
      linearModelDiagnostics: LinearModelDiagnostics;
      alphaBalanceTrace: AlphaBalanceSolveResult['trace'];
    },
  };
}

