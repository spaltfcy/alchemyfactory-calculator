import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { CalculationResult } from './calculate';
import type { AppSettings, Lang } from '../types';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { recipeById } from '../data/recipes';
import { text } from '../i18n';
import { formatNumber } from '../utils/format';

export type PlannerNodeData = {
  label: string;
  kind: 'item' | 'recipe' | 'surplus' | 'discard' | 'final';
  subLabel?: string;
  completed?: boolean;
};

const FLOW_COLORS = [
  '#ff6b6b',
  '#4dabf7',
  '#ffd43b',
  '#9775fa',
  '#ff922b',
  '#20c997',
  '#f06595',
  '#74c0fc',
] as const;

const DEFAULT_FLOW_COLOR = '#7dc4ff';
const FINAL_FLOW_COLOR = '#9fe870';

function beltCount(rate: number, conveyorItemsPerMinute: number): number {
  if (rate <= 0 || conveyorItemsPerMinute <= 0) return 0;
  return Math.ceil(rate / conveyorItemsPerMinute);
}

function itemName(itemId: string, lang: Lang): string {
  const item = itemById[itemId];
  return item ? text(item.name, lang) : itemId;
}

function rateLabel(rate: number, belts: number, lang: Lang): string {
  const beltLabel = lang === 'ja' ? 'ベルト' : 'Belt';
  const beltUnit = lang === 'ja' ? '本' : '';
  return formatNumber(rate) + '/min ' + beltLabel + ':' + belts + beltUnit;
}

function outputSortKey(recipeId: string, itemId: string): number {
  const recipe = recipeById[recipeId];
  if (!recipe) return 9999;

  const index = recipe.outputs.findIndex((output) => output.itemId === itemId);
  return index >= 0 ? index : 9999;
}

function colorForRecipeOutput(recipeId: string, itemId: string): string {
  const index = outputSortKey(recipeId, itemId);
  return FLOW_COLORS[index % FLOW_COLORS.length] ?? DEFAULT_FLOW_COLOR;
}

function marker(color: string) {
  return { type: MarkerType.ArrowClosed, color };
}

function edgeStyle(color: string, dashed = false) {
  return {
    stroke: color,
    strokeWidth: 2.15,
    ...(dashed ? { strokeDasharray: '6 4' } : {}),
  };
}

function makeEdge(args: {
  id: string;
  source: string;
  target: string;
  itemId: string;
  rate: number;
  belts: number;
  color: string;
  lang: Lang;
  dashed?: boolean;
}): Edge {
  return {
    id: args.id,
    type: 'flowEdge',
    source: args.source,
    target: args.target,
    animated: false,
    style: edgeStyle(args.color, args.dashed ?? false),
    markerEnd: marker(args.color),
    data: {
      itemName: itemName(args.itemId, args.lang),
      rateLabel: rateLabel(args.rate, args.belts, args.lang),
      color: args.color,
      cycleSide: 0,
      labelShiftY: 0,
    },
  };
}

function addOrMergeEdge(edges: Edge[], next: Edge) {
  const nextData = next.data as Record<string, unknown> | undefined;
  const existing = edges.find((edge) => {
    const data = edge.data as Record<string, unknown> | undefined;

    return (
      edge.source === next.source &&
      edge.target === next.target &&
      data?.itemName === nextData?.itemName &&
      data?.rateLabel === nextData?.rateLabel &&
      JSON.stringify(edge.style ?? {}) === JSON.stringify(next.style ?? {})
    );
  });

  if (existing) return;

  edges.push(next);
}

