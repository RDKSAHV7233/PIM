# Auth Revocation Failure Policy Decision

Date: 2026-09-03
Last reviewed: 2026-09-05
Status: Policy selected; integrated proof branch prepared; CI, staging proof, and final signoff pending
Scope: P1-2 JWT revocation failure behavior
Baseline: origin/main `d7dbd8bf26e1`
Implementation branch: `proof/p1-woo-auth-technical-proof-20260905-a`

## Current Source Finding

The P1-2 implementation changes access-token and refresh-token revocation
authority failures to fail closed by default. Bounded degraded read behavior is
allowed only for the explicit non-sensitive allowlist in
`AUTH_REVOCATION_DEGRADED_READ_ROUTE_INVENTORY_2026-09-05.md`.

This branch does not authorize rollout until review, CI, staging proof, and
signoff are complete.

Evidence:

- `apps/api/src/auth/jwt-auth.guard.ts` denies revocation-authority failures for
  mutating, admin, step-up, admin-boundary, unannotated, and non-allowlisted
  read routes.
- `apps/api/src/auth/auth.service.ts` returns invalid-token behavior when JTI or
  credential-revocation lookup fails during refresh.
- `apps/api/src/auth/jwt-blocklist.service.ts` throws service-unavailable on
  enabled Redis read failures and captures Error Authority evidence.
- `docs/execution/AUTH_REVOCATION_DEGRADED_READ_ROUTE_INVENTORY_2026-09-05.md`
  lists the explicit degraded-read allowlist.

This record captures the selected CTO/PO planning decision and the remaining
evidence gates before rollout.

## Required Policy Matrix

| Condition | Policy | Owner decision |
| --- | --- | --- |
| Token cryptographically invalid | DENY | Already required |
| Revocation authority says token revoked | DENY | Already required |
| Credential/session version explicitly revoked | DENY | Already required |
| Redis timeout during access-token revocation check | DENY unless route is in the explicit degraded-read allowlist | Selected; formal Security/SRE/CTO signoff pending |
| Redis unavailable during access-token revocation check | DENY unless route is in the explicit degraded-read allowlist | Selected; formal Security/SRE/CTO signoff pending |
| Credential-revocation lookup throws during access-token check | DENY unless route is in the explicit degraded-read allowlist | Selected; formal Security/SRE/CTO signoff pending |
| Redis/authority unavailable during token refresh | DENY / invalid token | Selected; formal Security/SRE/CTO signoff pending |
| Read-only request during revocation-authority outage | ALLOW only for explicitly named non-sensitive read policies or `public_safe` routes | Selected; formal Security/SRE/CTO signoff pending |
| Mutating request during revocation-authority outage | DENY | Selected; formal Security/SRE/CTO signoff pending |
| Admin or security-sensitive request during revocation-authority outage | DENY | Selected; formal Security/SRE/CTO signoff pending |

## Decision Inputs

Security risk: allowing requests during a revocation-authority outage can keep a
stolen, logged-out, disabled-user, or credentials-changed token usable until its
cryptographic expiry.

Availability risk: denying all authenticated requests during Redis or revocation
storage outages can convert an infrastructure incident into full authenticated
service downtime.

Operational requirement: any approved degraded mode needs an explicit maximum
duration, alert signal, health/readiness signal, audit trail, and customer-facing
behavior.

## Required Signoff

Security/AppSec:

SRE/Platform:

CTO/Architecture:

QA/Reliability:

## Implementation And Rollout Gate

Local auth code changes have been prepared on the implementation branch. Merge
and rollout remain blocked until the implementation PR includes tests and
evidence for:

- revoked access token;
- Redis unavailable during blocklist lookup;
- credential-revocation lookup failure;
- refresh-token behavior;
- read-only versus mutating behavior, if policy differs;
- admin/security-sensitive behavior;
- alerting or health signal for degraded auth.

No customer onboarding, broad release, or security-readiness claim may cite this
decision until the reviewed branch SHA has CI, staging outage-behavior evidence,
and named Security/SRE/CTO/QA approval.
