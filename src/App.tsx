import { useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import type { AbilityId, AppSettings, AppState, TablePreferences } from './types';
import { filterPositiveTargets, sanitizeNegativeTargets } from './engine/targetValidation';
import { calculationInvalidPersistentError, createUserMessage, messageText, type UserMessageInput, type UserMessageLog } from './utils/userMessages';
import { DEFAULT_STATE } from './defaultState';
import { calculate } from './engine/calculate';
import { loadState, saveState } from './utils/storage';
import { t, text } from './i18n';
import { ABILITY_IDS, ABILITY_MAX_LEVEL, normalizeAbilityLevel, normalizeAbilitySettings } from './data/abilityTables';
import { ItemOutputSettings } from './components/ItemOutputSettings';
import { GraphTab, type GraphFocusRequest } from './components/GraphTab';
import { DebugGraphTab } from './components/DebugGraphTab';
import { TableTab } from './components/TableTab';
import { SettingsTab } from './components/SettingsTab';
import { RecipeSettingsTab } from './components/RecipeSettingsTab';
import { AboutTab } from './components/AboutTab';
import { DebugTab } from './components/DebugTab';
import { formatCopper, formatNumber } from './utils/format';
import { getMachinePreferences } from './data/machinePreferences';
import { getParadoxSettings, isParadoxableItem } from './data/paradox';
import { recipeById } from './data/recipes';

const APP_VERSION = '0.9.42';
const GAME_VERSION = '0.4.4.4323';

type RuntimeFlags = {
  debug: boolean;
  explicitSafeMode: boolean;
  safeMode: boolean;
};

const abilityLabels: Record<AbilityId, { ja: string; en: string }> = {
  logisticsEfficiency: { ja: '物流効率', en: 'Logistics' },
  throwingEfficiency: { ja: '投擲効率', en: 'Throwing' },
  factoryEfficiency: { ja: '工場効率', en: 'Factory' },
  alchemySkill: { ja: '錬金スキル', en: 'Alchemy' },
  fuelEfficiency: { ja: '燃料効率', en: 'Fuel' },
  fertilizerEfficiency: { ja: '肥料効率', en: 'Fertilizer' },
  salesAbility: { ja: '販売能力', en: 'Sales' },
  negotiationSkill: { ja: '交渉スキル', en: 'Negotiation' },
  customerManagement: { ja: '顧客管理', en: 'Customers' },
  relicKnowledge: { ja: '聖遺物の知識', en: 'Relics' },
};

function parseRuntimeFlags(): RuntimeFlags {
  const rawHash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
  const cleanParts: string[] = [];
  let debug = false;
  let explicitSafeMode = false;

  for (const part of rawHash.split('&').filter(Boolean)) {
    if (part === 'DEBUG=ON') {
      if (!debug) cleanParts.push('DEBUG=ON');
      debug = true;
      continue;
    }

    const lower = part.toLowerCase();
    if (lower === 'safe' || lower === 'safemode') {
      if (!explicitSafeMode) cleanParts.push(lower);
      explicitSafeMode = true;
    }
  }

  const cleanHash = cleanParts.length ? `#${cleanParts.join('&')}` : '';

  if (window.location.hash !== cleanHash) {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${cleanHash}`);
  }

  return { debug, explicitSafeMode, safeMode: debug || explicitSafeMode };
}

function isUnsupportedSavedState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
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

function mergeInitialState(safeMode: boolean): AppState {
  if (safeMode) return DEFAULT_STATE;

  const saved = loadState();
  if (!saved) return DEFAULT_STATE;

  if (isUnsupportedSavedState(saved)) {
    try {
      sessionStorage.setItem('alchemyfactory:unsupported-saved-state', '1');
    } catch {
      // Ignore sessionStorage failures.
    }
    return DEFAULT_STATE;
  }

  const merged: AppState = {
    ...DEFAULT_STATE,
    ...saved,
    settings: {
      ...DEFAULT_STATE.settings,
      ...saved.settings,
      machinePreferences: getMachinePreferences(saved.settings ?? DEFAULT_STATE.settings),
      paradox: getParadoxSettings(saved.settings ?? DEFAULT_STATE.settings),
      fuel: {
        ...DEFAULT_STATE.settings.fuel,
        ...(saved.settings?.fuel ?? {}),
        enabled: true,
      },
      fertilizer: {
        ...DEFAULT_STATE.settings.fertilizer,
        ...(saved.settings?.fertilizer ?? {}),
        enabled: true,
      },
    },
    tablePreferences: {
      ...DEFAULT_STATE.tablePreferences,
      ...(saved.tablePreferences ?? {}),
      machineSort: {
        ...DEFAULT_STATE.tablePreferences.machineSort,
        ...(saved.tablePreferences?.machineSort ?? {}),
      },
      machineDetailSort: {
        ...DEFAULT_STATE.tablePreferences.machineDetailSort,
        ...(saved.tablePreferences?.machineDetailSort ?? {}),
      },
      materialFlowSort: {
        ...DEFAULT_STATE.tablePreferences.materialFlowSort,
        ...(saved.tablePreferences?.materialFlowSort ?? {}),
      },
      itemFlowSort: {
        ...DEFAULT_STATE.tablePreferences.itemFlowSort,
        ...(saved.tablePreferences?.itemFlowSort ?? {}),
      },
    },
    abilities: normalizeAbilitySettings(saved.abilities),
    recipePreferences: { ...DEFAULT_STATE.recipePreferences, ...saved.recipePreferences },
    surplusPolicies: { ...DEFAULT_STATE.surplusPolicies, ...saved.surplusPolicies },
    completedGraphNodeIds: { ...DEFAULT_STATE.completedGraphNodeIds, ...saved.completedGraphNodeIds },
    nodeNotes: { ...DEFAULT_STATE.nodeNotes, ...saved.nodeNotes },
  };

  if (merged.settings.showInitialInvestmentLines === undefined) merged.settings.showInitialInvestmentLines = DEFAULT_STATE.settings.showInitialInvestmentLines;

  merged.targets = sanitizeNegativeTargets(merged.targets).targets;
  merged.version = DEFAULT_STATE.version;
  return merged;
}

function resetStateForSafeMode(current: AppState): AppState {
  return {
    ...DEFAULT_STATE,
    language: current.language,
    activeTab: current.activeTab,
  };
}


function settingsForCalculation(settings: AppSettings): AppSettings {
  const machinePreferences = getMachinePreferences(settings);
  const fuel = { ...DEFAULT_STATE.settings.fuel, ...(settings.fuel ?? {}), enabled: true };
  const fertilizer = { ...DEFAULT_STATE.settings.fertilizer, ...(settings.fertilizer ?? {}), enabled: true };
  const thermalExtractorHeight =
    machinePreferences.extractor === 'thermal_extractor'
      ? Math.max(0, Math.floor(Number(settings.thermalExtractor?.height ?? DEFAULT_STATE.settings.thermalExtractor.height)))
      : DEFAULT_STATE.settings.thermalExtractor.height;

  return {
    ...settings,
    machinePreferences,
    fuel,
    fertilizer,
    thermalExtractor: {
      ...(settings.thermalExtractor ?? DEFAULT_STATE.settings.thermalExtractor),
      height: Number.isFinite(thermalExtractorHeight) ? thermalExtractorHeight : DEFAULT_STATE.settings.thermalExtractor.height,
    },
  };
}


function mergeTablePreferences(current: TablePreferences, next: Partial<TablePreferences>): TablePreferences {
  return {
    ...current,
    ...next,
    machineSort: {
      ...current.machineSort,
      ...(next.machineSort ?? {}),
    },
    machineDetailSort: {
      ...current.machineDetailSort,
      ...(next.machineDetailSort ?? {}),
    },
    materialFlowSort: {
      ...current.materialFlowSort,
      ...(next.materialFlowSort ?? {}),
    },
    itemFlowSort: {
      ...current.itemFlowSort,
      ...(next.itemFlowSort ?? {}),
    },
  };
}

export function App() {
  const initialRuntimeFlagsRef = useRef<RuntimeFlags | null>(null);
  if (initialRuntimeFlagsRef.current === null) initialRuntimeFlagsRef.current = parseRuntimeFlags();
  const [runtimeFlags, setRuntimeFlags] = useState<RuntimeFlags>(() => initialRuntimeFlagsRef.current!);
  const [state, setState] = useState<AppState>(() => mergeInitialState(initialRuntimeFlagsRef.current!.safeMode));
  const [abilityOpen, setAbilityOpen] = useState(false);
  const [visibleUserMessages, setVisibleUserMessages] = useState<UserMessageLog[]>([]);
  const [userMessageHistory, setUserMessageHistory] = useState<UserMessageLog[]>([]);
  const calculationErrorMessageRef = useRef<{ id: string; key: string } | null>(null);
  const [focusGraphRequest, setFocusGraphRequest] = useState<GraphFocusRequest | undefined>(undefined);
  const safeTransitionRef = useRef({ previousSafeMode: runtimeFlags.safeMode, reloading: false });
  const calculationSettingsCacheRef = useRef<{ key: string; settings: AppSettings } | null>(null);
  const lang = state.language;
  const showSidebar = state.activeTab === 'graph' || state.activeTab === 'graphDebug' || state.activeTab === 'table';

  function addUserMessage(input: UserMessageInput): UserMessageLog {
    const message = createUserMessage(input);
    setUserMessageHistory((current) => [message, ...current].slice(0, 300));
    setVisibleUserMessages((current) => [message, ...current].slice(0, 20));
    if (message.lifetimeMs !== null) {
      const durationMs = Math.max(1, message.lifetimeMs);
      window.setTimeout(() => {
        setVisibleUserMessages((current) => current.filter((item) => item.id !== message.id));
      }, durationMs);
    }
    return message;
  }

  function removeUserMessage(id: string): void {
    setVisibleUserMessages((current) => current.filter((item) => item.id !== id));
  }

  function clearActiveUserMessages(): void {
    setVisibleUserMessages([]);
    calculationErrorMessageRef.current = null;
  }

  function messageStyle(message: UserMessageLog): CSSProperties | undefined {
    if (message.lifetimeMs === null) return undefined;
    return { '--message-duration': `${Math.max(1, message.lifetimeMs)}ms` } as CSSProperties;
  }

  function messageTitle(message: UserMessageLog): string {
    if (message.severity === 'error') return lang === 'ja' ? 'エラー' : 'Error';
    if (message.severity === 'warning') return lang === 'ja' ? '警告' : 'Warning';
    return lang === 'ja' ? '情報' : 'Info';
  }


  useEffect(() => {
    try {
      if (sessionStorage.getItem('alchemyfactory:unsupported-saved-state') !== '1') return;
      sessionStorage.removeItem('alchemyfactory:unsupported-saved-state');
      window.alert(lang === 'ja' ? '保存データが旧形式のため読み込めませんでした。初期状態で起動します。' : 'The saved data uses an old format and could not be loaded. Starting with the default state.');
    } catch {
      // Ignore sessionStorage failures.
    }
  }, [lang]);

  useEffect(() => {
    const onHashChange = () => setRuntimeFlags(parseRuntimeFlags());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const previousSafeMode = safeTransitionRef.current.previousSafeMode;

    if (previousSafeMode && !runtimeFlags.safeMode) {
      safeTransitionRef.current.reloading = true;
      window.location.reload();
      return;
    }

    if (!previousSafeMode && runtimeFlags.safeMode) {
      setState((current) => resetStateForSafeMode(current));
    }

    safeTransitionRef.current.previousSafeMode = runtimeFlags.safeMode;
  }, [runtimeFlags.safeMode]);

  useEffect(() => {
    if (runtimeFlags.safeMode || safeTransitionRef.current.reloading) return;
    saveState(state);
  }, [state, runtimeFlags.safeMode]);

  useEffect(() => {
    if (runtimeFlags.debug || (state.activeTab !== 'debug' && state.activeTab !== 'graphDebug')) return;
    setState((current) => (current.activeTab === 'debug' || current.activeTab === 'graphDebug' ? { ...current, activeTab: 'graph' } : current));
  }, [runtimeFlags.debug, state.activeTab]);

  const targetCalculationKey = useMemo(
    () =>
      JSON.stringify(
        state.targets
          .map((target) => ({
            id: target.id,
            enabled: target.enabled ?? true,
            recipeId: state.recipePreferences[target.outputItemId] ?? target.recipeId,
            outputItemId: target.outputItemId,
            mode: target.mode,
            value: target.value,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    [state.targets, state.recipePreferences],
  );

  const calculationTargets = useMemo(
    () =>
      filterPositiveTargets(
        state.targets
          .map((target) => ({
            ...target,
            recipeId: state.recipePreferences[target.outputItemId] ?? target.recipeId,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    [targetCalculationKey],
  );

  const calculationSettings = useMemo(() => {
    const nextSettings = settingsForCalculation(state.settings);
    const key = JSON.stringify(nextSettings);
    const cached = calculationSettingsCacheRef.current;
    if (cached?.key === key) return cached.settings;
    calculationSettingsCacheRef.current = { key, settings: nextSettings };
    return nextSettings;
  }, [state.settings]);

  const result = useMemo(
    () =>
      calculate({
        targets: calculationTargets,
        settings: calculationSettings,
        abilities: state.abilities,
        recipePreferences: state.recipePreferences,
        surplusPolicies: state.surplusPolicies,
      }),
    [calculationTargets, calculationSettings, state.abilities, state.recipePreferences, state.surplusPolicies],
  );

  const topMachineLine = useMemo(() => {
    const unit = lang === 'ja' ? '台' : ' machines';
    const entries = Object.values(result.recipeStats)
      .filter((row) => Number.isFinite(row.actualMachines) && row.actualMachines > 0)
      .sort((a, b) => b.actualMachines - a.actualMachines || a.recipeId.localeCompare(b.recipeId))
      .slice(0, 3)
      .map((row) => {
        const recipe = recipeById[row.recipeId];
        const recipeName = recipe ? text(recipe.name, lang) : row.recipeId;
        return `${recipeName}/${formatNumber(row.actualMachines, 3)}${unit}`;
      });
    if (entries.length === 0) return '';
    return (lang === 'ja' ? '実台数Top3: ' : 'Top actual machines: ') + entries.join(' ・ ');
  }, [lang, result.recipeStats]);

  const calculationErrorKey = useMemo(
    () =>
      result.calculationStatus === 'invalid'
        ? JSON.stringify({ status: result.calculationStatus, errorSummaries: result.errorSummaries ?? [] })
        : '',
    [result.calculationStatus, result.errorSummaries],
  );

  useEffect(() => {
    if (result.calculationStatus !== 'invalid') {
      const previous = calculationErrorMessageRef.current;
      if (previous) {
        setVisibleUserMessages((current) => current.filter((message) => message.id !== previous.id));
        calculationErrorMessageRef.current = null;
      }
      return;
    }

    if (calculationErrorMessageRef.current?.key === calculationErrorKey) return;

    const previous = calculationErrorMessageRef.current;
    if (previous) setVisibleUserMessages((current) => current.filter((message) => message.id !== previous.id));

    const message = addUserMessage(
      calculationInvalidPersistentError(result.errorSummaries ?? [], {
        calculationStatus: result.calculationStatus,
        totals: result.totals,
        errorSummaries: result.errorSummaries ?? [],
      }),
    );
    calculationErrorMessageRef.current = { id: message.id, key: calculationErrorKey };
  }, [calculationErrorKey, result.calculationStatus, result.errorSummaries, result.totals]);

  function setActiveTab(activeTab: AppState['activeTab']) {
    setState((current) => (current.activeTab === activeTab ? current : { ...current, activeTab }));
  }

  function toggleCompleted(nodeId: string) {
    setState((current) => ({
      ...current,
      completedGraphNodeIds: {
        ...current.completedGraphNodeIds,
        [nodeId]: !(current.completedGraphNodeIds[nodeId] ?? false),
      },
    }));
  }

  function abilityInputValue(value: unknown): number {
    if (typeof value === 'string') {
      const digits = value.replace(/\D/g, '');
      return normalizeAbilityLevel(digits ? Number(digits) : 0);
    }
    return normalizeAbilityLevel(value);
  }

  function setAbility(id: AbilityId, value: number | string) {
    const nextValue = abilityInputValue(value);
    setState((current) => ({
      ...current,
      abilities: {
        ...current.abilities,
        [id]: nextValue,
      },
    }));
  }

  const initialCost = result.totals.initialCostCopper ?? 0;
  const runningCost = result.totals.runningCostCopperPerMin ?? result.totals.purchaseCostCopperPerMin ?? 0;
  const initialCostLabel = lang === 'ja' ? '初期コスト' : 'Initial cost';
  const runningCostLabel = lang === 'ja' ? 'ランニングコスト/min' : 'Running cost/min';
  const abilityButtonLabel = lang === 'ja' ? 'アビリティ' : 'Abilities';
  const siteVersionLabel = lang === 'ja' ? 'サイトバージョン' : 'Site version';
  const gameVersionLabel = lang === 'ja' ? 'ゲームバージョン' : 'Game version';
  const calculationInvalidLabel = lang === 'ja' ? '\u8a08\u7b97\u4e0d\u80fd' : 'Invalid';
  const isCalculationInvalid = result.calculationStatus === 'invalid';
  function formatMoneyResult(value: number): string {
    return isCalculationInvalid ? calculationInvalidLabel : formatCopper(value);
  }

  const debugCalculationLine = runtimeFlags.debug
    ? (lang === 'ja' ? '計算' : 'Calc') + ': ' + formatNumber(result.totals.calculationMs ?? 0, 1) + 'ms'
    : '';

  const visibleTabs: AppState['activeTab'][] = runtimeFlags.debug
    ? ['graph', 'table', 'settings', 'recipeSettings', 'about', 'graphDebug', 'debug']
    : ['graph', 'table', 'settings', 'recipeSettings', 'about'];

  function requestGraphSave() {
    window.dispatchEvent(new CustomEvent('alchemyfactory:save-live-graph'));
  }

  function focusGraphNode(nodeId: string): void {
    setFocusGraphRequest({ nodeId, requestId: Date.now() });
    setState((current) => ({ ...current, activeTab: 'graph' }));
  }

  return (
    <div className={runtimeFlags.safeMode ? 'app-shell is-safe-mode' : 'app-shell'}>
      <header className="app-header">
        <div className="app-title-block">
          <h1>
            {t('appTitle', lang)}
            {runtimeFlags.debug && <span className="debug-badge">[DEBUG]</span>}
            {runtimeFlags.explicitSafeMode && <span className="safe-mode-badge">Safe mode</span>}
          </h1>

          <p className="summary-line">
            {initialCostLabel}: {formatMoneyResult(initialCost)} + {runningCostLabel}: {formatMoneyResult(runningCost)} /{' '}
            {t('revenue', lang)} {formatMoneyResult(result.totals.revenueCopperPerMin)} / {t('profit', lang)}{' '}
            {formatMoneyResult(result.totals.profitCopperPerMin)} / {t('conveyorSpeed', lang)}{' '}
            {formatNumber(result.totals.conveyorItemsPerMinute)}/min
            {runtimeFlags.debug && debugCalculationLine && (
              <span className="debug-metric-inline"> / {debugCalculationLine}</span>
            )}
          </p>

          {topMachineLine && <p className="top-machine-line">{topMachineLine}</p>}

          <nav className="tabs">
            {visibleTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={state.activeTab === tab ? 'active' : ''}
                onClick={() => setActiveTab(tab)}
              >
                {tab === 'debug' ? 'DEBUG' : tab === 'graphDebug' ? 'Graph[DEBUG]' : t(tab, lang)}
              </button>
            ))}
          </nav>
        </div>

        <div className={abilityOpen ? 'header-ability-panel is-open' : 'header-ability-panel'} aria-label={t('abilities', lang)}>
          {ABILITY_IDS.map((id) => (
            <label key={id} className="header-ability-field">
              <span>{abilityLabels[id][lang]}</span>
              <input
                id={`ability-${id}`}
                name={`ability-${id}`}
                type="number"
                min={0}
                max={ABILITY_MAX_LEVEL}
                step={1}
                value={state.abilities[id] ?? 0}
                autoComplete="off"
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  const nextValue = abilityInputValue(event.target.value);
                  event.currentTarget.value = String(nextValue);
                  setAbility(id, nextValue);
                }}
                onBlur={(event) => {
                  event.currentTarget.value = String(abilityInputValue(event.currentTarget.value));
                }}
              />
            </label>
          ))}
        </div>

        <div className="header-actions">
          <div className="version-stack">
            <span>
              {siteVersionLabel}: {APP_VERSION}
            </span>
            <span>
              {gameVersionLabel}: {GAME_VERSION}
            </span>
          </div>

          <div className="header-control-row">
            <button
              type="button"
              className={abilityOpen ? 'header-ability-toggle is-open' : 'header-ability-toggle'}
              onClick={() => setAbilityOpen((current) => !current)}
            >
              {abilityButtonLabel}
            </button>

            <select
              id="app-language"
              name="app-language"
              value={lang}
              autoComplete="off"
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setState((current) => ({ ...current, language: event.target.value as AppState['language'] }))
              }
            >
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </div>
          {(state.activeTab === 'graph' || state.activeTab === 'graphDebug') && (
            <button type="button" className="header-graph-save-button" onClick={requestGraphSave}>
              {lang === 'ja' ? 'グラフ保存' : 'Save graph'}
            </button>
          )}
        </div>
      </header>

      {visibleUserMessages.length > 0 && (
        <div className="app-message-stack" aria-live="polite">
          {visibleUserMessages.slice(0, 5).map((message) => (
            <div
              key={message.id}
              className={`app-message app-message-${message.severity} ${message.lifetimeMs === null ? 'app-message-persistent' : 'app-message-timed'}`}
              style={messageStyle(message)}
            >
              <div className="app-message-head">
                <strong>{messageTitle(message)}</strong>
                <button type="button" aria-label={lang === 'ja' ? 'メッセージを閉じる' : 'Close message'} onClick={() => removeUserMessage(message.id)}>
                  ×
                </button>
              </div>
              <pre>{messageText(message, lang)}</pre>
            </div>
          ))}
        </div>
      )}

      <main className={showSidebar ? 'main-layout' : 'main-layout main-layout-full'}>
        {showSidebar && (
          <aside className="side-pane">
            <ItemOutputSettings
              lang={lang}
              targets={state.targets}
              targetDefaults={state.settings.targetDefaults}
              onChange={(targets) => setState((current) => ({ ...current, targets }))}
              onFocusGraphNode={focusGraphNode}
              onUserMessage={addUserMessage}
            />
          </aside>
        )}

        <section className={`content-pane content-pane-${state.activeTab}`}>
          {/* Keep GraphTab mounted so tab changes do not relayout/reset manually moved nodes. */}
          <div
            className={state.activeTab === 'graph' ? 'keep-alive-tab' : 'keep-alive-tab is-hidden'}
            aria-hidden={state.activeTab !== 'graph'}
          >
            <GraphTab
              lang={lang}
              result={result}
              settings={calculationSettings}
              completedGraphNodeIds={state.completedGraphNodeIds}
              onToggleCompleted={toggleCompleted}
              focusRequest={focusGraphRequest}
              debug={runtimeFlags.debug}
            />
          </div>
          {state.activeTab === 'table' && (
            <TableTab
              lang={lang}
              result={result}
              tablePreferences={state.tablePreferences}
              onTablePreferencesChange={(nextPreferences) =>
                setState((current) => ({
                  ...current,
                  tablePreferences: mergeTablePreferences(current.tablePreferences, nextPreferences),
                }))
              }
            />
          )}
          {state.activeTab === 'settings' && <SettingsTab state={state} setState={setState} safeMode={runtimeFlags.safeMode} onBeginJsonImport={clearActiveUserMessages} onUserMessage={addUserMessage} appVersion={APP_VERSION} gameVersion={GAME_VERSION} />}
          {state.activeTab === 'recipeSettings' && <RecipeSettingsTab state={state} setState={setState} />}
          {state.activeTab === 'about' && <AboutTab lang={lang} />}
          {state.activeTab === 'graphDebug' && runtimeFlags.debug && (
            <DebugGraphTab
              lang={lang}
              result={result}
              settings={calculationSettings}
              completedGraphNodeIds={state.completedGraphNodeIds}
              onToggleCompleted={toggleCompleted}
              focusRequest={focusGraphRequest}
            />
          )}
          {state.activeTab === 'debug' && runtimeFlags.debug && <DebugTab lang={lang} state={state} setState={setState} appVersion={APP_VERSION} gameVersion={GAME_VERSION} userMessages={userMessageHistory} onUserMessage={addUserMessage} onBeginJsonImport={clearActiveUserMessages} />}
        </section>
      </main>
    </div>
  );
}