function decorateEdges(edges: Edge[]) {
  const directedGroups = new Map<string, Edge[]>();
  const undirectedRecipeGroups = new Map<string, Edge[]>();

  for (const edge of edges) {
    const directedKey = edge.source + '->' + edge.target;
    const directed = directedGroups.get(directedKey) ?? [];
    directed.push(edge);
    directedGroups.set(directedKey, directed);

    if (edge.source.startsWith('recipe:') && edge.target.startsWith('recipe:')) {
      const nodes = [edge.source, edge.target].sort();
      const key = nodes[0] + '<->' + nodes[1];
      const group = undirectedRecipeGroups.get(key) ?? [];
      group.push(edge);
      undirectedRecipeGroups.set(key, group);
    }
  }

  for (const group of directedGroups.values()) {
    if (group.length <= 1) continue;

    group.forEach((edge, index) => {
      edge.data = {
        ...(edge.data ?? {}),
        labelShiftY: (index - (group.length - 1) / 2) * 42,
      };
    });
  }

  for (const group of undirectedRecipeGroups.values()) {
    const directions = new Set(group.map((edge) => edge.source + '->' + edge.target));
    if (directions.size < 2) continue;

    group.forEach((edge) => {
      const side = edge.source < edge.target ? 1 : -1;
      const currentShift = Number((edge.data as Record<string, unknown> | undefined)?.labelShiftY ?? 0);

      edge.data = {
        ...(edge.data ?? {}),
        cycleSide: side,
        labelShiftY: currentShift + side * 24,
      };
    });
  }
}

