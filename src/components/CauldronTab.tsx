import type { ChangeEvent } from 'react';
import { ITEMS } from '../data/items';
import { STATIC_CAULDRON_RECIPES, CAULDRON_INPUT_ITEM_IDS, CAULDRON_INPUT_VALUES, CAULDRON_TARGET_ITEM_IDS, CAULDRON_TARGETS } from '../cauldron/cauldronData';
import { cauldronScoreRangeForTarget, generateCauldronCandidatesForOutput, predictCauldron } from '../cauldron/cauldronMath';
import { analyzeCauldronTargets, cauldronItemName, parseItemIdsText, staticNormalRecipeCount } from '../cauldron/cauldronSearch';
import type { CauldronCandidate, CauldronInputTuple, CauldronObservedCase, CauldronPlanItem, CauldronState } from '../cauldron/cauldronTypes';
import type { Lang } from '../types';
import { text } from '../i18n';
import { formatNumber } from '../utils/format';

type CauldronTabProps = {
  lang: Lang;
  state: CauldronState;
  onChange: (nextState: CauldronState) => void;
  appVersion: string;
};

const itemById = Object.fromEntries(ITEMS.map((item) => [item.id, item]));
const selectableItems = ITEMS.filter((item) => !item.internal).sort((a, b) => text(a.name, 'ja').localeCompare(text(b.name, 'ja'), 'ja'));

function labelForItem(itemId: string, lang: Lang): string {
  return itemById[itemId] ? text(itemById[itemId].name, lang) : itemId;
}

function numberText(value: number | undefined, digits = 3): string {
  if (value === undefined || !Number.isFinite(value)) return '-';
  return formatNumber(value, digits);
}

