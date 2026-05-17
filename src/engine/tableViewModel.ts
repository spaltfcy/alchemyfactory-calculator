import type { Lang, MachineDetailTableSortKey, MachineTableSortKey, SortDirection, TablePreferences } from '../types';
import type { CalculatedFlow, CalculationResult, RecipeStat } from './calculationTypes';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { recipeById } from '../data/recipes';

const EPS = 1e-9;
const MAX_DEPTH = 64;
const MAX_STEPS_PER_SOURCE = 10000;
const TABLE_VIEW_SCHEMA_VERSION = 'table-view-v0935' as const;

type LocalizedName = {
  ja: string;
  en: string;
};

export type TableProductionOutput = {
  itemId: string;
  itemNameJa: string;
  itemNameEn: string;
  rate: number;
};

export type MachineMainRow = {
  recipeId: string;
  recipeNameJa: string;
  recipeNameEn: string;
  machineId: string;
  machineNameJa: string;
  machineNameEn: string;
  productionOutputs: TableProductionOutput[];
  productionRateTotal: number;
  rowKind: 'recipe' | 'fuelDemand' | 'fertilizerDemand';
  productionRateSource: 'positive-netRates' | 'special-demand';
  grossOutputRates: Record<string, number>;
  netProductionRates: Record<string, number>;
  suppressedGrossOutputs: Array<{ itemId: string; itemNameJa: string; itemNameEn: string; grossOutputRate: number; netRate: number; reason: 'net_non_positive' }>;
  theoreticalMachines: number;
  actualMachines: number;
  surplusOutputs: TableProductionOutput[];
  expandable: boolean;
  expansionIgnored: boolean;
  expansionIgnoredReason?: 'steam_recipe' | 'steam_output' | 'missing_recipe';
};

export type MachineDetailRowKind = 'final' | 'fuel' | 'fertilizer' | 'cycle' | 'unallocated' | 'overallocated';

export type MachineDetailRow = {
  id: string;
  kind: MachineDetailRowKind;
  labelJa: string;
  labelEn: string;
  sourceItemId: string;
  sourceOutputRate: number;
  usageRate: number;
  usagePercent: number;
  productionRate?: number;
  theoreticalMachines?: number;
  actualMachines?: number;
  itemId?: string;
  recipeId?: string;
  terminalRecipeId?: string;
  issueCode?: string;
};

export type MachineDetailGroup = {
  sourceRecipeId: string;
  sourceItemId: string;
  sourceItemNameJa: string;
  sourceItemNameEn: string;
  sourceOutputRate: number;
  rows: MachineDetailRow[];
  allocationSummary: TableAllocationSummary;
};

export type TableAllocationSummary = {
  sourceRecipeId: string;
  sourceItemId: string;
  sourceOutputRate: number;
  displayedUsageRate: number;
  allocatedUsageRate: number;
  terminalUsageRate: number;
  ignoredSurplusRate: number;
  ignoredDiscardRate: number;
  ignoredSteamRate: number;
  ignoredRecipeRate: number;
  unallocatedUsageRate: number;
  overallocatedUsageRate: number;
  balanceBaseRate: number;
  difference: number;
  allocationBalanced: boolean;
};

export type TableExpansionTraceEntry = {
  action:
    | 'start'
    | 'advance'
    | 'terminal'
    | 'cycle'
    | 'unallocated'
    | 'overallocated'
    | 'limit'
    | 'ignoredSurplus'
    | 'ignoredDiscard'
    | 'ignoredSteam'
    | 'ignoredRecipe';
  sourceRecipeId: string;
  sourceItemId: string;
  fromRecipeId?: string;
  toRecipeId?: string;
  itemId?: string;
  sinkMode?: string;
  terminalRole?: MachineDetailRowKind;
  ignoredReason?: string;
  flowRate?: number;
  usageRate: number;
  pathRecipeIds: string[];
  noteJa?: string;
  noteEn?: string;
};

export type TableViewIssue = {
  severity: 'error' | 'warning';
  code: 'TABLE_USAGE_UNALLOCATED' | 'TABLE_USAGE_OVERALLOCATED' | 'TABLE_USAGE_TRACE_LIMIT';
  messageJa: string;
  messageEn: string;
  data: unknown;
};

export type TableViewModel = {
  schemaVersion: typeof TABLE_VIEW_SCHEMA_VERSION;
  usageMethod: 'positive-net-production-demand-attribution-ignore-surplus-and-steam';
  mainSort: TablePreferences['machineSort'];
  detailSort: TablePreferences['machineDetailSort'];
  columns: {
    main: MachineTableSortKey[];
    detail: MachineDetailTableSortKey[];
  };
  mainRows: MachineMainRow[];
  detailGroupsByRecipeId: Record<string, MachineDetailGroup[]>;
  allocationSummariesByRecipeId: Record<string, TableAllocationSummary[]>;
  expansionTraceByRecipeId: Record<string, TableExpansionTraceEntry[]>;
  ignoredExpansionRecipeIds: string[];
  issues: TableViewIssue[];
};

type MutableDetailRow = MachineDetailRow;

type BuildContext = {
  result: CalculationResult;
  sourceRecipeId: string;
  sourceItemId: string;
  sourceOutputRate: number;
  outgoingByRecipe: Map<string, CalculatedFlow[]>;
  rowMap: Map<string, MutableDetailRow>;
  trace: TableExpansionTraceEntry[];
  issues: TableViewIssue[];
  steps: number;
  limitHit: boolean;
  ignoredSurplusRate: number;
  ignoredDiscardRate: number;
  ignoredSteamRate: number;
  ignoredRecipeRate: number;
  finalLabelMode?: 'item' | 'itemAndRecipe';
};

