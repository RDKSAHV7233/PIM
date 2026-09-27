# ADR-0009: Mapping, Transformation, Value Mapping & Taxonomy

**Status**: Proposed
**Date**: 2026-09-27
**Author**: ADR sprint 1 — architecture sprint
**Gate**: Gate 1 — ADR-005
**Depends on**: ADR-0005 (PIM/Syndication Plane boundary), ADR-0008 (Target Schema Registry)

---

## Context

The Vexa PIM connector platform has two parallel mapping systems that evolved at different times. Both are in production. Neither is deprecated. They partially overlap in data, resolution logic, and consumption.

### System A: ChannelMappingTemplate (legacy)

- **Prisma model:** `ChannelMappingTemplate` — scoped by `(categoryId, channel, name)`, stores `requiredFields` (Json) and `fieldMap` (Json).
- **Hardcoded baselines:** `MAPPING_PACKS` in `marketplace.service.ts:311-437` — six entries keyed by `MarketplaceChannel` (amazon, flipkart, meesho, myntra, shopify, woocommerce).
- **Resolution:** `getEffectiveMapping()` in `marketplace.service.ts:2634-2753` with 4-level priority: pinned template → category+channel default → ConnectorMappingVersion bridge → MAPPING_PACKS fallback.
- **Output type:** `EffectiveMapping` — `MappingPack & { templateId, templateName, source }`.
- **Lifecycle:** None — templates are created, defaulted, or deleted. No draft/publish/supersede.

### System B: ConnectorMappingVersion (Sprint 11+)

- **Prisma model:** `ConnectorMappingVersion` — scoped by `(connectorSlug, installationId, categoryScope, mappingLevel)`, stores `mappingRules` (Json), `fallbackPolicy` (Json), `lifecycleState`, `compatibilityState`, `connectorDefinitionVersion`.
- **Hardcoded baselines:** `SYSTEM_CONNECTOR_DEFAULTS` in `connector-mapping.service.ts:84-141` — six entries keyed by connector slug, partially duplicating `MAPPING_PACKS`.
- **Resolution:** `resolveEffectiveMapping()` in `connector-mapping.service.ts:1073-1167` with 5-level merge: system default → slug-scoped tenant default → slug-scoped category mapping → installation-scoped tenant default → installation-scoped category mapping.
- **Lifecycle:** Draft → validated → published → superseded → archived, with history tracking, event logging, and compatibility state.

### The Bridge

`getEffectiveMapping()` (System A) falls back to `resolveEffectiveMapping()` (System B) at priority level 3 when no `ChannelMappingTemplate` exists for a given category. This lets both systems coexist, but means the same mapping can be resolved through two different code paths with different merge semantics.

### Field Transform Engine

`applyFieldTransform()` in `marketplace.service.ts:3897-4001` supports seven transform types: `default`, `concat`, `format`, `units`, `list`, `lookup`, `locale`. The unit conversion table covers kg/g/lb, cm/in/m/mm (`resolveUnitConversionFactor`, line 3988).

**Critical gap:** `applyMappedConnectorTargets()` (line 3780) only applies resolved mappings for two connectors:

- **Shopify** — when `shopifyMappedMetafieldsEnabled()` flag is on, compiles metafields from the field map
- **WooCommerce** — when `woocommerceMappedMetaEnabled()` flag is on, compiles custom meta from the field map

For all other 13 connectors, the method returns the payload unchanged (line 3789). The mapping system for non-Shopify/WooCommerce connectors affects only validation and readiness checks — the actual payload sent to the marketplace is the unmapped universal `ProductPayload`.

### Taxonomy

`searchTaxonomy()` in `connector-mapping.service.ts:1221-1268` queries the PIM `Category` table and returns entries with `requiredAttributes` from `attributeDefinitions`. `listUnmappedCategories()` (line 1270) identifies categories without a published `ConnectorMappingVersion`. These are PIM-side taxonomy operations — no marketplace taxonomy integration exists.

### The Problems

1. **Baseline duplication.** `MAPPING_PACKS` and `SYSTEM_CONNECTOR_DEFAULTS` encode overlapping PIM-to-marketplace field maps maintained independently. Drift between them causes mapping resolution to produce different results depending on which system resolves the mapping.

2. **Mapping application gap.** The transform engine is fully implemented but only exercised by 2 of 15 connectors. For the other 13, the mapping is resolved (for validation/readiness) but never applied to the payload. The connector receives an unmapped `ProductPayload` and does its own field mapping internally (if it does any).

3. **Two resolution paths.** A single mapping request can be resolved through `getEffectiveMapping()` or `resolveEffectiveMapping()` with different merge semantics. The bridge ensures they converge, but the code path is non-obvious.

4. **No value mapping registry.** PIM values (e.g., color "Red") must map to marketplace-specific values (e.g., Flipkart "RED", Myntra "red"). Today this happens inside per-connector `buildPayload()` methods or not at all. The `lookup` transform type supports table-based value mapping, but no connector populates lookup tables.

