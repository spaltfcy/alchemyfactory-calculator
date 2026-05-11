import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { AppSettings, Lang } from '../types';
import type { CalculatedEndpoint, CalculatedFlow, CalculationResult, CalculatedFlowRole, InitialInvestmentEndpoint, InitialInvestmentFlow } from './calculate';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { recipeById } from '../data/recipes';
import { text } from '../i18n';
import { formatNumber, formatRate } from '../utils/format';

export type PlannerHandleSide = 'left' | 'right' | 'top' | 'bottom';

export type PlannerHandleData = {
  id: string;
  topPct: number;
  color: string;
  side?: PlannerHandleSide;
};

export type PlannerNodeData = {
  label: string;
  kind: 'item' | 'recipe' | 'surplus' | 'discard' | 'final';
  subLabel?: string;
  completed?: boolean;
  tooltip?: string;
  sourceHandles?: PlannerHandleData[];
  targetHandles?: PlannerHandleData[];
  badges?: Array<{ text: string; kind: 'heat' | 'info' | 'warning' }>;
  isInitialInvestment?: boolean;
  hasStartupWarning?: boolean;
  isFuelSource?: boolean;
  focused?: boolean;
};

const OUTPUT_COLORS = [
  '#ff6b6b', // red
  '#1c7ed6', // dark blue
  '#d633ff', // magenta
  '#f8f9fa', // white
  '#845ef7', // purple
  '#b08968', // brown
] as const
const DEFAULT_OUTPUT_COLOR = '#ff6b6b';
const FINAL_FLOW_COLOR = '#9fe870';
const DISCARD_FLOW_COLOR = '#ffd43b'; const SURPLUS_FLOW_COLOR = '#ffd43b';
const FUEL_FLOW_COLOR = '#ff9f43';
const FERTILIZER_FLOW_COLOR = '#a9e34b';
const STEAM_FLOW_COLOR = '#74c0fc';
const INITIAL_INVESTMENT_FLOW_COLOR = '#9aa4b2';
const PIPELINE_FLOW_COLOR = '#74c0fc';

function itemName(itemId: string, lang: Lang): string {
  if (itemId === 'steam') return lang === 'ja' ? '蒸気' : 'Steam';
  const item = itemById[itemId];
  return item ? text(item.name, lang) : itemId;
}

function machineName(machineId: string, lang: Lang): string {
  const machine = machineById[machineId];
  return machine ? text(machine.name, lang) : machineId;
}

function recipeName(recipeId: string, lang: Lang): string {
  const steamLabels: Record<string, { ja: string; en: string }> = {
    steam_boiler_low: { ja: '蒸気ボイラー（低）', en: 'Steam Boiler (Low)' },
    steam_boiler_medium: { ja: '蒸気ボイラー（中）', en: 'Steam Boiler (Medium)' },
    steam_boiler_high: { ja: '蒸気ボイラー（高）', en: 'Steam Boiler (High)' },
  };
  const steamLabel = steamLabels[recipeId];
  if (steamLabel) return text(steamLabel, lang);
  const recipe = recipeById[recipeId];
  return recipe ? text(recipe.name, lang) : recipeId;
}

function beltLabel(belts: number, lang: Lang): string {
  return (lang === 'ja' ? '⚙ ' : '⚙ ') + formatNumber(belts, 0) + (lang === 'ja' ? '本' : '');
}

function transportLabel(
  flow: Pick<CalculatedFlow, 'belts'> & Partial<Pick<CalculatedFlow, 'transportKind' | 'transportUnits'>>,
  lang: Lang,
): string {
  if (flow.transportKind === 'pipeline') return lang === 'ja' ? 'パイプライン 1本' : 'pipeline x1';
  return beltLabel(flow.transportUnits ?? flow.belts, lang);
}

function rateLabel(
  flow: Pick<CalculatedFlow, 'rate' | 'belts'> & Partial<Pick<CalculatedFlow, 'transportKind' | 'transportUnits'>>,
  lang: Lang,
): string {
  return formatRate(flow.rate) + '/min ・ ' + transportLabel(flow, lang);
}

function marker(color: string) {
  return { type: MarkerType.ArrowClosed, color };
}

function edgeStyle(color: string, dashed = false) {
  return { stroke: color, strokeWidth: 2.15, ...(dashed ? { strokeDasharray: '6 4' } : {}) };
}

function endpointNodeId(endpoint: CalculatedEndpoint): string {
  if (endpoint.type === 'recipe') return 'recipe:' + endpoint.recipeId;
  if (endpoint.type === 'itemSource') return 'source:' + endpoint.sourceMode + ':' + endpoint.itemId;
  return 'sink:' + endpoint.sinkMode + ':' + endpoint.itemId;
}

function roleColor(role: CalculatedFlowRole, fallback: string): string {
  if (role === 'fuel') return FUEL_FLOW_COLOR;
  if (role === 'fertilizer') return FERTILIZER_FLOW_COLOR;
  if (role === 'steam') return STEAM_FLOW_COLOR;
  if (role === 'discard') return DISCARD_FLOW_COLOR;
  if (role === 'surplus') return SURPLUS_FLOW_COLOR;
  if (role === 'finalOutput') return FINAL_FLOW_COLOR;
  return fallback;
}

function sourceSide(role: CalculatedFlowRole): PlannerHandleSide {
  void role;
  return 'right';
}

function targetSide(role: CalculatedFlowRole): PlannerHandleSide {
  if (role === 'fuel' || role === 'steam') return 'top';
  if (role === 'fertilizer') return 'bottom';
  return 'left';
}

function makeEdge(flow: CalculatedFlow, color: string, lang: Lang): Edge {
  const isSelfLoop = flow.from.type === 'recipe' && flow.to.type === 'recipe' && flow.from.recipeId === flow.to.recipeId;
  const edgeColor = isSelfLoop ? INITIAL_INVESTMENT_FLOW_COLOR : color;
  const labelName = flow.role === 'fuel'
    ? itemName(flow.itemId, lang) + (lang === 'ja' ? '（燃料）' : ' (fuel)')
    : flow.role === 'fertilizer'
      ? itemName(flow.itemId, lang) + (lang === 'ja' ? '（肥料）' : ' (fertilizer)')
      : itemName(flow.itemId, lang);
  return {
    id: flow.id,
    type: 'flowEdge',
    source: endpointNodeId(flow.from),
    target: endpointNodeId(flow.to),
    animated: false,
    style: edgeStyle(edgeColor, flow.role === 'byproductReuse'),
    markerEnd: marker(edgeColor),
    data: {
      itemId: flow.itemId,
      itemName: labelName,
      rateLabel: flow.role === 'steam' ? formatRate(flow.rate) + '/min' : rateLabel(flow, lang),
      color: edgeColor,
      cycleSide: isSelfLoop ? 1 : 0,
      labelShiftY: isSelfLoop ? -42 : 0,
      outputOrder: 9999,
      sourceSide: isSelfLoop ? 'right' : sourceSide(flow.role),
      targetSide: isSelfLoop ? 'left' : targetSide(flow.role),
      isSelfLoop,
      role: flow.role,
    },
  };
}


function initialEndpointNodeId(groupId: string, endpoint: InitialInvestmentEndpoint): string {
  if (endpoint.type === 'recipe') return 'initial:' + groupId + ':recipe:' + endpoint.recipeId;
  if (endpoint.type === 'itemSource') return 'initial:' + groupId + ':source:' + endpoint.sourceMode + ':' + endpoint.itemId;
  return 'initial:' + groupId + ':sink:' + endpoint.sinkMode + ':' + endpoint.itemId;
}

