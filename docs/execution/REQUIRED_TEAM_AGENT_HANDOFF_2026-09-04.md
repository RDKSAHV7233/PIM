# Required Team And Agent Handoff

Date: 2026-09-04
Status: Local blocker branches prepared on current base; external approval and runtime gates still closed
Worktree: `/mnt/c/Users/bhoiv/PIM1-origin-main-readiness-20260903-085633`
Current base: `origin/main` at `2dadb14e6bc9`

This handoff keeps the blocker-closure work split by risk domain. It does not
authorize customer onboarding, public claims, deployment, migration, merge, or
runtime auth-policy rollout before review and staging proof.

## Active Local Branches

| Branch | Local commit | Risk domain | State |
| --- | --- | --- | --- |
| `blocker/p1-woo-app-auth-tenant-key` | `aed94b38bf9a` | WooCommerce app-auth tenant ownership | Rebasing complete on `2dadb14e6bc9`; local write/read fix preserved; pending PR review, CI, staging runtime proof |
| `blocker/p1-auth-revocation-fail-closed-mutations-20260904` | `707566aeaf65` | JWT revocation outage policy | Local fail-closed mutation/admin/security-sensitive implementation prepared; pending dependency-backed tests, PR review, CI, staging runtime proof |
| `readiness/control-hold-p1-blockers-20260903` | Current branch tip | Readiness control state and blocker governance | Rebasing complete on `2dadb14e6bc9`; Woo customer setup/install hold prepared; pending review and approval |

## Required Agents And Owners

| Agent / team | Required responsibility | Stop condition |
| --- | --- | --- |
| CTO / Architecture Review Board | Own gate authority, PR split, final readiness verdict, and large-scope escalation | No merge, pilot restart, or optimization until CTO records decision |
| Release Engineering / Git Maintainer | Confirm branch tips, clean base, CI SHA, and protected-branch workflow | Stop if CI is not for the reviewed SHA |
| Backend Lead | Review service-level code changes and prevent unrelated behavior changes | Stop if Woo fix and auth policy are mixed in one PR |
| WooCommerce Connector Engineer | Own app-auth callback persistence and connector-specific regression coverage | Stop until real staging Woo app-auth onboarding proves tenant ownership |
| Auth / IAM Engineer | Own JWT revocation implementation for the selected fail-closed mutation policy | Stop before rollout if exact-SHA CI or staging proof is missing |
| Security Lead / AppSec | Review unavailable revocation-authority behavior and tenant credential handling | Stop if degraded-auth behavior lacks explicit route classification, maximum duration, and monitoring |
| SRE / Platform | Own Redis failure-mode posture, staging/prod runtime evidence, queue/storage disposition inputs | Stop if deployed SHA or runtime config cannot be proven |
| QA / Reliability | Own RED/GREEN regression evidence, staging acceptance, and denial-path tests | Stop if only local unit tests exist for a customer-visible claim |
| DevOps / Railway Owner | Confirm staging deployment SHA, env flags, Redis behavior, object storage mode, and connector runtime | Stop if Railway state cannot be tied to the reviewed commit |
| Data / Multi-tenant Reviewer | Verify `tenant_key` persistence, raw SQL guardrails, defaults, and cross-tenant blast radius | Stop if schema defaults can determine credential ownership |
| Privacy / Compliance | Review credential, audit, redaction, storage, and evidence-retention handling | Stop before sharing proof containing secrets or tenant-sensitive data |
| Legal / Risk | Confirm whether auth/storage/connector holds affect pilot commitments or customer terms | Stop before commercial or customer promise changes |
| PO | Decide pilot scope, transitional admin-boundary posture, and customer-facing rollout state | Stop if onboarding scope is ambiguous |
| Commercial / Sales | Hold unsupported claims and affected-path outreach while gates are open | Stop if sales language implies Woo app-auth or security readiness |
| Marketing | Require `claim_id -> Claims Matrix -> proof_id -> current evidence` before claims | Stop if proof is stale, source-only, or not environment-bound |
| Support / Operations | Prepare escalation, incident, and customer communication paths for affected flows | Stop if pilot support runbook conflicts with hold state |

