# ADR-0008: Target Schema Registry

**Status**: Proposed
**Date**: 2026-09-27
**Author**: ADR sprint 1 — architecture sprint
**Gate**: Gate 1 — ADR-004
**Depends on**: ADR-0005 (Provider Adapter boundary), ADR-0007 (Certification & Evidence)

---

## Context

Each marketplace connector must know what fields, formats, and values the destination marketplace expects for a given product category. Today this knowledge is encoded in four incompatible per-connector shapes:

| Connector | Type | File | Bridge to `ProductTypeSchema`? |
|-----------|------|------|-------------------------------|
| Flipkart | `FieldRule` / `FlipkartCategoryRule` | `connectors/flipkart/flipkart-category-rules.ts` | Yes — `ruleToProductTypeSchema()` |
| Meesho | `MeeshoCategoryColumn` / `MeeshoCategoryTemplate` | `connectors/meesho/meesho-category-templates.ts` | No |
| Myntra | `MyntraCategoryField` / `MyntraCategoryRule` | `connectors/myntra/myntra-category-rules.ts` | No |
| Nykaa | `NykaaCategoryColumn` / `NykaaCategoryTemplate` | `connectors/nykaa/nykaa-category-templates.ts` | No |

The shared contract `ProductTypeSchema` already exists in `connector.interface.ts:195-201`:

```typescript
type ProductTypeSchema = {
  productType: string;
  requiredAttributes: string[];
  optionalAttributes: string[];
  validValues: Record<string, string[]>;
  schemaVersion: string;
};
```

This is the return type of `ConnectorInterface.fetchProductTypeSchema()` — the optional method by which connectors expose their destination field model to the platform. However:

1. **Only Flipkart bridges to it.** Meesho, Myntra, and Nykaa define their own shapes and never produce a `ProductTypeSchema`. The mapping wizard, publish-readiness checks, and mapping validation cannot consume those local shapes uniformly.

2. **No schema versioning discipline.** Flipkart sets `schemaVersion: "LOCAL-2026-Q2"` manually. Meesho has `isMeeshoTemplateStale()` with a 60-day staleness check. Myntra has `templateVerifiedAt` dates and `[NEEDS_PARTNER_CONFIRMATION]` markers. There is no shared versioning scheme.

3. **No schema registry.** Each connector embeds its schema knowledge as inline constants. There is no registry that lets the platform enumerate "what schemas exist for connector X, category Y" or answer "has the schema changed since the last mapping was published."

4. **Schema-to-mapping coupling is implicit.** The mapping system (`ConnectorMappingVersion.compatibilityState`) tracks whether a mapping is compatible/deprecated/remap_required/blocked, but nothing tells it *why* — it cannot detect that the destination added a new required field or removed an old one because it has no schema-change signal.

This ADR defines the target schema registry model so that destination schemas become a first-class, versioned, machine-readable platform concept.

---

## Decision

### 1. ProductTypeSchema Is the Canonical Target Schema Contract

All connectors that expose destination-field knowledge must produce `ProductTypeSchema` instances. The existing type is sufficient:

- `productType` — the marketplace's category/product-type identifier
- `requiredAttributes` / `optionalAttributes` — field names the marketplace expects
- `validValues` — per-attribute enum constraints
- `schemaVersion` — version identifier (see §3)

Connectors that cannot programmatically fetch schemas from the marketplace API (Flipkart, Meesho, Myntra, Nykaa today) maintain local registries as they do now, but must bridge to `ProductTypeSchema` before the platform consumes the data. Flipkart already does this via `ruleToProductTypeSchema()`; the other three connectors need equivalent bridges.

### 2. Schema Source Classification

Each `ProductTypeSchema` instance has a source classification that records how the schema was obtained:

| Source | Meaning | Staleness model |
|--------|---------|-----------------|
| `api_fetched` | Retrieved from the marketplace's public or partner API at runtime | TTL-based — refetch after configurable interval |
| `local_registry` | Maintained in the connector's source code from manual review of marketplace templates | Calendar-based — quarterly review with `templateVerifiedAt` |
| `tenant_override` | Tenant-specific customization layered on top of a base schema | No staleness — tenant manages explicitly |

The source classification does not change `ProductTypeSchema`'s shape — it is metadata recorded alongside, not inside, the schema. Initially this metadata lives in the connector's local code (as comments and constants today); future implementation may promote it to a first-class DB column.

### 3. Schema Versioning Scheme

Schema versions follow the pattern: `{source}-{connector}-{category}-{date}[-{revision}]`

Examples:
- `LOCAL-flipkart-apparel-2026Q2` — local registry, Flipkart apparel, verified Q2 2026
- `API-shopify-product-20260915` — API-fetched, Shopify product type, September 15, 2026
- `LOCAL-meesho-kurtis-2026Q2-r2` — local registry, Meesho kurtis, Q2 2026, revision 2

This replaces ad-hoc strings like `"LOCAL-2026-Q2"`. The scheme is a convention, not a parsed format — the platform compares versions as opaque strings for equality; ordering uses the embedded date component.

