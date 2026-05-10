import { useState, type ChangeEvent } from 'react';
import type { AppSettings, AppState, ItemRecipeInput, Lang, MachinePreferences, ParadoxSettings, Recipe, RecipeInput, SurplusPolicy } from '../types';
import { DEFAULT_STATE } from '../defaultState';
import { ITEMS, fuelItemIds, fertilizerItemIds, itemById } from '../data/items';
import { machineById } from '../data/machines';
import { RECIPE_ORDER, DEFAULT_RECIPE_BY_ITEM_ID, getRecipesProducing } from '../data/recipes';
import { t, text } from '../i18n';
import { sanitizeNegativeTargets, buildNegativeTargetWarningInput, filterPositiveTargets } from '../engine/targetValidation';
import { createMessageRunId, verificationErrorMessage, withMessageRun, type UserMessageInput } from '../utils/userMessages';
import { clearState, downloadJson } from '../utils/storage';
import { calculateWithDebug, type CalculateInput } from '../engine/calculate';
import { DEFAULT_MACHINE_PREFERENCES, getMachinePreferences } from '../data/machinePreferences';
import { DEFAULT_PARADOX_SETTINGS, getParadoxSettings, isParadoxableItem, paradoxableItemIds } from '../data/paradox';
import { getEffectiveRecipeForCalculation, isItemRecipeInput } from '../data/effectiveRecipes';
import { normalizeAbilitySettings } from '../data/abilityTables';

export type SettingsTabProps = {
  state: AppState;
  setState: (next: AppState) => void;
  safeMode?: boolean;
  onBeginJsonImport?: () => void;
  onUserMessage?: (message: UserMessageInput) => void;
  appVersion: string;
  gameVersion: string;
};

const DEFAULT_FUEL_SETTINGS: AppSettings['fuel'] = {
  enabled: true,
  fuelItemId: 'charcoal_powder',
  sourceMode: 'internal',
  heatingMode: 'direct',
  maxIterations: 16,
};

const DEFAULT_FERTILIZER_SETTINGS: AppSettings['fertilizer'] = {
  enabled: true,
  fertilizerItemId: 'basic_fertilizer',
  sourceMode: 'internal',
  maxIterations: 4,
};

function getFertilizerSettings(state: AppState): AppSettings['fertilizer'] {
  return { ...DEFAULT_FERTILIZER_SETTINGS, ...(state.settings.fertilizer ?? {}) };
}

function getFuelSettings(state: AppState): AppSettings['fuel'] {
  return { ...DEFAULT_FUEL_SETTINGS, ...(state.settings.fuel ?? {}) };
}

function getMachinePreferenceSettings(state: AppState): MachinePreferences {
  return { ...DEFAULT_MACHINE_PREFERENCES, ...(state.settings.machinePreferences ?? {}) };
}

function getParadoxSettingValues(state: AppState): ParadoxSettings {
  return { ...DEFAULT_PARADOX_SETTINGS, ...(state.settings.paradox ?? {}) };
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
  return RECIPE_ORDER[recipe.id] ?? 999999;
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

function recipeInputItemName(input: RecipeInput, lang: Lang, state: AppState): string {
  if (isItemRecipeInput(input)) return recipeItemName(input.itemId, lang);
  return recipeItemName(getParadoxSettingValues(state).oblivionInputItemId, lang);
}

function joinRecipeInputNames(entries: RecipeInput[], lang: Lang, state: AppState): string {
  const separator = lang === 'ja' ? '・' : ', ';
  return entries.map((entry) => recipeInputItemName(entry, lang, state)).join(separator);
}

function isMeteorCrusherRecipe(recipe: Recipe): boolean {
  const idText = recipe.id.toLowerCase();
  const hasMeteorInput = recipe.inputs.some((input) => isItemRecipeInput(input) && input.itemId.includes('meteor'));
  const hasManyStoneCrusherOutputs = recipe.machineId === 'stone_crusher' && recipe.outputs.length >= 3;

  return hasMeteorInput || idText.includes('meteor') || hasManyStoneCrusherOutputs;
}

function recipeOutputNames(recipe: Recipe, lang: Lang): string {
  if (isMeteorCrusherRecipe(recipe) && recipe.outputs.length >= 1) {
    return recipeItemName(recipe.outputs[0].itemId, lang) + ' etc.';
  }

  return recipe.outputs.length ? joinRecipeItemNames(recipe.outputs, lang) : text(recipe.name, lang);
}

function recipeOptionLabel(itemId: string, recipe: Recipe, lang: Lang, state: AppState): string {
  const effectiveRecipe = getEffectiveRecipeForCalculation(recipe, state.settings);
  const machine = machineById[effectiveRecipe.machineId] ?? machineById[recipe.machineId];
  const inputNames = recipe.inputs.length ? joinRecipeInputNames(recipe.inputs, lang, state) : recipeItemName(itemId, lang);
  const machineName = machine ? text(machine.name, lang) : effectiveRecipe.machineId;
  const outputNames = recipeOutputNames(recipe, lang);

  return `${inputNames} → ${machineName} → ${outputNames}`;
}


function formatParadoxTime(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value < 0.01) return value.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
  if (value < 10) return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  if (value < 100) return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return value.toFixed(1).replace(/0+$/, '').replace(/\.$/, '');
}

