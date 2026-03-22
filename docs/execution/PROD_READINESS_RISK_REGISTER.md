# PIM1 Production Readiness Risk Register

Last updated: 2026-03-23 (latest daily evidence + green staging reruns reconciled)

## P0 (Must close before production)

### RISK-P0-001: Rollout gates incomplete
- Severity: P0
- Status: In Progress
- Owner: Engineering Lead + DevOps
- Description: Controlled rollout signoff is incomplete.
- Evidence:
  - Completed: 2 consecutive E10 signoff artifacts recorded (`E10-ST-QA-001-RUN3`, `E10-ST-QA-001-RUN4`).
  - Completed: local staging-format signoff artifact recorded (`INC08-STAGING-SIGNOFF-LOCAL`).
  - Completed: rollout snapshot logic preserves E10 continuity across interleaved non-E10 signoff suites and now blocks controlled rollout when staging health is unavailable or mismatched.
  - Completed: live staging workflow run `23127921361` captured a healthy staging snapshot with `/api/v1/health` returning `env=staging`, queue runtime `backend=bullmq`, and `workerEnabled=true`.
  - Completed: artifact `staging-gate-artifacts-23127921361` uploaded with digest `sha256:c2de34cd35af3cbac223b77885c37c8755424e6cdc3ea64a5ae3599fb615d537`.
  - Remaining: fresh consecutive E10 signoff continuity is not yet restored, and the 14-day/SLO broad-rollout evidence window is still incomplete.
- Exit criteria:
  1. Two consecutive E10 signoff artifacts recorded.
  2. `/api/v1/health` reports `env=staging` in staging.
  3. Updated rollout snapshot has no controlled gate blockers.
- Validation commands:
  - `node scripts/record-gate-signoff.cjs --suite E10-... --tenantId SMOKE_TENANT_LOCAL --runUrl ...`
  - `node scripts/capture-controlled-rollout-snapshot.cjs --environment staging --tenantId SMOKE_TENANT_LOCAL`
  - Live proof: `gh run view 23127921361 --repo RDKSAHV7233/PIM1 --json status,conclusion,url,headSha,jobs`
  - Live artifact: `gh api repos/RDKSAHV7233/PIM1/actions/runs/23127921361/artifacts`
  - Latest daily evidence run: `https://github.com/RDKSAHV7233/PIM1/actions/runs/23396591019`
  - Latest snapshot: `docs/execution/rollout/2026-03-22T05-34-42.984Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`
  - Latest signoff: artifact bundle `staging-gate-artifacts-23127921361` -> `gates/2026-03-16T04-31-32.674Z_STAGING_DEPLOY_POSTCHECK.json`
- Implementation update (2026-03-16):
  - Live GitHub Actions run `23127921361` passed end-to-end on Railway `Staging`.
  - The uploaded rollout snapshot shows `controlledRollout.pending = []`.
  - The staging deploy path is operational and verifiable again.
  - Broad-rollout coverage is now computed from actual evidence days instead of hardcoded placeholders.
  - Daily workflow `.github/workflows/capture-daily-rollout-evidence.yml` now records a staging gate artifact plus rollout snapshot on schedule and persists the JSON evidence back into the repo.
  - Daily evidence run `23129106401` succeeded, uploaded artifact `daily-rollout-evidence-23129106401`, and persisted bot commit `67564b5`.
  - Latest validation against live staging evidence (2026-03-16) shows:
    - controlled rollout observation coverage: `5 / 14` required days
    - production SLO trend evidence coverage: `5 / 14` required days
  - Remaining: complete the 14-day/SLO broad-rollout observation window before declaring rollout governance fully closed.
- Implementation update (2026-03-18):
  - Full staging E2E workflow run `23231708622` succeeded with `107 / 121` pass, `0` fail, `14` skip, wall time `269.5s`.
  - Fast smoke-only E2E workflow run `23232414142` succeeded with `28 / 30` pass, `0` fail, `2` skip, wall time `69.7s`.
  - Staging deploy run `23232412168` succeeded with the new `E2E smoke - post-deploy verification` step included in the deploy gate.
  - Latest deploy run `23233701810` also completed successfully after the OpenAPI refresh follow-up.
  - Generic `CI` workflow run `23233701847` is green again, so the engineering-quality lane is back to a usable baseline instead of failing on workflow/config drift.
  - `capture-controlled-rollout-snapshot.cjs` now keeps the pilot workflow and payload-governance controlled-rollout proofs evergreen once recorded instead of aging them out with the 14-day broad-window calculation.
- Fresh snapshot `docs/execution/rollout/2026-03-18T13-22-10.340Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` shows `controlledRollout.pending = []`, `observationWindowDaysCovered = 5`, and `sloTrendDaysCovered = 6`.
  - Remaining: complete the 14-day/SLO broad-rollout observation window before declaring rollout governance fully closed.
