import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  MiniMap,
  Panel,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type ReactFlowInstance,
} from '@xyflow/react';
import type { AppSettings, Lang } from '../types';
import type { CalculationResult } from '../engine/calculate';
import { buildFlowGraph, type PlannerHandleSide } from '../engine/graph';
import { layoutWithElk } from '../engine/layout';
import { PlannerNode } from './PlannerNode';

const UPDATE_OVERLAY_THRESHOLD = 150;
const nodeTypes = { plannerNode: PlannerNode };
const edgeTypes = { flowEdge: FlowEdge };

type EdgeData = {
  itemId?: string;
  itemName?: string;
  rateLabel?: string;
  color?: string;
  cycleSide?: number;
  labelShiftY?: number;
  outputOrder?: number;
};

type PlannerHandleData = {
  id: string;
  topPct: number;
  color: string;
};

type GraphTabProps = {
  lang: Lang;
  result: CalculationResult;
  settings: AppSettings;
  completedGraphNodeIds: Record<string, boolean>;
  onToggleCompleted: (nodeId: string) => void;
  debug?: boolean;
};

type GraphControlsProps = {
  lang: Lang;
  isInteractive: boolean;
  onToggleInteractive: () => void;
};


function isFiniteGraphFlow(flow: CalculationResult['flows'][number]): boolean {
  return (
    typeof flow.rate === 'number' &&
    Number.isFinite(flow.rate) &&
    typeof flow.belts === 'number' &&
    Number.isFinite(flow.belts) &&
    typeof flow.transportUnits === 'number' &&
    Number.isFinite(flow.transportUnits)
  );
}

function graphInvalidTitle(lang: Lang): string {
  return lang === 'ja' ? '\u8a08\u7b97\u4e0d\u80fd' : 'Calculation error';
}

type CycleErrorSummaryLike = {
  code?: string;
  messageJa?: string;
  messageEn?: string;
  cycleTextJa?: string;
  cycleTextEn?: string;
  itemIds?: string[];
  recipeIds?: string[];
  [key: string]: unknown;
};

