import type { CalculatedFlow, CalculationResult, ItemStat, RecipeStat } from '../engine/calculate';
import { flowTransportForItem } from '../engine/flowTransport';

const EPS = 1e-9;

function cloneRecipeStat(stat: RecipeStat): RecipeStat {
  return {
    ...stat,
    inputRates: { ...stat.inputRates },
    outputRates: { ...stat.outputRates },
    netRates: { ...stat.netRates },
    surplusOutputRates: { ...stat.surplusOutputRates },
    discardedOutputRates: { ...stat.discardedOutputRates },
    targetIds: [...stat.targetIds],
    surplusReuseSourceItemIds: stat.surplusReuseSourceItemIds ? [...stat.surplusReuseSourceItemIds] : undefined,
    surplusReuseReplacedRecipeIds: stat.surplusReuseReplacedRecipeIds ? [...stat.surplusReuseReplacedRecipeIds] : undefined,
  };
}

function cloneItemStat(stat: ItemStat): ItemStat {
  return { ...stat };
}

function cloneResult(result: CalculationResult): CalculationResult {
  return {
    ...result,
    itemStats: Object.fromEntries(Object.entries(result.itemStats).map(([itemId, stat]) => [itemId, cloneItemStat(stat)])),
    recipeStats: Object.fromEntries(Object.entries(result.recipeStats).map(([recipeId, stat]) => [recipeId, cloneRecipeStat(stat)])),
    flows: result.flows.map((flow) => ({ ...flow, from: { ...flow.from }, to: { ...flow.to } })),
    conveyorEdges: result.conveyorEdges.map((edge) => ({ ...edge })),
    outputEdges: result.outputEdges.map((edge) => ({ ...edge })),
    warnings: [...result.warnings],
    residualUnresolvedFlows: result.residualUnresolvedFlows?.map((flow) => ({ ...flow })),
    errorSummaries: result.errorSummaries?.map((summary) => ({ ...summary, itemIds: summary.itemIds ? [...summary.itemIds] : undefined, recipeIds: summary.recipeIds ? [...summary.recipeIds] : undefined })),
    totals: { ...result.totals },
  };
}

function positiveOutputItemIds(stat: RecipeStat): string[] {
  return Object.entries(stat.outputRates)
    .filter(([, rate]) => Number.isFinite(rate) && rate > EPS)
    .map(([itemId]) => itemId);
}

function sourceRecipeId(flow: CalculatedFlow): string | undefined {
  return flow.from.type === 'recipe' ? flow.from.recipeId : undefined;
}

function targetRecipeId(flow: CalculatedFlow): string | undefined {
  return flow.to.type === 'recipe' ? flow.to.recipeId : undefined;
}

function isMaterialLikeRole(flow: CalculatedFlow): boolean {
  return flow.role === 'material' || flow.role === 'byproductReuse';
}

function buildIncomingProducerMap(result: CalculationResult): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const flow of result.flows) {
    if (!isMaterialLikeRole(flow)) continue;
    const toRecipeId = targetRecipeId(flow);
    const fromRecipeId = sourceRecipeId(flow);
    if (!toRecipeId || !fromRecipeId) continue;
    const list = incoming.get(toRecipeId) ?? [];
    list.push(fromRecipeId);
    incoming.set(toRecipeId, list);
  }
  return incoming;
}

