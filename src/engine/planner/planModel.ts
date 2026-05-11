import type { CalculateInput } from '../calculationTypes';
import type { AppSettings, Recipe } from '../../types';
import { RECIPES, getRecipesProducing, recipeById } from '../../data/recipes';
import { itemById } from '../../data/items';
import { chooseRecipeForItem, isBuyableItem } from '../itemSourceResolver';
import {
  getConveyorItemsPerMinute,
  getFertilizerNutritionMultiplier,
  getFuelHeatValueMultiplier,
  getHeatConsumptionMultiplier,
  getProductionSpeedMultiplier,
} from '../../data/abilityTables';
import { getEffectiveRecipeForCalculation, type EffectiveRecipe } from '../../data/effectiveRecipes';

export type NormalizedPlanTarget = {
  id: string;
  enabled: boolean;
  recipeId: string;
  outputItemId: string;
  mode: 'rate' | 'machines';
  value: number;
};

export type PlanRecipeDependencyEdge = {
  consumerRecipeId: string;
  producerRecipeId: string;
  itemId: string;
  selected: boolean;
};

export type PlanCycleClassification =
  | 'none'
  | 'cycleInputCandidate'
  | 'purchaseBreakable'
  | 'externalBreakable'
  | 'invalid'
  | 'unsupported';

export type PlanCycleDecisionClassification =
  | 'cycleInput'
  | 'purchaseBreakable'
  | 'externalBreakable'
  | 'alternateRecipeBreakable'
  | 'invalid'
  | 'unsupported';

export type PlanCycleDecision = {
  componentId: string;
  candidateClassification: PlanCycleClassification;
  classification: PlanCycleDecisionClassification;
  recipeIds: string[];
  itemIds: string[];
  requiredInitialItems: Record<string, number>;
  runningExternalInputs: Record<string, number>;
  safeForMainResult: boolean;
  reasonJa: string;
  reasonEn: string;
};

export type PlanCycleComponent = {
  id: string;
  recipeIds: string[];
  itemIds: string[];
  buyableItemIds: string[];
  classification: PlanCycleClassification;
  reasonJa: string;
  reasonEn: string;
  cycleTextJa: string;
  cycleTextEn: string;
};

export type PlanModel = {
  input: CalculateInput;
  targets: {
    all: NormalizedPlanTarget[];
    enabled: NormalizedPlanTarget[];
    disabled: NormalizedPlanTarget[];
    calculation: NormalizedPlanTarget[];
  };
  recipes: {
    selectedByOutputItemId: Record<string, string>;
    effectiveByRecipeId: Record<string, EffectiveRecipe>;
    producingByItemId: Record<string, string[]>;
    activeRecipeIds: string[];
  };
  dependencyGraph: {
    activeRecipeIds: string[];
    edges: PlanRecipeDependencyEdge[];
    cycleComponents: PlanCycleComponent[];
    cycleDecisions: PlanCycleDecision[];
  };
  sources: {
    buyableItemIds: string[];
    externalFuel: boolean;
    externalFertilizer: boolean;
  };
  abilities: {
    productionSpeedMultiplier: number;
    heatConsumptionMultiplier: number;
    fuelHeatValueMultiplier: number;
    fertilizerNutritionMultiplier: number;
    conveyorItemsPerMinute: number;
  };
  specialResources: {
    fuelEnabled: boolean;
    fuelItemId: string;
    fuelSourceMode: 'internal' | 'external';
    heatingMode: 'direct' | 'steam';
    fertilizerEnabled: boolean;
    fertilizerItemId: string;
    fertilizerSourceMode: 'internal' | 'external';
  };
  summary: {
    allTargetCount: number;
    enabledTargetCount: number;
    disabledTargetCount: number;
    calculationTargetCount: number;
    activeRecipeCount: number;
    dependencyEdgeCount: number;
    cycleComponentCount: number;
  };
};

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalizeTargets(input: CalculateInput): NormalizedPlanTarget[] {
  return input.targets.map((target) => {
    const selected = target.outputItemId ? chooseRecipeForItem(target.outputItemId, input.recipePreferences) : undefined;
    return {
      id: target.id,
      enabled: target.enabled !== false,
      recipeId: target.recipeId && recipeById[target.recipeId] ? target.recipeId : selected?.id ?? target.recipeId,
      outputItemId: target.outputItemId,
      mode: target.mode,
      value: Number.isFinite(Number(target.value)) ? Number(target.value) : 0,
    };
  });
}

