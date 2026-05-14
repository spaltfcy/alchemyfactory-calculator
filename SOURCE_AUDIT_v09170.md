# SOURCE_AUDIT_v09170

## Scope

v0.9.17 adds thermal extractor height scaling, alchemy output bonuses, and the Japanese display-name correction for Sol.

## Checked implementation points

- `APP_VERSION` and `package.json` are `0.9.17`.
- `debugSchemaVersion` is `40`.
- Solver/version strings use `v09170` / `0.9.17`.
- Item/recipe `sol` keeps the same ID and English name, while Japanese display is `ソーラ`.
- `MachinePreferences` now includes `extractor: 'extractor' | 'thermal_extractor'`.
- Default thermal extractor height is `255`.
- Thermal extractor height bonus uses:
  - `bonusPercent = min(200, max(0, height) * 25 / 32)`
  - calculation is not rounded internally.
- Thermal extractor height multiplier is applied to recipe run speed only when the effective machine is `thermal_extractor`.
- Alchemy skill output multiplier is applied to output-per-run for:
  - `extractor`
  - `thermal_extractor`
  - `alembic`
  - `advanced_alembic`
- Alchemy skill does not multiply input-per-run.
- Thermal extractor height multiplier and alchemy output multiplier are multiplicative in one-machine output/min.
- `effectiveRecipeRateAudit` exposes multiplier breakdowns for verification.
- v0.9.16 effective recipe rate / probability / same item input-output behavior remains in the same calculation path.

## Build checks performed in this environment

- `npm run validate:data`: passed
- `npx tsc -b`: passed
- `npm run build`: reached Vite transform stage but timed out in this environment, matching previous large Vite behavior. Local/GitHub Actions should be used for final bundle confirmation.

## Verification additions

Added v0.9.17 verification cases:

- `055_item_name_solar_ja.json`
- `056_thermal_extractor_height_formula_0.json`
- `056_thermal_extractor_height_formula_1.json`
- `056_thermal_extractor_height_formula_31.json`
- `056_thermal_extractor_height_formula_255.json`
- `056_thermal_extractor_height_formula_256.json`
- `056_thermal_extractor_height_formula_258.json`
- `057_thermal_extractor_height_255_default.json`
- `058_thermal_extractor_reduces_machine_count.json`
- `059_thermal_extractor_requires_heat.json`
- `060_alchemy_skill_extractor_output.json`
- `061_alchemy_skill_alembic_output.json`
- `062_alchemy_skill_and_thermal_extractor_stack.json`
- `063_effective_rate_audit_with_thermal_and_alchemy.json`
