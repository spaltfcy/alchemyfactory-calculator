# SOURCE_AUDIT_v09190

## Scope

v0.9.19 fixes the confusing DEBUG artifacts left after v0.9.18. The accepted calculation path remains the structured solver result; this version removes the stale legacy-alpha numeric comparison from the DEBUG execution path and clarifies recipe-level heat audit fields.

## Root cause addressed

- `legacy-alpha-comparison` and `planner-comparison` were generated from an old solver path. That legacy path did not follow the current thermal extractor height multiplier and alchemy output multiplier semantics, so it produced `diff` records even when the accepted structured result was correct.
- `heatRequiredByRecipe.heatPerRun` was ambiguous. It represented heat divided by effective runs after modifiers, not the base recipe heat per run.

## Implementation changes

- `calculateWithNewSolver()` is no longer called from `solvePlan(..., { debug: true })`.
- `materialPlannerShadow.comparison` is now a `status: "not-compared"` structured-adoption artifact, not a legacy-alpha numeric diff.
- `legacyAlphaComparison` is kept only as a disabled marker:
  - `enabled: false`
  - `legacyCalled: false`
  - `mode: "legacy-alpha-disabled-v09190"`
- Batch ZIP export no longer writes `__legacy-alpha-comparison.json` unless a real legacy comparison was executed.
- `solver.debugLegacyAlphaCalled` is now `false`.
- `debugSchemaVersion` is `42`.
- `heatRequiredByRecipe` now records explicit heat fields:
  - `heatPerSecond`
  - `heatPerMachinePerMinute`
  - `baseHeatPerRun`
  - `effectiveHeatPerRun`
  - `heatRequiredPerMin`
- The ambiguous `heatPerRun` audit field was removed from new DEBUG output.

## Expected thermal extractor values

For `brine` with a thermal extractor:

- `heatPerSecond = 80`
- `heatPerMachinePerMinute = 4800`
- `baseHeatPerRun = 320` because the recipe is 4 seconds at 80P/s
- at height 256, `runsPerMinute = 45`
- `effectiveHeatPerRun = 4800 / 45 = 106.6666666667`
- `heatRequiredPerMin = 4800`

## Build checks performed in this environment

- `npm install`: passed
- `npm run build`: passed
  - `validate:data`: passed
  - `tsc -b`: passed
  - `vite build`: passed
  - Vite chunk-size warning remains present and unchanged in nature.