function buildSafeRoundableRecipeSet(result: CalculationResult): Set<string> {
  const incoming = buildIncomingProducerMap(result);
  const memo = new Map<string, boolean>();
  const visiting = new Set<string>();

  const isSafe = (recipeId: string): boolean => {
    const cached = memo.get(recipeId);
    if (cached !== undefined) return cached;
    const stat = result.recipeStats[recipeId];
    if (!stat || !Number.isFinite(stat.actualMachines) || stat.actualMachines <= EPS) {
      memo.set(recipeId, false);
      return false;
    }
    if (positiveOutputItemIds(stat).length !== 1) {
      memo.set(recipeId, false);
      return false;
    }
    if (visiting.has(recipeId)) {
      // Do not round cyclic chains. A rounded cycle can easily overstate throughput.
      memo.set(recipeId, false);
      return false;
    }
    visiting.add(recipeId);
    for (const producerId of incoming.get(recipeId) ?? []) {
      if (!isSafe(producerId)) {
        visiting.delete(recipeId);
        memo.set(recipeId, false);
        return false;
      }
    }
    visiting.delete(recipeId);
    memo.set(recipeId, true);
    return true;
  };

  const safe = new Set<string>();
  for (const recipeId of Object.keys(result.recipeStats)) {
    if (isSafe(recipeId)) safe.add(recipeId);
  }
  return safe;
}

function ceilMachines(value: number): number {
  if (!Number.isFinite(value) || value <= EPS) return value;
  const rounded = Math.ceil(value - 1e-7);
  return Math.max(1, rounded);
}

function scaleRecord(record: Record<string, number>, factor: number): Record<string, number> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value * factor]));
}

function updateFlowTransport(flow: CalculatedFlow, conveyorItemsPerMinute: number): void {
  const transport = flowTransportForItem(flow.itemId, flow.rate, conveyorItemsPerMinute);
  flow.belts = transport.belts;
  flow.transportKind = transport.transportKind;
  flow.transportUnits = transport.transportUnits;
}

function recomputeDisplayItemStats(result: CalculationResult): void {
  const oldStats = result.itemStats;
  const nextStats: Record<string, ItemStat> = {};
  const ensure = (itemId: string): ItemStat => {
    const existing = nextStats[itemId];
    if (existing) return existing;
    const old = oldStats[itemId];
    const stat: ItemStat = {
      itemId,
      requested: old?.requested ?? 0,
      consumed: 0,
      produced: 0,
      purchased: 0,
      initialPurchased: old?.initialPurchased ?? 0,
      reused: 0,
      surplus: 0,
      discarded: 0,
      targetRequested: 0,
      targetActual: 0,
      purchaseCostCopperPerMin: old?.purchaseCostCopperPerMin ?? 0,
      initialCostCopper: old?.initialCostCopper ?? 0,
      revenueCopperPerMin: old?.revenueCopperPerMin ?? 0,
    };
    nextStats[itemId] = stat;
    return stat;
  };

  for (const [itemId, old] of Object.entries(oldStats)) {
    ensure(itemId).requested = old.requested;
  }
  for (const recipeStat of Object.values(result.recipeStats)) {
    for (const [itemId, rate] of Object.entries(recipeStat.outputRates)) ensure(itemId).produced += rate;
  }
  for (const flow of result.flows) {
    if (flow.rate <= EPS) continue;
    const stat = ensure(flow.itemId);
    if (flow.to.type === 'recipe') {
      stat.consumed += flow.rate;
      if (flow.role === 'byproductReuse') stat.reused += flow.rate;
    }
    if (flow.from.type === 'itemSource' && flow.from.sourceMode === 'buy') stat.purchased += flow.rate;
    if (flow.to.type === 'itemSink') {
      if (flow.to.sinkMode === 'final') {
        stat.targetActual += flow.rate;
        stat.targetRequested += flow.rate;
      } else if (flow.to.sinkMode === 'surplus') {
        stat.surplus += flow.rate;
      } else if (flow.to.sinkMode === 'discard') {
        stat.discarded += flow.rate;
      }
    }
  }
  result.itemStats = nextStats;
}

