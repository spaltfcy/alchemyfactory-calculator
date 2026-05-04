// @ts-nocheck
import type { AppSettings, AppState, Lang, Recipe, SurplusPolicy } from '../types';
import { ITEMS, itemById } from '../data/items';
import { machineById } from '../data/machines';
import { FUEL_HEAT_VALUE_BY_ITEM_ID, FUEL_ITEM_IDS } from '../data/heat';
import { CODEX_RECIPE_ORDER, DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing } from '../data/recipes';
import { t, text } from '../i18n';
import { clearState, downloadJson } from '../utils/storage';

export type SettingsTabProps = {
  state: AppState;
  setState: (next: AppState) => void;
};

const DEFAULT_FUEL_SETTINGS = {
  enabled: true,
  fuelItemId: 'charcoal_powder',
  fuelSourceMode: 'craft',
  crucibleVariant: 'crucible',
  crucibleOverheadHeatPerSec: 0.4,
  otherOverheadHeatPerSec: 1,
  maxIterations: 8,
};

function getFuelSettings(state: AppState) {
  return { ...DEFAULT_FUEL_SETTINGS, ...(state.settings.fuel ?? {}) };
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

function recipeOptionLabel(itemId: string, recipe: Recipe, lang: Lang): string {
  const machine = machineById[recipe.machineId];
  const inputNames = recipe.inputs.length ? joinRecipeItemNames(recipe.inputs, lang) : recipeItemName(itemId, lang);
  const machineName = machine ? text(machine.name, lang) : recipe.machineId;
  const outputNames = recipe.outputs.length ? joinRecipeItemNames(recipe.outputs, lang) : recipeItemName(itemId, lang);
  return inputNames + ' → ' + machineName + ' → ' + outputNames;
}

function mergeState(current: AppState, imported: Partial<AppState>): AppState {
  return {
    ...current,
    ...imported,
    settings: {
      ...current.settings,
      ...imported.settings,
      fuel: { ...getFuelSettings(current), ...(imported.settings?.fuel ?? {}) },
    },
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
  const fuel = getFuelSettings(state);

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

  async function importJson(file: File | undefined) {
    if (!file) return;
    const raw = await file.text();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    setState(mergeState(state, parsed));
  }

  const recipeItems = ITEMS.filter((item) => getRecipesProducing(item.id).length > 1).sort(
    (a, b) => recipeItemOrder(a.id) - recipeItemOrder(b.id) || text(a.name, lang).localeCompare(text(b.name, lang)),
  );

  return (
    <div className="settings-layout">
      <section className="panel recipe-settings-panel">
        <h2>{lang === 'ja' ? 'レシピ設定' : 'Recipe settings'}</h2>
        <div className="recipe-settings-list">
          {recipeItems.map((item) => {
            const recipes = getSortedRecipesProducing(item.id);
            const value = state.recipePreferences[item.id] ?? getDefaultRecipeId(item.id);
            return (
              <label key={item.id} className="recipe-setting-row">
                <span className="recipe-setting-item-name">{text(item.name, lang)}</span>
                <select
                  value={value}
                  onChange={(e) => {
                    const next = { ...state.recipePreferences };
                    next[item.id] = e.target.value;
                    setState({ ...state, recipePreferences: next });
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
      </section>

      <div className="settings-side">
        <section className="panel">
          <h2>{lang === 'ja' ? '計算・表示' : 'Calculation / Display'}</h2>
          <div className="settings-grid">
            <label>
              {t('machineRounding', lang)}
              <select
                value={state.settings.machineRounding}
                onChange={(e) => patchSettings({ machineRounding: e.target.value as AppSettings['machineRounding'] })}
              >
                <option value="none">{t('roundingNone', lang)}</option>
                <option value="intermediate">{t('roundingIntermediate', lang)}</option>
                <option value="all">{t('roundingAll', lang)}</option>
              </select>
            </label>
            <label>
              {t('defaultSurplusPolicy', lang)}
              <select
                value={state.settings.defaultSurplusPolicy}
                onChange={(e) => patchSettings({ defaultSurplusPolicy: e.target.value as SurplusPolicy })}
              >
                <option value="reuse">{t('reuse', lang)}</option>
                <option value="discard">{t('discard', lang)}</option>
              </select>
            </label>
            <label>
              {lang === 'ja' ? 'グラフ詳細度' : 'Graph detail'}
              <select
                value={state.settings.graphDetailLevel}
                onChange={(e) => patchSettings({ graphDetailLevel: e.target.value as AppSettings['graphDetailLevel'] })}
              >
                <option value="simple">{t('simple', lang)}</option>
                <option value="normal">{t('normal', lang)}</option>
                <option value="detailed">{t('detailed', lang)}</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={state.settings.showSurplus}
                onChange={(e) => patchSettings({ showSurplus: e.target.checked })}
              />
              {lang === 'ja' ? '余剰ノードを表示' : 'Show surplus nodes'}
            </label>
          </div>
        </section>

        <section className="panel fuel-settings-panel">
          <h2>{lang === 'ja' ? '燃料' : 'Fuel'}</h2>
          <div className="fuel-settings-grid">
            <label className="checkbox-row fuel-checkbox-row">
              <input type="checkbox" checked={fuel.enabled} onChange={(e) => patchFuelSettings({ enabled: e.target.checked })} />
              {lang === 'ja' ? '燃料計算を有効' : 'Enable fuel calculation'}
            </label>
            <label>
              {lang === 'ja' ? '使用燃料' : 'Fuel'}
              <select value={fuel.fuelItemId} onChange={(e) => patchFuelSettings({ fuelItemId: e.target.value })}>
                {FUEL_ITEM_IDS.map((itemId) => (
                  <option key={itemId} value={itemId}>
                    {recipeItemName(itemId, lang)} ({FUEL_HEAT_VALUE_BY_ITEM_ID[itemId]})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {lang === 'ja' ? '燃料の扱い' : 'Fuel source'}
              <select
                value={fuel.fuelSourceMode}
                onChange={(e) => patchFuelSettings({ fuelSourceMode: e.target.value as AppSettings['fuel']['fuelSourceMode'] })}
              >
                <option value="craft">{lang === 'ja' ? '内部生産' : 'Craft internally'}</option>
                <option value="buy">{lang === 'ja' ? '購入扱い' : 'Buy'}</option>
              </select>
            </label>
            <label>
              {lang === 'ja' ? '坩堝設備' : 'Crucible device'}
              <select
                value={fuel.crucibleVariant}
                onChange={(e) => patchFuelSettings({ crucibleVariant: e.target.value as AppSettings['fuel']['crucibleVariant'] })}
              >
                <option value="crucible">{lang === 'ja' ? '通常坩堝' : 'Crucible'}</option>
                <option value="stackable_crucible">{lang === 'ja' ? '積層坩堝' : 'Stackable Crucible'}</option>
              </select>
            </label>
            <label>
              {lang === 'ja' ? '坩堝の炉近似' : 'Crucible furnace overhead'}
              <input
                type="number"
                min={0}
                step={0.1}
                value={fuel.crucibleOverheadHeatPerSec}
                onChange={(e) => patchFuelSettings({ crucibleOverheadHeatPerSec: Number(e.target.value) })}
              />
            </label>
            <label>
              {lang === 'ja' ? 'その他の炉近似' : 'Other furnace overhead'}
              <input
                type="number"
                min={0}
                step={0.1}
                value={fuel.otherOverheadHeatPerSec}
                onChange={(e) => patchFuelSettings({ otherOverheadHeatPerSec: Number(e.target.value) })}
              />
            </label>
          </div>
        </section>

        <section className="panel">
          <h2>{t('data', lang)}</h2>
          <div className="settings-actions">
            <button type="button" onClick={() => downloadJson('alchemy-factory-planner-save.json', state)}>
              {t('exportJson', lang)}
            </button>
            <label className="file-label">
              {t('importJson', lang)}
              <input type="file" accept="application/json" onChange={(e) => void importJson(e.currentTarget.files?.[0])} />
            </label>
            <button
              type="button"
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
      </div>
    </div>
  );
}
