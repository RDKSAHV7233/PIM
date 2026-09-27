# ADR-0006: Connector Identity, State, and Availability

**Status**: Accepted
**Date**: 2026-09-27
**Author**: Gate 0 architecture sprint
**Gate**: Gate 0 — ADR-002

---

## Context

The connector framework uses multiple overlapping signals to determine what a connector is and what it can do: `implementationStatus` (code readiness), `launchStage` (governance readiness), `connector_definitions` row (runtime activation), `MARKETPLACE_CHANNELS` membership (Tier-1 business priority), and credential UI presence (tenant onboarding readiness). Gate 0 analysis revealed that these signals can contradict each other — Myntra is `live` but unreachable, Amazon is `stub` but registered — because there is no formal model that defines when a connector is actually available.

This ADR formalizes the identity, state, and availability models so that each connector's effective availability can be computed deterministically from codebase sources.

---

## Decision

### 1. Connector Identity

A connector's identity is the tuple `(slug, tier, implementationStatus, capabilities)`.

| Field | Source | Mutability |
|-------|--------|------------|
| `slug` | `CONNECTOR_SLUGS` in `connector.constants.ts` | Immutable after creation |
| `tier` | Presence in `MARKETPLACE_CHANNELS` → Tier-1; else Tier-2 | Changeable via code change + ADR |
| `implementationStatus` | `*.connector.ts` class field | Tracks code readiness: `stub` → `partial` → `full` |
| `capabilities` | `*.connector.ts` class field | Array of `ConnectorCap` values the adapter declares |

**Slug is the primary key.** Every other system (registry, launch policy, migrations, UI) references connectors by slug. A slug must be unique, kebab-case, and present in `CONNECTOR_SLUGS` to be recognized.

**Tier is a business classification, not a technical one.** Tier-1 connectors are in `MARKETPLACE_CHANNELS` and have mapping packs, design tokens, and dedicated field mapping. Tier-2 connectors use the generic `ConnectorInterface` with `buildPayload()`. Tier membership does not affect runtime behavior — only the Syndication Plane's field mapping.

### 2. Connector State Model

A connector's state is determined by two independent dimensions: **code state** and **governance state**.

#### Code State (`implementationStatus`)

| Value | Meaning | Invariant |
|-------|---------|-----------|
| `stub` | Scaffold only. Methods may throw `NotImplementedError`. | Must not be at a customer-visible or installable stage |
| `partial` | Some capabilities implemented; others may be limited or export-only | May be at `manual` stage if the implemented capabilities are sufficient for the declared workflow |
| `full` | All declared capabilities are production-ready | May advance to `live` if governance requirements are met |

#### Governance State (`launchStage`)

The 12-stage lifecycle from `resolveConnectorLaunchPolicy()`:

| Stage | Customer Visible | Installable | Description |
|-------|-----------------|-------------|-------------|
| `planned` | No | No | Intent to build |
| `under_development` | No | No | Active development |
| `code_complete` | No | Yes | Code done, not yet QA'd |
| `qa_validation` | No | Yes | In QA |
| `po_review` | No | Yes | PO reviewing |
| `early_access` | No | Yes | Selected tenants only |
| `p1_blocker_hold` | No | No | Blocked on P1 issue |
| `manual` | **Yes** | Yes | Excel-export or manual workflow |
| `live` | **Yes** | Yes | Full GA |
| `deprecated` | Yes | No | Phasing out |
| `sunset` | No | No | Removed from service |
| `disabled` | No | No | Emergency disable |

**Governance state transitions require evidence** (see ADR-0007). A connector cannot jump from `under_development` to `live` without passing through intermediate stages.

### 3. Effective Availability

A connector's **effective availability** is not any single field — it is computed from the combination of state signals:

```
effectiveAvailability(slug) =
  IF slug NOT IN connector_definitions    → UNREACHABLE
  IF launchStage IN [disabled, sunset]    → OFFLINE
  IF implementationStatus = "stub"        → DEVELOPMENT_ONLY
  IF launchStage = "p1_blocker_hold"      → BLOCKED
  IF NOT hasCredentialUI(slug)            → NOT_CONFIGURABLE
  IF launchStage IN customer-visible      → AVAILABLE (live | manual)
  IF launchStage IN installable-only      → PREVIEW (code_complete | qa_validation | po_review | early_access)
  ELSE                                    → IN_DEVELOPMENT
```

| Effective Availability | Meaning | Tenant Impact |
|----------------------|---------|---------------|
| `UNREACHABLE` | No DB row — runtime will never serve this connector | Zero exposure |
| `OFFLINE` | Intentionally disabled or sunset | Previously available, now removed |
| `DEVELOPMENT_ONLY` | Stub implementation, registered for compile testing | Zero tenant exposure (should not be at visible stage) |
| `BLOCKED` | P1 blocker prevents activation | Held until blocker resolved |
| `NOT_CONFIGURABLE` | Runtime-registered but no credential UI | Tenants can see it but cannot configure |
| `AVAILABLE` | Full production availability | Tenants can install and use |
| `PREVIEW` | Pre-GA but installable for selected tenants | Limited availability |
| `IN_DEVELOPMENT` | Under active development | Not visible to tenants |

### 4. Current Inventory by Effective Availability

| Slug | Effective Availability | Reason |
|------|----------------------|--------|
| amazon-in | DEVELOPMENT_ONLY | stub implementation |
| bigcommerce | IN_DEVELOPMENT | under_development stage |
| dynamics-365 | IN_DEVELOPMENT | under_development stage |
| ebay | IN_DEVELOPMENT | under_development stage |
| etsy | IN_DEVELOPMENT | under_development stage |
| flipkart | AVAILABLE | live, full impl, DB row, credential UI |
| meesho | AVAILABLE | manual, partial (export), DB row, credential UI |
| myntra | **UNREACHABLE** | No DB row despite `live` stage |
| nykaa | **UNREACHABLE** | No DB row despite `manual` stage |
| odoo | NOT_CONFIGURABLE | po_review, DB row, no credential UI |
| prestashop | NOT_CONFIGURABLE | po_review, DB row, no credential UI |
| shopify | AVAILABLE | live, full impl, DB row, credential UI |
| shopware | IN_DEVELOPMENT | under_development stage |
| woocommerce | BLOCKED | p1_blocker_hold |
| zoho-inventory | IN_DEVELOPMENT | under_development stage |

---

## Invariant Rules

These rules are enforced by the source-generated inventory (`scripts/generate-connector-inventory.cjs`):

| Rule | Severity | Enforcement |
|------|----------|-------------|
| Customer-visible stage requires DB row | ERROR | `customer-visible-but-not-runtime-registered` |
| Installable stage requires DB row | ERROR | `installable-stage-but-not-runtime-registered` |
| Tier-1 requires DB row or EXCEPTION | ERROR | `tier1-but-not-runtime-registered` |
| Stub at runtime-registered is risky | WARNING | `stub-implementation-but-runtime-registered` |
| Installable without credential UI | WARNING | `runtime-registered-but-no-credential-ui` |

---

## Consequences

- **effectiveAvailability replaces ad-hoc checks.** Instead of checking individual signals, consumers can ask "what is this connector's effective availability?" and get a deterministic answer.
- **The inventory script can compute and report availability.** Future enhancement: add `effectiveAvailability` to the JSON inventory output.
- **Myntra and Nykaa findings are now formally classified.** Both are UNREACHABLE — their launch stages promise something the Runtime cannot deliver. Resolution requires either creating DB rows (with QA) or downgrading launch stages.
- **Stage transition governance has a reference model.** ADR-0007 defines what evidence is required for each transition.

---

## Related

- ADR-0005: Connector Platform Boundaries
- ADR-0007: Certification and Evidence Model
- `scripts/generate-connector-inventory.cjs`: Computes availability signals
- `connector-launch-policy.ts`: Governance state source
- `connector.registry.ts`: Runtime activation
