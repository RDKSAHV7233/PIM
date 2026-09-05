---
title: P1 Woo/Auth External CI And Staging Handoff
status: external-ci-and-staging-pending
owner: CTO / PO / Security / QA / SRE / Release Engineering
last_updated: 2026-09-05
---

# P1 Woo/Auth External CI And Staging Handoff - 2026-09-05

This handoff converts the local P1 Woo/Auth technical proof into the remaining
external release gates. It is not production approval and does not reopen
customer WooCommerce setup, onboarding, pilot, or GA claims.

## Candidate

- Branch: `proof/p1-woo-auth-technical-proof-20260905-a`
- Base verified before this handoff: `origin/main d7dbd8bf26e1`
- Pushed proof tip before this handoff: `04a9eadfe7f260b4afeaad060d285c44ec921336`
- Latest executable proof SHA: `5162b7e2e4cb`
- Repository PR URL:
  `https://github.com/bhoivishal216-ai/PIM/pull/new/proof/p1-woo-auth-technical-proof-20260905-a`

The branch is present on both configured Git remotes that resolve to the moved
repository:

- `origin`: `04a9eadfe7f260b4afeaad060d285c44ec921336`
- `alt`: `04a9eadfe7f260b4afeaad060d285c44ec921336`

## Included Scope

- P1-1: Woo app-auth credential persistence remains tenant-owned.
- P1-2: auth revocation authority failures fail closed for mutating, admin, and
  security-sensitive requests.
- P1-3: WooCommerce customer setup/install remains hidden or blocked while P1
  hold is open.
- Security follow-up: degraded revocation reads are restricted to explicit
  allowlist entries only.
- QA follow-up: Meesho reconnect does not run live credential validation while
  RD-MEESHO-1 remains deferred.

## Local Proof Already Completed

The compact local proof set is recorded in
`P1_WOO_AUTH_TECHNICAL_PROOF_2026-09-05.md`. The key completed checks were:

- `npm ci --ignore-scripts --no-audit --no-fund`
- `npm run prisma:generate`
- `git diff --check`
- `git show --check`
- P1 targeted auth/Woo unit suite
- connector installer unit suite
- API build
- web build
- Woo customer hold copy integration check
- JWT blocklist contract integration check
- auth revocation integration check
- marketplace capability gating
- credential rotation
- connector access entitlements
- connector action matrix UI gating
- marketplace capability UI gating
- admin connectors route contract
- staging workflow static validation
- production promotion workflow static validation

This proves the branch is ready for external CI/staging review. It does not
replace the GitHub Actions CI gate or live staging runtime evidence.

## External Gate Sequence

1. Release Engineering opens the PR from
   `proof/p1-woo-auth-technical-proof-20260905-a` into `main`.
2. Release Engineering verifies that GitHub Actions `CI` runs on the PR head.
3. QA verifies the CI run is tied to the reviewed PR head SHA and that no job is
   skipped unexpectedly for the changed API, web, package, script, or workflow
   paths.
4. CTO reviews the PR diff for branch scope, merge ancestry, degraded-read
   allowlist scope, and Woo hold posture.
5. Security reviews the fail-closed revocation behavior and tenant credential
   handling.
6. SRE deploys staging from the reviewed SHA only, using
   `.github/workflows/deploy-staging.yml`.
7. QA runs real staging Woo app-auth onboarding and records browser/runtime
   evidence.
8. Security and Data reviewers verify stored Woo credential rows are scoped by
   `tenant_key`, installation, and credential type without exposing plaintext
   secrets.
9. SRE and Security run staging revocation-authority outage probes against live
   Redis and credential-revocation lookup dependencies.
10. Release Engineering records the staging gate artifact and controlled rollout
    snapshot.
11. CTO, PO, Security, QA, and SRE record fresh named approval before any
    customer onboarding restart or live promotion.

## GitHub Actions Trigger Notes

`.github/workflows/ci.yml` runs for:

- `workflow_dispatch`
- pull requests into `main`
- pushes to `main`

The proof branch push alone does not satisfy exact-SHA CI unless the workflow is
manually dispatched for that ref or the branch is opened as a PR to `main`.

`.github/workflows/deploy-staging.yml` runs for:

- `workflow_dispatch`
- pushes to `main` except ignored docs execution gate and rollout paths

Staging proof must therefore be created by an authorized workflow dispatch or
approved merge/deploy path. Do not treat local Railway CLI state as staging
deployment evidence.

## Required Staging Inputs

SRE must verify these staging secrets or resolved values exist before dispatch:

- `STAGING_DATABASE_URL`
- `STAGING_DATABASE_URL_DIRECT`
- `OBSERVABILITY_DATABASE_URL` or Railway-derived equivalent
- `RAILWAY_TOKEN` or `RAILWAY_API_TOKEN`
- `RAILWAY_PROJECT_ID`
- `RAILWAY_API_SERVICE` or `RAILWAY_API_SERVICE_ID`
- `RAILWAY_WEB_SERVICE` or `RAILWAY_WEB_SERVICE_ID`
- `RAILWAY_ENVIRONMENT_ID` or staging environment name resolution
- `STAGING_BASE_URL` fallback if Railway URL resolution is unavailable
- `STAGING_WEB_URL` fallback if Railway URL resolution is unavailable
- `STAGING_SMOKE_TENANT_ID`
- `STAGING_SMOKE_WORKSPACE`
- `STAGING_SMOKE_USER`
- `STAGING_SMOKE_PASSWORD`

## Evidence To Attach To The PR

- PR CI URL and exact head SHA.
- Staging deploy workflow URL and exact deployed SHA.
- `STAGING_DEPLOY_POSTCHECK` artifact from the staging deploy run.
- Controlled rollout snapshot artifact from the same staging deploy run.
- Woo app-auth onboarding proof in staging.
- Redacted credential ownership proof showing tenant/install/credential-type
  scoping and no plaintext secrets.
- Auth revocation outage proof for:
  - access-token checks;
  - refresh-token checks;
  - mutating requests;
  - admin/security-sensitive requests;
  - explicitly allowlisted degraded read-only routes.
- Named CTO, PO, Security, QA, and SRE approvals.

## Current Role Verdict

| Role | Current verdict | Reason |
| --- | --- | --- |
| CTO / Architecture | Pending external review | Integrated branch is prepared; needs PR diff and exact-SHA CI |
| Product Owner | Hold customer onboarding | User/PO approved continued gate execution, not live promotion |
| Security | Pending outage proof | Local fail-closed behavior is covered; staging dependency outage proof remains |
| QA | Pending exact-SHA CI and staging runtime | Local compact proof is green; external CI and browser/runtime proof remain |
| SRE / DevOps | Pending staging deploy | Shell has no linked deploy target or authorized workflow dispatch |
| Release Engineering | Pending PR/Actions gate | Branch is pushed; PR or workflow_dispatch is still required |

## Live Decision

Live promotion remains **NO-GO** until the external gates above pass. WooCommerce
may be treated as working internally for blocker closure, but customer
setup/install lanes and public claims remain closed until fresh named signoff is
recorded.
