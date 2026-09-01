# Launch Readiness Pack

Last reviewed: 2026-09-01

Status: active working pack

This pack prepares the CTO/PO launch review. It does not approve launch.

## Current Launch Verdict

Broad production and paid-pilot readiness are not established. The latest
evidence includes `docs/test-plan/production-readiness-qa-results-2026-08-24.md`
and the 2026-09-01 live browser verification on app.vexapim.com.

Current gate summary:

| Gate | Current state | Required before pass |
| --- | --- | --- |
| Shopify technical P0 | Partial live evidence | Connector healthy, 31 SUCCESS / 5 ERROR, all readiness green for sampled product. Remaining: variant/metafield data-integrity investigation and full P0 evidence closure |
| WooCommerce technical P0 | Substantially advanced | #660 FIXED (0 PENDING, 56/65 SUCCESS, fresh test publish SUCCESS in seconds). Multi-variant publishes succeed. Remaining: full edit→approve→republish cycle, store/admin evidence |
| Plan commercial truth | Substantially advanced | #663 FIXED (SKU meter variant-based, 65/100K, copy correct). ENTERPRISE active, no self-serve checkout. Remaining: Product/Commercial owner signoff |
| Cross-cutting regression | Partial local coverage | Targeted web blocker contracts now pass for selected auth/admin/commercial/ops/catalog/channel flows; run agreed full regression sweep on current code/environment |
| Paid pilot readiness | Not ready | All mandatory gates pass or receive explicit signed scope reduction |

## Required Launch Documents

| Document | Exists today | Current status | Action needed |
| --- | --- | --- | --- |
| Current-state summary | Yes: `docs/execution/CURRENT_STATE.md` | Current | Keep updated after any readiness change |
| Production-readiness QA result | Yes: `docs/test-plan/production-readiness-qa-results-2026-08-24.md` | Current blocker authority | Rerun after fixes |
| Connector index | Yes: `docs/connectors/README.md` | Current | Keep launch stages aligned with code |
| Known limitations | Yes: `docs/product/known-limitations.md` | Current | Review before any customer handoff |
| Pilot scope | Yes: `docs/pilot-scope.md` | Current controlled-evaluation scope | Fill per-tenant owner/evidence references |
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

- WooCommerce live P0: #660 (terminal status) confirmed FIXED on 1/9/2026 (0 PENDING, 56/65 SUCCESS, fresh publish SUCCESS in seconds). Bulk publish accounting (#661) partially verified (single-product pass). Full edit→approve→republish cycle (#662) not executed but multi-variant publishes stable. Store/admin evidence still pending.
- Plan-commercial: #663 (SKU billing) confirmed FIXED on 1/9/2026 (SKU meter 65/100K variant-based, copy correct). Product/Commercial owner signoff still pending.
- Shopify remaining P0 evidence and variant/metafield data-integrity investigation. Connector healthy and live with 31 SUCCESS submissions; product-level readiness green for sampled product.
- Complete cross-cutting regression sweep for current code/environment. The 2026-08-30 broad web integration run exposed failures and was interrupted during a long-running public signup web-flow; follow-up targeted blocker contracts passed locally on 2026-09-01, but this is not a full sweep pass.
- Re-run auth-cookie CSRF and MFA login DB proof with required runtime configuration: `JWT_SECRET`, `PIM_API_BASE_URL`, and `AUTH_MODE=db`.
- Local API startup timeout was traced to slow `AppModule` import on the Windows-mounted checkout; the relevant API-backed commercial, privacy, and connector-access harnesses now use a configurable 240-second startup budget and pass locally after direct `tsc` rebuild.
- Dedicated API-key integration coverage now also passes locally after the fixture creates migrated viewer credentials and promotes the tenant to an Enterprise quota before multiple key assertions.
- Plan-commercial #663 local policy evidence now passes: product approval creates a single canonical variant when needed, SKU usage remains variant-based, and billing/web copy reflects that definition.
- Legal placeholders in MSA, SLA, cookie policy, and AUP.
- Ops/support placeholders for named on-call contacts, incident escalation, tenant support-channel approval, backup/restore proof, and SLO telemetry.
- Claims governance: proof references are empty, so public claims remain blocked.
