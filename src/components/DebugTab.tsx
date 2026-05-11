import { useRef, useState, type ChangeEvent } from 'react';
import JSZip from 'jszip';
import type { AppState, Lang } from '../types';
import { DEFAULT_STATE } from '../defaultState';
import { buildNegativeTargetWarningInput, filterPositiveTargets, sanitizeNegativeTargets, type NegativeTargetEntry } from '../engine/targetValidation';
import { calculationInvalidPersistentError, createUserMessage, verificationErrorMessage, type UserMessageInput, type UserMessageLog } from '../utils/userMessages';
import { calculateWithDebug, type CalculateInput } from '../engine/calculate';
import { getMachinePreferences } from '../data/machinePreferences';
import { getParadoxSettings, isParadoxableItem } from '../data/paradox';
import { normalizeAbilitySettings } from '../data/abilityTables';
import { buildFlowGraphSvg } from '../engine/graph';

type DebugTabProps = {
  lang: Lang;
  state: AppState;
  setState: (next: AppState) => void;
  appVersion: string;
  gameVersion: string;
  userMessages: UserMessageLog[];
  onUserMessage?: (input: UserMessageInput) => UserMessageLog;
  onBeginJsonImport?: () => void;
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

type VerificationSourceFile = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  raw?: string;
  originalFile?: File;
};

type VerificationZipResult = {
  sourceFileName: string;
  resultZipName: string;
  blob: Blob;
  status: 'ok' | 'invalid' | 'error';
  phase: string;
  code?: string;
  messageJa?: string;
  messageEn?: string;
  calculationStatus?: string;
  flowCount?: number;
  issueCount?: number;
  errorSummaryCount?: number;
  currentRunMessageCount: number;
  previousMessageCount: number;
  allMessageCount: number;
  negativeTargetCount: number;
};

function createRunId(prefix = 'run'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return prefix + '-' + crypto.randomUUID();
  }
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

function shouldIncludeVerificationJsonEntry(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  const lower = normalized.toLowerCase();
  if (!lower.endsWith('.json')) return false;
  if (lower.endsWith('.manual.json')) return false;
  if (lower.includes('__macosx/') || lower.endsWith('/.ds_store')) return false;
  const fileName = lower.split('/').pop() ?? lower;
  if (fileName.startsWith('.')) return false;
  return true;
}

function sourceFileFromFile(file: File): VerificationSourceFile {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    originalFile: file,
  };
}

function sourceFileFromZipEntry(name: string, raw: string, batchFile: File): VerificationSourceFile {
  return {
    name,
    size: raw.length,
    type: 'application/json',
    lastModified: batchFile.lastModified,
    raw,
  };
}

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

function isUnsupportedImportedState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const candidate = value as {
    itemSourceModes?: unknown;
    stockOverrides?: unknown;
    settings?: {
      paradox?: { oblivionInputItemId?: unknown };
      fuel?: { fuelSourceMode?: unknown };
      fertilizer?: { fertilizerSourceMode?: unknown };
    };
    version?: unknown;
  };
  const paradoxItemId = candidate.settings?.paradox?.oblivionInputItemId;
  return (
    candidate.itemSourceModes !== undefined ||
    candidate.stockOverrides !== undefined ||
    candidate.settings?.fuel?.fuelSourceMode !== undefined ||
    candidate.settings?.fertilizer?.fertilizerSourceMode !== undefined ||
    candidate.version !== DEFAULT_STATE.version ||
    typeof paradoxItemId !== 'string' ||
    !isParadoxableItem(paradoxItemId)
  );
}

function unsupportedImportMessage(lang: Lang): string {
  return lang === 'ja'
    ? 'このJSONは現行バージョン形式ではないため読み込めません。現行バージョンで保存したJSONを使用してください。'
    : 'This JSON is not in the current version format and cannot be imported. Please use a JSON saved by the current version.';
}

