# ADR-0007: Connector Certification and Evidence Model

**Status**: Proposed
**Date**: 2026-09-27
**Author**: Gate 0 architecture sprint
**Gate**: Gate 0 — ADR-003

---

## Context

The connector framework has 12 launch stages but no formal model for what evidence is required to transition between them. Gate 0 revealed connectors at stages their evidence does not support — Myntra at `live` with no runtime registration, Amazon at `under_development` with `stub` implementation but full DB activation. Without a certification model, stage transitions are ad-hoc and unverifiable.

This ADR defines what evidence is required at each stage, at the capability level, and how that evidence is recorded and verified.

---

## Decision

### 1. Capability-Level Certification

Certification is per-capability, not per-connector. A connector declaring `['PUBLISH', 'VALIDATE', 'STATUS_SYNC']` must have independent certification evidence for each capability. A connector can be partially certified — e.g., VALIDATE is certified but PUBLISH is not.

#### Capability Certification States

| State | Meaning |
|-------|---------|
| `untested` | Code exists but has never been exercised against real or simulated provider data |
| `unit_tested` | Passes unit tests with mocked provider responses |
| `integration_tested` | Passes integration tests with simulated provider (local HTTP stub or sandbox) |
| `sandbox_verified` | Tested against provider's sandbox/staging environment with real credentials |
| `production_verified` | Tested against provider's production environment with real data |
| `certified` | Passed full QA cycle, security review, and CTO/PO signoff |

#### Current Capability Certification (Gate 0 baseline)

| Slug | PUBLISH | VALIDATE | STATUS_SYNC | WEBHOOK_RECEIVE | EXCEL_EXPORT | BULK_PUBLISH |
|------|---------|----------|-------------|-----------------|--------------|--------------|
| amazon-in | untested | untested | untested | untested | — | — |
| bigcommerce | untested | untested | untested | — | — | — |
| dynamics-365 | untested | untested | untested | — | — | — |
| ebay | unit_tested | unit_tested | unit_tested | — | — | — |
| etsy | sandbox_verified | sandbox_verified | untested | — | — | — |
| flipkart | production_verified | production_verified | production_verified | — | production_verified | — |
| meesho | — | integration_tested | — | — | production_verified | — |
| myntra | untested | integration_tested | untested | — | — | — |
| nykaa | — | integration_tested | — | — | integration_tested | — |
| odoo | unit_tested | unit_tested | unit_tested | — | — | — |
| prestashop | unit_tested | unit_tested | unit_tested | — | — | — |
| shopify | production_verified | production_verified | production_verified | production_verified | — | — |
| shopware | untested | untested | untested | — | — | — |
| woocommerce | integration_tested | integration_tested | integration_tested | integration_tested | — | integration_tested |
| zoho-inventory | untested | untested | untested | — | — | — |

### 2. Stage Transition Evidence Requirements

Each launch stage transition requires specific evidence. The evidence is cumulative — advancing to a later stage requires all evidence from earlier stages.

| Transition | Required Evidence |
|-----------|------------------|
| `planned` → `under_development` | Adapter scaffold created, slug registered in constants |
| `under_development` → `code_complete` | All declared capabilities implemented (no `NotImplementedError`), `implementationStatus` ≥ `partial`, unit tests pass |
| `code_complete` → `qa_validation` | Integration tests pass, credential form implemented (if applicable), `connector_definitions` migration created |
| `qa_validation` → `po_review` | QA sign-off on all declared capabilities, known limitations documented |
| `po_review` → `early_access` | PO approval, security review (for auth/credential handling), deployment verification in staging |
| `early_access` → `live` | At least one tenant exercised successfully in staging, all capabilities at ≥ `sandbox_verified`, CTO/PO/QA/Security/SRE signoff |
| `early_access` → `manual` | Export workflow verified, upload guide written, at least one category template verified against provider |
| `live` → `deprecated` | Sunset timeline communicated to active tenants, replacement identified |
| `deprecated` → `sunset` | Zero active tenants, data migration complete |
| Any → `p1_blocker_hold` | P1 issue filed, blocking criteria documented |
| `p1_blocker_hold` → previous stage | P1 issue resolved, evidence of fix, regression test added |
| Any → `disabled` | Emergency: CTO authorization, incident reference |

### 3. Evidence Recording

Evidence is recorded in the source-generated inventory and in the launch policy's pipeline metadata. The inventory script can verify that evidence exists for the current stage.

#### Evidence Sources

| Evidence Type | Where Recorded |
|---------------|---------------|
| Unit test existence | `connectors/<slug>/*.spec.ts` — inventory detects file presence |
| Integration test existence | `test/integration/*-runtime-foundation.test.cjs` |
| Credential form | `connector-credential-fields.tsx` — inventory detects slug branch |
| Migration/DB row | `packages/db/prisma/migrations/` — inventory detects INSERT |
| Known limitations | `docs/product/known-limitations.md` — inventory detects mention |
| Security review | Pipeline metadata `blockers` / `internalNotes` in launch policy |
| CTO/PO signoff | PR approval + label on stage-transition PR |
| Production verification | Pipeline metadata `internalNotes` + Sentry/monitoring evidence |

#### Future Enhancement: Evidence Manifest

When the inventory script is extended (Work Item 1+), each connector's JSON entry should include an `evidence` object:

```json
{
  "slug": "shopify",
  "evidence": {
    "unitTests": true,
    "integrationTests": true,
    "credentialForm": true,
    "migrationSeeded": true,
    "knownLimitationsDocumented": true,
    "securityReviewed": true,
    "productionVerified": true,
    "capabilities": {
      "PUBLISH": "production_verified",
      "VALIDATE": "production_verified",
      "STATUS_SYNC": "production_verified",
      "WEBHOOK_RECEIVE": "production_verified"
    }
  }
}
```

### 4. Certification Gate Rules

These rules determine when the inventory should raise findings for certification gaps:

| Rule | Severity | When Raised |
|------|----------|-------------|
| Customer-visible stage without production-verified capabilities | ERROR | Any `live` connector has `untested` capabilities |
| Manual stage without integration-tested export | WARNING | `manual` connector has `untested` EXCEL_EXPORT |
| Installable stage without unit tests | WARNING | No `*.spec.ts` for connector at ≥ `code_complete` |
| Code-complete without credential form | WARNING | ≥ `code_complete` and `authType ≠ 'NONE'` but no credential UI |
| Stage advancement without migration | ERROR | ≥ `qa_validation` without `connector_definitions` row |

---

## Consequences

- **Stage transitions become auditable.** Each transition has defined evidence requirements. The inventory script can check whether the evidence exists for the current stage.
- **Capability-level granularity prevents false confidence.** A connector with production-verified VALIDATE but untested PUBLISH cannot claim full certification.
- **The Gate 0 baseline is now recorded.** The certification table above is the starting point. As connectors are developed and tested, their capability states advance.
- **Future CI enhancement.** The inventory script can be extended to verify certification evidence as part of CI, blocking PRs that advance launch stages without meeting evidence requirements.
- **No code changes today.** This ADR defines the model. Implementation in the inventory script is a future work item.

---

## Related

- ADR-0005: Connector Platform Boundaries
- ADR-0006: Connector Identity, State, and Availability
- `scripts/generate-connector-inventory.cjs`: Evidence verification (future enhancement)
- `connector-launch-policy.ts`: Pipeline metadata contains some evidence signals
