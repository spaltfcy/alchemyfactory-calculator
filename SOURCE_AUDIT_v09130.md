# SOURCE_AUDIT_v09130

- Version: 0.9.13
- Main goal: fix buyable fuel/fertilizer source handling and add verification cases for fuel cost and multi-output surplus behavior.
- Normal calculation path remains structured (`structured-material-v09130` / `structured-balance-v09130`).
- Legacy alpha is still DEBUG comparison only.
- Added role-specific source buckets: `fuelBuy` and `fertilizerBuy`.
- `fuelExternal` / `fertilizerExternal` remain zero-cost external supply.
- Internal fuel/fertilizer with no recipe but a buy price now resolves to role-specific buy buckets instead of ordinary material buy.
- Multi-output target initialization now aggregates same-recipe targets by output and uses the maximum required recipe run across outputs, avoiding double-counting co-products.
- Shortage expansion now projects newly-added recipe outputs within the same queue pass so co-products can satisfy later shortages in that pass.
- Verification expectations were expanded for source kinds, purchased items, purchase cost, unresolved items, and surplus-only/no-surplus assertions.