function mergeImportedState(current: AppState, imported: Partial<AppState>): AppState {
  return {
    ...current,
    ...imported,
    // Verification/log import must never move the visible tab.
    activeTab: current.activeTab,
    settings: {
      ...current.settings,
      ...(imported.settings ?? {}),
      machinePreferences: {
        ...getMachinePreferences(current.settings),
        ...(imported.settings?.machinePreferences ?? {}),
      },
      paradox: getParadoxSettings(imported.settings),
      fuel: {
        ...(current.settings.fuel ?? {}),
        ...(imported.settings?.fuel ?? {}),
      },
      fertilizer: {
        ...(current.settings.fertilizer ?? {}),
        ...(imported.settings?.fertilizer ?? {}),
      },
    },
    abilities: normalizeAbilitySettings({ ...current.abilities, ...(imported.abilities ?? {}) }),
    recipePreferences: imported.recipePreferences ?? {},
    surplusPolicies: imported.surplusPolicies ?? {},
    completedGraphNodeIds: imported.completedGraphNodeIds ?? {},
    nodeNotes: imported.nodeNotes ?? {},
  };
}

function buildInputFromState(sourceState: AppState): CalculateInput {
  return {
    targets: filterPositiveTargets(
      sourceState.targets.map((target) => ({
        ...target,
        recipeId: sourceState.recipePreferences[target.outputItemId] ?? target.recipeId,
      })),
    ),
    settings: sourceState.settings,
    abilities: sourceState.abilities,
    recipePreferences: sourceState.recipePreferences,
    surplusPolicies: sourceState.surplusPolicies,
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
    if (signature === lastSignature && (nodes.length > 0 || errorPanel || edges.length === 0)) {
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

export function DebugTab({ lang, state, setState, appVersion, gameVersion, userMessages, onUserMessage, onBeginJsonImport }: DebugTabProps) {
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
          saveZip: '検証JSON/ZIP読込&ログ保存',
          notYet: '未生成',
          logSaved: 'ログを保存しました。',
          graphSaved: 'グラフSVGを保存しました。',
          graphFailed: 'グラフSVG保存に失敗しました。',
          zipSelectFailed: '検証JSONの読込に失敗しました。',
          zipSaved: '検証ZIPを保存しました。',
          zipSavedInvalid: '検証ZIPを保存しました（計算不能の詳細JSONを含みます）。',
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
          saveZip: 'Load verification JSON/ZIP & save logs',
          notYet: 'Not generated',
          logSaved: 'Saved log.',
          graphSaved: 'Saved graph SVG.',
          graphFailed: 'Failed to save graph SVG.',
          zipSelectFailed: 'Failed to read verification JSON.',
          zipSaved: 'Saved verification ZIP.',
          zipSavedInvalid: 'Saved verification ZIP with invalid calculation details.',
          zipFailed: 'Failed to save verification ZIP.',
        };

  function combineMessageLogs(currentRunMessageLogs: UserMessageLog[] = []): { currentRunMessageLogs: UserMessageLog[]; allMessageLogs: UserMessageLog[] } {
    const seen = new Set<string>();
    const allMessageLogs = [...currentRunMessageLogs, ...userMessages].filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    });
    return { currentRunMessageLogs, allMessageLogs };
  }

  function emitUserMessage(input: UserMessageInput): UserMessageLog {
    return onUserMessage?.(input) ?? createUserMessage(input);
  }

  function buildDebugArtifact(sourceState: AppState, userMessageLogs: UserMessageLog[] = userMessages, currentRunMessageLogs: UserMessageLog[] = []) {
    const input = buildInputFromState(sourceState);
    const { result, debugLog } = calculateWithDebug(input);
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
      debugSchemaVersion: 25,
      calculationStatus: resultWithDebugStatus.calculationStatus ?? ignoredDebugCalculationStatus ?? 'ok',
      errorSummaries: normalizedErrorSummaries,
      ...debugLogBody,
      issues: normalizedIssues,
      currentRunMessageLogs,
      allMessageLogs: userMessageLogs,
      userMessageLogs,
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

  function fileInfo(file: VerificationSourceFile) {
    return {
      name: file.name,
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
      lastModifiedIso: Number.isFinite(file.lastModified) ? new Date(file.lastModified).toISOString() : undefined,
    };
  }

  function exceptionInfo(error: unknown) {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return {
      name: typeof error,
      message: String(error),
    };
  }

  function stateSummary(sourceState: Partial<AppState> | undefined) {
    const targets = Array.isArray(sourceState?.targets) ? sourceState.targets : [];
    return {
      version: sourceState?.version,
      language: sourceState?.language,
      activeTab: sourceState?.activeTab,
      targetCount: targets.length,
      positiveTargetCount: targets.filter((target) => Number.isFinite(Number(target.value)) && Number(target.value) > 0).length,
      enabledTargetCount: targets.filter((target) => target.enabled !== false).length,
      disabledTargetCount: targets.filter((target) => target.enabled === false).length,
      enabledPositiveTargetCount: targets.filter((target) => target.enabled !== false && Number.isFinite(Number(target.value)) && Number(target.value) > 0).length,
      zeroTargetCount: targets.filter((target) => Number(target.value) === 0).length,
      negativeTargetCount: targets.filter((target) => Number.isFinite(Number(target.value)) && Number(target.value) < 0).length,
      targetPreview: targets.slice(0, 20).map((target) => ({
        id: target.id,
        enabled: target.enabled ?? true,
        recipeId: target.recipeId,
        outputItemId: target.outputItemId,
        mode: target.mode,
        value: target.value,
      })),
    };
  }

  function buildVerificationErrorSummary(args: {
    status: 'error' | 'invalid';
    phase: string;
    code: string;
    messageJa: string;
    messageEn: string;
    file: VerificationSourceFile;
    error?: unknown;
    importedState?: Partial<AppState>;
    input?: CalculateInput;
    artifact?: ReturnType<typeof buildDebugArtifact>;
    negativeTargets?: NegativeTargetEntry[];
    currentRunMessageLogs?: UserMessageLog[];
    userMessageLogs?: UserMessageLog[];
  }) {
    const enriched = args.artifact?.enrichedDebugLog as {
      calculationStatus?: string;
      errorSummaries?: unknown[];
      warnings?: unknown[];
      issues?: unknown[];
      residualUnresolvedFlows?: unknown[];
      totals?: unknown;
      summary?: unknown;
    } | undefined;

    return {
      appVersion,
      gameVersion,
      debugSchemaVersion: 25,
      status: args.status,
      phase: args.phase,
      code: args.code,
      messageJa: args.messageJa,
      messageEn: args.messageEn,
      createdAt: new Date().toISOString(),
      file: fileInfo(args.file),
      environment: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        locationHash: window.location.hash,
      },
      exception: args.error === undefined ? undefined : exceptionInfo(args.error),
      inputSummary: args.input ? stateSummary({ ...state, targets: args.input.targets }) : stateSummary(args.importedState),
      calculationStatus: enriched?.calculationStatus,
      errorSummaries: enriched?.errorSummaries ?? [],
      warnings: enriched?.warnings ?? [],
      issues: enriched?.issues ?? [],
      residualUnresolvedFlows: enriched?.residualUnresolvedFlows ?? [],
      totals: enriched?.totals,
      summary: enriched?.summary,
      negativeTargets: args.negativeTargets ?? [],
      currentRunMessageLogs: args.currentRunMessageLogs ?? [],
      allMessageLogs: args.userMessageLogs ?? userMessages,
      userMessageLogs: args.userMessageLogs ?? userMessages,
      diagnostics: {
        primaryFailure: {
          status: args.status,
          phase: args.phase,
          code: args.code,
          messageJa: args.messageJa,
          messageEn: args.messageEn,
        },
        includedFiles: {
          sourceJson: true,
          inputJson: Boolean(args.artifact),
          debugJson: Boolean(args.artifact),
          userMessageLogJson: true,
          errorSummaryJson: true,
        },
        inputState: stateSummary(args.importedState),
        sanitizedInput: args.input ? stateSummary({ ...state, targets: args.input.targets }) : undefined,
        targetValidation: {
          negativeTargetCount: args.negativeTargets?.length ?? 0,
          negativeTargets: args.negativeTargets ?? [],
        },
        messageLog: {
          currentRunCount: (args.currentRunMessageLogs ?? []).length,
          currentRun: (args.currentRunMessageLogs ?? []).slice(0, 30),
          allCount: (args.userMessageLogs ?? userMessages).length,
          previousCount: Math.max(0, (args.userMessageLogs ?? userMessages).length - (args.currentRunMessageLogs ?? []).length),
          recentAll: (args.userMessageLogs ?? userMessages).slice(0, 30),
        },
        calculation: {
          status: enriched?.calculationStatus,
          errorSummaryCount: Array.isArray(enriched?.errorSummaries) ? enriched.errorSummaries.length : 0,
          issueCount: Array.isArray(enriched?.issues) ? enriched.issues.length : 0,
          warningCount: Array.isArray(enriched?.warnings) ? enriched.warnings.length : 0,
          residualUnresolvedFlowCount: Array.isArray(enriched?.residualUnresolvedFlows) ? enriched.residualUnresolvedFlows.length : 0,
        },
      },
    };
  }

  async function buildVerificationErrorZipBlob(args: {
    file: VerificationSourceFile;
    baseName: string;
    raw?: string;
    status: 'error' | 'invalid';
    phase: string;
    code: string;
    messageJa: string;
    messageEn: string;
    error?: unknown;
    importedState?: Partial<AppState>;
    input?: CalculateInput;
    artifact?: ReturnType<typeof buildDebugArtifact>;
    negativeTargets?: NegativeTargetEntry[];
    currentRunMessageLogs?: UserMessageLog[];
    userMessageLogs?: UserMessageLog[];
  }): Promise<Blob> {
    const zip = new JSZip();
    if (args.raw !== undefined) zip.file(args.baseName + '__source.json', args.raw);
    zip.file(
      args.baseName + '__error-summary.json',
      JSON.stringify(
        buildVerificationErrorSummary({
          status: args.status,
          phase: args.phase,
          code: args.code,
          messageJa: args.messageJa,
          messageEn: args.messageEn,
          file: args.file,
          error: args.error,
          importedState: args.importedState,
          input: args.input,
          artifact: args.artifact,
          negativeTargets: args.negativeTargets,
          currentRunMessageLogs: args.currentRunMessageLogs,
          userMessageLogs: args.userMessageLogs,
        }),
        null,
        2,
      ),
    );
    zip.file(
      args.baseName + '__user-message-log.json',
      JSON.stringify({
        currentRunMessageLogs: args.currentRunMessageLogs ?? [],
        allMessageLogs: args.userMessageLogs ?? userMessages,
        previousMessageCount: Math.max(0, ((args.userMessageLogs ?? userMessages).length) - ((args.currentRunMessageLogs ?? []).length)),
      }, null, 2),
    );
    if (args.artifact) {
      zip.file(args.baseName + '__input.json', JSON.stringify(args.artifact.input, null, 2));
      zip.file(args.baseName + '__debug.json', JSON.stringify(args.artifact.enrichedDebugLog, null, 2));
    }
    return zip.generateAsync({ type: 'blob' });
  }

  function messageWithRun(input: UserMessageInput, runId: string, sourceFileName: string): UserMessageInput {
    return {
      ...input,
      source: {
        ...(input.source ?? {}),
        runId,
        sourceFileName: input.source?.sourceFileName ?? sourceFileName,
      },
    };
  }

  function verificationResultSummary(args: {
    source: VerificationSourceFile;
    resultZipName: string;
    blob: Blob;
    status: 'ok' | 'invalid' | 'error';
    phase: string;
    code?: string;
    messageJa?: string;
    messageEn?: string;
    artifact?: ReturnType<typeof buildDebugArtifact>;
    currentRunMessageLogs?: UserMessageLog[];
    allMessageLogs?: UserMessageLog[];
    negativeTargets?: NegativeTargetEntry[];
  }): VerificationZipResult {
    const errorSummaries = (args.artifact?.enrichedDebugLog as { errorSummaries?: unknown[] } | undefined)?.errorSummaries;
    return {
      sourceFileName: args.source.name,
      resultZipName: args.resultZipName,
      blob: args.blob,
      status: args.status,
      phase: args.phase,
      code: args.code,
      messageJa: args.messageJa,
      messageEn: args.messageEn,
      calculationStatus: args.artifact?.enrichedDebugLog.calculationStatus,
      flowCount: args.artifact?.debugLog.summary.flowCount,
      issueCount: args.artifact?.normalizedIssues.length,
      errorSummaryCount: Array.isArray(errorSummaries) ? errorSummaries.length : undefined,
      currentRunMessageCount: args.currentRunMessageLogs?.length ?? 0,
      allMessageCount: args.allMessageLogs?.length ?? userMessages.length,
      previousMessageCount: Math.max(0, (args.allMessageLogs?.length ?? userMessages.length) - (args.currentRunMessageLogs?.length ?? 0)),
      negativeTargetCount: args.negativeTargets?.length ?? 0,
    };
  }

  async function buildVerificationZipFromSource(source: VerificationSourceFile, options: { resetMessages?: boolean; applyState?: boolean; captureLiveGraph?: boolean } = {}): Promise<VerificationZipResult> {
    const baseName = safeFilePart(source.name);
    const timestamp = timestampForFile();
    const runId = createRunId('verification');
    if (options.resetMessages !== false) onBeginJsonImport?.();

    let raw = source.raw ?? '';
    let imported: Partial<AppState> | undefined;

    if (source.raw === undefined) {
      try {
        raw = await source.originalFile?.text() ?? '';
      } catch (error) {
        const message = emitUserMessage(messageWithRun(verificationErrorMessage({
          code: 'VERIFICATION_FILE_READ_FAILED',
          messageJa: '検証JSONファイルの読み込みに失敗しました。',
          messageEn: 'Failed to read the verification JSON file.',
          phase: 'read_file',
          sourceFileName: source.name,
          details: { file: fileInfo(source), exception: exceptionInfo(error), runId },
        }), runId, source.name));
        const messageLogs = combineMessageLogs([message]);
        const resultZipName = baseName + '__verification-error-' + timestamp + '.zip';
        const blob = await buildVerificationErrorZipBlob({
          file: source,
          baseName,
          status: 'error',
          phase: 'read_file',
          code: 'VERIFICATION_FILE_READ_FAILED',
          messageJa: '検証JSONファイルの読み込みに失敗しました。',
          messageEn: 'Failed to read the verification JSON file.',
          error,
          currentRunMessageLogs: messageLogs.currentRunMessageLogs,
          userMessageLogs: messageLogs.allMessageLogs,
        });
        return verificationResultSummary({
          source,
          resultZipName,
          blob,
          status: 'error',
          phase: 'read_file',
          code: 'VERIFICATION_FILE_READ_FAILED',
          messageJa: '検証JSONファイルの読み込みに失敗しました。',
          messageEn: 'Failed to read the verification JSON file.',
          currentRunMessageLogs: messageLogs.currentRunMessageLogs,
          allMessageLogs: messageLogs.allMessageLogs,
        });
      }
    }

    try {
      imported = JSON.parse(raw) as Partial<AppState>;
    } catch (error) {
      const message = emitUserMessage(messageWithRun(verificationErrorMessage({
        code: 'INVALID_JSON',
        messageJa: 'JSONの形式が不正です。',
        messageEn: 'The JSON format is invalid.',
        phase: 'parse_json',
        sourceFileName: source.name,
        details: { file: fileInfo(source), exception: exceptionInfo(error), runId },
      }), runId, source.name));
      const messageLogs = combineMessageLogs([message]);
      const resultZipName = baseName + '__verification-error-' + timestamp + '.zip';
      const blob = await buildVerificationErrorZipBlob({
        file: source,
        baseName,
        raw,
        status: 'error',
        phase: 'parse_json',
        code: 'INVALID_JSON',
        messageJa: 'JSONの形式が不正です。',
        messageEn: 'The JSON format is invalid.',
        error,
        currentRunMessageLogs: messageLogs.currentRunMessageLogs,
        userMessageLogs: messageLogs.allMessageLogs,
      });
      return verificationResultSummary({
        source,
        resultZipName,
        blob,
        status: 'error',
        phase: 'parse_json',
        code: 'INVALID_JSON',
        messageJa: 'JSONの形式が不正です。',
        messageEn: 'The JSON format is invalid.',
        currentRunMessageLogs: messageLogs.currentRunMessageLogs,
        allMessageLogs: messageLogs.allMessageLogs,
      });
    }

    if (isUnsupportedImportedState(imported)) {
      const error = new Error(unsupportedImportMessage(lang));
      const message = emitUserMessage(messageWithRun(verificationErrorMessage({
        code: 'UNSUPPORTED_IMPORTED_STATE',
        messageJa: unsupportedImportMessage('ja'),
        messageEn: unsupportedImportMessage('en'),
        phase: 'import_validation',
        sourceFileName: source.name,
        details: { file: fileInfo(source), importedStateSummary: stateSummary(imported), runId },
      }), runId, source.name));
      const messageLogs = combineMessageLogs([message]);
      const resultZipName = baseName + '__verification-error-' + timestamp + '.zip';
      const blob = await buildVerificationErrorZipBlob({
        file: source,
        baseName,
        raw,
        status: 'error',
        phase: 'import_validation',
        code: 'UNSUPPORTED_IMPORTED_STATE',
        messageJa: unsupportedImportMessage('ja'),
        messageEn: unsupportedImportMessage('en'),
        error,
        importedState: imported,
        currentRunMessageLogs: messageLogs.currentRunMessageLogs,
        userMessageLogs: messageLogs.allMessageLogs,
      });
      return verificationResultSummary({
        source,
        resultZipName,
        blob,
        status: 'error',
        phase: 'import_validation',
        code: 'UNSUPPORTED_IMPORTED_STATE',
        messageJa: unsupportedImportMessage('ja'),
        messageEn: unsupportedImportMessage('en'),
        currentRunMessageLogs: messageLogs.currentRunMessageLogs,
        allMessageLogs: messageLogs.allMessageLogs,
      });
    }

    const mergedImportedState = mergeImportedState(state, imported);
    const targetSanitization = sanitizeNegativeTargets(mergedImportedState.targets);
    const currentRunMessageLogs: UserMessageLog[] = [];
    const warningInput = buildNegativeTargetWarningInput(targetSanitization.negativeTargets);
    if (warningInput) currentRunMessageLogs.push(emitUserMessage(messageWithRun(warningInput, runId, source.name)));
    let messageLogs = combineMessageLogs(currentRunMessageLogs);
    const importedState = {
      ...mergedImportedState,
      targets: targetSanitization.targets,
    };

    let artifact: ReturnType<typeof buildDebugArtifact>;
    try {
      artifact = buildDebugArtifact(importedState, messageLogs.allMessageLogs, messageLogs.currentRunMessageLogs);
    } catch (error) {
      const errorMessage = emitUserMessage(messageWithRun(verificationErrorMessage({
        code: 'CALCULATION_EXCEPTION',
        messageJa: '計算中に例外が発生しました。',
        messageEn: 'An exception occurred during calculation.',
        phase: 'calculation_exception',
        sourceFileName: source.name,
        details: { exception: exceptionInfo(error), negativeTargets: targetSanitization.negativeTargets, runId },
      }), runId, source.name));
      currentRunMessageLogs.push(errorMessage);
      messageLogs = combineMessageLogs(currentRunMessageLogs);
      const resultZipName = baseName + '__verification-error-' + timestamp + '.zip';
      const blob = await buildVerificationErrorZipBlob({
        file: source,
        baseName,
        raw,
        status: 'error',
        phase: 'calculation_exception',
        code: 'CALCULATION_EXCEPTION',
        messageJa: '計算中に例外が発生しました。',
        messageEn: 'An exception occurred during calculation.',
        error,
        importedState,
        negativeTargets: targetSanitization.negativeTargets,
        currentRunMessageLogs: messageLogs.currentRunMessageLogs,
        userMessageLogs: messageLogs.allMessageLogs,
      });
      return verificationResultSummary({
        source,
        resultZipName,
        blob,
        status: 'error',
        phase: 'calculation_exception',
        code: 'CALCULATION_EXCEPTION',
        messageJa: '計算中に例外が発生しました。',
        messageEn: 'An exception occurred during calculation.',
        currentRunMessageLogs: messageLogs.currentRunMessageLogs,
        allMessageLogs: messageLogs.allMessageLogs,
        negativeTargets: targetSanitization.negativeTargets,
      });
    }

    const calculationInvalid = artifact.enrichedDebugLog.calculationStatus === 'invalid' || artifact.enrichedDebugLog.errorSummaries.length > 0;
    if (calculationInvalid) {
      currentRunMessageLogs.push(emitUserMessage(messageWithRun(calculationInvalidPersistentError(artifact.enrichedDebugLog.errorSummaries, {
        sourceFileName: source.name,
        calculationStatus: artifact.enrichedDebugLog.calculationStatus,
        errorSummaries: artifact.enrichedDebugLog.errorSummaries,
        negativeTargets: targetSanitization.negativeTargets,
        runId,
      }), runId, source.name)));
      messageLogs = combineMessageLogs(currentRunMessageLogs);
      artifact = {
        ...artifact,
        enrichedDebugLog: {
          ...artifact.enrichedDebugLog,
          currentRunMessageLogs: messageLogs.currentRunMessageLogs,
          allMessageLogs: messageLogs.allMessageLogs,
          userMessageLogs: messageLogs.allMessageLogs,
        },
      };
    }

    setStatus(lang === 'ja' ? '検証JSONを反映して非表示グラフ描画を待っています。' : 'Applied verification JSON. Waiting for hidden graph render.');
    if (options.applyState !== false) setState(importedState);

    const zip = new JSZip();
    zip.file(baseName + '__source.json', raw);
    zip.file(baseName + '__input.json', JSON.stringify(artifact.input, null, 2));
    zip.file(baseName + '__debug.json', JSON.stringify(artifact.enrichedDebugLog, null, 2));
    zip.file(baseName + '__user-message-log.json', JSON.stringify({ currentRunMessageLogs: messageLogs.currentRunMessageLogs, allMessageLogs: messageLogs.allMessageLogs }, null, 2));
    if (targetSanitization.negativeTargets.length > 0) {
      zip.file(baseName + '__target-warning-summary.json', JSON.stringify({
        code: 'NEGATIVE_TARGET_VALUE_IGNORED',
        negativeTargetCount: targetSanitization.negativeTargets.length,
        negativeTargets: targetSanitization.negativeTargets,
        displayedMessageJa: warningInput?.messageJa,
        displayedMessageEn: warningInput?.messageEn,
      }, null, 2));
    }
    zip.file(
      baseName + '__graph.svg',
      buildFlowGraphSvg(artifact.resultForSvg as typeof artifact.result, lang, importedState.settings, importedState.completedGraphNodeIds),
    );

    if (calculationInvalid) {
      zip.file(
        baseName + '__error-summary.json',
        JSON.stringify(
          buildVerificationErrorSummary({
            status: 'invalid',
            phase: 'calculation',
            code: 'CALCULATION_INVALID',
            messageJa: '計算不能の結果です。',
            messageEn: 'The calculation result is invalid.',
            file: source,
            importedState,
            input: artifact.input,
            artifact,
            negativeTargets: targetSanitization.negativeTargets,
            currentRunMessageLogs: messageLogs.currentRunMessageLogs,
            userMessageLogs: messageLogs.allMessageLogs,
          }),
          null,
          2,
        ),
      );
    }

    if (options.captureLiveGraph !== false) {
      try {
        await waitForGraphRender();
        const liveGraph = await captureLiveGraphFile();
        zip.file(baseName + '__graph-live.' + liveGraph.extension, liveGraph.blob);
      } catch (error) {
        zip.file(baseName + '__graph-live-error.txt', error instanceof Error ? error.message : String(error));
        zip.file(baseName + '__graph-live-error-summary.json', JSON.stringify({
          appVersion,
          gameVersion,
          status: 'error',
          phase: 'graph_capture',
          code: 'LIVE_GRAPH_CAPTURE_FAILED',
          messageJa: 'ライブグラフの保存に失敗しました。計算ログと静的SVGは保存済みです。',
          messageEn: 'Failed to save the live graph. The calculation log and static SVG were saved.',
          exception: exceptionInfo(error),
          createdAt: new Date().toISOString(),
        }, null, 2));
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const resultZipName = baseName + '__verification-' + timestamp + '.zip';
    const status = calculationInvalid ? 'invalid' : 'ok';
    refreshSummary(artifact);
    return verificationResultSummary({
      source,
      resultZipName,
      blob,
      status,
      phase: calculationInvalid ? 'calculation' : 'completed',
      code: calculationInvalid ? 'CALCULATION_INVALID' : undefined,
      messageJa: calculationInvalid ? '計算不能の結果です。' : '検証ZIPを保存しました。',
      messageEn: calculationInvalid ? 'The calculation result is invalid.' : 'Saved verification ZIP.',
      artifact,
      currentRunMessageLogs: messageLogs.currentRunMessageLogs,
      allMessageLogs: messageLogs.allMessageLogs,
      negativeTargets: targetSanitization.negativeTargets,
    });
  }

  async function saveVerificationZipFromFile(file: File): Promise<void> {
    const result = await buildVerificationZipFromSource(sourceFileFromFile(file), { resetMessages: true, applyState: true, captureLiveGraph: true });
    downloadBlob(result.resultZipName, result.blob);
    setStatus(result.status === 'ok' ? labels.zipSaved : labels.zipSavedInvalid);
  }

  async function saveVerificationBatchZipFromFile(file: File): Promise<void> {
    onBeginJsonImport?.();
    const batchId = createRunId('batch');
    const timestamp = timestampForFile();
    const sourceZip = await JSZip.loadAsync(file);
    const entries = Object.values(sourceZip.files)
      .filter((entry) => !entry.dir && shouldIncludeVerificationJsonEntry(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name));

    const batchZip = new JSZip();
    const results: Omit<VerificationZipResult, 'blob'>[] = [];

    for (const entry of entries) {
      onBeginJsonImport?.();
      const raw = await entry.async('string');
      const result = await buildVerificationZipFromSource(sourceFileFromZipEntry(entry.name, raw, file), {
        resetMessages: false,
        applyState: true,
        captureLiveGraph: true,
      });
      batchZip.file(result.resultZipName, result.blob);
      const { blob: ignoredBlob, ...summary } = result;
      results.push(summary);
    }

    const summary = {
      appVersion,
      gameVersion,
      debugSchemaVersion: 25,
      batchId,
      sourceZip: fileInfo(file),
      createdAt: new Date().toISOString(),
      total: results.length,
      ok: results.filter((result) => result.status === 'ok').length,
      invalid: results.filter((result) => result.status === 'invalid').length,
      error: results.filter((result) => result.status === 'error').length,
      skipped: Object.values(sourceZip.files)
        .filter((entry) => !entry.dir && !shouldIncludeVerificationJsonEntry(entry.name))
        .map((entry) => entry.name),
      results,
    };
    batchZip.file('__batch-summary.json', JSON.stringify(summary, null, 2));
    const blob = await batchZip.generateAsync({ type: 'blob' });
    downloadBlob('verification-batch-result-' + timestamp + '.zip', blob);
    setStatus(lang === 'ja' ? '一括検証ZIPを保存しました。' : 'Saved batch verification ZIP.');
  }

  async function onVerificationZipFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (isZipFile(file)) {
        await saveVerificationBatchZipFromFile(file);
      } else {
        await saveVerificationZipFromFile(file);
      }
    } catch (error) {
      onBeginJsonImport?.();
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
          accept="application/json,.json,application/zip,application/x-zip-compressed,.zip"
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
