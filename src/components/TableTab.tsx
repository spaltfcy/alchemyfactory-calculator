import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { Lang, MachineTableSortKey, TablePreferences } from '../types';
import type { CalculatedFlow, CalculationResult, ConveyorEdgeStat, RecipeStat } from '../engine/calculate';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { recipeById } from '../data/recipes';
import { t, text } from '../i18n';
import { formatCopper, formatNumber, formatRate } from '../utils/format';

export type TableTabProps = {
  lang: Lang;
  result: CalculationResult;
  tablePreferences: TablePreferences;
  onTablePreferencesChange: (tablePreferences: TablePreferences) => void;
};

type MachineTableColumn = {
  key: MachineTableSortKey;
  label: string;
};

type RecipeExpansionEntry =
  | { kind: 'final'; itemId: string; rate: number }
  | { kind: 'cycle'; recipeId: string };

function fallbackName(id: string, lang: Lang): string {
  return text({ ja: id, en: id }, lang);
}

function itemName(itemId: string, lang: Lang): string {
  const item = itemById[itemId];
  return item ? text(item.name, lang) : fallbackName(itemId, lang);
}

function transportCountLabel(edge: ConveyorEdgeStat, lang: Lang): string {
  if (edge.transportKind === 'pipeline') return lang === 'ja' ? 'パイプライン 1本' : 'Pipeline x1';
  return String(edge.transportUnits ?? edge.belts);
}

function recipeName(row: RecipeStat, lang: Lang): string {
  const recipe = recipeById[row.recipeId];
  return recipe ? text(recipe.name, lang) : row.recipeId;
}

function recipeNameById(recipeId: string, lang: Lang): string {
  const recipe = recipeById[recipeId];
  return recipe ? text(recipe.name, lang) : recipeId;
}

function machineName(row: RecipeStat, lang: Lang): string {
  const machine = machineById[row.machineId];
  return machine ? text(machine.name, lang) : row.machineId;
}

function surplusTotal(row: RecipeStat): number {
  return Object.values(row.surplusOutputRates).reduce((sum, value) => sum + Math.max(0, value), 0);
}

function productionRateTotal(row: RecipeStat): number {
  return Object.values(row.outputRates).reduce((sum, value) => sum + Math.max(0, value), 0);
}

