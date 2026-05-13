# Vexa PIM Live Staging Evidence Runbook

Purpose: collect the external proof needed to close `RISK-P0-003` and advance `RISK-P0-001` without guessing at artifact contents after the fact.

## Scope

- Workflow: `.github/workflows/deploy-staging.yml`
- Required evidence:
  - live GitHub Actions run URL for the staging deploy
  - uploaded gate artifact bundle from that run
  - rollout snapshot proving `health.ok = true` and no controlled rollout blockers
- Remaining after a single successful run:
  - the 14-day / SLO broad-rollout observation window still remains open

## Daily broad-rollout automation

Broad-rollout evidence now has a dedicated workflow:

- `.github/workflows/capture-daily-rollout-evidence.yml`

It runs on a daily schedule and on `workflow_dispatch`, then:

1. records a `STAGING_BROAD_ROLLOUT_DAILY` gate artifact
2. captures the current staging rollout snapshot
3. uploads the generated evidence as a workflow artifact
4. commits the new JSON evidence back into:
   - `docs/execution/gates/`
   - `docs/execution/rollout/`

The `deploy-staging.yml` push trigger now ignores those evidence paths so the daily bot commit does not recursively redeploy staging.

## Preconditions

1. GitHub CLI is authenticated:

```powershell
gh auth status
```

2. Repository secrets exist for the workflow:
   - `STAGING_DATABASE_URL_DIRECT` (preferred) or `STAGING_DATABASE_URL`
   - `RAILWAY_TOKEN`
   - `RAILWAY_PROJECT_ID`
   - `RAILWAY_API_SERVICE_ID`
   - `RAILWAY_WEB_SERVICE_ID`
   - `STAGING_BASE_URL`
   - `STAGING_WEB_URL` (recommended when public signup should be probed from the deployed web app)
   - `STAGING_SMOKE_WORKSPACE`
   - `STAGING_SMOKE_USER`
   - `STAGING_SMOKE_PASSWORD`
   - `STAGING_SMOKE_TENANT_ID`
   - `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED` (optional; defaults to `false` when omitted)

   Security note: do not share staging usernames, passwords, tokens, or connection strings in chat, tickets, or docs. Treat all staging credentials as secrets and retrieve/rotate them only through the repository/environment secret-management path.

3. The workflow now uses the checked-in Railway deploy script (`scripts/railway-deploy.cjs`) after installing `@railway/cli` on the runner. It deploys the prepared API package and the web service using explicit Railway service/project identifiers rather than a free-form shell command.

4. The target branch contains the current workflow guards:

```powershell
node scripts/validate-deploy-staging-workflow.cjs
```

## Trigger the live staging workflow

Run from the Vexa PIM repo root:

```powershell
gh workflow run deploy-staging.yml --ref main
gh run list --workflow deploy-staging.yml --limit 1
```

This is the preferred path because `.github/workflows/deploy-staging.yml` now supports `workflow_dispatch` for evidence collection without requiring a no-op push to `main`.

Copy the returned run ID, then watch the run:

```powershell
gh run watch <RUN_ID> --exit-status
```

If this fails, keep the full `gh run watch` output as the evidence of failure and do not update release risks.

## Download the artifacts

```powershell
$runId = "<RUN_ID>"
$artifactDir = ".tmp/staging-artifacts/$runId"
gh run download $runId --name "staging-gate-artifacts-$runId" --dir $artifactDir
```

Expected downloaded files:

- one gate artifact with suite `STAGING_DEPLOY_POSTCHECK`
- one rollout snapshot `*CONTROLLED_ROLLOUT_SNAPSHOT.json`

## Validate the evidence bundle

Controlled-rollout evidence validation:

```powershell
node scripts/validate-live-staging-evidence.cjs --artifactDir $artifactDir --environment staging --tenantId <STAGING_SMOKE_TENANT_ID>
```

Broad-rollout evidence validation is stricter and should only be used after the 14-day window is complete:

