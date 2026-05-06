# Vexa PIM — PO Sign-Off
## Controlled Paid Pilot Approval

**Date:** 2026-05-06  
**Signed by:** Product Owner (bhoivishal216-ai)  
**Evidence basis:** V3 Sellability Re-Verification Report — HEAD `e5f10a25167cf7bd6d00b1117935006c789ed5e8`  
**Status:** ✅ APPROVED — Controlled paid pilot for early SMB / mid-market ecommerce customers

---

> This document is binding for all investor demo, sales, and marketing materials from 2026-05-06 onwards.  
> Any claim not listed in **Approved Claims** below requires a new PO sign-off before use.  
> This document must be updated when any Forbidden Claim is implemented, tested, and verified in a future V4 or later audit report.

---

## Approval Statement

As PO, I approve Vexa for controlled paid pilots with early SMB and mid-market ecommerce customers using bounded claims. The product has a complete sellable workflow for catalog management, import preflight, approval evidence, connector mapping, publish readiness, recovery, audit, account security, API keys, and webhooks.

I do not approve enterprise-ready, AI-powered, WooCommerce-ready, full marketplace, or self-serve SaaS claims. Those remain roadmap items until implemented, tested, and reflected in the user guide.

---

## Approved Claims

The following claims are proven and safe to use in investor demos, sales materials, and marketing:

| Area | Safe Claim |
|---|---|
| Catalog | Full product and variant management with dynamic category attributes, completeness scoring, and lifecycle status |
| Import | 4-step guided import wizard with file preflight, field mapping, per-row error repair, and CSV error report |
| Approval | Approve/reject workflow with field-level before/after revision evidence in the reviewer workspace |
| Compliance | Per-category required-field, regex, and value-in-set rules with per-product validation issues |
| Channels | Live Shopify and Flipkart connectors with channel readiness simulation, image validation, and versioned mapping templates |
| Connector Ops | Encrypted credential management, sync logs, dead-letter visibility, retry, and requeue |
| Audit | Comprehensive audit trail — major catalog, workflow, connector, webhook, billing-governance, and access operations captured with actor, role, and timestamp |
| Security | JWT + TOTP MFA + backup codes + step-up authentication + account lockout + password reset |
| Tenant Isolation | Per-workspace data isolation via PostgreSQL RLS, verified by integration tests |
| API + Webhooks | REST API with Swagger/OpenAPI, scoped API keys, HMAC-signed outbound webhooks with delivery log |
| Deployment | Deployment-oriented foundations — Dockerfile.api, Dockerfile.web, railway.json |
| Billing Governance | Plan tiers, usage metering, trial/grace/suspension lifecycle. Payment-processor-ready schema. |
| Smart Suggestions | Rule-based suggestions engine for title, attribute, and category improvements based on product context |

**Official approved safe claim (use verbatim):**

> Vexa PIM is sellable for controlled paid pilots and early SMB / mid-market customers. It has proven workflows for catalog management, import preflight and row repair, approval review with revision evidence, connector and mapping management, publish/export readiness, sync recovery, audit visibility, account security, API keys, and webhooks. It is not yet enterprise-ready. Self-serve billing, WooCommerce, full marketplace coverage, dedicated enterprise role shells, and true AI/LLM enrichment remain future-scope.

---

## Forbidden Claims

The following claims must not be used in any investor demo, sales material, marketing, or public communication until the stated unlock condition is met and a new PO sign-off is recorded.

| Forbidden Claim | Unlock Condition |
|---|---|
| Enterprise-ready | SSO/SAML, dedicated enterprise role shells, and enterprise hardening complete, tested, and documented |
| AI-powered enrichment / AI suggestions / AI-assisted | Real LLM integration implemented, tested, and reflected in user guide |
| WooCommerce ready | WooCommerce connector built, tested, and documented |
| Full marketplace coverage | All claimed channels live, tested, and documented |
| Self-serve SaaS billing | Payment processor integrated, end-to-end billing lifecycle tested |
| Tamper-evident audit log | Cryptographic chaining, WORM storage, or immutable external sink implemented |
| Production-ready for all customer segments | All known test failures resolved, SaaS billing live, enterprise readiness complete |
| Full approval comments / threaded collaboration | ApprovalComment model, API, and UI built and tested |
| Full DAM replacement | Dedicated DAM capabilities built and proven |
| Amazon India ready | FEATURE_REAL_SPAPI_VALIDATION=true, sandbox tested, connector documented |

