# ADR-0014: Legacy Tier-1/Tier-2 Migration Strategy

**Status**: Accepted
**Date**: 2026-09-27
**Author**: ADR sprint 2 — architecture sprint
**Gate**: Gate 1 — ADR-010
**Depends on**: ADR-0005 (Platform Boundaries), ADR-0006 (Identity & State), ADR-0008 (Target Schema), ADR-0009 (Mapping & Transformation), ADR-0010 (Channel Projection)

---

## Context

The connector platform has two architectural tiers and two mapping systems. Both tiers and both mapping systems are in production. The interaction between tier membership and mapping system creates a 2x2 matrix of code paths that must be navigated during any migration.

### Tier architecture

**Tier-1 (marketplace):** Connectors in `MARKETPLACE_CHANNELS` (`marketplace-channels.ts:8`). Currently: amazon, flipkart, meesho, shopify, woocommerce. Tier-1 connectors get:
- Hardcoded `MAPPING_PACKS` entry (field mapping baseline + required fields)
- `SYSTEM_CONNECTOR_DEFAULTS` entry (ConnectorMappingVersion baseline)
- Dedicated UI: channel selectors, readiness panels, mapping editors, design tokens
- `applyMappedConnectorTargets()` eligibility (currently only Shopify and WooCommerce, gated by feature flags)

**Tier-2 (generic):** All other connectors (10 currently). Use `ConnectorInterface.buildPayload()` directly. No field mapping, no mapping packs, no dedicated UI. The frontend has no concept of Tier-2 — only `MARKETPLACE_CHANNELS` members appear in channel selectors.

### Dual mapping system (documented in ADR-0009)

**System A (legacy):** `MAPPING_PACKS` + `ChannelMappingTemplate` + `getEffectiveMapping()` with 4-level priority. No lifecycle management.

**System B (Sprint 11+):** `SYSTEM_CONNECTOR_DEFAULTS` + `ConnectorMappingVersion` + `resolveEffectiveMapping()` with 5-level merge. Full lifecycle (draft → validated → published → superseded → archived).

The bridge in `getEffectiveMapping()` (`marketplace.service.ts:2604-2724`) calls System B at priority level 3, falling back to System A's `MAPPING_PACKS` at level 4. Bridge failure is non-fatal (logged, falls through).

### Mapping application gap

`applyMappedConnectorTargets()` (`marketplace.service.ts:3750-3798`) only applies field mappings for two connectors:
- Shopify — gated by `PIM_SHOPIFY_MAPPED_METAFIELDS_ENABLED` (defaults to `"true"`)
- WooCommerce — gated by `PIM_WOOCOMMERCE_MAPPED_META_ENABLED` (defaults to `"true"`)

For all other 13 connectors, the method returns the payload unchanged. Mappings are resolved for validation and readiness checks but never applied to the outbound payload.

### Frontend/API divergence

The frontend (`apps/web/src/lib/marketplace-channels.ts:1`) maintains its own `MARKETPLACE_CHANNELS` list with 6 entries (includes myntra). The API removed myntra in #974 but the frontend was not updated. The frontend also has `isChannelInDevelopment()`, `IN_DEVELOPMENT_CHANNELS`, `READINESS_CHANNELS`, and `MARKETPLACE_CHANNEL_LABELS` — all independently maintained from the API.

---

## Decision

### 1. Tier membership is a code change requiring an ADR

Per ADR-0006, tier is a business classification. Promoting a connector from Tier-2 to Tier-1 or demoting from Tier-1 to Tier-2 requires:
- A code change to `MARKETPLACE_CHANNELS` (API) AND `MARKETPLACE_CHANNELS` (frontend)
- An ADR or ADR amendment documenting the rationale
- Satisfaction of all Tier-1 invariants (ADR-0008 schema bridge, ADR-0009 mapping baselines)

### 2. Frontend/API channel list synchronization

The frontend and API must have identical `MARKETPLACE_CHANNELS` lists. The current divergence (frontend includes myntra, API does not) is a defect.

**Resolution:** The API's `MARKETPLACE_CHANNELS` is the source of truth. The frontend should derive its channel list from the API (via a config endpoint or build-time import) rather than maintaining an independent copy. Until that derivation is built, the frontend list must be manually synchronized with every API change.

**Immediate action:** Remove `"myntra"` from the frontend's `MARKETPLACE_CHANNELS` and update `IN_DEVELOPMENT_CHANNELS`, `READINESS_CHANNELS`, and `MARKETPLACE_CHANNEL_LABELS` to match the API state.

### 3. Mapping system migration phases

ADR-0009 established that `ConnectorMappingVersion` (System B) is the canonical mapping system. The migration from System A to System B proceeds in three phases:

#### Phase 1: New features on System B only (current state)

