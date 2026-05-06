import type { ChangeEvent } from 'react';
import type { AppSettings, AppState, Lang, Recipe, SurplusPolicy } from '../types';
import { DEFAULT_STATE } from '../defaultState';
import { FUEL_HEAT_VALUE_BY_ITEM_ID, FUEL_ITEM_IDS } from '../data/heat';
import { FERTILIZER_ITEM_IDS, FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID, FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID } from '../data/fertilizer';
import { ITEMS, itemById } from '../data/items';
import { machineById } from '../data/machines';
import { CODEX_RECIPE_ORDER, DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing } from '../data/recipes';
import { t, text } from '../i18n';
import { clearState, downloadJson } from '../utils/storage';

export type SettingsTabProps = {
  state: AppState;
  setState: (next: AppState) => void;
  safeMode?: boolean;
};

const DEFAULT_FUEL_SETTINGS: AppSettings['fuel'] = {
  enabled: true,
  fuelItemId: 'charcoal_powder',
  fuelSourceMode: 'craft',
  crucibleVariant: 'crucible',
  crucibleOverheadHeatPerSec: 0.4,
  otherOverheadHeatPerSec: 1,
  maxIterations: 16,
};

const DEFAULT_FERTILIZER_SETTINGS: AppSettings['fertilizer'] = {
  enabled: true,
  fertilizerItemId: 'basic_fertilizer',
  fertilizerSourceMode: 'craft',
  nurseryNutrientsPerSec: 12,
  maxIterations: 4,
};

function getFertilizerSettings(state: AppState): AppSettings['fertilizer'] {
  return { ...DEFAULT_FERTILIZER_SETTINGS, ...(state.settings.fertilizer ?? {}) };
}

function getFuelSettings(state: AppState): AppSettings['fuel'] {
  return { ...DEFAULT_FUEL_SETTINGS, ...(state.settings.fuel ?? {}) };
}

function padDatePart(value: number): string {
  return String(value).padStart(2, '0');
}

function saveFileTimestamp(date = new Date()): string {
  return (
    String(date.getFullYear()) +
    padDatePart(date.getMonth() + 1) +
    padDatePart(date.getDate()) +
    '-' +
    padDatePart(date.getHours()) +
    padDatePart(date.getMinutes()) +
    padDatePart(date.getSeconds())
  );
}

function getDefaultRecipeId(itemId: string): string {
  return DEFAULT_RECIPE_BY_ITEM_ID[itemId] ?? getSortedRecipesProducing(itemId)[0]?.id ?? '';
}

function recipeOrder(recipe: Recipe): number {
  return CODEX_RECIPE_ORDER[recipe.id] ?? 999999;
}

function getSortedRecipesProducing(itemId: string): Recipe[] {
  return [...getRecipesProducing(itemId)].sort((a, b) => recipeOrder(a) - recipeOrder(b) || a.id.localeCompare(b.id));
}

function recipeItemOrder(itemId: string): number {
  const recipes = getSortedRecipesProducing(itemId);
  return recipes.length ? recipeOrder(recipes[0]) : 999999;
}

function recipeItemName(itemId: string, lang: Lang): string {
  const item = itemById[itemId];
  return item ? text(item.name, lang) : itemId;
}

function joinRecipeItemNames(entries: Array<{ itemId: string }>, lang: Lang): string {
  const separator = lang === 'ja' ? '・' : ', ';
  return entries.map((entry) => recipeItemName(entry.itemId, lang)).join(separator);
}

function isMeteorCrusherRecipe(recipe: Recipe): boolean {
  const idText = recipe.id.toLowerCase();
  const urlText = (recipe.sourceUrl ?? '').toLowerCase();
  const hasMeteorInput = recipe.inputs.some((input) => input.itemId.includes('meteor'));
  const hasManyStoneCrusherOutputs = recipe.machineId === 'stone_crusher' && recipe.outputs.length >= 3;

  return hasMeteorInput || idText.includes('meteor') || urlText.includes('meteor') || hasManyStoneCrusherOutputs;
}

function recipeOutputNames(recipe: Recipe, lang: Lang): string {
  if (isMeteorCrusherRecipe(recipe) && recipe.outputs.length >= 1) {
    return recipeItemName(recipe.outputs[0].itemId, lang) + ' etc.';
  }

  return recipe.outputs.length ? joinRecipeItemNames(recipe.outputs, lang) : text(recipe.name, lang);
}

