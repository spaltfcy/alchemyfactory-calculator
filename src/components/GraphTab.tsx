// @ts-nocheck
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
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react';
import type { AppSettings, Lang } from '../types';
import type { CalculationResult } from '../engine/calculate';
import { buildFlowGraph } from '../engine/graph';
import { layoutWithElk } from '../engine/layout';
import { PlannerNode } from './PlannerNode';

const nodeTypes = { plannerNode: PlannerNode };
const edgeTypes = { flowEdge: FlowEdge };

export type GraphTabProps = {
  lang: Lang;
  result: CalculationResult;
  settings: AppSettings;
  completedGraphNodeIds: Record<string, boolean>;
  onToggleCompleted: (nodeId: string) => void;
};

type GraphControlsProps = {
  lang: Lang;
  isInteractive: boolean;
  onToggleInteractive: () => void;
};

function getCyclePath(sourceX: number, sourceY: number, targetX: number, targetY: number, side: number) {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
  const nx = -dy / length;
  const ny = dx / length;
  const offset = 92 * side;
  const controlX = (sourceX + targetX) / 2 + nx * offset;
  const controlY = (sourceY + targetY) / 2 + ny * offset;
  const labelX = sourceX * 0.25 + controlX * 0.5 + targetX * 0.25;
  const labelY = sourceY * 0.25 + controlY * 0.5 + targetY * 0.25;

  return {
    path: `M ${sourceX},${sourceY} Q ${controlX},${controlY} ${targetX},${targetY}`,
    labelX,
    labelY,
  };
}

