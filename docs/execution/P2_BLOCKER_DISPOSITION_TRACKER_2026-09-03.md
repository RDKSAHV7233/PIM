# P2 Blocker Disposition Tracker

Date: 2026-09-03
Last reviewed: 2026-09-04
Status: Evidence/disposition pending
Baseline: origin/main `2dadb14e6bc9`

This tracker keeps the P2 work out of the P1 fix PRs. Do not use it to authorize
optimization, customer onboarding, public claims, or GA.

## P2-1 Storage Fallback

Required owners: Platform/SRE, Security, Backend, DevOps

Current source evidence:

- `apps/api/src/media/media-storage.service.ts` uses filesystem storage when
  `MEDIA_STORAGE_MODE=filesystem`, `STORAGE_BACKEND=local`, missing R2 config,
  or `R2_ACCOUNT_ID=local-dev`.
- `apps/api/src/auth/auth-export-storage.service.ts` uses filesystem storage
  when `ACCOUNT_EXPORT_STORAGE_MODE=filesystem`, `STORAGE_BACKEND=local`,
  missing R2 config, or `R2_ACCOUNT_ID=local-dev`.
- `apps/api/src/common/env-validation.ts` requires
  `ACCOUNT_EXPORT_STORAGE_DIR` when account export storage is filesystem in
  staging/production, but runtime environment evidence is still required before
  classifying exploitability.

Required evidence:

- staging values for media storage mode, account export storage mode,
  `STORAGE_BACKEND`, and R2 configuration;
- production values for the same keys;
- startup behavior when production is configured for unsupported local storage;
- SRE decision: object storage required, local emergency-only, or documented
  external Railway contract.

Disposition: Pending

## P2-2 Admin-Boundary Legacy Fallback

Required owners: PO, Security, CTO, RBAC owner, QA

Current source evidence:

- `apps/api/src/common/rbac/rbac.guard.ts` allows legacy app-role fallback unless
  `allowLegacyAdminFallback === false`.
- Some admin-sensitive controllers explicitly disable fallback.
- Some routes still opt into legacy fallback or inherit the default.

Required evidence:

- enumerate every `@AdminBoundaryAccess` route;
- identify which routes require explicit admin-boundary roles only;
- identify which routes intentionally support legacy app-role compatibility;
- create an expiry/removal decision if compatibility remains;
- test matrix for app roles and admin-boundary roles per route class.

Disposition: Pending

## P2-3 Queue Handoff Residual Gap

Required owners: Marketplace Backend, SRE, Queue owner, QA

Current source evidence:

- `apps/api/src/marketplace/marketplace.service.ts` leaves an export job queued
  when enqueue throws and BullMQ presence cannot be verified.
- The source comment names the residual gap and references
  `TECH-QUEUE-RECON-001`.
- Unit coverage exists for `QUEUE_HANDOFF_UNVERIFIED`, but runtime
  reconciliation evidence is still required.

Required evidence:

- enqueue succeeds;
- enqueue fails before BullMQ acceptance;
- enqueue outcome is ambiguous;
- process crash between DB create and queue confirmation;
- stale queued job reconciliation;
- safe retry without duplicate channel publication.

Disposition: Pending

## Gate Impact

P2 items do not block the P1-1 Woo app-auth fix PR, but they do block broad
readiness, GA, and optimization planning until owners record explicit
disposition.