function recipeOptionLabel(itemId: string, recipe: Recipe, lang: Lang): string {
  const machine = machineById[recipe.machineId];
  const inputNames = recipe.inputs.length ? joinRecipeItemNames(recipe.inputs, lang) : recipeItemName(itemId, lang);
  const machineName = machine ? text(machine.name, lang) : recipe.machineId;
  const outputNames = recipeOutputNames(recipe, lang);

  return `${inputNames} → ${machineName} → ${outputNames}`;
}

function mergeState(current: AppState, imported: Partial<AppState>): AppState {
  return {
    ...current,
    ...imported,
    settings: {
      ...current.settings,
      ...imported.settings,
      fuel: {
        ...getFuelSettings(current),
        ...(imported.settings?.fuel ?? {}),
      },
      fertilizer: { ...getFertilizerSettings(current), ...(imported.settings?.fertilizer ?? {}) },
    },
    abilities: { ...current.abilities, ...imported.abilities },
    recipePreferences: { ...current.recipePreferences, ...imported.recipePreferences },
    surplusPolicies: { ...current.surplusPolicies, ...imported.surplusPolicies },
    itemSourceModes: { ...current.itemSourceModes, ...imported.itemSourceModes },
    completedGraphNodeIds: { ...current.completedGraphNodeIds, ...imported.completedGraphNodeIds },
    nodeNotes: { ...current.nodeNotes, ...imported.nodeNotes },
  };
}