```powershell
node scripts/validate-live-staging-evidence.cjs --artifactDir $artifactDir --environment staging --tenantId <STAGING_SMOKE_TENANT_ID> --strictBroad
```

### Pass conditions

- gate artifact uses a live GitHub Actions `runUrl`
- gate artifact contains `environment`, `tenantId`, `date`, `gitTag`, `suite`
- rollout snapshot has:
  - `health.ok = true`
  - `health.status` indicating a healthy response (`200` or `"ok"`)
  - `controlledRollout.pending = []`

### Expected partial state after the first live run

The validator should still report `broadPending` items until the 14-day/SLO window is complete. That is expected and should not block closure of `RISK-P0-003`.

The rollout snapshot now computes those `broadPending` items from actual evidence-day coverage rather than fixed placeholder text.

## Attach to the release record

Add these references to the release board packet:

1. GitHub Actions run URL
2. Downloaded artifact directory path or archived copy
3. Output of:

```powershell
node scripts/validate-live-staging-evidence.cjs --artifactDir $artifactDir --environment staging --tenantId <STAGING_SMOKE_TENANT_ID>
```

4. Updated `docs/execution/PROD_READINESS_RISK_REGISTER.md` entries for:
   - `RISK-P0-003`
   - `RISK-P0-001`

## Decision rule

- If the workflow run fails: keep both risks open.
- If the workflow run passes but the validator fails: keep both risks open and fix the artifact gap.
- If the workflow run passes and the validator passes:
  - `RISK-P0-003` is ready for closure
  - `RISK-P0-001` can advance, but broad rollout still stays blocked until the 14-day/SLO evidence window is complete

## Optional public-signup rollout check

When testing the Vexa PIM self-serve signup rollout, use the focused non-destructive checker below.

It validates:

- `GET /api/v1/health`
- whether signup is correctly hidden or correctly enabled
- public signup API validation paths without creating a real tenant
- the `/signup` page when `STAGING_WEB_URL` is supplied

Environment variables:

- `STAGING_BASE_URL` (required, same value used by other staging checks)
- `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED=true|false`
- `STAGING_EXPECTED_ENV=staging`
- `STAGING_WEB_URL` (optional, required only if you want the script to probe the public `/signup` page)

Runtime flags that must match the intended rollout state:

- `api`: `FEATURE_PUBLIC_SIGNUP_ENABLED=true|false`
- `web`: `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED=true|false`
- `web`: `FEATURE_PUBLIC_SIGNUP_ENABLED=true|false`

When signup is enabled, set all three runtime flags to `true`. The web app uses the public flag for client exposure and the server-side fallback flag for route gating, so enabling only the API flag or only `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED` can still leave `/signup` returning `404`.

Disabled-state validation:

```powershell
$env:STAGING_BASE_URL="https://pim1api-staging.up.railway.app"
$env:STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED="false"
$env:STAGING_EXPECTED_ENV="staging"
node scripts/staging-public-signup-check.cjs
```

Enabled-state validation:

```powershell
$env:STAGING_BASE_URL="https://pim1api-staging.up.railway.app"
$env:STAGING_WEB_URL="https://pim1web-staging.up.railway.app"
$env:STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED="true"
$env:STAGING_EXPECTED_ENV="staging"
node scripts/staging-public-signup-check.cjs
```

Before running the enabled-state check, confirm Railway staging config is aligned:

- API service: `FEATURE_PUBLIC_SIGNUP_ENABLED=true`
- Web service: `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED=true`
- Web service: `FEATURE_PUBLIC_SIGNUP_ENABLED=true`

Expected enabled-state validations:

- signup availability endpoint returns `200`
- signup create endpoint rejects missing terms with `TERMS_ACCEPTANCE_REQUIRED`
- signup verify endpoint rejects bogus token with `SIGNUP_VERIFICATION_TOKEN_INVALID`
- `/signup` renders the `Create your Vexa PIM workspace` heading when `STAGING_WEB_URL` is provided

This check is intentionally safe to run before full live-email signup verification because it does not create a real workspace or consume a real verification token.
