// @ts-nocheck
import type { NodeProps } from '@xyflow/react';
import type { PlannerNodeData } from '../engine/graph';

export function PlannerNode({ data }: NodeProps) {
  const nodeData = data as PlannerNodeData;
  return (
    <div className={`planner-node planner-node-${nodeData.kind} ${nodeData.completed ? 'is-completed' : ''}`}>
      <div className="planner-node-title">{nodeData.completed ? '✓ ' : ''}{nodeData.label}</div>
      {nodeData.subLabel && <pre className="planner-node-subtitle">{nodeData.subLabel}</pre>}
    </div>
  );
}
