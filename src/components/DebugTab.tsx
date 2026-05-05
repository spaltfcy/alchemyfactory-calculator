import { useMemo, useState } from 'react';
import type { AppState, Lang } from '../types';
import { calculateWithDebug, type CalculateInput } from '../engine/calculate';

type DebugTabProps = {
  lang: Lang;
  state: AppState;
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function timestampForFile(): string {
  const now = new Date();
  return (
    String(now.getFullYear()) +
    pad2(now.getMonth() + 1) +
    pad2(now.getDate()) +
    '-' +
    pad2(now.getHours()) +
    pad2(now.getMinutes()) +
    pad2(now.getSeconds())
  );
}

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DebugTab({ lang, state }: DebugTabProps) {
  const [revision, setRevision] = useState(0);

  const input = useMemo<CalculateInput>(() => {
    void revision;
    return {
      targets: state.targets,
      settings: state.settings,
      abilities: state.abilities,
      recipePreferences: state.recipePreferences,
      surplusPolicies: state.surplusPolicies,
      itemSourceModes: state.itemSourceModes,
    };
  }, [revision, state.targets, state.settings, state.abilities, state.recipePreferences, state.surplusPolicies, state.itemSourceModes]);

  const debugResult = useMemo(() => calculateWithDebug(input), [input]);
  const logText = useMemo(() => JSON.stringify(debugResult.debugLog, null, 2), [debugResult]);
  const labels =
    lang === 'ja'
      ? {
          title: 'DEBUGログ',
          description: 'このタブを開いた時だけ再計算して、計算結果・flows・問題候補をJSONログにします。',
          regenerate: 'ログ再生成',
          save: 'ログ保存',
          issues: '問題候補',
          noIssues: '問題候補はありません。',
          summary: '概要',
        }
      : {
          title: 'DEBUG log',
          description: 'This tab recalculates only when opened and exports calculation results, flows, and detected issues as JSON.',
          regenerate: 'Regenerate log',
          save: 'Save log',
          issues: 'Detected issues',
          noIssues: 'No detected issues.',
          summary: 'Summary',
        };

  return (
    <div className="debug-tab">
      <div className="debug-panel">
        <div>
          <h2>{labels.title}</h2>
          <p>{labels.description}</p>
        </div>
        <div className="debug-actions">
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            {labels.regenerate}
          </button>
          <button
            type="button"
            onClick={() => downloadText('alchemy-factory-calculator-debug-' + timestampForFile() + '.json', logText)}
          >
            {labels.save}
          </button>
        </div>
      </div>

      <div className="debug-grid">
        <section className="debug-card">
          <h3>{labels.summary}</h3>
          <dl className="debug-summary-list">
            <div>
              <dt>items</dt>
              <dd>{debugResult.debugLog.summary.itemCount}</dd>
            </div>
            <div>
              <dt>recipes</dt>
              <dd>{debugResult.debugLog.summary.recipeCount}</dd>
            </div>
            <div>
              <dt>flows</dt>
              <dd>{debugResult.debugLog.summary.flowCount}</dd>
            </div>
            <div>
              <dt>auto→buy</dt>
              <dd>{debugResult.debugLog.summary.purchasedAutoCraftableCount}</dd>
            </div>
          </dl>
        </section>

        <section className="debug-card">
          <h3>{labels.issues}</h3>
          {debugResult.debugLog.issues.length === 0 ? (
            <p>{labels.noIssues}</p>
          ) : (
            <ul className="debug-issue-list">
              {debugResult.debugLog.issues.map((issue, index) => (
                <li key={issue.code + '-' + index} className={'debug-issue debug-issue-' + issue.severity}>
                  <strong>{issue.code}</strong>
                  <span>{lang === 'ja' ? issue.messageJa : issue.messageEn}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <textarea className="debug-log-textarea" readOnly spellCheck={false} value={logText} />
    </div>
  );
}
