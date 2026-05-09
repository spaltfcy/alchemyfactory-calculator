export type UserMessageSeverity = 'info' | 'warning' | 'error';
export type UserMessageVisibility = 'temporary' | 'persistent';
export type UserMessageDisplayMode = 'notification';

export type UserMessageSource = {
  phase?: 'import' | 'target_validation' | 'calculation' | 'export' | 'ui' | 'graph_capture' | 'parse_json' | 'import_validation' | 'read_file' | 'calculation_exception';
  runId?: string;
  sourceFileName?: string;
};

export type UserMessageLog = {
  id: string;
  severity: UserMessageSeverity;
  visibility: UserMessageVisibility;
  displayMode: UserMessageDisplayMode;
  lifetimeMs: number | null;
  persistInLog: true;
  code: string;
  messageJa: string;
  messageEn: string;
  createdAt: string;
  expiresAt?: string;
  source?: UserMessageSource;
  details?: unknown;
};

export type UserMessageInput = {
  severity: UserMessageSeverity;
  visibility: UserMessageVisibility;
  code: string;
  messageJa: string;
  messageEn: string;
  durationMs?: number;
  source?: UserMessageSource;
  details?: unknown;
};

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return 'msg-' + crypto.randomUUID();
  }
  return 'msg-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
}

export function createUserMessage(input: UserMessageInput, now = new Date()): UserMessageLog {
  const createdAt = now.toISOString();
  const lifetimeMs = input.visibility === 'temporary' ? Math.max(1, input.durationMs ?? 5000) : null;
  const expiresAt = lifetimeMs === null ? undefined : new Date(now.getTime() + lifetimeMs).toISOString();
  return {
    id: makeId(),
    severity: input.severity,
    visibility: input.visibility,
    displayMode: 'notification',
    lifetimeMs,
    persistInLog: true,
    code: input.code,
    messageJa: input.messageJa,
    messageEn: input.messageEn,
    createdAt,
    expiresAt,
    source: input.source,
    details: input.details,
  };
}

export function messageText(message: Pick<UserMessageLog, 'messageJa' | 'messageEn'>, lang: 'ja' | 'en'): string {
  return lang === 'ja' ? message.messageJa : message.messageEn;
}

export function negativeOutputTemporaryError(): UserMessageInput {
  return {
    severity: 'error',
    visibility: 'temporary',
    code: 'NEGATIVE_OUTPUT_VALUE_REJECTED',
    messageJa: '出力値に負の数は指定できません。',
    messageEn: 'Output value cannot be negative.',
    durationMs: 5000,
    source: { phase: 'ui' },
  };
}

export function calculationInvalidPersistentError(errorSummaries: unknown[], details?: unknown): UserMessageInput {
  const first = Array.isArray(errorSummaries) ? errorSummaries[0] as { messageJa?: unknown; messageEn?: unknown; code?: unknown } | undefined : undefined;
  const suffixJa = typeof first?.messageJa === 'string' && first.messageJa.trim() ? '\n' + first.messageJa : '';
  const suffixEn = typeof first?.messageEn === 'string' && first.messageEn.trim() ? '\n' + first.messageEn : '';
  return {
    severity: 'error',
    visibility: 'persistent',
    code: 'CALCULATION_INVALID',
    messageJa: '計算不能' + suffixJa,
    messageEn: 'Calculation error' + suffixEn,
    source: { phase: 'calculation' },
    details: {
      errorSummaries,
      ...((details && typeof details === 'object') ? details as Record<string, unknown> : { details }),
    },
  };
}

export function verificationErrorMessage(input: {
  code: string;
  messageJa: string;
  messageEn: string;
  phase: UserMessageSource['phase'];
  sourceFileName?: string;
  details?: unknown;
}): UserMessageInput {
  return {
    severity: 'error',
    visibility: 'persistent',
    code: input.code,
    messageJa: input.messageJa,
    messageEn: input.messageEn,
    source: { phase: input.phase, sourceFileName: input.sourceFileName },
    details: input.details,
  };
}
