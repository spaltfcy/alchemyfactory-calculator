export * from './legacyCalculate';

import {
  buildLinearModelDiagnostics,
  buildSolverComparisonFromResults,
  calculateWithNewSolver,
} from './newSolver';
import {
  calculateWithDebug as calculateLegacyWithDebug,
  type CalculateInput,
  type CalculationDebugResult,
  type CalculationResult,
} from './legacyCalculate';

export function calculate(input: CalculateInput): CalculationResult {
  return calculateWithNewSolver(input).result;
}

export function calculateWithDebug(input: CalculateInput): CalculationDebugResult {
  const legacyDebug = calculateLegacyWithDebug(input);
  const linearModelDiagnostics = buildLinearModelDiagnostics(input);
  const newSolverResult = calculateWithNewSolver(input);
  const solverComparison = buildSolverComparisonFromResults(
    legacyDebug.result,
    newSolverResult.result,
    linearModelDiagnostics,
  );
  return {
    result: newSolverResult.result,
    debugLog: {
      ...legacyDebug.debugLog,
      resultEngine: newSolverResult.engineId,
      solverEngine: newSolverResult.engineId,
      linearModelDiagnostics,
      solverComparison,
      alphaLinearTrace: newSolverResult.alphaLinearTrace,
    } as CalculationDebugResult['debugLog'] & {
      resultEngine: typeof newSolverResult.engineId;
      solverEngine: typeof newSolverResult.engineId;
      linearModelDiagnostics: typeof linearModelDiagnostics;
      solverComparison: typeof solverComparison;
      alphaLinearTrace: typeof newSolverResult.alphaLinearTrace;
    },
  };
}
