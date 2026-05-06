import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { AppSettings, Lang } from '../types';
import type { CalculatedEndpoint, CalculatedFlow, CalculationResult, CalculatedFlowRole } from './calculate';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { recipeById } from '../data/recipes';
import { text } from '../i18n';
import { formatNumber } from '../utils/format';

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
  badges?: Array<{ text: string; kind: 'heat' | 'info' }>;
  isFuelSource?: boolean;
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
const PIPELINE_FLOW_COLOR = '#74c0fc';

function itemName(itemId: string, lang: Lang): string {
  const item = itemById[itemId];
  return item ? text(item.name, lang) : itemId;
}

function machineName(machineId: string, lang: Lang): string {
  const machine = machineById[machineId];
  return machine ? text(machine.name, lang) : machineId;
}

function recipeName(recipeId: string, lang: Lang): string {
  const recipe = recipeById[recipeId];
  return recipe ? text(recipe.name, lang) : recipeId;
}

function beltLabel(belts: number, lang: Lang): string {
  return (lang === 'ja' ? '⚙ ' : '⚙ ') + formatNumber(belts, 0) + (lang === 'ja' ? '本' : '');
}

function transportLabel(flow: CalculatedFlow, lang: Lang): string {
  if (flow.transportKind === 'pipeline') return lang === 'ja' ? 'パイプライン 1本' : 'pipeline x1';
  return beltLabel(flow.transportUnits ?? flow.belts, lang);
}

function rateLabel(flow: CalculatedFlow, lang: Lang): string {
  return formatNumber(flow.rate) + '/min ・ ' + transportLabel(flow, lang);
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
  if (role === 'fertilizer') return 'bottom';
  return 'right';
}

function targetSide(role: CalculatedFlowRole): PlannerHandleSide {
  if (role === 'fuel') return 'top';
  if (role === 'fertilizer') return 'bottom';
  return 'left';
}