function endpointLabel(endpoint: InitialInvestmentEndpoint, lang: Lang): { label: string; kind: PlannerNodeData['kind']; subLabel?: string } {
  if (endpoint.type === 'recipe') {
    const recipe = recipeById[endpoint.recipeId];
    return {
      label: recipeName(endpoint.recipeId, lang),
      kind: 'recipe',
      subLabel: machineName(recipe?.machineId ?? '', lang),
    };
  }
  if (endpoint.type === 'itemSource') {
    return {
      label: itemName(endpoint.itemId, lang),
      kind: 'item',
      subLabel: (lang === 'ja' ? '初期投資用 ' : 'Startup ') + (endpoint.sourceMode === 'cycleInput' ? (lang === 'ja' ? '循環補填' : 'Cycle input') : endpoint.sourceMode === 'buy' ? (lang === 'ja' ? '購入' : 'Buy') : (lang === 'ja' ? '未解決' : 'Unresolved')),
    };
  }
  return {
    label: (lang === 'ja' ? '初期投資: ' : 'Startup: ') + itemName(endpoint.itemId, lang),
    kind: 'final',
    subLabel: undefined,
  };
}

function buildInitialEndpointNode(groupId: string, endpoint: InitialInvestmentEndpoint, lang: Lang): Node {
  const labeled = endpointLabel(endpoint, lang);
  return {
    id: initialEndpointNodeId(groupId, endpoint),
    type: 'plannerNode',
    position: { x: 0, y: 0 },
    data: {
      label: labeled.label,
      kind: labeled.kind,
      subLabel: labeled.subLabel,
      isInitialInvestment: true,
      badges: [{ text: lang === 'ja' ? '初期投資' : 'Startup', kind: 'info' }],
    } satisfies PlannerNodeData,
  };
}

function initialInvestmentEdgeLabel(flow: InitialInvestmentFlow, lang: Lang): string {
  if (flow.from.type === 'itemSource' && flow.from.sourceMode === 'cycleInput') {
    return lang === 'ja' ? '初期投入 ' + formatNumber(flow.rate, 2) + '個' : 'Startup input x' + formatNumber(flow.rate, 2);
  }
  return rateLabel(flow, lang);
}

function initialInvestmentEdgeRole(flow: InitialInvestmentFlow): string {
  return flow.from.type === 'itemSource' && flow.from.sourceMode === 'cycleInput' ? 'cycleInput' : 'initialInvestment';
}

