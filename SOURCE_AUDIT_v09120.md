# v0.9.12 Source Audit

Checked the v0.9.12 source against the agreed migration direction.

## Confirmed

- Normal calculation path uses `calculateStructuredBalance()` and `solveStructuredMaterialPlan()` and does not call legacy alpha/newSolver.
- `calculateWithNewSolver()` is called only in `solvePlan(..., { debug: true })` for legacy DEBUG comparison.
- `alphaBalanceSolver.ts` remains only as legacy comparison infrastructure through `newSolver.ts`; it is not part of the normal result path.
- Fixed alpha-style iteration limit was removed from the structured normal path. `structuredBalanceSolver.ts` now derives its queue guard from the active dependency graph size.
- Cycle input is represented as `cycleInput`, appears in `initialInvestment`, and is not mixed into per-minute purchase.
- Startup graph labels use startup wording and do not show `/min`.

## Remaining intentional scope

- Graph layout optimization is still DEBUG/fallback-only and is not promoted to the production Graph.
- Legacy alpha comparison is retained for DEBUG diffing until v1.0 stabilization.
