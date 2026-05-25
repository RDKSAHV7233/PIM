---
title: Vexa PIM Incident Response Runbook
audience: internal-ops
status: active
last_updated: 2026-05-17
owner: DevOps + Engineering Lead
---

## 1. Severity levels and response targets

| Severity | Definition | Response target | Example |
|---|---|---|---|
| P0 | Production down, data-loss risk, or auth broken for all users | 15 min | API returns 500 on all routes; all tenants fail login |
| P1 | Feature degraded, elevated error rate, or one tenant materially affected | 1 hour | Queue backlog grows; one tenant cannot publish |
| P2 | Performance degraded or a non-critical feature is broken | 4 hours | Dashboard reads are slow; an audit filter is broken |

## 2. On-call contacts and escalation matrix

| Severity | Who to page | When | How |
|----------|-------------|------|-----|
| P0 — data loss, auth broken, service fully down | CTO + DevOps on call | Immediately (within 5 min of detection) | Phone + Slack DM |
| P1 — degraded service, one tenant affected, Redis/R2 down | DevOps on call | Within 30 minutes | Slack DM |
| P2 — single feature broken, performance degraded | DevOps | Next business day | Slack channel |

Primary on-call: [FILL: name, phone, PagerDuty or Slack handle]  
Secondary: [FILL: name, phone]  
CTO escalation: [FILL: CTO name, phone] — page for all P0s without exception

**Rule:** If you are unsure of severity, treat as P0 until proven otherwise.

## 3. First 5 minutes - triage checklist

1. Open the Railway project dashboard: [FILL: Railway project URL].
2. Check staging health:
   - `GET https://api-staging-4faf.up.railway.app/api/v1/health`
   - Healthy response includes `status: "ok"`, `env: "staging"`, `queueRuntime.backend: "bullmq"`, and `queueRuntime.workerEnabled: true`.
   - If `env` is not `staging`, you are looking at the wrong service or the wrong URL.
   - If `queueRuntime.workerEnabled` is `false`, the deployed runtime is not matching the staging contract.
3. Check the latest GitHub Actions run for the affected lane:
   - `deploy-staging.yml` for a deploy regression
   - `e2e-staging.yml` for nightly or manual staging E2E regressions
4. Check Railway logs for startup failures.
   - Env validation failures print a startup error block and terminate boot if required variables are missing or invalid.
   - The required staging contract is enforced in `apps/api/src/common/env-validation.ts`.
5. Check Redis connectivity.
   - Auth rate limiting and JWT blocklist fall back when Redis is unavailable.
   - Queue durability depends on BullMQ + Redis.
   - Look for Redis connection warnings in API logs from auth or queue services.

## 4. Runbook: API completely down (P0)

1. Check Railway restart count for the API service.
   - More than 3 restarts in 10 minutes usually means a crash loop, often from env validation or boot-time connection failure.
2. Check staging env vars in Railway.
   - `APP_ENV=staging`
   - `AUTH_MODE=db`
   - `QUEUE_BACKEND=bullmq`
   - `QUEUE_WORKER_ENABLED=true`
   - `JWT_SECRET` present
   - `REDIS_URL` present
   - `DATABASE_URL_POOLED` and `DATABASE_URL_DIRECT` present
3. Check recent migration state in PostgreSQL:
   - `SELECT * FROM "_prisma_migrations" ORDER BY finished_at DESC LIMIT 5;`
4. If the latest migration failed, do not bypass it with ad hoc schema edits.
   - Fix the migration in git.
   - Re-run `npx prisma migrate deploy --schema packages/db/prisma/schema.prisma` against staging.
   - Re-trigger the deploy only after the migration path is clean.
5. If env and migrations are clean, roll back to the last known good SHA from Railway and confirm `/api/v1/health` returns healthy.
6. After service recovery, run the post-deploy checks again:
   - `node scripts/staging-postdeploy-check.cjs`
   - `node scripts/e2e-user-journey.cjs --smoke`

## 5. Runbook: auth broken - all users receive 401 or login fails globally

1. Verify `JWT_SECRET` has not changed unexpectedly.
   - Changing it invalidates every active session token.
   - In staging and production, the API service and web service must use the same `JWT_SECRET` or `PIM_JWT_SECRET`.
   - If the API can mint an admin token but the web app re-verifies it with a different secret, server-rendered pages silently fall back to viewer/read-only mode.
2. Verify `AUTH_MODE=db` in Railway env.
   - Staging and production should not run in local auth mode.
3. Check API logs for the failure shape.
   - Distinguish missing bearer token, revoked token, expired token, and invalid credential responses.
4. Check Redis availability.
   - Logout blocklisting and rate limiting both rely on Redis-backed state, with fallback behavior in auth service.
5. Check whether the failure is only for users without `passwordHash`.
   - Those identities still depend on the legacy shared password path via `PIM_AUTH_PASSWORD`.