function buildProducingByItemId(): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const recipe of RECIPES) {
    for (const output of recipe.outputs) {
      const list = result[output.itemId] ?? [];
      list.push(recipe.id);
      result[output.itemId] = list;
    }
  }
  for (const itemId of Object.keys(result)) result[itemId] = uniqueSorted(result[itemId]);
  return result;
}

function buildSelectedByOutputItemId(input: CalculateInput): Record<string, string> {
  const itemIds = new Set<string>();
  for (const recipe of RECIPES) for (const output of recipe.outputs) itemIds.add(output.itemId);
  const result: Record<string, string> = {};
  for (const itemId of itemIds) {
    const selected = chooseRecipeForItem(itemId, input.recipePreferences);
    if (selected) result[itemId] = selected.id;
  }
  return result;
}

function dependencyEdgesForRecipe(recipeId: string, input: CalculateInput): PlanRecipeDependencyEdge[] {
  const base = recipeById[recipeId];
  if (!base) return [];
  const effective = getEffectiveRecipeForCalculation(base, input.settings);
  return effective.inputs.flatMap((recipeInput) => {
    const selectedProducer = chooseRecipeForItem(recipeInput.itemId, input.recipePreferences);
    if (!selectedProducer) return [];
    return [{ consumerRecipeId: recipeId, producerRecipeId: selectedProducer.id, itemId: recipeInput.itemId, selected: true }];
  });
}

function collectActiveRecipes(targets: NormalizedPlanTarget[], input: CalculateInput): { recipeIds: string[]; edges: PlanRecipeDependencyEdge[] } {
  const visited = new Set<string>();
  const edges: PlanRecipeDependencyEdge[] = [];
  const stack = targets.flatMap((target) => (target.recipeId && recipeById[target.recipeId] ? [target.recipeId] : []));
  while (stack.length > 0) {
    const recipeId = stack.pop();
    if (!recipeId || visited.has(recipeId)) continue;
    visited.add(recipeId);
    for (const edge of dependencyEdgesForRecipe(recipeId, input)) {
      edges.push(edge);
      if (!visited.has(edge.producerRecipeId)) stack.push(edge.producerRecipeId);
    }
  }
  return { recipeIds: uniqueSorted(visited), edges };
}

function stronglyConnectedComponents(recipeIds: string[], edges: PlanRecipeDependencyEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const recipeId of recipeIds) adjacency.set(recipeId, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.consumerRecipeId)) adjacency.set(edge.consumerRecipeId, []);
    adjacency.get(edge.consumerRecipeId)?.push(edge.producerRecipeId);
    if (!adjacency.has(edge.producerRecipeId)) adjacency.set(edge.producerRecipeId, []);
  }
  let index = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const low = new Map<string, number>();
  const result: string[][] = [];
  function visit(v: string) {
    indices.set(v, index);
    low.set(v, index);
    index += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of adjacency.get(v) ?? []) {
      if (!indices.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, indices.get(w) ?? 0));
      }
    }
    if (low.get(v) === indices.get(v)) {
      const component: string[] = [];
      while (stack.length > 0) {
        const w = stack.pop();
        if (!w) break;
        onStack.delete(w);
        component.push(w);
        if (w === v) break;
      }
      result.push(component.sort((a, b) => a.localeCompare(b)));
    }
  }
  for (const recipeId of recipeIds) if (!indices.has(recipeId)) visit(recipeId);
  return result;
}

function cycleText(recipeIds: string[], edges: PlanRecipeDependencyEdge[], lang: 'ja' | 'en'): string {
  const names = recipeIds.map((recipeId) => recipeById[recipeId]?.name[lang] ?? recipeId);
  const itemNames = uniqueSorted(edges.map((edge) => edge.itemId)).map((itemId) => itemById[itemId]?.name[lang] ?? itemId);
  const sep = lang === 'ja' ? ' → ' : ' -> ';
  if (itemNames.length > 0) return [...names, ...itemNames].join(sep);
  return names.join(sep);
}

function classifyCycle(itemIds: string[], settings: AppSettings): { classification: PlanCycleClassification; reasonJa: string; reasonEn: string } {
  const buyable = itemIds.filter(isBuyableItem);
  if (buyable.length > 0) {
    return { classification: 'purchaseBreakable', reasonJa: '購入可能アイテムで循環を分断できる候補です。', reasonEn: 'The cycle can potentially be broken by purchasing a buyable item.' };
  }
  const specialItemIds = [settings.fuel.fuelItemId, settings.fertilizer.fertilizerItemId, settings.fuel.heatingMode === 'steam' ? 'steam' : ''].filter(Boolean);
  if (itemIds.some((itemId) => specialItemIds.includes(itemId)) && (settings.fuel.sourceMode === 'external' || settings.fertilizer.sourceMode === 'external')) {
    return { classification: 'externalBreakable', reasonJa: '外部生産扱いの特殊リソースで分断できる候補です。', reasonEn: 'The cycle can potentially be broken by an externally supplied special resource.' };
  }
  return { classification: 'cycleInputCandidate', reasonJa: '初期投入または専用の循環処理が必要な候補です。', reasonEn: 'This cycle likely requires startup input or dedicated cycle handling.' };
}