### 4. Schema Registry Surface

The schema registry is a logical concept, not a new service or database table. It is the set of `ProductTypeSchema` instances a connector can produce, accessed through:

- **`ConnectorInterface.fetchProductTypeSchema(productType)`** — existing method, returns one schema. Connectors that fetch from APIs implement this as a live call. Connectors with local registries implement it as a lookup into their hardcoded rules (via a bridge function).

- **`ConnectorInterface.listProductTypeSchemas()`** — new optional method, returns all known product-type identifiers and their current schema versions for the connector. This lets the platform enumerate available schemas without fetching each one.

The registry lives in the Provider Adapter plane (ADR-0005 §4). The platform (PIM/Syndication Plane) consumes schemas but does not define them — each connector owns its own schema definition.

### 5. Schema-to-Mapping Compatibility Signal

When a mapping is resolved (§ `resolveEffectiveMapping` in `connector-mapping.service.ts`), the platform should compare the schema version the mapping was built against with the current schema version for that connector+category. This comparison produces the `compatibilityState`:

| Condition | `compatibilityState` |
|-----------|---------------------|
| Schema version matches the mapping's recorded version | `compatible` |
| Schema has added new optional fields only | `compatible` (informational: new fields available) |
| Schema has added new required fields | `remap_required` |
| Schema has removed fields the mapping uses | `remap_required` |
| Schema has changed valid values for mapped fields | `deprecated` |
| Connector no longer supports this product type | `blocked` |

Today `compatibilityState` is set manually per `ConnectorMappingVersion` row. This ADR establishes the semantic rules so that future automation can compute it from schema diffs.

### 6. Current State (Gate 1 Baseline)

| Connector | Schema source | Bridge exists | Schema version format | Category count |
|-----------|--------------|---------------|----------------------|----------------|
| flipkart | local_registry | Yes (`ruleToProductTypeSchema`) | `LOCAL-2026-Q2` | 11 (default + 10 categories) |
| meesho | local_registry | No | N/A (60-day stale check) | 7 (6 named + generic fallback) |
| myntra | local_registry | No | N/A (`templateVerifiedAt` dates) | 3 |
| nykaa | local_registry | No | N/A | Template-driven (same pattern as Meesho) |
| shopify | api_fetched (potential) | No — no local registry | N/A | N/A — schema is API-driven |
| All others | None | N/A | N/A | N/A |

### 7. Invariants (Machine-Checkable)

These invariants extend the source-generated inventory (`scripts/generate-connector-inventory.cjs`):

| Invariant | Severity | Condition |
|-----------|----------|-----------|
| Tier-1 connector with `local_registry` schema must have bridge to `ProductTypeSchema` | WARNING | Schema exists but no bridge function |
| Schema `schemaVersion` must follow the naming convention | INFO | String does not match `{SOURCE}-{connector}-{category}-{date}` |
| Local registry with `templateVerifiedAt` older than 90 days | WARNING | Calendar staleness exceeded |
| Mapping's `connectorDefinitionVersion` differs from current schema version | INFO | Version drift detected |

---

## Consequences

### Positive

- **Uniform schema consumption.** The mapping wizard, publish-readiness checks, and mapping validation can consume `ProductTypeSchema` from any connector without knowing the connector's internal format.
- **Schema drift detection.** When a schema version changes, mappings built against the old version can be flagged for review — the `compatibilityState` becomes computable rather than manually set.
- **Staleness visibility.** Local registries get explicit review cadence (quarterly for `local_registry` sources) with machine-checkable alerts.

### Negative

- **Bridge maintenance cost.** Meesho, Myntra, and Nykaa each need a bridge function (analogous to Flipkart's `ruleToProductTypeSchema`). This is incremental work that can be done per-connector as they advance through launch stages.
- **Version string convention is not enforced by types.** The naming convention is a documentation-level contract. Enforcement can be added as an inventory check but is not a compile-time guarantee.

### Neutral

- **No new database table in this ADR.** Schema metadata remains in source code. If runtime schema caching becomes necessary (e.g., for API-fetched schemas with TTL), that is a separate implementation decision beyond this ADR's scope.
- **`ProductTypeSchema` type is unchanged.** No breaking change to existing code.

---

## References

- `connector.interface.ts:195-201` — `ProductTypeSchema` type definition
- `connectors/flipkart/flipkart-category-rules.ts` — `ruleToProductTypeSchema()`, `FieldRule` type, `FLIPKART_CATEGORY_RULES`
- `connectors/meesho/meesho-category-templates.ts` — `MeeshoCategoryColumn`, `isMeeshoTemplateStale()`
- `connectors/myntra/myntra-category-rules.ts` — `MyntraCategoryField`, `templateVerifiedAt`
- `connectors/nykaa/nykaa-category-templates.ts` — `NykaaCategoryColumn`
- ADR-0005 §4 — Provider Adapter plane (owns schema definition)
- ADR-0007 §1 — Capability certification (schema bridge coverage is evidence for VALIDATE capability)
