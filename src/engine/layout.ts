import ELK from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';
import type { PlannerNodeData } from './graph';

const elk = new ELK();

export async function layoutWithElk(nodes: Node<PlannerNodeData>[], edges: Edge[]): Promise<Node<PlannerNodeData>[]> {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: nodes.map((node) => ({ id: node.id, width: 220, height: node.data.kind === 'recipe' ? 108 : 96 })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };

  const result = await elk.layout(graph);
  const positions = new Map((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]));
  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}