function makeInitialEdge(groupId: string, flow: InitialInvestmentFlow, lang: Lang): Edge {
  const startup = flow.from.type === 'itemSource' && flow.from.sourceMode === 'cycleInput';
  return {
    id: flow.id,
    type: 'flowEdge',
    source: initialEndpointNodeId(groupId, flow.from),
    target: initialEndpointNodeId(groupId, flow.to),
    animated: false,
    style: { stroke: INITIAL_INVESTMENT_FLOW_COLOR, strokeWidth: 2.05, strokeDasharray: startup ? '2 4' : '4 4' },
    markerEnd: marker(INITIAL_INVESTMENT_FLOW_COLOR),
    data: {
      itemId: flow.itemId,
      itemName: startup ? itemName(flow.itemId, lang) + (lang === 'ja' ? '（初期投入）' : ' (startup)') : itemName(flow.itemId, lang),
      rateLabel: initialInvestmentEdgeLabel(flow, lang),
      color: INITIAL_INVESTMENT_FLOW_COLOR,
      cycleSide: 0,
      labelShiftY: 0,
      outputOrder: 9999,
      sourceSide: 'right' as PlannerHandleSide,
      targetSide: 'left' as PlannerHandleSide,
      role: initialInvestmentEdgeRole(flow),
    },
  };
}
function addNode(nodes: Map<string, Node>, node: Node): void {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function nodeSubtitle(lines: string[]): string {
  return lines.filter(Boolean).join('\n');
}

function buildEndpointNode(endpoint: CalculatedEndpoint, result: CalculationResult, lang: Lang): Node {
  const id = endpointNodeId(endpoint);
  if (endpoint.type === 'recipe') {
    const rs = result.recipeStats[endpoint.recipeId];
    const recipe = recipeById[endpoint.recipeId];
    const lines = [
      machineName(rs?.machineId ?? recipe?.machineId ?? '', lang),
      rs ? formatNumber(rs.theoreticalMachines) + ' → ' + formatNumber(rs.actualMachines) + ' ' + (lang === 'ja' ? '台' : 'machines') : '',
    ];
    const hasHeat = result.flows.some((flow) => flow.to.type === 'recipe' && flow.to.recipeId === endpoint.recipeId && flow.role === 'fuel');
    const isFuelSource = result.flows.some((flow) => flow.from.type === 'recipe' && flow.from.recipeId === endpoint.recipeId && flow.role === 'fuel');
    const requiredStartupItemIds = result.initialInvestment?.requiredByRecipe?.[endpoint.recipeId] ?? [];
    const badges: PlannerNodeData['badges'] = [];
    if (hasHeat) badges.push({ text: lang === 'ja' ? '要:熱源' : 'Heat', kind: 'heat' });
    for (const itemId of requiredStartupItemIds) badges.push({ text: (lang === 'ja' ? '⚠ 要:' : '⚠ Need:') + itemName(itemId, lang), kind: 'warning' });
    return {
      id,
      type: 'plannerNode',
      position: { x: 0, y: 0 },
      data: {
        label: recipeName(endpoint.recipeId, lang),
        kind: 'recipe',
        subLabel: nodeSubtitle(lines),
        badges: badges.length ? badges : undefined,
        hasStartupWarning: requiredStartupItemIds.length > 0,
        isFuelSource,
      } satisfies PlannerNodeData,
    };
  }
  if (endpoint.type === 'itemSource') {
    const endpointId = endpointNodeId(endpoint);
    const flowRate = result.flows
      .filter((flow) => endpointNodeId(flow.from) === endpointId)
      .reduce((sum, flow) => sum + flow.rate, 0);
    const rate = endpoint.sourceMode === 'unresolved' ? 0 : flowRate;
    const label = itemName(endpoint.itemId, lang);
    const modeLabel = endpoint.sourceMode === 'external'
      ? (lang === 'ja' ? '外部生産' : 'External')
      : endpoint.sourceMode === 'cycleInput'
        ? (lang === 'ja' ? '循環補填' : 'Cycle input')
        : endpoint.sourceMode === 'buy'
          ? (lang === 'ja' ? '購入' : 'Buy')
          : (lang === 'ja' ? '未解決' : 'Unresolved');
    return {
      id,
      type: 'plannerNode',
      position: { x: 0, y: 0 },
      data: {
        label,
        kind: 'item',
        subLabel: modeLabel + (rate > 0 ? ' ' + formatRate(rate) + '/min' : ''),
      } satisfies PlannerNodeData,
    };
  }
  const stat = result.itemStats[endpoint.itemId];
  const labelBase = itemName(endpoint.itemId, lang);
  if (endpoint.sinkMode === 'final') {
    return {
      id,
      type: 'plannerNode',
      position: { x: 0, y: 0 },
      data: {
        label: labelBase,
        kind: 'final',
        subLabel: formatRate(stat?.targetRequested ?? 0) + ' → ' + formatRate(stat?.targetActual ?? 0) + '/min',
      } satisfies PlannerNodeData,
    };
  }
  const discard = endpoint.sinkMode === 'discard';
  return {
    id,
    type: 'plannerNode',
    position: { x: 0, y: 0 },
    data: {
      label: labelBase + (discard ? (lang === 'ja' ? '（破棄）' : ' (discard)') : (lang === 'ja' ? '（余剰）' : ' (surplus)')),
      kind: discard ? 'discard' : 'surplus',
      subLabel: (discard ? (lang === 'ja' ? '破棄 ' : 'Discard ') : (lang === 'ja' ? '余剰 ' : 'Surplus ')) + formatRate(discard ? (stat?.discarded ?? 0) : (stat?.surplus ?? 0)) + '/min',
    } satisfies PlannerNodeData,
  };
}

function assignNormalColors(flows: CalculatedFlow[]): Map<string, string> {
  const colorByFlowId = new Map<string, string>();
  const normalFlows = flows.filter((flow) => {
    if (flow.role === 'fuel') return false;
    if (flow.role === 'fertilizer') return false;
    if (flow.role === 'steam') return false;
    if (flow.role === 'discard') return false;
    if (flow.role === 'surplus') return false;
    if (flow.role === 'finalOutput') return false;
    if (flow.transportKind === 'pipeline') return false;
    return true;
  });

  for (const flow of flows) {
    if (normalFlows.includes(flow)) continue;
    colorByFlowId.set(flow.id, flow.transportKind === 'pipeline' ? PIPELINE_FLOW_COLOR : roleColor(flow.role, DEFAULT_OUTPUT_COLOR));
  }

  for (const flow of normalFlows) {
    if (!colorByFlowId.has(flow.id)) colorByFlowId.set(flow.id, DEFAULT_OUTPUT_COLOR);
  }

  const incomingColorsFor = (nodeId: string, ignoreFlowId?: string): Set<string> => {
    const set = new Set<string>();
    for (const flow of flows) {
      if (ignoreFlowId && flow.id === ignoreFlowId) continue;
      if (endpointNodeId(flow.to) !== nodeId) continue;
      const color = colorByFlowId.get(flow.id);
      if (color) set.add(color);
    }
    return set;
  };

  const chooseNormalColor = (forbidden: Set<string>): string => {
    if (forbidden.size === 0) return DEFAULT_OUTPUT_COLOR;
    return OUTPUT_COLORS.find((candidate) => !forbidden.has(candidate)) ?? DEFAULT_OUTPUT_COLOR;
  };

  const maxIterations = Math.max(12, normalFlows.length * 4);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let changed = false;
    for (const flow of normalFlows) {
      const sourceNodeId = endpointNodeId(flow.from);
      const forbidden = incomingColorsFor(sourceNodeId, flow.id);
      const nextColor = chooseNormalColor(forbidden);
      if (colorByFlowId.get(flow.id) !== nextColor) {
        colorByFlowId.set(flow.id, nextColor);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return colorByFlowId;
}

function decorateHandles(nodes: Node[], edges: Edge[]): void {
  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();
  for (const edge of edges) {
    const inc = incoming.get(edge.target) ?? [];
    inc.push(edge);
    incoming.set(edge.target, inc);
    const out = outgoing.get(edge.source) ?? [];
    out.push(edge);
    outgoing.set(edge.source, out);
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const sideOrder: PlannerHandleSide[] = ['top', 'left', 'right', 'bottom'];
  function sideOf(edge: Edge, key: 'sourceSide' | 'targetSide', fallback: PlannerHandleSide): PlannerHandleSide {
    const data = edge.data as { sourceSide?: PlannerHandleSide; targetSide?: PlannerHandleSide } | undefined;
    return data?.[key] ?? fallback;
  }
  for (const node of nodes) {
    const data = { ...(node.data as PlannerNodeData) };
    const sourceHandles: PlannerHandleData[] = [];
    const targetHandles: PlannerHandleData[] = [];
    for (const side of sideOrder) {
      const list = (outgoing.get(node.id) ?? []).filter((edge) => sideOf(edge, 'sourceSide', 'right') === side);
      list.forEach((edge, index) => {
        const id = side === 'right' ? 's' + sourceHandles.length : 's-' + side + '-' + index;
        edge.sourceHandle = id;
        const edgeData = edge.data as { color?: string } | undefined;
        sourceHandles.push({ id, topPct: ((index + 1) / (list.length + 1)) * 100, color: edgeData?.color ?? DEFAULT_OUTPUT_COLOR, side });
      });
    }
    for (const side of sideOrder) {
      const list = (incoming.get(node.id) ?? []).filter((edge) => sideOf(edge, 'targetSide', 'left') === side);
      list.forEach((edge, index) => {
        const id = side === 'left' ? 't' + targetHandles.length : 't-' + side + '-' + index;
        edge.targetHandle = id;
        const edgeData = edge.data as { color?: string } | undefined;
        targetHandles.push({ id, topPct: ((index + 1) / (list.length + 1)) * 100, color: edgeData?.color ?? DEFAULT_OUTPUT_COLOR, side });
      });
    }
    data.sourceHandles = sourceHandles;
    data.targetHandles = targetHandles;
    node.data = data;
  }
  for (const group of new Map<string, Edge[]>() as Map<string, Edge[]>) {
    void group;
  }
  const pairGroups = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key = edge.source + '->' + edge.target;
    const list = pairGroups.get(key) ?? [];
    list.push(edge);
    pairGroups.set(key, list);
  }
  for (const group of pairGroups.values()) {
    if (group.length <= 1) continue;
    group.forEach((edge, index) => {
      edge.data = { ...(edge.data ?? {}), labelShiftY: (index - (group.length - 1) / 2) * 34 };
    });
  }
  for (const edge of edges) {
    if (nodeById.has(edge.source) && nodeById.has(edge.target)) continue;
  }
}

export function buildFlowGraph(
  result: CalculationResult,
  lang: Lang,
  settings: AppSettings,
  completedGraphNodeIds: Record<string, boolean>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes = new Map<string, Node>();
  const flows = (result.flows ?? []).filter((flow) => {
    if (flow.rate <= 0) return false;
    if (!settings.showSurplus && (flow.role === 'surplus' || flow.role === 'discard')) return false;
    if (!settings.showDiscardedByproducts && flow.role === 'discard') return false;
    return true;
  });

  for (const flow of flows) {
    addNode(nodes, buildEndpointNode(flow.from, result, lang));
    addNode(nodes, buildEndpointNode(flow.to, result, lang));
  }
  for (const rs of Object.values(result.recipeStats)) {
    if (rs.runsPerMinute <= 0) continue;
    addNode(nodes, buildEndpointNode({ type: 'recipe', recipeId: rs.recipeId }, result, lang));
  }

  const colorByFlowId = assignNormalColors(flows);
  const edges = flows.map((flow) => makeEdge(flow, colorByFlowId.get(flow.id) ?? DEFAULT_OUTPUT_COLOR, lang));

  if (settings.showInitialInvestmentLines !== false) {
    for (const group of result.initialInvestment?.groups ?? []) {
      for (const flow of group.flows) {
        addNode(nodes, buildInitialEndpointNode(group.id, flow.from, lang));
        addNode(nodes, buildInitialEndpointNode(group.id, flow.to, lang));
        edges.push(makeInitialEdge(group.id, flow, lang));
      }
      for (const rs of Object.values(group.recipeStats)) {
        addNode(nodes, buildInitialEndpointNode(group.id, { type: 'recipe', recipeId: rs.recipeId }, lang));
      }
    }
  }

  const nodeList = [...nodes.values()].map((node) => ({
    ...node,
    data: {
      ...(node.data as PlannerNodeData),
      completed: completedGraphNodeIds[node.id] ?? false,
    },
  }));
  decorateHandles(nodeList, edges);
  return { nodes: nodeList, edges };
}


type SvgGraphNode = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  data: PlannerNodeData;
};

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function splitNodeText(value?: string): string[] {
  return (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function estimateSvgTextWidth(value: string, fontSize: number, bold = false): number {
  const text = value.trim();
  if (!text) return 0;
  let width = 0;
  for (const char of text) {
    width += char.charCodeAt(0) <= 0xff ? fontSize * 0.56 : fontSize * 0.95;
  }
  if (bold) width += text.length * 0.3;
  return width;
}

function nodeKindRank(kind: PlannerNodeData['kind']): number {
  if (kind === 'item') return 0;
  if (kind === 'recipe') return 1;
  if (kind === 'final') return 2;
  if (kind === 'surplus') return 3;
  return 4;
}

function nodeTheme(kind: PlannerNodeData['kind'], completed?: boolean, data: PlannerNodeData = { label: '', kind }): {
  fill: string;
  stroke: string;
  title: string;
  sub: string;
} {
  const theme =
    kind === 'recipe'
      ? { fill: '#2a1f12', stroke: '#c77dff', title: '#f8f0ff', sub: '#dccff5' }
      : kind === 'final'
        ? { fill: '#153323', stroke: '#9fe870', title: '#ecfce5', sub: '#c4f1b4' }
        : kind === 'surplus'
          ? { fill: '#3c310d', stroke: '#ffd43b', title: '#fff8db', sub: '#ffe8a3' }
          : kind === 'discard'
            ? { fill: '#3a1d1d', stroke: '#ff8787', title: '#fff5f5', sub: '#ffc9c9' }
            : { fill: '#182233', stroke: '#4dabf7', title: '#eef6ff', sub: '#d0e4ff' };
  if (data.isInitialInvestment) return { fill: '#20242b', stroke: '#9aa4b2', title: '#edf2f7', sub: '#c7ced8' };
  if (!completed) return theme;
  return { ...theme, stroke: '#63e6be' };
}

function measureSvgNode(node: Node): { width: number; height: number } {
  const data = node.data as PlannerNodeData;
  const subLines = splitNodeText(data.subLabel);
  const badgeWidths = (data.badges ?? []).map((badge) => estimateSvgTextWidth(badge.text, 11, true) + 22);
  const titleWidth = estimateSvgTextWidth(data.label, 15, true) + 28;
  const subWidth = subLines.reduce((max, line) => Math.max(max, estimateSvgTextWidth(line, 12) + 24), 0);
  const stackedBadgeWidth = badgeWidths.length ? Math.max(...badgeWidths) + 18 : 0;
  let width = Math.max(180, Math.ceil(Math.max(titleWidth + stackedBadgeWidth, subWidth)));
  if (data.kind === 'recipe') width = Math.max(width, 228);
  if (data.kind === 'final') width = Math.max(width, 210);
  if (data.hasStartupWarning) width = Math.ceil(width * 1.2);
  const stackedBadgeExtraHeight = Math.max(0, ((data.badges?.length ?? 0) - 1) * 20);
  const height = 48 + subLines.length * 16 + stackedBadgeExtraHeight;
  return { width, height: Math.max(56, height) };
}

function initialNodeLayer(node: Node): number {
  if (node.id.startsWith('initial:')) return 0;
  if (node.id.startsWith('source:')) return 0;
  const data = node.data as PlannerNodeData;
  if (data.kind === 'recipe') return 1;
  if (data.kind === 'item') return 1;
  return 2;
}

function isLayerProgressEdge(edge: Edge): boolean {
  const data = edge.data as { sourceSide?: PlannerHandleSide; targetSide?: PlannerHandleSide } | undefined;
  const style = edge.style as { strokeDasharray?: string } | undefined;
  if (data?.targetSide === 'top' || data?.targetSide === 'bottom') return false;
  if (data?.sourceSide === 'bottom') return false;
  if (style?.strokeDasharray) return false;
  return true;
}

function layoutSvgNodes(nodes: Node[], edges: Edge[]): { nodes: SvgGraphNode[]; width: number; height: number; nodeById: Map<string, SvgGraphNode> } {
  if (nodes.length === 0) {
    return { nodes: [], width: 960, height: 240, nodeById: new Map() };
  }

  const layerById = new Map<string, number>();
  for (const node of nodes) layerById.set(node.id, initialNodeLayer(node));

  const eligibleEdges = edges.filter(isLayerProgressEdge);
  const maxPasses = Math.max(8, nodes.length * 3);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const edge of eligibleEdges) {
      const sourceLayer = layerById.get(edge.source) ?? 0;
      const targetLayer = layerById.get(edge.target) ?? 0;
      const nextLayer = sourceLayer + 1;
      if (nextLayer > targetLayer) {
        layerById.set(edge.target, nextLayer);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const measureById = new Map<string, { width: number; height: number }>();
  for (const node of nodes) measureById.set(node.id, measureSvgNode(node));

  const groups = new Map<number, Node[]>();
  for (const node of nodes) {
    const layer = layerById.get(node.id) ?? 0;
    const list = groups.get(layer) ?? [];
    list.push(node);
    groups.set(layer, list);
  }

  const sortedLayers = [...groups.keys()].sort((a, b) => a - b);
  const verticalGap = 28;
  const horizontalGap = 170;
  const leftPad = 40;
  const topPad = 40;

  const layerWidth = new Map<number, number>();
  const layerHeight = new Map<number, number>();
  for (const layer of sortedLayers) {
    const layerNodes = groups.get(layer) ?? [];
    layerNodes.sort((a, b) => {
      const dataA = a.data as PlannerNodeData;
      const dataB = b.data as PlannerNodeData;
      return nodeKindRank(dataA.kind) - nodeKindRank(dataB.kind) || dataA.label.localeCompare(dataB.label);
    });
    let maxWidth = 0;
    let totalHeight = 0;
    layerNodes.forEach((node, index) => {
      const size = measureById.get(node.id)!;
      maxWidth = Math.max(maxWidth, size.width);
      totalHeight += size.height;
      if (index > 0) totalHeight += verticalGap;
    });
    layerWidth.set(layer, maxWidth);
    layerHeight.set(layer, totalHeight);
  }

  const canvasHeight = Math.max(240, ...sortedLayers.map((layer) => (layerHeight.get(layer) ?? 0) + topPad * 2));
  const positioned: SvgGraphNode[] = [];
  const nodeById = new Map<string, SvgGraphNode>();

  let currentX = leftPad;
  for (const layer of sortedLayers) {
    const layerNodes = groups.get(layer) ?? [];
    const maxWidth = layerWidth.get(layer) ?? 220;
    const usedHeight = layerHeight.get(layer) ?? 0;
    let currentY = Math.max(topPad, Math.round((canvasHeight - usedHeight) / 2));
    for (const node of layerNodes) {
      const size = measureById.get(node.id)!;
      const x = currentX + Math.max(0, (maxWidth - size.width) / 2);
      const placed: SvgGraphNode = {
        id: node.id,
        x,
        y: currentY,
        width: size.width,
        height: size.height,
        layer,
        data: node.data as PlannerNodeData,
      };
      positioned.push(placed);
      nodeById.set(node.id, placed);
      currentY += size.height + verticalGap;
    }
    currentX += maxWidth + horizontalGap;
  }

  const canvasWidth = Math.max(900, currentX - horizontalGap + leftPad);
  return { nodes: positioned, width: canvasWidth, height: canvasHeight, nodeById };
}

function debugEdgeRole(edge: Edge): string | undefined {
  const data = edge.data as { role?: string } | undefined;
  return data?.role;
}

function debugNodeLane(node: Node, edges: Edge[]): number {
  const data = node.data as PlannerNodeData;
  if (node.id.startsWith('initial:') || data.isInitialInvestment) return -2;
  if (data.kind === 'surplus' || data.kind === 'discard') return 2;
  const relatedRoles = edges
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => debugEdgeRole(edge));
  const isSourceLike = node.id.startsWith('source:') || data.kind === 'item';
  if (isSourceLike && relatedRoles.some((role) => role === 'fuel' || role === 'steam')) return -1;
  if (isSourceLike && relatedRoles.some((role) => role === 'fertilizer')) return 1;
  return 0;
}

function layoutSvgNodesDebugLane(nodes: Node[], edges: Edge[]): { nodes: SvgGraphNode[]; width: number; height: number; nodeById: Map<string, SvgGraphNode> } {
  if (nodes.length === 0) return { nodes: [], width: 960, height: 240, nodeById: new Map() };

  const base = layoutSvgNodes(nodes, edges);
  const baseLayerById = new Map(base.nodes.map((node) => [node.id, node.layer]));
  const maxBaseLayer = Math.max(0, ...base.nodes.map((node) => node.layer));
  const measureById = new Map<string, { width: number; height: number }>();
  for (const node of nodes) measureById.set(node.id, measureSvgNode(node));

  const laneGroups = new Map<number, Node[]>();
  for (const node of nodes) {
    const lane = debugNodeLane(node, edges);
    const list = laneGroups.get(lane) ?? [];
    list.push(node);
    laneGroups.set(lane, list);
  }

  const laneOrder = [...laneGroups.keys()].sort((a, b) => a - b);
  const leftPad = 44;
  const topPad = 44;
  const horizontalGap = 190;
  const verticalGap = 26;
  const laneGap = 74;
  const maxLayer = Math.max(maxBaseLayer + 1, ...nodes.map((node) => {
    const data = node.data as PlannerNodeData;
    if (data.kind === 'final' || data.kind === 'surplus' || data.kind === 'discard') return maxBaseLayer + 1;
    return baseLayerById.get(node.id) ?? initialNodeLayer(node);
  }));

  const layerWidth = new Map<number, number>();
  for (const node of nodes) {
    const data = node.data as PlannerNodeData;
    const layer = (data.kind === 'final' || data.kind === 'surplus' || data.kind === 'discard')
      ? maxBaseLayer + 1
      : (baseLayerById.get(node.id) ?? initialNodeLayer(node));
    const size = measureById.get(node.id)!;
    layerWidth.set(layer, Math.max(layerWidth.get(layer) ?? 220, size.width));
  }

  const xByLayer = new Map<number, number>();
  let currentX = leftPad;
  for (let layer = 0; layer <= maxLayer; layer += 1) {
    xByLayer.set(layer, currentX);
    currentX += (layerWidth.get(layer) ?? 220) + horizontalGap;
  }

  const positioned: SvgGraphNode[] = [];
  const nodeById = new Map<string, SvgGraphNode>();
  let currentLaneY = topPad;

  for (const lane of laneOrder) {
    const laneNodes = laneGroups.get(lane) ?? [];
    laneNodes.sort((a, b) => {
      const dataA = a.data as PlannerNodeData;
      const dataB = b.data as PlannerNodeData;
      const layerA = dataA.kind === 'final' || dataA.kind === 'surplus' || dataA.kind === 'discard' ? maxBaseLayer + 1 : (baseLayerById.get(a.id) ?? initialNodeLayer(a));
      const layerB = dataB.kind === 'final' || dataB.kind === 'surplus' || dataB.kind === 'discard' ? maxBaseLayer + 1 : (baseLayerById.get(b.id) ?? initialNodeLayer(b));
      return layerA - layerB || nodeKindRank(dataA.kind) - nodeKindRank(dataB.kind) || dataA.label.localeCompare(dataB.label);
    });

    let y = currentLaneY;
    let laneHeight = 0;
    for (const node of laneNodes) {
      const data = node.data as PlannerNodeData;
      const layer = data.kind === 'final' || data.kind === 'surplus' || data.kind === 'discard' ? maxBaseLayer + 1 : (baseLayerById.get(node.id) ?? initialNodeLayer(node));
      const size = measureById.get(node.id)!;
      const maxWidth = layerWidth.get(layer) ?? size.width;
      const x = (xByLayer.get(layer) ?? leftPad) + Math.max(0, (maxWidth - size.width) / 2);
      const placed: SvgGraphNode = {
        id: node.id,
        x,
        y,
        width: size.width,
        height: size.height,
        layer,
        data,
      };
      positioned.push(placed);
      nodeById.set(node.id, placed);
      y += size.height + verticalGap;
      laneHeight += size.height + verticalGap;
    }
    currentLaneY += Math.max(80, laneHeight) + laneGap;
  }

  const canvasWidth = Math.max(900, currentX - horizontalGap + leftPad);
  const canvasHeight = Math.max(280, currentLaneY - laneGap + topPad);
  return { nodes: positioned, width: canvasWidth, height: canvasHeight, nodeById };
}


function layoutSvgNodesDebugV2(nodes: Node[], edges: Edge[]): { nodes: SvgGraphNode[]; width: number; height: number; nodeById: Map<string, SvgGraphNode> } {
  const base = layoutSvgNodes(nodes, edges);
  if (base.nodes.length === 0) return base;
  const maxShiftX = 300;
  const maxShiftY = 240;
  const shifted = base.nodes.map((node) => {
    const data = node.data;
    const relatedRoles = edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) => edgeRole(edge));
    let dx = 0;
    let dy = 0;
    if (data.kind === 'final') dx += 160;
    if (data.kind === 'surplus' || data.kind === 'discard') {
      dx += 80;
      dy += 170;
    }
    if (node.id.startsWith('source:') || data.kind === 'item') {
      if (relatedRoles.some((role) => role === 'fuel' || role === 'steam')) dy -= 150;
      if (relatedRoles.some((role) => role === 'fertilizer')) dy += 150;
    }
    if (data.isInitialInvestment) dy -= 180;
    dx = Math.max(-maxShiftX, Math.min(maxShiftX, dx));
    dy = Math.max(-maxShiftY, Math.min(maxShiftY, dy));
    return { ...node, x: node.x + dx, y: node.y + dy };
  });
  const minX = Math.min(...shifted.map((node) => node.x));
  const minY = Math.min(...shifted.map((node) => node.y));
  const normalizeX = minX < 40 ? 40 - minX : 0;
  const normalizeY = minY < 40 ? 40 - minY : 0;
  const normalized = shifted.map((node) => ({ ...node, x: node.x + normalizeX, y: node.y + normalizeY }));
  const nodeById = new Map(normalized.map((node) => [node.id, node]));
  const width = Math.max(900, Math.ceil(Math.max(...normalized.map((node) => node.x + node.width)) + 40));
  const height = Math.max(240, Math.ceil(Math.max(...normalized.map((node) => node.y + node.height)) + 40));
  return { nodes: normalized, width, height, nodeById };
}

function svgHandlePoint(node: SvgGraphNode, handleId: string | null | undefined, kind: 'source' | 'target'): {
  x: number;
  y: number;
  side: PlannerHandleSide;
  color: string;
} {
  const fallbackSide: PlannerHandleSide = kind === 'source' ? 'right' : 'left';
  const handles = kind === 'source' ? (node.data.sourceHandles ?? []) : (node.data.targetHandles ?? []);
  const handle = handles.find((entry) => entry.id === handleId) ?? handles[0] ?? { id: '', topPct: 50, color: DEFAULT_OUTPUT_COLOR, side: fallbackSide };
  const side = handle.side ?? fallbackSide;
  const pct = Math.max(0, Math.min(100, handle.topPct || 50));
  if (side === 'top') {
    return { x: node.x + node.width / 2, y: node.y, side, color: handle.color };
  }
  if (side === 'bottom') {
    return { x: node.x + node.width / 2, y: node.y + node.height, side, color: handle.color };
  }
  if (side === 'right') {
    return { x: node.x + node.width, y: node.y + (node.height * pct) / 100, side, color: handle.color };
  }
  return { x: node.x, y: node.y + (node.height * pct) / 100, side, color: handle.color };
}

function svgControlPoint(x: number, y: number, side: PlannerHandleSide, distanceX: number, distanceY: number): { x: number; y: number } {
  const horizontal = Math.max(42, distanceX * 0.35);
  const vertical = Math.max(42, distanceY * 0.35);
  if (side === 'right') return { x: x + horizontal, y };
  if (side === 'left') return { x: x - horizontal, y };
  if (side === 'top') return { x, y: y - vertical };
  return { x, y: y + vertical };
}

function buildSvgEdgePath(
  source: { x: number; y: number; side: PlannerHandleSide },
  target: { x: number; y: number; side: PlannerHandleSide },
): string {
  const dx = Math.abs(target.x - source.x);
  const dy = Math.abs(target.y - source.y);
  const c1 = svgControlPoint(source.x, source.y, source.side, dx, dy);
  const c2 = svgControlPoint(target.x, target.y, target.side, dx, dy);
  return 'M ' + source.x.toFixed(1) + ' ' + source.y.toFixed(1) + ' C ' + c1.x.toFixed(1) + ' ' + c1.y.toFixed(1) + ', ' + c2.x.toFixed(1) + ' ' + c2.y.toFixed(1) + ', ' + target.x.toFixed(1) + ' ' + target.y.toFixed(1);
}

function buildSvgCyclePath(
  source: { x: number; y: number; side: PlannerHandleSide },
  target: { x: number; y: number; side: PlannerHandleSide },
  side: number,
): { path: string; labelX: number; labelY: number } {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(Math.hypot(dx, dy), 1);
  const nx = -dy / length;
  const ny = dx / length;
  const offset = Math.min(260, Math.max(160, length * 0.36)) * side;
  const controlX = (source.x + target.x) / 2 + nx * offset;
  const controlY = (source.y + target.y) / 2 + ny * offset;
  return {
    path:
      'M ' +
      source.x.toFixed(1) +
      ' ' +
      source.y.toFixed(1) +
      ' Q ' +
      controlX.toFixed(1) +
      ' ' +
      controlY.toFixed(1) +
      ' ' +
      target.x.toFixed(1) +
      ' ' +
      target.y.toFixed(1),
    labelX: source.x * 0.25 + controlX * 0.5 + target.x * 0.25,
    labelY: source.y * 0.25 + controlY * 0.5 + target.y * 0.25,
  };
}

function renderSvgNodeHandles(node: SvgGraphNode, handles: PlannerHandleData[] | undefined, kind: 'source' | 'target'): string {
  const list = handles ?? [];
  return list
    .map((handle) => {
      const point = svgHandlePoint(node, handle.id, kind);
      return '<circle cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="4.2" fill="' + escapeSvgText(handle.color) + '" stroke="#0b0f15" stroke-width="1.2"/>';
    })
    .join('\n');
}

function renderSvgNode(node: SvgGraphNode): string {
  const data = node.data;
  const theme = nodeTheme(data.kind, data.completed, data);
  const subLines = splitNodeText(data.subLabel);
  const titleY = node.y + 22;
  let currentY = node.y + 40;
  const lines: string[] = [];

  lines.push('<g class="node node-' + escapeSvgText(data.kind) + '">');
  lines.push('<rect x="' + node.x.toFixed(1) + '" y="' + node.y.toFixed(1) + '" width="' + node.width.toFixed(1) + '" height="' + node.height.toFixed(1) + '" rx="12" ry="12" fill="' + theme.fill + '" stroke="' + theme.stroke + '" stroke-width="2"/>');
  lines.push('<text x="' + (node.x + 14).toFixed(1) + '" y="' + titleY.toFixed(1) + '" fill="' + theme.title + '" font-size="15" font-family="Segoe UI, Noto Sans JP, sans-serif" font-weight="700">' + escapeSvgText(data.label) + '</text>');

  for (const line of subLines) {
    lines.push('<text x="' + (node.x + 14).toFixed(1) + '" y="' + currentY.toFixed(1) + '" fill="' + theme.sub + '" font-size="12" font-family="Segoe UI, Noto Sans JP, sans-serif">' + escapeSvgText(line) + '</text>');
    currentY += 16;
  }

  if ((data.badges?.length ?? 0) > 0) {
    const badgeRight = node.x + node.width - 10;
    let badgeY = node.y + 8;
    for (const badge of data.badges ?? []) {
      const badgeWidth = Math.max(42, estimateSvgTextWidth(badge.text, 11, true) + 16);
      const badgeX = badgeRight - badgeWidth;
      const fill = badge.kind === 'heat' ? '#4a2a0a' : badge.kind === 'warning' ? '#4a3b0a' : '#14314a';
      const stroke = badge.kind === 'heat' ? '#ff922b' : badge.kind === 'warning' ? '#ffd43b' : '#4dabf7';
      const textFill = badge.kind === 'heat' ? '#ffe8cc' : badge.kind === 'warning' ? '#fff3bf' : '#d0ebff';
      lines.push('<rect x="' + badgeX.toFixed(1) + '" y="' + badgeY.toFixed(1) + '" width="' + badgeWidth.toFixed(1) + '" height="18" rx="9" ry="9" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>');
      lines.push('<text x="' + (badgeX + badgeWidth / 2).toFixed(1) + '" y="' + (badgeY + 12.5).toFixed(1) + '" fill="' + textFill + '" font-size="11" font-family="Segoe UI, Noto Sans JP, sans-serif" font-weight="700" text-anchor="middle">' + escapeSvgText(badge.text) + '</text>');
      badgeY += 20;
    }
  }

  lines.push(renderSvgNodeHandles(node, data.targetHandles, 'target'));
  lines.push(renderSvgNodeHandles(node, data.sourceHandles, 'source'));
  lines.push('</g>');
  return lines.join('\n');
}

function renderSvgEdgeLabel(title: string, detail: string, x: number, y: number, color: string): string {
  const titleWidth = estimateSvgTextWidth(title, 11, true);
  const detailWidth = estimateSvgTextWidth(detail, 10);
  const width = Math.max(88, Math.ceil(Math.max(titleWidth, detailWidth) + 18));
  const height = detail ? 30 : 18;
  const left = x - width / 2;
  const top = y - height / 2;
  const lines = [
    '<g class="edge-label">',
    '<rect x="' + left.toFixed(1) + '" y="' + top.toFixed(1) + '" width="' + width.toFixed(1) + '" height="' + height.toFixed(1) + '" rx="8" ry="8" fill="#0f1622" fill-opacity="0.96" stroke="' + escapeSvgText(color) + '" stroke-width="1.2"/>',
    '<text x="' + x.toFixed(1) + '" y="' + (top + 11.5).toFixed(1) + '" fill="#eef5ff" font-size="11" font-family="Segoe UI, Noto Sans JP, sans-serif" font-weight="700" text-anchor="middle">' + escapeSvgText(title) + '</text>',
  ];
  if (detail) {
    lines.push('<text x="' + x.toFixed(1) + '" y="' + (top + 23.5).toFixed(1) + '" fill="#d0d8e8" font-size="10" font-family="Segoe UI, Noto Sans JP, sans-serif" text-anchor="middle">' + escapeSvgText(detail) + '</text>');
  }
  lines.push('</g>');
  return lines.join('\n');
}

function renderFlowGraphSvgFromGraph(
  graph: { nodes: Node[]; edges: Edge[] },
  layout: ReturnType<typeof layoutSvgNodes>,
  lang: Lang,
): string {
  if (graph.nodes.length === 0) {
    const emptyMessage = lang === 'ja' ? 'グラフデータがありません。' : 'No graph data.';
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="240" viewBox="0 0 960 240">',
      '<rect width="100%" height="100%" fill="#080d15"/>',
      '<text x="480" y="120" fill="#eef5ff" font-size="18" font-family="Segoe UI, Noto Sans JP, sans-serif" text-anchor="middle">' + escapeSvgText(emptyMessage) + '</text>',
      '</svg>',
      '',
    ].join('\n');
  }

  const markerColors = [...new Set(graph.edges.map((edge) => {
    const edgeData = edge.data as { color?: string } | undefined;
    const style = edge.style as { stroke?: string } | undefined;
    return String(edgeData?.color ?? style?.stroke ?? DEFAULT_OUTPUT_COLOR);
  }))];
  const markerIdByColor = new Map<string, string>();
  const defs = markerColors.map((color, index) => {
    const id = 'arrow-' + index;
    markerIdByColor.set(color, id);
    return '<marker id="' + id + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="' + escapeSvgText(color) + '"/></marker>';
  }).join('\n');

  const edgesSvg = graph.edges
    .map((edge) => {
      const sourceNode = layout.nodeById.get(edge.source);
      const targetNode = layout.nodeById.get(edge.target);
      if (!sourceNode || !targetNode) return '';
      const edgeData = edge.data as {
        itemName?: string;
        rateLabel?: string;
        color?: string;
        cycleSide?: number;
        labelShiftY?: number;
      } | undefined;
      const style = edge.style as { stroke?: string; strokeWidth?: number | string; strokeDasharray?: string } | undefined;
      const color = String(edgeData?.color ?? style?.stroke ?? DEFAULT_OUTPUT_COLOR);
      const sourcePoint = svgHandlePoint(sourceNode, edge.sourceHandle, 'source');
      const targetPoint = svgHandlePoint(targetNode, edge.targetHandle, 'target');
      const cycleSide = Number(edgeData?.cycleSide ?? 0);
      const pathData = cycleSide !== 0
        ? buildSvgCyclePath(sourcePoint, targetPoint, cycleSide)
        : {
            path: buildSvgEdgePath(sourcePoint, targetPoint),
            labelX: (sourcePoint.x + targetPoint.x) / 2,
            labelY: (sourcePoint.y + targetPoint.y) / 2,
          };
      const path = pathData.path;
      const midX = pathData.labelX;
      const midY = pathData.labelY + Number(edgeData?.labelShiftY ?? 0);
      const dash = style?.strokeDasharray ? ' stroke-dasharray="' + escapeSvgText(String(style.strokeDasharray)) + '"' : '';
      const strokeWidth = String(style?.strokeWidth ?? 2.15);
      const opacity = edgeData?.itemName?.includes('(fuel)') || edgeData?.itemName?.includes('(fertilizer)') ? '0.78' : '0.97';
      return [
        '<path d="' + path + '" fill="none" stroke="' + escapeSvgText(color) + '" stroke-width="' + escapeSvgText(strokeWidth) + '"' + dash + ' marker-end="url(#' + (markerIdByColor.get(color) ?? 'arrow-0') + ')" opacity="' + opacity + '"/>',
        renderSvgEdgeLabel(edgeData?.itemName ?? '', edgeData?.rateLabel ?? '', midX, midY, color),
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n');

  const nodesSvg = layout.nodes.map((node) => renderSvgNode(node)).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(layout.width) + '" height="' + Math.ceil(layout.height) + '" viewBox="0 0 ' + Math.ceil(layout.width) + ' ' + Math.ceil(layout.height) + '">',
    '<defs>',
    defs,
    '</defs>',
    '<rect width="100%" height="100%" fill="#080d15"/>',
    '<g class="edges">',
    edgesSvg,
    '</g>',
    '<g class="nodes">',
    nodesSvg,
    '</g>',
    '</svg>',
    '',
  ].join('\n');
}

export function buildFlowGraphSvg(
  result: CalculationResult,
  lang: Lang,
  settings: AppSettings,
  completedGraphNodeIds: Record<string, boolean>,
): string {
  const graph = buildFlowGraph(result, lang, settings, completedGraphNodeIds);
  const layout = layoutSvgNodes(graph.nodes, graph.edges);
  return renderFlowGraphSvgFromGraph(graph, layout, lang);
}



export type FlowGraphLayoutMetrics = {
  variant: 'normal' | 'debug';
  nodeCount: number;
  edgeCount: number;
  recipeNodes: number;
  sourceNodes: number;
  finalNodes: number;
  surplusNodes: number;
  discardNodes: number;
  fuelEdges: number;
  fertilizerEdges: number;
  steamEdges: number;
  labelCount: number;
  averageEdgeLength: number;
  maxEdgeLength: number;
  estimatedCrossings: number;
  estimatedCrossingsCapped: boolean;
  graphBuildMs: number;
  layoutMs: number;
  width: number;
  height: number;
  layoutAlgorithm?: string;
  selectedLayout?: string;
  fallbackReason?: string;
  layoutScore?: number;
  normalLayoutScore?: number;
  debugCandidateLayoutScore?: number;
  debugCandidate?: Record<string, unknown>;
};

export type FlowGraphDebugArtifacts = {
  variant: 'normal' | 'debug';
  generatedAt: string;
  svg: string;
  model: {
    variant: 'normal' | 'debug';
    generatedAt: string;
    width: number;
    height: number;
    nodes: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      layer: number;
      kind: PlannerNodeData['kind'];
      label: string;
      subLabel?: string;
      completed?: boolean;
      badges?: PlannerNodeData['badges'];
    }>;
    edges: Array<{
      id: string;
      source: string;
      target: string;
      sourceHandle?: string | null;
      targetHandle?: string | null;
      itemName?: string;
      rateLabel?: string;
      role?: string;
      color?: string;
    }>;
  };
  metrics: FlowGraphLayoutMetrics;
};

function edgeRole(edge: Edge): string | undefined {
  const data = edge.data as { role?: string } | undefined;
  return data?.role;
}

function edgeLine(layout: ReturnType<typeof layoutSvgNodes>, edge: Edge): { x1: number; y1: number; x2: number; y2: number; length: number } | undefined {
  const sourceNode = layout.nodeById.get(edge.source);
  const targetNode = layout.nodeById.get(edge.target);
  if (!sourceNode || !targetNode) return undefined;
  const source = svgHandlePoint(sourceNode, edge.sourceHandle, 'source');
  const target = svgHandlePoint(targetNode, edge.targetHandle, 'target');
  const length = Math.hypot(target.x - source.x, target.y - source.y);
  return { x1: source.x, y1: source.y, x2: target.x, y2: target.y, length };
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const value = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function segmentsCross(a: { x1: number; y1: number; x2: number; y2: number }, b: { x1: number; y1: number; x2: number; y2: number }): boolean {
  const o1 = orientation(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const o2 = orientation(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const o3 = orientation(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const o4 = orientation(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return o1 !== o2 && o3 !== o4;
}

function estimateEdgeCrossings(lines: Array<{ source: string; target: string; x1: number; y1: number; x2: number; y2: number }>): { count: number; capped: boolean } {
  const maxPairs = 200000;
  let checked = 0;
  let count = 0;
  for (let i = 0; i < lines.length; i += 1) {
    for (let j = i + 1; j < lines.length; j += 1) {
      checked += 1;
      if (checked > maxPairs) return { count, capped: true };
      const a = lines[i];
      const b = lines[j];
      if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue;
      if (segmentsCross(a, b)) count += 1;
    }
  }
  return { count, capped: false };
}

function graphMetrics(variant: 'normal' | 'debug', graphBuildMs: number, layoutMs: number, graph: { nodes: Node[]; edges: Edge[] }, layout: ReturnType<typeof layoutSvgNodes>): FlowGraphLayoutMetrics {
  const lines = graph.edges.flatMap((edge) => {
    const line = edgeLine(layout, edge);
    return line ? [{ source: edge.source, target: edge.target, ...line }] : [];
  });
  const crossing = estimateEdgeCrossings(lines);
  const lengths = lines.map((line) => line.length);
  const avg = lengths.length ? lengths.reduce((sum, value) => sum + value, 0) / lengths.length : 0;
  const max = lengths.length ? Math.max(...lengths) : 0;
  return {
    variant,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    recipeNodes: graph.nodes.filter((node) => (node.data as PlannerNodeData).kind === 'recipe').length,
    sourceNodes: graph.nodes.filter((node) => node.id.startsWith('source:')).length,
    finalNodes: graph.nodes.filter((node) => (node.data as PlannerNodeData).kind === 'final').length,
    surplusNodes: graph.nodes.filter((node) => (node.data as PlannerNodeData).kind === 'surplus').length,
    discardNodes: graph.nodes.filter((node) => (node.data as PlannerNodeData).kind === 'discard').length,
    fuelEdges: graph.edges.filter((edge) => edgeRole(edge) === 'fuel').length,
    fertilizerEdges: graph.edges.filter((edge) => edgeRole(edge) === 'fertilizer').length,
    steamEdges: graph.edges.filter((edge) => edgeRole(edge) === 'steam').length,
    labelCount: graph.edges.length,
    averageEdgeLength: Number(avg.toFixed(2)),
    maxEdgeLength: Number(max.toFixed(2)),
    estimatedCrossings: crossing.count,
    estimatedCrossingsCapped: crossing.capped,
    graphBuildMs: Number(graphBuildMs.toFixed(2)),
    layoutMs: Number(layoutMs.toFixed(2)),
    width: layout.width,
    height: layout.height,
  };
}


function scoreFlowGraphLayoutMetrics(metrics: Pick<FlowGraphLayoutMetrics, 'estimatedCrossings' | 'averageEdgeLength' | 'maxEdgeLength' | 'width' | 'height'>): number {
  return Number((
    metrics.estimatedCrossings * 1000 +
    metrics.averageEdgeLength +
    metrics.maxEdgeLength * 0.2 +
    metrics.width * 0.05 +
    metrics.height * 0.05
  ).toFixed(2));
}

function withLayoutDecision(
  metrics: FlowGraphLayoutMetrics,
  patch: Partial<FlowGraphLayoutMetrics>,
): FlowGraphLayoutMetrics {
  return { ...metrics, ...patch, layoutScore: patch.layoutScore ?? metrics.layoutScore ?? scoreFlowGraphLayoutMetrics(metrics) };
}

function fallbackReasonForDebugLayout(normal: FlowGraphLayoutMetrics, candidate: FlowGraphLayoutMetrics): string | undefined {
  const normalScore = normal.layoutScore ?? scoreFlowGraphLayoutMetrics(normal);
  const candidateScore = candidate.layoutScore ?? scoreFlowGraphLayoutMetrics(candidate);
  const crossingDelta = candidate.estimatedCrossings - normal.estimatedCrossings;
  const scoreRatio = normalScore > 0 ? candidateScore / normalScore : 1;
  if (candidate.width > normal.width * 2) return 'debug width is more than 2x normal';
  if (candidate.height > normal.height * 2.5) return 'debug height is more than 2.5x normal';
  if (candidate.maxEdgeLength > Math.max(1, normal.maxEdgeLength) * 2) return 'debug max edge length is more than 2x normal';
  if (candidateScore <= normalScore) return undefined;
  if (crossingDelta <= -5 && scoreRatio <= 1.02) return undefined;
  if (crossingDelta < 0 && scoreRatio <= 1.005 && candidate.maxEdgeLength <= Math.max(1, normal.maxEdgeLength) * 1.05) return undefined;
  return 'debug layout did not improve enough; selected normal-fallback';
}

function serializeGraphModel(variant: 'normal' | 'debug', layout: ReturnType<typeof layoutSvgNodes>, graph: { nodes: Node[]; edges: Edge[] }) {
  const nodeIds = new Set(layout.nodes.map((node) => node.id));
  return {
    variant,
    generatedAt: new Date().toISOString(),
    width: layout.width,
    height: layout.height,
    nodes: layout.nodes.map((node) => ({
      id: node.id,
      x: Number(node.x.toFixed(2)),
      y: Number(node.y.toFixed(2)),
      width: Number(node.width.toFixed(2)),
      height: Number(node.height.toFixed(2)),
      layer: node.layer,
      kind: node.data.kind,
      label: node.data.label,
      subLabel: node.data.subLabel,
      completed: node.data.completed,
      badges: node.data.badges,
    })),
    edges: graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)).map((edge) => {
      const data = edge.data as { itemName?: string; rateLabel?: string; color?: string; role?: string } | undefined;
      const style = edge.style as { stroke?: string } | undefined;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        itemName: data?.itemName,
        rateLabel: data?.rateLabel,
        role: data?.role ?? edgeRole(edge),
        color: data?.color ?? style?.stroke,
      };
    }),
  };
}

export type FlowGraphLayoutMetricsDiff = {
  generatedAt: string;
  improved: boolean;
  selectedLayout: string;
  fallbackReason?: string;
  normalScore: number;
  debugScore: number;
  scoreDelta: number;
  scoreRatio: number;
  improvedByCrossings: boolean;
  worseByLength: boolean;
  worseByCanvasSize: boolean;
  notesJa: string[];
  notesEn: string[];
  delta: Record<string, number>;
  normal: FlowGraphLayoutMetrics;
  debug: FlowGraphLayoutMetrics;
};

export function compareFlowGraphLayoutMetrics(normal: FlowGraphLayoutMetrics, debug: FlowGraphLayoutMetrics): FlowGraphLayoutMetricsDiff {
  const normalScore = normal.layoutScore ?? scoreFlowGraphLayoutMetrics(normal);
  const debugScore = debug.layoutScore ?? scoreFlowGraphLayoutMetrics(debug);
  const delta = {
    estimatedCrossings: debug.estimatedCrossings - normal.estimatedCrossings,
    averageEdgeLength: Number((debug.averageEdgeLength - normal.averageEdgeLength).toFixed(2)),
    maxEdgeLength: Number((debug.maxEdgeLength - normal.maxEdgeLength).toFixed(2)),
    width: Number((debug.width - normal.width).toFixed(2)),
    height: Number((debug.height - normal.height).toFixed(2)),
    layoutMs: Number((debug.layoutMs - normal.layoutMs).toFixed(2)),
    layoutScore: Number((debugScore - normalScore).toFixed(2)),
  };
  const scoreRatio = normalScore > 0 ? Number((debugScore / normalScore).toFixed(4)) : 1;
  const improvedByCrossings = delta.estimatedCrossings < 0;
  const worseByLength = delta.averageEdgeLength > 0 || delta.maxEdgeLength > 0;
  const worseByCanvasSize = delta.width > 0 || delta.height > 0;
  const improved = debugScore <= normalScore && !debug.fallbackReason;
  return {
    generatedAt: new Date().toISOString(),
    improved,
    selectedLayout: debug.selectedLayout ?? debug.layoutAlgorithm ?? 'debug-v2',
    fallbackReason: debug.fallbackReason,
    normalScore,
    debugScore,
    scoreDelta: Number((debugScore - normalScore).toFixed(2)),
    scoreRatio,
    improvedByCrossings,
    worseByLength,
    worseByCanvasSize,
    notesJa: [
      'Graph[DEBUG]はELKベース軽補正v2です。本番Graphにはまだ反映していません。改善が明確でない場合はnormal-fallbackを選択します。',
      'debug layoutが大きく悪化した場合はnormal-fallbackを選択します。',
      'estimatedCrossingsとedge lengthは概算です。改善方向の比較値として使用してください。',
    ],
    notesEn: [
      'Graph[DEBUG] uses ELK-based light-adjustment v2 and is not applied to the production Graph yet.',
      'If the debug layout does not clearly improve, normal-fallback is selected.',
      'estimatedCrossings and edge length are approximate comparison metrics.',
    ],
    delta,
    normal,
    debug,
  };
}

export function buildFlowGraphDebugArtifacts(
  result: CalculationResult,
  lang: Lang,
  settings: AppSettings,
  completedGraphNodeIds: Record<string, boolean>,
  variant: 'normal' | 'debug' = 'normal',
): FlowGraphDebugArtifacts {
  const graphStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const graph = buildFlowGraph(result, lang, settings, completedGraphNodeIds);
  const graphEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();

  if (variant === 'normal') {
    const layoutStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const layout = layoutSvgNodes(graph.nodes, graph.edges);
    const layoutEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const metrics = withLayoutDecision(
      graphMetrics('normal', graphEnd - graphStart, layoutEnd - layoutStart, graph, layout),
      { layoutAlgorithm: 'production-layered', selectedLayout: 'normal' },
    );
    return {
      variant,
      generatedAt: new Date().toISOString(),
      svg: renderFlowGraphSvgFromGraph(graph, layout, lang),
      model: serializeGraphModel(variant, layout, graph),
      metrics,
    };
  }

  const normalLayoutStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const normalLayout = layoutSvgNodes(graph.nodes, graph.edges);
  const normalLayoutEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const normalMetrics = withLayoutDecision(
    graphMetrics('normal', graphEnd - graphStart, normalLayoutEnd - normalLayoutStart, graph, normalLayout),
    { layoutAlgorithm: 'production-layered', selectedLayout: 'normal' },
  );

  const candidateLayoutStart = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const candidateLayout = layoutSvgNodesDebugV2(graph.nodes, graph.edges);
  const candidateLayoutEnd = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const candidateMetrics = withLayoutDecision(
    graphMetrics('debug', graphEnd - graphStart, candidateLayoutEnd - candidateLayoutStart, graph, candidateLayout),
    { layoutAlgorithm: 'elk-light-adjustment-v2', selectedLayout: 'debug-v2' },
  );

  const fallbackReason = fallbackReasonForDebugLayout(normalMetrics, candidateMetrics);
  const selectedLayout = fallbackReason ? normalLayout : candidateLayout;
  const selectedBaseMetrics = fallbackReason
    ? graphMetrics('debug', graphEnd - graphStart, candidateLayoutEnd - candidateLayoutStart, graph, normalLayout)
    : candidateMetrics;
  const selectedMetrics = withLayoutDecision(selectedBaseMetrics, {
    layoutAlgorithm: 'elk-light-adjustment-v2',
    selectedLayout: fallbackReason ? 'normal-fallback' : 'debug-v2',
    fallbackReason,
    normalLayoutScore: normalMetrics.layoutScore,
    debugCandidateLayoutScore: candidateMetrics.layoutScore,
    debugCandidate: candidateMetrics,
  });

  return {
    variant,
    generatedAt: new Date().toISOString(),
    svg: renderFlowGraphSvgFromGraph(graph, selectedLayout, lang),
    model: serializeGraphModel(variant, selectedLayout, graph),
    metrics: selectedMetrics,
  };
}
