# ADR-0010: Channel Projection

**Status**: Accepted
**Date**: 2026-09-27
**Author**: ADR sprint 1 — architecture sprint
**Gate**: Gate 1 — ADR-006
**Depends on**: ADR-0005 (Platform Boundaries), ADR-0008 (Target Schema Registry), ADR-0009 (Mapping & Transformation)

---

## Context

When a product is published to a marketplace, the platform constructs a payload by fetching the product from Prisma, resolving variants and prices, building a flat `ProductPayload`, and (for Shopify/WooCommerce only) applying mapped connector targets. This happens in `buildConnectorProductPayload()` (`marketplace.service.ts:3579-3778`).

There is no intermediate representation between the PIM product (normalized, category-scoped, multi-attribute) and the connector's `publishProduct()` call. The current data flow is:

```
PIM Product (Prisma) ──▶ buildConnectorProductPayload() ──▶ ProductPayload ──▶ connector.publishProduct()
```

This direct construction has been sufficient while connectors were few and mapping was minimal. As the platform scales, three pressures emerge:

### 1. Repeated payload construction cost

Every publish, every readiness check simulation, every export preview fetches the full product with variants, prices, tax codes, and attributes from the database. There is no caching layer. `buildConnectorProductPayload()` runs a Prisma query with 5 includes and 3 nested selects every time it is called. For bulk publish (up to 2000 products), this means 2000 independent queries.

### 2. No pre-publish preview

Operators cannot see "what will this product look like on Flipkart" without triggering a full payload construction. The mapping wizard shows field-level mappings, but not the resolved, transformed, connector-ready payload. This matters for debugging rejected submissions — operators must submit, wait for rejection, then try to correlate channel errors with field values.

### 3. Connector-specific shaping is scattered

Each connector adapter contains its own payload-to-provider transformation:

| Connector | Shaping location | Approach |
|-----------|-----------------|----------|
| Shopify | `ShopifyConnector.publishProduct()` | Transforms `ProductPayload` → Shopify GraphQL mutation input |
| Flipkart | `FlipkartConnector.publishProduct()` | Transforms `ProductPayload` → Flipkart Listing API body |
| WooCommerce | `WooCommerceConnector.publishProduct()` | Transforms `ProductPayload` → WooCommerce REST body |
| Meesho | `MeeshoConnector.generateExportFile()` | Transforms `ProductPayload` → Excel rows per category template |
| Myntra | `MyntraConnector.generateExportFile()` | Transforms `ProductPayload` → Excel rows per category template |
| Nykaa | `NykaaConnector.generateExportFile()` | Transforms `ProductPayload` → Excel rows per category template |

The connector adapter transforms `ProductPayload` into the provider's wire format. This is correct — it belongs in the Provider Adapter plane (ADR-0005 §4). But the boundary between "platform-level projection" and "provider-level serialization" is undefined. When the mapping application gap (ADR-0009 §3) closes and more connectors move to `platform_applied` mode, the platform needs a clean separation between:

- **Projection:** "Given this PIM product and this mapping, what is the channel-specific view?" (platform's job)
- **Serialization:** "Given this projected view, produce the wire-format body for the provider API." (connector adapter's job)

---

## Decision

### 1. ChannelProjection Definition

A **ChannelProjection** is the computed, channel-specific representation of a PIM product after mapping resolution and field transformation have been applied, but before provider-specific serialization. It is a pure function of its inputs:

```
ChannelProjection = f(Product, EffectiveMapping, ProductTypeSchema)
```

Where:
- **Product** is the PIM product with its variants, prices, attributes, and category
- **EffectiveMapping** is the resolved mapping for this connector+category+installation (ADR-0009 §7)
- **ProductTypeSchema** is the target schema for this connector+category (ADR-0008 §1)

The projection answers: "If I published this product to this channel right now, what field values would arrive?" It does not answer: "What HTTP body would the connector send?" — that is serialization.

### 2. ChannelProjection Is Not a Materialized View

The projection is computed on demand, not stored. There is no `channel_projections` database table, no background refresh job, no stale-projection problem. This matches the current architecture's approach — `buildConnectorProductPayload()` already constructs fresh each time.

Rationale:
- **Correctness over performance.** A materialized projection requires invalidation on every product edit, every mapping change, every price update, and every schema version bump. The invalidation surface is large and error-prone.
- **Current scale does not require it.** Bulk publish queues up to 2000 products per job. The database query per product is the bottleneck, but the correct optimization is query batching (which the BullMQ queue already enables), not view materialization.
- **Future option preserved.** If scale requires a materialized projection later, the pure-function definition makes it safe to memoize — the inputs are the cache key, the output is the cache value. But this is a performance optimization, not an architecture decision.

### 3. Projection Boundary in the Data Flow

The projection introduces a named boundary in the existing flow:

```
PIM Product (Prisma)
      │
      ▼
buildConnectorProductPayload()     ← existing: fetches product, builds flat payload
      │
      ▼
applyMappedConnectorTargets()      ← existing: applies mapping (Shopify/WooCommerce only today)
      │
      ▼
┌─────────────────────────────┐
│   ChannelProjection         │    ← named boundary (this ADR)
│   (mapped, transformed,    │
│    validated ProductPayload)│
└─────────────────────────────┘
      │
      ▼
connector.publishProduct()         ← Provider Adapter: serializes to wire format
```

The `ChannelProjection` boundary sits between `applyMappedConnectorTargets()` and `connector.publishProduct()`. Today this boundary is implicit — the return value of `applyMappedConnectorTargets()` *is* the projection. Naming it makes the boundary explicit and enables:

- **Pre-publish preview** — compute the projection without calling `publishProduct()`
- **Projection diff** — compare two projections (e.g., before/after a mapping change)
- **Projection validation** — validate the projection against `ProductTypeSchema.requiredAttributes` before submission

### 4. ProjectedPayload Type

The projected payload is a `ProductPayload` (unchanged type) with additional metadata:

```typescript
type ProjectedPayload = {
  payload: ProductPayload;
  projectionMeta: {
    connectorSlug: string;
    categoryScope: string;
    installationId: string | null;
    schemaVersion: string | null;
    mappingVersionIds: string[];
    mappingSource: "system_pack" | "saved_template" | "connector_mapping_version";
    transformsApplied: string[];
    projectedAt: string; // ISO timestamp
  };
};
```

`projectionMeta` records what inputs produced this projection. It is not persisted — it accompanies the payload through the publish flow for debugging and audit. On a rejected submission, the `projectionMeta` tells the operator exactly which mapping versions and schema version were in effect.

### 5. Provider Adapter Contract Refinement

The Provider Adapter (ADR-0005 §4) receives the projected payload. Its contract is:

- **Input:** `ProjectedPayload` (or `ProductPayload` for backward compatibility during transition)
- **Output:** Provider-specific wire format (HTTP body, Excel rows, GraphQL mutation)
- **Constraint:** The adapter must not re-resolve mappings or re-fetch the product. It receives a fully projected view and serializes it.

Today, some adapters (e.g., Flipkart, Meesho) apply additional field-level logic inside `publishProduct()` or `generateExportFile()`. This is acceptable during transition — the `connector_internal` mapping mode (ADR-0009 §3) acknowledges that some connectors still handle mapping internally. As connectors move to `platform_applied`, their adapters should shrink to pure serialization.

### 6. Projection for Export-Only Connectors

Export-only connectors (Meesho, Myntra, Nykaa) produce Excel files rather than API calls. Their projection is the same concept — the channel-specific view of the product — but the output format differs:

| Mode | Projection output | Connector consumes |
|------|------------------|--------------------|
| API connectors | `ProductPayload` with mapped field values | `publishProduct(payload, context)` |
| Export connectors | `ProductPayload` with mapped field values | `generateExportFile(payload[], context)` |

The projection is identical. Only the consumer differs. This means the same preview, diff, and validation infrastructure works for both API and export connectors.

### 7. Current State (Gate 1 Baseline)

| Aspect | State |
|--------|-------|
| Projection computation | Exists as `buildConnectorProductPayload()` + `applyMappedConnectorTargets()` |
| Named boundary | Does not exist — implicit |
| `ProjectedPayload` type | Does not exist |
| Pre-publish preview | Not available — must submit to see result |
| Projection validation | Partial — `evaluatePublishReadiness()` checks required fields but not against schema |
| Materialized view | Not implemented, not planned |

### 8. Invariants (Machine-Checkable)

| Invariant | Severity | Condition |
|-----------|----------|-----------|
| Projection must be a pure function of (Product, Mapping, Schema) | ERROR (design) | Projection logic must not read external state beyond its three inputs |
| Provider adapter must not call `resolveEffectiveMapping()` or `getEffectiveMapping()` | WARNING | Adapter re-resolving mapping indicates projection boundary violation |
| `projectionMeta.schemaVersion` must match the current schema version | INFO | Schema drift since projection was computed |

---

## Consequences

### Positive

- **Pre-publish preview becomes possible.** The projection can be computed and shown to operators without triggering a submission. This directly addresses the debugging cost of rejected submissions.
- **Clean separation of concerns.** "What does the product look like on this channel?" (projection) is separated from "How do I send it?" (serialization). New connectors can focus on serialization; the platform handles projection.
- **Audit trail.** `projectionMeta` records exactly what mapping and schema produced a submission, enabling post-mortem analysis of rejections.

### Negative

- **No immediate performance gain.** The projection is computed fresh each time, same as today. Query batching (not projection materialization) is the correct near-term optimization.
- **Transition period.** Connectors in `connector_internal` mode still do their own mapping inside the adapter. The projection boundary is meaningful only for `platform_applied` connectors, which today is Shopify and WooCommerce.

### Neutral

- **`ProductPayload` type unchanged.** `ProjectedPayload` wraps it; existing code that consumes `ProductPayload` directly continues to work.
- **No new database table.** The projection is ephemeral — computed, consumed, discarded (or attached to the submission record's `payloadSnapshot` for audit).
- **Materialization remains a future option.** If scale demands it, the pure-function definition is safe to memoize. The decision to materialize is independent of this ADR.

---

## References

- `marketplace.service.ts:3579-3778` — `buildConnectorProductPayload()` (projection computation)
- `marketplace.service.ts:3780-3828` — `applyMappedConnectorTargets()` (mapping application)
- `connector.interface.ts` — `ProductPayload` type, `ConnectorInterface.publishProduct()`
- `connector-framework.service.ts` — `ConnectorFrameworkService.publish()` (orchestrates projection → submission)
- `marketplace.service.ts:1314-1443` — `evaluatePublishReadiness()` (partial projection validation)
- `connector-submission-storage.service.ts` — payload snapshot storage (R2/S3, 64KB threshold)
- ADR-0005 §4 — Provider Adapter plane (owns serialization)
- ADR-0008 — Target Schema Registry (projection validates against schema)
- ADR-0009 §3 — Mapping application architecture (`platform_applied` vs `connector_internal`)
