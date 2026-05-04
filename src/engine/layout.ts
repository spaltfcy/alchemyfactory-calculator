import ELK from 'elkjs/lib/elk.bundled.js';
import type { Edge, Node } from '@xyflow/react';
import type { PlannerNodeData } from './graph';

const elk = new ELK();

function nodeHeight(node: Node): number {
  const kind = (node.data as PlannerNodeData | undefined)?.kind;
  if (kind === 'recipe') return 104;
  if (kind === 'discard') return 82;
  return 92;
}

export async function layoutWithElk(nodes: Node[], edges: Edge[]): Promise<Node[]> {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '125',
      'elk.spacing.edgeNode': '92',
      'elk.layered.spacing.nodeNodeBetweenLayers': '210',
      'elk.layered.spacing.edgeNodeBetweenLayers': '110',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: 245,
      height: nodeHeight(node),
    })),
    edges: edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  };

  const result = await elk.layout(graph);
  const positions = new Map((result.children ?? []).map((child) => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }]));

  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position }));
}
