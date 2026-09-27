# ADR-0005: Connector Platform Boundaries

**Status**: Accepted
**Date**: 2026-09-27
**Author**: Gate 0 architecture sprint
**Gate**: Gate 0 — ADR-001

---

## Context

The Vexa PIM connector framework has grown to 15 connectors spanning API-integrated marketplaces (Shopify, Flipkart), export-only workflows (Meesho, Nykaa), and stubs under development (Amazon, BigCommerce). As the framework scales, responsibilities are intermixed: the registry manages both compile-time wiring and runtime activation, the launch policy governs both visibility and certification state, and individual connector files handle protocol, auth, and payload in a single class.

Gate 0 inventory analysis (PR #970) revealed 8 findings where boundaries were violated: connectors marked "live" but unreachable at runtime, stubs registered as if production-ready, and Tier-1 connectors without DB activation. These are symptoms of unclear boundaries between what governs connectors, what runs them, and what they actually do.

This ADR establishes four architecture boundaries for the connector platform. The goal is not to refactor today — it is to name the planes so that future work can be scoped correctly, and so inventory tooling can verify invariants at each boundary.

---

## Decision

The connector platform is organized into four planes. Each plane has a defined responsibility, a defined owner surface (the files/modules that implement it), and defined invariants that the source-generated inventory can verify.

### 1. Connector Control Plane

**Responsibility:** Decides which connectors exist, what stage they are at, and what is required to advance them. Owns launch governance, certification state, and lifecycle transitions.

**Owner surface:**
- `connector-launch-policy.ts` — `resolveConnectorLaunchPolicy()`, `isCustomerVisibleStage()`, `isInstallableStage()`, pipeline metadata
- `connector.constants.ts` — canonical slug registry (`CONNECTOR_SLUGS`)
- `docs/connectors/CONNECTOR_EXCEPTIONS.json` — explicitly approved variances

**Invariants:**
- Every slug in `CONNECTOR_SLUGS` must have a corresponding block in `resolveConnectorLaunchPolicy()`
- A connector at a customer-visible stage (`live`, `manual`) must have a `connector_definitions` row (enforced by inventory ERROR finding)
- A connector at an installable stage must have a `connector_definitions` row
- A Tier-1 connector (in `MARKETPLACE_CHANNELS`) must have a `connector_definitions` row OR an approved EXCEPTION
- Launch stage transitions require evidence (ADR-0007)

**Does not own:** Runtime registration, credential storage, API communication.

### 2. PIM / Syndication Plane

**Responsibility:** Manages product data, marketplace-specific field mapping, submission orchestration, and export file generation. This is the business logic that transforms PIM catalog data into marketplace-ready payloads.

**Owner surface:**
- `marketplace/marketplace.service.ts` — `MAPPING_PACKS`, field mapping, submission orchestration
- `marketplace/marketplace-channels.ts` — Tier-1 channel list, channel-to-slug mapping
- `catalog/` — product data, validation, import/export
- Per-connector `buildPayload()` / `generateExportFile()` methods (delegated to Provider Adapter)

**Invariants:**
- Every channel in `MARKETPLACE_CHANNELS` must map to a valid connector slug
- Every Tier-1 connector must have a mapping pack in `MAPPING_PACKS` OR be explicitly excepted
- Field mappings must be reversible (PIM field → marketplace field → PIM field round-trips)

**Does not own:** Connector lifecycle state, credential management, API protocol.

### 3. Connector Runtime

**Responsibility:** Manages the lifecycle of connector instances at runtime. Owns the two-stage registration (compile-time wiring → runtime activation), credential vault, health probing, and instance resolution.

**Owner surface:**
- `connector.registry.ts` — `implementationMap` (compile), `refreshFromDefinitions()` (activate), `getConnector()`
- `connector-framework.module.ts` — NestJS DI wiring
- `connector-installer.service.ts` — credential capture, encrypted storage, per-connector install flows
- `connector.interface.ts` — `ConnectorInterface`, `ConnectorCap`, `ConnectorImplementationStatus`
- Prisma `connector_definitions` table — runtime activation source of truth
- Prisma migrations that seed `connector_definitions` rows

**Invariants:**
- `implementationMap` must contain every slug in `CONNECTOR_SLUGS` (compile-time completeness)
- Runtime `connectors` map only contains slugs with active `connector_definitions` rows (fail-closed in staging/production)
- A connector in the runtime map must have an adapter class that implements `ConnectorInterface`
- Credential vault operations must use encryption-at-rest for secret fields

**Does not own:** Launch governance, marketplace field mapping, provider-specific protocol.

### 4. Provider Adapter

**Responsibility:** Implements the per-provider protocol: API communication, authentication, payload construction, error normalization, and response parsing. Each adapter is a self-contained unit that knows how to talk to one external marketplace.

**Owner surface:**
- `connectors/<slug>/*.connector.ts` — main adapter class
- `connectors/<slug>/*-category-rules.ts` or `*-category-templates.ts` — provider-specific validation rules
- `connectors/<slug>/*.service.ts` — optional service files for complex flows (e.g., bulk publish)
- `connectors/<slug>/*.spec.ts` — adapter unit tests

**Invariants:**
- Every adapter must declare `slug`, `implementationStatus`, and `capabilities`
- `implementationStatus: "stub"` means methods may throw `NotImplementedError` — the adapter must not be at a customer-visible stage
- Every capability declared must have a corresponding method implementation (or explicit `NotImplementedError` if stub)
- Auth credential field names must match what `connector-credential-fields.tsx` renders

**Does not own:** Whether the connector is active, what stage it is at, or how it is registered.

---

## Boundary Crossing Rules

1. **Control Plane → Runtime:** The Control Plane decides launch stage; the Runtime decides activation. A connector can be at `live` stage only if the Runtime has a DB row for it. The inventory script enforces this as an ERROR.

2. **Runtime → Provider Adapter:** The Runtime resolves a connector instance by slug. The Provider Adapter does not self-register — it is wired at compile time and activated by the Runtime's DB query.

3. **Syndication Plane → Provider Adapter:** The Syndication Plane provides mapped product data. The Provider Adapter builds the provider-specific payload. The Syndication Plane does not know about provider API details.

4. **Control Plane → Syndication Plane:** The Control Plane's launch stage determines whether a connector appears in install flows. The Syndication Plane's Tier-1 membership is a business decision that must be consistent with the Control Plane's stage (enforced by inventory ERROR `tier1-but-not-runtime-registered`).

---

## Consequences

- **Inventory findings map to boundary violations:** Each ERROR finding in the source-generated inventory corresponds to a specific boundary invariant being violated. This makes the inventory a boundary enforcement tool, not just a documentation generator.
- **Future refactoring has named targets:** When splitting `connector-installer.service.ts` or `marketplace.service.ts`, the split follows these boundaries.
- **New connectors have a checklist:** Each plane defines what a new connector must provide before advancing to the next launch stage.
- **No code changes today:** This ADR names boundaries in existing code. It does not reorganize files or add new abstractions.

---

## Related

- ADR-0006: Connector Identity, State, and Availability
- ADR-0007: Certification and Evidence Model
- PR #970: Source-generated connector inventory
- `scripts/generate-connector-inventory.cjs`: Boundary invariant enforcement