function localizedFallbackName(id: string): LocalizedName {
  return { ja: id, en: id };
}

function itemName(itemId: string): LocalizedName {
  const item = itemById[itemId];
  return item ? item.name : localizedFallbackName(itemId);
}

function recipeName(recipeId: string): LocalizedName {
  const recipe = recipeById[recipeId];
  return recipe ? recipe.name : localizedFallbackName(recipeId);
}

function machineName(machineId: string): LocalizedName {
  const machine = machineById[machineId];
  return machine ? machine.name : localizedFallbackName(machineId);
}

function compareText(a: string, b: string, lang: Lang): number {
  return new Intl.Collator(lang === 'ja' ? 'ja' : 'en', { numeric: true, sensitivity: 'base' }).compare(a, b);
}

function surplusTotal(row: MachineMainRow): number {
  return row.surplusOutputs.reduce((sum, output) => sum + output.rate, 0);
}

function positiveOutputs(record: Record<string, number>): TableProductionOutput[] {
  return Object.entries(record)
    .filter(([, rate]) => Number.isFinite(rate) && rate > EPS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, rate]) => {
      const name = itemName(itemId);
      return {
        itemId,
        itemNameJa: name.ja,
        itemNameEn: name.en,
        rate,
      };
    });
}

function usageExpansionIgnoredReason(recipeId: string, productionOutputs?: TableProductionOutput[]): MachineMainRow['expansionIgnoredReason'] | undefined {
  const recipe = recipeById[recipeId];
  if (!recipe) return 'missing_recipe';
  const machine = machineById[recipe.machineId];
  if (machine?.category === 'steam') return 'steam_recipe';
  if ((productionOutputs ?? positiveOutputs(Object.fromEntries(recipe.outputs.map((output) => [output.itemId, output.amount])))).some((output) => output.itemId === 'steam')) return 'steam_output';
  return undefined;
}

function isUsageExpansionIgnoredRecipe(recipeId: string, productionOutputs?: TableProductionOutput[]): boolean {
  return usageExpansionIgnoredReason(recipeId, productionOutputs) !== undefined;
}

function positiveRecord(record: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [itemId, rate] of Object.entries(record)) {
    if (Number.isFinite(rate) && rate > EPS) result[itemId] = rate;
  }
  return result;
}

function suppressedGrossOutputs(outputRates: Record<string, number>, netRates: Record<string, number>): MachineMainRow['suppressedGrossOutputs'] {
  return Object.entries(outputRates)
    .filter(([, grossOutputRate]) => Number.isFinite(grossOutputRate) && grossOutputRate > EPS)
    .filter(([itemId]) => (netRates[itemId] ?? 0) <= EPS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([itemId, grossOutputRate]) => {
      const name = itemName(itemId);
      return {
        itemId,
        itemNameJa: name.ja,
        itemNameEn: name.en,
        grossOutputRate,
        netRate: netRates[itemId] ?? 0,
        reason: 'net_non_positive' as const,
      };
    });
}

function mainRowFromRecipeStat(stat: RecipeStat): MachineMainRow {
  const recipe = recipeName(stat.recipeId);
  const machine = machineName(stat.machineId);
  const netProductionRates = positiveRecord(stat.netRates);
  const productionOutputs = positiveOutputs(netProductionRates);
  const expansionIgnoredReason = usageExpansionIgnoredReason(stat.recipeId, productionOutputs);
  return {
    recipeId: stat.recipeId,
    rowKind: 'recipe',
    recipeNameJa: recipe.ja,
    recipeNameEn: recipe.en,
    machineId: stat.machineId,
    machineNameJa: machine.ja,
    machineNameEn: machine.en,
    productionOutputs,
    productionRateTotal: productionOutputs.reduce((sum, output) => sum + output.rate, 0),
    productionRateSource: 'positive-netRates',
    grossOutputRates: { ...stat.outputRates },
    netProductionRates,
    suppressedGrossOutputs: suppressedGrossOutputs(stat.outputRates, stat.netRates),
    theoreticalMachines: stat.theoreticalMachines,
    actualMachines: stat.actualMachines,
    surplusOutputs: positiveOutputs(stat.surplusOutputRates),
    expandable: false,
    expansionIgnored: expansionIgnoredReason !== undefined,
    expansionIgnoredReason,
  };
}

function compareMainRows(a: MachineMainRow, b: MachineMainRow, key: MachineTableSortKey, lang: Lang): number {
  if (key === 'recipe') return compareText(lang === 'ja' ? a.recipeNameJa : a.recipeNameEn, lang === 'ja' ? b.recipeNameJa : b.recipeNameEn, lang);
  if (key === 'machine') return compareText(lang === 'ja' ? a.machineNameJa : a.machineNameEn, lang === 'ja' ? b.machineNameJa : b.machineNameEn, lang);
  if (key === 'productionRate') return a.productionRateTotal - b.productionRateTotal;
  if (key === 'theoreticalMachines') return a.theoreticalMachines - b.theoreticalMachines;
  if (key === 'actualMachines') return a.actualMachines - b.actualMachines;
  return surplusTotal(a) - surplusTotal(b);
}

function sortMainRows(rows: MachineMainRow[], sort: TablePreferences['machineSort'], lang: Lang): MachineMainRow[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareMainRows(a, b, sort.key, lang) * direction;
    if (primary !== 0) return primary;
    return compareText(lang === 'ja' ? a.recipeNameJa : a.recipeNameEn, lang === 'ja' ? b.recipeNameJa : b.recipeNameEn, lang) || a.recipeId.localeCompare(b.recipeId);
  });
}

