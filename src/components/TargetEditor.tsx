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
        if (patch.outputItemId) next.recipeId = getDefaultRecipeId(patch.outputItemId);
        return next;
      }),
    );
  }

  return (
    <section className="panel" style={{ minWidth: '35.5rem' }}>
      <div className="panel-header">
        <h2>{t('targets', lang)}</h2>
        <button onClick={() => onChange([...targets, makeTarget(lang)])}>{t('addTarget', lang)}</button>
      </div>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {targets.map((target) => (
          <div
            key={target.id}
            style={{
              position: 'relative',
              padding: '0.75rem 2rem 0.75rem 0.75rem',
              border: '1px solid var(--line)',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.02)',
            }}
          >
            <button
              type="button"
              aria-label={t('remove', lang)}
              title={t('remove', lang)}
              onClick={() => onChange(targets.filter((x) => x.id !== target.id))}
              style={{
                position: 'absolute',
                top: '0.28rem',
                right: '0.42rem',
                width: '1.45rem',
                height: '1.45rem',
                padding: 0,
                border: 0,
                background: 'transparent',
                color: 'var(--text)',
                fontSize: '1.45rem',
                lineHeight: 1,
              }}
            >
              ×
            </button>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 13.8rem auto 6.6rem 6.8rem',
                gap: '0.48rem',
                alignItems: 'center',
              }}
            >
              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{lang === 'ja' ? 'アイテム' : 'Item'}</span>

              <select
                value={target.outputItemId}
                onChange={(e) => updateTarget(target.id, { outputItemId: e.target.value })}
                style={{ width: '13.8rem', minWidth: '13.8rem' }}
              >
                {selectableOutputItems.map((itemId) => (
                  <option key={itemId} value={itemId}>
                    {text(itemById[itemId].name, lang)}
                  </option>
                ))}
              </select>

              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{lang === 'ja' ? '出力' : 'Output'}</span>

              <input
                type="number"
                min="0"
                step="0.1"
                value={target.value}
                onChange={(e) => updateTarget(target.id, { value: Number(e.target.value) })}
                style={{ width: '6.6rem', minWidth: '6.6rem' }}
              />

              <select
                value={target.mode}
                onChange={(e) => updateTarget(target.id, { mode: e.target.value as ProductionTarget['mode'] })}
                style={{ width: '6.8rem', minWidth: '6.8rem' }}
              >
                <option value="rate">{t('rateShort', lang)}</option>
                <option value="machines">{t('machinesShort', lang)}</option>
              </select>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
