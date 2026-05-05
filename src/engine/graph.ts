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

function rateLabel(rate: number, belts: number, lang: Lang): string {
  return formatNumber(rate) + '/min ・ ' + beltLabel(belts, lang);
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
      rateLabel: rateLabel(flow.rate, flow.belts, lang),
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
    const stat = result.itemStats[endpoint.itemId];
    const rate = endpoint.sourceMode === 'stock' ? 0 : stat?.purchased ?? 0;
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
    return true;
  });

  for (const flow of flows) {
    if (normalFlows.includes(flow)) continue;
    colorByFlowId.set(flow.id, roleColor(flow.role, DEFAULT_OUTPUT_COLOR));
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
