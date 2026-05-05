export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: digits });
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatCopper(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 100000) return `${sign}${formatNumber(abs / 100000, 2)}g`;
  if (abs >= 1000) return `${sign}${formatNumber(abs / 1000, 2)}s`;
  return `${sign}${formatNumber(abs, 0)}c`;
}

export function safeCeil(value: number): number {
  const eps = 1e-9;
  return Math.ceil(value - eps);
}

export function safeCeilToStep(value: number, step = 1): number {
  const eps = 1e-9;
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  return Math.ceil((value - eps) / step) * step;
}

export function parseQuantityRoundingStep(step?: string): number {
  if (step === '1') return 1;
  if (step === '0.1') return 0.1;
  if (step === '0.01') return 0.01;
  return 0;
}

export function formatRoundedNumber(value: number, roundingStep?: string, digits = 2): string {
  const step = parseQuantityRoundingStep(roundingStep);
  const rounded = step > 0 ? safeCeilToStep(value, step) : value;
  const nextDigits = step === 1 ? 0 : step === 0.1 ? 1 : digits;
  return formatNumber(rounded, nextDigits);
}