5. **Taxonomy is PIM-only.** The taxonomy search returns PIM categories. There is no mapping from PIM category → marketplace category. Category mapping in `MAPPING_PACKS` uses the `requiredFields` array but has no concept of "this PIM category maps to this Flipkart vertical."

---

## Decision

### 1. ConnectorMappingVersion Is the Canonical Mapping System

`ConnectorMappingVersion` (System B) is the target mapping system. `ChannelMappingTemplate` (System A) is legacy and should not receive new features. The bridge in `getEffectiveMapping()` ensures backward compatibility during transition.

**Migration path (not in this sprint):**
- Phase 1: All new mapping features build on `ConnectorMappingVersion` and `resolveEffectiveMapping()`.
- Phase 2: When a tenant's last `ChannelMappingTemplate` is superseded by a `ConnectorMappingVersion`, the template becomes read-only.
- Phase 3: When all tenants are on `ConnectorMappingVersion` for a given connector, the `MAPPING_PACKS` entry for that connector can be removed.

### 2. Baseline Consolidation Rule

`SYSTEM_CONNECTOR_DEFAULTS` (System B baselines, `connector-mapping.service.ts:84-141`) is the single source of system-default field mappings. `MAPPING_PACKS` (System A baselines, `marketplace.service.ts:311-437`) remains for legacy resolution only and must not diverge from `SYSTEM_CONNECTOR_DEFAULTS` for any field that both define.

**Invariant (machine-checkable):** For every connector slug that appears in both `MAPPING_PACKS` and `SYSTEM_CONNECTOR_DEFAULTS`, the intersection of their field map keys must produce identical target values.

### 3. Mapping Application Architecture

