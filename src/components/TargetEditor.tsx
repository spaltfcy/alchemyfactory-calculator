// @ts-nocheck
import type { Lang, ProductionTarget } from '../types';
import { itemById } from '../data/items';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing, recipeById } from '../data/recipes';
import { t, text } from '../i18n';

export type TargetEditorProps = {
  lang: Lang;
  targets: ProductionTarget[];
  onChange: (targets: ProductionTarget[]) => void;
};

function getSelectableOutputItems(lang: Lang) {
  const collator = new Intl.Collator(lang === 'ja' ? 'ja' : 'en');
  return Object.keys(recipeById)
    .flatMap((recipeId) => recipeById[recipeId].outputs.map((output) => output.itemId))
    .filter((itemId, index, array) => array.indexOf(itemId) === index)
    .filter((itemId) => getRecipesProducing(itemId).length > 0)
    .sort((a, b) => collator.compare(text(itemById[a].name, lang), text(itemById[b].name, lang)));
}

function getDefaultRecipeId(itemId: string): string {
  return DEFAULT_RECIPE_BY_ITEM_ID[itemId] ?? getRecipesProducing(itemId)[0]?.id ?? '';
}

function makeTarget(lang: Lang): ProductionTarget {
  const selectable = getSelectableOutputItems(lang);
  const outputItemId = selectable[0] ?? recipeById[Object.keys(recipeById)[0]]?.primaryOutputId;
  return {
    id: `target-${crypto.randomUUID()}`,
    recipeId: getDefaultRecipeId(outputItemId),
    outputItemId,
    mode: 'rate',
    value: 30,
  };
}

export function TargetEditor({ lang, targets, onChange }: TargetEditorProps) {
  const selectableOutputItems = getSelectableOutputItems(lang);

  function updateTarget(id: string, patch: Partial<ProductionTarget>) {
    onChange(
      targets.map((target) => {
        if (target.id !== id) return target;
        const next = { ...target, ...patch };
        if (patch.outputItemId) {
          next.recipeId = getDefaultRecipeId(patch.outputItemId);
        }
        return next;
      }),
    );
  }

  return (
    <section className="panel target-panel">
      <div className="panel-header">
        <h2>{t('targets', lang)}</h2>
        <button onClick={() => onChange([...targets, makeTarget(lang)])}>{t('addTarget', lang)}</button>
      </div>
      <div className="target-list">
        {targets.map((target) => (
          <div className="target-row" key={target.id}>
            <label>
              {t('output', lang)}
              <select value={target.outputItemId} onChange={(e) => updateTarget(target.id, { outputItemId: e.target.value })}>
                {selectableOutputItems.map((itemId) => (
                  <option key={itemId} value={itemId}>{text(itemById[itemId].name, lang)}</option>
                ))}
              </select>
            </label>
            <div className="target-value-row">
              <label>
                {t('value', lang)}
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={target.value}
                  onChange={(e) => updateTarget(target.id, { value: Number(e.target.value) })}
                />
              </label>
              <label>
                {t('mode', lang)}
                <select value={target.mode} onChange={(e) => updateTarget(target.id, { mode: e.target.value as ProductionTarget['mode'] })}>
                  <option value="rate">{t('rateShort', lang)}</option>
                  <option value="machines">{t('machinesShort', lang)}</option>
                </select>
              </label>
            </div>
            <button className="danger" onClick={() => onChange(targets.filter((x) => x.id !== target.id))}>{t('remove', lang)}</button>
          </div>
        ))}
      </div>
    </section>
  );
}