export function buildRoundedCauldronGraphResult(result: CalculationResult): CalculationResult {
  const safeRecipes = buildSafeRoundableRecipeSet(result);
  if (safeRecipes.size === 0) return result;

  const desiredMachines = new Map<string, number>();
  for (const recipeId of safeRecipes) {
    const stat = result.recipeStats[recipeId];
    if (!stat) continue;
    desiredMachines.set(recipeId, ceilMachines(stat.actualMachines));
  }

  let changed = true;
  let guard = 0;
  while (changed && guard < 200) {
    guard += 1;
    changed = false;
    for (const flow of result.flows) {
      if (!isMaterialLikeRole(flow)) continue;
      const fromId = sourceRecipeId(flow);
      const toId = targetRecipeId(flow);
      if (!fromId || !toId || !safeRecipes.has(fromId) || !safeRecipes.has(toId)) continue;
      const fromStat = result.recipeStats[fromId];
      const toStat = result.recipeStats[toId];
      if (!fromStat || !toStat || fromStat.actualMachines <= EPS || toStat.actualMachines <= EPS) continue;
      const fromFactor = (desiredMachines.get(fromId) ?? fromStat.actualMachines) / fromStat.actualMachines;
      const toFactor = (desiredMachines.get(toId) ?? toStat.actualMachines) / toStat.actualMachines;
      if (toFactor > fromFactor + 1e-7) {
        const next = ceilMachines(fromStat.actualMachines * toFactor);
        if (next > (desiredMachines.get(fromId) ?? 0) + 1e-7) {
          desiredMachines.set(fromId, next);
          changed = true;
        }
      }
    }
  }

  const factors = new Map<string, number>();
  for (const [recipeId, machines] of desiredMachines) {
    const stat = result.recipeStats[recipeId];
    if (!stat || stat.actualMachines <= EPS) continue;
    const factor = machines / stat.actualMachines;
    if (factor > 1 + 1e-7) factors.set(recipeId, factor);
  }
  if (factors.size === 0) return result;

  const rounded = cloneResult(result);
  for (const [recipeId, factor] of factors) {
    const stat = rounded.recipeStats[recipeId];
    if (!stat) continue;
    stat.actualMachines *= factor;
    stat.theoreticalMachines *= factor;
    stat.runsPerMinute *= factor;
    stat.positiveNetProductionRate *= factor;
    stat.inputRates = scaleRecord(stat.inputRates, factor);
    stat.outputRates = scaleRecord(stat.outputRates, factor);
    stat.netRates = scaleRecord(stat.netRates, factor);
    stat.surplusOutputRates = scaleRecord(stat.surplusOutputRates, factor);
    stat.discardedOutputRates = scaleRecord(stat.discardedOutputRates, factor);
    if (stat.surplusReuseAddedRunsPerMinute !== undefined) stat.surplusReuseAddedRunsPerMinute *= factor;
    if (stat.cauldronOutputPerMin !== undefined) stat.cauldronOutputPerMin = stat.perMachineProductionRate;
    if (stat.cauldronHeatPerMinPerMachine !== undefined) stat.cauldronHeatPerMinPerMachine = stat.cauldronHeatPerMinPerMachine;
  }

  const conveyorItemsPerMinute = rounded.totals.conveyorItemsPerMinute || 60;
  for (const flow of rounded.flows) {
    const fromId = sourceRecipeId(flow);
    const toId = targetRecipeId(flow);
    let factor = 1;
    if (toId && (flow.role === 'material' || flow.role === 'byproductReuse' || flow.role === 'fuel' || flow.role === 'fertilizer')) {
      factor = Math.max(factor, factors.get(toId) ?? 1);
    }
    if (fromId && !toId) factor = Math.max(factor, factors.get(fromId) ?? 1);
    if (fromId && toId && (factors.get(fromId) ?? 1) > factor && (flow.role !== 'material' && flow.role !== 'byproductReuse')) {
      factor = Math.max(factor, factors.get(fromId) ?? 1);
    }
    if (factor <= 1 + 1e-7) continue;
    flow.rate *= factor;
    updateFlowTransport(flow, conveyorItemsPerMinute);
  }

  recomputeDisplayItemStats(rounded);
  return rounded;
}
