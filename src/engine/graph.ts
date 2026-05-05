import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { CalculationResult, OutputEdgeStat } from './calculate';
import type { AppSettings, Lang } from '../types';
import { itemById } from '../data/items';
import { machineById } from '../data/machines';
import { recipeById } from '../data/recipes';
import { FUEL_HEAT_VALUE_BY_ITEM_ID, HEAT_CONSUMER_BY_MACHINE_ID, resolveHeatMachineId } from '../data/heat';
import { text } from '../i18n';
import { formatNumber, formatRoundedNumber } from '../utils/format';

export type PlannerHandleSide = 'left' | 'right' | 'top' | 'bottom';

export type PlannerNodeBadge = {
 label: string;
 tone?: 'heat' | 'info';
};

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

 isFuelSource?: boolean;
  sourceHandles?: PlannerHandleData[];
  targetHandles?: PlannerHandleData[];

 badges?: PlannerNodeBadge[];
};

const FLOW_COLORS = [
 '#ff6b6b',
 '#4dabf7',
 '#9775fa',
 '#20c997',
 '#f06595',
 '#74c0fc',
 '#38d9a9',
 '#91a7ff',
 '#ffa94d',
 '#cc5de8',
] as const;


const DEFAULT_FLOW_COLOR = '#ff6b6b';
const FINAL_FLOW_COLOR = '#9fe870';
const DISCARD_FLOW_COLOR = '#ffd43b';
const FUEL_FLOW_COLOR = '#ff9f43';

function beltCount(rate: number, conveyorItemsPerMinute: number): number {
  if (rate <= 0 || conveyorItemsPerMinute <= 0) return 0;
  return Math.ceil(rate / conveyorItemsPerMinute);
}

function itemName(itemId: string, lang: Lang): string {
  const item = itemById[itemId];
  return item ? text(item.name, lang) : itemId;
}

function rateLabel(rate: number, belts: number, lang: Lang, settings?: AppSettings): string {
 const beltUnit = lang === 'ja' ? '本' : ' belts';
 const step = readQuantityRoundingStep(settings);
 return formatRoundedNumber(rate, step) + '/min ・ ⚙ ' + formatRoundedNumber(belts, step) + beltUnit;
}

function readQuantityRoundingStep(settings?: AppSettings): string {
 return String((settings as (AppSettings & { quantityRoundingStep?: string }) | undefined)?.quantityRoundingStep ?? '0.01');
}

function graphFuelSettings(settings: AppSettings) {
 const fuel = settings.fuel;
 return {
  enabled: fuel?.enabled ?? true,
  fuelItemId: fuel?.fuelItemId ?? 'charcoal_powder',
  fuelSourceMode: fuel?.fuelSourceMode ?? 'craft',
  crucibleVariant: fuel?.crucibleVariant ?? 'crucible',
  crucibleOverheadHeatPerSec: fuel?.crucibleOverheadHeatPerSec ?? 0.4,
  otherOverheadHeatPerSec: fuel?.otherOverheadHeatPerSec ?? 1,
  maxIterations: fuel?.maxIterations ?? 8,
 };
}

function heatRequiredNodeLabel(lang: Lang): string {
 return lang === 'ja' ? '要:熱源' : 'Needs heat';
}

function fuelItemEdgeLabel(itemId: string, lang: Lang): string {
 return itemName(itemId, lang) + (lang === 'ja' ? '（燃料）' : ' (fuel)');
}

function heatPerMachinePerSecond(machineId: string, settings: AppSettings): number {
 const fuel = graphFuelSettings(settings);
 if (!fuel.enabled) return 0;
 const heatMachineId = resolveHeatMachineId(machineId, fuel.crucibleVariant);
 const config = HEAT_CONSUMER_BY_MACHINE_ID[heatMachineId];
 if (!config) return 0;
 const overhead = config.overheadKind === 'crucible' ? fuel.crucibleOverheadHeatPerSec : fuel.otherOverheadHeatPerSec;
 return config.heatPerSec + overhead;
}

function recipeNeedsHeat(machineId: string, settings: AppSettings): boolean {
 return heatPerMachinePerSecond(machineId, settings) > 0;
}

