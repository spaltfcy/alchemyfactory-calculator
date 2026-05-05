import type { ChangeEvent } from 'react';
import type { Lang, ProductionTarget } from '../types';
import { ITEMS, itemById } from '../data/items';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing, recipeById } from '../data/recipes';
import { getItemSortNameJa, validateItemSortNames } from '../data/itemSortNames';
import { t, text } from '../i18n';

export type TargetEditorProps = {
  lang: Lang;
  targets: ProductionTarget[];
  onChange: (targets: ProductionTarget[]) => void;
};

validateItemSortNames(ITEMS);

function sortItemIdsByDisplayName(itemIds: string[], lang: Lang): string[] {
  const collator = new Intl.Collator(lang === 'ja' ? 'ja' : 'en', { numeric: true, sensitivity: 'base' });

  return [...itemIds].sort((a, b) => {
    const itemA = itemById[a];
    const itemB = itemById[b];

    if (lang === 'ja') {
      const kanaCompare = collator.compare(getItemSortNameJa(a), getItemSortNameJa(b));
      if (kanaCompare !== 0) return kanaCompare;
    }

    return collator.compare(text(itemA.name, lang), text(itemB.name, lang));
  });
}

function getSelectableOutputItems(lang: Lang): string[] {
  const seen = new Set<string>();

  for (const recipe of Object.values(recipeById)) {
    for (const output of recipe.outputs) {
      if (!itemById[output.itemId]) continue;
      if (getRecipesProducing(output.itemId).length <= 0) continue;
      seen.add(output.itemId);
    }
  }

  return sortItemIdsByDisplayName([...seen], lang);
}

function getDefaultRecipeId(itemId: string): string {
  return DEFAULT_RECIPE_BY_ITEM_ID[itemId] ?? getRecipesProducing(itemId)[0]?.id ?? '';
}

function makeTarget(lang: Lang): ProductionTarget {
  const selectable = getSelectableOutputItems(lang);
  const outputItemId = selectable[0] ?? ITEMS[0]?.id ?? '';

  return {
    id: 'target-' + crypto.randomUUID(),
    recipeId: getDefaultRecipeId(outputItemId),
    outputItemId,
    mode: 'rate',
    value: 30,
  };
}

export function TargetEditor({ lang, targets, onChange }: TargetEditorProps) {
  const selectableItems = getSelectableOutputItems(lang);

  function updateTarget(id: string, patch: Partial<ProductionTarget>) {
    onChange(
      targets.map((target) => {
        if (target.id !== id) return target;

        const next = { ...target, ...patch };
        if (patch.outputItemId) next.recipeId = getDefaultRecipeId(patch.outputItemId);

        return next;
      }),
    );
  }

  return (
    <section className="panel target-editor">
      <div className="target-editor-header">
        <h2>{t('targets', lang)}</h2>
        <button type="button" onClick={() => onChange([...targets, makeTarget(lang)])}>
          {t('addTarget', lang)}
        </button>
      </div>

      <div className="target-list">
        {targets.map((target) => (
          <div key={target.id} className="target-card">
            <button
              type="button"
              className="target-remove"
              aria-label={t('remove', lang)}
              title={t('remove', lang)}
              onClick={() => onChange(targets.filter((x) => x.id !== target.id))}
            >
              ×
            </button>

            <label className="target-field target-item-field">
              {lang === 'ja' ? 'アイテム' : 'Item'}
              <select
                id={`target-item-${target.id}`}
                name={`target-item-${target.id}`}
                value={target.outputItemId}
                autoComplete="off"
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  updateTarget(target.id, { outputItemId: event.target.value })
                }
              >
                {selectableItems.map((itemId) => (
                  <option key={itemId} value={itemId}>
                    {text(itemById[itemId].name, lang)}
                  </option>
                ))}
              </select>
            </label>

            <label className="target-field target-value-field">
              {lang === 'ja' ? '出力' : 'Output'}
              <input
                id={`target-value-${target.id}`}
                name={`target-value-${target.id}`}
                type="number"
                min={0}
                step={1}
                value={target.value}
                autoComplete="off"
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateTarget(target.id, { value: Number(event.target.value) })
                }
              />
            </label>

            <label className="target-field target-mode-field">
              {t('mode', lang)}
              <select
                id={`target-mode-${target.id}`}
                name={`target-mode-${target.id}`}
                value={target.mode}
                autoComplete="off"
                onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                  updateTarget(target.id, { mode: event.target.value as ProductionTarget['mode'] })
                }
              >
                <option value="rate">{t('rateShort', lang)}</option>
                <option value="machines">{t('machinesShort', lang)}</option>
              </select>
            </label>
          </div>
        ))}
      </div>
    </section>
  );
}
