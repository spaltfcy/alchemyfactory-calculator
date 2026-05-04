// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  MiniMap,
  Panel,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
} from '@xyflow/react';
import type { AppSettings, Lang } from '../types';
import type { CalculationResult } from '../engine/calculate';
import { buildFlowGraph, type PlannerNodeData } from '../engine/graph';
import { layoutWithElk } from '../engine/layout';
import { PlannerNode } from './PlannerNode';

const nodeTypes = { plannerNode: PlannerNode };

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
        onClick={() => fitView({ padding: 0.16, duration: 220 })}
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
  const raw = useMemo(
    () => buildFlowGraph(result, lang, settings, completedGraphNodeIds),
    [result, lang, settings, completedGraphNodeIds],
  );

  const [nodes, setNodes] = useState<Node[]>(raw.nodes);
  const [edges, setEdges] = useState<Edge[]>(raw.edges);
  const [isInteractive, setIsInteractive] = useState(true);

  useEffect(() => {
    let disposed = false;

    setEdges(raw.edges);

    layoutWithElk(raw.nodes, raw.edges)
      .then((layouted) => {
        if (!disposed) setNodes(layouted);
      })
      .catch(() => {
        if (!disposed) setNodes(raw.nodes);
      });

    return () => {
      disposed = true;
    };
  }, [raw]);

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

  return (
    <div className="graph-tab">
      <div className="flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
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
          fitView
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
            nodeColor={(node) => (node.data?.kind === 'recipe' ? '#5d4ba2' : '#28618f')}
            maskColor="rgba(5, 7, 12, 0.68)"
            style={{
              background: '#111722',
              border: '1px solid #2d3546',
              borderRadius: 10,
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