function mergeState(current: AppState, imported: Partial<AppState>): AppState {
  return {
    ...current,
    ...imported,
    // Imported settings may contain an activeTab, but importing must not navigate.
    activeTab: current.activeTab,
    settings: {
      ...current.settings,
      ...imported.settings,
      machinePreferences: {
        ...getMachinePreferences(current.settings),
        ...(imported.settings?.machinePreferences ?? {}),
      },
      paradox: getParadoxSettings(imported.settings),
      fuel: {
        ...getFuelSettings(current),
        ...(imported.settings?.fuel ?? {}),
      },
      fertilizer: { ...getFertilizerSettings(current), ...(imported.settings?.fertilizer ?? {}) },
    },
    abilities: normalizeAbilitySettings({ ...current.abilities, ...imported.abilities }),
    recipePreferences: { ...current.recipePreferences, ...imported.recipePreferences },
    surplusPolicies: { ...current.surplusPolicies, ...imported.surplusPolicies },
    completedGraphNodeIds: { ...current.completedGraphNodeIds, ...imported.completedGraphNodeIds },
    nodeNotes: { ...current.nodeNotes, ...imported.nodeNotes },
  };
}

function buildInputFromState(sourceState: AppState): CalculateInput {
  return {
    targets: filterPositiveTargets(
      sourceState.targets.map((target) => ({
        ...target,
        recipeId: sourceState.recipePreferences[target.outputItemId] ?? target.recipeId,
      })),
    ),
    settings: sourceState.settings,
    abilities: sourceState.abilities,
    recipePreferences: sourceState.recipePreferences,
    surplusPolicies: sourceState.surplusPolicies,
  };
}

function isUnsupportedImportedState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const candidate = value as {
    itemSourceModes?: unknown;
    stockOverrides?: unknown;
    settings?: {
      paradox?: { oblivionInputItemId?: unknown };
      fuel?: { fuelSourceMode?: unknown };
      fertilizer?: { fertilizerSourceMode?: unknown };
    };
    version?: unknown;
  };
  const paradoxItemId = candidate.settings?.paradox?.oblivionInputItemId;
  return (
    candidate.itemSourceModes !== undefined ||
    candidate.stockOverrides !== undefined ||
    candidate.settings?.fuel?.fuelSourceMode !== undefined ||
    candidate.settings?.fertilizer?.fertilizerSourceMode !== undefined ||
    candidate.version !== DEFAULT_STATE.version ||
    typeof paradoxItemId !== 'string' ||
    !isParadoxableItem(paradoxItemId)
  );
}

function unsupportedImportMessage(lang: Lang): string {
  return lang === 'ja'
    ? 'このJSONは現行バージョン形式ではないため読み込めません。現行バージョンで保存したJSONを使用してください。'
    : 'This JSON is not in the current version format and cannot be imported. Please use a JSON saved by the current version.';
}

function withImportRun(input: UserMessageInput, runId: string, sourceFileName: string): UserMessageInput {
  return withMessageRun(input, runId, sourceFileName);
}