export function buildFlowGraph(
  result: CalculationResult,
  lang: Lang,
  settings: AppSettings,
  completedGraphNodeIds: Record<string, boolean>,
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  const producerByItemId: Record<string, string> = {};
  for (const edge of result.outputEdges) {
    if (!edge.discarded) {
      producerByItemId[edge.toItemId] ??= edge.fromRecipeId;
    }
  }

  const finalItemIds = new Set(
    Object.values(result.itemStats)
      .filter((s) => s.targetRequested > 0 || s.targetActual > 0)
      .map((s) => s.itemId),
  );

  const discardedEdges = result.outputEdges.filter((edge) => edge.discarded && edge.rate > 0);
  const discardedNodeIds = new Set(discardedEdges.map((edge) => 'discard:' + edge.fromRecipeId + ':' + edge.toItemId));

  const sourceItemIds = new Set(
    result.conveyorEdges
      .filter((edge) => !producerByItemId[edge.fromItemId])
      .map((edge) => edge.fromItemId),
  );

  // 購入元・最終出力だけをアイテムノードとして残す。
  // 再利用途中の素材は中継ノードにせず、レシピ → レシピ の矢印ラベルで素材名を出す。
  for (const itemId of new Set([...sourceItemIds, ...finalItemIds])) {
    const s = result.itemStats[itemId];
    const item = itemById[itemId];

    if (!s || !item) continue;

    const isFinal = finalItemIds.has(itemId);
    const lines: string[] = [];

    if (isFinal) {
      if (s.targetActual > 0) lines.push((lang === 'ja' ? '最終 ' : 'Target ') + formatNumber(s.targetActual) + '/min');
      if (s.produced > 0) lines.push((lang === 'ja' ? '生産 ' : 'Prod ') + formatNumber(s.produced) + '/min');
    }

    if (!isFinal && s.purchased > 0) {
      lines.push((lang === 'ja' ? '購入 ' : 'Buy ') + formatNumber(s.purchased) + '/min');
    }

    if (!isFinal && !lines.length && s.requested > 0) {
      lines.push((lang === 'ja' ? '消費 ' : 'Use ') + formatNumber(s.requested) + '/min');
    }

    const id = 'item:' + itemId;
    nodes.push({
      id,
      type: 'plannerNode',
      position: { x: 0, y: 0 },
      data: {
        label: text(item.name, lang),
        kind: isFinal ? 'final' : 'item',
        subLabel: lines.join('\n'),
        completed: completedGraphNodeIds[id] ?? false,
      },
    });
  }

  for (const rs of Object.values(result.recipeStats)) {
    const recipe = recipeById[rs.recipeId];
    if (!recipe) continue;

    const machine = machineById[recipe.machineId];
    const lines = [
      machine ? text(machine.name, lang) : recipe.machineId,
      formatNumber(rs.theoreticalMachines) + ' → ' + formatNumber(rs.actualMachines) + ' ' + (lang === 'ja' ? '台' : 'machines'),
    ];

    const id = 'recipe:' + rs.recipeId;
    nodes.push({
      id,
      type: 'plannerNode',
      position: { x: 0, y: 0 },
      data: {
        label: text(recipe.name, lang),
        kind: 'recipe',
        subLabel: lines.join('\n'),
        completed: completedGraphNodeIds[id] ?? false,
      },
    });
  }

  if (settings.showSurplus) {
    for (const edge of discardedEdges) {
      const item = itemById[edge.toItemId];
      if (!item) continue;

      const id = 'discard:' + edge.fromRecipeId + ':' + edge.toItemId;
      const label = text(item.name, lang) + (lang === 'ja' ? '（破棄）' : ' (discard)');
      const lines = [(lang === 'ja' ? '破棄 ' : 'Discard ') + formatNumber(edge.rate) + '/min'];

      nodes.push({
        id,
        type: 'plannerNode',
        position: { x: 0, y: 0 },
        data: {
          label,
          kind: 'discard',
          subLabel: lines.join('\n'),
          completed: completedGraphNodeIds[id] ?? false,
        },
      });
    }
  }

  const sortedConveyorEdges = [...result.conveyorEdges].sort((a, b) => {
    const aProducer = producerByItemId[a.fromItemId] ?? '';
    const bProducer = producerByItemId[b.fromItemId] ?? '';

    if (aProducer !== bProducer) return aProducer.localeCompare(bProducer);

    const outputDiff = outputSortKey(aProducer, a.fromItemId) - outputSortKey(bProducer, b.fromItemId);
    if (outputDiff !== 0) return outputDiff;

    if (a.fromItemId !== b.fromItemId) return a.fromItemId.localeCompare(b.fromItemId);
    return a.toRecipeId.localeCompare(b.toRecipeId);
  });

  for (const edge of sortedConveyorEdges) {
    const producerRecipeId = producerByItemId[edge.fromItemId];

    const sourceId = producerRecipeId ? 'recipe:' + producerRecipeId : 'item:' + edge.fromItemId;
    const targetId = 'recipe:' + edge.toRecipeId;

    if (sourceId === targetId) continue;

    const color = producerRecipeId ? colorForRecipeOutput(producerRecipeId, edge.fromItemId) : DEFAULT_FLOW_COLOR;

    addOrMergeEdge(
      edges,
      makeEdge({
        id: 'in:' + edge.id,
        source: sourceId,
        target: targetId,
        itemId: edge.fromItemId,
        rate: edge.rate,
        belts: edge.belts,
        color,
        lang,
      }),
    );
  }

  const sortedOutputEdges = [...result.outputEdges].sort((a, b) => {
    if (a.fromRecipeId !== b.fromRecipeId) return a.fromRecipeId.localeCompare(b.fromRecipeId);

    const outputDiff = outputSortKey(a.fromRecipeId, a.toItemId) - outputSortKey(b.fromRecipeId, b.toItemId);
    if (outputDiff !== 0) return outputDiff;

    if (a.toItemId !== b.toItemId) return a.toItemId.localeCompare(b.toItemId);
    return Number(a.discarded) - Number(b.discarded);
  });

  for (const edge of sortedOutputEdges) {
    const toFinal = finalItemIds.has(edge.toItemId);
    const toDiscard = edge.discarded && settings.showSurplus && discardedNodeIds.has('discard:' + edge.fromRecipeId + ':' + edge.toItemId);

    if (!toFinal && !toDiscard) continue;

    const targetId = toDiscard ? 'discard:' + edge.fromRecipeId + ':' + edge.toItemId : 'item:' + edge.toItemId;
    const belts = beltCount(edge.rate, result.totals.conveyorItemsPerMinute);
    const color = toFinal ? FINAL_FLOW_COLOR : colorForRecipeOutput(edge.fromRecipeId, edge.toItemId);

    addOrMergeEdge(
      edges,
      makeEdge({
        id: (toDiscard ? 'discard:' : 'out:') + edge.id,
        source: 'recipe:' + edge.fromRecipeId,
        target: targetId,
        itemId: edge.toItemId,
        rate: edge.rate,
        belts,
        color,
        lang,
        dashed: toDiscard,
      }),
    );
  }

  decorateEdges(edges);

  return { nodes, edges };
}