function makeEdge(flow: CalculatedFlow, color: string, lang: Lang): Edge {
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
    style: edgeStyle(color, flow.role === 'byproductReuse'),
    markerEnd: marker(color),
    data: {
      itemId: flow.itemId,
      itemName: labelName,
      rateLabel: rateLabel(flow, lang),
      color,
      cycleSide: 0,
      labelShiftY: 0,
      outputOrder: 9999,
      sourceSide: sourceSide(flow.role),
      targetSide: targetSide(flow.role),
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
    return {
      id,
      type: 'plannerNode',
      position: { x: 0, y: 0 },
      data: {
        label: recipeName(endpoint.recipeId, lang),
        kind: 'recipe',
        subLabel: nodeSubtitle(lines),
        badges: hasHeat ? [{ text: lang === 'ja' ? '要:熱源' : 'Heat', kind: 'heat' }] : undefined,
        isFuelSource,
      } satisfies PlannerNodeData,
    };
  }
  if (endpoint.type === 'itemSource') {
    const endpointId = endpointNodeId(endpoint);
    const flowRate = result.flows
      .filter((flow) => endpointNodeId(flow.from) === endpointId)
      .reduce((sum, flow) => sum + flow.rate, 0);
    const rate = endpoint.sourceMode === 'stock' ? 0 : flowRate;
    const label = itemName(endpoint.itemId, lang);
    const modeLabel = endpoint.sourceMode === 'stock' ? (lang === 'ja' ? '在庫' : 'Stock') : (lang === 'ja' ? '購入' : 'Buy');
    return {
      id,
      type: 'plannerNode',
      position: { x: 0, y: 0 },
      data: {
        label,
        kind: 'item',
        subLabel: modeLabel + (rate > 0 ? ' ' + formatNumber(rate) + '/min' : ''),
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
        subLabel: formatNumber(stat?.targetRequested ?? 0) + ' → ' + formatNumber(stat?.targetActual ?? 0) + '/min',
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
      subLabel: (discard ? (lang === 'ja' ? '破棄 ' : 'Discard ') : (lang === 'ja' ? '余剰 ' : 'Surplus ')) + formatNumber(discard ? (stat?.discarded ?? 0) : (stat?.surplus ?? 0)) + '/min',
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

function nodeTheme(kind: PlannerNodeData['kind'], completed?: boolean): {
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
  if (!completed) return theme;
  return { ...theme, stroke: '#63e6be' };
}

function measureSvgNode(node: Node): { width: number; height: number } {
  const data = node.data as PlannerNodeData;
  const subLines = splitNodeText(data.subLabel);
  const badgeWidths = (data.badges ?? []).map((badge) => estimateSvgTextWidth(badge.text, 11, true) + 22);
  const titleWidth = estimateSvgTextWidth(data.label, 15, true) + 28;
  const subWidth = subLines.reduce((max, line) => Math.max(max, estimateSvgTextWidth(line, 12) + 24), 0);
  const badgeWidth = badgeWidths.length ? badgeWidths.reduce((sum, value) => sum + value, 0) + Math.max(0, badgeWidths.length - 1) * 6 + 18 : 0;
  let width = Math.max(180, Math.ceil(Math.max(titleWidth, subWidth, badgeWidth)));
  if (data.kind === 'recipe') width = Math.max(width, 228);
  if (data.kind === 'final') width = Math.max(width, 210);
  const height = 48 + subLines.length * 16 + ((data.badges?.length ?? 0) > 0 ? 24 : 0);
  return { width, height: Math.max(56, height) };
}

function initialNodeLayer(node: Node): number {
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
  const theme = nodeTheme(data.kind, data.completed);
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
    let badgeX = node.x + 12;
    const badgeY = node.y + node.height - 24;
    for (const badge of data.badges ?? []) {
      const badgeWidth = Math.max(42, estimateSvgTextWidth(badge.text, 11, true) + 16);
      const fill = badge.kind === 'heat' ? '#4a2a0a' : '#14314a';
      const stroke = badge.kind === 'heat' ? '#ff922b' : '#4dabf7';
      const textFill = badge.kind === 'heat' ? '#ffe8cc' : '#d0ebff';
      lines.push('<rect x="' + badgeX.toFixed(1) + '" y="' + badgeY.toFixed(1) + '" width="' + badgeWidth.toFixed(1) + '" height="18" rx="9" ry="9" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1"/>');
      lines.push('<text x="' + (badgeX + badgeWidth / 2).toFixed(1) + '" y="' + (badgeY + 12.5).toFixed(1) + '" fill="' + textFill + '" font-size="11" font-family="Segoe UI, Noto Sans JP, sans-serif" font-weight="700" text-anchor="middle">' + escapeSvgText(badge.text) + '</text>');
      badgeX += badgeWidth + 6;
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

export function buildFlowGraphSvg(
  result: CalculationResult,
  lang: Lang,
  settings: AppSettings,
  completedGraphNodeIds: Record<string, boolean>,
): string {
  const graph = buildFlowGraph(result, lang, settings, completedGraphNodeIds);
  const layout = layoutSvgNodes(graph.nodes, graph.edges);

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
        labelShiftY?: number;
      } | undefined;
      const style = edge.style as { stroke?: string; strokeWidth?: number | string; strokeDasharray?: string } | undefined;
      const color = String(edgeData?.color ?? style?.stroke ?? DEFAULT_OUTPUT_COLOR);
      const sourcePoint = svgHandlePoint(sourceNode, edge.sourceHandle, 'source');
      const targetPoint = svgHandlePoint(targetNode, edge.targetHandle, 'target');
      const path = buildSvgEdgePath(sourcePoint, targetPoint);
      const midX = (sourcePoint.x + targetPoint.x) / 2;
      const midY = (sourcePoint.y + targetPoint.y) / 2 + Number(edgeData?.labelShiftY ?? 0);
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
