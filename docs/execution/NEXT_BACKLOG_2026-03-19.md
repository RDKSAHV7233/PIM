# TEJ PIM Next Backlog

- Date: 2026-03-19
- Purpose: hold all deferred work outside the active auth/compliance slice for password recovery, account export delivery, and legacy hash migration
- Scope decision: items `3`, `4`, and `5` from the March 2026 commercial-readiness prioritization moved into active delivery; everything else stays parked here until reprioritized

## Active slice completed separately

- Email delivery for password reset and unlock
- Account export delivery worker
- Legacy shared-password hash migration

## Next commercial backlog

### Must

1. Amazon P5-S3: real credential validation
   - Why: Amazon remains the most important seller channel and cannot be sold honestly while `validateCredentials()` is still stubbed.
2. Amazon P5-S4: real publish path
   - Why: credential validation without publish does not close the marketplace readiness gap.

### High

1. Meesho credential validation
   - Why: seller-facing honesty is fixed, but install-time validation is still incomplete.
2. Flipkart token-expiry alerting
   - Why: prevent silent publish failures when a long-lived refresh token ages out.
3. AI enrichment from stub to real model calls
   - Why: this is the strongest near-term product lever for title quality and attribute completeness.
4. Catalog list-path performance follow-up
   - Why: `dashboard/catalog-health` scaling is already closed, but any remaining slow list/query paths should be tracked as a new performance item instead of reopening the old risk.

### Important

1. Broader public API surface for partner integrations
   - Why: API key and webhook foundations are shipped, but enterprise integration depth still needs expansion.
2. Self-serve onboarding completion
   - Why: onboarding still needs to get a seller from signup to first published SKU without operator intervention.
3. Usage-based billing with payment collection
   - Why: plan modeling exists, but revenue collection does not.
4. ONDC implementation beyond the feature-flagged shell
   - Why: strategically important for India expansion, but not the next commercial blocker.
5. Variant bulk edit and media workflow completion
   - Why: high-SKU sellers will feel these gaps quickly during pilot usage.

### Nice to have

1. SSO / Google login
2. Mobile app
3. Additional connectors such as Nykaa / Myntra
4. Product family model

## Notes

- This file is a parking lot, not a commitment list.
- Gate 3 rollout evidence remains time-gated and is tracked separately in:
  - `docs/execution/PROD_READINESS_RISK_REGISTER.md`
  - `docs/execution/rollout/`
- If a deferred item becomes urgent, move it into the active execution ledger before coding starts.
