# SOURCE_AUDIT_v09160

## Scope

v0.9.16 stabilizes probability recipe validation and effective rate diagnostics after v0.9.15 introduced effective input/output rate balancing for probability outputs and same-item input/output recipes.

## Confirmed design

- `probability` omitted on a recipe output means 100%.
- Probability outputs are treated as expected values: `amount * (probability ?? 1)`.
- Same-item input/output recipes are balanced by item rate difference.
- `recipeStats.runsPerMinute` is the final solved run rate and may include upstream demand. It must not be used as a pure recipe-data audit when many recipes are targeted together.
- v0.9.16 verification splits probability recipe audits into isolated cases so target interactions do not invalidate one-machine expected rate checks.

## Deferred

- Thermal Energy Extractor height scaling.
- Alchemy Skill output bonus.
- Sol Japanese name update to ソーラ.