function buildCycleComponents(recipeIds: string[], edges: PlanRecipeDependencyEdge[], settings: AppSettings): PlanCycleComponent[] {
  const selfLoopIds = new Set(edges.filter((edge) => edge.consumerRecipeId === edge.producerRecipeId).map((edge) => edge.consumerRecipeId));
  const components = stronglyConnectedComponents(recipeIds, edges).filter((component) => component.length > 1 || selfLoopIds.has(component[0] ?? ''));
  return components.map((component, index) => {
    const edgeInComponent = edges.filter((edge) => component.includes(edge.consumerRecipeId) && component.includes(edge.producerRecipeId));
    const itemIds = uniqueSorted(edgeInComponent.map((edge) => edge.itemId));
    const buyableItemIds = itemIds.filter(isBuyableItem);
    const classification = classifyCycle(itemIds, settings);
    return {
      id: 'cycle-' + String(index + 1).padStart(3, '0'),
      recipeIds: component,
      itemIds,
      buyableItemIds,
      classification: classification.classification,
      reasonJa: classification.reasonJa,
      reasonEn: classification.reasonEn,
      cycleTextJa: cycleText(component, edgeInComponent, 'ja'),
      cycleTextEn: cycleText(component, edgeInComponent, 'en'),
    };
  });
}


function firstPositiveInitialItem(cycle: PlanCycleComponent): string | undefined {
  return cycle.buyableItemIds[0] ?? cycle.itemIds[0];
}

function decideCycleComponent(cycle: PlanCycleComponent, settings: AppSettings): PlanCycleDecision {
  if (cycle.classification === 'externalBreakable') {
    const runningExternalInputs: Record<string, number> = {};
    const externalItems = [
      settings.fuel.sourceMode === 'external' ? settings.fuel.fuelItemId : '',
      settings.fertilizer.sourceMode === 'external' ? settings.fertilizer.fertilizerItemId : '',
      settings.fuel.sourceMode === 'external' && settings.fuel.heatingMode === 'steam' ? 'steam' : '',
    ].filter(Boolean);
    for (const itemId of cycle.itemIds) if (externalItems.includes(itemId)) runningExternalInputs[itemId] = 0;
    return {
      componentId: cycle.id,
      candidateClassification: cycle.classification,
      classification: 'externalBreakable',
      recipeIds: cycle.recipeIds,
      itemIds: cycle.itemIds,
      requiredInitialItems: {},
      runningExternalInputs,
      safeForMainResult: true,
      reasonJa: '外部供給設定の特殊リソースで循環を安全に分断できます。',
      reasonEn: 'The cycle can be safely broken by an externally supplied special resource.',
    };
  }

  if (cycle.classification === 'purchaseBreakable') {
    const itemId = cycle.buyableItemIds[0];
    return {
      componentId: cycle.id,
      candidateClassification: cycle.classification,
      classification: itemId ? 'cycleInput' : 'unsupported',
      recipeIds: cycle.recipeIds,
      itemIds: cycle.itemIds,
      requiredInitialItems: itemId ? { [itemId]: 1 } : {},
      runningExternalInputs: {},
      safeForMainResult: Boolean(itemId),
      reasonJa: itemId
        ? '購入可能素材を初期投入として使えば循環を起動できます。毎分購入としては扱いません。'
        : '購入可能素材で分断できる候補ですが、初期投入素材を確定できませんでした。',
      reasonEn: itemId
        ? 'A buyable item can be used as startup input for the cycle. It is not treated as a per-minute purchase.'
        : 'The cycle looked purchase-breakable, but no startup item could be determined.',
    };
  }

  if (cycle.classification === 'cycleInputCandidate') {
    const itemId = firstPositiveInitialItem(cycle);
    const simpleEnough = cycle.recipeIds.length <= 3 && cycle.itemIds.length <= 4 && Boolean(itemId);
    return {
      componentId: cycle.id,
      candidateClassification: cycle.classification,
      classification: simpleEnough ? 'cycleInput' : 'unsupported',
      recipeIds: cycle.recipeIds,
      itemIds: cycle.itemIds,
      requiredInitialItems: simpleEnough && itemId ? { [itemId]: 1 } : {},
      runningExternalInputs: {},
      safeForMainResult: simpleEnough,
      reasonJa: simpleEnough
        ? '単純な循環として初期投入候補を特定しました。v0.9.7では本流の毎分購入には混ぜず、初期投入判断としてログ化します。'
        : '循環は検出できましたが、初期投入だけで安全に扱える単純循環とは判定できませんでした。',
      reasonEn: simpleEnough
        ? 'Identified startup input for a simple cycle. v0.9.7 logs it as a startup decision without mixing it into per-minute purchases.'
        : 'A cycle was detected, but it was not proven safe as a simple startup-input cycle.',
    };
  }

  return {
    componentId: cycle.id,
    candidateClassification: cycle.classification,
    classification: cycle.classification === 'invalid' ? 'invalid' : 'unsupported',
    recipeIds: cycle.recipeIds,
    itemIds: cycle.itemIds,
    requiredInitialItems: {},
    runningExternalInputs: {},
    safeForMainResult: false,
    reasonJa: 'v0.9.7ではこの循環を安全に解決できません。',
    reasonEn: 'v0.9.7 cannot safely resolve this cycle.',
  };
}

