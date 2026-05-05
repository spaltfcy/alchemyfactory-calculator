import { useEffect, useMemo, useRef, useState } from 'react';
import type { AbilityId, AppState } from './types';
import { DEFAULT_STATE } from './defaultState';
import { calculate } from './engine/calculate';
import { loadState, saveState } from './utils/storage';
import { t } from './i18n';
import { ABILITY_IDS } from './data/abilityTables';
import { TargetEditor } from './components/TargetEditor';
import { GraphTab } from './components/GraphTab';
import { TableTab } from './components/TableTab';
import { SettingsTab } from './components/SettingsTab';
import { AboutTab } from './components/AboutTab';
import { formatCopper, formatNumber } from './utils/format';

const APP_VERSION = '0.3.10';
const GAME_VERSION = '0.4.4.4323';

type RuntimeFlags = { debug: boolean; explicitSafeMode: boolean; safeMode: boolean };

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

function mergeInitialState(safeMode: boolean): AppState {
  if (safeMode) return DEFAULT_STATE;

  const saved = loadState();
  if (!saved) return DEFAULT_STATE;

  const merged: AppState = {
    ...DEFAULT_STATE,
    ...saved,
    settings: {
      ...DEFAULT_STATE.settings,
      ...saved.settings,
      fuel: { ...DEFAULT_STATE.settings.fuel, ...(saved.settings?.fuel ?? {}) },
    },
    abilities: { ...DEFAULT_STATE.abilities, ...saved.abilities },
    recipePreferences: { ...DEFAULT_STATE.recipePreferences, ...saved.recipePreferences },
    surplusPolicies: { ...DEFAULT_STATE.surplusPolicies, ...saved.surplusPolicies },
    itemSourceModes: { ...DEFAULT_STATE.itemSourceModes, ...saved.itemSourceModes },
    completedGraphNodeIds: { ...DEFAULT_STATE.completedGraphNodeIds, ...saved.completedGraphNodeIds },
    nodeNotes: { ...DEFAULT_STATE.nodeNotes, ...saved.nodeNotes },
  };

  if ((saved.version ?? 0) < 4) merged.settings.showSurplus = true;
  merged.version = Math.max(DEFAULT_STATE.version, saved.version ?? 0);
  return merged;
}

function resetStateForSafeMode(current: AppState): AppState {
  return { ...DEFAULT_STATE, language: current.language, activeTab: current.activeTab };
}

