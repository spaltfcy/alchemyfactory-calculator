export type UserMessageSeverity = 'info' | 'warning' | 'error';
export type UserMessageVisibility = 'temporary' | 'persistent';
export type UserMessageDisplayMode = 'toast' | 'persistent';

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
  details?: unknown;
};

export type UserMessageInput = {
  severity: UserMessageSeverity;
  visibility: UserMessageVisibility;
  code: string;
  messageJa: string;
  messageEn: string;
  durationMs?: number;
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
    displayMode: input.visibility === 'temporary' ? 'toast' : 'persistent',
    lifetimeMs,
    persistInLog: true,
    code: input.code,
    messageJa: input.messageJa,
    messageEn: input.messageEn,
    createdAt,
    expiresAt,
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
  };
}
