# SOURCE_AUDIT_v09150

## Purpose

v0.9.15 fixes recipe rate balance for probabilistic outputs and recipes where the same item appears in both inputs and outputs.

## Key decisions

- `probability` omitted in recipe outputs means 100%.
- Probabilistic outputs are calculated as expected output: `amount * (probability ?? 1)`.
- Solver shortage/surplus decisions are based on per-item rate balance, not on raw output membership.
- A recipe is a producer for an item only when the item increases on balance.
- A target recipe whose selected output does not increase on balance is invalid with `NET_OUTPUT_NOT_POSITIVE`.
- `RecipeStat` now includes `netRates` in addition to gross `inputRates` and `outputRates` for debug visibility.

## Data fixes

- `steel_ingot_and_iron_ingot` outputs are now steel 25% and iron 75%.
- Known probabilistic Athanor / Advanced Athanor recipes were audited and given explicit probabilities only where probability is not 100%.

## Verification additions

- Probability output expected-rate audit.
- Steel/iron same-item input/output rate balance.
- Invalid iron target using steel/iron recipe.
- Lapis/shattered/crude shard same-item input/output rate balance.
- Invalid crude shard target using lapis/shattered/crude shard recipe.
- Known game-rate check for steel/iron at factory efficiency 5.
