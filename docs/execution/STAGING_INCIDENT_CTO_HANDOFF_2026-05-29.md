# Staging Incident CTO Handoff

- Date: 2026-05-29
- Incident class: staging infrastructure / configuration
- Severity: P1
- Primary reference: `docs/execution/STAGING_DB_REACHABILITY_INCIDENT_2026-05-29.md`
- Failed deploy run: `https://github.com/Vexapim/PIM/actions/runs/26599675272`
- Last known-good staging recovery run: `https://github.com/Vexapim/PIM/actions/runs/25988595126`

## Executive readout

Staging was not updated.

The official `deploy-staging.yml` workflow on `main` failed twice in `Apply migrations` before any app deploy occurred. The exact blocker is Prisma `P1001` against the staging direct Postgres endpoint `trolley.proxy.rlwy.net:59963`.

In parallel, the approved curl-resolve staging smoke path returned `404 Application not found` for previously authoritative public staging hostnames. That means this is not a repo-code release issue. Treat it as a staging environment incident with both database-path and public-routing verification required before the next deploy attempt.

## What is known

1. The workflow had database secrets present.
   - `STAGING_DATABASE_URL_DIRECT`
   - `STAGING_DATABASE_URL`

2. The same direct DB endpoint succeeded on 2026-05-17.
   - known-good run: `25988595126`
   - endpoint: `trolley.proxy.rlwy.net:59963`

3. The current failed run never reached:
   - `Deploy to staging`
   - `Staging smoke test`
   - `Staging post-deploy verification`
   - `Public signup smoke check`
   - `E2E smoke - post-deploy verification`

4. A live-path probe also failed:
   - command path: `node -r ./scripts/staging-fetch-via-curl.cjs scripts/staging-postdeploy-check.cjs`
   - result: `404 Application not found`

## CTO decision

1. Freeze deploy-code edits.
2. Do not modify workflow logic first.
3. Do not reopen product-code stories based on this incident.
4. Put DevOps on environment reconciliation:
   - database reachability
   - Railway service/domain resolution
   - GitHub staging secret alignment

## DevOps action checklist

### A. Confirm Railway staging database state

1. Open the Railway project and inspect the staging Postgres service health.
2. Confirm the database is running and not suspended, restarting, or rate-limited.
3. Validate the current direct connection string from Railway.
4. From a trusted operator environment, test the direct connection:

```powershell
psql "${DATABASE_URL_DIRECT}" -c "SELECT NOW();"
psql "${DATABASE_URL_DIRECT}" -c "SELECT COUNT(*) FROM \"_prisma_migrations\";"
```

5. If direct `psql` fails, this is the primary blocker. Repair the Railway database service or rotate the direct connection string before touching repo code.

### B. Reconcile GitHub staging database secrets

1. Compare Railway’s live direct connection string against GitHub `staging` environment secrets:
   - `STAGING_DATABASE_URL_DIRECT`
   - `STAGING_DATABASE_URL`
2. If they differ, update GitHub secrets immediately.
3. If they match but direct connectivity still fails from GitHub Actions, treat that as a platform-path incident rather than an app incident.

### C. Verify current public staging service domains

1. In Railway, verify the live public domain for:
   - API service: `Vexa API`
   - Web service: `App Vexa`
2. Compare those live domains against GitHub `staging` environment secrets:
   - `STAGING_BASE_URL`
   - `STAGING_WEB_URL`
3. If those secrets point at stale domains, update them before rerunning deploy.

### D. Validate staging runtime after domain reconciliation

Run the approved smoke path with the live domains:

```powershell
$env:STAGING_RESOLVE_IP='151.101.2.15'
$env:STAGING_BASE_URL='<live-api-root>'
$env:STAGING_WEB_URL='<live-web-root>'
$env:STAGING_SMOKE_WORKSPACE='<smoke-workspace>'
$env:STAGING_SMOKE_USER='<smoke-user>'
$env:STAGING_SMOKE_PASSWORD='<smoke-password>'
$env:STAGING_EXPECTED_ENV='staging'
$env:STAGING_VALIDATE_NON_ADMIN='true'
node -r ./scripts/staging-fetch-via-curl.cjs scripts/staging-postdeploy-check.cjs
```

Expected outcome:

- API health returns `200`
- `env=staging`
- `queueRuntime.backend=bullmq`
- `queueRuntime.workerEnabled=true`

### E. Re-run the official deploy only after A-D are green

Re-run:

```powershell
gh workflow run deploy-staging.yml --ref main --repo Vexapim/PIM
```

Then watch:

```powershell
gh run watch <RUN_ID> --repo Vexapim/PIM --exit-status
```

## Recovery success criteria

1. `Apply migrations` passes in GitHub Actions.
2. `Deploy to staging` completes.
3. `Staging smoke test` passes.
4. `Staging post-deploy verification (auth + trust boundary)` passes.
5. `Public signup smoke check` passes in the intended disabled/enabled posture.
6. `E2E smoke - post-deploy verification` passes.
7. Gate artifacts upload successfully.

## Leadership update template

```text
Staging is not live from the current main deploy attempt.

The official staging workflow failed twice before app deploy in the Prisma migration step, with the runner unable to reach the staging direct Postgres endpoint. We also confirmed that the approved live staging smoke path is currently returning 404 Application not found for previously authoritative public staging hostnames.

Current assessment: this is an infrastructure/configuration incident in the staging environment, not a product-code regression.

Immediate action: DevOps is reconciling Railway database connectivity, public staging domain mapping, and GitHub staging secrets before the next deploy attempt.

Current production impact: none confirmed.
Current staging impact: deploy lane blocked; public staging verification path degraded.
```

## Slack update template

```text
P1 staging incident: deploy lane blocked before app rollout.

Facts:
- main deploy run 26599675272 failed twice in Apply migrations
- exact error: Prisma P1001 reaching trolley.proxy.rlwy.net:59963
- live staging smoke path also returned 404 Application not found on prior public staging hosts

Assessment:
- not a repo-code regression
- likely staging DB/path and public-domain drift

Next actions:
- verify Railway staging Postgres health and direct connection
- reconcile STAGING_DATABASE_URL_DIRECT / STAGING_DATABASE_URL
- verify live public domains for Vexa API + App Vexa
- update STAGING_BASE_URL / STAGING_WEB_URL if stale
- rerun deploy-staging on main once environment is green
```

## Do not do

1. Do not patch `.github/workflows/deploy-staging.yml` first.
2. Do not change Railway service targeting first.
3. Do not rewrite migrations based only on `P1001`.
4. Do not declare staging healthy again until both:
   - migration lane passes
   - live post-deploy smoke passes

## Repo note

Two diagnostic rollout snapshots were generated during local incident verification on 2026-05-29:

- `docs/execution/rollout/2026-05-28T20-31-05.607Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`
- `docs/execution/rollout/2026-05-28T20-31-26.527Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`

They are diagnostic artifacts from a degraded-path probe, not evidence of staging recovery.
