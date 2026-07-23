---
title: Vexa Public And Commercial Claim Register
audience: internal
status: active
last_updated: 2026-07-23
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

## Automatic Review Triggers

A claim returns to review when:

- Related implementation changes.
- Supporting tests fail.
- Connector API behavior changes.
- A contract exception is introduced.
- Evidence becomes stale.
- Product or Legal withdraws approval.