All new mapping features (lifecycle management, compatibility tracking, 5-level resolution) are built on `ConnectorMappingVersion`. `ChannelMappingTemplate` and `MAPPING_PACKS` receive no new features.

The `MAPPING_PACKS` ↔ `SYSTEM_CONNECTOR_DEFAULTS` baseline duplication is verified by the `mapping-baseline-divergence` inventory invariant (ADR-0009, implemented in #974). This invariant ensures the two systems agree on baseline field mappings while both are active.

#### Phase 2: Per-tenant migration

When a tenant's mappings are fully represented in `ConnectorMappingVersion` for a given connector:
- Their `ChannelMappingTemplate` entries for that connector become read-only
- `getEffectiveMapping()` resolves through the System B bridge (priority level 3) and never falls through to `MAPPING_PACKS` (level 4)
- The tenant experiences no behavior change — the mapping output is identical

This is a per-tenant, per-connector migration. It does not require a big-bang cutover.

#### Phase 3: Legacy removal (per-connector)

When all tenants have been migrated for a connector:
- The connector's `MAPPING_PACKS` entry can be removed
- The `ChannelMappingTemplate` rows for that connector can be archived
- `getEffectiveMapping()` no longer needs the System B bridge or the `MAPPING_PACKS` fallback for that connector

Phase 3 for a connector requires:
- Zero active `ChannelMappingTemplate` rows for that connector across all tenants
- `resolveEffectiveMapping()` produces identical output to `getEffectiveMapping()` for all tenant+category combinations
- The `mapping-baseline-divergence` invariant continues passing (baselines in sync until `MAPPING_PACKS` entry is removed)

### 4. Mapping application expansion

`applyMappedConnectorTargets()` is currently limited to Shopify and WooCommerce. Expanding it to other Tier-1 connectors is a per-connector decision requiring:
- A feature flag (env var, defaults to `"false"`)
- Integration tests verifying the mapped payload matches provider expectations
- Shadow-mode validation: apply mapping, compare with existing `buildPayload()` output, log divergences, do not change the published payload
- PO approval to enable the flag

This expansion is blocked by the architecture freeze (no connector migration until the architecture gate passes). The feature flag pattern and shadow-mode validation approach are defined here so implementation can begin after the gate.

### 5. Tier-2 mapping path

Tier-2 connectors currently have no field mapping — they receive raw `ProductPayload` and handle transformation internally via `buildPayload()`. For a Tier-2 connector to gain field mapping without becoming Tier-1:

- Add a `SYSTEM_CONNECTOR_DEFAULTS` entry (System B only — no `MAPPING_PACKS` entry needed)
- Implement `applyMappedConnectorTargets()` support for the connector (behind feature flag)
- The connector remains Tier-2 (not in `MARKETPLACE_CHANNELS`) but gains platform-applied mapping

This path allows connectors like Odoo or PrestaShop to benefit from the mapping system without the full Tier-1 commitment (dedicated UI, design tokens, readiness panels).

---

## Machine-Checkable Invariants

| ID | Description | Severity | Check |
|----|-------------|----------|-------|
| `frontend-api-channel-sync` | Frontend `MARKETPLACE_CHANNELS` matches API `MARKETPLACE_CHANNELS` | ERROR | Compare `apps/web/src/lib/marketplace-channels.ts` with `apps/api/src/marketplace/marketplace-channels.ts` |
| `tier1-has-both-baselines` | Every Tier-1 connector has both a `MAPPING_PACKS` entry and a `SYSTEM_CONNECTOR_DEFAULTS` entry | ERROR | Already implemented as `mapping-baseline-divergence` + `tier1-missing-system-default-baseline` |
| `mapping-application-has-flag` | Every connector in `applyMappedConnectorTargets()` is gated by a feature flag | WARNING | Grep for connector slug checks in `applyMappedConnectorTargets` without corresponding env var gate |

---

## Consequences

### Positive

- **Clear migration path:** Three phases with defined entry/exit criteria replace the current "both systems exist" ambiguity.
- **No big-bang cutover:** Per-tenant, per-connector migration allows incremental rollout with rollback.
- **Tier-2 mapping path:** Connectors can gain mapping without the full Tier-1 surface area, reducing the pressure to prematurely promote connectors.

### Negative

- **Dual-system maintenance:** Both mapping systems must be maintained during Phase 1 and Phase 2. The `mapping-baseline-divergence` invariant catches drift but does not eliminate the maintenance burden.
- **Frontend synchronization:** Until the frontend derives its channel list from the API, manual synchronization is required for every tier change.

### Neutral

- The architecture freeze prevents any mapping migration work until the gate passes. This ADR establishes the strategy; execution is post-gate.
- `MAPPING_PACKS` removal (Phase 3) is per-connector and may never complete for all connectors simultaneously. The system must tolerate a mixed state indefinitely.

---

## Migration Invariant

Vexa must safely support mixed legacy and vNext connector states.
