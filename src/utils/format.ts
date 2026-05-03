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
