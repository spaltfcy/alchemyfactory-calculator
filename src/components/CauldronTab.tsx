import { useMemo } from 'react';
import { CAULDRON_TARGETS } from '../cauldron/cauldronData';
import { buildCauldronGraphResult, cauldronRequestForTarget } from '../cauldron/cauldronGraph';
import type { CauldronState } from '../cauldron/cauldronTypes';
import { calculate } from '../engine/calculate';
import type { CalculationResult, ItemStat } from '../engine/calculate';
import type { AbilitySettings, AppSettings, Lang, ProductionTarget } from '../types';
import { chooseRecipeForItem } from '../engine/itemSourceResolver';
import { GraphTab, type GraphFocusRequest } from './GraphTab';

type CauldronTabProps = {
  lang: Lang;
  state: CauldronState;
  settings: AppSettings;
  abilities: AbilitySettings;
  recipePreferences: Record<string, string>;
  surplusPolicies: Record<string, string>;
  completedGraphNodeIds: Record<string, boolean>;
  onToggleCompleted: (nodeId: string) => void;
  focusRequest?: GraphFocusRequest;
};

const EMPTY_TOTALS: CalculationResult['totals'] = {
  initialCostCopper: 0,
  runningCostCopperPerMin: 0,
  purchaseCostCopperPerMin: 0,
  revenueCopperPerMin: 0,
  profitCopperPerMin: 0,
  conveyorItemsPerMinute: 60,
  productionSpeedMultiplier: 1,
  heatConsumptionMultiplier: 1,
  sellPriceMultiplier: 1,
  fuelHeatValueMultiplier: 1,
  fertilizerNutritionMultiplier: 1,
  heatRequiredPerMin: 0,
  fuelRequiredPerMin: 0,
  fuelItemId: 'charcoal_powder',
  fertilizerNutrientsRequiredPerMin: 0,
  fertilizerRequiredPerMin: 0,
  fertilizerItemId: 'basic_fertilizer',
};

