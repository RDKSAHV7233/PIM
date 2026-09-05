# Vexa PIM Pilot Scope

Last reviewed: 2026-09-03

This document defines the controlled pilot scope. Current code, the latest QA
results, and the 2026-09-03 blocker-closure review override older signoff memos
and pricing packs.

Use `docs/readiness/CUSTOMER_PILOT_PACK_2026-08-29.md` before opening any
controlled evaluation tenant.

## Pilot Readiness Verdict

Broad paid-pilot readiness is **not established**. The prior controlled-pilot
approval is now on hold pending P1-2 auth revocation Security/SRE/CTO
disposition. WooCommerce app-auth is additionally blocked until the P1-1 fix is
reviewed, CI-verified, staged, and runtime-verified.

See:

- `docs/execution/AUTH_REVOCATION_FAILURE_POLICY_DECISION_2026-09-03.md`
- branch artifact
  `blocker/p1-woo-app-auth-tenant-key:docs/execution/P1_WOO_APP_AUTH_CREDENTIAL_PERSISTENCE_CLOSURE_2026-09-03.md`
- `docs/readiness/TEAM_SIGNOFF_MATRIX_2026-08-29.md`

The current pilot posture is controlled evaluation and operator-led setup only.
Do not onboard a customer tenant or promise GA connector coverage, public
pricing, WooCommerce app-auth/production publishing, self-serve paid checkout,
enterprise SLA, security readiness, or broad production readiness until the P1
blockers are closed and re-signed.

## Connector Availability

| Connector | Current stage | Customer access | Notes |
| --- | --- | --- | --- |
| Shopify | Live, restricted claims | Hold pending P1-2 implementation review | Observed journeys are stronger than WooCommerce, but customer onboarding is paused until the cross-cutting auth revocation policy implementation is reviewed, proven, and signed off. Managed OAuth, webhooks, and multi-image sync are not production-verified. |
| Flipkart | Live | Controlled connector use | Default fallback connector path. |
| Myntra | Live | Controlled connector use where API access is enabled | Requires account-manager/API enablement. |
| Amazon India | Under development | No production publish promise | Install and credential validation available; publish/status sync under validation. |
| WooCommerce | Blocker closure | No customer app-auth onboarding | P1-1 app-auth tenant ownership is locally fixed but pending PR review, CI, staging, and runtime verification. Not GA/public-sellable until store-admin evidence and full team signoff. |
| Meesho | Manual export | Manual workflow only | Export file plus Supplier Panel upload; direct API blocked on partner access. |
| Nykaa | Manual export | Manual workflow only | Export file plus seller portal upload; direct API requires partner credentials. |
| ONDC | Internal / feature-gated | Internal only | Requires `FEATURE_ONDC_ENABLED=true`; not seller-facing pilot scope. |

## Onboarding

- Public signup exists in code but is feature-flagged.
- Paid checkout remains blocked.
- Customer onboarding is paused until P1-2 implementation has Security/SRE/CTO
  review, CI, staging proof, and any required fix is verified.
- After the hold is lifted, customer onboarding must be operator-led unless a
  specific environment has an approved public-signup gate and evidence.
- Commercial terms must come from the approved restricted commercial authority,
  not public docs or old pricing packs.

## Operations Gate Before Any Controlled Evaluation Tenant

- Confirm P1-2 implementation proof and P1-1 Woo app-auth verification before
  sharing access.
- Confirm the environment, tenant key, and plan tier before sharing access.
- Confirm `FEATURE_PUBLIC_SIGNUP_ENABLED`, billing/checkout flags, and connector visibility match the approved pilot posture.
- Provision or verify the admin account through the approved operator path; new self-serve signup creates a `TRIAL` workspace when the signup gate is enabled.
- Record the approved commercial authority, commercial contact, and trial/evaluation window outside public docs.
- Name the allowed connectors for the tenant and explicitly exclude WooCommerce GA, Amazon production publish, Meesho/Nykaa direct API, ONDC, public pricing, and SLA claims unless separately approved.
- Assign an evidence owner for browser acceptance, role/plan scope, denial paths, and blocker tracking before the customer workflow starts.

## Supported Pilot Claims

Only claim a workflow when all required current evidence exists:

- approved claim ID
- current Claims Matrix authority
- restricted proof reference
- role scope
- plan scope
- deployment/environment
- browser acceptance
- denial-path evidence when relevant
- named approval

Use `docs/marketing/claims-governance.md` before writing or publishing public
copy.

## Out Of Scope Until Re-Signed

- Security readiness or customer onboarding claims while P1-2 is unresolved
- WooCommerce app-auth or production publishing claims while P1-1 is not merged,
  staged, and runtime-verified
- Amazon India production publish claims
- Meesho or Nykaa direct API publish claims
- managed Shopify OAuth production claim
- Shopify webhook subscription production claim
- self-serve paid checkout or automatic paid-plan activation
- public prices, exact public plan limits, setup fees, or implementation ranges
- enterprise SLA, HA, PITR, or scale/SLO claims without fresh operational proof