function FlowEdge(props) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style = {},
    markerEnd,
    data,
  } = props;

  const cycleSide = Number(data?.cycleSide ?? 0);
  let edgePath;
  let labelX;
  let labelY;

  if (cycleSide !== 0) {
    const cycle = getCyclePath(sourceX, sourceY, targetX, targetY, cycleSide);
    edgePath = cycle.path;
    labelX = cycle.labelX;
    labelY = cycle.labelY;
  } else {
    const result = getBezierPath({
      sourceX,
      sourceY,
      sourcePosition,
      targetX,
      targetY,
      targetPosition,
    });

    edgePath = result[0];
    labelX = result[1];
    labelY = result[2];
  }

  const labelShiftY = Number(data?.labelShiftY ?? 0);
  const rateLabel = data?.rateLabel ? String(data.rateLabel) : '';

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          className={rateLabel ? 'flow-edge-label' : 'flow-edge-label flow-edge-label-single'}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + labelShiftY}px)`,
            borderColor: data?.color ? `${data.color}77` : undefined,
          }}
        >
          <div className="flow-edge-label-item">{data?.itemName}</div>
          {rateLabel && <div className="flow-edge-label-rate">{rateLabel}</div>}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

// Inline SVG icons are hand-authored for this project.
// No external icon library SVG paths are copied here.
function ZoomInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="M15.2 15.2L20.5 20.5" />
      <path d="M10.5 7.35V13.65" />
      <path d="M7.35 10.5H13.65" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="M15.2 15.2L20.5 20.5" />
      <path d="M7.35 10.5H13.65" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.25 9V4.25H9" />
      <path d="M15 4.25H19.75V9" />
      <path d="M19.75 15V19.75H15" />
      <path d="M9 19.75H4.25V15" />
      <path d="M8.5 12H15.5" />
      <path d="M12 8.5V15.5" />
    </svg>
  );
}

function UnlockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10.25" width="13" height="9.25" rx="2" />
      <path d="M8.5 10.25V7.75C8.5 5.4 10.15 3.75 12.5 3.75C14.05 3.75 15.35 4.45 16.05 5.65" />
      <path d="M12 13.5V16.25" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10.25" width="13" height="9.25" rx="2" />
      <path d="M8.5 10.25V7.75C8.5 5.45 9.95 3.75 12 3.75C14.05 3.75 15.5 5.45 15.5 7.75V10.25" />
      <path d="M12 13.5V16.25" />
    </svg>
  );
}

function GraphControls({ lang, isInteractive, onToggleInteractive }: GraphControlsProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  const labels =
    lang === 'ja'
      ? {
          zoomIn: '拡大',
          zoomOut: '縮小',
          fit: '全体表示',
          lock: isInteractive ? '操作を固定' : '操作固定を解除',
        }
      : {
          zoomIn: 'Zoom in',
          zoomOut: 'Zoom out',
          fit: 'Fit view',
          lock: isInteractive ? 'Lock interaction' : 'Unlock interaction',
        };

  return (
    <Panel position="bottom-left" className="flow-custom-controls">
      <button
        type="button"
        className="flow-custom-control"
        title={labels.zoomIn}
        aria-label={labels.zoomIn}
        onClick={() => zoomIn({ duration: 160 })}
      >
        <ZoomInIcon />
      </button>

      <button
        type="button"
        className="flow-custom-control"
        title={labels.zoomOut}
        aria-label={labels.zoomOut}
        onClick={() => zoomOut({ duration: 160 })}
      >
        <ZoomOutIcon />
      </button>

      <button
        type="button"
        className="flow-custom-control"
        title={labels.fit}
        aria-label={labels.fit}
        onClick={() => fitView({ padding: 0.18, duration: 220 })}
      >
        <FitIcon />
      </button>

      <button
        type="button"
        className={isInteractive ? 'flow-custom-control' : 'flow-custom-control is-active'}
        title={labels.lock}
        aria-label={labels.lock}
        aria-pressed={!isInteractive}
        onClick={onToggleInteractive}
      >
        {isInteractive ? <UnlockIcon /> : <LockIcon />}
      </button>
    </Panel>
  );
}

export function GraphTab({
  lang,
  result,
  settings,
  completedGraphNodeIds,
  onToggleCompleted,
}: GraphTabProps) {
  const flowRef = useRef<any>(null);
  const latestLayoutId = useRef(0);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [isInteractive, setIsInteractive] = useState(true);
  const [isUpdating, setIsUpdating] = useState(true);

  const raw = useMemo(
    () => buildFlowGraph(result, lang, settings, completedGraphNodeIds),
    [result, lang, settings, completedGraphNodeIds],
  );

  useEffect(() => {
    let disposed = false;
    const layoutId = latestLayoutId.current + 1;
    latestLayoutId.current = layoutId;

    setIsUpdating(true);
    setNodes([]);
    setEdges([]);

    layoutWithElk(raw.nodes, raw.edges)
      .then((layouted) => {
        if (disposed || latestLayoutId.current !== layoutId) return;

        const layoutedRaw = buildFlowGraph(result, lang, settings, completedGraphNodeIds);
        const positionById = new Map(layouted.map((node) => [node.id, node.position]));

        setNodes(layoutedRaw.nodes.map((node) => ({ ...node, position: positionById.get(node.id) ?? node.position })));
        setEdges(layoutedRaw.edges);
        setIsUpdating(false);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            flowRef.current?.fitView?.({ padding: 0.18, duration: 220, maxZoom: 1 });
          });
        });
      })
      .catch(() => {
        if (disposed || latestLayoutId.current !== layoutId) return;

        setNodes(raw.nodes);
        setEdges(raw.edges);
        setIsUpdating(false);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            flowRef.current?.fitView?.({ padding: 0.18, duration: 220, maxZoom: 1 });
          });
        });
      });

    return () => {
      disposed = true;
    };
  }, [raw, result, lang, settings, completedGraphNodeIds]);

  const onNodeDoubleClick: NodeMouseHandler = (_, node) => {
    if (!isInteractive) return;
    onToggleCompleted(node.id);
  };

  const onNodesChange = (changes: NodeChange[]) => {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes));
  };

  const onEdgesChange = (changes: EdgeChange[]) => {
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges));
  };

  const updatingText = lang === 'ja' ? '更新中' : 'Updating';

  return (
    <div className="graph-tab">
      <div className="flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onInit={(instance) => {
            flowRef.current = instance;
            requestAnimationFrame(() => instance.fitView({ padding: 0.18, duration: 0, maxZoom: 1 }));
          }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
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
          <GraphControls
            lang={lang}
            isInteractive={isInteractive}
            onToggleInteractive={() => setIsInteractive((current) => !current)}
          />
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
            style={{
              background: '#111722',
              border: '1px solid #2d3546',
              borderRadius: 10,
            }}
          />
        </ReactFlow>

        {isUpdating && (
          <div className="graph-updating" role="status" aria-live="polite">
            <span className="graph-spinner" aria-hidden="true" />
            <span>{updatingText}...</span>
          </div>
        )}
      </div>
    </div>
  );
}
