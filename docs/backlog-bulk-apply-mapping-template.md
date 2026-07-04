# BACKLOG: Bulk Apply Mapping Template to Selected Categories

**Status:** Backlog (NOT scheduled for implementation)
**Priority:** P3 — Nice-to-have power-user optimization
**Prerequisite:** Existing default-mapping-for-all-categories workflow must be fully adopted by customers first.

## Context

Vexa PIM already supports **default connector mapping across all categories with category-level overrides**. The existing architecture covers the primary use case:

1. **Tenant connector default** (`mappingLevel: "tenant_connector_default"`, `categoryScope: "*"`) applies a single mapping to ALL categories.
2. **Category-specific overrides** (`mappingLevel: "tenant_connector_category_mapping"`) override the default for individual categories that need custom field mappings.

This backlog item describes an **optional enhancement** for power users who need to apply a mapping template to a *subset* of categories in one action — a workflow that falls between "apply to all" and "configure one at a time."

## User Story

> As a catalog manager with 50+ categories on Amazon, I want to select 10 specific categories and apply a shared mapping template to them simultaneously, so that I don't need to create 10 individual category overrides manually when the default mapping doesn't suit a specific cluster.

## Acceptance Criteria (when implemented)

- [ ] UI: Multi-select categories from the taxonomy list
- [ ] UI: Choose a mapping template (either from an existing published version or from a draft)
- [ ] API: `POST /marketplace/connectors/:connectorSlug/mappings/versions/bulk-apply` creates individual `tenant_connector_category_mapping` versions for each selected category
- [ ] Each created version is in `draft` state (not auto-published)
- [ ] Existing category overrides are NOT overwritten — the user must archive them first
- [ ] The operation is idempotent — re-applying to already-mapped categories returns a warning, not an error
- [ ] Tenant isolation enforced (same as all mapping endpoints)
- [ ] Step-up auth NOT required for bulk draft creation (only required at publish time per existing rules)
- [ ] Audit log records the bulk operation with all affected category IDs

## Why This Is Backlog (Not Now)

1. **The default mapping already covers the 90% case.** Most tenants map all categories identically.
2. **Category overrides exist today** for the remaining 10% of categories that need custom mappings.
3. **No customer has requested this workflow** — it's a hypothetical optimization.
4. **The implementation is non-trivial** — it requires new UI (multi-select taxonomy picker), new endpoint, new validation, and careful UX to avoid confusion with the existing default-vs-override model.
5. **Risk of overbuilding** — adding this before customer demand creates UI complexity that may confuse users who only need the default + override pattern.

## When to Promote to Active

- Multiple customers report they have 10+ categories that need identical non-default mappings
- The existing "create category override one at a time" workflow becomes a measurable adoption bottleneck
- Customer success identifies a pattern where tenants are creating many identical category overrides manually

## Technical Notes

- The existing `resolveEffectiveMapping()` cascade already handles any number of category overrides correctly
- The `validateMappingRules()` function already validates category scope combinations
- Implementation would leverage existing `createConnectorMappingVersion` in a loop with transaction semantics
- Consider: should this be a server-side batch operation, or a client-side sequential flow with progress indicator?

## Related

- `apps/api/src/marketplace/connector-mapping.service.ts` — core mapping service
- `apps/api/src/marketplace/marketplace.controller.ts` — existing mapping endpoints
- Resolution cascade: system default → tenant default → category override → install default → install category
