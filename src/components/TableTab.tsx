import { Fragment, useMemo, useState, type ReactNode } from 'react';
import type { Lang, MachineDetailTableSortKey, MachineTableSortKey, SortDirection, TablePreferences } from '../types';
import type { CalculationResult, ConveyorEdgeStat } from '../engine/calculate';
import { itemById } from '../data/items';
import { recipeById } from '../data/recipes';
import { t, text } from '../i18n';
import { formatCopper, formatNumber, formatRate } from '../utils/format';
import { buildTableViewModel, type MachineDetailGroup, type MachineDetailRow, type MachineMainRow, type TableProductionOutput } from '../engine/tableViewModel';

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

type MachineDetailTableColumn = {
  key: MachineDetailTableSortKey;
  label: string;
};

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

function sortLabel(active: boolean, direction: SortDirection): string {
  if (!active) return '';
  return direction === 'asc' ? ' ▲' : ' ▼';
}

function initialMachineSortDirection(key: MachineTableSortKey): SortDirection {
  return key === 'productionRate' || key === 'theoreticalMachines' || key === 'actualMachines' || key === 'surplus' ? 'desc' : 'asc';
}

function initialMachineDetailSortDirection(key: MachineDetailTableSortKey): SortDirection {
  return key === 'usageRate' || key === 'productionRate' || key === 'theoreticalMachines' || key === 'actualMachines' ? 'desc' : 'asc';
}

function productionSummary(outputs: TableProductionOutput[], lang: Lang): ReactNode {
  if (outputs.length === 0) return <>-</>;
  if (outputs.length === 1) return <>{formatRate(outputs[0].rate)}/min</>;
  return (
    <div className="machine-production-list">
      {outputs.map((output) => (
        <div key={output.itemId}>{lang === 'ja' ? output.itemNameJa : output.itemNameEn} {formatRate(output.rate)}/min</div>
      ))}
    </div>
  );
}

function surplusSummary(row: MachineMainRow, lang: Lang): ReactNode {
  if (row.surplusOutputs.length === 0) return <>-</>;
  return row.surplusOutputs
    .map((output) => `${lang === 'ja' ? output.itemNameJa : output.itemNameEn} +${formatRate(output.rate)}/min`)
    .join(', ');
}

function usageLabel(row: MachineDetailRow): string {
  return `${formatRate(row.usageRate)}/min (${formatNumber(row.usagePercent, 1)}%)`;
}

function optionalRate(value: number | undefined): string {
  return Number.isFinite(value) ? `${formatRate(Number(value))}/min` : '-';
}

function optionalNumber(value: number | undefined): string {
  return Number.isFinite(value) ? formatNumber(Number(value), 3) : '-';
}

function detailRowClass(row: MachineDetailRow): string | undefined {
  if (row.kind === 'cycle') return 'machine-detail-cycle';
  if (row.kind === 'surplus') return 'machine-detail-surplus';
  if (row.kind === 'discard') return 'machine-detail-discard';
  if (row.kind === 'unallocated' || row.kind === 'overallocated') return 'machine-detail-error';
  return undefined;
}

function detailGroupHeading(group: MachineDetailGroup, lang: Lang): string {
  const sourceName = lang === 'ja' ? group.sourceItemNameJa : group.sourceItemNameEn;
  const allocation = group.allocationSummary;
  const balanceMark = allocation.allocationBalanced ? '' : (lang === 'ja' ? ' / 配賦エラー' : ' / allocation error');
  return `${lang === 'ja' ? '対象' : 'Source'}: ${sourceName} ${formatRate(group.sourceOutputRate)}/min${balanceMark}`;
}

