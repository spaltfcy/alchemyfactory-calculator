import type { Edge, Node } from '@xyflow/react';
import type { CalculationResult } from './calculate';
import type { AppSettings, Lang } from '../types';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { recipeById } from '../data/recipes';
import { text } from '../i18n';
import { formatNumber } from '../utils/format';

export type PlannerNodeData = {
  label: string;
  kind: 'item' | 'recipe' | 'discard';
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

  for (const s of Object.values(result.itemStats)) {
    const item = itemById[s.itemId];
    if (!item) continue;
    const lines: string[] = [];
    if (settings.graphDetailLevel !== 'simple') {
      if (s.targetActual > 0) lines.push(`${lang === 'ja' ? '最終' : 'Target'} ${formatNumber(s.targetActual)}/min`);
      if (s.produced > 0) lines.push(`${lang === 'ja' ? '生産' : 'Prod'} ${formatNumber(s.produced)}/min`);
      if (s.consumed > 0) lines.push(`${lang === 'ja' ? '消費' : 'Use'} ${formatNumber(s.consumed)}/min`);
      if (settings.showSurplus && s.surplus > 0) lines.push(`${lang === 'ja' ? '余剰' : 'Surplus'} +${formatNumber(s.surplus)}/min`);
      if (s.purchased > 0) lines.push(`${lang === 'ja' ? '購入' : 'Buy'} ${formatNumber(s.purchased)}/min`);
    }
    const id = `item:${s.itemId}`;
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
      .filter(([, v]) => v > 0)
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

  const hasDiscard = result.outputEdges.some((edge) => edge.discarded);
  if (hasDiscard && settings.showDiscardedByproducts) {
    nodes.push({
      id: 'discard',
      type: 'plannerNode',
      position: { x: 0, y: 0 },
      data: { label: lang === 'ja' ? '破棄' : 'Discard', kind: 'discard' },
    });
  }

  for (const edge of result.conveyorEdges) {
    edges.push({
      id: `in:${edge.id}`,
      source: `item:${edge.fromItemId}`,
      target: `recipe:${edge.toRecipeId}`,
      label: `${formatNumber(edge.rate)}/min · ${edge.belts}${lang === 'ja' ? '本' : ' belts'}`,
      animated: false,
    });
  }

  for (const edge of result.outputEdges) {
    if (edge.discarded) {
      if (!settings.showDiscardedByproducts) continue;
      edges.push({
        id: `out:${edge.id}`,
        source: `recipe:${edge.fromRecipeId}`,
        target: 'discard',
        label: `${text(itemById[edge.toItemId]?.name ?? { ja: edge.toItemId, en: edge.toItemId }, lang)} ${formatNumber(edge.rate)}/min`,
        style: { strokeDasharray: '6 4' },
      });
      continue;
    }
    edges.push({
      id: `out:${edge.id}`,
      source: `recipe:${edge.fromRecipeId}`,
      target: `item:${edge.toItemId}`,
      label: `${formatNumber(edge.rate)}/min`,
      style: edge.byproduct ? { strokeDasharray: '4 3' } : undefined,
    });
  }

  return { nodes, edges };
}
