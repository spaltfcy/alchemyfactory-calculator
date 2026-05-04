// @ts-nocheck
import type { AppSettings, AppState, Lang, SurplusPolicy } from '../types';
import { ABILITY_IDS } from '../data/abilityTables';
import { t } from '../i18n';
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

function mergeState(current: AppState, imported: Partial<AppState>): AppState {
  return {
    ...current,
    ...imported,
    settings: { ...current.settings, ...imported.settings, showSurplus: imported.settings?.showSurplus ?? current.settings.showSurplus },
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
    <div className="settings-tab">
      <section className="panel settings-card settings-card-small settings-grid settings-card-language">
        <h2>{t('language', lang)}</h2>
        <label>
          {t('language', lang)}
          <select value={state.language} onChange={(e) => setState({ ...state, language: e.target.value as Lang })}>
            <option value="ja">日本語</option>
            <option value="en">English</option>
          </select>
        </label>
      </section>

      <section className="panel settings-card settings-card-small settings-grid settings-card-calculation">
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

      <section className="panel settings-card settings-card-small settings-grid settings-card-display">
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
          {lang === 'ja' ? '余剰ノードを表示' : 'Show surplus nodes'}
        </label>
      </section>

      <section className="panel settings-card settings-card-small settings-grid settings-card-data">
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

      <section className="panel settings-card settings-card-abilities">
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
      </section>
    </div>
  );
}