The mapping resolution → payload application flow has three stages:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│ Schema Registry │────▶│ Mapping Resolution│────▶│ Payload Application │
│ (ADR-0008)      │     │ (this ADR §1-§2)  │     │ (this ADR §3)       │
│                 │     │                    │     │                     │
│ "What fields    │     │ "How does PIM map  │     │ "Apply the resolved │
│  does the       │     │  to those fields?" │     │  mapping to the     │
│  marketplace    │     │                    │     │  ProductPayload"    │
│  expect?"       │     │                    │     │                     │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
```

Today, stage 3 (`applyMappedConnectorTargets`) is implemented only for Shopify and WooCommerce. Extending it to other connectors is an implementation decision gated by each connector's launch stage advancement (ADR-0007). This ADR establishes the architecture; it does not mandate that all connectors use platform-applied mappings immediately.

**Connector opt-in model:** A connector can declare whether it expects the platform to apply mappings to the payload or whether it handles mapping internally:

| Mode | Behavior | Current connectors |
|------|----------|-------------------|
| `platform_applied` | `applyMappedConnectorTargets()` applies the resolved mapping before passing the payload to the connector | Shopify, WooCommerce (behind feature flags) |
| `connector_internal` | Connector receives the unmapped `ProductPayload` and maps fields in its own `publishProduct()` / `buildPayload()` | All others (current default) |

Transitioning a connector from `connector_internal` to `platform_applied` requires:
- A `ProductTypeSchema` bridge (ADR-0008)
- Published `ConnectorMappingVersion` rows for the connector's categories
- Feature flag gating the transition

### 4. Field Transform Taxonomy

The seven transform types in `applyFieldTransform()` are the platform's transform vocabulary. They are classified by their data-flow shape:

| Category | Transforms | Data flow |
|----------|-----------|-----------|
| **Defaulting** | `default` | `source → target` with fallback value |
| **Reshaping** | `concat`, `format`, `list` | `source(s) → target` with structural change |
| **Converting** | `units` | `source → target` with numeric conversion |
| **Mapping** | `lookup`, `locale` | `source → target` with table-based substitution |

No new transform types should be added without updating this taxonomy and verifying that the existing types cannot compose to produce the desired result.

### 5. Value Mapping Model

Value mapping (PIM value → marketplace value) is a specific use of the `lookup` transform type. The lookup table is stored in the mapping's `mappingRules.field_mappings` under the target field's `transform` object:

```json
{
  "field_mappings": {
    "attributes.color": {
      "target": "color",
      "transform": {
        "type": "lookup",
        "table": {
          "Red": "RED",
          "Blue": "BLUE",
          "Green": "GRN"
        },
        "fallback": null
      }
    }
  }
}
```

This is already supported by the transform engine. Making it usable requires:
- The mapping wizard to expose lookup table editing for enum-constrained target fields (those with `validValues` in `ProductTypeSchema`)
- Publish-readiness checks to verify that mapped values exist in the target schema's `validValues`

### 6. Taxonomy Mapping Model

Taxonomy mapping (PIM category → marketplace category) is distinct from field mapping. A PIM category "Women > Ethnic Wear > Kurtis" may map to Flipkart vertical "Kurtis, Kurtas & Suits" or Myntra category "ethnic-wear". This is a category-level decision, not a field-level one.

Today, `categoryScope` in `ConnectorMappingVersion` identifies the PIM category the mapping applies to, but does not record which marketplace category it maps to. The mapping rules may include a `category` key in `mappingRules` that names the target category, but this is not formalized.

**Formalization:** `ConnectorMappingVersion.mappingRules` should include an optional `taxonomy` object:

```json
{
  "taxonomy": {
    "source_category_id": "pim-category-uuid",
    "source_category_path": "Women > Ethnic Wear > Kurtis",
    "target_category_id": "flipkart-kurtis-suits",
    "target_category_label": "Kurtis, Kurtas & Suits",
    "target_required_attributes": ["color", "fabric", "size", "sleeve_length"]
  },
  "field_mappings": { ... }
}
```

The `target_required_attributes` array connects taxonomy mapping to schema validation: if the target category requires `sleeve_length`, the field mappings must include a mapping for it or readiness checks will flag it.

### 7. Resolution Precedence (Unified View)

Combining both systems into one precedence view for documentation:

| Priority | Source | System | Scope |
|----------|--------|--------|-------|
| 6 (highest) | Pinned template | A | Explicit `templateId` parameter |
| 5 | Category+channel default template | A | `isDefault: true` for category+channel |
| 4 | Installation-scoped category mapping | B | `installationId=X, mappingLevel=tenant_connector_category_mapping` |
| 3 | Installation-scoped tenant default | B | `installationId=X, mappingLevel=tenant_connector_default` |
| 2 | Slug-scoped category mapping | B | `installationId=null, mappingLevel=tenant_connector_category_mapping` |
| 1 | Slug-scoped tenant default | B | `installationId=null, mappingLevel=tenant_connector_default` |
| 0 (lowest) | System default | B | `SYSTEM_CONNECTOR_DEFAULTS` / `MAPPING_PACKS` |

When System A's bridge falls through to System B (priority 3 in `getEffectiveMapping`), it enters System B at its full 5-level resolution. The effective behavior is the union above.

### 8. Invariants (Machine-Checkable)

| Invariant | Severity | Condition |
|-----------|----------|-----------|
| `MAPPING_PACKS` and `SYSTEM_CONNECTOR_DEFAULTS` field map intersection must not diverge | ERROR | Same key, different target value |
| Connector with `platform_applied` mapping mode must have at least one published `ConnectorMappingVersion` | WARNING | Mode declared but no published mapping |
| Published mapping with `lookup` transform must have all table values in target schema's `validValues` | WARNING | Lookup value not in `ProductTypeSchema.validValues` |
| Mapping's `connectorDefinitionVersion` must match current schema version | INFO | Version drift (see ADR-0008 §5) |
| Tier-1 connector must have system default baseline in `SYSTEM_CONNECTOR_DEFAULTS` | ERROR | Tier-1 connector slug missing from baselines |

---

## Consequences

### Positive

- **Single canonical system.** New mapping features build on `ConnectorMappingVersion` with its lifecycle, compatibility tracking, and event logging. No feature duplication.
- **Explicit application gap.** The `platform_applied` vs `connector_internal` distinction makes the mapping application gap visible and trackable per connector, rather than hidden in an if-branch.
- **Value mapping reuses existing infrastructure.** The `lookup` transform already works; exposing it in the mapping wizard requires UI work, not engine work.
- **Taxonomy mapping formalized.** Category mapping becomes a structured part of the mapping record rather than an implicit convention.

### Negative

- **Legacy bridge persists.** `ChannelMappingTemplate` cannot be removed until all tenants migrate. The bridge adds a code path that must be maintained.
- **Baseline duplication persists short-term.** Until a connector's `MAPPING_PACKS` entry is retired, both baselines must be kept in sync — the machine-checkable invariant catches drift but does not prevent it.

### Neutral

- **No schema migration in this ADR.** `ConnectorMappingVersion.mappingRules` already stores arbitrary Json. The `taxonomy` object is a convention within that Json, not a schema change.
- **Feature flags remain.** `shopifyMappedMetafieldsEnabled()` and `woocommerceMappedMetaEnabled()` continue gating the two existing `platform_applied` connectors.

---

## References

- `marketplace.service.ts:311-437` — `MAPPING_PACKS` (System A baselines)
- `connector-mapping.service.ts:84-141` — `SYSTEM_CONNECTOR_DEFAULTS` (System B baselines)
- `marketplace.service.ts:2634-2753` — `getEffectiveMapping()` (System A resolution + bridge)
- `connector-mapping.service.ts:1073-1167` — `resolveEffectiveMapping()` (System B 5-level merge)
- `marketplace.service.ts:3780-3828` — `applyMappedConnectorTargets()` (mapping application gap)
- `marketplace.service.ts:3897-4001` — `applyFieldTransform()` (7 transform types)
- `connector-mapping.service.ts:1221-1268` — `searchTaxonomy()` (PIM-side taxonomy)
- `connector-mapping.service.ts:1270-1312` — `listUnmappedCategories()`
- ADR-0005 §2 — PIM/Syndication Plane (owns mapping)
- ADR-0008 — Target Schema Registry (schema → mapping compatibility signal)
