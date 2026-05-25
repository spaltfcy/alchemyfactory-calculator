import { useMemo, type ReactNode } from 'react';
import { CAULDRON_TARGETS } from '../cauldron/cauldronData';
import { buildCauldronGraphResult, cauldronRequestForTarget } from '../cauldron/cauldronGraph';
import { generateCauldronCandidatesForOutput } from '../cauldron/cauldronMath';
import { optimizeCauldronTargetWithResult } from '../cauldron/cauldronOptimizer';
import { cauldronItemName, parseItemIdsText } from '../cauldron/cauldronSearch';
import type { CauldronOptimizationResult, CauldronOptimizedPlan, CauldronPlanItem, CauldronTargetPlan, CauldronState } from '../cauldron/cauldronTypes';
import { calculate } from '../engine/calculate';
import type { CalculationResult, ItemStat } from '../engine/calculate';
import type { AbilitySettings, AppSettings, Lang, ProductionTarget, SurplusPolicy } from '../types';
import { chooseRecipeForItem } from '../engine/itemSourceResolver';
import { GraphTab, type GraphFocusRequest } from './GraphTab';

type CauldronTabProps = {
  lang: Lang;
  state: CauldronState;
  settings: AppSettings;
  abilities: AbilitySettings;
  recipePreferences: Record<string, string>;
  surplusPolicies: Record<string, SurplusPolicy>;
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

function formatPlanAmount(value: number): string {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value - Math.round(value)) < 0.000001) return String(Math.round(value));
  return value.toFixed(3).replace(/\.?0+$/u, '');
}

function planStatusText(status: CauldronPlanItem['status'], lang: Lang): string {
  const labels: Record<CauldronPlanItem['status'], { ja: string; en: string }> = {
    startup: { ja: '初期投入', en: 'Startup' },
    normal: { ja: '通常レシピ', en: 'Normal recipe' },
    cauldronTarget: { ja: '錬金釜候補', en: 'Cauldron candidate' },
    handCauldron: { ja: '手入力釜', en: 'Manual cauldron' },
    missing: { ja: '未解決', en: 'Missing' },
    cycle: { ja: '循環', en: 'Cycle' },
    depthLimit: { ja: '探索上限', en: 'Depth limit' },
  };
  return labels[status][lang];
}

function planReasonText(item: CauldronPlanItem, lang: Lang): string {
  if (item.status === 'normal') {
    return lang === 'ja' ? `通常レシピ ${item.recipeId ?? ''} で展開します。` : `Expanded through normal recipe ${item.recipeId ?? ''}.`;
  }
  if (item.status === 'cauldronTarget') {
    const count = item.candidateCount ?? 0;
    return lang === 'ja' ? `錬金釜候補があります。候補数: ${count}` : `Has cauldron candidates. Candidate count: ${count}`;
  }
  if (item.status === 'handCauldron') {
    return lang === 'ja' ? `手入力の錬金釜レシピ ${item.recipeId ?? ''} が存在します。` : `Manual cauldron recipe ${item.recipeId ?? ''} exists.`;
  }
  if (item.status === 'startup') return lang === 'ja' ? '初期投入として扱います。' : 'Provided as a startup input.';
  if (item.status === 'cycle') return lang === 'ja' ? '循環を検出しました。初期投入候補として扱います。' : 'Cycle detected; treat as a startup candidate.';
  if (item.status === 'depthLimit') return lang === 'ja' ? '探索上限に達しました。' : 'Depth limit reached.';
  return lang === 'ja' ? '内部生産レシピが見つかりません。' : 'No internal production recipe was found.';
}

function renderPlanItem(item: CauldronPlanItem, lang: Lang): ReactNode {
  return (
    <li key={`${item.itemId}:${item.status}:${item.amount}:${item.recipeId ?? ''}`} className={`cauldron-plan-item cauldron-plan-item-${item.status}`}>
      <div className="cauldron-plan-item-head">
        <strong>{item.label[lang]}</strong>
        <span>{formatPlanAmount(item.amount)}</span>
        <em>{planStatusText(item.status, lang)}</em>
      </div>
      {item.recipeId && <p className="cauldron-plan-recipe">{item.recipeId}</p>}
      <p className="cauldron-plan-reason">{planReasonText(item, lang)}</p>
      {item.children.length > 0 && <ul className="cauldron-plan-tree">{item.children.map((child) => renderPlanItem(child, lang))}</ul>}
    </li>
  );
}

