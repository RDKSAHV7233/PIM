---
title: Vexa Marketing Claims Governance
audience: internal-marketing-eng
status: active
last_updated: 2026-09-03
owner: Product + Commercial + QA + Privacy
---

# Vexa Marketing Claims Governance

This document executes Phase 0 of the corrected Vexa marketing model. It establishes the repo-safe controls Codex must satisfy before changing public marketing copy, landing pages, lead capture, analytics, or nurture flows.

## Current Status

Status: CONDITIONALLY APPROVED - BLOCKED FOR PUBLIC CLAIMS

Codex may maintain the governance files and validators in this repo. Codex must
not publish or strengthen customer-facing claims until the current Commercial
Claims Matrix, restricted Proof Registry, and Privacy/Security/Legal authorities
are available and valid.

Governing claim authority:
`docs/readiness/CONNECTOR_CLAIM_AUDIT_2026-09-03.md` — refreshed against
`main @ 3bfd3e10` with three browser verification passes, CTO/PO signed.

Current state:
- **Shopify:** CONTROLLED_PILOT_ONLY (direct-token, single-variant scope)
- **WooCommerce:** CONTROLLED_PILOT_ONLY (upgraded from DO_NOT_SELL on
  2026-09-03 after #660/#662/#663 closed)
- **Public claims:** BLOCKED until Marketing/Legal/Privacy approve
- Proof references: 14 repo-safe entries in `marketing/claims/proof-references.json`
- Claims matrix: `marketing/claims/claims.json` at PARTIAL_EVIDENCE_AVAILABLE

Use `docs/readiness/CONNECTOR_AND_CLAIMS_PREP_2026-08-29.md` for the active
connector and public-claim preparation checklist.

## Evidence Rule

The marketing plan is not evidence. Historical notes are not evidence. A closed issue, merged PR, or source-code path is not evidence. A Claims Matrix row is not enough by itself.

Verified for marketing requires:

```text
approved claim ID
current Claims Matrix version
valid proof reference ID
restricted evidence-store record
deployment/environment
commit SHA where applicable
browser acceptance
test tenant/account reference
role scope
plan scope
denial-path evidence where relevant
evidence date
named approval
```

If any mandatory field is missing, the claim remains `NOT_VERIFIED` for new public marketing implementation.

## Repo-Safe Split

Repo-safe files live under:

```text
marketing/claims/claims.json
marketing/claims/proof-references.json
marketing/privacy/data-governance.json
```

These files may contain IDs, statuses, public-safe copy, plan/role scope labels, expiry metadata and restricted evidence references.

They must not contain tenant names, account emails, access tokens, CRM exports, raw lead data, private screenshots, customer-data videos, or production URLs that reveal private tenants.

Sensitive proof material belongs in the restricted evidence store, not in normal repo files.

## Execution Order

1. Load the current Commercial Claims Matrix authority.
2. Validate or create restricted Proof Registry records.
3. Map every `SELL` claim to current proof.
4. Mark stale or missing claims `NOT_VERIFIED`.
5. Establish the Privacy/Marketing Data policy.
6. Run `npm run marketing:claims:validate`.
7. Only then audit public website claims.

## Public Marketing Blockers

Shopify and WooCommerce claims are marked CONTROLLED_PILOT_ONLY in the claims
matrix — available for operator-supervised ENTERPRISE evaluation, not for
public marketing. Public claims remain blocked until Marketing, Legal, and
Privacy approve through the claim-to-proof governance chain.

The governing claim audit (`docs/readiness/CONNECTOR_CLAIM_AUDIT_2026-09-03.md`)
lists the exact scope, qualifiers, and approved replacement wording for every
claim. No claim may exceed the verdict in that audit without a fresh audit
refresh and CTO/PO sign-off.
