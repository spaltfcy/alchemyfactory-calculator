import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { PlannerHandleSide, PlannerNodeData } from '../engine/graph';

function handlePosition(side: PlannerHandleSide | undefined, fallback: PlannerHandleSide): Position {
 const nextSide = side ?? fallback;
 if (nextSide === 'top') return Position.Top;
 if (nextSide === 'bottom') return Position.Bottom;
 if (nextSide === 'right') return Position.Right;
 return Position.Left;
}

function handleStyle(
 topPct: number,
 color: string,
 side: PlannerHandleSide | undefined,
 fallback: PlannerHandleSide,
): CSSProperties {
 const nextSide = side ?? fallback;
 const base: CSSProperties = {
  background: color,
  borderColor: '#d9ecff',
 };
 if (nextSide === 'top' || nextSide === 'bottom') return { ...base, left: String(topPct) + '%' };
 return { ...base, top: String(topPct) + '%' };
}

export function PlannerNode({ data }: NodeProps) {
  const nodeData = data as PlannerNodeData;
  const kind = nodeData.kind ?? 'item';
  const targetHandles = nodeData.targetHandles ?? [];
  const sourceHandles = nodeData.sourceHandles ?? [];

  return (
    <div
      className={`planner-node planner-node-${kind}${nodeData.completed ? ' is-completed' : ''}${nodeData.isFuelSource ? ' is-fuel-source' : ''}`}
      title={nodeData.tooltip}
    >
      {targetHandles.map((handle) => (
        <Handle key={handle.id} id={handle.id} type="target" position={handlePosition(handle.side, 'left')} style={handleStyle(handle.topPct, handle.color, handle.side, 'left')} />
      ))}

      <div className="planner-node-title-line">
  <div className="planner-node-title">
   {nodeData.completed ? '✓ ' : ''}
   {nodeData.label}
  </div>
  {nodeData.badges && nodeData.badges.length > 0 && (
   <div className="planner-node-badges">
    {nodeData.badges.map((badge) => (
     <span key={badge.label} className={'planner-node-badge planner-node-badge-' + (badge.tone ?? 'info')}>
      {badge.label}
     </span>
    ))}
   </div>
  )}
 </div>
      {nodeData.subLabel && <pre className="planner-node-subtitle">{nodeData.subLabel}</pre>}

      {sourceHandles.map((handle) => (
        <Handle key={handle.id} id={handle.id} type="source" position={handlePosition(handle.side, 'right')} style={handleStyle(handle.topPct, handle.color, handle.side, 'right')} />
      ))}
    </div>
  );
}
