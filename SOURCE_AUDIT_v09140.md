# SOURCE_AUDIT_v09140

## Summary

v0.9.14 focuses on co-product reconciliation after internal fuel/fertilizer expansion and on debug-time detection of remaining supply-lot reuse issues.

## Confirmed changes

- Version strings updated to `0.9.14` / `v09140`.
- `structuredBalanceSolver` now runs a co-product reconciliation pass after special resource expansion.
- Multi-output recipe runs can be reduced when every output has surplus, while target-required runs are preserved.
- `structuredBalanceTrace.coProductReconciliation` records applied reductions.
- Debug validation now warns when a multi-output recipe has multiple surplus outputs.
- Debug validation now warns when the same item is consumed while a lot of that item is discarded.
- Verification expectations can assert no joint surplus groups and expected debug issue codes.

## Known limitation

The v0.9.14 reconciliation pass safely fixes overbuilt multi-output recipe runs after special-resource expansion, such as Gentian/Gentian Nectar and World Tree Leaf/Core. It intentionally does not perform broad single-output run substitution, because an aggressive version caused unresolved roots in large regression data. Remaining global lot-reassignment issues are detected via debug warnings and can be addressed in a later, more targeted planner pass.