export function TableTab({ lang, result, tablePreferences, onTablePreferencesChange }: TableTabProps) {
  const [expandedRecipeIds, setExpandedRecipeIds] = useState<Set<string>>(() => new Set());
  const tableView = useMemo(() => buildTableViewModel(result, tablePreferences, lang), [result, tablePreferences, lang]);
  const machineSort = tablePreferences.machineSort;
  const machineDetailSort = tablePreferences.machineDetailSort;
  const machineColumns: MachineTableColumn[] = [
    { key: 'recipe', label: t('recipe', lang) },
    { key: 'machine', label: lang === 'ja' ? '設備' : 'Machine' },
    { key: 'productionRate', label: lang === 'ja' ? '生産量' : 'Production' },
    { key: 'theoreticalMachines', label: lang === 'ja' ? '理論台数' : 'Theoretical' },
    { key: 'actualMachines', label: lang === 'ja' ? '実台数' : 'Actual' },
    { key: 'surplus', label: t('surplus', lang) },
  ];
  const detailColumns: MachineDetailTableColumn[] = [
    { key: 'label', label: lang === 'ja' ? 'レシピ/出力先' : 'Recipe/output' },
    { key: 'usageRate', label: lang === 'ja' ? '使用量' : 'Usage' },
    { key: 'productionRate', label: lang === 'ja' ? '生産量' : 'Production' },
    { key: 'theoreticalMachines', label: lang === 'ja' ? '理論台数' : 'Theoretical' },
    { key: 'actualMachines', label: lang === 'ja' ? '実台数' : 'Actual' },
  ];

  const itemRows = Object.values(result.itemStats).sort((a, b) => a.itemId.localeCompare(b.itemId));
  const initialCostLabel = lang === 'ja' ? '初期コスト' : 'Initial cost';
  const runningCostLabel = lang === 'ja' ? 'ランニングコスト/min' : 'Running cost/min';
  const initialPurchasedLabel = lang === 'ja' ? '初期購入' : 'Initial purchase';

  function setMachineSort(key: MachineTableSortKey): void {
    const direction = machineSort.key === key
      ? (machineSort.direction === 'asc' ? 'desc' : 'asc')
      : initialMachineSortDirection(key);
    onTablePreferencesChange({
      ...tablePreferences,
      machineSort: { key, direction },
    });
  }

  function setMachineDetailSort(key: MachineDetailTableSortKey): void {
    const direction = machineDetailSort.key === key
      ? (machineDetailSort.direction === 'asc' ? 'desc' : 'asc')
      : initialMachineDetailSortDirection(key);
    onTablePreferencesChange({
      ...tablePreferences,
      machineDetailSort: { key, direction },
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
                        {column.label}{sortLabel(active, machineSort.direction)}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {tableView.mainRows.map((row) => {
                const detailGroups = tableView.detailGroupsByRecipeId[row.recipeId] ?? [];
                const isExpandable = detailGroups.some((group) => group.rows.length > 0);
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
                          <span>{lang === 'ja' ? row.recipeNameJa : row.recipeNameEn}</span>
                        </span>
                      </td>
                      <td>{lang === 'ja' ? row.machineNameJa : row.machineNameEn}</td>
                      <td>{productionSummary(row.productionOutputs, lang)}</td>
                      <td>{formatNumber(row.theoreticalMachines, 3)}</td>
                      <td>{formatNumber(row.actualMachines, 3)}</td>
                      <td>{surplusSummary(row, lang)}</td>
                    </tr>
                    {isExpandable && isExpanded && (
                      <tr key={`${row.recipeId}:expanded`} className="machine-detail-row">
                        <td colSpan={machineColumns.length}>
                          <div className="machine-detail-cell">
                            {detailGroups.map((group) => (
                              <div className="machine-detail-group" key={`${row.recipeId}:${group.sourceItemId}`}>
                                {detailGroups.length > 1 && (
                                  <div className={group.allocationSummary.allocationBalanced ? 'machine-detail-source-heading' : 'machine-detail-source-heading machine-detail-source-heading-error'}>
                                    {detailGroupHeading(group, lang)}
                                  </div>
                                )}
                                <table className="machine-detail-table">
                                  <thead>
                                    <tr>
                                      {detailColumns.map((column) => {
                                        const active = machineDetailSort.key === column.key;
                                        return (
                                          <th key={column.key} aria-sort={active ? (machineDetailSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                                            <button
                                              type="button"
                                              className="table-sort-button"
                                              onClick={() => setMachineDetailSort(column.key)}
                                            >
                                              {column.label}{sortLabel(active, machineDetailSort.direction)}
                                            </button>
                                          </th>
                                        );
                                      })}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {group.rows.map((detailRow) => (
                                      <tr key={detailRow.id}>
                                        <td className={detailRowClass(detailRow)}>{lang === 'ja' ? detailRow.labelJa : detailRow.labelEn}</td>
                                        <td className="machine-detail-usage">{usageLabel(detailRow)}</td>
                                        <td>{optionalRate(detailRow.productionRate)}</td>
                                        <td>{optionalNumber(detailRow.theoreticalMachines)}</td>
                                        <td>{optionalNumber(detailRow.actualMachines)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
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
