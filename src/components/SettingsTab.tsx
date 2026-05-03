// @ts-nocheck
import type { AppSettings, AppState, Lang, SurplusPolicy } from '../types';
import { ABILITY_IDS } from '../data/abilityTables';
import { ITEMS, itemById } from '../data/items';
import { RECIPES, getRecipesProducing, recipeById } from '../data/recipes';
import { getByproductKeys } from '../engine/calculate';
import { t, text } from '../i18n';
import { clearState, downloadJson } from '../utils/storage';

export type SettingsTabProps = {
  state: AppState;
  setState: (next: AppState) => void;
};

const abilityLabels: Record<string, { ja: string; en: string }> = {
  logisticsEfficiency: { ja: 'Logistics Efficiency', en: 'Logistics Efficiency' },
  throwingEfficiency: { ja: 'Throwing Efficiency', en: 'Throwing Efficiency' },
  factoryEfficiency: { ja: 'Factory Efficiency', en: 'Factory Efficiency' },
  alchemySkill: { ja: 'Alchemy Skill', en: 'Alchemy Skill' },
  fuelEfficiency: { ja: 'Fuel Efficiency', en: 'Fuel Efficiency' },
  fertilizerEfficiency: { ja: 'Fertilizer Efficiency', en: 'Fertilizer Efficiency' },
  salesAbility: { ja: 'Sales Ability', en: 'Sales Ability' },
  negotiationSkill: { ja: 'Negotiation Skill', en: 'Negotiation Skill' },
  customerManagement: { ja: 'Customer Management', en: 'Customer Management' },
  relicKnowledge: { ja: 'Relic Knowledge', en: 'Relic Knowledge' },
};

function mergeState(current: AppState, imported: Partial<AppState>): AppState {
  return {
    ...current,
    ...imported,
    settings: { ...current.settings, ...imported.settings },
    abilities: { ...current.abilities, ...imported.abilities },
    recipePreferences: { ...current.recipePreferences, ...imported.recipePreferences },
    surplusPolicies: { ...current.surplusPolicies, ...imported.surplusPolicies },
    itemSourceModes: { ...current.itemSourceModes, ...imported.itemSourceModes },
    completedGraphNodeIds: { ...current.completedGraphNodeIds, ...imported.completedGraphNodeIds },
    nodeNotes: { ...current.nodeNotes, ...imported.nodeNotes },
  };
}