export function SettingsTab({ state, setState, safeMode = false }: SettingsTabProps) {
  const lang = state.language;
  const fuel = getFuelSettings(state);
  const fertilizer = getFertilizerSettings(state);

  function patchSettings(patch: Partial<AppSettings>) {
    setState({ ...state, settings: { ...state.settings, ...patch } });
  }

  function patchFuelSettings(patch: Partial<AppSettings['fuel']>) {
    setState({
      ...state,
      settings: {
        ...state.settings,
        fuel: {
          ...fuel,
          ...patch,
        },
      },
    });
  }

  function patchFertilizerSettings(patch: Partial<AppSettings['fertilizer']>) {
    setState({
      ...state,
      settings: {
        ...state.settings,
        fertilizer: {
          ...fertilizer,
          ...patch,
        },
      },
    });
  }

  async function importJson(file: File | undefined) {
    if (!file) return;
    const raw = await file.text();
    try {
      sessionStorage.setItem('alchemyfactory:last-import-json-name', file.name);
      sessionStorage.setItem('alchemyfactory:last-import-json-text', raw);
    } catch {
      // The imported file name is only used for debug artifact naming.
    }
    const parsed = JSON.parse(raw) as Partial<AppState>;
    setState(mergeState(state, parsed));
  }

  function resetAll() {
    const message =
      lang === 'ja' ? '設定と保存データを初期化します。よろしいですか？' : 'Reset settings and saved data. Are you sure?';

    if (!window.confirm(message)) return;

    if (safeMode) {
      setState({ ...DEFAULT_STATE, language: state.language, activeTab: state.activeTab });
      return;
    }

    clearState();
    location.reload();
  }

  const recipeItems = ITEMS.filter((item) => getRecipesProducing(item.id).length > 1).sort(
    (a, b) => recipeItemOrder(a.id) - recipeItemOrder(b.id) || text(a.name, lang).localeCompare(text(b.name, lang)),
  );

  return (
    <div className="settings-layout">
      <section className="panel settings-panel recipe-settings-panel">
        <h2>{lang === 'ja' ? 'レシピ設定' : 'Recipe settings'}</h2>

        <div className="settings-panel-body">
          <div className="recipe-settings-list">
            {recipeItems.map((item) => {
              const recipes = getSortedRecipesProducing(item.id);
              const value = state.recipePreferences[item.id] ?? getDefaultRecipeId(item.id);

              return (
                <label key={item.id} className="recipe-setting-row">
                  <span className="recipe-setting-item-name">{text(item.name, lang)}</span>
                  <select
                    id={`recipe-preference-${item.id}`}
                    name={`recipe-preference-${item.id}`}
                    value={value}
                    autoComplete="off"
                    onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                      setState({
                        ...state,
                        recipePreferences: {
                          ...state.recipePreferences,
                          [item.id]: event.target.value,
                        },
                      });
                    }}
                  >
                    {recipes.map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipeOptionLabel(item.id, recipe, lang)}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>
        </div>
      </section>

      <div className="settings-side">
        <section className="panel settings-panel calculation-settings-panel">
          <h2>{lang === 'ja' ? '計算・表示' : 'Calculation / Display'}</h2>

          <div className="settings-panel-body">
            <div className="settings-form-grid">
              <label className="form-field">
                <span>{t('machineRounding', lang)}</span>
                <select
                  id="machine-rounding"
                  name="machine-rounding"
                  value={state.settings.machineRounding}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchSettings({ machineRounding: event.target.value as AppSettings['machineRounding'] })
                  }
                >
                  <option value="none">{t('roundingNone', lang)}</option>
                  <option value="intermediate">{t('roundingIntermediate', lang)}</option>
                  <option value="all">{t('roundingAll', lang)}</option>
                </select>
              </label>

<label className="form-field">
 <span>{lang === 'ja' ? '数量丸め' : 'Quantity rounding'}</span>
 <select
  id="quantity-rounding-step"
  name="quantity-rounding-step"
  value={state.settings.quantityRoundingStep ?? '0.01'}
  autoComplete="off"
  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
   patchSettings({ quantityRoundingStep: event.target.value as AppSettings['quantityRoundingStep'] })
  }
 >
  <option value="none">{lang === 'ja' ? 'なし' : 'None'}</option>
  <option value="1">1</option>
  <option value="0.1">0.1</option>
  <option value="0.01">0.01</option>
 </select>
</label>


              <label className="form-field">
                <span>{t('defaultSurplusPolicy', lang)}</span>
                <select
                  id="default-surplus-policy"
                  name="default-surplus-policy"
                  value={state.settings.defaultSurplusPolicy}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchSettings({ defaultSurplusPolicy: event.target.value as SurplusPolicy })
                  }
                >
                  <option value="reuse">{t('reuse', lang)}</option>
                  <option value="discard">{t('discard', lang)}</option>
                </select>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? 'グラフ詳細度' : 'Graph detail'}</span>
                <select
                  id="graph-detail-level"
                  name="graph-detail-level"
                  value={state.settings.graphDetailLevel}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchSettings({ graphDetailLevel: event.target.value as AppSettings['graphDetailLevel'] })
                  }
                >
                  <option value="simple">{t('simple', lang)}</option>
                  <option value="normal">{t('normal', lang)}</option>
                  <option value="detailed">{t('detailed', lang)}</option>
                </select>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '余剰ノード' : 'Surplus nodes'}</span>
                <span className="checkbox-control">
                  <input
                    id="show-surplus"
                    name="show-surplus"
                    type="checkbox"
                    checked={state.settings.showSurplus}
                    autoComplete="off"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => patchSettings({ showSurplus: event.target.checked })}
                  />
                  <span>{lang === 'ja' ? '表示' : 'Show'}</span>
                </span>
              </label>
              <label className="form-field">
                <span>{lang === 'ja' ? '自己循環初期投資' : 'Self-cycle startup'}</span>
                <span className="checkbox-control">
                  <input
                    id="show-initial-investment-lines"
                    name="show-initial-investment-lines"
                    type="checkbox"
                    checked={state.settings.showInitialInvestmentLines ?? true}
                    autoComplete="off"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => patchSettings({ showInitialInvestmentLines: event.target.checked })}
                  />
                  <span>{lang === 'ja' ? '表示' : 'Show'}</span>
                </span>
              </label>


              <div className="form-field">
                <span>{lang === 'ja' ? '初期化' : 'Reset'}</span>
                <button type="button" className="danger" onClick={resetAll}>
                  {lang === 'ja' ? '実行' : 'Run'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="panel settings-panel fuel-settings-panel">
          <h2>{lang === 'ja' ? '燃料' : 'Fuel'}</h2>

          <div className="settings-panel-body">
            <div className="settings-form-grid">
              <label className="form-field">
                <span>{lang === 'ja' ? '燃料計算' : 'Fuel calculation'}</span>
                <span className="checkbox-control">
                  <input
                    id="fuel-enabled"
                    name="fuel-enabled"
                    type="checkbox"
                    checked={fuel.enabled}
                    autoComplete="off"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => patchFuelSettings({ enabled: event.target.checked })}
                  />
                  <span>{lang === 'ja' ? '有効' : 'Enabled'}</span>
                </span>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '使用燃料' : 'Fuel'}</span>
                <select
                  id="fuel-item"
                  name="fuel-item"
                  value={fuel.fuelItemId}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => patchFuelSettings({ fuelItemId: event.target.value })}
                >
                  {FUEL_ITEM_IDS.map((itemId) => (
                    <option key={itemId} value={itemId}>
                      {recipeItemName(itemId, lang)} ({FUEL_HEAT_VALUE_BY_ITEM_ID[itemId]})
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '燃料の扱い' : 'Fuel source'}</span>
                <select
                  id="fuel-source-mode"
                  name="fuel-source-mode"
                  value={fuel.fuelSourceMode}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchFuelSettings({ fuelSourceMode: event.target.value as AppSettings['fuel']['fuelSourceMode'] })
                  }
                >
                  <option value="craft">{lang === 'ja' ? '内部生産' : 'Craft internally'}</option>
                  <option value="buy">{lang === 'ja' ? '購入扱い' : 'Buy'}</option>
                </select>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '坩堝設備' : 'Crucible device'}</span>
                <select
                  id="crucible-variant"
                  name="crucible-variant"
                  value={fuel.crucibleVariant}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchFuelSettings({ crucibleVariant: event.target.value as AppSettings['fuel']['crucibleVariant'] })
                  }
                >
                  <option value="crucible">{lang === 'ja' ? '通常坩堝' : 'Crucible'}</option>
                  <option value="stackable_crucible">{lang === 'ja' ? '積層坩堝' : 'Stackable Crucible'}</option>
                </select>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '坩堝の炉近似' : 'Crucible furnace overhead'}</span>
                <input
                  id="crucible-overhead-heat"
                  name="crucible-overhead-heat"
                  type="number"
                  min={0}
                  step={0.1}
                  value={fuel.crucibleOverheadHeatPerSec}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    patchFuelSettings({ crucibleOverheadHeatPerSec: Number(event.target.value) })
                  }
                />
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? 'その他の炉近似' : 'Other furnace overhead'}</span>
                <input
                  id="other-overhead-heat"
                  name="other-overhead-heat"
                  type="number"
                  min={0}
                  step={0.1}
                  value={fuel.otherOverheadHeatPerSec}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    patchFuelSettings({ otherOverheadHeatPerSec: Number(event.target.value) })
                  }
                />
              </label>
            </div>
          </div>
        </section>

        <section className="panel settings-panel fertilizer-settings-panel">
          <h2>{lang === 'ja' ? '肥料' : 'Fertilizer'}</h2>

          <div className="settings-panel-body">
            <div className="settings-form-grid">
              <label className="form-field">
                <span>{lang === 'ja' ? '肥料計算' : 'Fertilizer calculation'}</span>
                <span className="checkbox-control">
                  <input
                    id="fertilizer-enabled"
                    name="fertilizer-enabled"
                    type="checkbox"
                    checked={fertilizer.enabled}
                    autoComplete="off"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => patchFertilizerSettings({ enabled: event.target.checked })}
                  />
                  <span>{lang === 'ja' ? '有効' : 'Enabled'}</span>
                </span>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '使用肥料' : 'Fertilizer'}</span>
                <select
                  id="fertilizer-item"
                  name="fertilizer-item"
                  value={fertilizer.fertilizerItemId}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => patchFertilizerSettings({ fertilizerItemId: event.target.value })}
                >
                  {FERTILIZER_ITEM_IDS.map((itemId) => (
                    <option key={itemId} value={itemId}>
                      {recipeItemName(itemId, lang)} ({FERTILIZER_NUTRIENT_VALUE_BY_ITEM_ID[itemId]} / {FERTILIZER_NUTRIENTS_PER_SEC_BY_ITEM_ID[itemId]}/s)
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '肥料の扱い' : 'Fertilizer source'}</span>
                <select
                  id="fertilizer-source-mode"
                  name="fertilizer-source-mode"
                  value={fertilizer.fertilizerSourceMode}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchFertilizerSettings({ fertilizerSourceMode: event.target.value as AppSettings['fertilizer']['fertilizerSourceMode'] })
                  }
                >
                  <option value="craft">{lang === 'ja' ? '内部生産' : 'Craft internally'}</option>
                  <option value="buy">{lang === 'ja' ? '購入扱い' : 'Buy'}</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="panel settings-panel data-io-panel">
          <h2>{lang === 'ja' ? 'データ入出力 (JSON)' : 'Data I/O (JSON)'}</h2>

          <div className="settings-panel-body">
            <div className="settings-form-grid">
              <div className="form-field">
                <span>{lang === 'ja' ? '出力' : 'Output'}</span>
                <button type="button" className="data-io-button" onClick={() => downloadJson(`alchemy-factory-calculator-save-${saveFileTimestamp()}.json`, state)}>
                  {lang === 'ja' ? '保存' : 'Save'}
                </button>
              </div>

              <label className="form-field data-io-file-field">
                <span>{lang === 'ja' ? '入力' : 'Input'}</span>
                <span className="file-label data-io-file">
                  <input
                    id="json-file-input"
                    name="json-file-input"
                    type="file"
                    accept="application/json"
                    autoComplete="off"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => void importJson(event.currentTarget.files?.[0])}
                  />
                </span>
              </label>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
