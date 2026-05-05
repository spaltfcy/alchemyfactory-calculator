// @ts-nocheck
import type { ItemCategory, Lang, ProductionTarget } from '../types';
import { ITEMS, itemById } from '../data/items';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing, recipeById } from '../data/recipes';
import { t, text } from '../i18n';

export type TargetEditorProps = {
  lang: Lang;
  targets: ProductionTarget[];
  onChange: (targets: ProductionTarget[]) => void;
};

type SelectableItemGroup = {
  category: ItemCategory;
  items: string[];
};

const CATEGORY_ORDER: ItemCategory[] = ['raw', 'fuel', 'material', 'component', 'herb', 'catalyst', 'currency', 'other'];

const CATEGORY_LABELS: Record<ItemCategory, { ja: string; en: string }> = {
  raw: { ja: '原料', en: 'Raw' },
  fuel: { ja: '燃料', en: 'Fuel' },
  component: { ja: '部品', en: 'Components' },
  material: { ja: '素材', en: 'Materials' },
  herb: { ja: '植物・薬草', en: 'Herbs' },
  catalyst: { ja: '触媒・錬金', en: 'Catalysts' },
  currency: { ja: '通貨', en: 'Currency' },
  other: { ja: 'その他', en: 'Other' },
};

function getSelectableOutputItems(lang: Lang): string[] {
  const collator = new Intl.Collator(lang === 'ja' ? 'ja' : 'en', { numeric: true, sensitivity: 'base' });
  const seen = new Set<string>();

  for (const recipe of Object.values(recipeById)) {
    for (const output of recipe.outputs) {
      if (!itemById[output.itemId]) continue;
      if (getRecipesProducing(output.itemId).length <= 0) continue;
      seen.add(output.itemId);
    }
  }

  return [...seen].sort((a, b) => {
    const ai = itemById[a];
    const bi = itemById[b];
    const ac = CATEGORY_ORDER.indexOf(ai?.category ?? 'other');
    const bc = CATEGORY_ORDER.indexOf(bi?.category ?? 'other');

    if (ac !== bc) return ac - bc;
    return collator.compare(text(ai.name, lang), text(bi.name, lang));
  });
}

function getSelectableOutputGroups(lang: Lang): SelectableItemGroup[] {
  const items = getSelectableOutputItems(lang);
  const groups = new Map<ItemCategory, string[]>();

  for (const itemId of items) {
    const category = itemById[itemId]?.category ?? 'other';
    const group = groups.get(category) ?? [];

    group.push(itemId);
    groups.set(category, group);
  }

  return CATEGORY_ORDER.map((category) => ({ category, items: groups.get(category) ?? [] })).filter((group) => group.items.length > 0);
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
  const selectableGroups = getSelectableOutputGroups(lang);

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
            <label className="target-field target-item-field">
              {lang === 'ja' ? 'アイテム' : 'Item'}
              <select value={target.outputItemId} onChange={(e) => updateTarget(target.id, { outputItemId: e.target.value })}>
                {selectableGroups.map((group) => (
                  <optgroup key={group.category} label={CATEGORY_LABELS[group.category][lang]}>
                    {group.items.map((itemId) => (
                      <option key={itemId} value={itemId}>
                        {text(itemById[itemId].name, lang)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label className="target-field target-value-field">
              {lang === 'ja' ? '出力' : 'Output'}
              <input type="number" min={0} step={1} value={target.value} onChange={(e) => updateTarget(target.id, { value: Number(e.target.value) })} />
            </label>

            <label className="target-field target-mode-field">
              {t('mode', lang)}
              <select value={target.mode} onChange={(e) => updateTarget(target.id, { mode: e.target.value as ProductionTarget['mode'] })}>
                <option value="rate">{t('rateShort', lang)}</option>
                <option value="machines">{t('machinesShort', lang)}</option>
              </select>
            </label>

            <button
              type="button"
              className="target-remove"
              aria-label={t('remove', lang)}
              onClick={() => onChange(targets.filter((x) => x.id !== target.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
