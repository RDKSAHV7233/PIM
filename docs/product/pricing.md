---
title: Pricing Page / Tier Definitions
audience: sellers
status: approved — PO sign-off 2026-05-27 (Atharva); Legal review pending before public publish
last_updated: 2026-06-10
owner: Product + Legal
---

> **Status:** Price points and tier limits approved by PO (Atharva, 2026-05-27). Remaining sign-offs required before external publish: CTO (infra cost validation), CFO (LTV/CAC model), GTM (annual discount depth). Legal must review before any public-facing copy goes live.

---

## Plan Tiers

Vexa PIM offers four plans. All paid plans include core catalog management, bulk import, and quality management features. Every new workspace starts on a free 14-day TRIAL tier.

### TRIAL

**Free** · 14-day timer · No credit card required

| Limit | Value |
|-------|-------|
| Products (SKUs) | 100 |
| Users | 2 |
| Bulk import rows per job | 500 |
| API keys | 0 |
| Outbound webhooks | 0 |

Included:
- Catalog management (draft → in review → approved → published workflow)
- Bulk CSV import (up to 500 rows per job)
- Quality rules and basic validation
- Amazon India connector (1 installation)
- 8-role RBAC (admin, editor, publisher, approver, channel_manager, connector_admin, reviewer, viewer)

Trial limits and expiry:
- After 14 days without an active commercial plan, the workspace is **suspended** (`billingStatus: expired`). All write operations return an upgrade-required error until a paid plan is activated.
- All catalog data is retained for 90 days after suspension before permanent deletion.
- Upgrade to any paid plan to restore full access immediately.

Not included:
- API key access (GROWTH and above)
- Outbound webhooks (GROWTH and above)
- Auth policy configuration (GROWTH and above)
- Bulk import above 500 rows per job
- Shopify, Meesho, and additional connectors

---

### STARTER

**₹4,499 / month** · ₹44,990 / year (save ~2 months)

| Limit | Value |
|-------|-------|
| Products (SKUs) | 500 |
| Users | 3 |
| Bulk submissions / month | 500 |
| Storage | 5 GB |
| Connector installations | 2 |
| Accounts per connector | 1 |
| Bulk import rows per job | 2,000 |
| API keys | 0 |
| Outbound webhooks | 0 |
| API rate limit | 300 req / min |

Included:
- Catalog management (draft → in review → approved → published workflow)
- Bulk CSV import (up to 2,000 rows per job)
- Quality rules, validation, and rejection intelligence
- Amazon India and Flipkart connectors
- Meesho connector (Excel export)
- 8-role RBAC (admin, editor, publisher, approver, channel_manager, connector_admin, reviewer, viewer)

Not included:
- API key access (GROWTH and above)
- Outbound webhooks (GROWTH and above)
- Auth policy configuration (GROWTH and above)
- Shopify connector (GROWTH and above)
- Advanced analytics
- Priority support
- Custom SLA
- OIDC SSO

---

### GROWTH

**₹11,999 / month** · ₹1,19,990 / year (save ~2 months)

Everything in STARTER, plus:

| Limit | Value |
|-------|-------|
| Products (SKUs) | 10,000 |
| Users | 20 |
| Bulk submissions / month | 10,000 |
| Storage | 50 GB |
| Connector installations | 10 |
| Accounts per connector | 3 |
| Bulk import rows per job | 10,000 |
| API keys | 3 |
| Outbound webhooks | 3 |

Additional features:
- Shopify connector
- API key access (machine credentials + REST API)
- Outbound webhooks (import / publish events)
- Auth policy configuration — session timeout setting
- MFA support — TOTP available, optional enrollment (enforcement on ENTERPRISE)
- AI-assisted product enrichment (Smart Suggestions)
- ONDC expansion tools (when generally available)
- Standard support — 2 business day response

---

### ENTERPRISE

**Custom pricing** — [Contact Vexa sales](mailto:sales@vexa.in)

Everything in GROWTH, plus:

