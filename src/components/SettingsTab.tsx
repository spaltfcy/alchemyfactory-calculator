// @ts-nocheck
  import type { AppSettings, AppState, Lang, SurplusPolicy } from '../types';
  import { ABILITY_IDS } from '../data/abilityTables';
  import { ITEMS } from '../data/items';
  import { DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing } from '../data/recipes';
  import { t, text } from '../i18n';
  import { clearState, downloadJson } from '../utils/storage';
  
  export type SettingsTabProps = {
    state: AppState;
    setState: (next: AppState) => void;
  };
  
  const abilityLabels: Record<string, { ja: string; en: string }> = {
    logisticsEfficiency: { ja: '物流効率', en: 'Logistics Efficiency' },
    throwingEfficiency: { ja: '投擲効率', en: 'Throwing Efficiency' },
    factoryEfficiency: { ja: '工場効率', en: 'Factory Efficiency' },
    alchemySkill: { ja: '錬金スキル', en: 'Alchemy Skill' },
    fuelEfficiency: { ja: '燃料効率', en: 'Fuel Efficiency' },
    fertilizerEfficiency: { ja: '肥料効率', en: 'Fertilizer Efficiency' },
    salesAbility: { ja: '販売能力', en: 'Sales Ability' },
    negotiationSkill: { ja: '交渉スキル', en: 'Negotiation Skill' },
    customerManagement: { ja: '顧客管理', en: 'Customer Management' },
    relicKnowledge: { ja: '遺物知識', en: 'Relic Knowledge' },
  };
  
  function getDefaultRecipeId(itemId: string): string {
    return DEFAULT_RECIPE_BY_ITEM_ID[itemId] ?? getRecipesProducing(itemId)[0]?.id ?? '';
  }
  
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
  
    const recipeItems = ITEMS.filter((item) => getRecipesProducing(item.id).length > 1);
  
    return (
      <div className="settings-page-v0112">
        <section className="panel recipe-settings-v0112">
          <h2>{lang === 'ja' ? 'レシピ設定' : 'Recipe settings'}</h2>
  
          <div className="recipe-settings-list-v0112">
            {recipeItems.map((item) => {
              const recipes = getRecipesProducing(item.id);
              return (
                <div className="recipe-setting-row-v0112" key={item.id}>
                  <div className="settings-label-v0112">{text(item.name, lang)}</div>
                  <select
                    value={state.recipePreferences[item.id] ?? getDefaultRecipeId(item.id)}
                    onChange={(e) => {
                      const next = { ...state.recipePreferences };
                      next[item.id] = e.target.value;
                      setState({ ...state, recipePreferences: next });
                    }}
                  >
                    {recipes.map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>
                        {text(recipe.name, lang)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </section>
  
        <div className="settings-main-v0112">
          <section className="panel settings-calc-display-v0112">
            <h2>{lang === 'ja' ? '計算・表示' : 'Calculation / Display'}</h2>
  
            <div className="settings-calc-display-grid-v0112">
              <div className="settings-field-v0112">
                <div className="settings-label-v0112">{t('machineRounding', lang)}</div>
                <select value={state.settings.machineRounding} onChange={(e) => patchSettings({ machineRounding: e.target.value as AppSettings['machineRounding'] })}>
                  <option value="none">{t('roundingNone', lang)}</option>
                  <option value="intermediate">{t('roundingIntermediate', lang)}</option>
                  <option value="all">{t('roundingAll', lang)}</option>
                </select>
              </div>
  
              <div className="settings-field-v0112">
                <div className="settings-label-v0112">{t('defaultSurplusPolicy', lang)}</div>
                <select value={state.settings.defaultSurplusPolicy} onChange={(e) => patchSettings({ defaultSurplusPolicy: e.target.value as SurplusPolicy })}>
                  <option value="reuse">{t('reuse', lang)}</option>
                  <option value="discard">{t('discard', lang)}</option>
                </select>
              </div>
  
              <div className="settings-field-v0112">
                <div className="settings-label-v0112">{lang === 'ja' ? 'グラフ詳細度' : 'Graph detail'}</div>
                <select value={state.settings.graphDetailLevel} onChange={(e) => patchSettings({ graphDetailLevel: e.target.value as AppSettings['graphDetailLevel'] })}>
                  <option value="simple">{t('simple', lang)}</option>
                  <option value="normal">{t('normal', lang)}</option>
                  <option value="detailed">{t('detailed', lang)}</option>
                </select>
              </div>
  
              <label className="checkbox-row settings-checkbox-v0112">
                <input type="checkbox" checked={state.settings.showSurplus} onChange={(e) => patchSettings({ showSurplus: e.target.checked })} />
                {lang === 'ja' ? '余剰ノードを表示' : 'Show surplus nodes'}
              </label>
            </div>
          </section>
  
          <section className="panel settings-data-v0112">
            <h2>{t('data', lang)}</h2>
            <div className="settings-fields-v0112">
              <button onClick={() => downloadJson('alchemy-factory-planner-save.json', state)}>
                {t('exportJson', lang)}
              </button>
  
              <div className="settings-field-v0112">
                <div className="settings-label-v0112">{t('importJson', lang)}</div>
                <input type="file" accept="application/json" onChange={(e) => void importJson(e.currentTarget.files?.[0])} />
              </div>
  
              <button
                className="danger"
                onClick={() => {
                  clearState();
                  location.reload();
                }}
              >
                {t('reset', lang)}
              </button>
            </div>
          </section>
  
          <section className="panel settings-abilities-v0112">
            <h2>{t('abilities', lang)}</h2>
            <div className="ability-grid-v0112">
              {ABILITY_IDS.map((id) => (
                <div className="ability-row-v0112" key={id}>
                  <div className="settings-label-v0112">{abilityLabels[id][lang]}</div>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={state.abilities[id]}
                    onChange={(e) => setState({ ...state, abilities: { ...state.abilities, [id]: Number(e.target.value) } })}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }
  