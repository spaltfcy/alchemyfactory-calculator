import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { PlannerNodeData } from '../engine/graph';

function handleStyle(topPct: number, color: string) {
  return {
    top: `${topPct}%`,
    background: color,
    borderColor: '#d9ecff',
  };
}

export function PlannerNode({ data }: NodeProps) {
  const nodeData = data as PlannerNodeData;
  const kind = nodeData.kind ?? 'item';
  const targetHandles = nodeData.targetHandles?.length
    ? nodeData.targetHandles
    : [{ id: 'target-default', topPct: 50, color: '#7dc4ff' }];
  const sourceHandles = nodeData.sourceHandles?.length
    ? nodeData.sourceHandles
    : [{ id: 'source-default', topPct: 50, color: '#7dc4ff' }];

  return (
    <div
      className={`planner-node planner-node-${kind}${nodeData.completed ? ' is-completed' : ''}`}
      title={nodeData.tooltip}
    >
      {targetHandles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="target"
          position={Position.Left}
          style={handleStyle(handle.topPct, handle.color)}
        />
      ))}

      <div className="planner-node-title">
        {nodeData.completed ? '✓ ' : ''}
        {nodeData.label}
      </div>
      {nodeData.subLabel && <pre className="planner-node-subtitle">{nodeData.subLabel}</pre>}

      {sourceHandles.map((handle) => (
        <Handle
          key={handle.id}
          id={handle.id}
          type="source"
          position={Position.Right}
          style={handleStyle(handle.topPct, handle.color)}
        />
      ))}
    </div>
  );
}
