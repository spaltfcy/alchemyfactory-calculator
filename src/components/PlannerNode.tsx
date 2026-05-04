import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PlannerNodeData } from '../engine/graph';

export function PlannerNode({ data }: NodeProps) {
  const nodeData = data as PlannerNodeData;
  const kind = nodeData.kind ?? 'item';

  return (
    <div className={`planner-node planner-node-${kind}${nodeData.completed ? ' is-completed' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="planner-node-title">
        {nodeData.completed ? '✓ ' : ''}
        {nodeData.label}
      </div>
      {nodeData.subLabel && <pre className="planner-node-subtitle">{nodeData.subLabel}</pre>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
