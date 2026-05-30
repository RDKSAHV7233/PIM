---
title: Pricing Page / Tier Definitions
audience: sellers
status: approved — PO sign-off 2026-05-27 (Atharva); Legal review pending before public publish
last_updated: 2026-05-28
owner: Product + Legal
---

> **Status:** Price points and tier limits approved by PO (Atharva, 2026-05-27). Remaining sign-offs required before external publish: CTO (infra cost validation), CFO (LTV/CAC model), GTM (annual discount depth). Legal must review before any public-facing copy goes live.

---

## Plan Tiers

Vexa PIM offers three plans. All plans include core catalog management, bulk import, and quality management features.

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
| Bulk import rows per job | 30,000 |
| API rate limit | 300 req / min |

Included:
- Catalog management (draft → in review → approved → published workflow)
- Bulk CSV import (up to 30,000 rows)
- Quality rules, validation, and rejection intelligence
- Amazon India and Flipkart connectors
- Outbound webhooks (import / publish events)
- 8-role RBAC (admin, editor, publisher, approver, channel_manager, connector_admin, reviewer, viewer)
- 14-day free trial — no credit card required

Not included:
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
| Products (SKUs) | 5,000 |
| Users | 20 |
| Bulk submissions / month | 5,000 |
| Storage | 50 GB |
| Connector installations | 10 |
| Accounts per connector | 3 |

Additional features:
- Shopify connector
- API key access (machine credentials + REST API)
- Advanced webhook controls
- AI-assisted product enrichment (Smart Suggestions)
- ONDC expansion tools (when generally available)
- Standard support — 2 business day response

---

### ENTERPRISE

**Custom pricing** — [Contact Vexa sales](mailto:sales@vexa.in)

Everything in GROWTH, plus:

| Limit | Value |
|-------|-------|
| Products (SKUs) | Up to 99,999 (custom above) |
| Users | Up to 999 (custom above) |
| Bulk submissions / month | Up to 99,999 (custom above) |
| Storage | Up to 500 GB (custom above) |
| Connector installations | Up to 100 (custom above) |
| Accounts per connector | Up to 20 (custom above) |

Additional features:
- OIDC SSO (self-serve IdP configuration)
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

**What happens when my trial ends?**
At the end of your 14-day free trial, your workspace access is suspended if no commercial plan is active. All catalog data is retained. Contact Vexa to activate a plan and restore access. Data retention after suspension: 90 days before permanent deletion.

**What payment methods do you accept?**
Credit and debit cards via Stripe (Visa, Mastercard, RuPay). Bank transfer / NEFT available for annual Enterprise plans.

**Is ONDC included?**
ONDC expansion tools are included in GROWTH and above as a preview feature, subject to availability and feature-flag activation. General availability TBD.

**Is there a free tier?**
There is no permanent free tier. A 14-day free trial is available on all plans with no credit card required.

---

## Key Decisions — Remaining Sign-offs

| Decision | Owner | Status |
|----------|-------|--------|
| Price points (STARTER, GROWTH) | PO (Atharva) | ✅ Approved 2026-05-27 |
| Tier limits (SKUs, users, storage) | Engineering | ✅ Set — see plan-limits.seed.ts |
| Annual discount depth | GTM | ⏳ Pending |
| CTO infra cost validation | CTO | ⏳ Pending |
| CFO LTV/CAC model | CFO | ⏳ Pending |
| Legal review of public copy | Legal | ⏳ Pending before publish |
| Stripe product + price IDs | Ops | ⏳ BACKLOG-04 — create products in Stripe dashboard at approved price points |
| Trial expiry policy (data retention period) | Product | ✅ 90 days defined above — confirm with Legal |
| USD pricing for international | Product | ⏳ Pending |