const NUMERIC_ITEM_STAT_KEYS: Array<keyof Omit<ItemStat, 'itemId'>> = [
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

function emptyResult(settings: AppSettings): CalculationResult {
  return {
    itemStats: {},
    recipeStats: {},
    flows: [],
    conveyorEdges: [],
    outputEdges: [],
    warnings: [],
    calculationStatus: 'ok',
    errorSummaries: [],
    totals: {
      ...EMPTY_TOTALS,
      conveyorItemsPerMinute: settings.targetDefaults ? EMPTY_TOTALS.conveyorItemsPerMinute : EMPTY_TOTALS.conveyorItemsPerMinute,
      calculationMs: 0,
      queueSteps: 0,
      queueMax: 0,
    },
  };
}

function addItemStats(target: Record<string, ItemStat>, source: Record<string, ItemStat>): void {
  for (const [itemId, stat] of Object.entries(source)) {
    if (!target[itemId]) target[itemId] = { ...stat, itemId };
    else {
      for (const key of NUMERIC_ITEM_STAT_KEYS) target[itemId][key] += stat[key];
    }
  }
}

function uniqueRecipeStats(recipeStats: CalculationResult['recipeStats'], index: number): CalculationResult['recipeStats'] {
  const next: CalculationResult['recipeStats'] = {};
  for (const [recipeId, stat] of Object.entries(recipeStats)) {
    const id = index === 0 ? recipeId : `${recipeId}:target${index + 1}`;
    next[id] = { ...stat, recipeId: id };
  }
  return next;
}

function uniqueFlows(flows: CalculationResult['flows'], index: number): CalculationResult['flows'] {
  if (index === 0) return flows;
  return flows.map((flow) => ({
    ...flow,
    id: `${flow.id}:target${index + 1}`,
    from: flow.from.type === 'recipe' ? { ...flow.from, recipeId: `${flow.from.recipeId}:target${index + 1}` } : flow.from,
    to: flow.to.type === 'recipe' ? { ...flow.to, recipeId: `${flow.to.recipeId}:target${index + 1}` } : flow.to,
  }));
}

function mergeResults(results: CalculationResult[], settings: AppSettings): CalculationResult {
  if (results.length === 0) return emptyResult(settings);
  const merged = emptyResult(settings);
  merged.calculationStatus = results.some((result) => result.calculationStatus === 'invalid') ? 'invalid' : 'ok';

  results.forEach((result, index) => {
    addItemStats(merged.itemStats, result.itemStats);
    Object.assign(merged.recipeStats, uniqueRecipeStats(result.recipeStats, index));
    merged.flows.push(...uniqueFlows(result.flows, index));
    merged.conveyorEdges.push(...result.conveyorEdges);
    merged.outputEdges.push(...result.outputEdges);
    merged.warnings.push(...result.warnings);
    merged.errorSummaries?.push(...(result.errorSummaries ?? []));
    merged.totals.initialCostCopper += result.totals.initialCostCopper ?? 0;
    merged.totals.runningCostCopperPerMin += result.totals.runningCostCopperPerMin ?? 0;
    merged.totals.purchaseCostCopperPerMin += result.totals.purchaseCostCopperPerMin ?? 0;
    merged.totals.revenueCopperPerMin += result.totals.revenueCopperPerMin ?? 0;
    merged.totals.profitCopperPerMin += result.totals.profitCopperPerMin ?? 0;
    merged.totals.heatRequiredPerMin += result.totals.heatRequiredPerMin ?? 0;
    merged.totals.fuelRequiredPerMin += result.totals.fuelRequiredPerMin ?? 0;
    merged.totals.fertilizerNutrientsRequiredPerMin += result.totals.fertilizerNutrientsRequiredPerMin ?? 0;
    merged.totals.fertilizerRequiredPerMin += result.totals.fertilizerRequiredPerMin ?? 0;
  });

  return merged;
}

function buildCauldronTabResult(
  state: CauldronState,
  settings: AppSettings,
  abilities: AbilitySettings,
  recipePreferences: Record<string, string>,
  surplusPolicies: Record<string, string>,
): CalculationResult {
  const enabledTargets = state.targets.filter((target) => (target.enabled ?? true) !== false && target.outputItemId);
  const normalTargets: ProductionTarget[] = [];
  const normalFallbackWarnings: CalculationResult['warnings'] = [];
  const results: CalculationResult[] = [];

  enabledTargets.forEach((target) => {
    if (!CAULDRON_TARGETS[target.outputItemId]) {
      normalTargets.push({ ...target, recipeId: target.recipeId || '' });
      return;
    }

    const built = buildCauldronGraphResult(cauldronRequestForTarget(target, state), state);
    if (built.summary.status === 'ok') {
      results.push(built.result);
      return;
    }

    const normalRecipe = target.recipeId || chooseRecipeForItem(target.outputItemId, recipePreferences)?.id;
    if (normalRecipe) {
      normalTargets.push({ ...target, recipeId: target.recipeId || '' });
      normalFallbackWarnings.push({
        messageJa: '錬金釜の' + target.outputItemId + 'は' + (built.summary.code ?? '未検証') + 'のため、通常レシピ経路で表示しています。',
        messageEn: 'Cauldron ' + target.outputItemId + ' is ' + (built.summary.code ?? 'unverified') + ', so the normal recipe route is shown.',
      });
      return;
    }

    results.push(built.result);
  });

  if (normalTargets.length > 0) {
    const normalResult = calculate({ targets: normalTargets, settings, abilities, recipePreferences, surplusPolicies });
    normalResult.warnings = [...normalFallbackWarnings, ...normalResult.warnings];
    results.unshift(normalResult);
  }

  return mergeResults(results, settings);
}

export function CauldronTab({ lang, state, settings, abilities, recipePreferences, surplusPolicies, completedGraphNodeIds, onToggleCompleted, focusRequest }: CauldronTabProps) {
  const result = useMemo(
    () => buildCauldronTabResult(state, settings, abilities, recipePreferences, surplusPolicies),
    [state, settings, abilities, recipePreferences, surplusPolicies],
  );

  return (
    <GraphTab
      lang={lang}
      result={result}
      settings={settings}
      completedGraphNodeIds={completedGraphNodeIds}
      onToggleCompleted={onToggleCompleted}
      focusRequest={focusRequest}
      captureId="cauldron"
      debug={false}
    />
  );
}
