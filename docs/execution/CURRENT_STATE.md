# Vexa PIM Current State

Last reviewed: 2026-09-01

This is the canonical repository state summary. Code, live QA evidence, and the
current governance files override dated execution notes, review memos, old root
audit exports, and imported planning documents.

## Executive Status

Vexa PIM has substantial implemented product depth: catalog management, product
workflow, quality review, bulk import, bulk edit, connector installation,
mapping, publishing/export jobs, admin governance, privacy workflows, API keys,
webhooks, plan metadata, and operations recovery surfaces all exist in code.

Current release truth:

- Broad production / paid-pilot readiness is **not established**.
- Public marketing claims are **blocked** until the current Claims Matrix,
  restricted Proof Registry, privacy/security/legal approvals, and browser
  evidence are available.
- Public pricing is **blocked**. Public plan pages may show plan names,
  outcome-led descriptions, and approved CTAs only.
- WooCommerce is code-complete but **not GA / not public-sellable** until QA and
  PO review close the remaining live production-readiness findings.
- Shopify direct-token publishing is materially stronger than WooCommerce in
  the latest production QA pass, but Shopify paid-pilot readiness is still not a
  clean PASS because required P0/commercial/regression evidence remains open.

## Current Code-Truth Snapshot

- Web route inventory: `69` `page.tsx` routes under `apps/web/src/app`.
- App roles: `admin`, `editor`, `publisher`, `approver`,
  `channel_manager`, `connector_admin`, `reviewer`, and `viewer`.
- Admin boundary roles: `product_admin`, `system_admin`, and `super_admin`.
- Category slugs and variant SKU codes are tenant-scoped in Prisma:
  `@@unique([tenantKey, slug])` and `@@unique([tenantKey, skuCode])`.
- Public signup exists in code but remains feature-flagged.
- AI Labs, ONDC, and internal developer pages are environment/role gated.
- Queue-backed operations use local fallback or BullMQ/Redis depending on
  environment configuration.

## Current Route Reality

Current page routes include:

- public/auth: `/login*`, `/signup*`, `/consent`, `/account-suspended`
- workspace: `/dashboard`, `/search`, `/notifications`
- catalog: `/catalog/*`, `/products/[id]`
- quality: `/quality*`, `/rejection`
- channels: `/channels*`, `/connectors*`
- operations: `/operations*`
- admin/settings: `/admin*`, `/settings*`
- internal or experimental: `/ai`, `/internal/developer`, `/ondc`, `/media`

Redirect-style or compatibility paths include:

- `/`
- `/catalog`
- `/reports`
- `/products`
- `/settings/plan`
- `/settings/connectors`
- `/settings/privacy`
- `/connectors/[installationId]/mapping`

## Connector Reality

Connector implementation and launch-stage policy are separate. A connector can
exist in code and still be blocked from public GA claims.

| Connector | Slug | Current policy | Public/readiness note |
| --- | --- | --- | --- |
| Amazon India | `amazon-in` | under development | Install and credential validation are available; publish/status sync remain under validation. |
| Flipkart | `flipkart` | live | GA/default fallback connector. |
| Meesho | `meesho` | manual export | Export-only; direct API access remains blocked on Meesho partner access. |
| Myntra | `myntra` | live | API access requires account-manager enablement. |
| Nykaa | `nykaa` | manual export | Seller upload workflow; direct API requires partner credentials. |
| Shopify | `shopify` | live | Direct-token publishing, selected edit/republish, status sync, reconnect validation, jobs visibility, and manual bulk publish up to 50. Managed OAuth, webhook subscriptions, and multi-image sync are not production-verified. |
| WooCommerce | `woocommerce` | code complete | Installable/code-complete; GA sign-off is blocked on QA validation and PO review. Not public-sellable. |

## Latest Readiness Evidence

Latest production-readiness QA evidence is split between the broader live pass,
the local remediation pack, and the 2026-09-01 live browser verification:

- `docs/test-plan/production-readiness-qa-results-2026-08-24.md`
- `docs/readiness/WOOCOMMERCE_REMEDIATION_EVIDENCE_PACK_2026-08-29.md`
- 2026-09-01 browser verification on app.vexapim.com (Admin role, Claude Browser)

Current gate summary:

- Shopify technical P0: **PARTIAL LIVE EVIDENCE**; connector healthy, live
  publish maturity, 31 SUCCESS / 5 ERROR submissions, all product readiness
  dimensions green for sampled product. Remaining: variant/metafield
  data-integrity investigation, full P0 evidence closure.
- WooCommerce technical P0: **SUBSTANTIALLY ADVANCED**; #660 (stuck-PENDING)
  confirmed FIXED with fresh live evidence (0 PENDING, 56/65 SUCCESS, fresh test
  publish reached SUCCESS in seconds). Multi-variant publishes (2–3 items) all
  SUCCESS. Channel simulator Export Ready, Risk 0. Full edit→approve→republish
  cycle and store-admin evidence still pending.
- Plan commercial truth: **SUBSTANTIALLY ADVANCED**; #663 (SKU billing)
  confirmed FIXED in live environment (SKU meter shows 65/100K variant-based
  from 21,513 products, copy matches variant-based definition). ENTERPRISE plan
  active, no self-serve checkout, no public pricing shown. Product/Commercial
  owner signoff still pending.