- Implementation update (2026-03-19):
  - Daily rollout evidence workflow run `23281517455` succeeded and persisted the latest snapshot into the repo.
- Snapshot `docs/execution/rollout/2026-03-19T05-39-08.859Z_CONTROLLED_ROLLOUT_SNAPSHOT.json` shows:
    - `health.ok = true`
    - `controlledRollout.pending = []`
    - `observationWindowDaysCovered = 6 / 14`
    - `sloTrendDaysCovered = 7 / 14`
  - Remaining: complete the 14-day/SLO broad-rollout observation window before declaring rollout governance fully closed.
- Implementation update (2026-03-20):
- Daily rollout evidence workflow run `23330462307` succeeded and persisted snapshot `docs/execution/rollout/2026-03-20T05-31-22.940Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`.
  - Latest snapshot shows:
    - `health.ok = true`
    - `consecutiveE10SignoffRuns = 1`
    - `controlledRollout.pending = ["Need at least 2 consecutive E10 gate signoff artifacts."]`
    - `observationWindowDaysCovered = 6 / 14`
    - `sloTrendDaysCovered = 7 / 14`
  - Scheduled staging E2E run `23328562994` failed the same day with `2` failing checks (`create_export_job`, `account_export_request`) and must be triaged before rollout governance is described as time-gated only again.
  - Remaining: restore controlled-gate continuity and continue the 14-day/SLO broad-rollout observation window before declaring rollout governance fully closed.
- Implementation update (2026-03-21):
  - Daily rollout evidence workflow run `23372718755` succeeded and persisted snapshot `docs/execution/rollout/2026-03-21T05-14-17.711Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`.
  - Latest snapshot showed:
    - `health.ok = true`
    - `consecutiveE10SignoffRuns = 0`
    - `controlledRollout.pending = ["Need at least 2 consecutive E10 gate signoff artifacts."]`
    - `observationWindowDaysCovered = 6 / 14`
    - `sloTrendDaysCovered = 6 / 14`
  - Remaining: restore controlled-gate continuity and continue the 14-day/SLO broad-rollout observation window before declaring rollout governance fully closed.
- Implementation update (2026-03-22):
  - Daily rollout evidence workflow run `23396591019` succeeded and persisted snapshot `docs/execution/rollout/2026-03-22T05-34-42.984Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`.
  - Latest snapshot shows:
    - `health.ok = true`
    - `consecutiveE10SignoffRuns = 0`
    - `controlledRollout.pending = ["Need at least 2 consecutive E10 gate signoff artifacts."]`
    - `observationWindowDaysCovered = 7 / 14`
    - `sloTrendDaysCovered = 7 / 14`
  - Staging deploy run `23410221080` passed on commit `79c54a4`, including migrations, smoke, post-deploy trust-boundary checks, and post-deploy E2E smoke.
  - Full staging E2E rerun `23410453415` passed on the same commit with `108 / 121` pass, `0` fail, `13` skip.
  - The previously failing March 20 checks (`create_export_job`, `account_export_request`) are now closed. `create_export_job` now skips honestly when staging connector/category readiness prevents export-job creation.
  - Remaining: restore controlled-gate continuity and continue the 14-day/SLO broad-rollout observation window before declaring rollout governance fully closed.
- Prior implementation update (2026-03-13):
  - `.github/workflows/deploy-staging.yml` now captures a controlled rollout snapshot against the live staging URL after the post-deploy verification step.
  - The same workflow now uploads gate and rollout snapshot artifacts via `actions/upload-artifact@v4`.
  - Added `scripts/validate-deploy-staging-workflow.cjs` to statically verify the deploy workflow still contains the required smoke, post-deploy, gate-signoff, rollout-snapshot, and artifact-upload steps.
  - Added `scripts/validate-live-staging-evidence.cjs` plus `docs/execution/STAGING_LIVE_EVIDENCE_RUNBOOK.md` so the next live staging run can be validated mechanically instead of with a manual artifact read-through.
  - `deploy-staging.yml` now also supports `workflow_dispatch`, so the evidence run can be triggered directly from GitHub CLI without a synthetic push to `main`.
  - Remaining after this update: only the 14-day/SLO observation window.

### RISK-P0-002: Non-local auth hardening drift risk
- Severity: P0
- Status: Closed
- Owner: Backend Lead
- Description: Local-auth fallback paths remain dangerous if env config drifts outside strict staging/prod settings.
- Exit criteria:
  1. Non-local environments enforce `AUTH_MODE=db`.
  2. Startup fails if non-local env attempts local/demo auth mode.
  3. Integration test proves legacy/local fallback is rejected in staging config.
- Validation commands:
  - `npm run test:integration:auth-revocation`
  - `npm run test:integration:env-validation`