function compareNullableNumber(a: number | undefined, b: number | undefined): number {
  const av = Number.isFinite(a) ? Number(a) : Number.NEGATIVE_INFINITY;
  const bv = Number.isFinite(b) ? Number(b) : Number.NEGATIVE_INFINITY;
  return av - bv;
}

function compareDetailRows(a: MachineDetailRow, b: MachineDetailRow, key: MachineDetailTableSortKey, lang: Lang): number {
  if (key === 'label') return compareText(lang === 'ja' ? a.labelJa : a.labelEn, lang === 'ja' ? b.labelJa : b.labelEn, lang);
  if (key === 'usageRate') return a.usageRate - b.usageRate;
  if (key === 'productionRate') return compareNullableNumber(a.productionRate, b.productionRate);
  if (key === 'theoreticalMachines') return compareNullableNumber(a.theoreticalMachines, b.theoreticalMachines);
  return compareNullableNumber(a.actualMachines, b.actualMachines);
}

function sortDetailRows(rows: MachineDetailRow[], sort: TablePreferences['machineDetailSort'], lang: Lang): MachineDetailRow[] {
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const primary = compareDetailRows(a, b, sort.key, lang) * direction;
    if (primary !== 0) return primary;
    return compareText(lang === 'ja' ? a.labelJa : a.labelEn, lang === 'ja' ? b.labelJa : b.labelEn, lang) || a.id.localeCompare(b.id);
  });
}

function isAttributableOutputFlow(flow: CalculatedFlow): boolean {
  if (!Number.isFinite(flow.rate) || flow.rate <= EPS) return false;
  if (flow.from.type !== 'recipe') return false;
  if (flow.to.type === 'recipe') return true;
  return flow.to.type === 'itemSink' && (flow.to.sinkMode === 'final' || flow.to.sinkMode === 'surplus' || flow.to.sinkMode === 'discard');
}

function addTrace(ctx: BuildContext, entry: Omit<TableExpansionTraceEntry, 'sourceRecipeId' | 'sourceItemId'>): void {
  ctx.trace.push({
    sourceRecipeId: ctx.sourceRecipeId,
    sourceItemId: ctx.sourceItemId,
    ...entry,
  });
}

function issueForUnallocated(ctx: BuildContext, rate: number, reason: string): TableViewIssue {
  return {
    severity: 'error',
    code: 'TABLE_USAGE_UNALLOCATED',
    messageJa: '表の使用量配賦に未配賦があります。計算結果または表展開ロジックの確認が必要です。',
    messageEn: 'The table usage allocation has an unallocated amount. Check the calculation result or table expansion logic.',
    data: {
      sourceRecipeId: ctx.sourceRecipeId,
      sourceItemId: ctx.sourceItemId,
      sourceOutputRate: ctx.sourceOutputRate,
      unallocatedUsageRate: rate,
      reason,
    },
  };
}

function addIssueOnce(issues: TableViewIssue[], issue: TableViewIssue): void {
  const key = issue.code + ':' + JSON.stringify(issue.data);
  if (issues.some((existing) => existing.code + ':' + JSON.stringify(existing.data) === key)) return;
  issues.push(issue);
}

function addOrUpdateRow(ctx: BuildContext, row: MachineDetailRow, productionAggregation: 'sum' | 'max' = 'sum'): void {
  const existing = ctx.rowMap.get(row.id);
  if (!existing) {
    ctx.rowMap.set(row.id, row);
    return;
  }
  existing.usageRate += row.usageRate;
  if (row.productionRate !== undefined) {
    existing.productionRate = productionAggregation === 'max'
      ? Math.max(existing.productionRate ?? 0, row.productionRate)
      : (existing.productionRate ?? 0) + row.productionRate;
  }
}

function usagePercent(usageRate: number, denominator: number): number {
  return denominator > EPS ? usageRate / denominator * 100 : 0;
}

function addFinalRow(ctx: BuildContext, itemId: string, terminalRecipeId: string, usageRate: number, finalOutputRate: number): void {
  const name = itemName(itemId);
  const terminalRecipeName = recipeName(terminalRecipeId);
  const labelJa = ctx.finalLabelMode === 'itemAndRecipe' ? `${name.ja} (${terminalRecipeName.ja})` : name.ja;
  const labelEn = ctx.finalLabelMode === 'itemAndRecipe' ? `${name.en} (${terminalRecipeName.en})` : name.en;
  const stat = ctx.result.recipeStats[terminalRecipeId];
  addOrUpdateRow(ctx, {
    id: `final:${itemId}:${terminalRecipeId}`,
    kind: 'final',
    labelJa,
    labelEn,
    sourceItemId: ctx.sourceItemId,
    sourceOutputRate: ctx.sourceOutputRate,
    usageRate,
    usagePercent: 0,
    productionRate: finalOutputRate,
    theoreticalMachines: stat?.theoreticalMachines,
    actualMachines: stat?.actualMachines,
    itemId,
    recipeId: terminalRecipeId,
    terminalRecipeId,
  }, 'max');
}

function addSpecialDemandRow(ctx: BuildContext, kind: 'fuel' | 'fertilizer', itemId: string, usageRate: number): void {
  const name = itemName(itemId);
  addOrUpdateRow(ctx, {
    id: `${kind}:${itemId}`,
    kind,
    labelJa: `${kind === 'fuel' ? '燃料' : '肥料'}: ${name.ja}`,
    labelEn: `${kind === 'fuel' ? 'Fuel' : 'Fertilizer'}: ${name.en}`,
    sourceItemId: ctx.sourceItemId,
    sourceOutputRate: ctx.sourceOutputRate,
    usageRate,
    usagePercent: 0,
    itemId,
  });
}