export function SettingsTab({ state, setState }: SettingsTabProps) {
  const lang = state.language;

  function patchSettings(patch: Partial<AppSettings>) {
    setState({ ...state, settings: { ...state.settings, ...patch } });
  }

  async function importJson(file: File | undefined) {
    if (!file) return;
    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    setState(mergeState(state, parsed));
  }

  return (
    <div className="settings-tab stack">
      <section className="panel settings-grid">
        <h2>{t('language', lang)}</h2>
        <label>
          {t('language', lang)}
          <select value={state.language} onChange={(e) => setState({ ...state, language: e.target.value as Lang })}>
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </label>
        <label>
          {t('sellMode', lang)}
          <select value={state.settings.sellMode} onChange={(e) => patchSettings({ sellMode: e.target.value as AppSettings['sellMode'] })}>
            <option value="shop">{t('shop', lang)}</option>
            <option value="questRandom">{t('questRandom', lang)}</option>
            <option value="questBulk">{t('questBulk', lang)}</option>
            <option value="questUrgent">{t('questUrgent', lang)}</option>
          </select>
        </label>
      </section>

      <section className="panel settings-grid">
        <h2>{lang === 'ja' ? '計算' : 'Calculation'}</h2>
        <label>
          {t('machineRounding', lang)}
          <select value={state.settings.machineRounding} onChange={(e) => patchSettings({ machineRounding: e.target.value as AppSettings['machineRounding'] })}>
            <option value="none">{t('roundingNone', lang)}</option>
            <option value="intermediate">{t('roundingIntermediate', lang)}</option>
            <option value="all">{t('roundingAll', lang)}</option>
          </select>
        </label>
        <label>
          {t('defaultSurplusPolicy', lang)}
          <select value={state.settings.defaultSurplusPolicy} onChange={(e) => patchSettings({ defaultSurplusPolicy: e.target.value as SurplusPolicy })}>
            <option value="reuse">{t('reuse', lang)}</option>
            <option value="discard">{t('discard', lang)}</option>
          </select>
        </label>
      </section>

      <section className="panel settings-grid">
        <h2>{t('display', lang)}</h2>
        <label>
          {lang === 'ja' ? 'グラフ詳細度' : 'Graph detail'}
          <select value={state.settings.graphDetailLevel} onChange={(e) => patchSettings({ graphDetailLevel: e.target.value as AppSettings['graphDetailLevel'] })}>
            <option value="simple">{t('simple', lang)}</option>
            <option value="normal">{t('normal', lang)}</option>
            <option value="detailed">{t('detailed', lang)}</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={state.settings.showSurplus} onChange={(e) => patchSettings({ showSurplus: e.target.checked })} />
          {lang === 'ja' ? '余剰を表示' : 'Show surplus'}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={state.settings.showDiscardedByproducts} onChange={(e) => patchSettings({ showDiscardedByproducts: e.target.checked })} />
          {lang === 'ja' ? '破棄副産物を表示' : 'Show discarded byproducts'}
        </label>
      </section>

      <section className="panel">
        <h2>{t('abilities', lang)}</h2>
        <div className="ability-grid">
          {ABILITY_IDS.map((id) => (
            <label key={id}>
              {abilityLabels[id][lang]}
              <input
                type="number"
                min="0"
                step="1"
                value={state.abilities[id]}
                onChange={(e) => setState({ ...state, abilities: { ...state.abilities, [id]: Number(e.target.value) } })}
              />
            </label>
          ))}
        </div>
        <p className="muted">
          {lang === 'ja'
            ? '各レベルの変動値は src/data/abilityTables.ts の配列で調整できます。'
            : 'Per-level values can be edited in src/data/abilityTables.ts.'}
        </p>
      </section>

      <section className="panel">
        <h2>{t('recipePreferences', lang)}</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{lang === 'ja' ? '生成物' : 'Output item'}</th>
                <th>{t('recipe', lang)}</th>
              </tr>
            </thead>
            <tbody>
              {ITEMS.filter((item) => getRecipesProducing(item.id).length > 1).map((item) => {
                const recipes = getRecipesProducing(item.id);
                return (
                  <tr key={item.id}>
                    <td>{text(item.name, lang)}</td>
                    <td>
                      <select
                        value={state.recipePreferences[item.id] ?? ''}
                        onChange={(e) => {
                          const next = { ...state.recipePreferences };
                          if (e.target.value) next[item.id] = e.target.value;
                          else delete next[item.id];
                          setState({ ...state, recipePreferences: next });
                        }}
                      >
                        <option value="">{lang === 'ja' ? 'デフォルト' : 'Default'}</option>
                        {recipes.map((recipe) => (
                          <option key={recipe.id} value={recipe.id}>{text(recipe.name, lang)}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>{t('byproductPolicies', lang)}</h2>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t('recipe', lang)}</th>
                <th>{lang === 'ja' ? '副産物' : 'Byproduct'}</th>
                <th>{lang === 'ja' ? '扱い' : 'Policy'}</th>
              </tr>
            </thead>
            <tbody>
              {getByproductKeys().map(({ key, recipeId, itemId }) => (
                <tr key={key}>
                  <td>{text(recipeById[recipeId].name, lang)}</td>
                  <td>{text(itemById[itemId].name, lang)}</td>
                  <td>
                    <select
                      value={state.surplusPolicies[key] ?? ''}
                      onChange={(e) => {
                        const next = { ...state.surplusPolicies };
                        if (e.target.value) next[key] = e.target.value as SurplusPolicy;
                        else delete next[key];
                        setState({ ...state, surplusPolicies: next });
                      }}
                    >
                      <option value="">{lang === 'ja' ? 'デフォルト' : 'Default'}</option>
                      <option value="reuse">{t('reuse', lang)}</option>
                      <option value="discard">{t('discard', lang)}</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel settings-grid">
        <h2>{t('data', lang)}</h2>
        <button onClick={() => downloadJson('alchemy-factory-planner-save.json', state)}>{t('exportJson', lang)}</button>
        <label className="file-label">
          {t('importJson', lang)}
          <input type="file" accept="application/json" onChange={(e) => void importJson(e.currentTarget.files?.[0])} />
        </label>
        <button
          className="danger"
          onClick={() => {
            clearState();
            location.reload();
          }}
        >
          {t('reset', lang)}
        </button>
      </section>
    </div>
  );
}
