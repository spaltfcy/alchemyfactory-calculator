import type { Lang, MachineTableSortKey, TablePreferences } from '../types';
import type { CalculationResult, ConveyorEdgeStat, RecipeStat } from '../engine/calculate';
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
  align?: 'left' | 'right';
};

function fallbackName(id: string, lang: Lang): string {
  return text({ ja: id, en: id }, lang);
}

function transportCountLabel(edge: ConveyorEdgeStat, lang: Lang): string {
  if (edge.transportKind === 'pipeline') return lang === 'ja' ? 'パイプライン 1本' : 'Pipeline x1';
  return String(edge.transportUnits ?? edge.belts);
}

function recipeName(row: RecipeStat, lang: Lang): string {
  const recipe = recipeById[row.recipeId];
  return recipe ? text(recipe.name, lang) : row.recipeId;
}

function machineName(row: RecipeStat, lang: Lang): string {
  const machine = machineById[row.machineId];
  return machine ? text(machine.name, lang) : row.machineId;
}

function surplusTotal(row: RecipeStat): number {
  return Object.values(row.surplusOutputRates).reduce((sum, value) => sum + Math.max(0, value), 0);
}

function compareText(a: string, b: string, lang: Lang): number {
  return new Intl.Collator(lang === 'ja' ? 'ja' : 'en', { numeric: true, sensitivity: 'base' }).compare(a, b);
}

function compareMachineRows(a: RecipeStat, b: RecipeStat, key: MachineTableSortKey, lang: Lang): number {
  if (key === 'recipe') return compareText(recipeName(a, lang), recipeName(b, lang), lang);
  if (key === 'machine') return compareText(machineName(a, lang), machineName(b, lang), lang);
  if (key === 'theoreticalMachines') return a.theoreticalMachines - b.theoreticalMachines;
  if (key === 'actualMachines') return a.actualMachines - b.actualMachines;
  return surplusTotal(a) - surplusTotal(b);
}

function machineSortLabel(active: boolean, direction: TablePreferences['machineSort']['direction']): string {
  if (!active) return '';
  return direction === 'asc' ? ' ▲' : ' ▼';
}

export function TableTab({ lang, result, tablePreferences, onTablePreferencesChange }: TableTabProps) {
  const machineSort = tablePreferences.machineSort;
  const machineColumns: MachineTableColumn[] = [
    { key: 'recipe', label: t('recipe', lang) },
    { key: 'machine', label: lang === 'ja' ? '設備' : 'Machine' },
    { key: 'theoreticalMachines', label: lang === 'ja' ? '理論台数' : 'Theoretical', align: 'right' },
    { key: 'actualMachines', label: lang === 'ja' ? '実台数' : 'Actual', align: 'right' },
    { key: 'surplus', label: t('surplus', lang) },
  ];

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

  function initialMachineSortDirection(key: MachineTableSortKey): TablePreferences['machineSort']['direction'] {
    return key === 'theoreticalMachines' || key === 'actualMachines' || key === 'surplus' ? 'desc' : 'asc';
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
          <table className="data-table">
            <thead>
              <tr>
                {machineColumns.map((column) => {
                  const active = machineSort.key === column.key;
                  return (
                    <th key={column.key} aria-sort={active ? (machineSort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <button
                        type="button"
                        className={column.align === 'right' ? 'table-sort-button table-sort-button-right' : 'table-sort-button'}
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
                  .map(([itemId, value]) => {
                    const item = itemById[itemId];
                    return `${item ? text(item.name, lang) : fallbackName(itemId, lang)} +${formatRate(value)}/min`;
                  })
                  .join(', ');

                return (
                  <tr key={row.recipeId}>
                    <td>{recipeName(row, lang)}</td>
                    <td>{machineName(row, lang)}</td>
                    <td>{formatNumber(row.theoreticalMachines, 3)}</td>
                    <td>{formatNumber(row.actualMachines, 3)}</td>
                    <td>{surplus || '-'}</td>
                  </tr>
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