function addIgnoredRate(ctx: BuildContext, kind: 'surplus' | 'discard' | 'steam' | 'recipe', flow: CalculatedFlow | undefined, usageRate: number, pathRecipeIds: string[], noteJa: string, noteEn: string): void {
  if (usageRate <= EPS) return;
  if (kind === 'surplus') ctx.ignoredSurplusRate += usageRate;
  else if (kind === 'discard') ctx.ignoredDiscardRate += usageRate;
  else if (kind === 'steam') ctx.ignoredSteamRate += usageRate;
  else ctx.ignoredRecipeRate += usageRate;
  addTrace(ctx, {
    action: kind === 'surplus' ? 'ignoredSurplus' : kind === 'discard' ? 'ignoredDiscard' : kind === 'steam' ? 'ignoredSteam' : 'ignoredRecipe',
    fromRecipeId: flow?.from.type === 'recipe' ? flow.from.recipeId : undefined,
    toRecipeId: flow?.to.type === 'recipe' ? flow.to.recipeId : undefined,
    itemId: flow?.itemId,
    sinkMode: flow?.to.type === 'itemSink' ? flow.to.sinkMode : undefined,
    flowRate: flow?.rate,
    usageRate,
    pathRecipeIds,
    ignoredReason: kind,
    noteJa,
    noteEn,
  });
}

function addCycleRow(ctx: BuildContext, recipeId: string, usageRate: number): void {
  const name = recipeName(recipeId);
  addOrUpdateRow(ctx, {
    id: `cycle:${recipeId}`,
    kind: 'cycle',
    labelJa: `${name.ja} (循環)`,
    labelEn: `${name.en} (cycle)`,
    sourceItemId: ctx.sourceItemId,
    sourceOutputRate: ctx.sourceOutputRate,
    usageRate,
    usagePercent: 0,
    recipeId,
  });
}

function addUnallocatedRow(ctx: BuildContext, usageRate: number, reasonJa: string, reasonEn: string): void {
  if (usageRate <= EPS) return;
  addOrUpdateRow(ctx, {
    id: 'unallocated',
    kind: 'unallocated',
    labelJa: '未配賦 (エラー)',
    labelEn: 'Unallocated (error)',
    sourceItemId: ctx.sourceItemId,
    sourceOutputRate: ctx.sourceOutputRate,
    usageRate,
    usagePercent: 0,
    issueCode: 'TABLE_USAGE_UNALLOCATED',
  });
  addTrace(ctx, {
    action: 'unallocated',
    usageRate,
    pathRecipeIds: [ctx.sourceRecipeId],
    noteJa: reasonJa,
    noteEn: reasonEn,
  });
  addIssueOnce(ctx.issues, issueForUnallocated(ctx, usageRate, reasonEn));
}

function addOverallocatedRow(ctx: BuildContext, usageRate: number): void {
  if (usageRate <= EPS) return;
  addOrUpdateRow(ctx, {
    id: 'overallocated',
    kind: 'overallocated',
    labelJa: '過配賦 (エラー)',
    labelEn: 'Overallocated (error)',
    sourceItemId: ctx.sourceItemId,
    sourceOutputRate: ctx.sourceOutputRate,
    usageRate,
    usagePercent: 0,
    issueCode: 'TABLE_USAGE_OVERALLOCATED',
  });
  addTrace(ctx, {
    action: 'overallocated',
    usageRate,
    pathRecipeIds: [ctx.sourceRecipeId],
    noteJa: '表の使用量配賦が親レシピの対象生産量を超えました。',
    noteEn: 'The table usage allocation exceeded the source output rate.',
  });
  addIssueOnce(ctx.issues, {
    severity: 'error',
    code: 'TABLE_USAGE_OVERALLOCATED',
    messageJa: '表の使用量配賦が親レシピの対象生産量を超えています。',
    messageEn: 'The table usage allocation exceeds the source output rate.',
    data: {
      sourceRecipeId: ctx.sourceRecipeId,
      sourceItemId: ctx.sourceItemId,
      sourceOutputRate: ctx.sourceOutputRate,
      overallocatedUsageRate: usageRate,
    },
  });
}