function planSummaryText(plan: CauldronTargetPlan, lang: Lang): string {
  const cauldronCount = plan.cauldronCandidateItemIds.length;
  const missingCount = plan.missingItemIds.length;
  if (lang === 'ja') {
    if (plan.status === 'blocked') return `未完結候補: 未解決 ${missingCount} 件`;
    return `レシピ候補: 錬金釜候補 ${cauldronCount} 件`;
  }
  if (plan.status === 'blocked') return `Incomplete candidate: ${missingCount} missing`;
  return `Recipe candidate: ${cauldronCount} cauldron candidates`;
}

function CauldronRecipePlanPanel({ lang, plan }: { lang: Lang; plan: CauldronTargetPlan }) {
  const title = lang === 'ja' ? 'レシピ案' : 'Recipe plan';
  const note = lang === 'ja'
    ? 'v0.10.6では、まず通常レシピと錬金釜候補を辿って案を出します。燃料・肥料込みの完全閉鎖スコアは次の段階で詰めます。'
    : 'v0.10.6 first lists normal recipes and cauldron candidates. Full closed-line scoring with fuel and fertilizer comes next.';
  const candidates = generateCauldronCandidatesForOutput(plan.targetItemId, { allowDuplicateInputs: true, maxCandidates: 3 });
  const candidateTitle = lang === 'ja' ? '錬金釜候補入力' : 'Cauldron candidate inputs';
  return (
    <section className={`cauldron-plan-panel cauldron-plan-panel-${plan.status}`}>
      <div className="cauldron-plan-header">
        <div>
          <h2>{title}</h2>
          <p>{plan.targetLabel[lang]}</p>
        </div>
        <span>{planSummaryText(plan, lang)}</span>
      </div>
      {candidates.length > 0 && (
        <div className="cauldron-candidate-list">
          <h3>{candidateTitle}</h3>
          {candidates.map((candidate, index) => (
            <div key={candidate.id} className="cauldron-candidate-row">
              <strong>{index + 1}</strong>
              <span>{candidate.inputItemIds.map((itemId) => cauldronItemName(itemId, lang)).join(' + ')}</span>
              <em>{formatPlanAmount(candidate.adjustedScore)}</em>
            </div>
          ))}
        </div>
      )}
      <ul className="cauldron-plan-tree cauldron-plan-root">{renderPlanItem(plan.root, lang)}</ul>
      <p className="cauldron-plan-note">{note}</p>
    </section>
  );
}

function optimizedStatusText(status: CauldronOptimizedPlan['status'], lang: Lang): string {
  const labels: Record<CauldronOptimizedPlan['status'], { ja: string; en: string }> = {
    perfect: { ja: '完全閉鎖', en: 'Perfect closed' },
    closed: { ja: '閉鎖候補', en: 'Closed candidate' },
    warning: { ja: '警告あり', en: 'Warnings' },
    blocked: { ja: '未完結', en: 'Blocked' },
  };
  return labels[status][lang];
}

function formatCopperValue(value: number, lang: Lang): string {
  if (!Number.isFinite(value) || Math.abs(value) <= 0.000001) return lang === 'ja' ? '0 銅' : '0 copper';
  const rounded = Math.round(value * 100) / 100;
  return lang === 'ja' ? `${formatPlanAmount(rounded)} 銅` : `${formatPlanAmount(rounded)} copper`;
}

function formatCount(value: number, lang: Lang): string {
  return lang === 'ja' ? `${value} 件` : `${value}`;
}

function metricValue(ok: boolean, lang: Lang): string {
  return ok ? (lang === 'ja' ? 'OK' : 'OK') : (lang === 'ja' ? '要確認' : 'Check');
}

function planInputText(plan: CauldronOptimizedPlan, lang: Lang): string {
  if (!plan.selectedInputItemIds) return plan.source === 'normal' ? (lang === 'ja' ? '通常レシピ' : 'Normal recipe') : '-';
  return plan.selectedInputItemIds.map((itemId) => cauldronItemName(itemId, lang)).join(' + ');
}

