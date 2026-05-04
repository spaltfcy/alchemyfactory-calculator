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
  kind: 'item' | 'recipe';
  subLabel?: string;
  completed?: boolean;
};

export function buildFlowGraph(
  result: CalculationResult,
  lang: Lang,
  settings: AppSettings,
  completedGraphNodeIds: Record<string, boolean>,
): { nodes: Node<PlannerNodeData>[]; edges: Edge[] } {
  const nodes: Node<PlannerNodeData>[] = [];
  const edges: Edge[] = [];
  const defaultMarkerEnd = { type: MarkerType.ArrowClosed, color: '#7dc4ff' };

  const producerByItemId: Record<string, string> = {};
  for (const edge of result.outputEdges) {
    if (edge.discarded) continue;
    producerByItemId[edge.toItemId] ??= edge.fromRecipeId;
  }

  const finalItemIds = new Set(
    Object.values(result.itemStats)
      .filter((s) => s.targetRequested > 0 || s.targetActual > 0)
      .map((s) => s.itemId),
  );

  const sourceItemIds = new Set(
    result.conveyorEdges
      .filter((edge) => !producerByItemId[edge.fromItemId])
      .map((edge) => edge.fromItemId),
  );

  for (const itemId of new Set([...sourceItemIds, ...finalItemIds])) {
    const s = result.itemStats[itemId];
    const item = itemById[itemId];
    if (!s || !item) continue;

    const lines: string[] = [];
    if (finalItemIds.has(itemId)) {
      if (s.targetActual > 0) lines.push(`${lang === 'ja' ? '最終' : 'Target'} ${formatNumber(s.targetActual)}/min`);
      if (s.produced > 0) lines.push(`${lang === 'ja' ? '生産' : 'Prod'} ${formatNumber(s.produced)}/min`);
      if (settings.showSurplus && s.surplus > 0) lines.push(`${lang === 'ja' ? '余剰' : 'Surplus'} +${formatNumber(s.surplus)}/min`);
    }
    if (s.purchased > 0) lines.push(`${lang === 'ja' ? '購入' : 'Buy'} ${formatNumber(s.purchased)}/min`);
    if (!lines.length && s.requested > 0) lines.push(`${lang === 'ja' ? '消費' : 'Use'} ${formatNumber(s.requested)}/min`);

    const id = `item:${itemId}`;
    nodes.push({
      id,
      type: 'plannerNode',
      position: { x: 0, y: 0 },
      data: {
        label: text(item.name, lang),
        kind: 'item',
        subLabel: lines.join('\n'),
        completed: completedGraphNodeIds[id] ?? false,
      },
    });
  }

  for (const rs of Object.values(result.recipeStats)) {
    const recipe = recipeById[rs.recipeId];
    if (!recipe) continue;
    const machine = machineById[recipe.machineId];
    const surplusLines = Object.entries(rs.surplusOutputRates)
      .filter(([, value]) => value > 0)
      .map(([itemId, value]) => `+${formatNumber(value)}/min ${text(itemById[itemId]?.name ?? { ja: itemId, en: itemId }, lang)}`);
    const lines = [
      machine ? text(machine.name, lang) : recipe.machineId,
      `${formatNumber(rs.theoreticalMachines)} → ${formatNumber(rs.actualMachines)} ${lang === 'ja' ? '台' : 'machines'}`,
      ...surplusLines,
    ];

    const id = `recipe:${rs.recipeId}`;
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

  for (const edge of result.conveyorEdges) {
    const itemLabel = text(itemById[edge.fromItemId]?.name ?? { ja: edge.fromItemId, en: edge.fromItemId }, lang);
    const producerRecipeId = producerByItemId[edge.fromItemId];
    const sourceId = producerRecipeId ? `recipe:${producerRecipeId}` : `item:${edge.fromItemId}`;
    const targetId = `recipe:${edge.toRecipeId}`;
    if (sourceId === targetId) continue;

    edges.push({
      id: `in:${edge.id}`,
      source: sourceId,
      target: targetId,
      label: `${itemLabel} ${formatNumber(edge.rate)}/min · ${edge.belts}${lang === 'ja' ? '本' : ' belts'}`,
      animated: false,
      markerEnd: defaultMarkerEnd,
    });
  }

  for (const edge of result.outputEdges) {
    if (edge.discarded || !finalItemIds.has(edge.toItemId)) continue;
    edges.push({
      id: `out:${edge.id}`,
      source: `recipe:${edge.fromRecipeId}`,
      target: `item:${edge.toItemId}`,
      label: `${formatNumber(edge.rate)}/min`,
      style: edge.byproduct ? { strokeDasharray: '4 3' } : undefined,
      markerEnd: defaultMarkerEnd,
    });
  }

  return { nodes, edges };
}
