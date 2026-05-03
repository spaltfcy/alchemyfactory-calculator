// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node, type NodeMouseHandler } from '@xyflow/react';
import type { AppSettings, Lang } from '../types';
import type { CalculationResult } from '../engine/calculate';
import { buildFlowGraph, type PlannerNodeData } from '../engine/graph';
import { layoutWithElk } from '../engine/layout';
import { PlannerNode } from './PlannerNode';
import { t } from '../i18n';

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

  return (
    <div className="graph-tab">
      <div className="graph-hint">{t('doubleClickHint', lang)}</div>
      <div className="flow-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeDoubleClick={onNodeDoubleClick}
          fitView
          minZoom={0.2}
          maxZoom={2}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}
