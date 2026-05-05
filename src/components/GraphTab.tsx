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

function readEdgeData(edge: Edge): EdgeData {
  return (edge.data ?? {}) as EdgeData;
}

function getCyclePath(sourceX: number, sourceY: number, targetX: number, targetY: number, side: number) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const nx = -dy / length;
  const ny = dx / length;
  const offset = 92 * side;
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

function realignIncomingHandlesBySourceY(nodes: Node[], edges: Edge[]) {
  const incoming = new Map<string, Edge[]>();
  const nodeY = new Map(nodes.map((node) => [node.id, node.position.y]));
  const nextNodes = nodes.map((node) => ({ ...node, data: { ...(node.data ?? {}) } }));
  const nextNodeById = new Map(nextNodes.map((node) => [node.id, node]));
  const nextEdges = edges.map((edge) => ({ ...edge, data: { ...(edge.data ?? {}) } }));
  const nextEdgeById = new Map(nextEdges.map((edge) => [edge.id, edge]));

  for (const edge of edges) {
    const group = incoming.get(edge.target) ?? [];
    group.push(edge);
    incoming.set(edge.target, group);
  }

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

    const sideOrder: PlannerHandleSide[] = ['top', 'left', 'right', 'bottom'];
  const targetHandles: Array<{ id: string; topPct: number; color: string; side?: PlannerHandleSide }> = [];

  for (const side of sideOrder) {
   const sideEdges = sorted.filter((edge) => edgeTargetSide(nextEdgeById.get(edge.id) ?? edge) === side);
   sideEdges.forEach((edge, index) => {
    const nextEdge = nextEdgeById.get(edge.id);
    const data = nextEdge?.data as Record<string, unknown> | undefined;
    const id = side === 'left' ? 't' + targetHandles.length : 't-' + side + '-' + index;
    if (nextEdge) nextEdge.targetHandle = id;
    targetHandles.push({
     id,
     topPct: ((index + 1) / (sideEdges.length + 1)) * 100,
     color: String(data?.color ?? '#7dc4ff'),
     side,
    });
   });
  }

  target.data = { ...(target.data ?? {}), targetHandles };
  }

  return { nodes: nextNodes, edges: nextEdges };
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
  const raw = useMemo(() => buildFlowGraph(result, lang, settings, completedGraphNodeIds), [result, lang, settings, completedGraphNodeIds]);

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
        const fresh = buildFlowGraph(result, lang, settings, completedGraphNodeIds);
        const positionedNodes = fresh.nodes.map((node) => ({ ...node, position: positionById.get(node.id) ?? node.position }));
        const realigned = realignIncomingHandlesBySourceY(positionedNodes, fresh.edges);
        const layoutMs = Math.round(performance.now() - startedAt);

        setNodes(realigned.nodes);
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
        setNodes(raw.nodes);
        setEdges(raw.edges);
        setIsUpdating(false);
        if (debug) console.warn('[graph] layout failed', error);
        requestAnimationFrame(() => requestAnimationFrame(() => flowRef.current?.fitView({ padding: 0.18, duration: 220, maxZoom: 1 })));
      });

    return () => {
      disposed = true;
    };
  }, [raw, result, lang, settings, completedGraphNodeIds, debug]);

  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    if (isInteractive) onToggleCompleted(node.id);
  };

  return (
    <div className="graph-tab">
      <div className="flow-wrap">
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
              if (node.data?.kind === 'discard') return '#ffd27d';
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
