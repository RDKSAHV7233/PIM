# Vexa PIM — Source-Generated Connector Inventory

> **Generated:** 2026-09-26T18:59:38.848Z
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

## Inventory

| Slug | Adapter | Status | Capabilities | Stage | DB Row | Runtime | Installable | Visible | Cred UI | Tier | Inconsistency |
|------|---------|--------|-------------|-------|--------|---------|-------------|---------|---------|------|---------------|
| amazon-in | ✅ | stub | PUBLISH, VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE | under_development | ✅ | ✅ | ❌ | ❌ | ✅ | Tier-1 (marketplace) | stub-implementation-but-runtime-registered |
| bigcommerce | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | ✅ | ✅ | ❌ | ❌ | ❌ | Tier-2 (generic) | — |
| dynamics-365 | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | ✅ | ✅ | ❌ | ❌ | ❌ | Tier-2 (generic) | — |
| ebay | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | ✅ | ✅ | ❌ | ❌ | ❌ | Tier-2 (generic) | — |
| etsy | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | ✅ | ✅ | ❌ | ❌ | ❌ | Tier-2 (generic) | — |
| flipkart | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC, EXCEL_EXPORT | live | ✅ | ✅ | ✅ | ✅ | ✅ | Tier-1 (marketplace) | — |
| meesho | ✅ | partial | VALIDATE, EXCEL_EXPORT | manual | ✅ | ✅ | ✅ | ✅ | ✅ | Tier-1 (marketplace) | — |
| myntra | ✅ | partial | PUBLISH, VALIDATE, STATUS_SYNC | live | ❌ | ❌ | ✅ | ✅ | ✅ | Tier-1 (marketplace) | customer-visible-but-not-runtime-registered, installable-stage-but-not-runtime-registered |
| nykaa | ✅ | partial | VALIDATE, EXCEL_EXPORT | manual | ❌ | ❌ | ✅ | ✅ | ❌ | Tier-2 (generic) | customer-visible-but-not-runtime-registered, installable-stage-but-not-runtime-registered |
| odoo | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC | po_review | ✅ | ✅ | ✅ | ❌ | ❌ | Tier-2 (generic) | runtime-registered-but-no-credential-ui |
| prestashop | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC | po_review | ✅ | ✅ | ✅ | ❌ | ❌ | Tier-2 (generic) | runtime-registered-but-no-credential-ui |
| shopify | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE | live | ✅ | ✅ | ✅ | ✅ | ✅ | Tier-1 (marketplace) | — |
| shopware | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | ✅ | ✅ | ❌ | ❌ | ❌ | Tier-2 (generic) | — |
| woocommerce | ✅ | partial | PUBLISH, VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE | p1_blocker_hold | ✅ | ✅ | ❌ | ❌ | ✅ | Tier-1 (marketplace) | — |
| zoho-inventory | ✅ | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | ✅ | ✅ | ❌ | ❌ | ❌ | Tier-2 (generic) | — |

## ⚠️ Inconsistencies Detected

### amazon-in: stub-implementation-but-runtime-registered

Implementation is marked as "stub" but the connector is active in the DB — methods may throw NotImplementedError at runtime.

### myntra: customer-visible-but-not-runtime-registered

Launch stage is "live" (customer-visible) but no connector_definitions migration seeds a row for "myntra" — this connector is unreachable at runtime.

### myntra: installable-stage-but-not-runtime-registered

Launch stage "live" is in isInstallableStage() but no DB row exists.

### nykaa: customer-visible-but-not-runtime-registered

Launch stage is "manual" (customer-visible) but no connector_definitions migration seeds a row for "nykaa" — this connector is unreachable at runtime.

### nykaa: installable-stage-but-not-runtime-registered

Launch stage "manual" is in isInstallableStage() but no DB row exists.

### odoo: runtime-registered-but-no-credential-ui

Connector is runtime-registered but has no credential UI branch in the setup page.

### prestashop: runtime-registered-but-no-credential-ui

Connector is runtime-registered but has no credential UI branch in the setup page.