function splitCycleText(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(/\s*(?:->|→)\s*/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function compactAdjacentCycleParts(parts: string[]): string[] {
  const compacted: string[] = [];
  for (const part of parts) {
    if (compacted[compacted.length - 1] !== part) compacted.push(part);
  }
  return compacted;
}

function rotateClosedCycleParts(parts: string[], preferredStart: string): string[] {
  if (parts.length <= 1) return parts;
  const closed = parts[0] === parts[parts.length - 1];
  const body = closed ? parts.slice(0, -1) : [...parts];
  const index = body.indexOf(preferredStart);
  if (index <= 0) return closed ? [...body, body[0]] : body;
  const rotated = [...body.slice(index), ...body.slice(0, index)];
  return closed ? [...rotated, rotated[0]] : rotated;
}

function choosePreferredCycleStartJa(parts: string[]): string | undefined {
  if (parts.includes('火薬') && parts.includes('生石灰') && parts.includes('石灰水')) return '火薬';
  if (parts.includes('木炭の粉末') && parts.includes('木炭')) return '木炭の粉末';
  return parts[0];
}

function choosePreferredCycleStartEn(parts: string[]): string | undefined {
  if (parts.includes('Black Powder') && parts.includes('Quicklime') && parts.includes('Limewater')) return 'Black Powder';
  if (parts.includes('Charcoal Powder') && parts.includes('Charcoal')) return 'Charcoal Powder';
  return parts[0];
}

function formatCycleText(value: unknown, lang: 'ja' | 'en'): string | undefined {
  const parts = compactAdjacentCycleParts(splitCycleText(value));
  if (parts.length === 0) return undefined;
  const preferred = lang === 'ja' ? choosePreferredCycleStartJa(parts) : choosePreferredCycleStartEn(parts);
  const rotated = preferred ? rotateClosedCycleParts(parts, preferred) : parts;
  return rotated.join(lang === 'ja' ? ' → ' : ' -> ');
}

function cycleHeadFromText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.split(/\s*(?:->|→)\s*/g).map((part) => part.trim()).find(Boolean);
}

function normalizeCycleErrorSummary(summary: CycleErrorSummaryLike): CycleErrorSummaryLike {
  if (summary.code !== 'RECIPE_CYCLE_INVALID') return summary;

  const cycleTextJa = formatCycleText(summary.cycleTextJa, 'ja');
  const cycleTextEn = formatCycleText(summary.cycleTextEn, 'en');
  const headJa = cycleHeadFromText(cycleTextJa);
  const headEn = cycleHeadFromText(cycleTextEn);

  return {
    ...summary,
    messageJa: headJa ? headJa + 'が循環しています。' : summary.messageJa,
    messageEn: headEn ? headEn + ' is in a recipe cycle.' : summary.messageEn,
    cycleTextJa: cycleTextJa ?? summary.cycleTextJa,
    cycleTextEn: cycleTextEn ?? summary.cycleTextEn,
  };
}

function cycleCanonicalKey(summary: CycleErrorSummaryLike): string {
  if (summary.code !== 'RECIPE_CYCLE_INVALID') return String(summary.code ?? '') + ':' + String(summary.messageJa ?? '');
  const itemIds = Array.isArray(summary.itemIds) ? [...summary.itemIds].sort().join(',') : '';
  const recipeIds = Array.isArray(summary.recipeIds) ? [...summary.recipeIds].sort().join(',') : '';
  return summary.code + ':' + itemIds + ':' + recipeIds;
}

function normalizeCycleErrorSummaries(errorSummaries: unknown): CycleErrorSummaryLike[] {
  if (!Array.isArray(errorSummaries)) return [];
  const normalized: CycleErrorSummaryLike[] = [];
  const seen = new Set<string>();

  for (const rawSummary of errorSummaries) {
    if (!rawSummary || typeof rawSummary !== 'object') continue;
    const summary = normalizeCycleErrorSummary(rawSummary as CycleErrorSummaryLike);
    const key = cycleCanonicalKey(summary);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(summary);
  }

  return normalized;
}

function graphInvalidLines(result: CalculationResult, lang: Lang): string[] {
  const summaries = normalizeCycleErrorSummaries(result.errorSummaries ?? []);
  const lines = summaries
    .filter((summary) => summary.code === 'RECIPE_CYCLE_INVALID')
    .map((summary) => {
      const message = lang === 'ja' ? summary.messageJa : summary.messageEn;
      const detail = lang === 'ja' ? summary.cycleTextJa : summary.cycleTextEn;
      return detail ? String(message ?? '') + ' ' + detail : String(message ?? '');
    })
    .filter((line) => line.trim().length > 0);

  if (lines.length > 0) return lines.slice(0, 4);
  return [
    lang === 'ja'
      ? '循環または非数値のため計算できません。'
      : 'The graph contains a cycle or invalid numbers.',
  ];
}

function readEdgeData(edge: Edge): EdgeData {
  return (edge.data ?? {}) as EdgeData;
}

function getCyclePath(sourceX: number, sourceY: number, targetX: number, targetY: number, side: number) {
 const dx = targetX - sourceX;
 const dy = targetY - sourceY;
 const length = Math.max(Math.hypot(dx, dy), 1);
 const nx = -dy / length;
 const ny = dx / length;
 const offset = Math.min(260, Math.max(160, length * 0.36)) * side;
 const controlX = (sourceX + targetX) / 2 + nx * offset;
 const controlY = (sourceY + targetY) / 2 + ny * offset;
 return {
  path: `M ${sourceX},${sourceY} Q ${controlX},${controlY} ${targetX},${targetY}`,
  labelX: sourceX * 0.25 + controlX * 0.5 + targetX * 0.25,
  labelY: sourceY * 0.25 + controlY * 0.5 + targetY * 0.25,
 };
}

function FlowEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd } = props;
  const data = (props.data ?? {}) as EdgeData;
  const cycleSide = Number(data.cycleSide ?? 0);
  const pathData =
    cycleSide !== 0
      ? getCyclePath(sourceX, sourceY, targetX, targetY, cycleSide)
      : (() => {
          const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
          return { path, labelX, labelY };
        })();
  const labelShiftY = Number(data.labelShiftY ?? 0);
  const rateLabel = data.rateLabel ? String(data.rateLabel) : '';

  return (
    <>
      <BaseEdge id={id} path={pathData.path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className={rateLabel ? 'flow-edge-label' : 'flow-edge-label flow-edge-label-single'}
          style={{
            transform: `translate(-50%, -50%) translate(${pathData.labelX}px, ${pathData.labelY + labelShiftY}px)`,
            borderColor: data.color ? `${data.color}77` : undefined,
          }}
        >
          <div className="flow-edge-label-item">{data.itemName}</div>
          {rateLabel && <div className="flow-edge-label-rate">{rateLabel}</div>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function ZoomInIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.25" /><path d="M15.2 15.2L20.5 20.5" /><path d="M10.5 7.35V13.65" /><path d="M7.35 10.5H13.65" /></svg>;
}
function ZoomOutIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.25" /><path d="M15.2 15.2L20.5 20.5" /><path d="M7.35 10.5H13.65" /></svg>;
}
function FitIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.25 9V4.25H9" /><path d="M15 4.25H19.75V9" /><path d="M19.75 15V19.75H15" /><path d="M9 19.75H4.25V15" /><path d="M8.5 12H15.5" /><path d="M12 8.5V15.5" /></svg>;
}
function UnlockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.25" width="13" height="9.25" rx="2" /><path d="M8.5 10.25V7.75C8.5 5.4 10.15 3.75 12.5 3.75C14.05 3.75 15.35 4.45 16.05 5.65" /><path d="M12 13.5V16.25" /></svg>;
}
function LockIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.5" y="10.25" width="13" height="9.25" rx="2" /><path d="M8.5 10.25V7.75C8.5 5.45 9.95 3.75 12 3.75C14.05 3.75 15.5 5.45 15.5 7.75V10.25" /><path d="M12 13.5V16.25" /></svg>;
}


