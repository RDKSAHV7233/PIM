# PIM1 Live Staging Evidence Runbook

Purpose: collect the external proof needed to close `RISK-P0-003` and advance `RISK-P0-001` without guessing at artifact contents after the fact.

## Scope

- Workflow: `.github/workflows/deploy-staging.yml`
- Required evidence:
  - live GitHub Actions run URL for the staging deploy
  - uploaded gate artifact bundle from that run
  - rollout snapshot proving `health.ok = true` and no controlled rollout blockers
- Remaining after a single successful run:
  - the 14-day / SLO broad-rollout observation window still remains open

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
   - `STAGING_SMOKE_WORKSPACE`
   - `STAGING_SMOKE_USER`
   - `STAGING_SMOKE_PASSWORD`
   - `STAGING_SMOKE_TENANT_ID`

3. The workflow now uses the checked-in Railway deploy script (`scripts/railway-deploy.cjs`) after installing `@railway/cli` on the runner. It deploys the prepared API package and the web service using explicit Railway service/project identifiers rather than a free-form shell command.

4. The target branch contains the current workflow guards:

```powershell
node scripts/validate-deploy-staging-workflow.cjs
```

## Trigger the live staging workflow

Run from the PIM1 repo root:

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
  - `health.status = "ok"`
  - `controlledRollout.pending = []`

### Expected partial state after the first live run

The validator should still report `broadPending` items until the 14-day/SLO window is complete. That is expected and should not block closure of `RISK-P0-003`.

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
