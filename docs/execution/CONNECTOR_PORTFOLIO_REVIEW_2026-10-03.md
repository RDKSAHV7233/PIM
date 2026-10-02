# Connector Portfolio Review - 2026-10-03

Status: decision recorded

## Decision

Select `woocommerce` as the next connector-onboarding workstream.

This is a portfolio-priority decision, not authorization for a provider write,
customer onboarding, pilot, or launch-stage change. WooCommerce remains in
`p1_blocker_hold` until its authentication and tenant-binding controls have
current staging and runtime evidence. Shopify is frozen as `VERIFIED` and is
out of scope unless a new regression is demonstrated.

## Evidence Basis

The source-generated connector inventory on 2026-10-03 reports:

- WooCommerce has an adapter, runtime registration, DB definition, credential
  UI, and `PUBLISH`, `VALIDATE`, `STATUS_SYNC`, and `WEBHOOK_RECEIVE`
  capabilities.
- It is the only non-Shopify connector with platform-applied mapping support.
- It has integration-tested certification evidence for each declared capability
  and real historical submission evidence in `CURRENT_STATE.md` (55 products
  with submission history; 56 of 65 submissions successful in the cited
  verification period).
- Its blocking condition is explicit: tenant-owned credential persistence and
  auth-revocation behavior require fresh CI, staging, and runtime proof before
  setup or install may be exposed.

The external market signal supports the priority but does not replace customer
evidence: W3Techs' October 2026 history reports WooCommerce on 19.8 percent of
WordPress sites, while PrestaShop's current usage report shows 0.5 percent of
all websites. See <https://w3techs.com/technologies/history_details/cm-wordpress>
and <https://w3techs.com/technologies/comparison/cm-prestashop>.

## Portfolio Scorecard

Scores are 1 (weak/unknown) through 5 (strong). "Customer value" combines
repository demand evidence and current market reach; a low-confidence market
signal is never enough to authorize a launch.

| Connector | Implementation | Runtime evidence | Customer value | Mapping/schema | Auth/scopes | Sync/webhooks | Defect burden | Certification | Total | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| WooCommerce | 4 | 5 | 5 | 5 | 1 | 4 | 1 | 3 | 28 | Select; clear P1 gate first |
| PrestaShop | 4 | 2 | 2 | 2 | 2 | 2 | 3 | 2 | 19 | Defer |
| Odoo | 4 | 2 | 3 | 2 | 2 | 2 | 3 | 2 | 20 | Defer |
| BigCommerce | 4 | 1 | 3 | 2 | 2 | 2 | 3 | 1 | 18 | Defer |
| eBay | 4 | 2 | 3 | 2 | 2 | 2 | 3 | 2 | 20 | Defer |

The totals prioritize sequencing, not safety. A connector with an unresolved
P1 blocker cannot advance to controlled-write authorization regardless of score.

## WooCommerce Onboarding Sequence

1. Re-establish identity, OAuth/application scopes, tenant ownership, and
   revocation behavior with current staging and runtime evidence.
2. Keep install, setup, customer pilot, and provider-write actions blocked until
   the P1 hold is formally cleared.
3. Revalidate the existing target schema, mapping resolution, and
   WooCommerce-specific mapped-meta projection against one selected tenant.
4. Add a runtime preflight that binds the exact tenant, installation, product,
   approved release, field scope, and kill switch before any new controlled
   write path is introduced.
5. Prepare one exact-write authorization packet only after the preceding gates
   pass; perform one controlled write, durable audit, provider readback,
   kill-switch proof, capability certification, then a separately authorized
   pilot decision.

## P1 Gate Audit

The current launch policy deliberately resolves WooCommerce to
`p1_blocker_hold` unless a narrowly tenant-scoped staging-proof override is
explicitly configured. The normal policy names three required conditions:

- P1-1 tenant-owned app-auth credential verification.
- P1-2 auth-revocation failure policy.
- Current staging runtime proof plus fresh CTO, PO, Security, QA, and SRE
  signoff.

The temporary override is not a substitute for those conditions: it is scoped
to one proof tenant and must not be used for a customer, pilot, or controlled
provider-write exercise. Existing regression coverage asserts that WooCommerce
remains hidden from customer setup lanes while the hold is open.

## Immediate Boundary

No Shopify change is part of this workstream. No WooCommerce provider call,
credential update, install, launch-stage change, or customer-facing enablement
is authorized by this review.