function edgeTargetSide(edge: Edge): PlannerHandleSide {
 const data = edge.data as { targetSide?: PlannerHandleSide } | undefined;
 return data?.targetSide ?? 'left';
}
function edgeSourceSide(edge: Edge): PlannerHandleSide {
 const data = edge.data as { sourceSide?: PlannerHandleSide } | undefined;
 return data?.sourceSide ?? 'right';
}


function realignIncomingHandlesBySourceY(nodes: Node[], edges: Edge[]) {
 const incoming = new Map<string, Edge[]>();
 const outgoing = new Map<string, Edge[]>();
 const nodeY = new Map(nodes.map((node) => [node.id, node.position.y]));
 const nextNodes = nodes.map((node) => ({ ...node, data: { ...(node.data ?? {}) } }));
 const nextNodeById = new Map(nextNodes.map((node) => [node.id, node]));
 const nextEdges = edges.map((edge) => ({ ...edge, data: { ...(edge.data ?? {}) } }));
 const nextEdgeById = new Map(nextEdges.map((edge) => [edge.id, edge]));

 for (const edge of edges) {
  const inc = incoming.get(edge.target) ?? [];
  inc.push(edge);
  incoming.set(edge.target, inc);

  const out = outgoing.get(edge.source) ?? [];
  out.push(edge);
  outgoing.set(edge.source, out);
 }

 const sideOrder: PlannerHandleSide[] = ['top', 'left', 'right', 'bottom'];

 for (const [targetId, group] of incoming.entries()) {
  const target = nextNodeById.get(targetId);
  if (!target) continue;
  const sorted = [...group].sort((a, b) => {
   const aData = readEdgeData(a);
   const bData = readEdgeData(b);
   return (
    (nodeY.get(a.source) ?? 0) - (nodeY.get(b.source) ?? 0) ||
    Number(aData.outputOrder ?? 9999) - Number(bData.outputOrder ?? 9999) ||
    String(aData.itemId ?? '').localeCompare(String(bData.itemId ?? '')) ||
    a.source.localeCompare(b.source)
   );
  });

  const targetHandles: Array<PlannerHandleData & { side?: PlannerHandleSide }> = [];
  for (const side of sideOrder) {
   const sideEdges = sorted.filter((edge) => edgeTargetSide(nextEdgeById.get(edge.id) ?? edge) === side);
   sideEdges.forEach((edge, index) => {
    const nextEdge = nextEdgeById.get(edge.id);
    const data = nextEdge ? readEdgeData(nextEdge) : readEdgeData(edge);
    const id = side === 'left' ? 't' + targetHandles.length : 't-' + side + '-' + index;
    if (nextEdge) nextEdge.targetHandle = id;
    targetHandles.push({
     id,
     topPct: ((index + 1) / (sideEdges.length + 1)) * 100,
     color: String(data.color ?? '#7dc4ff'),
     side,
    });
   });
  }
  target.data = { ...(target.data ?? {}), targetHandles };
 }

 for (const [sourceId, group] of outgoing.entries()) {
  const source = nextNodeById.get(sourceId);
  if (!source) continue;
  const sorted = [...group].sort((a, b) => {
   const aData = readEdgeData(a);
   const bData = readEdgeData(b);
   return (
    (nodeY.get(a.target) ?? 0) - (nodeY.get(b.target) ?? 0) ||
    Number(aData.outputOrder ?? 9999) - Number(bData.outputOrder ?? 9999) ||
    String(aData.itemId ?? '').localeCompare(String(bData.itemId ?? '')) ||
    a.target.localeCompare(b.target)
   );
  });

  const sourceHandles: Array<PlannerHandleData & { side?: PlannerHandleSide }> = [];
  for (const side of sideOrder) {
   const sideEdges = sorted.filter((edge) => edgeSourceSide(nextEdgeById.get(edge.id) ?? edge) === side);
   sideEdges.forEach((edge, index) => {
    const nextEdge = nextEdgeById.get(edge.id);
    const data = nextEdge ? readEdgeData(nextEdge) : readEdgeData(edge);
    const id = side === 'right' ? 's' + sourceHandles.length : 's-' + side + '-' + index;
    if (nextEdge) nextEdge.sourceHandle = id;
    sourceHandles.push({
     id,
     topPct: ((index + 1) / (sideEdges.length + 1)) * 100,
     color: String(data.color ?? '#7dc4ff'),
     side,
    });
   });
  }
  source.data = { ...(source.data ?? {}), sourceHandles };
 }

 return { nodes: nextNodes, edges: nextEdges };
}