export function SettingsTab({ state, setState, safeMode = false, onBeginJsonImport, onUserMessage, appVersion, gameVersion }: SettingsTabProps) {
  const lang = state.language;
  const fuel = getFuelSettings(state);
  const fertilizer = getFertilizerSettings(state);
  const machinePreferences = getMachinePreferenceSettings(state);
  const paradox = getParadoxSettingValues(state);
  const [importError, setImportError] = useState('');

  function patchSettings(patch: Partial<AppSettings>) {
    setState({ ...state, settings: { ...state.settings, ...patch } });
  }

  function patchMachinePreferences(patch: Partial<MachinePreferences>) {
    setState({
      ...state,
      settings: {
        ...state.settings,
        machinePreferences: {
          ...machinePreferences,
          ...patch,
        },
      },
    });
  }

  function patchParadoxSettings(patch: Partial<ParadoxSettings>) {
    setState({
      ...state,
      settings: {
        ...state.settings,
        paradox: {
          ...paradox,
          ...patch,
        },
      },
    });
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

  function saveDebugLogFromSettings(): void {
    const input = buildInputFromState(state);
    const { result, debugLog } = calculateWithDebug(input);
    downloadJson('alchemy-factory-calculator-debug-' + saveFileTimestamp() + '.json', {
      appVersion,
      gameVersion,
      debugSchemaVersion: 21,
      calculationStatus: result.calculationStatus ?? 'ok',
      errorSummaries: result.errorSummaries ?? [],
      ...debugLog,
    });
  }

  async function importJson(file: File | undefined) {
    if (!file) return;
    onBeginJsonImport?.();
    const runId = createMessageRunId('settings-import');
    setImportError('');

    let raw = '';
    try {
      raw = await file.text();
    } catch (error) {
      const messageJa = 'JSONファイルの読み込みに失敗しました。';
      const messageEn = 'Failed to read the JSON file.';
      setImportError(lang === 'ja' ? messageJa : messageEn);
      onUserMessage?.(withImportRun(verificationErrorMessage({
        code: 'IMPORT_FILE_READ_FAILED',
        messageJa,
        messageEn,
        phase: 'read_file',
        sourceFileName: file.name,
        details: { exception: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error), runId },
      }), runId, file.name));
      return;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      if (isUnsupportedImportedState(parsed)) {
        const messageJa = unsupportedImportMessage('ja');
        const messageEn = unsupportedImportMessage('en');
        setImportError(lang === 'ja' ? messageJa : messageEn);
        onUserMessage?.(withImportRun(verificationErrorMessage({
          code: 'UNSUPPORTED_IMPORTED_STATE',
          messageJa,
          messageEn,
          phase: 'import_validation',
          sourceFileName: file.name,
          details: { version: (parsed as { version?: unknown }).version, runId },
        }), runId, file.name));
        return;
      }
      try {
        sessionStorage.setItem('alchemyfactory:last-import-json-name', file.name);
        sessionStorage.setItem('alchemyfactory:last-import-json-text', raw);
      } catch {
        // The imported file name is only used for debug artifact naming.
      }
      const merged = mergeState(state, parsed);
      const targetSanitization = sanitizeNegativeTargets(merged.targets);
      const warningInput = buildNegativeTargetWarningInput(targetSanitization.negativeTargets);
      if (warningInput) {
        onUserMessage?.(withImportRun({
          ...warningInput,
          source: { ...warningInput.source, sourceFileName: file.name },
        }, runId, file.name));
      }
      setImportError('');
      setState({ ...merged, targets: targetSanitization.targets });
    } catch (error) {
      const messageJa = 'JSONの形式が不正です。';
      const messageEn = 'The JSON format is invalid.';
      const detailText = error instanceof Error ? error.message : String(error);
      setImportError((lang === 'ja' ? messageJa : messageEn) + (detailText ? ' ' + detailText : ''));
      onUserMessage?.(withImportRun(verificationErrorMessage({
        code: 'INVALID_JSON',
        messageJa,
        messageEn,
        phase: 'parse_json',
        sourceFileName: file.name,
        details: { exception: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error), runId },
      }), runId, file.name));
    }
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
                        {recipeOptionLabel(item.id, recipe, lang, state)}
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
                <span>{lang === 'ja' ? '坩堝系設備' : 'Crucible machine'}</span>
                <select
                  id="preferred-crucible-machine"
                  name="preferred-crucible-machine"
                  value={machinePreferences.crucible}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchMachinePreferences({ crucible: event.target.value as MachinePreferences['crucible'] })
                  }
                >
                  <option value="crucible">{text(machineById.crucible.name, lang)}</option>
                  <option value="stackable_crucible">{text(machineById.stackable_crucible.name, lang)}</option>
                </select>
              </label>
              <label className="form-field">
                <span>{lang === 'ja' ? '研磨系設備' : 'Grinding machine'}</span>
                <select
                  id="preferred-grinder-machine"
                  name="preferred-grinder-machine"
                  value={machinePreferences.grinder}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchMachinePreferences({ grinder: event.target.value as MachinePreferences['grinder'] })
                  }
                >
                  <option value="grinder">{text(machineById.grinder.name, lang)}</option>
                  <option value="enhanced_grinder">{text(machineById.enhanced_grinder.name, lang)}</option>
                </select>
              </label>
              <label className="form-field">
                <span>{lang === 'ja' ? '消滅エッセンス素材' : 'Oblivion essence input'}</span>
                <select
                  id="paradox-oblivion-input-item"
                  name="paradox-oblivion-input-item"
                  value={paradox.oblivionInputItemId}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => patchParadoxSettings({ oblivionInputItemId: event.target.value })}
                >
                  {paradoxableItemIds.map((itemId) => (
                    <option key={itemId} value={itemId}>
                      {recipeItemName(itemId, lang)} ({formatParadoxTime(itemById[itemId]?.paradoxTimeSec ?? 0)}s)
                    </option>
                  ))}
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
              <label className="form-field">
                <span>{lang === 'ja' ? '不足時の代替レシピ補完' : 'Alternate recipes for shortages'}</span>
                <span className="checkbox-control">
                  <input
                    id="allow-alternate-recipe-completion"
                    name="allow-alternate-recipe-completion"
                    type="checkbox"
                    checked={state.settings.allowAlternateRecipeCompletion ?? false}
                    autoComplete="off"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => patchSettings({ allowAlternateRecipeCompletion: event.target.checked })}
                  />
                  <span>{lang === 'ja' ? '有効' : 'Enabled'}</span>
                </span>
              </label>
              <label className="form-field">
                <span>{lang === 'ja' ? '副産物を燃料として利用' : 'Use byproducts as fuel'}</span>
                <span className="checkbox-control">
                  <input
                    id="use-byproduct-fuel"
                    name="use-byproduct-fuel"
                    type="checkbox"
                    checked={state.settings.useByproductFuel ?? false}
                    autoComplete="off"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => patchSettings({ useByproductFuel: event.target.checked })}
                  />
                  <span>{lang === 'ja' ? '有効' : 'Enabled'}</span>
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
                  {fuelItemIds.map((itemId) => (
                    <option key={itemId} value={itemId}>
                      {recipeItemName(itemId, lang)} ({itemById[itemId]?.fuelValue ?? 0})
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '燃料の扱い' : 'Fuel source'}</span>
                <select
                  id="fuel-source-mode"
                  name="fuel-source-mode"
                  value={fuel.sourceMode}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchFuelSettings({ sourceMode: event.target.value as AppSettings['fuel']['sourceMode'] })
                  }
                >
                  <option value="internal">{lang === 'ja' ? '内部生産' : 'Internal production'}</option>
                  <option value="external">{lang === 'ja' ? '外部生産' : 'External production'}</option>
                </select>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '加熱方式' : 'Heating mode'}</span>
                <select
                  id="heating-mode"
                  name="heating-mode"
                  value={fuel.heatingMode}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchFuelSettings({ heatingMode: event.target.value === 'steam' ? 'steam' : 'direct' })
                  }
                >
                  <option value="direct">{lang === 'ja' ? '直接加熱' : 'Direct heating'}</option>
                  <option value="steam">{lang === 'ja' ? '蒸気加熱' : 'Steam heating'}</option>
                </select>
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
                  {fertilizerItemIds.map((itemId) => (
                    <option key={itemId} value={itemId}>
                      {recipeItemName(itemId, lang)} ({itemById[itemId]?.fertilizerValue ?? 0} / {itemById[itemId]?.fertilizerNutrientsPerSec ?? 0}/s)
                    </option>
                  ))}
                </select>
              </label>

              <label className="form-field">
                <span>{lang === 'ja' ? '肥料の扱い' : 'Fertilizer source'}</span>
                <select
                  id="fertilizer-source-mode"
                  name="fertilizer-source-mode"
                  value={fertilizer.sourceMode}
                  autoComplete="off"
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    patchFertilizerSettings({ sourceMode: event.target.value as AppSettings['fertilizer']['sourceMode'] })
                  }
                >
                  <option value="internal">{lang === 'ja' ? '内部生産' : 'Internal production'}</option>
                  <option value="external">{lang === 'ja' ? '外部生産' : 'External production'}</option>
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="panel settings-panel data-io-panel">
          <h2>{lang === 'ja' ? 'データ入出力' : 'Data I/O'}</h2>

          <div className="settings-panel-body">
            {importError && <p className="debug-status">{importError}</p>}
            <div className="settings-form-grid">
              <div className="form-field">
                <span>{lang === 'ja' ? '設定出力' : 'Settings output'}</span>
                <button type="button" className="data-io-button" onClick={() => downloadJson(`alchemy-factory-calculator-save-${saveFileTimestamp()}.json`, state)}>
                  {lang === 'ja' ? '保存' : 'Save'}
                </button>
              </div>

              <div className="form-field">
                <span>{lang === 'ja' ? 'ログ出力' : 'Log output'}</span>
                <button type="button" className="data-io-button" onClick={saveDebugLogFromSettings}>
                  {lang === 'ja' ? '保存' : 'Save'}
                </button>
              </div>

              <label className="form-field data-io-file-field">
                <span>{lang === 'ja' ? '設定入力' : 'Settings input'}</span>
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
