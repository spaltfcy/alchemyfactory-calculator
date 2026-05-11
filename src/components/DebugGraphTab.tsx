import { useMemo } from 'react';
import type { AppSettings, Lang } from '../types';
import type { CalculationResult } from '../engine/calculate';
import { GraphTab, type GraphFocusRequest } from './GraphTab';
import { buildFlowGraphDebugArtifacts } from '../engine/graph';

type DebugGraphTabProps = {
  lang: Lang;
  result: CalculationResult;
  settings: AppSettings;
  completedGraphNodeIds: Record<string, boolean>;
  onToggleCompleted: (nodeId: string) => void;
  focusRequest?: GraphFocusRequest;
};

function countFlows(result: CalculationResult, role: string): number {
  return result.flows.filter((flow) => flow.role === role).length;
}

export function DebugGraphTab({ lang, result, settings, completedGraphNodeIds, onToggleCompleted, focusRequest }: DebugGraphTabProps) {
  const metrics = useMemo(() => {
    const artifact = buildFlowGraphDebugArtifacts(result, lang, settings, completedGraphNodeIds, 'debug');
    return {
      nodes: artifact.metrics.nodeCount,
      edges: artifact.metrics.edgeCount,
      recipes: artifact.metrics.recipeNodes,
      finalNodes: artifact.metrics.finalNodes,
      surplusNodes: artifact.metrics.surplusNodes,
      discardNodes: artifact.metrics.discardNodes,
      fuelEdges: artifact.metrics.fuelEdges,
      fertilizerEdges: artifact.metrics.fertilizerEdges,
      steamEdges: artifact.metrics.steamEdges,
      crossings: artifact.metrics.estimatedCrossings + (artifact.metrics.estimatedCrossingsCapped ? '+' : ''),
      avgEdge: artifact.metrics.averageEdgeLength,
      maxEdge: artifact.metrics.maxEdgeLength,
      status: result.calculationStatus ?? 'ok',
    };
  }, [result, lang, settings, completedGraphNodeIds]);

  return (
    <div className="debug-graph-tab">
      <section className="panel debug-graph-panel">
        <div>
          <h2>Graph[DEBUG]</h2>
          <p>
            {lang === 'ja'
              ? '本番Graphとは別の実験用タブです。v0.9系ではここで新レイアウト・メトリクス・保存用SVGを育てます。'
              : 'Experimental graph tab. New layouts, metrics, and SVG dump support will be developed here during v0.9.'}
          </p>
        </div>
        <dl className="debug-graph-metrics">
          {Object.entries(metrics).map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="debug-graph-flow">
        <GraphTab
          lang={lang}
          result={result}
          settings={settings}
          completedGraphNodeIds={completedGraphNodeIds}
          onToggleCompleted={onToggleCompleted}
          focusRequest={focusRequest}
          debug
        />
      </div>
    </div>
  );
}
