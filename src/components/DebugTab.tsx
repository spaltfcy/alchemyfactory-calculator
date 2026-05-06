import { useState } from 'react';
import type { AppState, Lang } from '../types';
import { calculate, calculateWithDebug, type CalculateInput } from '../engine/calculate';
import { buildFlowGraphSvg } from '../engine/graph';

type DebugTabProps = { lang: Lang; state: AppState; appVersion: string; gameVersion: string; };

type LastSummary = {
  itemCount: number;
  recipeCount: number;
  flowCount: number;
  issueCount: number;
  purchasedAutoCraftableCount: number;
  savedAt: string;
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

function downloadText(filename: string, text: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function shortenText(value: string, limit: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function buildGraphSvg(): string {
  const root = document.querySelector('.react-flow') as HTMLElement | null;
  if (!root) throw new Error('React Flow graph was not found. Open the graph once, then try again.');

  const rootRect = root.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rootRect.width));
  const height = Math.max(1, Math.ceil(rootRect.height));
  const edgeSvg = root.querySelector('.react-flow__edges svg') as SVGSVGElement | null;
  const edgeLayer = edgeSvg ? edgeSvg.innerHTML : '';

  const nodeLayer = Array.from(root.querySelectorAll('.react-flow__node'))
    .map((element) => {
      const node = element as HTMLElement;
      const rect = node.getBoundingClientRect();
      const x = rect.left - rootRect.left;
      const y = rect.top - rootRect.top;
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const title = shortenText(node.innerText || node.textContent || '', 54);
      return [
        '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="10" ry="10" fill="#172131" stroke="#7864bb" stroke-width="1.2"/>',
        '<text x="' + (x + 10).toFixed(1) + '" y="' + (y + 22).toFixed(1) + '" fill="#eef5ff" font-size="12" font-family="Segoe UI, Noto Sans JP, sans-serif" font-weight="700">' + escapeXml(title) + '</text>',
      ].join('\n');
    })
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '">',
    '<rect width="100%" height="100%" fill="#080d15"/>',
    '<g class="edges">',
    edgeLayer,
    '</g>',
    '<g class="nodes">',
    nodeLayer,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}

export function DebugTab({ lang, state, appVersion, gameVersion }: DebugTabProps) {
  const [lastSummary, setLastSummary] = useState<LastSummary | null>(null);
  const [status, setStatus] = useState('');

  const labels =
    lang === 'ja'
      ? {
          title: 'DEBUG',
          items: 'items',
          recipes: 'recipes',
          flows: 'flows',
          issues: 'issues',
          autoBuy: 'auto→buy',
          saveLog: 'ログ保存',
          saveGraph: 'グラフSVG保存',
          notYet: '未生成',
          logSaved: 'ログを保存しました。',
          graphSaved: 'グラフSVGを保存しました。',
          graphFailed: 'グラフSVG保存に失敗しました。',
        }
      : {
          title: 'DEBUG',
          items: 'items',
          recipes: 'recipes',
          flows: 'flows',
          issues: 'issues',
          autoBuy: 'auto→buy',
          saveLog: 'Save log',
          saveGraph: 'Save graph SVG',
          notYet: 'Not generated',
          logSaved: 'Saved log.',
          graphSaved: 'Saved graph SVG.',
          graphFailed: 'Failed to save graph SVG.',
        };

  function buildInput(): CalculateInput {
    return {
      targets: state.targets,
      settings: state.settings,
      abilities: state.abilities,
      recipePreferences: state.recipePreferences,
      surplusPolicies: state.surplusPolicies,
      itemSourceModes: state.itemSourceModes,
    };
  }

  function saveDebugLog(): void {
    const input = buildInput();
    const result = calculate(input);
    const { debugLog } = calculateWithDebug(input);
    const resultWithDebugStatus = result as typeof result & {
      calculationStatus?: 'ok' | 'invalid';
      errorSummaries?: unknown[];
    };
    const debugLogWithOptionalStatus = debugLog as typeof debugLog & {
      calculationStatus?: 'ok' | 'invalid';
      errorSummaries?: unknown[];
    };
    const { calculationStatus: ignoredDebugCalculationStatus, errorSummaries: ignoredDebugErrorSummaries, ...debugLogBody } = debugLogWithOptionalStatus;
    const enrichedDebugLog = {
      appVersion,
      gameVersion,
      debugSchemaVersion: 2,
      calculationStatus: resultWithDebugStatus.calculationStatus ?? ignoredDebugCalculationStatus ?? 'ok',
      errorSummaries: resultWithDebugStatus.errorSummaries ?? ignoredDebugErrorSummaries ?? [],
      ...debugLogBody,
    };
    downloadText(
      'alchemy-factory-calculator-debug-' + timestampForFile() + '.json',
      JSON.stringify(enrichedDebugLog, null, 2),
      'application/json;charset=utf-8',
    );
    setLastSummary({
      itemCount: debugLog.summary.itemCount,
      recipeCount: debugLog.summary.recipeCount,
      flowCount: debugLog.summary.flowCount,
      issueCount: debugLog.issues.length,
      purchasedAutoCraftableCount: debugLog.summary.purchasedAutoCraftableCount,
      savedAt: new Date().toLocaleTimeString(),
    });
    setStatus(labels.logSaved);
  }

  function saveGraphSvg(): void {
    try {
      const result = calculate(buildInput());
      const svg = buildFlowGraphSvg(result, lang, state.settings, state.completedGraphNodeIds);
      downloadText('alchemy-factory-calculator-graph-' + timestampForFile() + '.svg', svg, 'image/svg+xml;charset=utf-8');
      setStatus(labels.graphSaved);
    } catch (error) {
      setStatus(labels.graphFailed + ' ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  const summaryItems = [
    [labels.items, lastSummary ? String(lastSummary.itemCount) : '—'],
    [labels.recipes, lastSummary ? String(lastSummary.recipeCount) : '—'],
    [labels.flows, lastSummary ? String(lastSummary.flowCount) : '—'],
    [labels.issues, lastSummary ? String(lastSummary.issueCount) : '—'],
    [labels.autoBuy, lastSummary ? String(lastSummary.purchasedAutoCraftableCount) : '—'],
  ];

  return (
    <div className="debug-tab panel">
      <div className="debug-tab-header">
        <div>
          <h2>{labels.title}</h2>
          <p className="debug-status">{lastSummary ? lastSummary.savedAt : labels.notYet}</p>
        </div>
        <div className="debug-actions">
          <button type="button" onClick={saveDebugLog}>
            {labels.saveLog}
          </button>
          <button type="button" onClick={saveGraphSvg}>
            {labels.saveGraph}
          </button>
        </div>
      </div>

      <section className="debug-summary compact-debug-summary">
        {summaryItems.map(([label, value]) => (
          <div key={label} className="debug-summary-card">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      {status && <p className="debug-status-line">{status}</p>}
    </div>
  );
}
