export * from './legacyCalculate';

import {
  buildLinearModelDiagnostics,
  buildNewSolverResultFromLegacy,
  buildSolverComparisonFromResults,
} from './newSolver';
import {
  calculate as calculateLegacy,
  calculateWithDebug as calculateLegacyWithDebug,
  type CalculateInput,
  type CalculationDebugResult,
  type CalculationResult,
} from './legacyCalculate';

export function calculate(input: CalculateInput): CalculationResult {
  // v0.7.0-alpha.1 keeps normal runtime calculation fully legacy-compatible and cheap.
  // New solver diagnostics/comparison are generated only by calculateWithDebug() for log export.
  return calculateLegacy(input);
}

export function calculateWithDebug(input: CalculateInput): CalculationDebugResult {
  const legacyDebug = calculateLegacyWithDebug(input);
  const linearModelDiagnostics = buildLinearModelDiagnostics(input);
  const newSolverResult = buildNewSolverResultFromLegacy(legacyDebug.result, linearModelDiagnostics);
  const solverComparison = buildSolverComparisonFromResults(
    legacyDebug.result,
    newSolverResult.result,
    linearModelDiagnostics,
  );
  return {
    result: legacyDebug.result,
    debugLog: {
      ...legacyDebug.debugLog,
      solverEngine: newSolverResult.engineId,
      linearModelDiagnostics,
      solverComparison,
    } as CalculationDebugResult['debugLog'] & {
      solverEngine: typeof newSolverResult.engineId;
      linearModelDiagnostics: typeof linearModelDiagnostics;
      solverComparison: typeof solverComparison;
    },
  };
}