function applyCompletedStateToNodes(nodes: Node[], completedGraphNodeIds: Record<string, boolean>): Node[] {
  return nodes.map((node) => {
    const completed = completedGraphNodeIds[node.id] ?? false;
    const data = node.data as Record<string, unknown> | undefined;
    if ((data?.completed ?? false) === completed) return node;
    return {
      ...node,
      data: {
        ...(node.data ?? {}),
        completed,
      },
    };
  });
}


function collectLiveGraphStyleText(): string {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n');
      } catch {
        return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

function graphPngTimestamp(): string {
  const d = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function escapeSvgText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function buildGraphElementFile(lang: Lang): Promise<{ extension: 'png' | 'svg'; blob: Blob }> {
  const element = document.querySelector('.flow-wrap') as HTMLElement | null;
  if (!element) throw new Error('Graph element was not found.');

  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch {
      // Font readiness is a visual improvement only.
    }
  }

  const rect = element.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  if (width <= 1 || height <= 1) throw new Error('Graph element is not visible.');

  const clone = element.cloneNode(true) as HTMLElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  clone.style.width = width + 'px';
  clone.style.height = height + 'px';
  clone.style.margin = '0';
  clone.style.position = 'relative';
  clone.querySelectorAll('.react-flow__panel').forEach((panel) => panel.remove());

  const styleText = collectLiveGraphStyleText().replace(/\]\]>/g, ']]\\>');
  const serializedClone = new XMLSerializer().serializeToString(clone);
  const xhtml = '<style><![CDATA[' + styleText + ']]></style>' + serializedClone;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '" aria-label="' +
    escapeSvgText(lang === 'ja' ? 'グラフ' : 'Graph') +
    '"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">' +
    xhtml +
    '</div></foreignObject></svg>';

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Failed to render live graph image'));
    });
    image.src = svgUrl;
    await loaded;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.fillStyle = '#080d15';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0);

    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to create PNG'));
      }, 'image/png');
    });

    return { extension: 'png', blob: pngBlob };
  } catch (error) {
    console.warn(
      lang === 'ja'
        ? 'グラフ保存のPNG生成に失敗したためSVGを使用します。'
        : 'Failed to create graph PNG. Using SVG instead.',
      error,
    );
    return { extension: 'svg', blob: svgBlob };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function saveGraphElementAsPng(lang: Lang) {
  const timestamp = graphPngTimestamp();
  const file = await buildGraphElementFile(lang);
  downloadBlob(file.blob, 'alchemy-factory-calculator-graph-live-' + timestamp + '.' + file.extension);
}

function GraphControls({ lang, isInteractive, onToggleInteractive }: GraphControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const labels =
    lang === 'ja'
      ? { zoomIn: '拡大', zoomOut: '縮小', fit: '全体表示', lock: isInteractive ? '操作を固定' : '操作固定を解除' }
      : { zoomIn: 'Zoom in', zoomOut: 'Zoom out', fit: 'Fit view', lock: isInteractive ? 'Lock interaction' : 'Unlock interaction' };

  return (
    <Panel position="bottom-left" className="flow-custom-controls">
      <button type="button" className="flow-custom-control" title={labels.zoomIn} aria-label={labels.zoomIn} onClick={() => zoomIn({ duration: 160 })}><ZoomInIcon /></button>
      <button type="button" className="flow-custom-control" title={labels.zoomOut} aria-label={labels.zoomOut} onClick={() => zoomOut({ duration: 160 })}><ZoomOutIcon /></button>
      <button type="button" className="flow-custom-control" title={labels.fit} aria-label={labels.fit} onClick={() => fitView({ padding: 0.18, duration: 220 })}><FitIcon /></button>
      <button type="button" className={isInteractive ? 'flow-custom-control' : 'flow-custom-control is-active'} title={labels.lock} aria-label={labels.lock} aria-pressed={!isInteractive} onClick={onToggleInteractive}>
        {isInteractive ? <UnlockIcon /> : <LockIcon />}
      </button>
    </Panel>
  );
}

export function GraphTab({ lang, result, settings, completedGraphNodeIds, onToggleCompleted, debug = false }: GraphTabProps) {
  const flowRef = useRef<ReactFlowInstance | null>(null);
  const latestLayoutId = useRef(0);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isInteractive, setIsInteractive] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const completedRef = useRef(completedGraphNodeIds);

  const graphResult = useMemo(
    () =>
      result.calculationStatus === 'invalid'
        ? { ...result, flows: result.flows.filter(isFiniteGraphFlow) }
        : result,
    [result],
  );
  const graphErrorLines = useMemo(() => graphInvalidLines(result, lang), [result, lang]);
  useEffect(() => {
    const onSaveGraph = () => {
      void saveGraphElementAsPng(lang);
    };
    window.addEventListener('alchemyfactory:save-live-graph', onSaveGraph);
    return () => window.removeEventListener('alchemyfactory:save-live-graph', onSaveGraph);
  }, [lang]);

  useEffect(() => {
    const onCaptureGraph = (event: Event) => {
      const detail = (event as CustomEvent<{
        resolve?: (file: { extension: 'png' | 'svg'; blob: Blob }) => void;
        reject?: (error: unknown) => void;
      }>).detail;
      if (!detail?.resolve) return;
      void buildGraphElementFile(lang).then(detail.resolve, detail.reject);
    };
    window.addEventListener('alchemyfactory:capture-live-graph', onCaptureGraph);
    return () => window.removeEventListener('alchemyfactory:capture-live-graph', onCaptureGraph);
  }, [lang]);
  const raw = useMemo(() => buildFlowGraph(graphResult, lang, settings, {}), [graphResult, lang, settings]);

  useEffect(() => {
    completedRef.current = completedGraphNodeIds;
    setNodes((current) => applyCompletedStateToNodes(current, completedGraphNodeIds));
  }, [completedGraphNodeIds]);

  useEffect(() => {
    let disposed = false;
    const layoutId = latestLayoutId.current + 1;
    const total = raw.nodes.length + raw.edges.length;
    const showUpdating = total >= UPDATE_OVERLAY_THRESHOLD;
    const startedAt = performance.now();
    latestLayoutId.current = layoutId;

    if (showUpdating) {
      setIsUpdating(true);
      setNodes([]);
      setEdges([]);
    } else {
      setIsUpdating(false);
    }

    layoutWithElk(raw.nodes, raw.edges)
      .then((layouted) => {
        if (disposed || latestLayoutId.current !== layoutId) return;
        const positionById = new Map(layouted.map((node) => [node.id, node.position]));
        const fresh = buildFlowGraph(graphResult, lang, settings, {});
        const positionedNodes = fresh.nodes.map((node) => ({ ...node, position: positionById.get(node.id) ?? node.position }));
        const realigned = realignIncomingHandlesBySourceY(positionedNodes, fresh.edges);
        const layoutMs = Math.round(performance.now() - startedAt);

        setNodes(applyCompletedStateToNodes(realigned.nodes, completedRef.current));
        setEdges(realigned.edges);
        setIsUpdating(false);

        if (debug) {
          const discardNodes = realigned.nodes.filter((node) => node.data?.kind === 'discard').length;
          const recipeNodes = realigned.nodes.filter((node) => node.data?.kind === 'recipe').length;
          console.info(`[graph] nodes=${realigned.nodes.length} edges=${realigned.edges.length} total=${realigned.nodes.length + realigned.edges.length} layout=${layoutMs}ms updating=${showUpdating} recipeNodes=${recipeNodes} discardNodes=${discardNodes}`);
        }

        requestAnimationFrame(() => requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.18, duration: 220, maxZoom: 1 })));
      })
      .catch((error: unknown) => {
        if (disposed || latestLayoutId.current !== layoutId) return;
        setNodes(applyCompletedStateToNodes(raw.nodes, completedRef.current));
        setEdges(raw.edges);
        setIsUpdating(false);
        if (debug) console.warn('[graph] layout failed', error);
        requestAnimationFrame(() => requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.18, duration: 220, maxZoom: 1 })));
      });

    return () => {
      disposed = true;
    };
  }, [raw, graphResult, lang, settings, debug]);

  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    if (isInteractive) onToggleCompleted(node.id);
  };

  return (
    <div className="graph-tab">
      <div className="flow-wrap">
        {result.calculationStatus === 'invalid' && (
          <div className="graph-error-panel" role="alert">
            <strong>{graphInvalidTitle(lang)}</strong>
            {graphErrorLines.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        )}
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(instance: any) => {
            flowRef.current = instance;
            requestAnimationFrame(() => instance.fitView({ padding: 0.18, duration: 0, maxZoom: 1 }));
          }}
          onNodesChange={(changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current))}
          onEdgesChange={(changes: EdgeChange[]) => setEdges((current) => applyEdgeChanges(changes, current))}
          onNodeDoubleClick={onNodeDoubleClick}
          nodesDraggable={isInteractive}
          nodesConnectable={false}
          elementsSelectable={isInteractive}
          panOnDrag={isInteractive}
          zoomOnScroll={isInteractive}
          zoomOnPinch={isInteractive}
          zoomOnDoubleClick={isInteractive}
          minZoom={0.03}
          maxZoom={2.5}
          fitView={false}
        >
          <Background color="#243047" gap={18} />
          <GraphControls lang={lang} isInteractive={isInteractive} onToggleInteractive={() => setIsInteractive((current) => !current)} />
          <MiniMap
            nodeStrokeWidth={2}
            pannable
            zoomable
            nodeColor={(node) => {
              if (node.data?.kind === 'final') return '#9fe870';
              if (node.data?.kind === 'discard') return '#ffd27d'; if (node.data?.kind === 'surplus') return '#ffd27d';
              return node.data?.kind === 'recipe' ? '#5d4ba2' : '#28618f';
            }}
            maskColor="rgba(5, 7, 12, 0.68)"
            style={{ background: '#111722', border: '1px solid #2d3546', borderRadius: 10 }}
          />
        </ReactFlow>

        {isUpdating && (
          <div className="graph-updating" role="status" aria-live="polite">
            <span className="graph-spinner" aria-hidden="true" />
            <span>{lang === 'ja' ? '更新中' : 'Updating'}...</span>
          </div>
        )}
      </div>
    </div>
  );
}
