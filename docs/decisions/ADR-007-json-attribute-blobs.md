# ADR-007: Product and Variant Attributes as Unstructured JSON

- Date: 2026-05-17
- Status: Accepted (deferred typed-column migration)

## Problem

`Product.attributes` and `Variant.attributes` are typed `Json` in `packages/db/prisma/schema.prisma`. Values are not constrained at the database level. The compliance-rules system (`ComplianceRule`, `ValidationIssue`) provides value-level validation in the application layer, but the database accepts arbitrary JSON shape and content.

## Options Considered

1. Migrate frequently-used attributes (e.g., color, material, size) to typed columns or a per-attribute table.
2. Keep `Json`, rely on compliance rules.
3. Switch to a typed `JsonSchema` validation at the API layer with stored schemas per category.

## Decision

Option 2 for the current pilot scope. We are not migrating to typed columns at pilot scale.

## Consequences

Positive:
- Maximum flexibility for category-specific attribute schemas.
- New categories ship without migrations.
- The compliance rules layer is sufficient for required-field, regex, and value-in-set validation.

Negative / mitigations:
- Data-quality liability grows with catalog volume — no DB constraint on data shape.
- BI / analytics queries against these fields are awkward — requires extraction with `->>` operators.
- No type safety in TypeScript layer beyond `Record<string, unknown>` interpretation.

## Revisit when

- More than three data-quality incidents in a quarter are traceable to unenforced JSON shape.
- We move to a category with strict regulatory attribute schemas (medical devices, pharma, automotive parts).
- BI / analytics workloads against attributes become a recurring engineering complaint.
- Customer count exceeds 50 and per-tenant schema customization becomes a sales lever.

When revisited, Option 3 (per-category JSONSchema validation at API layer) is the preferred next step, not Option 1 (typed columns).
