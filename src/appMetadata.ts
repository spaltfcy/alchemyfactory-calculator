export const APP_VERSION = '0.8.1' as const;
export const GAME_VERSION = '0.4.4.4323' as const;

export const STATE_SCHEMA_VERSION = 23 as const;
export const MIN_SUPPORTED_STATE_SCHEMA_VERSION = 22 as const;
export const DEBUG_SCHEMA_VERSION = 16 as const;

type StateSchemaGuardOptions = {
  requireObject?: boolean;
};

type LegacyStateCandidate = {
  itemSourceModes?: unknown;
  stockOverrides?: unknown;
  settings?: {
    fuel?: { fuelSourceMode?: unknown };
    fertilizer?: { fertilizerSourceMode?: unknown };
  };
  version?: unknown;
};

export function isUnsupportedStateSchema(value: unknown, options: StateSchemaGuardOptions = {}): boolean {
  if (!value || typeof value !== 'object') return options.requireObject ?? false;

  const candidate = value as LegacyStateCandidate;
  if (candidate.itemSourceModes !== undefined) return true;
  if (candidate.stockOverrides !== undefined) return true;
  if (candidate.settings?.fuel?.fuelSourceMode !== undefined) return true;
  if (candidate.settings?.fertilizer?.fertilizerSourceMode !== undefined) return true;

  if (typeof candidate.version !== 'number') return true;
  if (!Number.isInteger(candidate.version)) return true;
  if (candidate.version < MIN_SUPPORTED_STATE_SCHEMA_VERSION) return true;
  if (candidate.version > STATE_SCHEMA_VERSION) return true;

  return false;
}

export function unsupportedStateMessage(lang: 'ja' | 'en'): string {
  return lang === 'ja'
    ? `このJSONは現在対応していない保存形式です。v0.8.1 / state schema ${MIN_SUPPORTED_STATE_SCHEMA_VERSION}〜${STATE_SCHEMA_VERSION} の形式で保存し直してください。`
    : `This JSON uses an unsupported save format. Please re-save it with v0.8.1 / state schema ${MIN_SUPPORTED_STATE_SCHEMA_VERSION}-${STATE_SCHEMA_VERSION}.`;
}
