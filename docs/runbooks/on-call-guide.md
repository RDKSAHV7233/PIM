---
title: TEJ PIM On-Call and Monitoring Guide
audience: internal-ops
status: active
last_updated: 2026-03-19
owner: DevOps
---

## 1. What to watch

| Signal | Where to find it | Healthy value | Alert threshold |
|---|---|---|---|
| API health | `GET /api/v1/health` | `status: "ok"` | Non-200 response or `status != "ok"` |
| Environment identity | `GET /api/v1/health` | `env` matches the environment being checked (`staging` or `production`) | Unexpected env value in a live service |
| Queue backend | `GET /api/v1/health -> queueRuntime.backend` | `bullmq` in staging and production | Any other backend in a shared environment |
| Queue worker enabled | `GET /api/v1/health -> queueRuntime.workerEnabled` | `true` in staging and production | `false` in staging or production |
| Queue paused lanes | `GET /api/v1/health -> queues.*.pausedLanes` | `0` across queues | Any paused lane sustained beyond one connector pause window |
| Auth error rate | Railway request and application logs | Normal background level of 401, 423, and 429 responses | Sustained spike in 401, 423, or 429 responses |
| Database connectivity | `GET /api/v1/health`, Railway logs, and deploy logs | Health endpoint stays green and Prisma boot logs stay clean | Health goes 500 or logs show Prisma connection or migration errors |
| Redis degradation | API logs from auth and queue services | No Redis connection warnings; normal BullMQ behavior | Repeated Redis connection warnings or auth fallback behavior |
| Staging verification lanes | GitHub Actions `deploy-staging.yml` and `e2e-staging.yml` | Latest deploy succeeds; latest nightly E2E has 0 failures | Failed deploy smoke gate or failed nightly E2E run |

## 2. Signals that indicate degraded mode (not fully down)

- Auth is falling back to in-memory rate limiting or lock tracking because Redis is unavailable.
  - Effect: login still works, but rate limiting and lock tracking become single-instance only.
  - Evidence: `apps/api/src/auth/auth.service.ts`.
- Queue is running outside BullMQ-backed durable mode.
  - Effect: jobs may still process in memory, but they are not durable across restarts.
  - In staging and production this should be blocked by env validation, so if it happens it indicates a misconfigured or non-standard runtime.
  - Evidence: `apps/api/src/queue/queue.service.ts`, `apps/api/src/common/env-validation.ts`.
- Connector registry is using its safe fallback set because connector-definition discovery failed.
  - Effect: surfaced connector availability may not match the database definition state.
  - Evidence: `apps/api/src/connector-framework/connector.registry.ts`.
- Billing or dashboard reads are slow after cache expiry.
  - Effect: system is still functional, but users experience degraded response time on dashboard and plan-usage reads.
  - Evidence: `apps/api/src/billing/plan-usage.service.ts`, `apps/api/src/dashboard/dashboard.service.ts`.

## 3. Nightly health check procedure

The on-call engineer should verify these items each morning:

1. GitHub Actions: confirm the latest `e2e-staging.yml` nightly run completed successfully with 0 failures.
2. GitHub Actions: confirm the latest `deploy-staging.yml` run, if any, completed successfully and uploaded artifacts.
3. Railway: confirm the API and Web services show no unexpected restart spikes overnight.
4. Staging API: check `GET https://api-staging-4faf.up.railway.app/api/v1/health` for `status: "ok"`, `env: "staging"`, `queueRuntime.backend: "bullmq"`, and `queueRuntime.workerEnabled: true`.
5. Gate artifacts: confirm recent evidence files exist in `docs/execution/gates/` after successful deploys.
6. Rollout snapshots: check `docs/execution/rollout/` for any new snapshot showing blockers or a broken observation window.

## 4. Alert setup (to be configured)

Railway alert webhook: [FILL: Railway alert webhook URL]  
PagerDuty service key: [FILL: PagerDuty service key]  
Slack webhook: [FILL: Slack webhook for #TEJ PIM-alerts]

Recommended alerts to configure:
- API service restart count greater than 2 in 10 minutes -> P0
- Memory usage greater than 80 percent sustained for 5 minutes -> P1
- Response time p99 greater than 5 seconds -> P1
- Nightly `e2e-staging.yml` failure -> P1
- Deploy smoke-gate failure in `deploy-staging.yml` -> P1

## 5. Controlled rollout evidence maintenance

TEJ PIM's controlled-rollout gate depends on consecutive green staging evidence.

The on-call owner is responsible for:
- Keeping staging deploy verification healthy so the evidence window does not reset.
- Ensuring a broken staging environment is not left degraded for more than 24 hours.
- Confirming new gate artifacts are uploaded from successful staging deploys.
- Running `node scripts/capture-controlled-rollout-snapshot.cjs --environment staging --tenantId default` after any incident that could affect the evidence window.
- Updating release-governance docs when a meaningful incident or recovery changes the release truth:
  - `docs/execution/PROD_READINESS_RISK_REGISTER.md`
  - `docs/execution/INCREMENT_STATE.json`

## 6. Useful commands and references

## 6. Staging email delivery

The staging API requires a working email-delivery mode to boot. If `AUTH_EMAIL_PROVIDER=resend`, both `AUTH_EMAIL_RESEND_API_KEY` and `AUTH_EMAIL_FROM` must be present or startup will fail. That fail-closed behavior is intentional and should be treated as a config regression, not a bug in the app.

To configure real staging delivery:
1. Create a Resend API key scoped to sending only.
2. Set `AUTH_EMAIL_RESEND_API_KEY=<key>` in Railway for the staging API service.
3. Set `AUTH_EMAIL_FROM=noreply@<your-verified-domain>`.
4. Redeploy and verify `GET /api/v1/health` returns `status: "ok"`.

If you only need non-commercial staging to boot and do not need real delivery, set `AUTH_EMAIL_PROVIDER=console`. In `console` mode the app logs email payloads to stdout so content is visible in Railway logs. `file` mode is still blocked in staging because it writes to ephemeral disk and hides delivery output from operators.

## 7. Useful commands and references

- Public health check:
  - `curl https://api-staging-4faf.up.railway.app/api/v1/health`
- Post-deploy verification:
  - `node scripts/staging-postdeploy-check.cjs`
- Deep staging E2E:
  - `node scripts/e2e-user-journey.cjs`
- Fast deploy gate:
  - `node scripts/e2e-user-journey.cjs --smoke`
- Key rotation runbook:
  - `docs/runbooks/credential-key-rotation.md`
- Auth bootstrap runbook:
  - `docs/runbooks/auth-bootstrap-admin.md`
