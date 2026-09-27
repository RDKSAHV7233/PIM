# Vexa PIM — Source-Generated Connector Inventory

> **Generated:** 2026-09-26T19:31:33.008Z
> **Source:** `origin/main`
> **Script:** `scripts/generate-connector-inventory.cjs`

## Summary

- **Canonical slugs:** 15
- **Compiled in registry:** 15
- **Definition seeded (DB row):** 13
- **Runtime registered:** 13
- **Customer-visible:** 5
- **Installable:** 7
- **Tier-1 (marketplace):** 6
- **Tier-2 (generic):** 9

### Findings by Severity

- **ERROR** (architecture invariant violation — CI blocks): 5
- **WARNING** (incomplete/unverified state — CI reports): 3
- **INFO** (intentional design difference): 0
- **EXCEPTION** (explicitly approved variance): 0

## Inventory

| Slug | Adapter | Status | Capabilities | Stage | DB Row | Runtime | Installable | Visible | Cred UI | Tier | Finding |
|------|---------|--------|-------------|-------|--------|---------|-------------|---------|---------|------|---------|
| amazon-in | YES | stub | PUBLISH, VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE | under_development | YES | YES | NO | NO | YES | Tier-1 (marketplace) | WARNING: stub-implementation-but-runtime-registered |
| bigcommerce | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | YES | YES | NO | NO | NO | Tier-2 (generic) | — |
| dynamics-365 | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | YES | YES | NO | NO | NO | Tier-2 (generic) | — |
| ebay | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | YES | YES | NO | NO | NO | Tier-2 (generic) | — |
| etsy | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | YES | YES | NO | NO | NO | Tier-2 (generic) | — |
| flipkart | YES | full | PUBLISH, VALIDATE, STATUS_SYNC, EXCEL_EXPORT | live | YES | YES | YES | YES | YES | Tier-1 (marketplace) | — |
| meesho | YES | partial | VALIDATE, EXCEL_EXPORT | manual | YES | YES | YES | YES | YES | Tier-1 (marketplace) | — |
| myntra | YES | partial | PUBLISH, VALIDATE, STATUS_SYNC | live | NO | NO | YES | YES | YES | Tier-1 (marketplace) | ERROR: customer-visible-but-not-runtime-registered; ERROR: installable-stage-but-not-runtime-registered; ERROR: tier1-but-not-runtime-registered |
| nykaa | YES | partial | VALIDATE, EXCEL_EXPORT | manual | NO | NO | YES | YES | NO | Tier-2 (generic) | ERROR: customer-visible-but-not-runtime-registered; ERROR: installable-stage-but-not-runtime-registered |
| odoo | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | po_review | YES | YES | YES | NO | NO | Tier-2 (generic) | WARNING: runtime-registered-but-no-credential-ui |
| prestashop | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | po_review | YES | YES | YES | NO | NO | Tier-2 (generic) | WARNING: runtime-registered-but-no-credential-ui |
| shopify | YES | full | PUBLISH, VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE | live | YES | YES | YES | YES | YES | Tier-1 (marketplace) | — |
| shopware | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | YES | YES | NO | NO | NO | Tier-2 (generic) | — |
| woocommerce | YES | partial | PUBLISH, VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE | p1_blocker_hold | YES | YES | NO | NO | YES | Tier-1 (marketplace) | — |
| zoho-inventory | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | YES | YES | NO | NO | NO | Tier-2 (generic) | — |

## Findings

### 🔴 ERROR

**myntra** — `customer-visible-but-not-runtime-registered`

Launch stage is "live" (customer-visible) but no connector_definitions migration seeds a row for "myntra" — this connector is unreachable at runtime.

**myntra** — `installable-stage-but-not-runtime-registered`

Launch stage "live" is in isInstallableStage() but no DB row exists.

**myntra** — `tier1-but-not-runtime-registered`

Connector is in Tier-1 MARKETPLACE_CHANNELS but has no connector_definitions row — Tier-1 implies runtime availability.

**nykaa** — `customer-visible-but-not-runtime-registered`

Launch stage is "manual" (customer-visible) but no connector_definitions migration seeds a row for "nykaa" — this connector is unreachable at runtime.

**nykaa** — `installable-stage-but-not-runtime-registered`

Launch stage "manual" is in isInstallableStage() but no DB row exists.

### 🟡 WARNING

**amazon-in** — `stub-implementation-but-runtime-registered`

Implementation is marked as "stub" but the connector is active in the DB — methods may throw NotImplementedError at runtime.

**odoo** — `runtime-registered-but-no-credential-ui`

Connector is runtime-registered but has no credential UI branch in the setup page.

**prestashop** — `runtime-registered-but-no-credential-ui`

Connector is runtime-registered but has no credential UI branch in the setup page.