---

## Decisions Required Before Next Sprint

The following four architectural decisions were made by the PO on 2026-05-06 and are binding for sprint planning:

| # | Decision | Resolution |
|---|---|---|
| 1 | Smart Suggestions: keep rule-based permanently or approve LLM integration? | **Resolved: Freeze as "Smart Suggestions" — never label as AI. No LLM integration until a separate funded decision is made.** |
| 2 | Billing: choose Stripe or Razorpay for self-serve checkout | **Resolved: Decision deferred. Schema is ready. No billing code until processor is chosen and sprint is funded.** |
| 3 | Amazon India: required for first pilots or remains gated roadmap? | **Resolved: Remains gated roadmap. No SP-API enablement (FEATURE_REAL_SPAPI_VALIDATION stays false) for pilot customers.** |
| 4 | Enterprise UX shells: confirm system_admin / product_admin / vendor / category_manager / auditor shells are roadmap-only | **Resolved: Confirmed roadmap-only. Not promised to any pilot customer.** |

---

## Sales Blockers — Next Sprint Priorities

The following items are required to close sales with the approved pilot customer profile. Priority is set by the PO.

| Priority | Gap | Target Sprint |
|---|---|---|
| P1 | `ApprovalComment` model + `POST/GET /catalog/products/:id/review-comments` API + UI | Week 1 |
| P1 | Fix `bulk-edit-empty-scope` + `connector-idempotency-semantics` test failures | Week 1 |
| P1 | Stripe or Razorpay payment processor integration (pending Decision 2 resolution) | Week 2 |
| P1 | `GET /catalog/products/:id/activity` endpoint (data exists in AuditLog) | Week 2 |
| P1 | Amazon SP-API decision and action (pending Decision 3 — currently gated) | Week 3 |
| P2 | Verify variant edit/delete UI controls in `variants-tab.tsx` at current HEAD | Week 3 |
| P2 | Complete Meesho and Amazon error code maps (TODO placeholders) | Week 3 |
| P4 | LLM integration (Decision 1 required first; deferred post-pilot) | Post-pilot |

---

## Ideal Pilot Customer Profile

**Suitable for:**
- Indian D2C brand or SMB seller with 500–5,000 SKUs
- Selling on Shopify and/or Flipkart
- Currently managing catalog in spreadsheets or basic ERP export
- Needs import tooling, compliance checking, team approval workflow, and channel publish automation

**Not yet suitable for:**
- Enterprise customers requiring SSO/SAML
- Self-serve credit-card onboarding
- WooCommerce-primary sellers
- Amazon India as primary channel
- Teams requiring threaded approval comments or reviewer assignment

---

## Governance Notes

- This sign-off is binding for all investor demo, sales, and marketing materials from 2026-05-06 onwards.
- Any claim not listed in **Approved Claims** above requires a new PO sign-off before use.
- This document must be updated when any Forbidden Claim is implemented, tested, and verified in a future V4 or later audit report.
- V3 report at HEAD `e5f10a25167cf7bd6d00b1117935006c789ed5e8` is the authoritative evidence base for this sign-off.
- The next audit report (V4) should be triggered after the P1 sales blockers above are closed.

---

## Report Lineage

| Report | HEAD | Status |
|---|---|---|
| V1 | `ca5251c87a49536d3c1a10fe4add26e87c34a647` | ❌ Superseded — false critical blockers |
| V2 | Partial inspection before INC-33–36 merge | ❌ Superseded — stale for 5 claims |
| V3 | `e5f10a25167cf7bd6d00b1117935006c789ed5e8` | ✅ Authoritative — basis for this sign-off |