function consumeFlow(ctx: BuildContext, flow: CalculatedFlow, usageRate: number, pathRecipeIds: string[], depth: number): void {
  if (usageRate <= EPS) return;
  if (ctx.steps > MAX_STEPS_PER_SOURCE) {
    ctx.limitHit = true;
    addUnallocatedRow(ctx, usageRate, '探索上限に到達したため、未配賦として扱います。', 'Reached the expansion trace limit; treated as unallocated.');
    addTrace(ctx, {
      action: 'limit',
      fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
      itemId: flow.itemId,
      flowRate: flow.rate,
      usageRate,
      pathRecipeIds,
    });
    addIssueOnce(ctx.issues, {
      severity: 'error',
      code: 'TABLE_USAGE_TRACE_LIMIT',
      messageJa: '表の使用量配賦が探索上限に到達しました。',
      messageEn: 'The table usage allocation reached the trace limit.',
      data: {
        sourceRecipeId: ctx.sourceRecipeId,
        sourceItemId: ctx.sourceItemId,
        maxSteps: MAX_STEPS_PER_SOURCE,
      },
    });
    return;
  }

  if (flow.role === 'steam' || flow.itemId === 'steam') {
    addIgnoredRate(ctx, 'steam', flow, usageRate, pathRecipeIds, '蒸気フローは表の使用量内訳から除外します。', 'Steam flow is ignored by the table usage allocation.');
    return;
  }

  if (flow.role === 'fuel' || flow.role === 'fertilizer') {
    addSpecialDemandRow(ctx, flow.role, flow.itemId, usageRate);
    addTrace(ctx, {
      action: 'terminal',
      fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
      toRecipeId: flow.to.type === 'recipe' ? flow.to.recipeId : undefined,
      itemId: flow.itemId,
      terminalRole: flow.role,
      flowRate: flow.rate,
      usageRate,
      pathRecipeIds,
    });
    return;
  }

  if (flow.to.type === 'itemSink') {
    if (flow.to.sinkMode === 'final') {
      addFinalRow(ctx, flow.itemId, flow.from.type === 'recipe' ? flow.from.recipeId : '', usageRate, flow.rate);
      addTrace(ctx, {
        action: 'terminal',
        fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
        itemId: flow.itemId,
        sinkMode: flow.to.sinkMode,
        terminalRole: 'final',
        flowRate: flow.rate,
        usageRate,
        pathRecipeIds,
      });
    } else if (flow.to.sinkMode === 'surplus') {
      addIgnoredRate(ctx, 'surplus', flow, usageRate, pathRecipeIds, '余剰は原因ランキングから除外します。', 'Surplus is ignored by the demand ranking.');
    } else if (flow.to.sinkMode === 'discard') {
      addIgnoredRate(ctx, 'discard', flow, usageRate, pathRecipeIds, '破棄は原因ランキングから除外します。', 'Discard is ignored by the demand ranking.');
    }
    return;
  }

  if (flow.to.type !== 'recipe') return;
  const nextRecipeId = flow.to.recipeId;
  if (isUsageExpansionIgnoredRecipe(nextRecipeId)) {
    addIgnoredRate(ctx, 'recipe', flow, usageRate, pathRecipeIds, '蒸気などの中継設備は表の使用量内訳から除外します。', 'Utility recipes such as steam recipes are ignored by the table usage allocation.');
    return;
  }

  if (pathRecipeIds.includes(nextRecipeId)) {
    addCycleRow(ctx, nextRecipeId, usageRate);
    addTrace(ctx, {
      action: 'cycle',
      fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
      toRecipeId: nextRecipeId,
      itemId: flow.itemId,
      flowRate: flow.rate,
      usageRate,
      pathRecipeIds: [...pathRecipeIds, nextRecipeId],
    });
    return;
  }

  addTrace(ctx, {
    action: 'advance',
    fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
    toRecipeId: nextRecipeId,
    itemId: flow.itemId,
    flowRate: flow.rate,
    usageRate,
    pathRecipeIds: [...pathRecipeIds, nextRecipeId],
  });
  visitRecipe(ctx, nextRecipeId, usageRate, [...pathRecipeIds, nextRecipeId], depth + 1);
}

function visitRecipe(ctx: BuildContext, recipeId: string, usageRate: number, pathRecipeIds: string[], depth: number): void {
  if (usageRate <= EPS) return;
  ctx.steps += 1;
  if (depth > MAX_DEPTH) {
    addUnallocatedRow(ctx, usageRate, '探索深度の上限に到達したため、未配賦として扱います。', 'Reached the expansion depth limit; treated as unallocated.');
    addTrace(ctx, {
      action: 'limit',
      fromRecipeId: recipeId,
      usageRate,
      pathRecipeIds,
    });
    return;
  }

  if (isUsageExpansionIgnoredRecipe(recipeId)) {
    addIgnoredRate(ctx, 'recipe', undefined, usageRate, pathRecipeIds, '蒸気などの中継設備は表の使用量内訳から除外します。', 'Utility recipes such as steam recipes are ignored by the table usage allocation.');
    return;
  }

  const flows = ctx.outgoingByRecipe.get(recipeId) ?? [];
  const totalOut = flows.reduce((sum, flow) => sum + Math.max(0, flow.rate), 0);
  if (totalOut <= EPS) {
    addUnallocatedRow(ctx, usageRate, '下流の出力先がないため、未配賦として扱います。', 'No downstream output target; treated as unallocated.');
    return;
  }

  for (const flow of flows) {
    const share = usageRate * Math.max(0, flow.rate) / totalOut;
    consumeFlow(ctx, flow, share, pathRecipeIds, depth);
  }
}

function allocationTolerance(sourceOutputRate: number): number {
  return Math.max(0.0001, Math.abs(sourceOutputRate) * 1e-9);
}

