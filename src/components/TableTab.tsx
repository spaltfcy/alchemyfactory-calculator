import type { Lang } from '../types';
import type { CalculationResult, ConveyorEdgeStat } from '../engine/calculate';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { recipeById } from '../data/recipes';
import { t, text } from '../i18n';
import { formatCopper, formatNumber } from '../utils/format';

export type TableTabProps = {
  lang: Lang;
  result: CalculationResult;
};

function fallbackName(id: string, lang: Lang): string {
  return text({ ja: id, en: id }, lang);
}

function transportCountLabel(edge: ConveyorEdgeStat, lang: Lang): string {
  if (edge.transportKind === 'pipeline') return lang === 'ja' ? 'パイプライン 1本' : 'Pipeline x1';
  return String(edge.transportUnits ?? edge.belts);
}

export function TableTab({ lang, result }: TableTabProps) {
  const recipeRows = Object.values(result.recipeStats).sort((a, b) => a.recipeId.localeCompare(b.recipeId));
  const itemRows = Object.values(result.itemStats).sort((a, b) => a.itemId.localeCompare(b.itemId));
  const initialCostLabel = lang === 'ja' ? '初期コスト' : 'Initial cost';
  const runningCostLabel = lang === 'ja' ? 'ランニングコスト/min' : 'Running cost/min';
  const initialPurchasedLabel = lang === 'ja' ? '初期購入' : 'Initial purchase';

  return (
    <div className="table-tab">
      <section className="panel table-summary-panel">
        <div className="table-summary-grid">
          <div>
            <span>{initialCostLabel}</span>
            <strong>{formatCopper(result.totals.initialCostCopper)}</strong>
          </div>
          <div>
            <span>{runningCostLabel}</span>
            <strong>{formatCopper(result.totals.runningCostCopperPerMin)}</strong>
          </div>
          <div>
            <span>{t('revenue', lang)}</span>
            <strong>{formatCopper(result.totals.revenueCopperPerMin)}</strong>
          </div>
          <div>
            <span>{t('profit', lang)}</span>
            <strong>{formatCopper(result.totals.profitCopperPerMin)}</strong>
          </div>
          <div>
            <span>{t('conveyorSpeed', lang)}</span>
            <strong>{formatNumber(result.totals.conveyorItemsPerMinute)}/min</strong>
          </div>
        </div>

        {result.warnings.length > 0 && (
          <div className="warning-list">
            {result.warnings.map((warning, index) => (
              <p key={index}>! {lang === 'ja' ? warning.messageJa : warning.messageEn}</p>
            ))}
          </div>
        )}
      </section>

      <section className="panel table-section">
        <h2>{t('machinesTable', lang)}</h2>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('recipe', lang)}</th>
                <th>{t('machines', lang)}</th>
                <th>{lang === 'ja' ? '理論台数' : 'Theoretical'}</th>
                <th>{lang === 'ja' ? '実台数' : 'Actual'}</th>
                <th>{t('surplus', lang)}</th>
              </tr>
            </thead>
            <tbody>
              {recipeRows.map((row) => {
                const recipe = recipeById[row.recipeId];
                const machine = machineById[row.machineId];
                const surplus = Object.entries(row.surplusOutputRates)
                  .filter(([, value]) => value > 0)
                  .map(([itemId, value]) => {
                    const item = itemById[itemId];
                    return `${item ? text(item.name, lang) : fallbackName(itemId, lang)} +${formatNumber(value)}/min`;
                  })
                  .join(', ');

                return (
                  <tr key={row.recipeId}>
                    <td>{recipe ? text(recipe.name, lang) : row.recipeId}</td>
                    <td>{machine ? text(machine.name, lang) : row.machineId}</td>
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
                    <td>{formatNumber(row.targetRequested)}</td>
                    <td>{formatNumber(row.targetActual)}</td>
                    <td>{formatNumber(row.consumed)}</td>
                    <td>{formatNumber(row.produced)}</td>
                    <td>{formatNumber(row.surplus)}</td>
                    <td>{formatNumber(row.purchased)}</td>
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
                    <td>{formatNumber(edge.rate)}/min</td>
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
