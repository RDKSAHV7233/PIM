# Incident: staging deploy lane blocked by database reachability and public routing drift

- Date: 2026-05-29
- Audience: CTO, DevOps, release owner
- Severity: P1
- Status: open
- Scope: staging deployment lane, staging API/public routing verification

## Summary

The standard staging deploy workflow on `main` failed twice before any application deploy occurred.

This is not currently a repo-code regression.

The first blocking failure is database reachability during the migration step. A second live-path concern is also present: public staging hostnames that were previously healthy are now returning `404 Application not found` when probed through the Railway edge-resolution workaround.

## Triggered workflow

- Workflow: `.github/workflows/deploy-staging.yml`
- Repository: `Vexapim/PIM`
- Branch: `main`
- Commit deployed: `adddae257dd72f4c18802c2c77b19af9cb0200c4`
- Run URL: `https://github.com/Vexapim/PIM/actions/runs/26599675272`

## Exact failure evidence

### Failing command

```text
npm run prisma:migrate:deploy
```

### Failing step

- `Apply migrations`

### Failing output

```text
Error: P1001: Can't reach database server at `trolley.proxy.rlwy.net:59963`
Please make sure your database server is running at `trolley.proxy.rlwy.net:59963`.
```

### Responsible workflow and script paths

- `.github/workflows/deploy-staging.yml`
- `scripts/prisma-migrate-deploy.cjs`

## What was verified

### 1. This is not a missing-secret failure

The workflow had both:

- `STAGING_DATABASE_URL_DIRECT`
- `STAGING_DATABASE_URL`

present in the job environment.

### 2. This is not a new endpoint mismatch

The last known-good staging recovery run:

- run: `25988595126`
- date: `2026-05-17`

used the same direct database endpoint:

```text
trolley.proxy.rlwy.net:59963
```

and completed successfully end to end.

That means the current failure is not explained by a newly mis-targeted database hostname in the workflow.

### 3. The deploy lane failed before any Railway app deploy

The failed runs never reached:

- `Build API`
- `Build Web`
- `Deploy to staging`
- `Staging smoke test`
- `Staging post-deploy verification`
- `Public signup smoke check`
- `E2E smoke - post-deploy verification`

### 4. TCP reachability exists from the local operator machine

`Test-NetConnection trolley.proxy.rlwy.net -Port 59963` returned `TcpTestSucceeded = True`.

This does not prove Prisma connectivity from GitHub Actions, but it does argue against a total public network outage to that host:port.

### 5. Public staging routing also appears degraded or drifted

Using the approved curl-resolve staging verification path:

```text
$env:STAGING_RESOLVE_IP='151.101.2.15'
$env:STAGING_BASE_URL='https://api-staging-490e.up.railway.app'
$env:STAGING_WEB_URL='https://pim1-staging.up.railway.app'
node -r ./scripts/staging-fetch-via-curl.cjs scripts/staging-postdeploy-check.cjs
```

the health check failed with:

```text
health failed: expected 200, got 404; payload={"status":"error","code":404,"message":"Application not found",...}
```

This indicates that at least one previously authoritative public staging hostname is no longer resolving to the expected live application.

## Most likely interpretation

The strongest current interpretation is:

1. the staging database or Railway direct proxy path is unavailable to the GitHub Actions migration lane, and
2. the public staging hostname mapping is also stale or drifted from the current Railway routing state.

This should be handled as a staging infrastructure/configuration incident, not as an application-code incident.

## Secret metadata that matters

GitHub staging secret timestamps:

- `STAGING_DATABASE_URL_DIRECT` last updated: `2026-05-07T10:03:53Z`
- `STAGING_DATABASE_URL` last updated: `2026-05-07T10:03:55Z`

These secrets are old, but because the exact same endpoint succeeded on `2026-05-17`, the evidence points more strongly to live environment drift or Railway-side reachability than to a simple malformed secret value.

## Recovery order

1. In Railway, verify the staging Postgres instance is running and accepting direct connections.
2. Confirm the current direct connection string and test it from a trusted operator environment outside GitHub Actions.
3. Verify that the GitHub `staging` environment secrets still match the live Railway direct connection values:
   - `STAGING_DATABASE_URL_DIRECT`
   - `STAGING_DATABASE_URL`
4. Verify the current public Railway API and web domains for the staging services:
   - API service: `Vexa API`
   - Web service: `App Vexa`
5. Reconcile those domains with:
   - `STAGING_BASE_URL`
   - `STAGING_WEB_URL`
6. Re-run `.github/workflows/deploy-staging.yml` on `main` without changing repo deploy code.
7. Only if the rerun still fails after environment reconciliation, open a second-stage investigation into GitHub Actions network-path specificity.

## Explicit do-not-do list

- Do not patch deploy workflow logic first.
- Do not change service-target mappings first.
- Do not treat this as a product regression without new evidence from a successful migration lane followed by an application failure.
- Do not bypass migrations with ad hoc schema edits.

## Current conclusion

`Staging was not updated. The standard deploy lane is blocked at database reachability, and the previously used public staging hostnames also need verification against current Railway routing before further rollout claims are made.`