function buildCycleDecisions(cycles: PlanCycleComponent[], settings: AppSettings): PlanCycleDecision[] {
  return cycles.map((cycle) => decideCycleComponent(cycle, settings));
}

export function buildPlanModel(input: CalculateInput): PlanModel {
  const allTargets = normalizeTargets(input);
  const enabled = allTargets.filter((target) => target.enabled);
  const disabled = allTargets.filter((target) => !target.enabled);
  const calculation = enabled.filter((target) => Number.isFinite(target.value) && target.value > 0 && target.outputItemId);
  const activeGraph = collectActiveRecipes(calculation, input);
  const effectiveByRecipeId: Record<string, EffectiveRecipe> = {};
  for (const recipeId of activeGraph.recipeIds) {
    const recipe = recipeById[recipeId];
    if (recipe) effectiveByRecipeId[recipeId] = getEffectiveRecipeForCalculation(recipe, input.settings);
  }
  const producingByItemId = buildProducingByItemId();
  const selectedByOutputItemId = buildSelectedByOutputItemId(input);
  const buyableItemIds = Object.keys(itemById).filter(isBuyableItem).sort((a, b) => a.localeCompare(b));
  const cycleComponents = buildCycleComponents(activeGraph.recipeIds, activeGraph.edges, input.settings);
  const cycleDecisions = buildCycleDecisions(cycleComponents, input.settings);
  return {
    input,
    targets: { all: allTargets, enabled, disabled, calculation },
    recipes: {
      selectedByOutputItemId,
      effectiveByRecipeId,
      producingByItemId,
      activeRecipeIds: activeGraph.recipeIds,
    },
    dependencyGraph: {
      activeRecipeIds: activeGraph.recipeIds,
      edges: activeGraph.edges,
      cycleComponents,
      cycleDecisions,
    },
    sources: {
      buyableItemIds,
      externalFuel: input.settings.fuel.sourceMode === 'external',
      externalFertilizer: input.settings.fertilizer.sourceMode === 'external',
    },
    abilities: {
      productionSpeedMultiplier: getProductionSpeedMultiplier(input.abilities),
      heatConsumptionMultiplier: getHeatConsumptionMultiplier(input.abilities),
      fuelHeatValueMultiplier: getFuelHeatValueMultiplier(input.abilities),
      fertilizerNutritionMultiplier: getFertilizerNutritionMultiplier(input.abilities),
      conveyorItemsPerMinute: getConveyorItemsPerMinute(input.abilities),
    },
    specialResources: {
      fuelEnabled: input.settings.fuel.enabled,
      fuelItemId: input.settings.fuel.fuelItemId,
      fuelSourceMode: input.settings.fuel.sourceMode,
      heatingMode: input.settings.fuel.heatingMode,
      fertilizerEnabled: input.settings.fertilizer.enabled,
      fertilizerItemId: input.settings.fertilizer.fertilizerItemId,
      fertilizerSourceMode: input.settings.fertilizer.sourceMode,
    },
    summary: {
      allTargetCount: allTargets.length,
      enabledTargetCount: enabled.length,
      disabledTargetCount: disabled.length,
      calculationTargetCount: calculation.length,
      activeRecipeCount: activeGraph.recipeIds.length,
      dependencyEdgeCount: activeGraph.edges.length,
      cycleComponentCount: cycleComponents.length,
    },
  };
}
