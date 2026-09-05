# Launch Readiness Pack

Last reviewed: 2026-09-04

Status: active working pack

This pack prepares the CTO/PO launch review. It does not approve launch.

## Current Launch Verdict

Broad production and paid-pilot readiness are not established. The 2026-09-03
controlled-pilot approval is superseded for onboarding by the P1 blocker-closure
hold. The latest historical evidence includes
`docs/test-plan/production-readiness-qa-results-2026-08-24.md` and the
2026-09-03 live browser verification on app.vexapim.com, but those records do
not close the P1-1 Woo app-auth or P1-2 auth revocation gates.

Current gate summary:

| Gate | Current state | Required before pass |
| --- | --- | --- |
| Shopify technical P0 | Partial live evidence | Connector healthy (2 connected, 0 attention, Live publish). Metafield investigation: 0 definitions configured. All 13 errors are missing-image data quality. Remaining: seed multi-variant + metafield test data, store/admin evidence |
| WooCommerce technical P0 | P1 blocker-closure hold | #660 FIXED, #662 VERIFIED as historical remediation evidence. WooCommerce is hidden/blocked from customer setup and install lanes until P1-1/P1-2 review, CI, staging runtime proof, and fresh signoff. Remaining: store/admin evidence |
| Plan commercial truth | Substantially advanced | #663 FIXED. Re-verified 2026-09-03: SKU meter 65/100K, ENTERPRISE active paid, billing month 2026-09. Remaining: Product/Commercial owner signoff |
| Cross-cutting regression | Near-full local coverage | API: 62/63 suites, 1277/1295 tests passed. Web: 180/183 passed (98%), 3 env-blocked. 8 UI contract assertions fixed 2026-09-02 |
| Paid pilot readiness | CONTROLLED PILOT HOLD | P1-2 auth revocation implementation review, P1-1 Woo app-auth CI/staging/runtime verification, and fresh CTO/PO/Security/QA/SRE signoff required |

## Required Launch Documents

| Document | Exists today | Current status | Action needed |
| --- | --- | --- | --- |
| Current-state summary | Yes: `docs/execution/CURRENT_STATE.md` | Current | Keep updated after any readiness change |
| Production-readiness QA result | Yes: `docs/test-plan/production-readiness-qa-results-2026-08-24.md` | Current blocker authority | Rerun after fixes |
| Connector index | Yes: `docs/connectors/README.md` | Current | Keep launch stages aligned with code |
| Known limitations | Yes: `docs/product/known-limitations.md` | Current | Review before any customer handoff |
| Pilot scope | Yes: `docs/pilot-scope.md` | Current hold authority | Reopen only after P1 closure and fresh signoff |
| Legal pack | Partial: `docs/legal/*` | Not customer-ready | Legal to fill placeholders and approve |
| Ops/support pack | Partial: `docs/runbooks/*` | Not signoff-ready; pilot support draft exists | Fill named contacts, restore proof, SLO/on-call evidence, and tenant support approvals |
| Claim-to-proof pack | Partial: `docs/marketing/*`, `marketing/*` | Blocked; public CTA policy guard passes after 2026-08-30 correction | Add restricted proof references and approvals |
| Security/privacy evidence pack | Partial: security/privacy docs exist | Needs current evidence bundle | Build evidence references and owner signoff |

## CTO Exit Criteria

- Current code branch and environment are identified.
- Build, lint, API tests, web tests, and relevant integration/e2e suites pass or have named accepted exceptions.
- Connector launch-stage policy matches docs and UI.
- Tenant isolation, RBAC, admin boundaries, credential handling, audit, export, and deletion paths have current evidence.
- Queue, Redis, database, object storage, and deploy rollback behavior have current operational proof.
- No public claim depends on historical-only evidence.

## PO Exit Criteria

