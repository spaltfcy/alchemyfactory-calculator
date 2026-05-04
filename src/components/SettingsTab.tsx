// @ts-nocheck
import type { AppSettings, AppState, Lang, SurplusPolicy } from '../types';
import { ABILITY_IDS } from '../data/abilityTables';
import { ITEMS } from '../data/items';
import { getRecipesProducing } from '../data/recipes';
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

const cardStyle = {
  width: '22rem',
  minHeight: '12rem',
};

const fieldStackStyle = {
  display: 'grid',
  gap: '1rem',
  alignContent: 'start',
};

const labelStyle = {
  color: 'var(--muted)',
  fontSize: '0.92rem',
};

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
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '24rem minmax(0, 1fr)',
        gap: '1rem',
        alignItems: 'start',
        width: '100%',
      }}
    >
      <section
        className="panel"
        style={{
          minHeight: 'calc(100vh - 11rem)',
          maxHeight: 'calc(100vh - 8rem)',
          overflow: 'hidden',
        }}
      >
        <h2>{lang === 'ja' ? 'レシピ設定' : 'Recipe settings'}</h2>

        <div
          style={{
            display: 'grid',
            maxHeight: 'calc(100vh - 16rem)',
            overflow: 'auto',
            paddingRight: '0.25rem',
          }}
        >
          {recipeItems.map((item) => {
            const recipes = getRecipesProducing(item.id);
            return (
              <div
                key={item.id}
                style={{
                  display: 'grid',
                  gap: '0.45rem',
                  padding: '0.85rem 0',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <div style={labelStyle}>{text(item.name, lang)}</div>
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

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          minWidth: 0,
        }}
      >
        <section className="panel" style={cardStyle}>
          <h2>{t('language', lang)}</h2>
          <div style={fieldStackStyle}>
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <div style={labelStyle}>{t('language', lang)}</div>
              <select value={state.language} onChange={(e) => setState({ ...state, language: e.target.value as Lang })}>
                <option value="ja">日本語</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </section>

        <section className="panel" style={cardStyle}>
          <h2>{lang === 'ja' ? '計算' : 'Calculation'}</h2>
          <div style={fieldStackStyle}>
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <div style={labelStyle}>{t('machineRounding', lang)}</div>
              <select value={state.settings.machineRounding} onChange={(e) => patchSettings({ machineRounding: e.target.value as AppSettings['machineRounding'] })}>
                <option value="none">{t('roundingNone', lang)}</option>
                <option value="intermediate">{t('roundingIntermediate', lang)}</option>
                <option value="all">{t('roundingAll', lang)}</option>
              </select>
            </div>

            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <div style={labelStyle}>{t('defaultSurplusPolicy', lang)}</div>
              <select value={state.settings.defaultSurplusPolicy} onChange={(e) => patchSettings({ defaultSurplusPolicy: e.target.value as SurplusPolicy })}>
                <option value="reuse">{t('reuse', lang)}</option>
                <option value="discard">{t('discard', lang)}</option>
              </select>
            </div>
          </div>
        </section>

        <section className="panel" style={cardStyle}>
          <h2>{t('display', lang)}</h2>
          <div style={fieldStackStyle}>
            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <div style={labelStyle}>{lang === 'ja' ? 'グラフ詳細度' : 'Graph detail'}</div>
              <select value={state.settings.graphDetailLevel} onChange={(e) => patchSettings({ graphDetailLevel: e.target.value as AppSettings['graphDetailLevel'] })}>
                <option value="simple">{t('simple', lang)}</option>
                <option value="normal">{t('normal', lang)}</option>
                <option value="detailed">{t('detailed', lang)}</option>
              </select>
            </div>

            <label className="checkbox-row">
              <input type="checkbox" checked={state.settings.showSurplus} onChange={(e) => patchSettings({ showSurplus: e.target.checked })} />
              {lang === 'ja' ? '余剰ノードを表示' : 'Show surplus nodes'}
            </label>
          </div>
        </section>

        <section className="panel" style={cardStyle}>
          <h2>{t('data', lang)}</h2>
          <div style={fieldStackStyle}>
            <button onClick={() => downloadJson('alchemy-factory-planner-save.json', state)}>
              {t('exportJson', lang)}
            </button>

            <div style={{ display: 'grid', gap: '0.45rem' }}>
              <div style={labelStyle}>{t('importJson', lang)}</div>
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

        <section className="panel" style={{ width: '46rem' }}>
          <h2>{t('abilities', lang)}</h2>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
              gap: '0.9rem 1rem',
            }}
          >
            {ABILITY_IDS.map((id) => (
              <div style={{ display: 'grid', gap: '0.45rem' }} key={id}>
                <div style={labelStyle}>{abilityLabels[id][lang]}</div>
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
