const MIN_CAULDRON_TARGET_FOR_PHYSICS = 1;

function clampTargetValue(targetValue: number): number {
  const value = Number(targetValue);
  if (!Number.isFinite(value)) return MIN_CAULDRON_TARGET_FOR_PHYSICS;
  return Math.max(MIN_CAULDRON_TARGET_FOR_PHYSICS, value);
}

function lerp(x: number, x0: number, x1: number, y0: number, y1: number): number {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
}

export function calcBaseCauldronTimeSec(targetValue: number): number {
  const x = clampTargetValue(targetValue);
  if (x <= 100) return lerp(x, 1, 100, 3, 6);
  if (x <= 1_000) return lerp(x, 100, 1_000, 6, 12);
  if (x <= 10_000) return lerp(x, 1_000, 10_000, 12, 24);
  return lerp(Math.min(x, 1_000_000), 10_000, 1_000_000, 24, 60);
}

export function calcBaseCauldronHeatPerSec(targetValue: number): number {
  const x = clampTargetValue(targetValue);
  if (x <= 100) return lerp(x, 1, 100, 1, 20);
  if (x <= 1_000) return lerp(x, 100, 1_000, 20, 200);
  if (x <= 10_000) return lerp(x, 1_000, 10_000, 200, 1_500);
  return lerp(Math.min(x, 1_000_000), 10_000, 1_000_000, 1_500, 10_000);
}

export type EffectiveCauldronStats = {
  targetValue: number;
  baseTimeSec: number;
  baseHeatPerSec: number;
  productionSpeedMultiplier: number;
  heatConsumptionMultiplier: number;
  effectiveTimeSec: number;
  effectiveHeatPerSec: number;
  outputPerMin: number;
  heatPerCraft: number;
  heatPerMinPerMachine: number;
};

export function calcEffectiveCauldronStats(
  targetValue: number,
  productionSpeedMultiplier = 1,
  heatConsumptionMultiplier = 1,
): EffectiveCauldronStats {
  const baseTimeSec = calcBaseCauldronTimeSec(targetValue);
  const baseHeatPerSec = calcBaseCauldronHeatPerSec(targetValue);
  const safeProductionSpeedMultiplier = Number.isFinite(productionSpeedMultiplier) && productionSpeedMultiplier > 0 ? productionSpeedMultiplier : 1;
  const safeHeatConsumptionMultiplier = Number.isFinite(heatConsumptionMultiplier) && heatConsumptionMultiplier > 0 ? heatConsumptionMultiplier : 1;
  const effectiveTimeSec = baseTimeSec / safeProductionSpeedMultiplier;
  const effectiveHeatPerSec = baseHeatPerSec * safeHeatConsumptionMultiplier;
  const outputPerMin = effectiveTimeSec > 0 ? 60 / effectiveTimeSec : 0;
  return {
    targetValue: clampTargetValue(targetValue),
    baseTimeSec,
    baseHeatPerSec,
    productionSpeedMultiplier: safeProductionSpeedMultiplier,
    heatConsumptionMultiplier: safeHeatConsumptionMultiplier,
    effectiveTimeSec,
    effectiveHeatPerSec,
    outputPerMin,
    heatPerCraft: effectiveTimeSec * effectiveHeatPerSec,
    heatPerMinPerMachine: effectiveHeatPerSec * 60,
  };
}