- Pilot scope is specific to tenant, plan, roles, connectors, support path, and evaluation window.
- Customer-facing copy matches approved claims and known limitations.
- Pricing, plan limits, trial language, checkout behavior, and commercial routing match the restricted commercial authority.
- WooCommerce, Amazon India, Meesho, Nykaa, ONDC, SLA, SSO, automation, and enterprise claims are either approved with proof or explicitly out of scope.
- Support/customer-success workflow is ready before customer access.

## Immediate Blockers To Close

- WooCommerce live P0: #660 FIXED, #662 VERIFIED (full edit→approve→republish cycle on VX0109897 reached SUCCESS at 1/9/2026, 11:00:03 PM). Bulk publish accounting (#661) partially verified (single-product pass). Store/admin evidence still pending.
- Plan-commercial: #663 (SKU billing) confirmed FIXED on 1/9/2026 (SKU meter 65/100K variant-based, copy correct). Product/Commercial owner signoff still pending.
- Shopify variant/metafield investigation complete: 0 metafield definitions configured, 0 collections, 0 taxonomy nodes imported. All 13 errors are "A primary HTTPS image is required" (data quality). No multi-variant products in catalog — variant/metafield sync cannot be tested without seeded test data. Connector healthy with 31 SUCCESS submissions.
- Cross-cutting regression sweep executed 1/9/2026, contract test fixes applied 2/9/2026. API: 62/63 suites passed, 1277/1295 tests (18 skipped), 0 failures. Web: 180/183 passed (98%), 3 remaining — 2 env-config (auth-cookie-csrf, error-authority-env-contract need JWT_SECRET/PIM_API_BASE_URL/AUTH_MODE=db), 1 pre-existing hang (public-signup-web-flow). 8 UI contract assertion drift tests fixed: quality-approvals, quality-reviewer-role, rejection-route, search-route, shopify-connector-portfolio-context, shopify-managed-install-handoff, publish-export-pilot-proof, version-manager-responsive.
- Re-run auth-cookie CSRF and MFA login DB proof with required runtime configuration: `JWT_SECRET`, `PIM_API_BASE_URL`, and `AUTH_MODE=db`.
- Local API startup timeout was traced to slow `AppModule` import on the Windows-mounted checkout; the relevant API-backed commercial, privacy, and connector-access harnesses now use a configurable 240-second startup budget and pass locally after direct `tsc` rebuild.
- Dedicated API-key integration coverage now also passes locally after the fixture creates migrated viewer credentials and promotes the tenant to an Enterprise quota before multiple key assertions.
- Plan-commercial #663 local policy evidence now passes: product approval creates a single canonical variant when needed, SKU usage remains variant-based, and billing/web copy reflects that definition.
- Legal placeholders: MSA and SLA remain skeleton-only. Cookie policy updated 2026-09-03 with verified technical inventory (6 cookies, no analytics/marketing cookies). AUP contact and response targets filled. Privacy policy contact filled. Data localisation timestamp refreshed. All still require legal counsel review before publication.
- Ops/support: on-call contacts filled (sole operator — CTO). Incident response runbook complete with severity matrix, triage checklist, and customer comms templates. Secondary on-call not yet assigned. Restore drill, SLO telemetry, and tenant support-channel approval remain pending.
- Claims governance: proof-references.json populated with 14 repo-safe evidence entries (PRF-REG-001 through PRF-REMEDIATION-001). Claims.json upgraded from MISSING_CURRENT_AUTHORITY to PARTIAL_EVIDENCE_AVAILABLE. WooCommerce historical remediation evidence exists, but current WooCommerce claims are blocker-closure hold. Shopify direct-token claims remain CONTROLLED_PILOT_ONLY. Public claims remain blocked until Marketing/Legal approve.
- CTO controlled-pilot launch decision recorded 2026-09-03: superseded for
  onboarding by the P1 blocker-closure hold. Treat TEAM_SIGNOFF_MATRIX as
  historical decision context until P1-2 implementation review, P1-1 verification, and
  fresh CTO/PO/Security/QA/SRE signoff are complete.
