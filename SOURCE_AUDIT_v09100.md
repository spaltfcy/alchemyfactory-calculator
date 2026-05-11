# v0.9.10 Source Audit

## Scope

Checked the v0.9.10 source for the agreed migration direction.

## Results

- `calculate()` / normal path uses `calculateStructuredBalance()` and `solveStructuredMaterialPlan()`.
- `calculateWithNewSolver()` / legacy alpha is called only inside `solvePlan(..., { debug: true })` for `legacyAlphaComparison`.
- `alphaBalanceSolver.ts` remains in the source tree for debug comparison through `newSolver.ts`.
- `structuredBalanceSolver.ts` is the normal-path structured balance implementation. It is currently a structured copy of the proven balance logic with renamed engine identity and a structural safety guard, so numerical compatibility is preserved while the normal path no longer calls `alphaBalanceSolver`.
- `cycleInput` initial investment is represented as startup input and is not mixed into per-minute purchased flow.
- User-visible old Graph[DEBUG] v0.9.5 wording was removed.

## Remaining technical note

`structuredBalanceSolver.ts` intentionally preserves the previous balance algorithm semantics for compatibility. Future optimization can replace the internal queue expansion with a stricter DAG/SCC solver, but v0.9.10 removes the direct normal-path dependency on `alphaBalanceSolver`.
