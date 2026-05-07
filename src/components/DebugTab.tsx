import { useRef, useState, type ChangeEvent } from 'react';
import JSZip from 'jszip';
import type { AppState, Lang } from '../types';
import { calculate, calculateWithDebug, type CalculateInput } from '../engine/calculate';
import { buildFlowGraphSvg } from '../engine/graph';

type DebugTabProps = {
  lang: Lang;
  state: AppState;
  setState: (next: AppState) => void;
  appVersion: string;
  gameVersion: string;
};

type LastSummary = {
  itemCount: number;
  recipeCount: number;
  flowCount: number;
  issueCount: number;
  purchasedAutoCraftableCount: number;
  savedAt: string;
};

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

type DebugIssueLike = {
  code?: string;
  data?: unknown;
  [key: string]: unknown;
};

type DebugCycleCandidateLike = {
  cycleTextJa?: string;
  cycleTextEn?: string;
  steps?: Array<{
    recipeId?: string;
    recipeNameJa?: string;
    viaItemId?: string;
    viaItemNameJa?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
};

type LiveGraphFile = { extension: 'png' | 'svg'; blob: Blob };

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
  downloadBlob(filename, blob);
}

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilePart(value: string): string {
  const cleaned = value
    .replace(/\.[^.\\/]+$/u, '')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'debug-input';
}

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

function mergeImportedState(current: AppState, imported: Partial<AppState>): AppState {
  return {
    ...current,
    ...imported,
    activeTab: 'graph',
    settings: {
      ...current.settings,
      ...(imported.settings ?? {}),
      fuel: {
        ...(current.settings.fuel ?? {}),
        ...(imported.settings?.fuel ?? {}),
      },
      fertilizer: {
        ...(current.settings.fertilizer ?? {}),
        ...(imported.settings?.fertilizer ?? {}),
      },
    },
    abilities: {
      ...current.abilities,
      ...(imported.abilities ?? {}),
    },
    recipePreferences: {
      ...current.recipePreferences,
      ...(imported.recipePreferences ?? {}),
    },
    surplusPolicies: {
      ...current.surplusPolicies,
      ...(imported.surplusPolicies ?? {}),
    },
    itemSourceModes: {
      ...current.itemSourceModes,
      ...(imported.itemSourceModes ?? {}),
    },
    completedGraphNodeIds: {
      ...current.completedGraphNodeIds,
      ...(imported.completedGraphNodeIds ?? {}),
    },
    nodeNotes: {
      ...current.nodeNotes,
      ...(imported.nodeNotes ?? {}),
    },
  };
}

function buildInputFromState(sourceState: AppState): CalculateInput {
  return {
    targets: sourceState.targets.map((target) => ({
      ...target,
      recipeId: sourceState.recipePreferences[target.outputItemId] ?? target.recipeId,
    })),
    settings: sourceState.settings,
    abilities: sourceState.abilities,
    recipePreferences: sourceState.recipePreferences,
    surplusPolicies: sourceState.surplusPolicies,
    itemSourceModes: sourceState.itemSourceModes,
  };
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function waitAnimationFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForGraphRender(timeoutMs = 15000): Promise<void> {
  const startedAt = performance.now();
  let stableCount = 0;
  let lastSignature = '';

  while (performance.now() - startedAt < timeoutMs) {
    await waitAnimationFrame();
    await waitAnimationFrame();

    const root = document.querySelector('.flow-wrap') as HTMLElement | null;
    const nodes = Array.from(document.querySelectorAll('.flow-wrap .react-flow__node')) as HTMLElement[];
    const edges = Array.from(document.querySelectorAll('.flow-wrap .react-flow__edge')) as HTMLElement[];
    const errorPanel = document.querySelector('.graph-error-panel');
    const updatingText = root?.textContent?.includes('更新中') || root?.textContent?.includes('Updating');

    if (!root || updatingText) {
      stableCount = 0;
      continue;
    }

    const signature = nodes.length + ':' + edges.length + ':' + (errorPanel ? 'error' : 'ok');
    if (signature === lastSignature && (nodes.length > 0 || errorPanel)) {
      stableCount += 1;
    } else {
      stableCount = 0;
      lastSignature = signature;
    }

    if (stableCount >= 3) {
      await waitMs(150);
      return;
    }
  }

  throw new Error('Timed out while waiting for the graph to finish rendering.');
}

function captureLiveGraphFile(): Promise<LiveGraphFile> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Timed out while capturing live graph')), 8000);
    window.dispatchEvent(
      new CustomEvent('alchemyfactory:capture-live-graph', {
        detail: {
          resolve: (file: LiveGraphFile) => {
            window.clearTimeout(timeout);
            resolve(file);
          },
          reject: (error: unknown) => {
            window.clearTimeout(timeout);
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        },
      }),
    );
  });
}

