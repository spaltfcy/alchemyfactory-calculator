import type { Lang, MachineDetailTableSortKey, MachineTableSortKey, SortDirection, TablePreferences } from '../types';
import type { CalculatedFlow, CalculationResult, RecipeStat } from './calculationTypes';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { recipeById } from '../data/recipes';
import { text } from '../i18n';

const EPS = 1e-9;
const MAX_DEPTH = 64;
const MAX_STEPS_PER_SOURCE = 10000;
const TABLE_VIEW_SCHEMA_VERSION = 'table-view-v0932' as const;

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
  theoreticalMachines: number;
  actualMachines: number;
  surplusOutputs: TableProductionOutput[];
};

export type MachineDetailRowKind = 'final' | 'surplus' | 'discard' | 'cycle' | 'unallocated' | 'overallocated';

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
  allocatedUsageRate: number;
  terminalUsageRate: number;
  unallocatedUsageRate: number;
  overallocatedUsageRate: number;
  difference: number;
  allocationBalanced: boolean;
};

export type TableExpansionTraceEntry = {
  action: 'start' | 'advance' | 'terminal' | 'cycle' | 'unallocated' | 'overallocated' | 'limit';
  sourceRecipeId: string;
  sourceItemId: string;
  fromRecipeId?: string;
  toRecipeId?: string;
  itemId?: string;
  sinkMode?: string;
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
  usageMethod: 'direct-flow-and-proportional-downstream-attribution';
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

function productionRateTotal(row: RecipeStat): number {
  return Object.values(row.outputRates).reduce((sum, value) => sum + Math.max(0, value), 0);
}

function surplusTotal(row: RecipeStat): number {
  return Object.values(row.surplusOutputRates).reduce((sum, value) => sum + Math.max(0, value), 0);
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

function mainRowFromRecipeStat(stat: RecipeStat): MachineMainRow {
  const recipe = recipeName(stat.recipeId);
  const machine = machineName(stat.machineId);
  const productionOutputs = positiveOutputs(stat.outputRates);
  return {
    recipeId: stat.recipeId,
    recipeNameJa: recipe.ja,
    recipeNameEn: recipe.en,
    machineId: stat.machineId,
    machineNameJa: machine.ja,
    machineNameEn: machine.en,
    productionOutputs,
    productionRateTotal: productionOutputs.reduce((sum, output) => sum + output.rate, 0),
    theoreticalMachines: stat.theoreticalMachines,
    actualMachines: stat.actualMachines,
    surplusOutputs: positiveOutputs(stat.surplusOutputRates),
  };
}

function compareMainRows(a: MachineMainRow, b: MachineMainRow, key: MachineTableSortKey, lang: Lang): number {
  if (key === 'recipe') return compareText(lang === 'ja' ? a.recipeNameJa : a.recipeNameEn, lang === 'ja' ? b.recipeNameJa : b.recipeNameEn, lang);
  if (key === 'machine') return compareText(lang === 'ja' ? a.machineNameJa : a.machineNameEn, lang === 'ja' ? b.machineNameJa : b.machineNameEn, lang);
  if (key === 'productionRate') return a.productionRateTotal - b.productionRateTotal;
  if (key === 'theoreticalMachines') return a.theoreticalMachines - b.theoreticalMachines;
  if (key === 'actualMachines') return a.actualMachines - b.actualMachines;
  return a.surplusOutputs.reduce((sum, output) => sum + output.rate, 0) - b.surplusOutputs.reduce((sum, output) => sum + output.rate, 0);
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
  if (flow.role === 'fuel' || flow.role === 'fertilizer' || flow.role === 'steam') return false;
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
  existing.usagePercent = ctx.sourceOutputRate > EPS ? existing.usageRate / ctx.sourceOutputRate * 100 : 0;
  if (row.productionRate !== undefined) {
    existing.productionRate = productionAggregation === 'max'
      ? Math.max(existing.productionRate ?? 0, row.productionRate)
      : (existing.productionRate ?? 0) + row.productionRate;
  }
}

function addFinalRow(ctx: BuildContext, itemId: string, terminalRecipeId: string, usageRate: number, finalOutputRate: number): void {
  const name = itemName(itemId);
  const stat = ctx.result.recipeStats[terminalRecipeId];
  addOrUpdateRow(ctx, {
    id: `final:${itemId}:${terminalRecipeId}`,
    kind: 'final',
    labelJa: name.ja,
    labelEn: name.en,
    sourceItemId: ctx.sourceItemId,
    sourceOutputRate: ctx.sourceOutputRate,
    usageRate,
    usagePercent: ctx.sourceOutputRate > EPS ? usageRate / ctx.sourceOutputRate * 100 : 0,
    productionRate: finalOutputRate,
    theoreticalMachines: stat?.theoreticalMachines,
    actualMachines: stat?.actualMachines,
    itemId,
    recipeId: terminalRecipeId,
    terminalRecipeId,
  }, 'max');
}

function addTerminalRow(ctx: BuildContext, kind: 'surplus' | 'discard', itemId: string, usageRate: number): void {
  const name = itemName(itemId);
  const labelJa = kind === 'surplus' ? `余剰: ${name.ja}` : `破棄: ${name.ja}`;
  const labelEn = kind === 'surplus' ? `Surplus: ${name.en}` : `Discard: ${name.en}`;
  addOrUpdateRow(ctx, {
    id: `${kind}:${itemId}`,
    kind,
    labelJa,
    labelEn,
    sourceItemId: ctx.sourceItemId,
    sourceOutputRate: ctx.sourceOutputRate,
    usageRate,
    usagePercent: ctx.sourceOutputRate > EPS ? usageRate / ctx.sourceOutputRate * 100 : 0,
    itemId,
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
    usagePercent: ctx.sourceOutputRate > EPS ? usageRate / ctx.sourceOutputRate * 100 : 0,
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
    usagePercent: ctx.sourceOutputRate > EPS ? usageRate / ctx.sourceOutputRate * 100 : 0,
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
    usagePercent: ctx.sourceOutputRate > EPS ? usageRate / ctx.sourceOutputRate * 100 : 0,
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

  if (flow.to.type === 'itemSink') {
    if (flow.to.sinkMode === 'final') {
      addFinalRow(ctx, flow.itemId, flow.from.type === 'recipe' ? flow.from.recipeId : '', usageRate, flow.rate);
    } else if (flow.to.sinkMode === 'surplus') {
      addTerminalRow(ctx, 'surplus', flow.itemId, usageRate);
    } else if (flow.to.sinkMode === 'discard') {
      addTerminalRow(ctx, 'discard', flow.itemId, usageRate);
    }
    addTrace(ctx, {
      action: 'terminal',
      fromRecipeId: flow.from.type === 'recipe' ? flow.from.recipeId : undefined,
      itemId: flow.itemId,
      sinkMode: flow.to.sinkMode,
      flowRate: flow.rate,
      usageRate,
      pathRecipeIds,
    });
    return;
  }

  if (flow.to.type !== 'recipe') return;
  const nextRecipeId = flow.to.recipeId;
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
  const diff = sourceOutput.rate - terminalUsageRate;
  const tolerance = allocationTolerance(sourceOutput.rate);
  if (diff > tolerance) addUnallocatedRow(ctx, diff, '使用量の合計が親レシピの対象生産量に届いていません。', 'Usage rows do not add up to the source output rate.');
  else if (diff < -tolerance) addOverallocatedRow(ctx, Math.abs(diff));

  const rowsBeforeSort = [...rowMap.values()].map((row) => ({
    ...row,
    usagePercent: sourceOutput.rate > EPS ? row.usageRate / sourceOutput.rate * 100 : 0,
  }));
  const rows = sortDetailRows(rowsBeforeSort, detailSort, lang);
  const allocatedUsageRate = rows.reduce((sum, row) => sum + (row.kind === 'overallocated' ? 0 : row.usageRate), 0);
  const unallocatedUsageRate = rows.filter((row) => row.kind === 'unallocated').reduce((sum, row) => sum + row.usageRate, 0);
  const overallocatedUsageRate = rows.filter((row) => row.kind === 'overallocated').reduce((sum, row) => sum + row.usageRate, 0);
  const summary: TableAllocationSummary = {
    sourceRecipeId,
    sourceItemId: sourceOutput.itemId,
    sourceOutputRate: sourceOutput.rate,
    allocatedUsageRate,
    terminalUsageRate,
    unallocatedUsageRate,
    overallocatedUsageRate,
    difference: sourceOutput.rate - allocatedUsageRate,
    allocationBalanced: unallocatedUsageRate <= tolerance && overallocatedUsageRate <= tolerance && Math.abs(sourceOutput.rate - allocatedUsageRate) <= tolerance,
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

  const mainRows = sortMainRows(
    Object.values(result.recipeStats).map(mainRowFromRecipeStat),
    tablePreferences.machineSort,
    lang,
  );
  const detailGroupsByRecipeId: Record<string, MachineDetailGroup[]> = {};
  const allocationSummariesByRecipeId: Record<string, TableAllocationSummary[]> = {};
  const expansionTraceByRecipeId: Record<string, TableExpansionTraceEntry[]> = {};
  const issues: TableViewIssue[] = [];

  for (const row of mainRows) {
    const groups: MachineDetailGroup[] = [];
    const summaries: TableAllocationSummary[] = [];
    const traces: TableExpansionTraceEntry[] = [];
    for (const output of row.productionOutputs) {
      const { group, trace } = buildDetailGroup(result, outgoingByRecipe, row.recipeId, output, tablePreferences.machineDetailSort, lang, issues);
      if (group.rows.length > 0) groups.push(group);
      summaries.push(group.allocationSummary);
      traces.push(...trace);
    }
    if (groups.length > 0) detailGroupsByRecipeId[row.recipeId] = groups;
    if (summaries.length > 0) allocationSummariesByRecipeId[row.recipeId] = summaries;
    if (traces.length > 0) expansionTraceByRecipeId[row.recipeId] = traces;
  }

  return {
    schemaVersion: TABLE_VIEW_SCHEMA_VERSION,
    usageMethod: 'direct-flow-and-proportional-downstream-attribution',
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
    issues,
  };
}

export function displayName(value: { itemNameJa?: string; itemNameEn?: string; recipeNameJa?: string; recipeNameEn?: string; machineNameJa?: string; machineNameEn?: string; labelJa?: string; labelEn?: string }, lang: Lang): string {
  if (lang === 'ja') return value.itemNameJa ?? value.recipeNameJa ?? value.machineNameJa ?? value.labelJa ?? '';
  return value.itemNameEn ?? value.recipeNameEn ?? value.machineNameEn ?? value.labelEn ?? '';
}
