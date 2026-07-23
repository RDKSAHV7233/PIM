---
title: Internal Commercial Policy Register
audience: internal
status: active - controlled rollout baseline
last_updated: 2026-07-23
owner: Product + Finance + Legal + CTO
---

# Internal Commercial Policy Register

This is the canonical repository policy for Vexa's no-public-pricing rollout.
It classifies public and internal commercial information, records the internal
entitlement target, and blocks public pricing until the Pricing Council changes
the policy.

## Policy Locks

| Policy | Locked value |
| --- | --- |
| Public pricing | Blocked |
| Public plan limits | Blocked unless Claim Register approved |
| Public plan name for evaluation | Trial |
| Trial term | 90 days |
| Trial commercial claim | Free Trial, restricted |
| Growth motion | Sales-touched / demo-assisted |
| Public paid checkout | Blocked |
| Internal price book | Restricted commercial system, not public docs |

## Internal Entitlement Baseline

The values below are internal implementation targets. They are not public copy.
Do not publish them on the website, in SEO metadata, public documentation,
public emails, ads, downloadable assets, or self-service checkout.

| Entitlement | Trial | Starter | Growth | Business | Enterprise |
| --- | ---: | ---: | ---: | ---: | ---: |
| Active SKUs | 500 | 2,500 | 10,000 | 50,000 | 100,000+, capacity review |
| Users | 3 | 5 | 15 | 50 | Custom |
| Workspaces | 1 | 1 | 1, second as add-on | Up to 3 | Custom |
| Connector installations | 1 limited | 2 | 5 | 15 | Custom |
| Storage | 2 GB | 15 GB | 75 GB | 250 GB | Custom |
| Rows per import operation | 2,000 | 10,000 | 30,000 | 30,000 | 30,000 |
| Approval workflow | No | No | Included | Included | Custom |
| SSO | No | No | Add-on | Included | Custom |
| Audit retention | 30 days | 180 days | 1 year | 3 years | Contractual |
| Sales motion | Self-service | Self-service | Sales-touched | Sales-assisted | Consultative |

## Internal Price Book

Plan prices, annual effective prices, add-on prices, setup fees, implementation
ranges, discount bands, and contract values must live in an approved restricted
commercial system or private price-book artifact. They must not be published in
seller-facing docs or public website assets.

Each quote must reference:

- Active price-book version.
- Effective date.
- Approving Finance owner.
- Discount approval, if any.
- Proposal or order-form reference.
- Separate SOW reference for implementation or migration work.

## Superseded Policy

The former public pricing-page policy dated 2026-06-11 is superseded for public
copy and public documentation. Historical files may exist as archived evidence,
but they are not current launch policy.

The following documents contain pricing figures that conflict with the Internal
Price Book above. They are left unedited as historical/approval records — do not
alter their content directly. Each requires its own owner action before it can be
treated as current:

| Document | Conflict | Required action |
| --- | --- | --- |
| `docs/checklists/ops-unblock-staging.md` | Old monthly Stripe price ladder (STARTER ₹9,999, GROWTH ₹29,999, BUSINESS ₹69,999) | Marked stale in-place 2026-07-23; Finance/RevOps must supply current Stripe price IDs before this runbook is used |
| `docs/CTO_EXECUTION_SUMMARY.md` | Old monthly Stripe price ladder, pre-BUSINESS-tier (STARTER ₹4,499, GROWTH ₹11,999) | Marked stale in-place 2026-07-23; same as above |
| `docs/execution/PO_SIGNOFF_CONTROLLED_PILOT_V4_2026-05-17.md` | Formally PO-signed, binding pilot pricing table (Pilot/Starter/Growth/Scale, ₹25,000–₹100,000 range, "No free trials") that conflicts with the current Trial and Internal Entitlement Baseline above | Document not edited — it is a binding sign-off record. Requires a new PO sign-off (V5+) per its own supersession rule to formally retire or reconcile the pricing table before any pilot sales/marketing use |

## Required Verification Before Launch

- Public surfaces contain no currency amounts or "from" price language.
- Public surfaces contain no unapproved numeric plan limits.
- Trial language is consistently 90 days and restricted to evaluation.
- Growth uses demo-assisted / sales-touched routing.
- External systems are verified directly or marked NOT VERIFIED.
- Human approvals are recorded before any gate is marked complete.
