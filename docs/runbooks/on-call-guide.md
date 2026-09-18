---
title: Vexa PIM On-Call and Monitoring Guide
audience: internal-ops
status: active
last_updated: 2026-09-03
owner: DevOps
---

## 0. Current staging baseline

> **Corrected 2026-09-17:** this "staging" service pair (App Vexa / Vexa API) is the only Railway environment that exists and is what serves real customer traffic at `app.vexapim.com` — there is no separate production Railway environment (the `promote-stage3.yml` pipeline has zero recorded runs, ever, confirmed via `gh run list`). The health-check table below (§1) is written for this single reality. See `docs/operations/CURRENT_PRODUCTION_ARCHITECTURE.md`.

As of 2026-05-17, the staging deployment recovery baseline is GitHub Actions run `25988595126`:

- URL: `https://github.com/RDKSAHV7233/PIM1/actions/runs/25988595126`
- authoritative Railway staging services:
  - web: `App Vexa`
  - api: `Vexa API`
- current staging rollout posture:
  - deploy validation lane is healthy
  - public signup is intentionally disabled
  - `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED=false`

Do not authorize additional deploy-path edits for this incident unless a newer failed run exists and the operator cites the failing run URL in the incident thread or handoff.

## 1. What to watch

| Signal | Where to find it | Healthy value | Alert threshold |
|---|---|---|---|
| API health | `GET /api/v1/health` | `status: "ok"` | Non-200 response or `status != "ok"` |
| Environment identity | `GET /api/v1/health` | `env: "staging"` — this is the only environment value that has ever actually been observed live (confirmed 2026-09-17; there is no second Railway environment) | Any value other than `staging` in the live service |
| Queue backend | `GET /api/v1/health -> queueRuntime.backend` | `bullmq` | Any other backend |
| Queue worker enabled | `GET /api/v1/health -> queueRuntime.workerEnabled` | `true` | `false` |
| Queue paused lanes | `GET /api/v1/health -> queues.*.pausedLanes` | `0` across queues | Any paused lane sustained beyond one connector pause window |
| Auth error rate | Railway request and application logs | Normal background level of 401, 423, and 429 responses | Sustained spike in 401, 423, or 429 responses |
| Database connectivity | `GET /api/v1/health`, Railway logs, and deploy logs | Health endpoint stays green and Prisma boot logs stay clean | Health goes 500 or logs show Prisma connection or migration errors |
| Redis degradation | API logs from auth and queue services | No Redis connection warnings; normal BullMQ behavior | Repeated Redis connection warnings or auth fallback behavior |
| Staging verification lanes | GitHub Actions `deploy-staging.yml` and `e2e-staging.yml` | Latest deploy succeeds; latest nightly E2E has 0 failures; public signup smoke matches the intended rollout state | Failed deploy smoke gate, failed public signup smoke check, or failed nightly E2E run |

## 2. Signals that indicate degraded mode (not fully down)

- Auth is falling back to in-memory rate limiting or lock tracking because Redis is unavailable.
  - Effect: login still works, but rate limiting and lock tracking become single-instance only.
  - Evidence: `apps/api/src/auth/auth.service.ts`.
- Queue is running outside BullMQ-backed durable mode.
  - Effect: jobs may still process in memory, but they are not durable across restarts.
  - This should be blocked by env validation on the live environment, so if it happens it indicates a misconfigured or non-standard runtime.
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
4. Staging API: resolve the current public API origin from Railway first, then check `GET <staging-api-origin>/api/v1/health` for `status: "ok"`, `env: "staging"`, `queueRuntime.backend: "bullmq"`, and `queueRuntime.workerEnabled: true`.
5. If self-serve signup rollout is in play, confirm the `Public signup smoke check` step is green in the latest staging deploy and nightly E2E runs.
6. If the rollout expectation changed, verify `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED` matches the intended staging state.
   - Default state after the 2026-05-17 recovery is `false`.
7. When signup is enabled, confirm Railway runtime flags match on both services:
   - API: `FEATURE_PUBLIC_SIGNUP_ENABLED=true`
   - Web: `NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED=true`
   - Web: `FEATURE_PUBLIC_SIGNUP_ENABLED=true`
8. If a new staging failure appears, capture the run URL before approving any workflow or Railway-targeting edits.
   - Compare against the recovery baseline `25988595126` first.
   - If the failure does not have a fresh run URL, treat the request as incomplete triage.
9. Confirm the API and web services share the same JWT signing secret:
   - API: `JWT_SECRET` or `PIM_JWT_SECRET`
   - Web: `JWT_SECRET` or `PIM_JWT_SECRET`
   - If they drift, login can succeed while server-rendered pages degrade to viewer/read-only mode.
10. Gate artifacts: confirm recent evidence files exist in `docs/execution/gates/` after successful deploys.
11. Rollout snapshots: check `docs/execution/rollout/` for any new snapshot showing blockers or a broken observation window.

## 4. Alert setup (to be configured)

Railway alert webhook: [FILL: Railway alert webhook URL]  
PagerDuty service key: [FILL: PagerDuty service key]  
Slack webhook: [FILL: Slack webhook for #vexa-pim-alerts]

Recommended alerts to configure:
- API service restart count greater than 2 in 10 minutes -> P0
- Memory usage greater than 80 percent sustained for 5 minutes -> P1
- Response time p99 greater than 5 seconds -> P1
- Nightly `e2e-staging.yml` failure -> P1
- Deploy smoke-gate failure in `deploy-staging.yml` -> P1
- Public signup smoke-check failure while rollout is enabled -> P1

## 5. Controlled rollout evidence maintenance

Vexa PIM's controlled-rollout gate depends on consecutive green staging evidence.

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

- Resolve the current public Railway URLs:
  - Web: `node scripts/resolve-railway-service-url.cjs`
  - API: `RAILWAY_SERVICE="${RAILWAY_API_SERVICE:-Vexa API}" node scripts/resolve-railway-service-url.cjs`
- Public health check:
  - `curl "$(RAILWAY_SERVICE="${RAILWAY_API_SERVICE:-Vexa API}" node scripts/resolve-railway-service-url.cjs)/api/v1/health"`
- Post-deploy verification:
  - `node scripts/staging-postdeploy-check.cjs`
  - Verifies both API auth/trust boundaries and admin-only SSR rendering on the deployed web app
- Public signup smoke:
  - `node scripts/staging-public-signup-check.cjs`
- Deep staging E2E:
  - `node scripts/e2e-user-journey.cjs`
- Fast deploy gate:
  - `node scripts/e2e-user-journey.cjs --smoke`
- Key rotation runbook:
  - `docs/runbooks/credential-key-rotation.md`
- Auth bootstrap runbook:
  - `docs/runbooks/auth-bootstrap-admin.md`
