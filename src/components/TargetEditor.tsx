// @ts-nocheck
import type { Lang, ProductionTarget } from '../types';
import { RECIPES, recipeById } from '../data/recipes';
import { itemById } from '../data/items';
import { t, text } from '../i18n';

export type TargetEditorProps = {
  lang: Lang;
  targets: ProductionTarget[];
  onChange: (targets: ProductionTarget[]) => void;
};

function makeTarget(): ProductionTarget {
  const recipe = RECIPES[0];
  return {
    id: `target-${crypto.randomUUID()}`,
    recipeId: recipe.id,
    outputItemId: recipe.primaryOutputId,
    mode: 'rate',
    value: 30,
  };
}

export function TargetEditor({ lang, targets, onChange }: TargetEditorProps) {
  function updateTarget(id: string, patch: Partial<ProductionTarget>) {
    onChange(
      targets.map((target) => {
        if (target.id !== id) return target;
        const next = { ...target, ...patch };
        if (patch.recipeId) {
          const recipe = recipeById[patch.recipeId];
          next.outputItemId = recipe?.primaryOutputId ?? next.outputItemId;
        }
        return next;
      }),
    );
  }

  return (
    <section className="panel target-panel">
      <div className="panel-header">
        <h2>{t('targets', lang)}</h2>
        <button onClick={() => onChange([...targets, makeTarget()])}>{t('addTarget', lang)}</button>
      </div>
      <div className="target-list">
        {targets.map((target) => {
          const recipe = recipeById[target.recipeId] ?? RECIPES[0];
          return (
            <div className="target-row" key={target.id}>
              <label>
                {t('recipe', lang)}
                <select value={target.recipeId} onChange={(e) => updateTarget(target.id, { recipeId: e.target.value })}>
                  {RECIPES.map((r) => (
                    <option key={r.id} value={r.id}>{text(r.name, lang)}</option>
                  ))}
                </select>
              </label>
              <label>
                {t('output', lang)}
                <select value={target.outputItemId} onChange={(e) => updateTarget(target.id, { outputItemId: e.target.value })}>
                  {recipe.outputs.map((output) => (
                    <option key={output.itemId} value={output.itemId}>{text(itemById[output.itemId].name, lang)}</option>
                  ))}
                </select>
              </label>
              <label>
                {t('mode', lang)}
                <select value={target.mode} onChange={(e) => updateTarget(target.id, { mode: e.target.value as ProductionTarget['mode'] })}>
                  <option value="rate">{t('rate', lang)}</option>
                  <option value="machines">{t('machines', lang)}</option>
                </select>
              </label>
              <label>
                {t('value', lang)}
                <input type="number" min="0" step="0.1" value={target.value} onChange={(e) => updateTarget(target.id, { value: Number(e.target.value) })} />
              </label>
              <button className="danger" onClick={() => onChange(targets.filter((x) => x.id !== target.id))}>{t('remove', lang)}</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
