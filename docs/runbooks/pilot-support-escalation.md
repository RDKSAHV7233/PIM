---
title: Pilot Support and Escalation Runbook
audience: support-customer-success
status: active-draft
last_updated: 2026-09-03
owner: Support / Customer Success
---

Use this runbook for controlled-evaluation tenants only after the current P1
hold is lifted. It does not approve paid-pilot readiness, WooCommerce GA, public
pricing, SLA claims, security readiness, or customer support commitments beyond
an explicitly approved pilot scope.

## 1. Intake Triage

| Customer issue | Severity | First owner | Escalate to | Evidence to capture |
| --- | --- | --- | --- | --- |
| Login blocked, tenant suspended, or admin cannot access approved scope | P1 unless all tenants are affected | Support | Ops + CTO + Security | Tenant key, user role, timestamp, browser screenshot, API error code |
| Publish/export blocked for an approved connector | P1 | Support | Connector Engineering + QA | Connector slug, product IDs, job/submission IDs, visible status, non-secret provider response |
| WooCommerce app-auth or publish request | Scope block until P1-1 is merged, staged, and runtime-verified | Support | PO + Connector Engineering + Security | Confirmation that WooCommerce app-auth is in blocker closure, not customer-ready |
| Plan-limit, SKU-meter, or quota dispute | P2 unless access is blocked for an approved pilot | Support | Commercial + Product | Tenant key, plan tier, SKU meter screenshot, product/variant examples |
| Data loss concern, broad outage, or security/privacy issue | P0 | Support | CTO + Ops + Security/Privacy | Follow `docs/runbooks/incident-response.md` immediately |

Never request, paste, or store connector secrets, API keys, passwords, cookies,
or customer personal data in support notes. Ask the customer to rotate exposed
secrets if they have already shared them.

## 2. WooCommerce Support Boundary

Current support wording:

> WooCommerce app-auth is in blocker closure as of 2026-09-03. It is not GA,
> public-sellable, or approved for customer app-auth onboarding until P1-1 is
> reviewed, CI-verified, staged, and runtime-verified. The broader customer
> onboarding hold also remains until P1-2 auth revocation has Security/SRE/CTO
> disposition.

Support may help collect internal evidence for:

- fresh install/reconnect against an approved safe staging store
- single-item publish and idempotent republish
- bulk publish accounting and terminal status reconciliation
- variable-product edit/republish confirmation
- store-admin confirmation screenshots with secrets hidden

Support must not promise:

- WooCommerce GA availability
- WooCommerce app-auth customer onboarding
- production publishing for any tenant while the P1 hold remains open
- a paid feature entitlement
- public customer proof, case study, or claim text

## 3. Plan-Limit And SKU-Meter Disputes

The current local policy is: SKU usage counts sellable Variant rows, not Product
rows. A product that first becomes approved/active with no variants should get a
single canonical variant so commercial usage and publish payloads are aligned.

Support triage steps:

1. Confirm the tenant key, plan tier, and affected workspace.
2. Ask for a screenshot of the plan/SKU meter and one example product.
3. Check whether the example product has variants or was recently approved.
4. If the meter appears inconsistent, escalate to Commercial and Product with:
   - tenant key
   - product ID
   - variant IDs or note that none are visible
   - expected count from the customer
   - observed count in Vexa
5. Do not quote public prices, exact limits, discounts, setup fees, or upgrade
   commitments unless Commercial has approved the wording for that tenant.

## 4. Escalation Notes Template

```markdown
Issue:
Tenant:
Environment:
Customer contact:
Approved pilot scope:
Connector or plan area:
Severity:
Started at:
Visible error/status:
Job/submission/product IDs:
Evidence attached:
Secrets redacted: yes/no
Customer impact:
Owner:
Next update due:
Decision needed:
```

## 5. Exit Criteria For Support Readiness

Support readiness for a controlled evaluation is complete only when:

- the tenant has an approved support channel
- named Support, Ops, CTO, PO, Commercial, and QA escalation owners are recorded
- the allowed connector list and explicit exclusions are attached
- customer-facing response wording is approved for the tenant
- evidence capture rules are understood by the support owner
- the closeout record is stored in the restricted readiness tracker

Until those items are recorded and the P1 hold is lifted, support readiness
remains draft-only.

## 6. Current Escalation Owners (Pilot Phase)

During the controlled pilot phase, all roles are held by the sole operator:

| Role | Owner | Contact |
| --- | --- | --- |
| Support | Vishal Bhoi (CTO) | bhoivishal216@gmail.com |
| Ops | Vishal Bhoi (CTO) | bhoivishal216@gmail.com |
| CTO | Vishal Bhoi | bhoivishal216@gmail.com |
| PO | Vishal Bhoi (CTO) | bhoivishal216@gmail.com |
| Commercial | Vishal Bhoi (CTO) | bhoivishal216@gmail.com |
| QA | Vishal Bhoi (CTO) | bhoivishal216@gmail.com |
| Connector Engineering | Vishal Bhoi (CTO) | bhoivishal216@gmail.com |

This is an accepted risk for the controlled pilot. Assign dedicated role owners
before expanding beyond 2 evaluation tenants.