function positiveProductionEntries(row: RecipeStat): Array<[string, number]> {
  return Object.entries(row.outputRates)
    .filter(([, value]) => Number.isFinite(value) && value > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

function compareText(a: string, b: string, lang: Lang): number {
  return new Intl.Collator(lang === 'ja' ? 'ja' : 'en', { numeric: true, sensitivity: 'base' }).compare(a, b);
}

function compareMachineRows(a: RecipeStat, b: RecipeStat, key: MachineTableSortKey, lang: Lang): number {
  if (key === 'recipe') return compareText(recipeName(a, lang), recipeName(b, lang), lang);
  if (key === 'machine') return compareText(machineName(a, lang), machineName(b, lang), lang);
  if (key === 'productionRate') return productionRateTotal(a) - productionRateTotal(b);
  if (key === 'theoreticalMachines') return a.theoreticalMachines - b.theoreticalMachines;
  if (key === 'actualMachines') return a.actualMachines - b.actualMachines;
  return surplusTotal(a) - surplusTotal(b);
}

function machineSortLabel(active: boolean, direction: TablePreferences['machineSort']['direction']): string {
  if (!active) return '';
  return direction === 'asc' ? ' ▲' : ' ▼';
}

function isDownstreamFlow(flow: CalculatedFlow): boolean {
  if (flow.rate <= 0) return false;
  if (flow.from.type !== 'recipe') return false;
  if (flow.role === 'discard' || flow.role === 'surplus') return false;
  return flow.to.type === 'recipe' || (flow.to.type === 'itemSink' && flow.to.sinkMode === 'final');
}

function buildRecipeExpansionMap(result: CalculationResult): Map<string, RecipeExpansionEntry[]> {
  const outgoingByRecipe = new Map<string, CalculatedFlow[]>();
  for (const flow of result.flows) {
    if (!isDownstreamFlow(flow) || flow.from.type !== 'recipe') continue;
    const recipeId = flow.from.recipeId;
    const outgoing = outgoingByRecipe.get(recipeId) ?? [];
    outgoing.push(flow);
    outgoingByRecipe.set(recipeId, outgoing);
  }

  function buildForRecipe(startRecipeId: string): RecipeExpansionEntry[] {
    const finalRates = new Map<string, number>();
    const cycleRecipeIds = new Set<string>();

    function visit(recipeId: string, path: Set<string>): void {
      const flows = outgoingByRecipe.get(recipeId) ?? [];
      for (const flow of flows) {
        if (flow.to.type === 'itemSink' && flow.to.sinkMode === 'final') {
          const itemId = flow.itemId;
          const finalRate = result.itemStats[itemId]?.targetActual ?? flow.rate;
          finalRates.set(itemId, Math.max(finalRates.get(itemId) ?? 0, finalRate));
          continue;
        }

        if (flow.to.type !== 'recipe') continue;
        const nextRecipeId = flow.to.recipeId;
        if (path.has(nextRecipeId)) {
          cycleRecipeIds.add(nextRecipeId);
          continue;
        }
        visit(nextRecipeId, new Set([...path, nextRecipeId]));
      }
    }

    visit(startRecipeId, new Set([startRecipeId]));

    const entries: RecipeExpansionEntry[] = [
      ...[...finalRates.entries()]
        .filter(([, rate]) => Number.isFinite(rate) && rate > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([itemId, rate]) => ({ kind: 'final' as const, itemId, rate })),
      ...[...cycleRecipeIds]
        .sort((a, b) => a.localeCompare(b))
        .map((recipeId) => ({ kind: 'cycle' as const, recipeId })),
    ];

    return entries;
  }

  const map = new Map<string, RecipeExpansionEntry[]>();
  for (const recipeId of Object.keys(result.recipeStats)) {
    const entries = buildForRecipe(recipeId);
    if (entries.length > 0) map.set(recipeId, entries);
  }
  return map;
}

export function TableTab({ lang, result, tablePreferences, onTablePreferencesChange }: TableTabProps) {
  const [expandedRecipeIds, setExpandedRecipeIds] = useState<Set<string>>(() => new Set());
  const machineSort = tablePreferences.machineSort;
  const machineColumns: MachineTableColumn[] = [
    { key: 'recipe', label: t('recipe', lang) },
    { key: 'machine', label: lang === 'ja' ? '設備' : 'Machine' },
    { key: 'productionRate', label: lang === 'ja' ? '生産量' : 'Production' },
    { key: 'theoreticalMachines', label: lang === 'ja' ? '理論台数' : 'Theoretical' },
    { key: 'actualMachines', label: lang === 'ja' ? '実台数' : 'Actual' },
    { key: 'surplus', label: t('surplus', lang) },
  ];

  const expansionByRecipeId = useMemo(() => buildRecipeExpansionMap(result), [result]);
  const recipeRows = Object.values(result.recipeStats).sort((a, b) => {
    const direction = machineSort.direction === 'asc' ? 1 : -1;
    const primary = compareMachineRows(a, b, machineSort.key, lang) * direction;
    if (primary !== 0) return primary;
    return compareText(recipeName(a, lang), recipeName(b, lang), lang) || a.recipeId.localeCompare(b.recipeId);
  });
  const itemRows = Object.values(result.itemStats).sort((a, b) => a.itemId.localeCompare(b.itemId));
  const initialCostLabel = lang === 'ja' ? '初期コスト' : 'Initial cost';
  const runningCostLabel = lang === 'ja' ? 'ランニングコスト/min' : 'Running cost/min';
  const initialPurchasedLabel = lang === 'ja' ? '初期購入' : 'Initial purchase';
  const finalOutputLabel = lang === 'ja' ? '最終出力' : 'Final output';
  const relatedRecipeLabel = lang === 'ja' ? '関連レシピ' : 'Related recipe';
  const actualOutputLabel = lang === 'ja' ? '実出力' : 'Actual output';
  const cycleSuffix = lang === 'ja' ? ' (循環)' : ' (cycle)';

  function initialMachineSortDirection(key: MachineTableSortKey): TablePreferences['machineSort']['direction'] {
    return key === 'productionRate' || key === 'theoreticalMachines' || key === 'actualMachines' || key === 'surplus' ? 'desc' : 'asc';
  }

  function setMachineSort(key: MachineTableSortKey): void {
    const direction = machineSort.key === key
      ? (machineSort.direction === 'asc' ? 'desc' : 'asc')
      : initialMachineSortDirection(key);
    onTablePreferencesChange({
      ...tablePreferences,
      machineSort: { key, direction },
    });
  }

  function toggleExpandedRecipe(recipeId: string): void {
    setExpandedRecipeIds((current) => {
      const next = new Set(current);
      if (next.has(recipeId)) next.delete(recipeId);
      else next.add(recipeId);
      return next;
    });
  }

  function productionSummary(row: RecipeStat): ReactNode {
    const entries = positiveProductionEntries(row);
    if (entries.length === 0) return <>-</>;
    if (entries.length === 1) return <>{formatRate(entries[0][1])}/min</>;
    return (
      <div className="machine-production-list">
        {entries.map(([itemId, value]) => (
          <div key={itemId}>{itemName(itemId, lang)} {formatRate(value)}/min</div>
        ))}
      </div>
    );
  }

  return (
    <div className="table-tab">
      {result.warnings.length > 0 && (
        <section className="panel table-warning-panel">
          <div className="warning-list">
            {result.warnings.map((warning, index) => (
              <p key={index}>! {lang === 'ja' ? warning.messageJa : warning.messageEn}</p>
            ))}
          </div>
        </section>
      )}

      <section className="panel table-section">
        <h2>{t('machinesTable', lang)}</h2>

        <div className="table-wrap">
          <table className="data-table machine-table">
            <thead>
              <tr>
                {machineColumns.map((column) => {
                  const active = machineSort.key === column.key;
                  return (
                    <th key={column.key} aria-sort={active ? (machineSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        className="table-sort-button"
                        onClick={() => setMachineSort(column.key)}
                      >
                        {column.label}{machineSortLabel(active, machineSort.direction)}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {recipeRows.map((row) => {
                const surplus = Object.entries(row.surplusOutputRates)
                  .filter(([, value]) => value > 0)
                  .map(([itemId, value]) => `${itemName(itemId, lang)} +${formatRate(value)}/min`)
                  .join(', ');
                const expansionEntries = expansionByRecipeId.get(row.recipeId) ?? [];
                const isExpandable = expansionEntries.length > 0;
                const isExpanded = expandedRecipeIds.has(row.recipeId);

                return (
                  <Fragment key={row.recipeId}>
                    <tr>
                      <td>
                        <span className="machine-recipe-cell">
                          {isExpandable ? (
                            <button
                              type="button"
                              className="machine-expand-button"
                              aria-expanded={isExpanded}
                              onClick={() => toggleExpandedRecipe(row.recipeId)}
                            >
                              {isExpanded ? '▼' : '▷'}
                            </button>
                          ) : (
                            <span className="machine-expand-spacer" aria-hidden="true" />
                          )}
                          <span>{recipeName(row, lang)}</span>
                        </span>
                      </td>
                      <td>{machineName(row, lang)}</td>
                      <td>{productionSummary(row)}</td>
                      <td>{formatNumber(row.theoreticalMachines, 3)}</td>
                      <td>{formatNumber(row.actualMachines, 3)}</td>
                      <td>{surplus || '-'}</td>
                    </tr>
                    {isExpandable && isExpanded && (
                      <tr key={`${row.recipeId}:expanded`} className="machine-detail-row">
                        <td colSpan={machineColumns.length}>
                          <div className="machine-detail-cell">
                            <table className="machine-detail-table">
                              <thead>
                                <tr>
                                  <th>{finalOutputLabel} / {relatedRecipeLabel}</th>
                                  <th>{actualOutputLabel}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expansionEntries.map((entry) => (
                                  <tr key={entry.kind === 'final' ? `final:${entry.itemId}` : `cycle:${entry.recipeId}`}>
                                    <td className={entry.kind === 'cycle' ? 'machine-detail-cycle' : undefined}>
                                      {entry.kind === 'final' ? itemName(entry.itemId, lang) : recipeNameById(entry.recipeId, lang) + cycleSuffix}
                                    </td>
                                    <td>{entry.kind === 'final' ? `${formatRate(entry.rate)}/min` : '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-section">
        <h2>{t('itemsTable', lang)}</h2>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{lang === 'ja' ? 'アイテム' : 'Item'}</th>
                <th>{t('targetRequested', lang)}</th>
                <th>{t('targetActual', lang)}</th>
                <th>{t('consumed', lang)}</th>
                <th>{t('produced', lang)}</th>
                <th>{t('surplus', lang)}</th>
                <th>{t('purchased', lang)}/min</th>
                <th>{initialPurchasedLabel}</th>
                <th>{runningCostLabel}</th>
                <th>{initialCostLabel}</th>
                <th>{t('revenue', lang)}</th>
              </tr>
            </thead>
            <tbody>
              {itemRows.map((row) => {
                const item = itemById[row.itemId];

                return (
                  <tr key={row.itemId}>
                    <td>{item ? text(item.name, lang) : row.itemId}</td>
                    <td>{formatRate(row.targetRequested)}</td>
                    <td>{formatRate(row.targetActual)}</td>
                    <td>{formatRate(row.consumed)}</td>
                    <td>{formatRate(row.produced)}</td>
                    <td>{formatRate(row.surplus)}</td>
                    <td>{formatRate(row.purchased)}</td>
                    <td>{formatNumber(row.initialPurchased)}</td>
                    <td>{formatCopper(row.purchaseCostCopperPerMin)}</td>
                    <td>{formatCopper(row.initialCostCopper)}</td>
                    <td>{formatCopper(row.revenueCopperPerMin)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel table-section">
        <h2>{t('beltsTable', lang)}</h2>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{lang === 'ja' ? '経路' : 'Route'}</th>
                <th>{t('flow', lang)}</th>
                <th>{lang === 'ja' ? '搬送' : 'Transport'}</th>
              </tr>
            </thead>
            <tbody>
              {result.conveyorEdges.map((edge) => {
                const item = itemById[edge.fromItemId];
                const recipe = recipeById[edge.toRecipeId];

                return (
                  <tr key={edge.id}>
                    <td>
                      {item ? text(item.name, lang) : edge.fromItemId} → {recipe ? text(recipe.name, lang) : edge.toRecipeId}
                    </td>
                    <td>{formatRate(edge.rate)}/min</td>
                    <td>{transportCountLabel(edge, lang)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
