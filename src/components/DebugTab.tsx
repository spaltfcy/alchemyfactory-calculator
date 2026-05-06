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

type CycleErrorSummaryLike = {
  code?: string;
  messageJa?: string;
  messageEn?: string;
  cycleTextJa?: string;
  cycleTextEn?: string;
  itemIds?: string[];
  recipeIds?: string[];
  [key: string]: unknown;
};

function splitCycleText(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\s*(?:->|→)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function compactAdjacentCycleParts(parts: string[]): string[] {
  const compacted: string[] = [];
  for (const part of parts) {
    if (compacted[compacted.length - 1] !== part) compacted.push(part);
  }
  return compacted;
}

function rotateClosedCycleParts(parts: string[], preferredStart: string): string[] {
  if (parts.length <= 1) return parts;
  const closed = parts[0] === parts[parts.length - 1];
  const body = closed ? parts.slice(0, -1) : [...parts];
  const index = body.indexOf(preferredStart);
  if (index <= 0) return closed ? [...body, body[0]] : body;
  const rotated = [...body.slice(index), ...body.slice(0, index)];
  return closed ? [...rotated, rotated[0]] : rotated;
}

function choosePreferredCycleStartJa(parts: string[]): string | undefined {
  if (parts.includes('火薬') && parts.includes('生石灰') && parts.includes('石灰水')) return '火薬';
  if (parts.includes('木炭の粉末') && parts.includes('木炭')) return '木炭の粉末';
  return parts[0];
}

function choosePreferredCycleStartEn(parts: string[]): string | undefined {
  if (parts.includes('Black Powder') && parts.includes('Quicklime') && parts.includes('Limewater')) return 'Black Powder';
  if (parts.includes('Charcoal Powder') && parts.includes('Charcoal')) return 'Charcoal Powder';
  return parts[0];
}

function formatCycleText(value: unknown, lang: 'ja' | 'en'): string | undefined {
  const parts = compactAdjacentCycleParts(splitCycleText(value));
  if (parts.length === 0) return undefined;
  const preferred = lang === 'ja' ? choosePreferredCycleStartJa(parts) : choosePreferredCycleStartEn(parts);
  const rotated = preferred ? rotateClosedCycleParts(parts, preferred) : parts;
  return rotated.join(lang === 'ja' ? ' → ' : ' -> ');
}

function cycleHeadFromText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.split(/\s*(?:->|→)\s*/g).map((part) => part.trim()).find(Boolean);
}

function normalizeCycleErrorSummary(summary: CycleErrorSummaryLike): CycleErrorSummaryLike {
  if (summary.code !== 'RECIPE_CYCLE_INVALID') return summary;

  const cycleTextJa = formatCycleText(summary.cycleTextJa, 'ja');
  const cycleTextEn = formatCycleText(summary.cycleTextEn, 'en');
  const headJa = cycleHeadFromText(cycleTextJa);
  const headEn = cycleHeadFromText(cycleTextEn);

  return {
    ...summary,
    messageJa: headJa ? headJa + 'が循環しています。' : summary.messageJa,
    messageEn: headEn ? headEn + ' is in a recipe cycle.' : summary.messageEn,
    cycleTextJa: cycleTextJa ?? summary.cycleTextJa,
    cycleTextEn: cycleTextEn ?? summary.cycleTextEn,
  };
}

function cycleCanonicalKey(summary: CycleErrorSummaryLike): string {
  if (summary.code !== 'RECIPE_CYCLE_INVALID') return String(summary.code ?? '') + ':' + String(summary.messageJa ?? '');
  const itemIds = Array.isArray(summary.itemIds) ? [...summary.itemIds].sort().join(',') : '';
  const recipeIds = Array.isArray(summary.recipeIds) ? [...summary.recipeIds].sort().join(',') : '';
  return summary.code + ':' + itemIds + ':' + recipeIds;
}