function updateTuple(inputItemIds: CauldronInputTuple, index: number, value: string): CauldronInputTuple {
  const next: CauldronInputTuple = [...inputItemIds] as CauldronInputTuple;
  next[index] = value;
  return next;
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function planStatusLabel(status: CauldronPlanItem['status'], lang: Lang): string {
  const labels: Record<CauldronPlanItem['status'], { ja: string; en: string }> = {
    startup: { ja: '起動入力', en: 'Startup' },
    normal: { ja: '通常', en: 'Normal' },
    cauldronTarget: { ja: '大釜候補', en: 'Cauldron' },
    handCauldron: { ja: '手書き大釜', en: 'Manual cauldron' },
    missing: { ja: '未確認', en: 'Missing' },
    cycle: { ja: '循環', en: 'Cycle' },
    depthLimit: { ja: '深度上限', en: 'Depth limit' },
  };
  return labels[status][lang];
}

function PlanNode({ node, lang, depth = 0 }: { node: CauldronPlanItem; lang: Lang; depth?: number }) {
  return (
    <li className={`cauldron-plan-node cauldron-plan-node-${node.status}`}>
      <div className="cauldron-plan-node-line" style={{ paddingLeft: `${depth * 1.1}rem` }}>
        <span className="cauldron-plan-status">{planStatusLabel(node.status, lang)}</span>
        <strong>{text(node.label, lang)}</strong>
        <span className="cauldron-muted">x{numberText(node.amount, 3)}</span>
        <span className="cauldron-muted">{text(node.reason, lang)}</span>
      </div>
      {node.children.length > 0 && (
        <ul className="cauldron-plan-tree">
          {node.children.map((child, index) => (
            <PlanNode key={`${child.itemId}-${index}-${depth}`} node={child} lang={lang} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

function candidateLine(candidate: CauldronCandidate, lang: Lang): string {
  return `${candidate.inputItemIds.map((itemId) => labelForItem(itemId, lang)).join(' + ')} → ${labelForItem(candidate.outputItemId, lang)}`;
}

export function CauldronTab({ lang, state, onChange, appVersion }: CauldronTabProps) {
  const prediction = predictCauldron(state.inputItemIds);
  const candidates = generateCauldronCandidatesForOutput(state.candidateTargetItemId, {
    allowDuplicateInputs: state.allowDuplicateInputs,
    maxCandidates: state.maxCandidates,
  });
  const selectedCandidate = candidates[0];
  const targetPlans = analyzeCauldronTargets(parseItemIdsText(state.targetItemIdsText), parseItemIdsText(state.startupItemIdsText));
  const currentRange = cauldronScoreRangeForTarget(state.candidateTargetItemId);
  const target = CAULDRON_TARGETS[state.candidateTargetItemId];
  const missingTargetTimeSec = CAULDRON_TARGET_ITEM_IDS.filter((itemId) => CAULDRON_TARGETS[itemId].timeSec === undefined);
  const staticRecipeRows = STATIC_CAULDRON_RECIPES.map((recipe) => ({
    recipe,
    outputItemId: recipe.outputs[0]?.itemId ?? '',
    inputItemIds: recipe.inputs.filter((input) => input.kind !== 'paradoxableItem').map((input) => input.itemId),
  }));

  function patch(next: Partial<CauldronState>): void {
    onChange({ ...state, ...next });
  }

  function exportObservation(): void {
    const observedCase: CauldronObservedCase = {
      id: `cauldron-observed-${new Date().toISOString().replace(/[:.]/g, '-')}`,
      inputItemIds: state.inputItemIds,
      predictedOutputItemId: prediction.outputItemId,
      observedOutputItemId: state.observedOutputItemId || undefined,
      predictedScore: prediction.adjustedScore,
      observedTimeSec: state.observedTimeSec.trim() ? Number(state.observedTimeSec) : undefined,
      observedHeatPerSec: state.observedHeatPerSec.trim() ? Number(state.observedHeatPerSec) : undefined,
      machineId: 'cauldron',
      status: state.observedStatus,
      note: state.observedNote.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    downloadJson(`cauldron-verification-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
      appVersion,
      type: 'cauldron-observed-case',
      observedCase,
    });
  }

  function exportVerificationPack(): void {
    const verificationTargets = targetPlans.map((plan) => ({
      targetItemId: plan.targetItemId,
      status: plan.status,
      confidence: plan.confidence,
      missingItemIds: plan.missingItemIds,
      cauldronCandidateItemIds: plan.cauldronCandidateItemIds,
    }));
    downloadJson(`cauldron-verification-request-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, {
      appVersion,
      type: 'cauldron-verification-request',
      rules: {
        duplicatePenalty: {
          allDifferent: 1,
          twoSame: 0.65,
          threeSame: 0.5,
        },
        tieBreak: 'lower-target-value',
      },
      prediction,
      topCandidate: selectedCandidate,
      verificationTargets,
      missingTargetTimeSec,
      staticCauldronRecipes: staticRecipeRows.map((row) => ({
        recipeId: row.recipe.id,
        inputItemIds: row.inputItemIds,
        outputItemId: row.outputItemId,
        timeSec: row.recipe.timeSec,
      })),
    });
  }

  return (
    <div className="cauldron-tab">
      <section className="settings-panel cauldron-hero">
        <div>
          <h2>{lang === 'ja' ? '大釜' : 'Cauldron'}</h2>
          <p>
            {lang === 'ja'
              ? 'v0.10.0 の大釜タブは、通常グラフ・通常設定・通常 solver から分離した検証台です。未確認値は未確認のまま表示し、ゲーム内確認JSONとして保存できます。'
              : 'The v0.10.0 cauldron tab is isolated from the normal graph, normal settings, and normal solver. Unverified values stay marked as unverified and can be exported as game-check JSON.'}
          </p>
        </div>
        <div className="cauldron-stat-grid">
          <div>
            <strong>{CAULDRON_INPUT_ITEM_IDS.length}</strong>
            <span>{lang === 'ja' ? '入力値' : 'input values'}</span>
          </div>
          <div>
            <strong>{CAULDRON_TARGET_ITEM_IDS.length}</strong>
            <span>{lang === 'ja' ? 'ターゲット値' : 'target values'}</span>
          </div>
          <div>
            <strong>{staticRecipeRows.length}</strong>
            <span>{lang === 'ja' ? '手書き大釜' : 'manual cauldron'}</span>
          </div>
          <div>
            <strong>{staticNormalRecipeCount()}</strong>
            <span>{lang === 'ja' ? '通常レシピ参照' : 'normal recipes read'}</span>
          </div>
        </div>
      </section>

      <div className="cauldron-layout">
        <section className="settings-panel cauldron-panel">
          <h2>{lang === 'ja' ? '3入力 → 予測' : '3 inputs → prediction'}</h2>
          <div className="settings-form-grid cauldron-three-selects">
            {[0, 1, 2].map((index) => (
              <label key={index} className="form-field">
                <span>{lang === 'ja' ? `入力${index + 1}` : `Input ${index + 1}`}</span>
                <select
                  value={state.inputItemIds[index]}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) => patch({ inputItemIds: updateTuple(state.inputItemIds, index, event.target.value) })}
                >
                  {CAULDRON_INPUT_ITEM_IDS.map((itemId) => (
                    <option key={itemId} value={itemId}>
                      {labelForItem(itemId, lang)} / {numberText(CAULDRON_INPUT_VALUES[itemId].value, 3)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="cauldron-result-box">
            <div>
              <span className="cauldron-muted">raw total</span>
              <strong>{numberText(prediction.rawScore, 3)}</strong>
            </div>
            <div>
              <span className="cauldron-muted">penalty</span>
              <strong>{numberText(prediction.duplicatePenalty, 2)}</strong>
            </div>
            <div>
              <span className="cauldron-muted">adjusted score</span>
              <strong>{numberText(prediction.adjustedScore, 3)}</strong>
            </div>
            <div>
              <span className="cauldron-muted">{lang === 'ja' ? '予測出力' : 'predicted output'}</span>
              <strong>{prediction.outputItemId ? labelForItem(prediction.outputItemId, lang) : '-'}</strong>
            </div>
            <div>
              <span className="cauldron-muted">target / distance</span>
              <strong>{numberText(prediction.targetValue, 3)} / {numberText(prediction.distance, 3)}</strong>
            </div>
          </div>

          {prediction.missingInputItemIds.length > 0 && (
            <p className="cauldron-warning">
              {lang === 'ja' ? '大釜入力値が未登録です: ' : 'Missing cauldron input values: '}
              {prediction.missingInputItemIds.join(', ')}
            </p>
          )}

          <h3>{lang === 'ja' ? 'ゲーム内確認メモ' : 'Game check note'}</h3>
          <div className="settings-form-grid cauldron-observed-grid">
            <label className="form-field">
              <span>{lang === 'ja' ? '実測出力' : 'Observed output'}</span>
              <select value={state.observedOutputItemId} onChange={(event) => patch({ observedOutputItemId: event.target.value })}>
                <option value="">-</option>
                {selectableItems.map((item) => (
                  <option key={item.id} value={item.id}>{text(item.name, lang)}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>{lang === 'ja' ? '処理時間 秒' : 'Time sec'}</span>
              <input type="number" value={state.observedTimeSec} onChange={(event) => patch({ observedTimeSec: event.target.value })} />
            </label>
            <label className="form-field">
              <span>{lang === 'ja' ? '熱消費 P/s' : 'Heat P/s'}</span>
              <input type="number" value={state.observedHeatPerSec} onChange={(event) => patch({ observedHeatPerSec: event.target.value })} />
            </label>
            <label className="form-field">
              <span>status</span>
              <select value={state.observedStatus} onChange={(event) => patch({ observedStatus: event.target.value as CauldronState['observedStatus'] })}>
                <option value="todo">todo</option>
                <option value="matched">matched</option>
                <option value="mismatch">mismatch</option>
                <option value="unknown">unknown</option>
              </select>
            </label>
          </div>
          <label className="form-field cauldron-note-field">
            <span>{lang === 'ja' ? 'メモ' : 'Note'}</span>
            <input value={state.observedNote} onChange={(event) => patch({ observedNote: event.target.value })} />
          </label>
          <button type="button" onClick={exportObservation}>{lang === 'ja' ? '確認JSON保存' : 'Save check JSON'}</button>
        </section>

        <section className="settings-panel cauldron-panel">
          <h2>{lang === 'ja' ? 'コスパ候補' : 'Candidate search'}</h2>
          <div className="settings-form-grid cauldron-candidate-controls">
            <label className="form-field">
              <span>{lang === 'ja' ? '出力ターゲット' : 'Output target'}</span>
              <select value={state.candidateTargetItemId} onChange={(event) => patch({ candidateTargetItemId: event.target.value })}>
                {CAULDRON_TARGET_ITEM_IDS.map((itemId) => (
                  <option key={itemId} value={itemId}>
                    {labelForItem(itemId, lang)} / {numberText(CAULDRON_TARGETS[itemId].targetValue, 3)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>{lang === 'ja' ? '最大件数' : 'Max rows'}</span>
              <input type="number" min={1} max={200} value={state.maxCandidates} onChange={(event) => patch({ maxCandidates: Number(event.target.value) || 1 })} />
            </label>
            <label className="checkbox-control cauldron-checkbox">
              <input type="checkbox" checked={state.allowDuplicateInputs} onChange={(event) => patch({ allowDuplicateInputs: event.target.checked })} />
              <span>{lang === 'ja' ? '重複入力を許可' : 'Allow duplicate inputs'}</span>
            </label>
          </div>
          <p className="cauldron-muted">
            {lang === 'ja' ? '有効スコア範囲: ' : 'Score range: '}
            {currentRange?.lowerExclusive === undefined ? '-∞' : `>${numberText(currentRange.lowerExclusive, 3)}`}
            {' ～ '}
            {currentRange?.upperInclusive === undefined ? '+∞' : `≤${numberText(currentRange.upperInclusive, 3)}`}
            {target && ` / target ${numberText(target.targetValue, 3)}`}
          </p>
          <div className="table-wrap cauldron-table-wrap">
            <table className="data-table cauldron-table">
              <thead>
                <tr>
                  <th>{lang === 'ja' ? '候補' : 'Candidate'}</th>
                  <th>score</th>
                  <th>distance</th>
                  <th>{lang === 'ja' ? '効率' : 'eff.'}</th>
                  <th>{lang === 'ja' ? '状態' : 'status'}</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.id} onClick={() => patch({ inputItemIds: candidate.inputItemIds })}>
                    <td>{candidateLine(candidate, lang)}</td>
                    <td>{numberText(candidate.adjustedScore, 3)}</td>
                    <td>{numberText(candidate.distance, 3)}</td>
                    <td>{numberText(candidate.valueEfficiency, 4)}</td>
                    <td>{candidate.targetTimeSec === undefined ? (lang === 'ja' ? '速度未確認' : 'time unknown') : `${numberText(candidate.targetTimeSec, 2)}s`}</td>
                  </tr>
                ))}
                {candidates.length === 0 && (
                  <tr><td colSpan={5}>{lang === 'ja' ? '候補なし。入力値不足か、範囲に入る組み合わせがありません。' : 'No candidates. Input values may be missing or no combination falls into the target range.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="settings-panel cauldron-panel cauldron-plan-panel">
          <h2>{lang === 'ja' ? '指定アイテムs到達判定' : 'Target reachability'}</h2>
          <div className="settings-form-grid cauldron-plan-controls">
            <label className="form-field cauldron-wide-field">
              <span>{lang === 'ja' ? '指定アイテムID（空白/改行/カンマ区切り）' : 'Target item IDs'}</span>
              <input value={state.targetItemIdsText} onChange={(event) => patch({ targetItemIdsText: event.target.value })} />
            </label>
            <label className="form-field cauldron-wide-field">
              <span>{lang === 'ja' ? '起動入力アイテムID' : 'Startup input item IDs'}</span>
              <input value={state.startupItemIdsText} onChange={(event) => patch({ startupItemIdsText: event.target.value })} />
            </label>
          </div>
          <div className="cauldron-plan-list">
            {targetPlans.map((plan) => (
              <article key={plan.targetItemId} className={`cauldron-plan-card cauldron-plan-card-${plan.status}`}>
                <header>
                  <h3>{text(plan.targetLabel, lang)}</h3>
                  <span>{plan.status} / {plan.confidence}</span>
                </header>
                {plan.status !== 'blocked' && (
                  <p className="cauldron-muted">
                    {lang === 'ja'
                      ? '到達可能性は暫定OKです。大釜の速度・熱・肥料/燃料収支が未確認の部分は定常供給判定保留です。'
                      : 'Reachability is provisionally OK. Steady-state supply remains pending where cauldron time, heat, fertilizer, or fuel data is unverified.'}
                  </p>
                )}
                {plan.missingItemIds.length > 0 && (
                  <p className="cauldron-warning">
                    {lang === 'ja' ? '常時供給候補として不足/未確認: ' : 'Missing/unverified as recurring supply: '}
                    {plan.missingItemIds.map((itemId) => labelForItem(itemId, lang)).join(' / ')}
                  </p>
                )}
                <ul className="cauldron-plan-tree">
                  <PlanNode node={plan.root} lang={lang} />
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="settings-panel cauldron-panel">
          <h2>{lang === 'ja' ? '未確認リスト / 検証出力' : 'Unverified list / export'}</h2>
          <ul className="cauldron-check-list">
            <li>{lang === 'ja' ? '大釜出力ごとの timeSec 未確認: ' : 'Targets with unknown timeSec: '} {missingTargetTimeSec.map((itemId) => labelForItem(itemId, lang)).join(' / ') || '-'}</li>
            <li>{lang === 'ja' ? '熱消費は全ターゲット未確認。' : 'Heat consumption is unverified for all targets.'}</li>
            <li>{lang === 'ja' ? '高性能大釜との差、重複ペナルティ、同点低い側ルールは確認対象。' : 'Advanced cauldron differences, duplicate penalty, and low-side tie-break need verification.'}</li>
            <li>{lang === 'ja' ? 'Sol は入力値のみ。大釜出力ターゲットには入れていません。' : 'Sol is treated as an input value only, not as a cauldron output target.'}</li>
          </ul>
          <button type="button" onClick={exportVerificationPack}>{lang === 'ja' ? '検証リクエストJSON保存' : 'Save verification request JSON'}</button>

          <h3>{lang === 'ja' ? '既存の手書き大釜レシピ' : 'Existing manual cauldron recipes'}</h3>
          <div className="table-wrap cauldron-table-wrap">
            <table className="data-table cauldron-table">
              <thead>
                <tr>
                  <th>recipe</th>
                  <th>{lang === 'ja' ? '入力' : 'inputs'}</th>
                  <th>{lang === 'ja' ? '出力' : 'output'}</th>
                  <th>time</th>
                </tr>
              </thead>
              <tbody>
                {staticRecipeRows.map((row) => (
                  <tr key={row.recipe.id}>
                    <td>{row.recipe.id}</td>
                    <td>{row.inputItemIds.map((itemId) => labelForItem(itemId, lang)).join(' + ')}</td>
                    <td>{row.outputItemId ? labelForItem(row.outputItemId, lang) : '-'}</td>
                    <td>{numberText(row.recipe.timeSec, 2)}s</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="settings-panel cauldron-panel cauldron-graph-panel">
          <h2>{lang === 'ja' ? '大釜専用グラフ' : 'Cauldron graph'}</h2>
          <div className="cauldron-graph" aria-label={lang === 'ja' ? '大釜候補グラフ' : 'Cauldron candidate graph'}>
            {state.inputItemIds.map((itemId, index) => (
              <div key={`${itemId}-${index}`} className="cauldron-graph-node cauldron-graph-input">
                <span>{lang === 'ja' ? '入力' : 'Input'} {index + 1}</span>
                <strong>{labelForItem(itemId, lang)}</strong>
                <small>{numberText(CAULDRON_INPUT_VALUES[itemId]?.value, 3)}</small>
              </div>
            ))}
            <div className="cauldron-graph-arrow">→</div>
            <div className="cauldron-graph-node cauldron-graph-cauldron">
              <span>{lang === 'ja' ? '大釜' : 'Cauldron'}</span>
              <strong>{numberText(prediction.adjustedScore, 3)}</strong>
              <small>{lang === 'ja' ? 'score' : 'score'}</small>
            </div>
            <div className="cauldron-graph-arrow">→</div>
            <div className="cauldron-graph-node cauldron-graph-output">
              <span>{lang === 'ja' ? '予測出力' : 'Output'}</span>
              <strong>{prediction.outputItemId ? labelForItem(prediction.outputItemId, lang) : '-'}</strong>
              <small>{numberText(prediction.targetValue, 3)} / Δ {numberText(prediction.distance, 3)}</small>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