- Cross-cutting regression: **PARTIAL LOCAL COVERAGE**; targeted browser specs
  pass, selected API-backed commercial/privacy/access checks pass locally after
  startup harness hardening, and the 2026-09-01 targeted web-regression blocker
  verification passes locally for auth/admin contracts, commercial/dashboard signup
  controls, connector operations, catalog filters, bulk import/edit, mapping,
  product-detail fetch orchestration, Internal Ops fallback UI, and pending
  action feedback. Full sweep still pending.
- Paid Pilot Readiness: **NOT READY**

### 2026-09-01 Browser Verification Evidence

Live browser verification on app.vexapim.com (Admin role) produced the
following evidence on 1 September 2026:

- Both connectors ACTIVE, Healthy, Live publish maturity. Shopify: 42 products
  with submission history. WooCommerce: 55 products with submission history.
- Submission log: 101 total, 0 PENDING, 87 SUCCESS, 14 ERROR. Every submission
  reaches a terminal state.
- WooCommerce went from 0/83 SUCCESS (2026-08-24 QA) to 56/65 SUCCESS (86%).
  Fresh test publish of "AeroLite Formal Flat Front Trousers Navy VX0109940"
  reached SUCCESS at 1/9/2026, 9:58:57 PM.
- SKU meter: 65 / 100,000. Copy reads: "A simple product counts as 1 SKU. A
  product with multiple variants counts once per sellable variant." Confirms
  variant-based counting per #663 fix.
- Plan: ENTERPRISE, billing active, billing month 2026-09. No self-serve
  checkout. Plan comparison cards show 5 tiers without public pricing.
- Product channel readiness sampled: "FreshNest Checked Work Shirt Charcoal
  VX0109908" shows OK Shopify, OK WooCommerce, all dimensions green for
  Shopify, Connected + Approved + Completed for WooCommerce.
- Multi-variant WooCommerce submissions (2–3 items) all reached SUCCESS in the
  submission log. Channel simulator for sampled product: Export Ready Yes,
  Risk Score 0, Compliance 0/0.
- Bulk publish panel correctly shows eligible product count (31 of Ready
  products), confirmation dialog works, submission feedback banner renders.

### Confirmed blocker themes

- **#660 (stuck-PENDING): FIXED** — confirmed with fresh live evidence on
  1/9/2026. WooCommerce submissions now reach terminal SUCCESS status.
- **#663 (SKU billing): FIXED** — confirmed in live SKU meter and plan copy.
- **#662 (variant edit/republish): STABLE** — multi-variant publishes succeed,
  product pages load without crash, but full edit→approve→republish cycle not
  executed in this verification.
- **#661 (bulk count integrity): PARTIAL** — single-product bulk publish test
  passed with correct submission count; not retested at scale.
- Several required evidence items remain blocked by credential-gated admin/store
  checks or unavailable second-tenant/backend-authority proof.
- The broad 2026-08-30 web integration sweep was interrupted after exposing
  multiple failures and a long-running public signup web-flow hang. Targeted
  failures from that run were remediated locally, but the full run-all result is
  not a pass and must be rerun with the required environment.

The 2026-08-30 local WooCommerce remediation pack upgrades engineering
remediation to code-complete evidence, including targeted browser E2E coverage.
The 2026-09-01 browser verification provides fresh live connector and
submission evidence. GA/public claims still require store-admin proof,
restricted proof IDs, and required-team approval.

## Commercial And Marketing Truth

Canonical commercial docs:

- `docs/product/pricing.md`
- `docs/product/commercial-policy.md`
- `docs/product/claim-register.md`
- `docs/marketing/claims-governance.md`
- `docs/readiness/README.md`
- `marketing/claims/claims.json`
- `marketing/claims/proof-references.json`
- `marketing/privacy/data-governance.json`

Current rules:

- No public prices, "from" prices, setup fees, implementation ranges, add-on
  prices, discount percentages, annual contract values, minimum contract values,
  or exact plan limits unless separately claim-approved.
- Trial wording is restricted to a 90-day evaluation posture.
- Self-service paid checkout remains blocked.
- Customer-facing connector, SLA, scale, SSO, automation, or enterprise claims
  require current claim-to-proof authority before publication.

## Infrastructure / DR Reality

- Staging/production Postgres currently runs as a self-hosted Railway service
  with a Railway volume, not a managed PITR service.
- The real database recovery path is daily `pg_dump` to R2, when all required
  R2 secrets are present.
- Point-in-time recovery is not available today.
- RPO/RTO targets remain pilot-level: 24h RPO and 4h RTO.
- HA, backup/restore drill, SLO, and Scale/SLA readiness require fresh
  operational proof before sign-off.

## Documentation Rule

If a dated execution note, review memo, root audit export, or imported planning
file disagrees with current code or the docs listed above:

1. trust current code and current live QA evidence
2. update the canonical docs
3. remove stale duplicates from canonical discovery paths
4. keep dated evidence only when it is still needed for audit traceability

## Readiness Preparation Pack

Use `docs/readiness/README.md` for the active CTO/PO/team preparation checklist.
It names the required team, current signoff gates, customer-pilot template,
legal/commercial/ops gaps, connector-claim boundaries, and security/privacy
evidence requirements. The pack is a working control document, not approval.