## Agent Dispatch Board

| Review lane | Assigned review lens | Inputs | Required output |
| --- | --- | --- | --- |
| P1-1 Woo app-auth | Woo Connector, Backend, Data/Multi-tenant, QA, Security | Branch `blocker/p1-woo-app-auth-tenant-key`; Woo connector implementation and spec | PR-review verdict, missing coverage list, staging proof checklist |
| P1-2 JWT revocation | Auth/IAM, Security/AppSec, SRE, Backend, QA, CTO | Branch `blocker/p1-auth-revocation-fail-closed-mutations-20260904`; auth guard/blocklist/refresh paths | PR-review verdict, exact-SHA CI, staging outage-behavior proof |
| CI/deploy correlation | Release Engineering, DevOps/SRE, QA | Reviewed branch SHA, GitHub Actions result, deployed staging SHA | SHA-matched CI and staging evidence |
| P2 dispositions | SRE, Security, Backend, PO, Queue owner, QA | `docs/execution/P2_BLOCKER_DISPOSITION_TRACKER_2026-09-03.md` | Evidence-only disposition; no P2 remediation mixed into P1 PRs |
| Claims and onboarding | CTO, PO, Security, QA, SRE, Commercial, Marketing, Support | Readiness docs, Claims Matrix, proof registry, runtime evidence | Explicit hold/restart decision and approved claim set |

## Immediate Execution Order

1. Keep the two local branches separate.
2. Submit `blocker/p1-woo-app-auth-tenant-key` for Woo/Backend/Data/QA/Security review with the tenant-scoped write/read fix.
3. Submit `blocker/p1-auth-revocation-fail-closed-mutations-20260904` for Auth/Backend/Security/SRE/QA/CTO review with the selected fail-closed mutation policy.
4. Recover local dependency-backed test evidence and CI evidence for each exact reviewed branch SHA.
5. Deploy only after merge approval and normal release control.
6. Run staging Woo app-auth onboarding and verify credential rows are explicitly tenant-owned without exposing secrets.
7. Run auth revocation outage tests for mutating, admin, security-sensitive, refresh, and explicitly classified read-only routes.
8. Re-check pilot docs, support runbook, and claims matrix after staging evidence exists.
9. Reopen customer onboarding only by named CTO/PO/Security/QA/SRE approval.
10. Keep optimization planning blocked until P1 gates and required P2 dispositions are closed.

## Current Evidence Boundary

Completed locally:

- Woo app-auth tenant-key write/read fix branch exists and was locally tested.
- Auth revocation outage implementation branch exists for the selected fail-closed mutation policy.
- Readiness control-hold branch exists and Woo customer setup/install hold was prepared.
- Required disposition records exist for P2 items.
- No temporary dependency symlink remains in the isolated worktree.

Missing external proof:

- CI on exact reviewed SHA.
- Deployed staging SHA correlation.
- Real staging Woo app-auth onboarding.
- Runtime credential ownership proof.
- Connector-installer and staging runtime proof that Woo credential writes and reads remain tenant-owned end to end.
- Formal Security/SRE/CTO approval of the implemented revocation-authority outage behavior.
- QA/Security/SRE signoff after runtime tests.
- Claims Matrix and proof registry entries tied to current environment evidence.

## Approval Gate

Customer onboarding remains on hold until all of these are true:

- P1-1 Woo app-auth branch is reviewed, CI-green, staged, and runtime-verified.
- P1-2 auth revocation failure policy is signed and implemented or explicitly accepted by Security/SRE/CTO.
- Required runtime evidence is linked to exact commit SHA and environment.
- CTO, PO, Security, QA, and SRE record a fresh readiness decision.