- Validation evidence refreshed (2026-03-13):
  - `test:integration:auth-revocation` -> pass after workspace-scoped login fixture alignment (`workspaceSlug` + workspace directory mapping).
  - `test:integration:env-validation` -> pass.
  - Env validation enforces `AUTH_MODE=db` when `APP_ENV` is `staging`/`production`.
  - Closure evidence is current again after the INC-11 workspace-login contract change.

### RISK-P0-003: Post-deploy verification too shallow
- Severity: P0
- Status: Closed
- Owner: DevOps
- Description: Staging deployment currently verifies health only; it should verify critical trust/isolation/reliability suites.
- Exit criteria:
  1. Deploy workflow runs critical integration suite post-deploy.
  2. Pipeline fails on integration regression.
  3. Gate artifact includes environment, tenantId, date, gitTag, runUrl.
- Validation commands:
  - `npm run test:staging:postdeploy-check`
  - `STAGING_BASE_URL=... STAGING_SMOKE_WORKSPACE=... STAGING_SMOKE_USER=... STAGING_SMOKE_PASSWORD=... STAGING_EXPECTED_ENV=staging node scripts/staging-postdeploy-check.cjs`
  - CI job execution proof in `.github/workflows/deploy-staging.yml` logs.
- Validation evidence (2026-03-16):
  - GitHub Actions run `23127921361` passed all required staging steps:
    - `Deploy to staging`
    - `Staging smoke test`
    - `Staging post-deploy verification (auth + trust boundary)`
    - `Record staging gate artifact`
    - `Capture controlled rollout snapshot`
    - `Upload staging gate artifacts`
  - Gate artifact `2026-03-16T04-31-32.674Z_STAGING_DEPLOY_POSTCHECK.json` recorded:
    - `environment=staging`
    - `tenantId=staging-smoke`
    - `date=2026-03-16T04:31:32.674Z`
    - `gitTag=sha-ab4ffd9`
    - `runUrl=https://github.com/RDKSAHV7233/PIM1/actions/runs/23127921361`
  - Uploaded artifact `staging-gate-artifacts-23127921361` is present, digest-backed, and unexpired.
- Validation evidence refreshed (2026-03-18):
  - GitHub Actions run `23232412168` passed with:
    - `Deploy to staging`
    - `Staging smoke test`
    - `Staging post-deploy verification (auth + trust boundary)`
    - `E2E smoke - post-deploy verification`
    - `Record staging gate artifact`
    - `Capture controlled rollout snapshot`
    - `Upload gate + rollout + smoke artifacts`
  - Smoke gate summary from the same run:
    - `TOTAL 30 checks [smoke] | 28 pass | 0 fail | 2 skip`
    - `Wall time: 62.0s`

## P1 (Before scale / broad pilot)

### RISK-P1-001: ONDC domain drift
- Severity: P1
- Status: Closed
- Owner: Platform Architect
- Description: ONDC remains exposed as core-path behavior and can confuse product scope.
- Exit criteria:
  1. ONDC isolated behind connector abstraction and/or feature flag.
  2. `/ondc` removed from normal user-facing nav.
  3. Internal-only visibility policy documented.
- Validation evidence (2026-03-05):
  - `FEATURE_ONDC_ENABLED` and `NEXT_PUBLIC_FEATURE_ONDC_ENABLED` added with default `false` in env templates.
  - ONDC link removed from seller nav and shown only in internal/labs surfaces when feature flag is enabled.
  - `/ondc` route is hard-gated to admin + non-production + enabled flag.
  - Connector reliability suites pass after gating changes.

### RISK-P1-002: Dashboard cache multi-instance risk
- Severity: P1
- Status: Closed
- Owner: Backend Lead
- Description: Process-local cache can cause cold-start stampede under multi-instance deployment.
- Exit criteria:
  1. Replace with shared cache (Redis) or authoritative snapshot read strategy.
  2. Load test confirms stable latency after rolling restart.
- Validation evidence (2026-03-05):
  - Dashboard cache moved to Redis with bounded TTL keys.
  - Deterministic in-memory fallback retained for Redis-unavailable scenarios.
  - `test:integration:dashboard-aggregations` passes with cache hit behavior validation (`asOf` stable within TTL).

### RISK-P1-003: Onboarding experience incomplete
- Severity: P1
- Status: Closed
- Owner: Product + Web Lead
- Description: First-seller onboarding loop not fully guided in UI.
- Exit criteria:
  1. Onboarding checklist implemented.
  2. Action-oriented empty states on key pages.
  3. Import-complete success guidance links to fix/publish flow.
- Validation evidence (2026-03-05):
  - Dashboard includes `First Seller Onboarding` checklist with progress and linked actions (import, completeness, quality, channels, jobs).
  - Operations Imports page empty state upgraded to action-oriented remediation paths.
  - Existing Products and Issue Inbox empty states already provide direct next-step actions.

