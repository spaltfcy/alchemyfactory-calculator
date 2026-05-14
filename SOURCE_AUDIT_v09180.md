# SOURCE_AUDIT_v09180

## Scope

v0.9.18 fixes the debug/audit layer for thermal extractor and alchemy multiplier verification. It does not weaken verification expectations; it exposes the missing calculation evidence so the existing strict checks can inspect the real values.

## Root cause addressed

- `RecipeStat` already carried effective-rate multiplier details, but `buildEffectiveRecipeRateAudit()` did not copy them into `effectiveRecipeRateAudit`.
- `heatRequiredPerMin` is a total including upstream internal production heat. A test that wants the thermal extractor recipe itself must inspect recipe-level heat, not the total.

## Checked implementation points

- `APP_VERSION` and `package.json` are `0.9.18`.
- `debugSchemaVersion` is `41` because debug JSON now includes recipe-level heat audit data.
- Solver/version strings use `v09180` / `0.9.18`.
- `effectiveRecipeRateAudit` now exposes:
  - `factorySpeedMultiplier`
  - `thermalHeightMultiplier`
  - `thermalExtractorHeight`
  - `thermalExtractorBonusPercent`
  - `alchemyOutputMultiplier`
  - `effectiveOutputPerMinuteMultiplier`
- Debug logs now include `heatRequiredByRecipe` keyed by recipe ID.
- `heatRequiredByRecipe` records:
  - `recipeId`
  - `machineId`
  - `theoreticalMachines`
  - `actualMachines`
  - `runsPerMinute`
  - `runsPerMachinePerMinute`
  - `heatPerSecond`
  - `heatConsumptionMultiplier`
  - `heatPerRun`
  - `heatRequiredPerMin`
- Batch verification expectations now support `expectedHeatRequiredByRecipe`.
- `expectedEffectiveRecipeRateValues` can also check `factorySpeedMultiplier`.
- Existing solver demand resolution, probability output, same-item net I/O, cycle input, and byproduct-fuel logic were not reworked in this version.

## Build checks performed in this environment

- `npm install`: passed
- `npm run build`: passed
  - `validate:data`: passed
  - `tsc -b`: passed
  - `vite build`: passed
  - Vite chunk-size warning remains present and unchanged in nature.

## Notes for verification JSON updates

For thermal extractor heat checks, prefer this structure instead of asserting the total heat as `4800`:

```json
{
  "expectedHeatRequiredByRecipe": {
    "brine": {
      "machineId": "thermal_extractor",
      "heatRequiredPerMin": 4800
    }
  }
}
```

The total `heatRequiredPerMin` may be higher when upstream internally produced materials also require heat.
