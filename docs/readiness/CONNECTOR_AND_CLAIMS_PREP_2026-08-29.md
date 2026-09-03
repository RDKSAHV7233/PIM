# Connector And Claims Preparation

Last reviewed: 2026-09-03

Status: active working pack

Governing claim authority:
`docs/readiness/CONNECTOR_CLAIM_AUDIT_2026-09-03.md` (refreshed from the
2026-08-30 original against `main @ 3bfd3e10` and three browser verification
passes)

Use this pack before writing website copy, sales copy, partner copy, connector
guides, or launch claims.

## Connector Documentation Status

| Connector | Current stage | Existing docs | Public-doc action |
| --- | --- | --- | --- |
| Flipkart | live | `docs/connectors/README.md`, `docs/connectors/flipkart-setup-guide.md` | Can prepare customer guide after fresh QA/support review |
| Myntra | live | Connector index; older architecture/review references | Prepare a focused setup guide only after API-access workflow is confirmed |
| Shopify | live with restricted claims | Connector index plus QA evidence and website/marketing governance | Prepare a bounded customer guide for verified direct-token scope only |
| Amazon India | under development | `docs/connectors/amazon-india-setup-guide.md` | Keep restricted/internal until production publish and status sync are re-signed |
| WooCommerce | controlled pilot (CTO/PO approved 2026-09-03) | `docs/connectors/woocommerce-vexa-meta-schema.md`, QA results, remediation evidence, claim audit | Controlled-pilot internal material only. Not GA/public-sellable. See `CONNECTOR_CLAIM_AUDIT_2026-09-03.md` |
| Meesho | manual export | Connector index and older product notes | Prepare manual-export guide only; do not claim direct API publish |
| Nykaa | manual export | Connector index and code references | Prepare manual-export guide only; do not claim direct API publish |
| ONDC | internal/feature-gated | Internal docs/code | Keep out of seller-facing docs |

## Claim Governance Status

| Area | Existing authority | Current state | Preparation needed |
| --- | --- | --- | --- |
| Public product claims | `docs/marketing/claims-governance.md`, `marketing/claims/claims.json` | Blocked unless approved | Add proof references, browser evidence, and owner approvals |
| Public pricing | `docs/product/commercial-policy.md` | Blocked | Keep prices and exact limits out of public copy |
| Shopify claims | QA evidence plus current-state caveats | Restricted | Separate verified direct-token claims from unverified OAuth/webhook/multi-image claims |
| WooCommerce claims | P0s closed (#660/#662/#663), controlled pilot approved | Controlled pilot only — not GA/public sell | Internal pilot material may say "operator-supervised evaluation." GA requires store-admin evidence and full team signoff |
| Amazon India claims | Under-development policy | Blocked for production publish | SP-API validation and publish/status sync proof required |
| SLA/scale claims | Runbooks and RES-05B harness | Blocked | Restore drill, HA, SLO telemetry, legal SLA approval required |

## Required Claim Record

Every publishable claim needs:

- claim ID
- exact claim text
- audience and channel
- plan scope
- role scope
- environment
- proof ID
- proof owner
- privacy/security/legal approvals where relevant
- expiry or review date

## Copy Rules

- Do not use "production-ready", "enterprise-ready", "GA", "SLA-backed",
  "automated paid checkout", "direct Meesho API", "direct Nykaa API",
  "Amazon production publish", or "WooCommerce GA" without current proof and signoff.
- Do not publish prices, "from" prices, exact limits, setup fees,
  implementation ranges, discount bands, ACV, or minimum contract values.
- Use "controlled evaluation", "operator-led setup", "manual export",
  "under development", and "code complete, QA/PO pending" where applicable.

## Public Docs To Prepare After Evidence

- Shopify direct-token customer guide.
- Flipkart customer setup guide refresh.
- Manual-export guide for Meesho/Nykaa.
- Customer known-limitations page for controlled evaluation.
- Public privacy/terms/cookie pages after legal approval.
- Public release notes for the exact approved launch scope.
