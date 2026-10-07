# SEC-DB-RLS-001 phase 2: database call-site classification and the migration plan

Date: 2026-10-06
Baseline: `origin/main` at `1712c465`
Issue: #1189. Decision pack: #1188. Machine-readable inventory: [`sec-db-rls-001-call-sites.v1.json`](sec-db-rls-001-call-sites.v1.json).
Type: **classification and tooling. No production access, no application behaviour change.**

## 1. What this adds

1. An inventory of every database call site that behaves differently under a non-superuser, non-owner, RLS-enforced runtime role: 32 files that use the context-free `PrismaDirectService`, 9 raw-SQL files that use `tenant()` with no argument, and 81 raw SQL call sites across 20 files.
2. A **ratchet** (`scripts/validate-sec-db-call-sites.cjs`, run in CI with negative tests). It fails when a new file uses `PrismaDirectService`, when raw SQL or a `tenant()`-no-argument raw scan grows, when a new `PrismaClient` is constructed, or when an inventory entry lacks a class, plan, remediation or **positive-result assertion**. This is the "no new privileged database consumers" interim control. It only ratchets down: sites may migrate, none may be added.
3. The migration plan below.

## 2. Classes

| Class | Meaning | Under a restricted role | Files |
|---|---|---|---|
| **A** | cross-tenant discovery or aggregation through a client with no tenant context | silently sees only the `default` tenant | 10 |
| **A2** | cross-tenant raw scan using `tenant()` with no argument | silently `default` only | 3 |
| **B** | tenant is known, but the direct (no-context) client is used | writes fail loudly, reads return empty | 18 |
| **C** | pre-tenant bootstrap or platform lookup needing a decision | mixed | 3 (+ Stripe) |
| **R** | request-scoped raw SQL through `tenant()` with no argument | correct only while the request tenant equals the filter tenant | 3 |
| **D** | already on an approved path | works | 1 |

## 3. Remediation rule (owner decision, 2026-10-07, on the production evidence D-022)

- **Tenant iteration.** Iterate tenants from the authoritative directory and act inside each tenant's own context (`runWithTenantContext`, already used by the export-job reconciliation, or `prisma.tenant(key)`). This is the only remediation for a cross-tenant job that runs inside the API process.
- **No policy may grant cross-tenant access on the strength of a session setting that the ordinary runtime can set.** The ordinary runtime identity can activate any custom setting, so such a policy is a privilege path inside the ordinary runtime and not a separately governed one. This includes the two platform-wide operator dashboards (`internal-ops-alerts`, `internal-ops-summary`) and the AI control plane (`app.ai_maintenance`), which iterate tenants instead.
- **No general-purpose cross-tenant runtime role, and no BYPASSRLS maintenance role created to preserve a shortcut.** A cross-tenant read that cannot iterate runs outside the API as an operator script under a separately governed read-only identity (`vexa_reporter`).
- **Every migrated job must prove a positive result**: seed data for a non-default tenant and assert the job produced a non-empty outcome. "No error" is not a pass, because the dominant failure under RLS is silence. The assertion is recorded per entry as `positiveAssertion` and the ratchet requires it.

## 4. Inventory by class

**A: cross-tenant discovery (tenant iteration)**
`bulk-edit-stale-operation-recovery`, `bulk-import-stale-row-recovery`, `connector-webhook-lease-sweeper`, `connector-heartbeat`, `woocommerce-reconciliation`, `export-job-reconciliation` (the per-row step already iterates; discovery does not), `media-integrity.service`, `plan-usage` (the nightly rollup discovers tenants across six tables), the two operator dashboards, and `intelligence-reservation-maintenance` (the AI reservation sweeper and counter audit).

**A2: `tenant()` with no argument in scheduled scans**
`grace-period-escalation` (billing enforcement would silently cover only `default`), `commercial-reminders`, `outbound-webhooks` stuck-delivery recovery.

**B: mechanical, use `tenant(tenantKey)`**
`credential-encryption.service` (the reproduced failure: RLS violation, HTTP 500 on a Shopify install), `connector-credential.service`, the connector classes (`amazon`, `bigcommerce`, `dynamics365`, `ebay`, `etsy`, `flipkart`, `myntra`, `odoo`, `prestashop`, `shopware`, `zoho-inventory`, `woocommerce`), `shopify.connector` (needs a read to confirm which client it receives), the two WooCommerce services, `media.service`.

**C: decisions**
`auth.service` (mostly `tenant(tenantId)` already; two direct uses are pre-tenant lookups on an unscoped table; review each), `tenant-directory.service` (directory lookups stay; **provisioning seeds move to the tenant client**, reproduced as a silent failure), `commercial-requests.service` (platform-admin cross-tenant listing: tenant iteration), and **Stripe** (customer id to tenant resolution reads `TenantPlanProfile` with no tenant context before the tenant is known; `stripe_webhook_events` is a non-RLS global ledger).

**R: pass the tenant explicitly**
`bulk-import.service`, `catalog.service`, `connector-permission.service`: request-scoped raw SQL with a manual tenant filter. Correct today; passing `tenant(tenantKey)` removes the chance that context and filter disagree, and queue workers must restore tenant context.

## 5. Shared pieces to build once

- **A tenant iteration helper**: list tenants from the authoritative directory (`WorkspaceDirectory`, an unscoped table by design, plus the default tenant), run a callback per tenant inside its own context, isolate failures per tenant, and emit per-tenant counts so a job that processes zero tenants is visible. Backend decides the exact shape; the A and A2 PRs share it.
- **A restricted-role test lane** (next step): CI creates the restricted role with explicit repo-defined grants, seeds through a separate admin identity, and runs the tenant-boundary suites plus the positive assertions in section 3.

## 6. Migration PR slicing (each independently releasable, each with its positive-result assertions)

| PR | Content | Risk |
|---|---|---|
| M1 | class B connector and credential access to the tenant client (18 files, mechanical) | low; loud failure mode |
| M2 | tenant provisioning seeds to the tenant client; auth review (C) | medium |
| M3 | cross-tenant sweepers and reconciliation to tenant iteration (A), built on the shared helper | medium; **silent** failure mode, hence the assertions |
| M4 | billing: `plan-usage`, `grace-period-escalation`, `commercial-reminders`, `outbound-webhooks` (A, A2) | high impact, silent; ships behind the restricted-role lane |
| M5 | operator dashboards via tenant iteration (A) | medium |
| M6 | R: explicit tenant arguments; Stripe and commercial-requests decisions | low to medium |

Every PR runs under the restricted-role lane before merging; none changes production privileges.

## 7. Limits

This is a static classification plus the earlier dry run. It identifies each site's class and the reason; it does not execute every job under a restricted role. The restricted-role lane and the per-job positive assertions are what turn it into proof. Class decisions marked `decision-needed` or `review` are open for the named owners.