export function DebugTab({ lang, state, setState, appVersion, gameVersion }: DebugTabProps) {
  const zipInputRef = useRef<HTMLInputElement | null>(null);
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
          saveZip: '検証JSON読込&ログ保存',
          notYet: '未生成',
          logSaved: 'ログを保存しました。',
          graphSaved: 'グラフSVGを保存しました。',
          graphFailed: 'グラフSVG保存に失敗しました。',
          zipSelectFailed: '検証JSONの読込に失敗しました。',
          zipSaved: '検証ZIPを保存しました。',
          zipFailed: '検証ZIP保存に失敗しました。',
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
          saveZip: 'Load verification JSON & save logs',
          notYet: 'Not generated',
          logSaved: 'Saved log.',
          graphSaved: 'Saved graph SVG.',
          graphFailed: 'Failed to save graph SVG.',
          zipSelectFailed: 'Failed to read verification JSON.',
          zipSaved: 'Saved verification ZIP.',
          zipFailed: 'Failed to save verification ZIP.',
        };

  function buildDebugArtifact(sourceState: AppState) {
    const input = buildInputFromState(sourceState);
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
      debugSchemaVersion: 4,
      calculationStatus: resultWithDebugStatus.calculationStatus ?? ignoredDebugCalculationStatus ?? 'ok',
      errorSummaries: normalizedErrorSummaries,
      ...debugLogBody,
      issues: normalizedIssues,
    };
    const resultForSvg = {
      ...result,
      errorSummaries: normalizedErrorSummaries,
    };

    return {
      input,
      result,
      resultForSvg,
      debugLog,
      normalizedIssues,
      enrichedDebugLog,
    };
  }

  function refreshSummary(artifact: ReturnType<typeof buildDebugArtifact>) {
    setLastSummary({
      itemCount: artifact.debugLog.summary.itemCount,
      recipeCount: artifact.debugLog.summary.recipeCount,
      flowCount: artifact.debugLog.summary.flowCount,
      issueCount: artifact.normalizedIssues.length,
      purchasedAutoCraftableCount: artifact.debugLog.summary.purchasedAutoCraftableCount,
      savedAt: new Date().toLocaleTimeString(),
    });
  }

  function saveDebugLog(): void {
    const artifact = buildDebugArtifact(state);
    downloadText(
      'alchemy-factory-calculator-debug-' + timestampForFile() + '.json',
      JSON.stringify(artifact.enrichedDebugLog, null, 2),
      'application/json;charset=utf-8',
    );
    refreshSummary(artifact);
    setStatus(labels.logSaved);
  }

  function saveGraphSvg(): void {
    try {
      const artifact = buildDebugArtifact(state);
      const svg = buildFlowGraphSvg(
        artifact.resultForSvg as typeof artifact.result,
        lang,
        state.settings,
        state.completedGraphNodeIds,
      );
      downloadText('alchemy-factory-calculator-graph-' + timestampForFile() + '.svg', svg, 'image/svg+xml;charset=utf-8');
      setStatus(labels.graphSaved);
    } catch (error) {
      setStatus(labels.graphFailed + ' ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async function saveVerificationZipFromFile(file: File): Promise<void> {
    const baseName = safeFilePart(file.name);
    const raw = await file.text();
    const imported = JSON.parse(raw) as Partial<AppState>;
    const importedState = mergeImportedState(state, imported);
    const artifact = buildDebugArtifact(importedState);
    const timestamp = timestampForFile();

    setStatus(lang === 'ja' ? '検証JSONを反映してグラフ描画を待っています。' : 'Applied verification JSON. Waiting for graph render.');
    setState(importedState);

    const zip = new JSZip();
    zip.file(baseName + '__source.json', raw);
    zip.file(baseName + '__input.json', JSON.stringify(artifact.input, null, 2));
    zip.file(baseName + '__debug.json', JSON.stringify(artifact.enrichedDebugLog, null, 2));
    zip.file(
      baseName + '__graph.svg',
      buildFlowGraphSvg(artifact.resultForSvg as typeof artifact.result, lang, importedState.settings, importedState.completedGraphNodeIds),
    );

    try {
      await waitForGraphRender();
      const liveGraph = await captureLiveGraphFile();
      zip.file(baseName + '__graph-live.' + liveGraph.extension, liveGraph.blob);
    } catch (error) {
      zip.file(baseName + '__graph-live-error.txt', error instanceof Error ? error.message : String(error));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(baseName + '__verification-' + timestamp + '.zip', blob);
    refreshSummary(artifact);
    setStatus(labels.zipSaved);
  }

  async function onVerificationZipFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      await saveVerificationZipFromFile(file);
    } catch (error) {
      setStatus(labels.zipFailed + ' ' + (error instanceof Error ? error.message : String(error)));
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
    <section className="debug-panel panel">
      <div className="debug-header">
        <h2>{labels.title}</h2>
        <span>{lastSummary ? lastSummary.savedAt : labels.notYet}</span>
      </div>
      <div className="debug-actions">
        <button type="button" onClick={saveDebugLog}>
          {labels.saveLog}
        </button>
        <button type="button" onClick={saveGraphSvg}>
          {labels.saveGraph}
        </button>
        <button type="button" onClick={() => zipInputRef.current?.click()}>
          {labels.saveZip}
        </button>
        <input
          ref={zipInputRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(event) => {
            void onVerificationZipFileChange(event);
          }}
        />
      </div>
      <div className="debug-summary">
        {summaryItems.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      {status && <p className="debug-status">{status}</p>}
    </section>
  );
}
