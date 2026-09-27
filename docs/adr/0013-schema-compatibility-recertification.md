# ADR-0013: Schema Compatibility and Recertification

**Status**: Accepted
**Date**: 2026-09-27
**Author**: ADR sprint 2 — architecture sprint
**Gate**: Gate 1 — ADR-009
**Depends on**: ADR-0007 (Certification & Evidence), ADR-0008 (Target Schema Registry), ADR-0009 (Mapping & Transformation)

---

## Context

Marketplace providers change their category schemas — adding required fields, deprecating attributes, restricting valid values. When a provider schema changes, existing mappings may become invalid and previously certified connector capabilities may need re-verification. Today, the platform has no systematic way to detect schema changes, assess mapping compatibility, or trigger recertification.

### Schema versioning is inconsistent

Each connector tracks schema freshness differently:

| Connector | Version source | Freshness mechanism |
|-----------|---------------|---------------------|
| Amazon | Live API fetch from SP-API `definitions/2020-09-01/productTypes/{type}` | Always current — `schemaVersion` from `payload.schemaVersion` or `payload.productTypeVersion.version`, defaulting to `"LATEST"` |
| Flipkart | Hard-coded `"LOCAL-2026-Q2"` in `ruleToProductTypeSchema()` (`flipkart-category-rules.ts:274`) | Manual quarterly review per file header |
| Meesho | `templateVerifiedAt` per category template | `isMeeshoTemplateStale()`: true when > 60 days old |
| Nykaa | `templateVerifiedAt` per category template | `isNykaaTemplateStale()`: true when > 60 days old |
| Myntra | `templateVerifiedAt` per category field set (marked `[NEEDS_PARTNER_CONFIRMATION]`) | No staleness helper function |

The `ProductTypeSchema` type (`connector.interface.ts:195-201`) includes `schemaVersion: string`, but only Amazon and Flipkart populate it. The local registries (Meesho, Myntra, Nykaa) use `templateVerifiedAt` dates instead of schema versions.

### Mapping compatibility exists but is manual

`ConnectorMappingVersion` carries a `compatibilityState` field with four values defined in `connector-mapping.service.ts:15`:

```
"compatible" | "deprecated" | "remap_required" | "blocked"
```

`evaluateMappingPreflight()` (`connector-mapping.service.ts:1186-1195`) blocks publish when compatibility is `blocked` or `remap_required`, and warns on `deprecated`. But nothing automatically sets these states — they appear to be set at mapping creation time or manually. There is no code that validates a mapping's field coverage against a `ProductTypeSchema`.

### Certification is design-only

ADR-0007 defined six capability certification levels (untested → unit_tested → integration_tested → sandbox_verified → production_verified → certified). The codebase has zero implementation of these levels — no `certificationLevel` field, no runtime checks, no evidence recording. The certification table in ADR-0007 is an aspirational baseline, not enforced state.

### Staleness thresholds conflict

The per-connector staleness functions use 60 days. The inventory script's `schema-template-stale` check uses 90 days (per CTO directive to downgrade to INFO). These are two different measurements:
- **60-day (connector-level):** Operational — flags templates that need re-download and comparison against the provider.
- **90-day (inventory-level):** Architecture — flags connectors whose schema source has not been reviewed in a quarter.

---

## Decision

### 1. Schema source classification

Every connector's schema source falls into one of three categories, as established in ADR-0008:

| Source | Description | Freshness model |
|--------|-------------|-----------------|
| `api_fetched` | Schema retrieved live from provider API | Always current; version from provider |
| `local_registry` | Manually maintained category rules/templates | `templateVerifiedAt` date; stale after threshold |
| `static` | Hard-coded or configuration-driven | Manual review only |

The inventory script already classifies schema sources. This classification determines which recertification triggers apply.

### 2. Schema change detection signals

Schema changes are detected through three signals, in order of reliability:

#### Signal A: Provider-reported version change

For `api_fetched` sources (Amazon), the provider API returns a schema version. When the version returned by `fetchProductTypeSchema()` differs from the version stored on the active `ConnectorMappingVersion.connectorDefinitionVersion`, a `PROVIDER_SCHEMA_CHANGED` event is recorded.

**Severity:** WARNING (requires mapping review, may require remap).

#### Signal B: Local registry verification failure