function normalizeCycleErrorSummaries(errorSummaries: unknown): CycleErrorSummaryLike[] {
  if (!Array.isArray(errorSummaries)) return [];
  const normalized: CycleErrorSummaryLike[] = [];
  const seen = new Set<string>();

  for (const rawSummary of errorSummaries) {
    if (!rawSummary || typeof rawSummary !== 'object') continue;
    const summary = normalizeCycleErrorSummary(rawSummary as CycleErrorSummaryLike);
    const key = cycleCanonicalKey(summary);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(summary);
  }

  return normalized;
}


type DebugIssueLike = {
  code?: string;
  data?: unknown;
  [key: string]: unknown;
};

type DebugCycleCandidateLike = {
  cycleTextJa?: string;
  cycleTextEn?: string;
  steps?: Array<{ recipeId?: string; recipeNameJa?: string; viaItemId?: string; viaItemNameJa?: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

function cycleCandidateKey(candidate: DebugCycleCandidateLike): string {
  if (Array.isArray(candidate.steps) && candidate.steps.length > 0) {
    const recipeIds = candidate.steps.map((step) => step.recipeId).filter(Boolean).sort().join(',');
    const itemIds = candidate.steps.map((step) => step.viaItemId).filter(Boolean).sort().join(',');
    return recipeIds + ':' + itemIds;
  }
  return String(candidate.cycleTextJa ?? candidate.cycleTextEn ?? '');
}

function normalizeDebugCycleCandidate(candidate: DebugCycleCandidateLike): DebugCycleCandidateLike {
  return {
    ...candidate,
    cycleTextJa: formatCycleText(candidate.cycleTextJa, 'ja') ?? candidate.cycleTextJa,
    cycleTextEn: formatCycleText(candidate.cycleTextEn, 'en') ?? candidate.cycleTextEn,
  };
}

function normalizeDebugIssues(issues: unknown): unknown[] {
  if (!Array.isArray(issues)) return [];
  return issues.map((rawIssue) => {
    if (!rawIssue || typeof rawIssue !== 'object') return rawIssue;
    const issue = rawIssue as DebugIssueLike;
    if (issue.code !== 'SUSPECT_RECIPE_CYCLE_WITH_INVALID_NUMBERS' || !Array.isArray(issue.data)) return issue;

    const normalizedData: DebugCycleCandidateLike[] = [];
    const seen = new Set<string>();
    for (const rawCandidate of issue.data) {
      if (!rawCandidate || typeof rawCandidate !== 'object') continue;
      const candidate = normalizeDebugCycleCandidate(rawCandidate as DebugCycleCandidateLike);
      const key = cycleCandidateKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      normalizedData.push(candidate);
    }

    return {
      ...issue,
      data: normalizedData,
    };
  });
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
      targets: state.targets.map((target) => ({
        ...target,
        recipeId: state.recipePreferences[target.outputItemId] ?? target.recipeId,
      })),
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
    const {
      calculationStatus: ignoredDebugCalculationStatus,
      errorSummaries: ignoredDebugErrorSummaries,
      ...debugLogBody
    } = debugLogWithOptionalStatus;
    const normalizedIssues = normalizeDebugIssues(debugLog.issues);
    const normalizedErrorSummaries = normalizeCycleErrorSummaries(
      resultWithDebugStatus.errorSummaries ?? ignoredDebugErrorSummaries ?? [],
    );
    const enrichedDebugLog = {
      appVersion,
      gameVersion,
      debugSchemaVersion: 3,
      calculationStatus: resultWithDebugStatus.calculationStatus ?? ignoredDebugCalculationStatus ?? 'ok',
      errorSummaries: normalizedErrorSummaries,
      ...debugLogBody,
      issues: normalizedIssues,
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
      issueCount: normalizedIssues.length,
      purchasedAutoCraftableCount: debugLog.summary.purchasedAutoCraftableCount,
      savedAt: new Date().toLocaleTimeString(),
    });
    setStatus(labels.logSaved);
  }

  function saveGraphSvg(): void {
    try {
      const result = calculate(buildInput());
      const resultForSvg = {
        ...result,
        errorSummaries: normalizeCycleErrorSummaries(
          (result as typeof result & { errorSummaries?: unknown[] }).errorSummaries ?? [],
        ),
      };
      const svg = buildFlowGraphSvg(resultForSvg as typeof result, lang, state.settings, state.completedGraphNodeIds);
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
