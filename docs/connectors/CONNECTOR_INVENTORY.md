# Vexa PIM — Source-Generated Connector Inventory

> **Generated:** 2026-09-27T17:00:12.832Z
> **Source:** `origin/main`
> **Script:** `scripts/generate-connector-inventory.cjs`

## Summary

- **Canonical slugs:** 15
- **Compiled in registry:** 15
- **Definition seeded (DB row):** 13
- **Runtime registered:** 13
- **Customer-visible:** 3
- **Installable:** 5
- **Tier-1 (marketplace):** 5
- **Tier-2 (generic):** 10

### Findings by Severity

- **ERROR** (architecture invariant violation — CI blocks): 0
- **WARNING** (incomplete/unverified state — CI reports): 4
- **INFO** (intentional design difference): 3
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
| meesho | YES | partial | VALIDATE, EXCEL_EXPORT | manual | YES | YES | YES | YES | YES | Tier-1 (marketplace) | WARNING: tier1-schema-missing-bridge; INFO: schema-template-stale |
| myntra | YES | partial | PUBLISH, VALIDATE, STATUS_SYNC | under_development | NO | NO | NO | NO | YES | Tier-2 (generic) | INFO: schema-template-stale |
| nykaa | YES | partial | VALIDATE, EXCEL_EXPORT | under_development | NO | NO | NO | NO | NO | Tier-2 (generic) | INFO: schema-template-stale |
| odoo | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | po_review | YES | YES | YES | NO | NO | Tier-2 (generic) | WARNING: runtime-registered-but-no-credential-ui |
| prestashop | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | po_review | YES | YES | YES | NO | NO | Tier-2 (generic) | WARNING: runtime-registered-but-no-credential-ui |
| shopify | YES | full | PUBLISH, VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE | live | YES | YES | YES | YES | YES | Tier-1 (marketplace) | — |
| shopware | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | YES | YES | NO | NO | NO | Tier-2 (generic) | — |
| woocommerce | YES | partial | PUBLISH, VALIDATE, STATUS_SYNC, WEBHOOK_RECEIVE | p1_blocker_hold | YES | YES | NO | NO | YES | Tier-1 (marketplace) | — |
| zoho-inventory | YES | full | PUBLISH, VALIDATE, STATUS_SYNC | under_development | YES | YES | NO | NO | NO | Tier-2 (generic) | — |

## Findings

### 🟡 WARNING

**amazon-in** — `stub-implementation-but-runtime-registered`

Implementation is marked as "stub" but the connector is active in the DB — methods may throw NotImplementedError at runtime.

**odoo** — `runtime-registered-but-no-credential-ui`

Connector is runtime-registered but has no credential UI branch in the setup page.

**prestashop** — `runtime-registered-but-no-credential-ui`

Connector is runtime-registered but has no credential UI branch in the setup page.

**meesho** — `tier1-schema-missing-bridge`

Tier-1 connector "meesho" has a local category registry (meesho-category-templates.ts) but no bridge function to ProductTypeSchema. ADR-0008 §1 requires all local registries to bridge to the canonical contract.

### 🔵 INFO

**meesho** — `schema-template-stale`

Local schema registry for "meesho" has templateVerifiedAt dates older than 90 days (123 days). ADR-0008 §2 requires quarterly review for local_registry sources.

**myntra** — `schema-template-stale`

Local schema registry for "myntra" has templateVerifiedAt dates older than 90 days (108 days). ADR-0008 §2 requires quarterly review for local_registry sources.

**nykaa** — `schema-template-stale`

Local schema registry for "nykaa" has templateVerifiedAt dates older than 90 days (108 days). ADR-0008 §2 requires quarterly review for local_registry sources.
