import { useRef, useState, type ChangeEvent } from 'react';
import JSZip from 'jszip';
import type { AppState, Lang } from '../types';
import { buildNegativeTargetWarningInput, filterPositiveTargets, sanitizeNegativeTargets, type NegativeTargetEntry } from '../engine/targetValidation';
import { createUserMessage, type UserMessageInput, type UserMessageLog } from '../utils/userMessages';
import { calculate, calculateWithDebug, type CalculateInput } from '../engine/calculate';
import { buildFlowGraphSvg } from '../engine/graph';

type DebugTabProps = {
  lang: Lang;
  state: AppState;
  setState: (next: AppState) => void;
  appVersion: string;
  gameVersion: string;
  userMessages: UserMessageLog[];
  onUserMessage?: (input: UserMessageInput) => UserMessageLog;
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

function isUnsupportedImportedState(value: unknown): boolean {
  if (!value || typeof value !== 'object') return true;
  const candidate = value as {
    itemSourceModes?: unknown;
    stockOverrides?: unknown;
    settings?: {
      fuel?: { fuelSourceMode?: unknown };
      fertilizer?: { fertilizerSourceMode?: unknown };
    };
    version?: unknown;
  };
  return (
    candidate.itemSourceModes !== undefined ||
    candidate.stockOverrides !== undefined ||
    candidate.settings?.fuel?.fuelSourceMode !== undefined ||
    candidate.settings?.fertilizer?.fertilizerSourceMode !== undefined ||
    (typeof candidate.version !== 'number' || candidate.version < 22)
  );
}

function unsupportedImportMessage(lang: Lang): string {
  return lang === 'ja'
    ? 'このJSONは旧形式のため読み込めません。v0.6.1以降の形式で保存し直してください。'
    : 'This JSON uses an old format and cannot be imported. Please re-save it with v0.6.1 or later.';
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

export function DebugTab({ lang, state, setState, appVersion, gameVersion, userMessages, onUserMessage }: DebugTabProps) {
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
          saveZip: 'Load verification JSON & save logs',
          notYet: 'Not generated',
          logSaved: 'Saved log.',
          graphSaved: 'Saved graph SVG.',
          graphFailed: 'Failed to save graph SVG.',
          zipSelectFailed: 'Failed to read verification JSON.',
          zipSaved: 'Saved verification ZIP.',
          zipSavedInvalid: 'Saved verification ZIP with invalid calculation details.',
          zipFailed: 'Failed to save verification ZIP.',
        };

  function buildDebugArtifact(sourceState: AppState, userMessageLogs: UserMessageLog[] = userMessages) {
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
      debugSchemaVersion: 7,
      calculationStatus: resultWithDebugStatus.calculationStatus ?? ignoredDebugCalculationStatus ?? 'ok',
      errorSummaries: normalizedErrorSummaries,
      ...debugLogBody,
      issues: normalizedIssues,
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

  function fileInfo(file: File) {
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
      zeroTargetCount: targets.filter((target) => Number(target.value) === 0).length,
      negativeTargetCount: targets.filter((target) => Number.isFinite(Number(target.value)) && Number(target.value) < 0).length,
      targetPreview: targets.slice(0, 20).map((target) => ({
        id: target.id,
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
    file: File;
    error?: unknown;
    importedState?: Partial<AppState>;
    input?: CalculateInput;
    artifact?: ReturnType<typeof buildDebugArtifact>;
    negativeTargets?: NegativeTargetEntry[];
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
      debugSchemaVersion: 7,
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
          count: (args.userMessageLogs ?? userMessages).length,
          recent: (args.userMessageLogs ?? userMessages).slice(0, 30),
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

  async function saveVerificationErrorZip(args: {
    file: File;
    baseName: string;
    timestamp: string;
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
    userMessageLogs?: UserMessageLog[];
  }): Promise<void> {
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
          userMessageLogs: args.userMessageLogs,
        }),
        null,
        2,
      ),
    );
    zip.file(args.baseName + '__user-message-log.json', JSON.stringify(args.userMessageLogs ?? userMessages, null, 2));
    if (args.artifact) {
      zip.file(args.baseName + '__input.json', JSON.stringify(args.artifact.input, null, 2));
      zip.file(args.baseName + '__debug.json', JSON.stringify(args.artifact.enrichedDebugLog, null, 2));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(args.baseName + '__verification-error-' + args.timestamp + '.zip', blob);
  }

  async function saveVerificationZipFromFile(file: File): Promise<void> {
    const baseName = safeFilePart(file.name);
    const timestamp = timestampForFile();
    let raw = '';
    let imported: Partial<AppState> | undefined;

    try {
      raw = await file.text();
    } catch (error) {
      await saveVerificationErrorZip({
        file,
        baseName,
        timestamp,
        status: 'error',
        phase: 'read_file',
        code: 'VERIFICATION_FILE_READ_FAILED',
        messageJa: '検証JSONファイルの読み込みに失敗しました。',
        messageEn: 'Failed to read the verification JSON file.',
        error,
      });
      throw error;
    }

    try {
      imported = JSON.parse(raw) as Partial<AppState>;
    } catch (error) {
      await saveVerificationErrorZip({
        file,
        baseName,
        timestamp,
        raw,
        status: 'error',
        phase: 'parse_json',
        code: 'INVALID_JSON',
        messageJa: 'JSONの形式が不正です。',
        messageEn: 'The JSON format is invalid.',
        error,
      });
      throw new Error(lang === 'ja' ? 'JSONの形式が不正です。' : 'The JSON format is invalid.');
    }

    if (isUnsupportedImportedState(imported)) {
      const error = new Error(unsupportedImportMessage(lang));
      await saveVerificationErrorZip({
        file,
        baseName,
        timestamp,
        raw,
        status: 'error',
        phase: 'import_validation',
        code: 'UNSUPPORTED_IMPORTED_STATE',
        messageJa: unsupportedImportMessage('ja'),
        messageEn: unsupportedImportMessage('en'),
        error,
        importedState: imported,
      });
      throw error;
    }

    const mergedImportedState = mergeImportedState(state, imported);
    const targetSanitization = sanitizeNegativeTargets(mergedImportedState.targets);
    const warningInput = buildNegativeTargetWarningInput(targetSanitization.negativeTargets);
    const warningMessage = warningInput ? (onUserMessage?.(warningInput) ?? createUserMessage(warningInput)) : undefined;
    const verificationMessages = warningMessage ? [warningMessage, ...userMessages] : userMessages;
    const importedState = {
      ...mergedImportedState,
      targets: targetSanitization.targets,
    };

    let artifact: ReturnType<typeof buildDebugArtifact>;
    try {
      artifact = buildDebugArtifact(importedState, verificationMessages);
    } catch (error) {
      await saveVerificationErrorZip({
        file,
        baseName,
        timestamp,
        raw,
        status: 'error',
        phase: 'calculation_exception',
        code: 'CALCULATION_EXCEPTION',
        messageJa: '計算中に例外が発生しました。',
        messageEn: 'An exception occurred during calculation.',
        error,
        importedState,
        negativeTargets: targetSanitization.negativeTargets,
        userMessageLogs: verificationMessages,
      });
      throw error;
    }

    setStatus(lang === 'ja' ? '検証JSONを反映してグラフ描画を待っています。' : 'Applied verification JSON. Waiting for graph render.');
    setState(importedState);

    const zip = new JSZip();
    zip.file(baseName + '__source.json', raw);
    zip.file(baseName + '__input.json', JSON.stringify(artifact.input, null, 2));
    zip.file(baseName + '__debug.json', JSON.stringify(artifact.enrichedDebugLog, null, 2));
    zip.file(baseName + '__user-message-log.json', JSON.stringify(verificationMessages, null, 2));
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

    const calculationInvalid = artifact.enrichedDebugLog.calculationStatus === 'invalid' || artifact.enrichedDebugLog.errorSummaries.length > 0;
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
            file,
            importedState,
            input: artifact.input,
            artifact,
            negativeTargets: targetSanitization.negativeTargets,
            userMessageLogs: verificationMessages,
          }),
          null,
          2,
        ),
      );
    }

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

    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(baseName + '__verification-' + timestamp + '.zip', blob);
    refreshSummary(artifact);
    setStatus(calculationInvalid ? labels.zipSavedInvalid : labels.zipSaved);
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