function CauldronOptimizedPlanPanel({ lang, optimization }: { lang: Lang; optimization: CauldronOptimizationResult }) {
  const bestPlan = optimization.bestPlan;
  if (!bestPlan) {
    return (
      <section className="cauldron-plan-panel cauldron-plan-panel-blocked">
        <div className="cauldron-plan-header">
          <div>
            <h2>{lang === 'ja' ? '最適レシピ' : 'Best recipe'}</h2>
            <p>{optimization.targetLabel[lang]}</p>
          </div>
          <span>{lang === 'ja' ? '候補なし' : 'No candidate'}</span>
        </div>
        <p className="cauldron-plan-note">{lang === 'ja' ? '錬金釜候補または通常レシピが見つかりません。' : 'No cauldron candidate or normal recipe was found.'}</p>
      </section>
    );
  }

  const metrics = bestPlan.metrics;
  const metricRows = [
    [lang === 'ja' ? '閉鎖' : 'Closed', metricValue(metrics.selfContained, lang)],
    [lang === 'ja' ? '余剰' : 'Surplus', metrics.noSurplus ? (lang === 'ja' ? 'なし' : 'None') : formatCount(metrics.surplusItemIds.length, lang)],
    [lang === 'ja' ? '初期費用' : 'Startup cost', formatCopperValue(metrics.startupCostCopper, lang)],
    [lang === 'ja' ? '常時供給' : 'Constant supply', metrics.hasConstantSupply ? formatCount(metrics.purchasedItemIds.length + metrics.externalItemIds.length, lang) : (lang === 'ja' ? 'なし' : 'None')],
    [lang === 'ja' ? '工程' : 'Recipes', String(metrics.recipeCount)],
    [lang === 'ja' ? 'エッジ' : 'Edges', String(metrics.edgeCount)],
    [lang === 'ja' ? '段数' : 'Depth', String(metrics.depth)],
    [lang === 'ja' ? '燃料/肥料' : 'Fuel/Fertilizer', `${formatPlanAmount(metrics.fuelRequiredPerMin)} / ${formatPlanAmount(metrics.fertilizerRequiredPerMin)}`],
  ];

  return (
    <section className={`cauldron-plan-panel cauldron-plan-panel-${bestPlan.status}`}>
      <div className="cauldron-plan-header">
        <div>
          <h2>{lang === 'ja' ? '最適レシピ' : 'Best recipe'}</h2>
          <p>{bestPlan.title[lang]}</p>
        </div>
        <span>{optimizedStatusText(bestPlan.status, lang)}</span>
      </div>
      <p className="cauldron-plan-summary">{bestPlan.summary[lang]}</p>
      <div className="cauldron-plan-metrics">
        {metricRows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {bestPlan.issues.length > 0 && (
        <ul className="cauldron-plan-issues">
          {bestPlan.issues.map((issue) => (
            <li key={`${issue.code}:${issue.itemIds?.join('|') ?? issue.message.en}`} className={`cauldron-plan-issue-${issue.severity}`}>
              {issue.message[lang]}
            </li>
          ))}
        </ul>
      )}
      <div className="cauldron-candidate-list cauldron-ranked-list">
        <h3>{lang === 'ja' ? '候補ランキング' : 'Candidate ranking'}</h3>
        {optimization.plans.slice(0, 5).map((plan) => (
          <div key={plan.id} className={`cauldron-candidate-row cauldron-ranked-row cauldron-ranked-row-${plan.status}`}>
            <strong>{plan.rank}</strong>
            <span>
              <b>{optimizedStatusText(plan.status, lang)}</b>
              {' / '}
              {planInputText(plan, lang)}
            </span>
            <em>{lang === 'ja' ? `工程 ${plan.metrics.recipeCount}` : `${plan.metrics.recipeCount} recipes`}</em>
          </div>
        ))}
      </div>
      <ul className="cauldron-plan-tree cauldron-plan-root">{renderPlanItem(bestPlan.root, lang)}</ul>
    </section>
  );
}

export function CauldronTab({ lang, state, settings, abilities, recipePreferences, surplusPolicies, completedGraphNodeIds, onToggleCompleted, focusRequest }: CauldronTabProps) {
  const targetItemId = state.targets.find((target) => (target.enabled ?? true) !== false && target.outputItemId)?.outputItemId ?? state.candidateTargetItemId;
  const targetRatePerMinute = state.targets.find((target) => (target.enabled ?? true) !== false && target.outputItemId === targetItemId)?.value ?? 1;
  const planned = useMemo(
    () => optimizeCauldronTargetWithResult({
      targetItemId,
      targetRatePerMinute: Math.max(0.000001, Number(targetRatePerMinute) || 1),
      state,
      settings,
      abilities,
      recipePreferences,
      surplusPolicies,
      startupItemIds: parseItemIdsText(state.startupItemIdsText),
      maxCandidates: Math.max(30, state.maxCandidates),
    }),
    [abilities, recipePreferences, settings, state, surplusPolicies, targetItemId, targetRatePerMinute],
  );
  const optimization = planned.optimization;
  const result = planned.result;

  return (
    <div className="cauldron-tab">
      <CauldronOptimizedPlanPanel lang={lang} optimization={optimization} />
      <div className="cauldron-graph-region">
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
      </div>
    </div>
  );
}