function buildDetailGroup(
  result: CalculationResult,
  outgoingByRecipe: Map<string, CalculatedFlow[]>,
  sourceRecipeId: string,
  sourceOutput: TableProductionOutput,
  detailSort: TablePreferences['machineDetailSort'],
  lang: Lang,
  issues: TableViewIssue[],
): { group: MachineDetailGroup; trace: TableExpansionTraceEntry[] } {
  const rowMap = new Map<string, MutableDetailRow>();
  const trace: TableExpansionTraceEntry[] = [];
  const ctx: BuildContext = {
    result,
    sourceRecipeId,
    sourceItemId: sourceOutput.itemId,
    sourceOutputRate: sourceOutput.rate,
    outgoingByRecipe,
    rowMap,
    trace,
    issues,
    steps: 0,
    limitHit: false,
    ignoredSurplusRate: 0,
    ignoredDiscardRate: 0,
    ignoredSteamRate: 0,
    ignoredRecipeRate: 0,
  };

  addTrace(ctx, {
    action: 'start',
    fromRecipeId: sourceRecipeId,
    itemId: sourceOutput.itemId,
    usageRate: sourceOutput.rate,
    pathRecipeIds: [sourceRecipeId],
  });

  const initialFlows = (outgoingByRecipe.get(sourceRecipeId) ?? []).filter((flow) => flow.itemId === sourceOutput.itemId);
  if (initialFlows.length === 0) {
    addUnallocatedRow(ctx, sourceOutput.rate, '親レシピの対象出力に対応する下流フローがありません。', 'No downstream flow for the source recipe output.');
  } else {
    for (const flow of initialFlows) consumeFlow(ctx, flow, flow.rate, [sourceRecipeId], 1);
  }

  let terminalUsageRate = 0;
  for (const row of rowMap.values()) {
    if (row.kind !== 'unallocated' && row.kind !== 'overallocated') terminalUsageRate += row.usageRate;
  }
  const ignoredTotal = ctx.ignoredSurplusRate + ctx.ignoredDiscardRate + ctx.ignoredSteamRate + ctx.ignoredRecipeRate;
  const balanceBaseRate = Math.max(0, sourceOutput.rate - ignoredTotal);
  const diff = balanceBaseRate - terminalUsageRate;
  const tolerance = allocationTolerance(sourceOutput.rate);
  if (diff > tolerance) addUnallocatedRow(ctx, diff, '使用量の合計が余剰・蒸気除外後の対象生産量に届いていません。', 'Usage rows do not add up to the source output rate after ignored surplus and steam are removed.');
  else if (diff < -tolerance) addOverallocatedRow(ctx, Math.abs(diff));

  const rowsBeforeSort = [...rowMap.values()].map((row) => ({
    ...row,
    usagePercent: usagePercent(row.usageRate, balanceBaseRate),
  }));
  const rows = sortDetailRows(rowsBeforeSort, detailSort, lang);
  const unallocatedUsageRate = rows.filter((row) => row.kind === 'unallocated').reduce((sum, row) => sum + row.usageRate, 0);
  const overallocatedUsageRate = rows.filter((row) => row.kind === 'overallocated').reduce((sum, row) => sum + row.usageRate, 0);
  const displayedUsageRate = rows.filter((row) => row.kind !== 'overallocated').reduce((sum, row) => sum + row.usageRate, 0);
  const terminalRowsUsageRate = rows
    .filter((row) => row.kind !== 'unallocated' && row.kind !== 'overallocated')
    .reduce((sum, row) => sum + row.usageRate, 0);
  const summary: TableAllocationSummary = {
    sourceRecipeId,
    sourceItemId: sourceOutput.itemId,
    sourceOutputRate: sourceOutput.rate,
    displayedUsageRate,
    allocatedUsageRate: displayedUsageRate,
    terminalUsageRate: terminalRowsUsageRate,
    ignoredSurplusRate: ctx.ignoredSurplusRate,
    ignoredDiscardRate: ctx.ignoredDiscardRate,
    ignoredSteamRate: ctx.ignoredSteamRate,
    ignoredRecipeRate: ctx.ignoredRecipeRate,
    unallocatedUsageRate,
    overallocatedUsageRate,
    balanceBaseRate,
    difference: balanceBaseRate - displayedUsageRate,
    allocationBalanced: unallocatedUsageRate <= tolerance && overallocatedUsageRate <= tolerance && Math.abs(balanceBaseRate - displayedUsageRate) <= tolerance,
  };

  return {
    group: {
      sourceRecipeId,
      sourceItemId: sourceOutput.itemId,
      sourceItemNameJa: sourceOutput.itemNameJa,
      sourceItemNameEn: sourceOutput.itemNameEn,
      sourceOutputRate: sourceOutput.rate,
      rows,
      allocationSummary: summary,
    },
    trace,
  };
}

function isSelfOnlyDetail(row: MachineMainRow, groups: MachineDetailGroup[]): boolean {
  if (row.rowKind !== 'recipe' || groups.length !== 1) return false;
  const group = groups[0];
  if (group.rows.length !== 1) return false;
  const detail = group.rows[0];
  if (detail.kind !== 'final') return false;
  if (detail.recipeId !== row.recipeId) return false;
  if (detail.itemId !== group.sourceItemId) return false;
  return Math.abs(detail.usagePercent - 100) <= 0.0001;
}

function specialDemandRowId(kind: 'fuel' | 'fertilizer', itemId: string): string {
  return `__special:${kind}:${itemId}`;
}

function makeSpecialDemandMainRow(kind: 'fuel' | 'fertilizer', itemId: string, rate: number): MachineMainRow {
  const name = itemName(itemId);
  const labelJa = `${kind === 'fuel' ? '燃料' : '肥料'}: ${name.ja}`;
  const labelEn = `${kind === 'fuel' ? 'Fuel' : 'Fertilizer'}: ${name.en}`;
  return {
    recipeId: specialDemandRowId(kind, itemId),
    rowKind: kind === 'fuel' ? 'fuelDemand' : 'fertilizerDemand',
    recipeNameJa: labelJa,
    recipeNameEn: labelEn,
    machineId: '',
    machineNameJa: '-',
    machineNameEn: '-',
    productionOutputs: [{ itemId, itemNameJa: name.ja, itemNameEn: name.en, rate }],
    productionRateTotal: rate,
    productionRateSource: 'special-demand',
    grossOutputRates: {},
    netProductionRates: { [itemId]: rate },
    suppressedGrossOutputs: [],
    theoreticalMachines: 0,
    actualMachines: 0,
    surplusOutputs: [],
    expandable: false,
    expansionIgnored: false,
  };
}

