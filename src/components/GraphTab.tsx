// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
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

export function GraphTab({ lang, result, settings, completedGraphNodeIds, onToggleCompleted }: GraphTabProps) {
  const raw = useMemo(
    () => buildFlowGraph(result, lang, settings, completedGraphNodeIds),
    [result, lang, settings, completedGraphNodeIds],
  );
  const [nodes, setNodes] = useState<Node<PlannerNodeData>[]>(raw.nodes);
  const [edges, setEdges] = useState<Edge[]>(raw.edges);

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
          fitView
          fitViewOptions={{ padding: 0.95, maxZoom: 0.38, minZoom: 0.18 }}
          minZoom={0.12}
          maxZoom={2}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="#2b3547" />
          <Controls />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node) => (node.data?.kind === 'recipe' ? '#5d4ba2' : '#28618f')}
            maskColor="rgba(5, 7, 12, 0.68)"
            style={{ background: '#111722', border: '1px solid #2d3546', borderRadius: 10 }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
