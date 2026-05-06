import { useState, type ChangeEvent, type KeyboardEvent } from 'react';
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
  const collator = new Intl.Collator(lang === 'ja' ? 'ja' : 'en', {
    numeric: true,
    sensitivity: 'base',
  });

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

function moveTarget(targets: ProductionTarget[], index: number, delta: number): ProductionTarget[] {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= targets.length) return targets;
  const next = [...targets];
  const [target] = next.splice(index, 1);
  next.splice(nextIndex, 0, target);
  return next;
}

export function TargetEditor({ lang, targets, onChange }: TargetEditorProps) {
  const selectableItems = getSelectableOutputItems(lang);
  const [bulkValue, setBulkValue] = useState('');
  const [bulkMode, setBulkMode] = useState<ProductionTarget['mode']>('rate');

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

  function applyBulkOutput() {
    const trimmed = bulkValue.trim();
    if (trimmed === '') return;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return;
    onChange(targets.map((target) => ({ ...target, value, mode: bulkMode })));
    setBulkValue('');
  }

  function onBulkKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyBulkOutput();
  }

  const itemLabel = lang === 'ja' ? 'アイテム' : 'Item';
  const outputLabel = lang === 'ja' ? '出力' : 'Output';
  const bulkOutputLabel = lang === 'ja' ? '全出力' : 'All output';
  const moveUpLabel = lang === 'ja' ? '上へ移動' : 'Move up';
  const moveDownLabel = lang === 'ja' ? '下へ移動' : 'Move down';
  const removeLabel = lang === 'ja' ? '削除' : 'Remove';

  return (
    <section className="target-editor panel">
      <div className="target-editor-header">
        <h2>{t('targets', lang)}</h2>
        <div className="target-editor-toolbar">
          <label className="target-bulk-field target-bulk-value">
            <span>{bulkOutputLabel}</span>
            <input
              type="number"
              value={bulkValue}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setBulkValue(event.target.value)}
              onKeyDown={onBulkKeyDown}
              onBlur={applyBulkOutput}
              placeholder=""
            />
          </label>
          <label className="target-bulk-field target-bulk-mode">
            <span>{t('mode', lang)}</span>
            <select
              value={bulkMode}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setBulkMode(event.target.value as ProductionTarget['mode'])
              }
            >
              <option value="rate">{t('rateShort', lang)}</option>
              <option value="machines">{t('machinesShort', lang)}</option>
            </select>
          </label>
          <button type="button" onClick={() => onChange([...targets, makeTarget(lang)])}>
            {t('addTarget', lang)}
          </button>
        </div>
      </div>

      <div className="target-list" aria-label={t('targets', lang)}>
        {targets.map((target, index) => (
          <div className="target-card" key={target.id}>
            <div className="target-card-actions" aria-label={lang === 'ja' ? '並び替えと削除' : 'Sort and remove'}>
              <button
                type="button"
                className="target-order-button"
                disabled={index === 0}
                aria-label={moveUpLabel}
                title={moveUpLabel}
                onClick={() => onChange(moveTarget(targets, index, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                className="target-order-button"
                disabled={index === targets.length - 1}
                aria-label={moveDownLabel}
                title={moveDownLabel}
                onClick={() => onChange(moveTarget(targets, index, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                className="target-remove danger"
                aria-label={removeLabel}
                title={removeLabel}
                onClick={() => onChange(targets.filter((x) => x.id !== target.id))}
              >
                ×
              </button>
            </div>

            <label className="target-field">
              <span>{itemLabel}</span>
              <select
                value={target.outputItemId}
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

            <label className="target-field">
              <span>{outputLabel}</span>
              <input
                type="number"
                value={target.value}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateTarget(target.id, { value: Number(event.target.value) })
                }
              />
            </label>

            <label className="target-field">
              <span>{t('mode', lang)}</span>
              <select
                value={target.mode}
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
