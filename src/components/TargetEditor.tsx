import type { ItemCategory, Lang, ProductionTarget } from '../types';
import { ITEMS, itemById } from '../data/items';
import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing, recipeById } from '../data/recipes';
import { t, text } from '../i18n';

type SelectableItemGroup = {
  category: ItemCategory;
  items: string[];
};

type TargetEditorProps = {
  lang: Lang;
  targets: ProductionTarget[];
  onChange: (targets: ProductionTarget[]) => void;
};

const CATEGORY_ORDER: ItemCategory[] = ['raw', 'fuel', 'material', 'component', 'herb', 'catalyst', 'currency', 'other'];

const CATEGORY_LABELS: Record<ItemCategory, { ja: string; en: string }> = {
  raw: { ja: '原料', en: 'Raw' },
  fuel: { ja: '燃料', en: 'Fuel' },
  material: { ja: '素材', en: 'Materials' },
  component: { ja: '部品', en: 'Components' },
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
      if (itemById[output.itemId] && getRecipesProducing(output.itemId).length > 0) {
        seen.add(output.itemId);
      }
    }
  }

  return [...seen].sort((a, b) => {
    const ai = itemById[a];
    const bi = itemById[b];
    const categoryDiff = CATEGORY_ORDER.indexOf(ai?.category ?? 'other') - CATEGORY_ORDER.indexOf(bi?.category ?? 'other');

    if (categoryDiff !== 0) return categoryDiff;
    return collator.compare(text(ai.name, lang), text(bi.name, lang));
  });
}

function getSelectableOutputGroups(lang: Lang): SelectableItemGroup[] {
  const groups = new Map<ItemCategory, string[]>();

  for (const itemId of getSelectableOutputItems(lang)) {
    const category = itemById[itemId]?.category ?? 'other';
    const group = groups.get(category) ?? [];
    group.push(itemId);
    groups.set(category, group);
  }

  return CATEGORY_ORDER.map((category) => ({ category, items: groups.get(category) ?? [] })).filter(
    (group) => group.items.length > 0,
  );
}

function getDefaultRecipeId(itemId: string): string {
  return DEFAULT_RECIPE_BY_ITEM_ID[itemId] ?? getRecipesProducing(itemId)[0]?.id ?? '';
}

function createTarget(lang: Lang): ProductionTarget {
  const itemId = getSelectableOutputItems(lang)[0] ?? ITEMS[0]?.id ?? '';

  return {
    id: `target-${crypto.randomUUID()}`,
    recipeId: getDefaultRecipeId(itemId),
    outputItemId: itemId,
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
        <button type="button" onClick={() => onChange([...targets, createTarget(lang)])}>
          {t('addTarget', lang)}
        </button>
      </div>

      <div className="target-list">
        {targets.map((target) => (
          <div key={target.id} className="target-card">
            <label className="target-field target-item-field">
              <span>{lang === 'ja' ? 'アイテム' : 'Item'}</span>
              <select value={target.outputItemId} onChange={(event: { target: { value: string } }) => updateTarget(target.id, { outputItemId: event.target.value })}>
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
              <span>{lang === 'ja' ? '出力' : 'Output'}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={target.value}
                onChange={(event: { target: { value: string } }) => updateTarget(target.id, { value: Number(event.target.value) })}
              />
            </label>

            <label className="target-field target-mode-field">
              <span>{t('mode', lang)}</span>
              <select value={target.mode} onChange={(event: { target: { value: string } }) => updateTarget(target.id, { mode: event.target.value as ProductionTarget['mode'] })}>
                <option value="rate">{t('rateShort', lang)}</option>
                <option value="machines">{t('machinesShort', lang)}</option>
              </select>
            </label>

            <button
              type="button"
              className="target-remove"
              aria-label={t('remove', lang)}
              onClick={() => onChange(targets.filter((candidate) => candidate.id !== target.id))}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
