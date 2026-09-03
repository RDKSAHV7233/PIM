# Vexa PIM Pilot Scope

Last reviewed: 2026-09-03

This document defines the controlled pilot scope. Current code and the latest QA
results override older signoff memos and pricing packs.

Use `docs/readiness/CUSTOMER_PILOT_PACK_2026-08-29.md` before opening any
controlled evaluation tenant.

## Pilot Readiness Verdict

Broad paid-pilot readiness is **not established**, but CTO/PO have approved
**controlled pilot evaluation** as of 2026-09-03 for Shopify direct-token and
WooCommerce publishing under operator supervision (up to 2 ENTERPRISE tenants).
See `docs/readiness/TEAM_SIGNOFF_MATRIX_2026-08-29.md` for the full decision log.

The current pilot posture is controlled evaluation and operator-led setup only.
Do not promise GA connector coverage, public pricing, WooCommerce production
publishing, self-serve paid checkout, enterprise SLA, or broad production
readiness until the current blockers are closed and re-signed.

## Connector Availability

| Connector | Current stage | Customer access | Notes |
| --- | --- | --- | --- |
| Shopify | Live, restricted claims | Controlled direct-token use only | Observed journeys are stronger than WooCommerce, but paid-pilot readiness is not fully established. Managed OAuth, webhooks, and multi-image sync are not production-verified. |
| Flipkart | Live | Controlled connector use | Default fallback connector path. |
| Myntra | Live | Controlled connector use where API access is enabled | Requires account-manager/API enablement. |
| Amazon India | Under development | No production publish promise | Install and credential validation available; publish/status sync under validation. |
| WooCommerce | Controlled pilot | Operator-supervised evaluation only | CTO/PO approved 2026-09-03. #660 FIXED, #662 VERIFIED, fresh publish SUCCESS. Not GA/public-sellable until store-admin evidence and full team signoff. |
| Meesho | Manual export | Manual workflow only | Export file plus Supplier Panel upload; direct API blocked on partner access. |
| Nykaa | Manual export | Manual workflow only | Export file plus seller portal upload; direct API requires partner credentials. |
| ONDC | Internal / feature-gated | Internal only | Requires `FEATURE_ONDC_ENABLED=true`; not seller-facing pilot scope. |

## Onboarding

- Public signup exists in code but is feature-flagged.
- Paid checkout remains blocked.
- Customer onboarding must be operator-led unless a specific environment has an
  approved public-signup gate and evidence.
- Commercial terms must come from the approved restricted commercial authority,
  not public docs or old pricing packs.

## Operations Gate Before Any Controlled Evaluation Tenant

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

- WooCommerce production publishing claims
- Amazon India production publish claims
- Meesho or Nykaa direct API publish claims
- managed Shopify OAuth production claim
- Shopify webhook subscription production claim
- self-serve paid checkout or automatic paid-plan activation
- public prices, exact public plan limits, setup fees, or implementation ranges
- enterprise SLA, HA, PITR, or scale/SLO claims without fresh operational proof