export function App() {
  const [runtimeFlags, setRuntimeFlags] = useState<RuntimeFlags>(() => parseRuntimeFlags());
  const [state, setState] = useState<AppState>(() => mergeInitialState(parseRuntimeFlags().safeMode));
  const [abilityOpen, setAbilityOpen] = useState(false);
  const safeTransitionRef = useRef({ previousSafeMode: runtimeFlags.safeMode, reloading: false });
  const lang = state.language;
  const showSidebar = state.activeTab === 'graph' || state.activeTab === 'table';

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

  const result = useMemo(
    () =>
      calculate({
        targets: state.targets,
        settings: state.settings,
        abilities: state.abilities,
        recipePreferences: state.recipePreferences,
        surplusPolicies: state.surplusPolicies,
        itemSourceModes: state.itemSourceModes,
      }),
    [state.targets, state.settings, state.abilities, state.recipePreferences, state.surplusPolicies, state.itemSourceModes],
  );

  function setActiveTab(activeTab: AppState['activeTab']) {
    setState({ ...state, activeTab });
  }

  function toggleCompleted(nodeId: string) {
    setState({
      ...state,
      completedGraphNodeIds: {
        ...state.completedGraphNodeIds,
        [nodeId]: !(state.completedGraphNodeIds[nodeId] ?? false),
      },
    });
  }

  function setAbility(id: AbilityId, value: number) {
    const nextValue = Math.max(0, Math.min(13, Math.floor(Number.isFinite(value) ? value : 0)));
    setState({ ...state, abilities: { ...state.abilities, [id]: nextValue } });
  }

  const initialCost = result.totals.initialCostCopper ?? 0;
  const runningCost = result.totals.runningCostCopperPerMin ?? result.totals.purchaseCostCopperPerMin ?? 0;
  const abilityButtonLabel = lang === 'ja' ? 'アビリティ' : 'Abilities';
  const initialCostLabel = lang === 'ja' ? '初期コスト' : 'Initial cost';
  const runningCostLabel = lang === 'ja' ? 'ランニングコスト/min' : 'Running cost/min';
  const siteVersionLabel = lang === 'ja' ? 'サイトバージョン' : 'Site version';
  const gameVersionLabel = lang === 'ja' ? 'ゲームバージョン' : 'Game version';

  return (
    <div className={runtimeFlags.safeMode ? 'app-shell is-safe-mode' : 'app-shell'}>
      <header className="app-header">
        <div className="app-title-block">
          <h1>
            {t('appTitle', lang)}
            {runtimeFlags.debug && <span className="debug-badge">[DEBUG]</span>}
            {runtimeFlags.explicitSafeMode && <span className="safe-mode-badge">Safe mode</span>}
          </h1>
          <p>
            {initialCostLabel}: {formatCopper(initialCost)} + {runningCostLabel}: {formatCopper(runningCost)} /{' '}
            {t('revenue', lang)} {formatCopper(result.totals.revenueCopperPerMin)} / {t('profit', lang)}{' '}
            {formatCopper(result.totals.profitCopperPerMin)} / {t('conveyorSpeed', lang)}{' '}
            {formatNumber(result.totals.conveyorItemsPerMinute)}/min
          </p>

          <nav className="tabs" aria-label={lang === 'ja' ? '画面切り替え' : 'Views'}>
            {(['graph', 'table', 'settings', 'about'] as const).map((tab) => (
              <button key={tab} type="button" className={state.activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
                {t(tab, lang)}
              </button>
            ))}
          </nav>
        </div>

        <div className={abilityOpen ? 'header-ability-panel is-open' : 'header-ability-panel'} aria-label={t('abilities', lang)}>
          {ABILITY_IDS.map((id) => (
            <label key={id} className="header-ability-field">
              <span>{abilityLabels[id][lang]}</span>
              <input
                type="number"
                min={0}
                max={13}
                step={1}
                value={state.abilities[id] ?? 0}
                onChange={(event: { target: { value: string } }) => setAbility(id, Number(event.target.value))}
              />
            </label>
          ))}
        </div>

        <div className="header-actions">
          <button
            type="button"
            className={abilityOpen ? 'header-ability-toggle is-open' : 'header-ability-toggle'}
            onClick={() => setAbilityOpen((current) => !current)}
          >
            {abilityButtonLabel}
          </button>

          <div className="version-stack">
            <span>{siteVersionLabel}: {APP_VERSION}</span>
            <span>{gameVersionLabel}: {GAME_VERSION}</span>
          </div>

          <select value={lang} onChange={(event: { target: { value: string } }) => setState({ ...state, language: event.target.value as AppState['language'] })}>
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </div>
      </header>

      <main className={showSidebar ? 'main-layout' : 'main-layout main-layout-full'}>
        {showSidebar && (
          <aside className="side-pane">
            <TargetEditor lang={lang} targets={state.targets} onChange={(targets) => setState({ ...state, targets })} />
          </aside>
        )}

        <section className={`content-pane content-pane-${state.activeTab}`}>
          {state.activeTab === 'graph' && (
            <GraphTab
              lang={lang}
              result={result}
              settings={state.settings}
              completedGraphNodeIds={state.completedGraphNodeIds}
              onToggleCompleted={toggleCompleted}
              debug={runtimeFlags.debug}
            />
          )}
          {state.activeTab === 'table' && <TableTab lang={lang} result={result} />}
          {state.activeTab === 'settings' && <SettingsTab state={state} setState={setState} safeMode={runtimeFlags.safeMode} />}
          {state.activeTab === 'about' && <AboutTab lang={lang} />}
        </section>
      </main>
    </div>
  );
}