For `local_registry` sources (Flipkart, Meesho, Myntra, Nykaa), a manual re-download and diff against the current template produces one of:
- **No change:** Update `templateVerifiedAt` to today. No further action.
- **Additive change:** New optional fields added. Update template, bump `schemaVersion`. Existing mappings remain `compatible`.
- **Breaking change:** Required fields added, values restricted, fields removed. Update template, bump `schemaVersion`. Existing mappings transition to `remap_required`.

This is a manual process today. The ADR formalizes the outcome recording, not the detection mechanism.

#### Signal C: Age-based staleness

For `local_registry` sources, `templateVerifiedAt` older than 90 days triggers the `schema-template-stale` inventory finding (INFO). This is a review prompt, not evidence of a schema change. It signals that Signal B has not been exercised recently.

### 3. Compatibility state transitions

When a schema change is detected (Signal A or B), the affected mappings transition through compatibility states:

```
compatible ──▶ deprecated ──▶ remap_required ──▶ blocked
```

Transitions are triggered by:

| Trigger | From | To |
|---------|------|----|
| Additive schema change (new optional fields) | compatible | deprecated |
| Breaking schema change (new required fields, value restrictions) | compatible/deprecated | remap_required |
| Mapping not updated within grace period after `remap_required` | remap_required | blocked |
| Mapping updated and validated against new schema | any | compatible |

`evaluateMappingPreflight()` already enforces `blocked` and `remap_required` as publish blockers. This ADR adds the transition triggers.

### 4. Recertification triggers

A schema change at the `remap_required` level or above triggers recertification of the affected capability:

- The capability's certification level (ADR-0007) drops to `unit_tested` — it must pass at least unit tests against the new schema before publish is re-enabled.
- The recertification requirement is recorded on the `ConnectorMappingVersion` as `recertificationRequired: true` with `recertificationReason: string`.
- Clearing the recertification flag requires passing the validation test suite for that connector+category against the new schema.

This is not implemented today. ADR-0007's certification model must be materialized before recertification enforcement can take effect. Until then, recertification is tracked as an inventory WARNING (`RECERTIFICATION_REQUIRED`), not a runtime blocker.

### 5. Staleness threshold alignment

- **Connector-level staleness** (60 days in `isMeeshoTemplateStale()`, `isNykaaTemplateStale()`): Remains unchanged. This is an operational signal for connector maintainers.
- **Inventory-level staleness** (90 days): Remains at INFO severity per CTO directive. This is a quarterly architecture review signal.
- Both are valid measurements at different granularities. They are not in conflict.

---

## Machine-Checkable Invariants

| ID | Description | Severity | Check |
|----|-------------|----------|-------|
| `schema-version-populated` | `api_fetched` schema sources must populate `schemaVersion` from the provider | WARNING | Connectors with `fetchProductTypeSchema()` returning hard-coded or empty `schemaVersion` |
| `local-registry-has-verified-at` | Every `local_registry` category entry must have a `templateVerifiedAt` date | ERROR | Grep for category entries missing `templateVerifiedAt` |
| `compatibility-state-valid` | `ConnectorMappingVersion.compatibilityState` is one of the four defined values | ERROR | Prisma schema enum or runtime validation |
| `stale-schema-has-review-plan` | A connector with `schema-template-stale` finding should have a review date or exemption | INFO | Inventory check |

---

## Consequences

### Positive

- **Proactive mapping invalidation:** Schema changes automatically transition mappings to `deprecated` or `remap_required`, preventing silent payload drift.
- **Clear freshness model:** Three schema source categories with defined freshness mechanisms replace the current ad-hoc per-connector approaches.
- **Recertification path:** When ADR-0007's certification model is materialized, recertification triggers are already defined.

### Negative

- **Manual detection for local registries:** Signal B (re-download and diff) remains manual. Automating provider schema fetches for Flipkart/Meesho/Myntra/Nykaa would require API access that may not be available.
- **Deferred enforcement:** Recertification enforcement depends on ADR-0007 materialization, which is not in scope for this sprint.

### Neutral

- The 60-day and 90-day staleness thresholds coexist at different levels. No alignment needed.
- `templateVerifiedAt` remains the freshness mechanism for local registries. No new date fields introduced.

---

## Enforcement Dependency

Automatic recertification enforcement remains inactive until ADR-0007 certification evidence is implemented.
