import type { ChangeEvent } from 'react';
import { useMemo } from 'react';
import { CAULDRON_TARGET_ITEM_IDS, CAULDRON_TARGETS } from '../cauldron/cauldronData';
import { buildCauldronGraphResult, cauldronGraphSummaryText, cauldronRequestFromState } from '../cauldron/cauldronGraph';
import { generateCauldronCandidatesForOutput } from '../cauldron/cauldronMath';
import type { CauldronMachineId, CauldronState } from '../cauldron/cauldronTypes';
import { itemById } from '../data/items';
import { DEFAULT_STATE } from '../defaultState';
import type { Lang } from '../types';
import { text } from '../i18n';
import { formatNumber } from '../utils/format';
import { GraphTab } from './GraphTab';

type CauldronTabProps = {
  lang: Lang;
  state: CauldronState;
  onChange: (nextState: CauldronState) => void;
  appVersion: string;
};

function labelForItem(itemId: string, lang: Lang): string {
  return itemById[itemId] ? text(itemById[itemId].name, lang) : itemId;
}

function numberText(value: number | undefined, digits = 3): string {
  if (value === undefined || !Number.isFinite(value)) return '-';
  return formatNumber(value, digits);
}

function machineLabel(machineId: CauldronMachineId, lang: Lang): string {
  if (machineId === 'advanced_cauldron') return lang === 'ja' ? '高性能錬金釜' : 'Advanced Cauldron';
  return lang === 'ja' ? '錬金釜' : 'Cauldron';
}

export function CauldronTab({ lang, state, onChange, appVersion }: CauldronTabProps) {
  const build = useMemo(() => buildCauldronGraphResult(cauldronRequestFromState(state), state), [state]);
  const candidates = useMemo(
    () => generateCauldronCandidatesForOutput(state.candidateTargetItemId, {
      allowDuplicateInputs: state.allowDuplicateInputs,
      maxCandidates: state.maxCandidates,
    }),
    [state.candidateTargetItemId, state.allowDuplicateInputs, state.maxCandidates],
  );
  const selectedIndex = Math.min(state.candidateIndex, Math.max(0, candidates.length - 1));
  function patch(next: Partial<CauldronState>): void {
    onChange({ ...state, ...next });
  }

  function onTargetChange(event: ChangeEvent<HTMLSelectElement>): void {
    patch({ candidateTargetItemId: event.target.value, candidateIndex: 0 });
  }

  function onMachineChange(event: ChangeEvent<HTMLSelectElement>): void {
    patch({ machineId: event.target.value as CauldronMachineId });
  }

  return (
    <div className="cauldron-tab cauldron-graph-tab">
      <section className="settings-panel cauldron-toolbar">
        <div className="cauldron-toolbar-main">
          <div>
            <h2>{lang === 'ja' ? '錬金釜' : 'Cauldron'}</h2>
            <p>
              {lang === 'ja'
                ? '通常グラフと同じ描画経路で、錬金釜候補だけを独立表示します。通常solver・通常グラフには接続していません。'
                : 'Shows cauldron candidates through the same graph renderer while keeping them isolated from the normal solver and graph.'}
            </p>
          </div>
          <div className="cauldron-version">v{appVersion}</div>
        </div>

        <div className="settings-form-grid cauldron-toolbar-grid">
          <label className="form-field">
            <span>{lang === 'ja' ? '出力' : 'Output'}</span>
            <select value={state.candidateTargetItemId} onChange={onTargetChange}>
              {CAULDRON_TARGET_ITEM_IDS.map((itemId) => (
                <option key={itemId} value={itemId}>
                  {labelForItem(itemId, lang)} / {numberText(CAULDRON_TARGETS[itemId].targetValue, 3)}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>{lang === 'ja' ? '機械' : 'Machine'}</span>
            <select value={state.machineId} onChange={onMachineChange}>
              <option value="cauldron">{machineLabel('cauldron', lang)}</option>
              <option value="advanced_cauldron">{machineLabel('advanced_cauldron', lang)}</option>
            </select>
          </label>

          <label className="form-field">
            <span>{lang === 'ja' ? '候補' : 'Candidate'}</span>
            <select value={selectedIndex} onChange={(event) => patch({ candidateIndex: Number(event.target.value) || 0 })}>
              {candidates.map((candidate, index) => (
                <option key={candidate.id} value={index}>
                  #{index + 1} {candidate.inputItemIds.map((itemId) => labelForItem(itemId, lang)).join(' + ')}
                </option>
              ))}
              {candidates.length === 0 && <option value={0}>{lang === 'ja' ? '候補なし' : 'No candidate'}</option>}
            </select>
          </label>

          <label className="form-field cauldron-small-field">
            <span>{lang === 'ja' ? '最大件数' : 'Max'}</span>
            <input type="number" min={1} max={500} value={state.maxCandidates} onChange={(event) => patch({ maxCandidates: Number(event.target.value) || 1, candidateIndex: 0 })} />
          </label>

          <label className="checkbox-control cauldron-checkbox">
            <input type="checkbox" checked={state.allowDuplicateInputs} onChange={(event) => patch({ allowDuplicateInputs: event.target.checked, candidateIndex: 0 })} />
            <span>{lang === 'ja' ? '重複入力' : 'Duplicate inputs'}</span>
          </label>
        </div>

        <div className="cauldron-toolbar-summary">
          <span>{cauldronGraphSummaryText(build, lang)}</span>
          <span>{lang === 'ja' ? '候補' : 'Candidate'} {selectedIndex + 1}/{Math.max(1, candidates.length)}</span>
        </div>
      </section>

      <GraphTab
        lang={lang}
        result={build.result}
        settings={DEFAULT_STATE.settings}
        completedGraphNodeIds={{}}
        onToggleCompleted={() => undefined}
        debug={false}
      />
    </div>
  );
}