function buildSpecialDemandDetailGroup(
  result: CalculationResult,
  outgoingByRecipe: Map<string, CalculatedFlow[]>,
  kind: 'fuel' | 'fertilizer',
  itemId: string,
  demandFlows: CalculatedFlow[],
  detailSort: TablePreferences['machineDetailSort'],
  lang: Lang,
  issues: TableViewIssue[],
): { group: MachineDetailGroup; trace: TableExpansionTraceEntry[] } {
  const sourceRecipeId = specialDemandRowId(kind, itemId);
  const name = itemName(itemId);
  const totalRate = demandFlows.reduce((sum, flow) => sum + Math.max(0, flow.rate), 0);
  const rowMap = new Map<string, MutableDetailRow>();
  const trace: TableExpansionTraceEntry[] = [];
  const ctx: BuildContext = {
    result,
    sourceRecipeId,
    sourceItemId: itemId,
    sourceOutputRate: totalRate,
    outgoingByRecipe,
    rowMap,
    trace,
    issues,
    steps: 0,
    limitHit: false,
    ignoredSurplusRate: 0,
    ignoredDiscardRate: 0,
    ignoredSteamRate: 0,
    ignoredRecipeRate: 0,
    finalLabelMode: 'itemAndRecipe',
  };

  addTrace(ctx, {
    action: 'start',
    itemId,
    usageRate: totalRate,
    pathRecipeIds: [sourceRecipeId],
    noteJa: `${kind === 'fuel' ? '燃料' : '肥料'}需要の内訳を最終出力へ配賦します。`,
    noteEn: `Attribute ${kind} demand to final outputs.`,
  });

  for (const flow of demandFlows) {
    if (flow.to.type !== 'recipe') {
      addIgnoredRate(ctx, 'recipe', flow, flow.rate, [sourceRecipeId], '消費先レシピがない特殊需要は内訳対象外です。', 'Special demand without a consuming recipe is ignored.');
      continue;
    }
    const consumerRecipeId = flow.to.recipeId;
    addTrace(ctx, {
      action: 'advance',
      fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
      toRecipeId: consumerRecipeId,
      itemId: flow.itemId,
      flowRate: flow.rate,
      usageRate: flow.rate,
      pathRecipeIds: [sourceRecipeId, consumerRecipeId],
      noteJa: `${kind === 'fuel' ? '燃料' : '肥料'}として消費したレシピから最終出力を探索します。`,
      noteEn: `Trace final outputs from the recipe that consumed the ${kind}.`,
    });
    visitRecipe(ctx, consumerRecipeId, flow.rate, [sourceRecipeId, consumerRecipeId], 1);
  }

  let terminalUsageRate = 0;
  for (const row of rowMap.values()) {
    if (row.kind !== 'unallocated' && row.kind !== 'overallocated') terminalUsageRate += row.usageRate;
  }
  const ignoredTotal = ctx.ignoredSurplusRate + ctx.ignoredDiscardRate + ctx.ignoredSteamRate + ctx.ignoredRecipeRate;
  const balanceBaseRate = Math.max(0, totalRate - ignoredTotal);
  const diff = balanceBaseRate - terminalUsageRate;
  const tolerance = allocationTolerance(totalRate);
  if (diff > tolerance) addUnallocatedRow(ctx, diff, '特殊需要の使用量が最終出力へ配賦しきれていません。', 'Special demand usage could not be fully attributed to final outputs.');
  else if (diff < -tolerance) addOverallocatedRow(ctx, Math.abs(diff));

  const rowsBeforeSort = [...rowMap.values()].map((row) => ({
    ...row,
    usagePercent: usagePercent(row.usageRate, balanceBaseRate),
  }));
  const rows = sortDetailRows(rowsBeforeSort, detailSort, lang);
  const unallocatedUsageRate = rows.filter((row) => row.kind === 'unallocated').reduce((sum, row) => sum + row.usageRate, 0);
  const overallocatedUsageRate = rows.filter((row) => row.kind === 'overallocated').reduce((sum, row) => sum + row.usageRate, 0);
  const displayedUsageRate = rows.filter((row) => row.kind !== 'overallocated').reduce((sum, row) => sum + row.usageRate, 0);
  const terminalRowsUsageRate = rows
    .filter((row) => row.kind !== 'unallocated' && row.kind !== 'overallocated')
    .reduce((sum, row) => sum + row.usageRate, 0);
  const summary: TableAllocationSummary = {
    sourceRecipeId,
    sourceItemId: itemId,
    sourceOutputRate: totalRate,
    displayedUsageRate,
    allocatedUsageRate: displayedUsageRate,
    terminalUsageRate: terminalRowsUsageRate,
    ignoredSurplusRate: ctx.ignoredSurplusRate,
    ignoredDiscardRate: ctx.ignoredDiscardRate,
    ignoredSteamRate: ctx.ignoredSteamRate,
    ignoredRecipeRate: ctx.ignoredRecipeRate,
    unallocatedUsageRate,
    overallocatedUsageRate,
    balanceBaseRate,
    difference: balanceBaseRate - displayedUsageRate,
    allocationBalanced: unallocatedUsageRate <= tolerance && overallocatedUsageRate <= tolerance && Math.abs(balanceBaseRate - displayedUsageRate) <= tolerance,
  };

  return {
    group: {
      sourceRecipeId,
      sourceItemId: itemId,
      sourceItemNameJa: name.ja,
      sourceItemNameEn: name.en,
      sourceOutputRate: totalRate,
      rows,
      allocationSummary: summary,
    },
    trace,
  };
}