6. If only one user or tenant is affected, verify their `AuthIdentity` row:
   - `isActive`
   - `lockedUntil`
   - `passwordHash`
   - `role`
7. If step-up is failing but normal login works, verify that the user has the correct stored credential path and that the step-up request uses the current password.

## 6. Runbook: queue backlog or jobs not processing

1. Verify staging still reports BullMQ worker mode on the public health endpoint:
   - `GET /api/v1/health`
   - `queueRuntime.backend` must be `bullmq`
   - `queueRuntime.workerEnabled` must be `true`
2. Inspect queue metrics in the health payload.
   - The reviewed repo exposes queue metrics through `/health`; there is no dedicated `queue/metrics` route in the reviewed source.
   - Check `queues.*.pausedLanes`, pending counts, and error counts.
3. If `pausedLanes > 0`, treat it as a connector or downstream reliability incident.
   - Fix the connector-side cause first.
   - Lanes resume after the configured pause window when the circuit breaker closes.
4. If queues are not paused but work is not moving, verify Redis health and BullMQ worker registration.
   - Confirm Redis-backed auth state and BullMQ queue keys are present.
   - Confirm the worker service actually booted with worker mode enabled.
5. If the queue is unhealthy immediately after deploy, compare the deployed env vars with `env-validation.ts` and re-check Railway restart logs.

## 7. Runbook: staging deploy failed

1. Open the failed `deploy-staging.yml` run in GitHub Actions.
   - Record the run URL in the incident thread before requesting workflow or Railway-targeting edits.
   - Compare the failure against the recovery baseline run `25988595126`.
2. Identify the first failed step.
   - Common classes are `Apply migrations`, `Build API`, `Build Web`, `Staging smoke test`, `Public signup smoke check`, and `E2E smoke - post-deploy verification`.
3. Confirm the staging target mapping is still correct before editing deploy code:
   - web service: `App Vexa`
   - api service: `Vexa API`
   - `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED=false` is the default recovered posture unless a separate rollout decision changed it
4. If `Apply migrations` failed:
   - Read the SQL or Prisma error in the job log.
   - Fix the migration in git.
   - Re-run the workflow after the migration path is corrected.
5. If `Build API` or `Build Web` failed:
   - Treat it as a compile or lint regression.
   - Fix locally, re-run the same build command, then push.
6. If the smoke step failed:
   - Download `.run-logs/e2e-smoke-*.log` from the workflow artifact.
   - Read the `FAIL` lines first and fix the first true regression before re-running.
7. If `Public signup smoke check` failed:
   - Verify the intended rollout state for staging.
   - Check `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED` in GitHub Actions environment secrets.
   - If signup should be disabled, confirm `/api/v1/signup/*` returns `404` and `/signup` is hidden.
   - If signup should be enabled, confirm Railway runtime flags are aligned:
     - API: `FEATURE_PUBLIC_SIGNUP_ENABLED=true`
     - Web: `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED=true`
     - Web: `FEATURE_PUBLIC_SIGNUP_ENABLED=true`
   - If signup should be enabled, confirm `STAGING_WEB_URL` points at the deployed web app and the public signup routes are reachable.
   - Re-run `node scripts/staging-public-signup-check.cjs` locally with the staging URLs if needed.
8. After a successful redeploy, verify:
   - `/api/v1/health`
   - `scripts/staging-postdeploy-check.cjs`
   - `scripts/staging-public-signup-check.cjs`
   - gate artifact upload in `docs/execution/gates/`
   - admin web rendering is correct:
     - `/channels` shows `Open governance` for the smoke admin
     - `/admin/connectors` shows `Create Governance Policy`

## 8. Customer communication template

When a P0 incident is confirmed, send within 15 minutes to all active pilot tenants:

> **Subject: Vexa PIM — Service Disruption**
>
> We are aware of an issue affecting Vexa PIM and are actively investigating. [Brief description, e.g., "Product catalog and submission operations are temporarily unavailable."]
>
> Current status: Under investigation. We will provide an update within [1 hour / 2 hours].
>
> Affected features: [List affected features].
>
> Your data is safe. No action is required from you at this time.

Send a follow-up when service is restored:

> **Subject: Vexa PIM — Service Restored**
>
> The issue affecting Vexa PIM has been resolved as of [HH:MM UTC]. [Brief description of what was fixed.]
>
> Duration: [X hours Y minutes]. A full post-incident report will follow within 48 hours if the incident was P0.

---

## 9. Post-incident report template

```markdown
## Incident: <title>
Date: YYYY-MM-DD HH:MM UTC
Severity: P0 / P1 / P2
Duration: Xh Ym (from first alert to resolution)
Impact: <what was unavailable or degraded, and for how many users or tenants>
Root cause: <one sentence>

### Timeline
- HH:MM - <what happened>
- HH:MM - <what was done>
- HH:MM - <resolved>

### Root cause detail
<Technical explanation>

### Fix
<What was changed to resolve>

### Follow-up actions
- [ ] <action> - owner - due date
```