### RISK-P1-004: Workflow states maturity gap
- Severity: P1
- Status: Closed
- Owner: Product + Backend + Web
- Description: Full Draft/Review/Approved flow and approvals UX not complete.
- Exit criteria:
  1. Workflow states available and visible across list/detail.
  2. Approval queue actions and audit trail complete.
- Validation evidence (2026-03-05):
  - Added explicit workflow statuses: `in_review`, `approved`, `rejected` (plus legacy compatibility for `active`).
  - Enforced product status transition rules in API update flow and bulk edit flow.
  - Enforced workflow entry rules on create/import: non-draft entry now rejected with `WORKFLOW_ENTRY_INVALID`.
  - Approval Queue page now renders live `in_review` work items with approve/reject/send-to-draft actions.
  - Product status transitions now emit audit rows (`STATUS_TRANSITION`) with from/to metadata.
  - Integration test `test:integration:product-workflow-transitions` verifies invalid transition rejection, workflow-entry rejection, valid path, and audit logging.

## P2 (Next increment window)

### RISK-P2-001: Public API and outbound webhooks program
- Severity: P2
- Status: Closed
- Owner: Platform Team
- Validation evidence (2026-03-18):
  - Outbound webhook foundation shipped for tenant-managed notification events:
    - `import_completed`
    - `import_failed`
    - `publish_succeeded`
    - `publish_failed`
    - `approval_decision`
  - New admin API under `/api/v1/admin/webhooks` supports:
    - list endpoints
    - create endpoint
    - pause/resume endpoint
    - send test delivery
    - delete endpoint
    - list delivery history
  - Deliveries are queued through the existing worker infrastructure and signed with `X-PIM1-Webhook-Signature` (HMAC SHA-256 over `timestamp.body`).
  - Admin UI now exposes `/admin/webhooks` for endpoint creation, test delivery, and delivery visibility.
  - Tenant-scoped API key program shipped for machine access to the protected API:
    - admin API under `/api/v1/admin/api-keys`
    - list keys
    - create keys
    - revoke keys
    - admin role intentionally disallowed for API keys
  - API key auth is now recognized by the shared request path via `x-pim-api-key` or `Authorization: ApiKey ...`, with tenant resolution before request handling and RBAC enforcement on protected routes.
  - Admin UI now exposes `/admin/api-keys` for issuing and revoking machine credentials.
  - Integration proof:
    - `node apps/api/test/integration/outbound-webhooks.test.cjs`
    - `node apps/api/test/integration/api-keys.test.cjs`
  - Outbound webhook integration now proves signed delivery across multiple real event families:
    - `import_completed`
    - `approval_decision`
    - `import_failed`
    - `publish_succeeded`
    - `publish_failed`
    - plus admin-triggered test deliveries through `/api/v1/admin/webhooks/:id/test`
  - No remaining scope is required for the current public API + outbound webhooks program baseline.

### RISK-P2-002: Admin user lifecycle completeness
- Severity: P2
- Status: Closed
- Owner: Admin UX + Backend
- Validation evidence (2026-03-18):
  - Workspace-admin user lifecycle shipped in commit `df40d7f` (`feat(users): workspace-admin user management with persistent lock`).
  - Staging deploy run `23227759485` passed with migrations, smoke, and post-deploy verification green.
  - Live staging probe confirmed:
    - `GET /admin/workspace/users` -> `200`
    - response includes `lockedUntil`
    - admin auth guard path is working
  - Scope now includes:
    - live workspace user table on `/admin/users`
    - admin-only list/create/role-change/lock/unlock/deactivate API
    - persistent DB-backed account lock honored at login

### RISK-P2-003: Catalog health query scaling optimization
- Severity: P2
- Status: Closed
- Owner: Backend
- Validation evidence (2026-03-18):
  - Implemented stale-while-refresh caching for `GET /api/v1/dashboard/catalog-health` in commit `f16536e` (`perf(dashboard): serve stale catalog health while refreshing`).
  - Follow-up commit `d500469` aligned raw-SQL guard annotations so the same slice is green in the generic `CI` lane.
  - Fresh cache remains bounded at 5 minutes, while a longer-lived stale cache now serves the last known catalog-health payload immediately and refreshes in the background instead of forcing callers onto the heavy aggregate query.
  - Added regression coverage:
    - `node apps/api/test/integration/dashboard-aggregations.test.cjs`
    - `node apps/api/test/integration/dashboard-catalog-health-stale-refresh.test.cjs`
    - `node apps/api/test/integration/dashboard-health-stale-refresh.test.cjs`
  - Validation lanes:
    - CI run `23235915363` -> pass
    - Staging deploy run `23235915380` -> pass

## Governance
- This file is the product/engineering shared risk source for production declaration.
- Any production readiness claim must include status update for all P0 items.
