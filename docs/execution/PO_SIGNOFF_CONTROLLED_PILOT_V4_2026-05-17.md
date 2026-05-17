# Vexa PIM — PO Sign-Off V4
## Controlled Paid Pilot Approval (Supersedes V3)

**Date:** 2026-05-17
**Signed by:** Product Owner
**Evidence basis:** Deep Functional Review Report 2026-05-17 against HEAD on `claude/distracted-gagarin-2032bb` (worktree base `f6f9ce2`, post-PR-#71); CTO Execution Memo 2026-05-17.
**Supersedes:** [V3 — 2026-05-06](./PO_SIGNOFF_CONTROLLED_PILOT_2026-05-06.md)
**Status:** ✅ APPROVED — Controlled paid pilot for early SMB / mid-market ecommerce customers

---

> This document is binding for all investor demo, sales, and marketing materials from 2026-05-17 onwards.
> Any claim not listed in **Approved Claims** below requires a new PO sign-off (V5+) before use.
> V3 (2026-05-06) is superseded in its entirety. References to V3 in active sales materials must be retired within 14 days.

---

## What Changed From V3

Three claims move from **Forbidden** to **Approved**, and two new restrictions are added.

### Moved to Approved Claims

1. **Approval comments** — `ApprovalComment` model, `POST/GET /catalog/products/:id/review-comments` endpoints, and the UI form/list in `/quality/approvals` are all proven in current code. Integration test `approval-comments.test.cjs` exists and is wired into the increment gate as a named step (added 2026-05-17). The V3 unlock condition ("ApprovalComment model, API, and UI built and tested") is fully met.

2. **Product activity timeline** — `GET /catalog/products/:id/activity` endpoint, `getProductActivity()` service method, and `"activity"` product detail tab are all proven. Integration test `product-activity-timeline.test.cjs` exists and is wired into the gate. Backing query path is now indexed via migration `20260517000002_auditlog_resource_action_index` (ADR-005).

3. **OIDC SSO login + admin IdP configuration with step-up auth** — INC-39 merged. OIDC login flow at `/auth/oidc/login` is proven. ENG-P1-2 admin UI shipped in this sprint: `/admin/auth-policy/oidc` provides self-serve IdP configuration, guarded by both the admin role and step-up password confirmation (new scope `auth_config_high_risk` on `@RequireStepUp` + `StepUpGuard`). **Bounded claim still applies**: OIDC *enforcement* (require-OIDC-for-all-users) remains gated on Gate C closure. See ADR-010.

### New Restrictions

1. **Browser-only live Shopify dev-store proof** — added to Forbidden. Bulk publish exists as a script (`apps/api/scripts/bulk-publish-shopify.cjs`); 4 integration tests cover payload, webhooks, runtime, and publication targets; but no recorded browser session against a Shopify dev store is committed to the repo. Sales materials may not show numerical Shopify publish volume claims (e.g., "100 products published") until ENG-P2-5 ships a CTO-approved recorded session.

2. **OIDC fully enforced** — added to Forbidden. OIDC login works; "enforced" implies admin UI for IdP config and Gate C closure, both pending.

---

## Approval Statement

As PO, I approve Vexa for controlled paid pilots with early SMB and mid-market ecommerce customers using the bounded claims below.

I do not approve enterprise-ready, AI-powered, WooCommerce-ready, full marketplace, self-serve SaaS billing, browser-only Shopify proof, OIDC-enforced, or Amazon-India-ready claims. Those remain roadmap items until implemented, tested, reflected in the user guide, and re-signed in a future V5+ sign-off.

---

## Approved Claims

The following claims are proven and safe to use in investor demos, sales materials, and marketing:

| Area | Safe Claim |
|---|---|
| Catalog | Full product and variant management with dynamic category attributes, completeness scoring, and lifecycle status |
| Import | 4-step guided import wizard with file preflight, field mapping, per-row error repair, CSV error report; Large Import Mode for 10K–30K row CSVs |
| Approval | Approve/reject workflow with field-level before/after revision evidence in the reviewer workspace |
| **Approval Comments** *(new in V4)* | Reviewer comment thread per product with actor and role, displayed in approval queue and product detail |
| **Product Activity Timeline** *(new in V4)* | Per-product activity feed sourced from the audit trail with actor, role, action, and timestamp |
| Compliance | Per-category required-field, regex, and value-in-set rules with per-product validation issues |
| Channels | Live Shopify and Flipkart connectors with channel readiness simulation, image validation, and versioned mapping templates |
| Connector Ops | Encrypted credential management (AES-256-GCM with key versioning), sync logs, dead-letter visibility, retry, and requeue |
| Audit | Comprehensive audit trail — major catalog, workflow, connector, webhook, billing-governance, and access operations captured with actor, role, and timestamp |
| Security | JWT + TOTP MFA + backup codes + step-up authentication + account lockout + password reset |
| **OIDC SSO + self-serve IdP admin (bounded)** *(new in V4)* | OIDC SSO login is available; admins can self-configure their identity provider with step-up password confirmation. OIDC enforcement (require-OIDC) remains gated. |
| Tenant Isolation | Per-workspace data isolation via PostgreSQL RLS, verified by integration tests |
| API + Webhooks | REST API with Swagger/OpenAPI, scoped API keys, HMAC-signed outbound webhooks with delivery log |
| Deployment | 3-stage hosting runbooks (Stage 1/2/3); Railway-first deployment; Dockerfile.api, Dockerfile.web |
| Billing Governance | Plan tiers, usage metering, trial/grace/suspension lifecycle. Payment-processor-ready schema. |
| Smart Suggestions | Rule-based suggestions engine for title, attribute, and category improvements based on product context |

### Official approved safe claim (use verbatim)

> Vexa PIM is sellable for controlled paid pilots and early SMB / mid-market ecommerce customers. It has proven workflows for catalog management, import preflight and row repair, approval review with revision evidence and approval comments, product activity timeline, connector and mapping management, Shopify and Flipkart publish readiness, sync recovery, audit visibility, account security foundations (TOTP MFA + backup codes + step-up + lockout), API keys with scope enforcement, HMAC-signed outbound webhooks, and billing governance (plan tiers, usage metering, commercial request lifecycle). OIDC SSO login is available with operator-mediated configuration. It is not yet enterprise-ready. Self-serve billing, WooCommerce, full marketplace coverage (Amazon gated, Meesho not yet available), dedicated enterprise role shells, OIDC self-serve configuration with full enforcement, browser-only live Shopify proof, and true AI/LLM enrichment remain future-scope.

---

## Forbidden Claims

The following claims must not be used in any investor demo, sales material, marketing, or public communication until the stated unlock condition is met and a new PO sign-off is recorded.

| Forbidden Claim | Unlock Condition |
|---|---|
| Enterprise-ready | SSO admin UI shipped, SCIM available, dedicated enterprise role shells, Gate C closed |
| AI-powered enrichment / AI suggestions / AI-assisted | Real LLM integration implemented, tested, and reflected in user guide (ADR-009) |
| WooCommerce ready | WooCommerce connector built, tested, and documented |
| Full marketplace coverage | All claimed channels live, tested, and documented |
| Self-serve SaaS billing | Payment processor integrated, end-to-end billing lifecycle tested (ADR-008) |
| Tamper-evident audit log | Cryptographic chaining, WORM storage, or immutable external sink implemented |
| Production-ready for all customer segments | All known test failures resolved, SaaS billing live, enterprise readiness complete |
| Full DAM replacement | Dedicated DAM capabilities built and proven |
| Amazon India ready | FEATURE_REAL_SPAPI_VALIDATION=true, sandbox tested, connector documented |
| **Meesho export works** *(new in V4)* | ExcelJS template implemented; `generateExportFile()` returns successfully (currently throws Not Implemented) |
| **Browser-only live Shopify dev-store proof** *(new in V4)* | Committed Playwright recording against a Shopify dev store (ENG-P2-5) |
| **OIDC fully enforced** *(new in V4)* | Admin IdP configuration UI shipped (ENG-P1-2) AND Gate C closed |
| **"100+ products published to Shopify"** *(new in V4)* | Recorded session showing the publish volume |

---

## Decisions Carried Forward From V3

Still binding:

| # | Decision | Resolution |
|---|---|---|
| 1 | Smart Suggestions: keep rule-based permanently or approve LLM integration? | Frozen rule-based. ADR-009 binding. |
| 2 | Billing: choose Stripe or Razorpay for self-serve checkout | Deferred. ADR-008 binding. |
| 3 | Amazon India: required for first pilots or remains gated roadmap? | Gated roadmap. FEATURE_REAL_SPAPI_VALIDATION stays false for pilot customers. |
| 4 | Enterprise UX shells | Roadmap-only. Not promised to any pilot customer. |

---

## Open Sales Blockers — Engineering In Flight

| Priority | Gap | Owner | Target |
|---|---|---|---|
| P1 | Close INC-10 Flipkart publish loop (remove `allowFailure=true` from idempotency gate) | Connector lead | 2026-06-07 (ENG-P1-1) |
| ~~P1~~ | ~~OIDC admin IdP configuration UI~~ | ~~Frontend + Auth pair~~ | ✅ Shipped 2026-05-17 (ENG-P1-2) — admin UI + auth_config_high_risk step-up scope |
| P1 | Fresh staging rollout snapshot with full schema field set | DevOps | 2026-05-21 (ENG-P1-3) |
| P1 | `gate:run:sprint` executed on staging with output committed | DevOps + QA | 2026-05-23 (ENG-P1-4) |
| P2 | Scheduled DB backups | DevOps | 2026-06-15 (ENG-P2-1) |
| P2 | Credential rotation automation | DevOps | 2026-06-20 (ENG-P2-2) |
| P2 | Browser-recorded Shopify dev-store proof | Connector lead + QA | 2026-05-30 (ENG-P2-5) |
| P2 | Localization UI (Markets, Currencies, Price Lists admin) | Frontend | 2026-06-30 (ENG-P2-6) |

---

## Ideal Pilot Customer Profile

**Suitable for:**
- Indian D2C brand or SMB seller with 500–5,000 SKUs
- Selling on Shopify and/or Flipkart
- Currently managing catalog in spreadsheets or basic ERP export
- Needs import tooling, compliance checking, team approval workflow with comments, and channel publish automation
- Tenants needing SSO are eligible via the operator-mediated OIDC onboarding path

**Not yet suitable for:**
- Enterprise customers requiring self-serve SSO admin UI or SCIM
- Self-serve credit-card onboarding
- WooCommerce-primary sellers
- Amazon India as primary channel
- Meesho-primary sellers (export not yet implemented)
- Customers requiring tamper-evident audit logs

---

## Pricing — Binding for Q3 2026 Pilot Window

| Tier | SKUs | Channels | Setup | Monthly |
|---|---|---|---|---|
| **Pilot (90 days)** | up to 5,000 | Shopify + Flipkart | ₹75,000 | ₹45,000 |
| **Starter** | 1,000 | 2 | ₹25,000 | ₹25,000 |
| **Growth** | 5,000 | 3 | ₹50,000 | ₹45,000 |
| **Scale** | 15,000 | 4 | ₹100,000 | ₹75,000 |
| **Custom / Enterprise** | 15,000+ | 5+ | Negotiated | Negotiated; **gated pending Gate C** |

Pilot setup fee credited to month 4+ on conversion. Seat pricing: 5 included, ₹2,000/seat/month thereafter. Annual prepay: 20% discount. No free trials.

---

## Governance Notes

- This sign-off is binding for all investor demo, sales, and marketing materials from 2026-05-17 onwards.
- V3 is superseded. References to V3 in active sales materials must be retired within 14 days.
- Any claim not listed in **Approved Claims** requires a new PO sign-off (V5+) before use.
- This document is updated when any Forbidden Claim is implemented, tested, and verified in a future audit report.
- Per CTO Execution Memo proposal: PO sign-offs auto-trigger a re-audit after 30 days regardless of code changes. Next re-audit scheduled no later than 2026-06-17.

---

## Report Lineage

| Report | Date | HEAD | Status |
|---|---|---|---|
| V1 | 2026-03-?? | `ca5251c8` | ❌ Superseded — false critical blockers |
| V2 | 2026-04-?? | Partial inspection pre INC-33–36 | ❌ Superseded — stale for 5 claims |
| V3 | 2026-05-06 | `e5f10a25` | ❌ Superseded — stale for approval comments + activity + OIDC |
| **V4** | **2026-05-17** | **Worktree base `f6f9ce2` + claude/distracted-gagarin-2032bb sprint pass** | ✅ **Authoritative — current sign-off** |