function fuelRateForRecipePerMin(rs: { recipeId: string; actualMachines: number }, settings: AppSettings, result: CalculationResult): number {
 const fuel = graphFuelSettings(settings);
 if (!fuel.enabled) return 0;
 const fuelHeat = (FUEL_HEAT_VALUE_BY_ITEM_ID[fuel.fuelItemId] ?? 0) * (result.totals.fuelHeatValueMultiplier ?? 1);
 if (fuelHeat <= 0) return 0;
 const recipe = recipeById[rs.recipeId];
 if (!recipe) return 0;
 const heatPerSec = heatPerMachinePerSecond(recipe.machineId, settings);
 if (heatPerSec <= 0) return 0;
 return (rs.actualMachines * heatPerSec * 60 * (result.totals.heatConsumptionMultiplier ?? 1)) / fuelHeat;
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

function inputSortKey(recipeId: string, itemId: string): number {
 const recipe = recipeById[recipeId];
 if (!recipe) return 9999;
 const index = recipe.inputs.findIndex((input) => input.itemId === itemId);
 return index >= 0 ? index : 9999;
}

function colorIndexFromKey(key: string): number {
 let hash = 0;
 for (let i = 0; i < key.length; i += 1) {
  hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
 }
 return hash;
}

function colorForExternalOutput(_itemId: string): string {
 return DEFAULT_FLOW_COLOR;
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

function isMeteorCrusherRecipe(recipeId: string): boolean {
  const recipe = recipeById[recipeId];
  if (!recipe) return false;

  const idText = recipe.id.toLowerCase();
  const urlText = (recipe.sourceUrl ?? '').toLowerCase();
  const hasMeteorInput = recipe.inputs.some((input) => input.itemId.includes('meteor'));
  const hasManyStoneCrusherOutputs = recipe.machineId === 'stone_crusher' && recipe.outputs.length >= 3;

  return hasMeteorInput || idText.includes('meteor') || urlText.includes('meteor') || hasManyStoneCrusherOutputs;
}

function recipeNodeLabel(recipeId: string, lang: Lang): string {
  const recipe = recipeById[recipeId];
  if (!recipe) return recipeId;

  if (isMeteorCrusherRecipe(recipeId) && recipe.outputs.length >= 1) {
    return itemName(recipe.outputs[0].itemId, lang) + ' etc.';
  }

  return text(recipe.name, lang);
}

function makeEdge(args: {
  id: string;
  source: string;
  target: string;
  itemId: string;
  rate: number;
  belts: number;
  color: string;  lang: Lang;
  dashed?: boolean;
  itemLabel?: string;
  rateLabelText?: string;
  outputOrder?: number;
 settings?: AppSettings;
 sourceSide?: PlannerHandleSide;
 targetSide?: PlannerHandleSide;
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
      itemId: args.itemId,
      itemName: args.itemLabel ?? itemName(args.itemId, args.lang),
      rateLabel: args.rateLabelText ?? rateLabel(args.rate, args.belts, args.lang, args.settings),
  sourceSide: args.sourceSide,
  targetSide: args.targetSide,
      color: args.color,      cycleSide: 0,
      labelShiftY: 0,
      outputOrder: args.outputOrder ?? 9999,
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

function groupDiscardedEdges(discardedEdges: OutputEdgeStat[]) {
  const byRecipe = new Map<string, OutputEdgeStat[]>();

  for (const edge of discardedEdges) {
    const group = byRecipe.get(edge.fromRecipeId) ?? [];
    group.push(edge);
    byRecipe.set(edge.fromRecipeId, group);
  }

  for (const group of byRecipe.values()) {
    group.sort((a, b) => outputSortKey(a.fromRecipeId, a.toItemId) - outputSortKey(b.fromRecipeId, b.toItemId));
  }

  return byRecipe;
}

function discardSummaryTooltip(edges: OutputEdgeStat[], lang: Lang): string {
  return edges
    .map((edge) => itemName(edge.toItemId, lang) + ' ' + formatNumber(edge.rate) + '/min')
    .join('\n');
}

function discardNodeId(recipeId: string, edges: OutputEdgeStat[]): string {
  return edges.length >= 2 ? 'discard:' + recipeId + ':summary' : 'discard:' + recipeId + ':' + edges[0].toItemId;
}

function buildPlannerHandleData(edges: Edge[], direction: 'source' | 'target'): PlannerHandleData[] {
 const defaultSide: PlannerHandleSide = direction === 'source' ? 'right' : 'left';
 const sideOrder: PlannerHandleSide[] = ['top', 'left', 'right', 'bottom'];
 const handles: PlannerHandleData[] = [];
 let defaultIndex = 0;

 for (const side of sideOrder) {
  const sideEdges = edges.filter((edge) => {
   const data = edge.data as { sourceSide?: PlannerHandleSide; targetSide?: PlannerHandleSide; color?: string } | undefined;
   return ((direction === 'source' ? data?.sourceSide : data?.targetSide) ?? defaultSide) === side;
  });

  sideEdges.forEach((edge, index) => {
   const data = edge.data as { color?: string } | undefined;
   const id = side === defaultSide ? direction[0] + defaultIndex++ : direction[0] + '-' + side + '-' + index;
   if (direction === 'source') edge.sourceHandle = id;
   else edge.targetHandle = id;
   handles.push({
    id,
    topPct: ((index + 1) / (sideEdges.length + 1)) * 100,
    color: String(data?.color ?? DEFAULT_FLOW_COLOR),
    side,
   });
  });
 }

 return handles;
}

function isNormalFlowEdge(edge: Edge): boolean {
 return edge.id.startsWith('in:');
}

function readEdgeColor(edge: Edge): string {
 const data = edge.data as { color?: string } | undefined;
 return String(data?.color ?? DEFAULT_FLOW_COLOR);
}

function chooseNormalFlowColor(avoidColors: Set<string>, offset: number): string {
 if (avoidColors.size <= 0) return DEFAULT_FLOW_COLOR;
 const candidates = FLOW_COLORS.filter((color) => !avoidColors.has(color));
 if (candidates.length <= 0) return DEFAULT_FLOW_COLOR;
 return candidates[Math.abs(offset) % candidates.length] ?? DEFAULT_FLOW_COLOR;
}

function writeEdgeColor(edge: Edge, color: string) {
 const style = (edge.style ?? {}) as Record<string, unknown>;
 const dashed = typeof style.strokeDasharray === 'string' && style.strokeDasharray.length > 0;
 edge.style = edgeStyle(color, dashed);
 edge.markerEnd = marker(color);
 const data = { ...((edge.data ?? {}) as Record<string, unknown>) };
 delete data.inputColor;
 data.color = color;
 edge.data = data;
}

function normalizeNormalFlowColors(edges: Edge[]) {
 const normalEdges = edges.filter(isNormalFlowEdge);
 if (normalEdges.length <= 0) return;

 for (const edge of normalEdges) {
  writeEdgeColor(edge, DEFAULT_FLOW_COLOR);
 }

 const maxPasses = Math.min(Math.max(normalEdges.length, 1), 24);
 for (let pass = 0; pass < maxPasses; pass += 1) {
  const incomingColorsByNode = new Map<string, Set<string>>();
  const outgoingEdgesByNode = new Map<string, Edge[]>();

  for (const edge of normalEdges) {
   const incoming = incomingColorsByNode.get(edge.target) ?? new Set<string>();
   incoming.add(readEdgeColor(edge));
   incomingColorsByNode.set(edge.target, incoming);

   const outgoing = outgoingEdgesByNode.get(edge.source) ?? [];
   outgoing.push(edge);
   outgoingEdgesByNode.set(edge.source, outgoing);
  }

  let changed = false;
  for (const [nodeId, outgoingEdges] of outgoingEdgesByNode.entries()) {
   const avoidColors = incomingColorsByNode.get(nodeId) ?? new Set<string>();
   const sorted = [...outgoingEdges].sort((a, b) => {
    const ad = a.data as Record<string, unknown> | undefined;
    const bd = b.data as Record<string, unknown> | undefined;
    return (
     Number(ad?.outputOrder ?? 9999) - Number(bd?.outputOrder ?? 9999) ||
     String(ad?.itemId ?? '').localeCompare(String(bd?.itemId ?? '')) ||
     a.target.localeCompare(b.target)
    );
   });

   const colorByItem = new Map<string, string>();
   for (const edge of sorted) {
    const data = edge.data as Record<string, unknown> | undefined;
    const key = String(data?.itemId ?? edge.id);
    let nextColor = colorByItem.get(key);
    if (!nextColor) {
     nextColor = chooseNormalFlowColor(avoidColors, colorByItem.size);
     colorByItem.set(key, nextColor);
    }
    if (readEdgeColor(edge) !== nextColor) {
     writeEdgeColor(edge, nextColor);
     changed = true;
    }
   }
  }

  if (!changed) break;
 }
}
function decorateEdgesAndHandles(nodes: Node[], edges: Edge[]) {
  const directedGroups = new Map<string, Edge[]>();
  const undirectedRecipeGroups = new Map<string, Edge[]>();

  for (const edge of edges) {
    const directedKey = edge.source + '->' + edge.target;
    const directed = directedGroups.get(directedKey) ?? [];
    directed.push(edge);
    directedGroups.set(directedKey, directed);

    if (edge.source.startsWith('recipe:') && edge.target.startsWith('recipe:')) {
      const pair = [edge.source, edge.target].sort();
      const key = pair[0] + '<->' + pair[1];
      const group = undirectedRecipeGroups.get(key) ?? [];
      group.push(edge);
      undirectedRecipeGroups.set(key, group);
    }
  }

  for (const group of directedGroups.values()) {
    if (group.length <= 1) continue;

    group
      .sort((a, b) => {
        const ad = a.data as Record<string, unknown> | undefined;
        const bd = b.data as Record<string, unknown> | undefined;

        return (
          Number(ad?.outputOrder ?? 9999) - Number(bd?.outputOrder ?? 9999) ||
          String(ad?.itemId ?? '').localeCompare(String(bd?.itemId ?? '')) ||
          a.target.localeCompare(b.target)
        );
      })
      .forEach((edge, index) => {
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

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();

  for (const edge of edges) {
    const out = outgoing.get(edge.source) ?? [];
    out.push(edge);
    outgoing.set(edge.source, out);

    const inc = incoming.get(edge.target) ?? [];
    inc.push(edge);
    incoming.set(edge.target, inc);
  }

  function sortPortEdges(list: Edge[]) {
    return [...list].sort((a, b) => {
      const ad = a.data as Record<string, unknown> | undefined;
      const bd = b.data as Record<string, unknown> | undefined;

      return (
        Number(ad?.outputOrder ?? 9999) - Number(bd?.outputOrder ?? 9999) ||
        String(ad?.itemId ?? '').localeCompare(String(bd?.itemId ?? '')) ||
        a.target.localeCompare(b.target) ||
        a.source.localeCompare(b.source)
      );
    });
  }

  for (const [nodeId, node] of nodeById.entries()) {
    const nodeData = { ...(node.data as PlannerNodeData) };

    const sourceEdges = sortPortEdges(outgoing.get(nodeId) ?? []);
    const targetEdges = sortPortEdges(incoming.get(nodeId) ?? []);

    nodeData.sourceHandles = buildPlannerHandleData(sourceEdges, 'source');

  nodeData.targetHandles = buildPlannerHandleData(targetEdges, 'target');

  node.data = nodeData;
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
  const discardedByRecipe = groupDiscardedEdges(discardedEdges);
  const discardTargetByEdgeId = new Map<string, string>();

  for (const [recipeId, group] of discardedByRecipe.entries()) {
    const nodeId = discardNodeId(recipeId, group);

    for (const edge of group) {
      discardTargetByEdgeId.set(edge.id, nodeId);
    }
  }

  const sourceItemIds = new Set(

  result.conveyorEdges

  .filter((edge) => (edge.sourceKind === 'item' || (!edge.sourceKind && !edge.fromRecipeId)) || (!edge.fromRecipeId && !producerByItemId[edge.fromItemId]))

  .map((edge) => edge.fromItemId),

  );

   const graphFuel = graphFuelSettings(settings);
 if (graphFuel.enabled && graphFuel.fuelItemId && result.totals.fuelRequiredPerMin > 0 && graphFuel.fuelSourceMode === 'buy') {
  sourceItemIds.add(graphFuel.fuelItemId);
 }

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
        label: recipeNodeLabel(rs.recipeId, lang),
        kind: 'recipe',
        subLabel: lines.join('\n'),
        completed: completedGraphNodeIds[id] ?? false,
  badges: recipeNeedsHeat(recipe.machineId, settings) ? [{ label: heatRequiredNodeLabel(lang), tone: 'heat' }] : [],
      },
    });
  }

  if (settings.showSurplus) {
    for (const [recipeId, group] of discardedByRecipe.entries()) {
      const nodeId = discardNodeId(recipeId, group);

      if (group.length >= 2) {
        nodes.push({
          id: nodeId,
          type: 'plannerNode',
          position: { x: 0, y: 0 },
          data: {
            label: lang === 'ja' ? '副産物（破棄）' : 'Byproducts (discard)',
            kind: 'discard',
            subLabel: (lang === 'ja' ? group.length + '種類' : group.length + ' types'),
            tooltip: discardSummaryTooltip(group, lang),
            completed: completedGraphNodeIds[nodeId] ?? false,
          },
        });
      } else {
        const edge = group[0];
        const label = itemName(edge.toItemId, lang) + (lang === 'ja' ? '（破棄）' : ' (discard)');
        const lines = [(lang === 'ja' ? '破棄 ' : 'Discard ') + formatNumber(edge.rate) + '/min'];

        nodes.push({
          id: nodeId,
          type: 'plannerNode',
          position: { x: 0, y: 0 },
          data: {
            label,
            kind: 'discard',
            subLabel: lines.join('\n'),
            tooltip: discardSummaryTooltip(group, lang),
            completed: completedGraphNodeIds[nodeId] ?? false,
          },
        });
      }
    }
  }

  const sortedConveyorEdges = [...result.conveyorEdges].sort((a, b) => {
    const aProducer = (a.sourceKind === 'item' || (!a.sourceKind && !a.fromRecipeId)) ? '' : (a.fromRecipeId ?? producerByItemId[a.fromItemId] ?? '');

  const bProducer = (b.sourceKind === 'item' || (!b.sourceKind && !b.fromRecipeId)) ? '' : (b.fromRecipeId ?? producerByItemId[b.fromItemId] ?? '');

    if (aProducer !== bProducer) return aProducer.localeCompare(bProducer);

    const inputDiff = inputSortKey(a.toRecipeId, a.fromItemId) - inputSortKey(b.toRecipeId, b.fromItemId);
 if (inputDiff !== 0) return inputDiff;

    if (a.fromItemId !== b.fromItemId) return a.fromItemId.localeCompare(b.fromItemId);
    return a.toRecipeId.localeCompare(b.toRecipeId);
  });

  for (const edge of sortedConveyorEdges) {
    const producerRecipeId = (edge.sourceKind === 'item' || (!edge.sourceKind && !edge.fromRecipeId)) ? undefined : (edge.fromRecipeId ?? producerByItemId[edge.fromItemId]);

    const sourceId = producerRecipeId ? 'recipe:' + producerRecipeId : 'item:' + edge.fromItemId;
    const targetId = 'recipe:' + edge.toRecipeId;

    if (sourceId === targetId) continue;

    const color = DEFAULT_FLOW_COLOR;

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
  settings,
        outputOrder: inputSortKey(edge.toRecipeId, edge.fromItemId),
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

  const summaryEdgeAddedByNodeId = new Set<string>();

  for (const edge of sortedOutputEdges) {
    const toFinal = finalItemIds.has(edge.toItemId);
    const discardTargetId = discardTargetByEdgeId.get(edge.id);
    const toDiscard = edge.discarded && settings.showSurplus && discardTargetId;

    if (!toFinal && !toDiscard) continue;

    if (toDiscard) {
      const group = discardedByRecipe.get(edge.fromRecipeId) ?? [];
      const isSummary = group.length >= 2;
      const targetId = discardTargetId;

      if (isSummary) {
        if (summaryEdgeAddedByNodeId.has(targetId)) continue;
        summaryEdgeAddedByNodeId.add(targetId);

        addOrMergeEdge(
          edges,
          makeEdge({
            id: 'discard-summary:' + edge.fromRecipeId,
            source: 'recipe:' + edge.fromRecipeId,
            target: targetId,
            itemId: '__discard_summary__',
            rate: 0,
            belts: 0,
            color: DISCARD_FLOW_COLOR,
            lang,
  settings,
            dashed: true,
            itemLabel: lang === 'ja' ? '副産物（破棄）' : 'Byproducts (discard)',
            rateLabelText: '',
            outputOrder: 9998,
          }),
        );

        continue;
      }

      const belts = beltCount(edge.rate, result.totals.conveyorItemsPerMinute);
      const color = DISCARD_FLOW_COLOR;

      addOrMergeEdge(
        edges,
        makeEdge({
          id: 'discard:' + edge.id,
          source: 'recipe:' + edge.fromRecipeId,
          target: targetId,
          itemId: edge.toItemId,
          rate: edge.rate,
          belts,
          color,
          lang,
  settings,
          dashed: true,
          outputOrder: outputSortKey(edge.fromRecipeId, edge.toItemId),
        }),
      );

      continue;
    }

    const belts = beltCount(edge.rate, result.totals.conveyorItemsPerMinute);
    const color = toDiscard ? DISCARD_FLOW_COLOR : toFinal ? FINAL_FLOW_COLOR : colorForRecipeOutput(edge.fromRecipeId, edge.toItemId);

    addOrMergeEdge(
      edges,
      makeEdge({
        id: 'out:' + edge.id,
        source: 'recipe:' + edge.fromRecipeId,
        target: 'item:' + edge.toItemId,
        itemId: edge.toItemId,
        rate: edge.rate,
        belts,
        color,
        lang,
  settings,
        outputOrder: outputSortKey(edge.fromRecipeId, edge.toItemId),
      }),
    );
  }

   if (graphFuel.enabled && graphFuel.fuelItemId && result.totals.fuelRequiredPerMin > 0) {
  const fuelItemId = graphFuel.fuelItemId;
  const fuelProducerRecipeId = producerByItemId[fuelItemId];
  let sourceNodeId = fuelProducerRecipeId ? 'recipe:' + fuelProducerRecipeId : 'item:' + fuelItemId;

  if (!nodes.some((node) => node.id === sourceNodeId)) {
   const fuelItem = itemById[fuelItemId];
   if (fuelItem) {
    sourceNodeId = 'item:' + fuelItemId;
    nodes.push({
     id: sourceNodeId,
     type: 'plannerNode',
     position: { x: 0, y: 0 },
     data: {
      label: text(fuelItem.name, lang),
      kind: 'item',
      subLabel: lang === 'ja' ? '燃料' : 'Fuel',
      completed: completedGraphNodeIds[sourceNodeId] ?? false,
     },
    });
   }
  }

  for (const rs of Object.values(result.recipeStats)) {
   const recipe = recipeById[rs.recipeId];
   if (!recipe) continue;
   const targetId = 'recipe:' + rs.recipeId;
   if (sourceNodeId === targetId) continue;
   const fuelRate = fuelRateForRecipePerMin(rs, settings, result);
   if (fuelRate <= 0) continue;
   const belts = beltCount(fuelRate, result.totals.conveyorItemsPerMinute);
   addOrMergeEdge(
    edges,
    makeEdge({
     id: 'fuel:' + graphFuel.fuelItemId + '->' + rs.recipeId,
     source: sourceNodeId,
     target: targetId,
     itemId: fuelItemId,
     rate: fuelRate,
     belts,
     color: FUEL_FLOW_COLOR,
     lang,
     settings,
     itemLabel: fuelItemEdgeLabel(fuelItemId, lang),
     targetSide: 'top',
     outputOrder: -1000,
    }),
   );
  }
 }

 const fuelSourceNodeIds = new Set(edges.filter((edge) => edge.id.startsWith('fuel:')).map((edge) => edge.source));
 if (fuelSourceNodeIds.size > 0) {
  for (const node of nodes) {
   if (!fuelSourceNodeIds.has(node.id)) continue;
   node.data = {
    ...(node.data as PlannerNodeData),
    isFuelSource: true,
   };
  }
 }

normalizeNormalFlowColors(edges);
 decorateEdgesAndHandles(nodes, edges);

  return { nodes, edges };
}
