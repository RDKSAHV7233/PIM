---
title: Vexa Public And Commercial Claim Register
audience: internal
status: active
last_updated: 2026-09-04
owner: Product + Legal + Marketing
---

# Claim Register

Every public, proposal, email, demo, or documentation claim must be approved,
internal-only, or blocked. Missing evidence means the claim is blocked.

| Claim ID | Claim text | Classification | Surface | Evidence | Evidence date | Owner | Approvers | Review date | Related capability | Status | Replacement wording |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CLM-TRIAL-FREE-001 | Start Free Trial - evaluate Vexa for 90 days. No production SLA. | Public | Website, email, demo | Approved Commercial Policy | 2026-07-23 | Product | Product, Finance, Legal, Marketing | 2026-10-23 | Trial | Approved | Start Free Trial |
| CLM-NOPRICE-001 | Exact commercial terms are confirmed privately with Vexa. | Public | Website, proposal intro, email | Approved Commercial Policy | 2026-07-23 | Marketing | Product, Legal, Marketing | 2026-10-23 | Pricing | Approved | Talk to Sales |
| CLM-PRICE-PUBLIC-001 | Any public INR, foreign-currency, "from" price, setup fee, add-on price, discount, ACV, or minimum contract value. | Blocked | All public surfaces | Approved Commercial Policy | 2026-07-23 | Finance | Finance, Legal, Product | 2026-10-23 | Pricing | Blocked | Commercial terms are confirmed privately. |
| CLM-LIMIT-PUBLIC-001 | Exact public SKU, user, connector, storage, import, or retention limits. | Blocked by default | Public website, public docs, public email | Approved Commercial Policy | 2026-07-23 | Product | Product, CTO, Legal, QA | 2026-10-23 | Entitlements | Blocked | Use non-numeric scale signals. |
| CLM-ENTERPRISE-READY-001 | Enterprise-ready or broad-release-ready claims. | Blocked | Website, demo, proposal | Product/CTO readiness reviews | 2026-07-23 | Product | CEO, CTO, Legal, QA | 2026-10-23 | Launch readiness | Blocked | Controlled commercial discovery. |
| CLM-CONNECTOR-CERT-001 | Certified connector claims without current evidence. | Blocked | Website, integrations, proposal | Connector Certification Register required | 2026-07-23 | Integration Architecture | Integration Architect, CTO, QA, Support | 2026-10-23 | Connectors | Blocked | Connector scope is confirmed privately. |
| CLM-RETENTION-FIXED-001 | Fixed retention periods in public copy or standard proposals before plan-aware enforcement is verified. | Blocked | Website, proposal, docs | Audit retention implementation not verified | 2026-07-23 | Legal/Security | Legal, CTO, QA | 2026-10-23 | Retention | Blocked | Retention is confirmed in approved order forms. |
| CLM-SHP-PUBLISH-001 | Publish approved products to Shopify. | Controlled pilot only | Internal pilot material | Claim audit 2026-09-03, 3 browser verifications | 2026-09-03 | Product | PO, CTO | 2026-09-10 | Shopify connector | Controlled pilot only | Publish approved products to Shopify through Vexa's governed workflow. |
| CLM-SHP-EDIT-001 | Correct live Shopify listings through edit and republish. | Controlled pilot only | Internal pilot material | Claim audit 2026-09-03, single-variant verified | 2026-09-03 | Product | PO, CTO | 2026-09-10 | Shopify connector | Controlled pilot only | Edit and republish a linked Shopify listing. |
| CLM-SHP-BULK-001 | Bulk publish up to 50 Shopify products per batch. | Controlled pilot only | Internal pilot material | Claim audit 2026-09-03, bulk panel verified | 2026-09-03 | Product | PO, CTO | 2026-09-10 | Shopify connector | Controlled pilot only | Select and queue up to 50 eligible Shopify products per batch. |
| CLM-WOO-PUBLISH-001 | WooCommerce production publishing. | Blocker closure hold | Internal draft only | P1-1 credential write/read verification and P1-2 auth revocation implementation review required | 2026-09-04 | Product | PO, CTO, Security, QA, SRE | 2026-09-10 | WooCommerce connector | Blocked until re-signed | Do not onboard or claim WooCommerce production publishing while P1 hold is open. |
| CLM-WOO-EDIT-001 | Edit and republish an existing WooCommerce listing (idempotent update, single-variant). | Blocker closure hold | Internal draft only | P1-1 credential write/read verification and staging runtime proof required | 2026-09-04 | Product | PO, CTO, Security, QA, SRE | 2026-09-10 | WooCommerce connector | Blocked until re-signed | Do not claim WooCommerce edit/republish readiness while P1 hold is open. |
| CLM-WOO-BULK-001 | Bulk-select WooCommerce products for publish. | Blocker closure hold; not verified at batch level | Internal draft only | P1 closure plus batch-level Woo evidence required | 2026-09-04 | Product | PO, CTO, Security, QA, SRE | 2026-09-10 | WooCommerce connector | Blocked until re-signed | Do not rely on WooCommerce bulk publish for a production or pilot workflow while P1 hold is open. |
| CLM-SHP-OAUTH-001 | Managed Shopify OAuth. | Not verified | None | No live managed OAuth evidence | 2026-09-03 | Integration | CTO, QA | 2026-09-10 | Shopify connector | Blocked | Direct-token/custom-app only. |
| CLM-WEBHOOK-001 | Webhook receive with automatic subscription. | Not verified | None | No subscription creation; receiver code only | 2026-09-03 | Integration | CTO, QA | 2026-09-10 | Shopify connector | Blocked | Do not claim. |
| CLM-MULTIIMAGE-001 | Multi-image sync across connectors. | Contradicted | None | Single main HTTPS image only | 2026-09-03 | Product | PO, QA | 2026-09-10 | Shopify connector | Blocked | Single main image in approved scope. |
| CLM-VARIANT-FULL-001 | Full multi-dimensional variant support. | Conditional | Internal only | Single-variant verified; no multi-variant catalog data | 2026-09-03 | Product | PO, QA | 2026-09-10 | Connectors | Blocked for public | Single-variant publish verified. |

## Governing Claim Authority

The connector claim audit at `docs/readiness/CONNECTOR_CLAIM_AUDIT_2026-09-03.md`
remains historical evidence for Shopify and WooCommerce claim verdicts, but the
current WooCommerce authority is the P1 blocker-closure hold in
`docs/execution/CURRENT_STATE.md`. No WooCommerce claim may exceed that hold
without fresh audit refresh, runtime evidence, and CTO/PO/Security/QA/SRE
sign-off.

## Automatic Review Triggers

A claim returns to review when:

- Related implementation changes.
- Supporting tests fail.
- Connector API behavior changes.
- A contract exception is introduced.
- Evidence becomes stale.
- Product or Legal withdraws approval.