function appendSpecialDemandRows(
  rows: MachineMainRow[],
  result: CalculationResult,
  outgoingByRecipe: Map<string, CalculatedFlow[]>,
  tablePreferences: TablePreferences,
  lang: Lang,
  detailGroupsByRecipeId: Record<string, MachineDetailGroup[]>,
  allocationSummariesByRecipeId: Record<string, TableAllocationSummary[]>,
  expansionTraceByRecipeId: Record<string, TableExpansionTraceEntry[]>,
  issues: TableViewIssue[],
): MachineMainRow[] {
  const grouped = new Map<string, { kind: 'fuel' | 'fertilizer'; itemId: string; flows: CalculatedFlow[] }>();
  for (const flow of result.flows) {
    if ((flow.role !== 'fuel' && flow.role !== 'fertilizer') || flow.rate <= EPS) continue;
    const kind = flow.role;
    const key = `${kind}:${flow.itemId}`;
    const existing = grouped.get(key) ?? { kind, itemId: flow.itemId, flows: [] };
    existing.flows.push(flow);
    grouped.set(key, existing);
  }
  const appended = [...rows];
  for (const entry of [...grouped.values()].sort((a, b) => `${a.kind}:${a.itemId}`.localeCompare(`${b.kind}:${b.itemId}`))) {
    const totalRate = entry.flows.reduce((sum, flow) => sum + Math.max(0, flow.rate), 0);
    if (totalRate <= EPS) continue;
    const row = makeSpecialDemandMainRow(entry.kind, entry.itemId, totalRate);
    const { group, trace } = buildSpecialDemandDetailGroup(result, outgoingByRecipe, entry.kind, entry.itemId, entry.flows, tablePreferences.machineDetailSort, lang, issues);
    if (group.rows.length > 0) {
      detailGroupsByRecipeId[row.recipeId] = [group];
      allocationSummariesByRecipeId[row.recipeId] = [group.allocationSummary];
      expansionTraceByRecipeId[row.recipeId] = trace;
      row.expandable = true;
    }
    appended.push(row);
  }
  return appended;
}


export function buildTableViewModel(result: CalculationResult, tablePreferences: TablePreferences, lang: Lang): TableViewModel {
  const outgoingByRecipe = new Map<string, CalculatedFlow[]>();
  for (const flow of result.flows) {
    if (!isAttributableOutputFlow(flow) || flow.from.type !== 'recipe') continue;
    const recipeId = flow.from.recipeId;
    const current = outgoingByRecipe.get(recipeId) ?? [];
    current.push(flow);
    outgoingByRecipe.set(recipeId, current);
  }

  for (const flows of outgoingByRecipe.values()) {
    flows.sort((a, b) => a.id.localeCompare(b.id));
  }

  const unsortedMainRows = Object.values(result.recipeStats).map(mainRowFromRecipeStat);
  const detailGroupsByRecipeId: Record<string, MachineDetailGroup[]> = {};
  const allocationSummariesByRecipeId: Record<string, TableAllocationSummary[]> = {};
  const expansionTraceByRecipeId: Record<string, TableExpansionTraceEntry[]> = {};
  const ignoredExpansionRecipeIds: string[] = [];
  const issues: TableViewIssue[] = [];

  const rowsWithExpandableState = unsortedMainRows.map((row) => {
    if (row.expansionIgnored) {
      ignoredExpansionRecipeIds.push(row.recipeId);
      return row;
    }
    const groups: MachineDetailGroup[] = [];
    const summaries: TableAllocationSummary[] = [];
    const traces: TableExpansionTraceEntry[] = [];
    for (const output of row.productionOutputs) {
      if (output.itemId === 'steam') continue;
      const { group, trace } = buildDetailGroup(result, outgoingByRecipe, row.recipeId, output, tablePreferences.machineDetailSort, lang, issues);
      if (group.rows.length > 0) groups.push(group);
      summaries.push(group.allocationSummary);
      traces.push(...trace);
    }
    const expandable = groups.some((group) => group.rows.length > 0) && !isSelfOnlyDetail(row, groups);
    if (expandable && groups.length > 0) detailGroupsByRecipeId[row.recipeId] = groups;
    if (summaries.length > 0) allocationSummariesByRecipeId[row.recipeId] = summaries;
    if (traces.length > 0) expansionTraceByRecipeId[row.recipeId] = traces;
    return {
      ...row,
      expandable,
    };
  });

  const rowsWithSpecialDemand = appendSpecialDemandRows(
    rowsWithExpandableState,
    result,
    outgoingByRecipe,
    tablePreferences,
    lang,
    detailGroupsByRecipeId,
    allocationSummariesByRecipeId,
    expansionTraceByRecipeId,
    issues,
  );

  const mainRows = sortMainRows(rowsWithSpecialDemand, tablePreferences.machineSort, lang);

  return {
    schemaVersion: TABLE_VIEW_SCHEMA_VERSION,
    usageMethod: 'positive-net-production-demand-attribution-ignore-surplus-and-steam',
    mainSort: tablePreferences.machineSort,
    detailSort: tablePreferences.machineDetailSort,
    columns: {
      main: ['recipe', 'machine', 'productionRate', 'theoreticalMachines', 'actualMachines', 'surplus'],
      detail: ['label', 'usageRate', 'productionRate', 'theoreticalMachines', 'actualMachines'],
    },
    mainRows,
    detailGroupsByRecipeId,
    allocationSummariesByRecipeId,
    expansionTraceByRecipeId,
    ignoredExpansionRecipeIds: [...new Set(ignoredExpansionRecipeIds)].sort((a, b) => a.localeCompare(b)),
    issues,
  };
}

export function displayName(value: { itemNameJa?: string; itemNameEn?: string; recipeNameJa?: string; recipeNameEn?: string; machineNameJa?: string; machineNameEn?: string; labelJa?: string; labelEn?: string }, lang: Lang): string {
  if (lang === 'ja') return value.itemNameJa ?? value.recipeNameJa ?? value.machineNameJa ?? value.labelJa ?? '';
  return value.itemNameEn ?? value.recipeNameEn ?? value.machineNameEn ?? value.labelEn ?? '';
}
