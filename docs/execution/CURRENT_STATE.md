# Vexa PIM Current State

Last reviewed: 2026-09-04

This is the canonical repository state summary. Code, live QA evidence, and the
current governance files override dated execution notes, review memos, old root
audit exports, and imported planning documents.

## Executive Status

Vexa PIM has substantial implemented product depth: catalog management, product
workflow, quality review, bulk import, bulk edit, connector installation,
mapping, publishing/export jobs, admin governance, privacy workflows, API keys,
webhooks, plan metadata, and operations recovery surfaces all exist in code.

Current release truth:

- **Commercial readiness: CONTROLLED PILOT HOLD**. The 2026-09-03 CTO/PO
  controlled-pilot approval is superseded for onboarding by the P1 blocker
  closure review. Customer onboarding remains paused until P1-2 auth revocation
  implementation and P1-1 Woo app-auth verification are reviewed, CI-verified,
  staged, runtime-proven, and re-signed.
- **Engineering: BLOCKER CLOSURE REQUIRED** for the P1 auth revocation and Woo
  app-auth tenant-ownership findings. Optimization and general readiness
  expansion remain blocked until those gates are closed.
- **GA: NOT APPROVED.** Deferred items (VAPT, restore drill, legal counsel
  review, secondary on-call, store-admin evidence) remain named GA blockers
  with owners and target dates. They must not quietly disappear because the
  pilot starts.
- **First-tenant go-live: PENDING** — requires named tenant, defined scope,
  signed minimum legal terms, support/escalation channel, and completed tenant
  onboarding record.
- **Next formal review: 2026-09-10** or immediately after first tenant
  onboarding, whichever comes first.
- Public marketing claims are **blocked** until the current Claims Matrix,
  restricted Proof Registry, privacy/security/legal approvals, and browser
  evidence are available.
- Public pricing is **blocked**. Public plan pages may show plan names,
  outcome-led descriptions, and approved CTAs only.

### Controlled Pilot Scope

```text
Pilot tier:            Not authorized while P1 hold is open
Tenant count:          0 until re-signed
Supported connectors:  None for customer onboarding until P1-2 implementation
                       and required fixes are reviewed and verified
Operating mode:        blocker closure / internal evidence only
No promise of:         broad GA support, unmanaged/self-service onboarding,
                       enterprise SLA beyond signed pilot terms, unverified
                       connector capabilities, 5k-20k native bulk architecture
```

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
| WooCommerce | `woocommerce` | P1 blocker-closure hold (restored 2026-10-05) | Technically available for controlled engineering use; new installs and customer rollout are paused until named CTO/PO/Security/QA/SRE approvals and production RLS evidence are recorded (`docs/decisions/DR-2026-10-05-woocommerce-p1-governance.md`). Manual API-key installation is the supported onboarding; app-auth is unsupported. The 2026-10-03 closure (#1052, #1059) is historical and superseded. #660/#662 evidence remains historical remediation context, not current onboarding approval. |

## Latest Readiness Evidence

Latest production-readiness QA evidence is split between the broader live pass,
the local remediation pack, and three consecutive browser verifications:

- `docs/test-plan/production-readiness-qa-results-2026-08-24.md`
- `docs/readiness/WOOCOMMERCE_REMEDIATION_EVIDENCE_PACK_2026-08-29.md`
- Browser verifications: 2026-08-24, 2026-09-01, 2026-09-03 (all Admin role,
  app.vexapim.com — no regressions across three passes)

Current gate summary:

- Shopify technical P0: **PARTIAL LIVE EVIDENCE**; connector healthy, live
  publish maturity, 31 SUCCESS / 5 ERROR submissions, all product readiness
  dimensions green for sampled product. Metafield investigation: 0 definitions,
  0 collections, 0 taxonomy nodes configured; all 13 Shopify errors are
  missing-image data quality. No multi-variant products in catalog. Remaining:
  seed multi-variant + metafield test data, store/admin evidence.
- WooCommerce technical P0: **SUBSTANTIALLY ADVANCED**; #660 FIXED, #662
  VERIFIED (full edit→approve→republish cycle on VX0109897 → SUCCESS at
  1/9/2026, 11:00:03 PM). Channel simulator Export Ready, Risk 0.
  Store-admin evidence still pending.
- Plan commercial truth: **SUBSTANTIALLY ADVANCED**; #663 (SKU billing)
  confirmed FIXED in live environment (SKU meter shows 65/100K variant-based
  from 21,513 products, copy matches variant-based definition). ENTERPRISE plan
  active, no self-serve checkout, no public pricing shown. Product/Commercial
  owner signoff still pending.
- Cross-cutting regression: **NEAR-FULL LOCAL COVERAGE**; API unit tests:
  62/63 suites passed, 1277/1295 tests passed (18 skipped), 0 failures. Web
  integration tests: 180/183 passed (98%), 3 remaining. Known environment
  blockers: auth-cookie-csrf, error-authority-env-contract (need runtime
  config). Known pre-existing: public-signup-web-flow (hang). 8 UI contract
  assertion drift tests fixed on 2026-09-02.
- Paid Pilot Readiness: **CONTROLLED PILOT HOLD**. The 2026-09-03 CTO/PO
  decision is superseded for onboarding until P1-2 auth revocation
  implementation, P1-1 Woo app-auth verification, CI/staging/runtime evidence,
  and fresh CTO/PO/Security/QA/SRE signoff are complete.

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
- Multi-variant WooCommerce submissions (2–3 attempts) all reached SUCCESS in the
  submission log. Channel simulator for sampled product: Export Ready Yes,
  Risk Score 0, Compliance 0/0.
- Bulk publish panel correctly shows eligible product count (31 of Ready
  products), confirmation dialog works, submission feedback banner renders.
- Shopify connector detail: 0 metafield definitions, 0 collections, 0 taxonomy
  nodes imported. All 13 Shopify errors are "A primary HTTPS image is required
  for Shopify sync" (data quality, not connector). No multi-variant products
  exist in the catalog — all products have only canonical variants.
- Edit→approve→republish cycle verified end-to-end: VX0109897 reverted to
  draft, description edited, submitted for review, approved, queued WooCommerce
  export, reached SUCCESS at 1/9/2026, 11:00:03 PM.

### Confirmed blocker themes

- **#660 (stuck-PENDING): FIXED** — confirmed with fresh live evidence on
  1/9/2026. WooCommerce submissions now reach terminal SUCCESS status.
- **#663 (SKU billing): FIXED** — confirmed in live SKU meter and plan copy.
- **#662 (variant edit/republish): VERIFIED** — full edit→approve→republish
  cycle executed on VX0109897: revert to draft → edit description → save →
  submit for review → approve → queue WooCommerce export → SUCCESS at
  1/9/2026, 11:00:03 PM.
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
