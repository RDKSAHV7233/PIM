# PIM1 Production Readiness Risk Register

Last updated: 2026-03-13 (release-governance hardening + rollout evidence automation refresh)

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
  - Remaining: staging health response from live staging URL still pending explicit CI run evidence.
  - Remaining: controlled rollout broad window not complete (14-day/SLO evidence).
- Exit criteria:
  1. Two consecutive E10 signoff artifacts recorded.
  2. `/api/v1/health` reports `env=staging` in staging.
  3. Updated rollout snapshot has no controlled gate blockers.
- Validation commands:
  - `node scripts/record-gate-signoff.cjs --suite E10-... --tenantId SMOKE_TENANT_LOCAL --runUrl ...`
  - `node scripts/capture-controlled-rollout-snapshot.cjs --environment staging --tenantId SMOKE_TENANT_LOCAL`
  - Latest snapshot: `docs/execution/rollout/2026-03-07T04-07-09.334Z_CONTROLLED_ROLLOUT_SNAPSHOT.json`
  - Latest signoff: `docs/execution/gates/2026-03-05T17-25-16.998Z_INC08-STAGING-SIGNOFF-LOCAL.json`
- Implementation update (2026-03-13):
  - `.github/workflows/deploy-staging.yml` now captures a controlled rollout snapshot against the live staging URL after the post-deploy verification step.
  - The same workflow now uploads gate and rollout snapshot artifacts via `actions/upload-artifact@v4`.
  - Added `scripts/validate-deploy-staging-workflow.cjs` to statically verify the deploy workflow still contains the required smoke, post-deploy, gate-signoff, rollout-snapshot, and artifact-upload steps.
  - Added `scripts/validate-live-staging-evidence.cjs` plus `docs/execution/STAGING_LIVE_EVIDENCE_RUNBOOK.md` so the next live staging run can be validated mechanically instead of with a manual artifact read-through.
  - `deploy-staging.yml` now also supports `workflow_dispatch`, so the evidence run can be triggered directly from GitHub CLI without a synthetic push to `main`.
  - Remaining: execute the workflow against live staging and capture the resulting health-proof artifact plus the 14-day/SLO observation window.

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
- Status: In Progress
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
- Implementation update (2026-03-13):
  - Added `scripts/staging-postdeploy-check.cjs`.
  - Added local script coverage for smoke-user logout + revoked-token rejection.
  - Updated `.github/workflows/deploy-staging.yml`:
    - runs post-deploy auth/trust-boundary verification
    - records gate artifact via `record-gate-signoff.cjs`
    - supports `workflow_dispatch` for direct evidence runs
  - Added `scripts/validate-deploy-staging-workflow.cjs` to statically verify the workflow still runs those post-deploy and artifact-capture steps.
  - Added `scripts/validate-live-staging-evidence.cjs` plus a runbook so the live workflow artifact bundle can be checked for gate shape, live `runUrl`, and healthy controlled-rollout proof before risk closure.
  - Updated `package.json` gate script so `APP_ENV=staging` can be passed at runtime (no dotenv override).
  - Gate artifact recorder already emits `environment`, `tenantId`, `date`, `gitTag`, and `runUrl`.
  - Remaining: verify on next GitHub Actions staging deployment run against the live staging URL and capture the resulting artifact/logs.

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
- Status: Planned
- Owner: Platform Team

### RISK-P2-002: Admin user lifecycle completeness
- Severity: P2
- Status: Planned
- Owner: Admin UX + Backend

### RISK-P2-003: Catalog health query scaling optimization
- Severity: P2
- Status: Planned
- Owner: Backend

## Governance
- This file is the product/engineering shared risk source for production declaration.
- Any production readiness claim must include status update for all P0 items.