| Limit | Value |
|-------|-------|
| Products (SKUs) | 100,000 (custom above) |
| Users | Up to 999 (custom above) |
| Bulk submissions / month | 100,000 (custom above) |
| Storage | Up to 500 GB (custom above) |
| Connector installations | Up to 100 (custom above) |
| Accounts per connector | Up to 20 (custom above) |
| Bulk import rows per job | 30,000 |
| API keys | 50 (custom above) |
| Outbound webhooks | 50 (custom above) |

Additional features:
- Full auth policy configuration (session timeout, MFA enforcement, external identity mode, allowed sign-in methods)
- MFA enforcement — TOTP required for all users, configurable grace period
- OIDC SSO (self-serve IdP configuration — Enterprise configuration, available where implemented and verified)
- Custom SLA agreement
- Dedicated onboarding and implementation support
- MSA / custom data processing agreement available
- Priority support — 4-hour response (business hours)
- VAPT report available on request
- SOC 2 Type II report available on request (in progress)
- Custom connector development (scoped separately)

---

## Frequently Asked Questions

**What currency is pricing in?**
All prices are in Indian Rupees (INR) and include GST. USD billing available for international customers on request.

**Is there an annual billing discount?**
Yes — annual billing saves approximately 2 months of subscription cost compared to monthly billing (STARTER: save ₹9,000/year; GROWTH: save ₹24,000/year). Annual plans are billed upfront. GTM team to confirm exact annual discount framing before publish.

**Can I change plans?**
Upgrades take effect immediately; the new plan limits apply from the next billing cycle. Downgrades take effect at the end of the current billing period. Plan changes are managed through the Vexa commercial ops workflow — submit a request from the Plan & Usage page.

**What is the TRIAL tier?**
Every new Vexa workspace starts on a free 14-day TRIAL. The TRIAL tier includes 100 SKUs, 2 users, 1 connector installation, and up to 500 bulk import rows per job — no credit card required. API key access and outbound webhooks are not available on TRIAL. Upgrade to any paid plan at any time to access full features.

**What happens when my trial ends?**
At the end of your 14-day TRIAL, your workspace is suspended if no commercial plan is active. All catalog data is retained for 90 days before permanent deletion. Upgrade to STARTER, GROWTH, or ENTERPRISE to restore access immediately.

**What payment methods do you accept?**
Credit and debit cards via Stripe (Visa, Mastercard, RuPay). Bank transfer / NEFT available for annual Enterprise plans.

**Is ONDC included?**
ONDC expansion tools are included in GROWTH and above as a preview feature, subject to availability and feature-flag activation. General availability TBD.

**Is there a free tier?**
There is no permanent free tier. Every new workspace starts with a 14-day TRIAL (100 SKUs, 2 users, no credit card required). After the trial period, a paid plan is required to continue. Upgrade at any time during or after the trial to avoid suspension.

**What auth policy controls are available?**
GROWTH plans can configure session timeout. ENTERPRISE plans have full auth policy controls: session timeout, MFA enforcement (TOTP), external identity mode, and allowed sign-in methods (password / OIDC). Auth policy configuration is not available on TRIAL or STARTER.

---

## Key Decisions — Remaining Sign-offs

| Decision | Owner | Status |
|----------|-------|--------|
| Price points (STARTER, GROWTH) | PO (Atharva) | ✅ Approved 2026-05-27 |
| Tier limits (SKUs, users, storage) | Engineering | ✅ Set — see plan-limits.seed.ts |
| TRIAL tier definition | Product + Engineering | ✅ Approved 2026-06-10 — 100 SKUs, 2 users, 14-day, non-billable |
| Annual discount depth | GTM | ⏳ Pending |
| CTO infra cost validation | CTO | ⏳ Pending |
| CFO LTV/CAC model | CFO | ⏳ Pending |
| Legal review of public copy | Legal | ⏳ Pending before publish |
| Stripe product + price IDs | Ops | ⏳ BACKLOG-04 — create products in Stripe dashboard at approved price points |
| Trial expiry policy (data retention period) | Product | ✅ 90 days defined above — confirm with Legal |
| USD pricing for international | Product | ⏳ Pending |
