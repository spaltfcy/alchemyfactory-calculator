export const DISPLAY_RATE_STEP = 0.01;

export function ceilToStep(value: number, step = DISPLAY_RATE_STEP): number {
  if (!Number.isFinite(value)) return value;
  if (Math.abs(value) <= 1e-9) return 0;
  if (step <= 0 || !Number.isFinite(step)) return value;
  const sign = value < 0 ? -1 : 1;
  const abs = Math.abs(value);
  return sign * Math.ceil((abs - 1e-9) / step) * step;
}

export function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: digits });
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function formatRate(value: number, digits = 2): string {
  return formatNumber(ceilToStep(value, DISPLAY_RATE_STEP), digits);
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
  if (!Number.isFinite(value)) return value;
  if (value <= eps) return 0;
  const rounded = Math.ceil(value - eps);
  if (Object.is(rounded, -0)) return 0;
  return Math.max(1, rounded);
}

