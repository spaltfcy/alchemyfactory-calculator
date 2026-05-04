// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import type { AppState } from './types';
import { DEFAULT_STATE } from './defaultState';
import { calculate } from './engine/calculate';
import { loadState, saveState } from './utils/storage';
import { t } from './i18n';
import { TargetEditor } from './components/TargetEditor';
import { GraphTab } from './components/GraphTab';
import { TableTab } from './components/TableTab';
import { SettingsTab } from './components/SettingsTab';
import { AboutTab } from './components/AboutTab';
import { formatCopper, formatNumber } from './utils/format';

const APP_VERSION = 'v0.2.4';

function mergeInitialState(): AppState {
  const saved = loadState();
  if (!saved) return DEFAULT_STATE;

  const merged: AppState = {
    ...DEFAULT_STATE,
    ...saved,
    settings: { ...DEFAULT_STATE.settings, ...saved.settings },
    abilities: { ...DEFAULT_STATE.abilities, ...saved.abilities },
    recipePreferences: { ...DEFAULT_STATE.recipePreferences, ...saved.recipePreferences },
    surplusPolicies: { ...DEFAULT_STATE.surplusPolicies, ...saved.surplusPolicies },
    itemSourceModes: { ...DEFAULT_STATE.itemSourceModes, ...saved.itemSourceModes },
    completedGraphNodeIds: { ...DEFAULT_STATE.completedGraphNodeIds, ...saved.completedGraphNodeIds },
    nodeNotes: { ...DEFAULT_STATE.nodeNotes, ...saved.nodeNotes },
  };

  if ((saved.version ?? 0) < 4) {
    merged.settings.showSurplus = true;
  }

  merged.version = Math.max(DEFAULT_STATE.version, saved.version ?? 0);
  return merged;
}

export function App() {
  const [state, setState] = useState<AppState>(() => mergeInitialState());
  const lang = state.language;
  const showSidebar = state.activeTab === 'graph' || state.activeTab === 'table';

  useEffect(() => {
    saveState(state);
  }, [state]);

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

  const initialCostLabel = lang === 'ja' ? '初期コスト' : 'Initial cost';
  const runningCostLabel = lang === 'ja' ? 'ランニングコスト/min' : 'Running cost/min';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>{t('appTitle', lang)}</h1>
          <p>
            {initialCostLabel}: {formatCopper(result.totals.initialCostCopper)} + {runningCostLabel}:{' '}
            {formatCopper(result.totals.runningCostCopperPerMin)} / {t('revenue', lang)}{' '}
            {formatCopper(result.totals.revenueCopperPerMin)} / {t('profit', lang)}{' '}
            {formatCopper(result.totals.profitCopperPerMin)} / {t('conveyorSpeed', lang)}{' '}
            {formatNumber(result.totals.conveyorItemsPerMinute)}/min
          </p>
        </div>
        <div className="header-controls">
          <span className="version-pill">{APP_VERSION}</span>
          <select
            value={state.language}
            onChange={(e) => setState({ ...state, language: e.target.value as AppState['language'] })}
          >
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </div>
      </header>

      <nav className="tabs">
        {(['graph', 'table', 'settings', 'about'] as const).map((tab) => (
          <button key={tab} className={state.activeTab === tab ? 'active' : ''} onClick={() => setActiveTab(tab)}>
            {t(tab, lang)}
          </button>
        ))}
      </nav>

      <main className={showSidebar ? 'main-layout' : 'content-only-layout'}>
        {showSidebar && (
          <aside className="side-pane">
            <TargetEditor lang={lang} targets={state.targets} onChange={(targets) => setState({ ...state, targets })} />
          </aside>
        )}

        <section className="content-pane">
          {state.activeTab === 'graph' && (
            <GraphTab
              lang={lang}
              result={result}
              settings={state.settings}
              completedGraphNodeIds={state.completedGraphNodeIds}
              onToggleCompleted={toggleCompleted}
            />
          )}
          {state.activeTab === 'table' && <TableTab lang={lang} result={result} />}
          {state.activeTab === 'settings' && <SettingsTab state={state} setState={setState} />}
          {state.activeTab === 'about' && <AboutTab lang={lang} />}
        </section>
      </main>
    </div>
  );
}
