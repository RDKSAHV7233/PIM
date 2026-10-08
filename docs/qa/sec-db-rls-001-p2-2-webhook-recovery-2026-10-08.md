# SEC-DB-RLS-001 P2.2: outbound-webhook stuck-delivery recovery under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `86d64b02` (#1243)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

## 1. Defect

`OutboundWebhooksService.recoverStuckQueuedDeliveries()` (runs every 60 s from `onApplicationBootstrap`) found stuck deliveries with one scan through `prisma.tenant()` (no argument) over `outbound_webhook_deliveries`. Under forced row level security a restricted role sees only the default tenant, so the job would re-enqueue one tenant's stuck deliveries and report success while every other tenant's deliveries stayed `queued` forever. The per-row recovery (`enqueueDelivery(tenantKey, …)`) was already correct (explicit `prisma.tenant(tenantKey)`); only discovery was wrong.

## 2. Change (`apps/api/src/outbound-webhooks/outbound-webhooks.service.ts`)

- The scan runs per tenant through the existing `forEachTenant` (transaction-local tenant context, bounded concurrency). No new tenant-iteration abstraction is introduced.
- The SQL also filters `WHERE tenant_key = <the tenant it is given>`, so it is correct whether or not the role bypasses RLS (today's superuser runtime would otherwise return every tenant's rows in every iteration and enqueue each delivery once per tenant). A row that belongs to another tenant is counted as a failure and never acted on.
- Per-tenant results are merged **oldest first** and cut to the caller's limit, preserving the single scan's `ORDER BY created_at ASC LIMIT n` semantics across tenants. Each tenant's query is itself capped at the same limit.
- A tenant that could not be read is logged as an **error** with its stable error code (never the message, which can embed connection strings) and counted in `tenantsFailed`; the audit entry now also records `tenantsEvaluated` and `tenantsFailed`, and is written when any tenant failed even if nothing was recovered. A directory read failure **rejects** (the existing timer `.catch` logs it); it never falls back to the default tenant only.
- The result type is now `StuckQueuedRecoveryResult` (`recovered`, `failed`, `tenantsEvaluated`, `tenantsFailed`, `orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE"`). Existing fields keep their meaning.
- `OUTBOUND_WEBHOOK_RECOVERY_INTERVAL_MS` (>= 100) shortens the interval for tests; unset or invalid keeps 60 s.
- **Orphan limit (stated, not hidden):** a runtime role cannot enumerate tenants that have deliveries but no directory row; such a tenant is not iterated. `orphanDetection` says `UNVERIFIED_BY_RUNTIME_ROLE`; this change does not claim "orphans = 0". Unlike the plan-usage rollup (P2.1a), no legacy cross-tenant scan is retained: recovery must not act twice on a row, and every tenant created through signup has a directory row.

## 3. Evidence

| Check | Result |
|---|---|
| Unit spec `outbound-webhooks-recovery-tenant-iteration.spec.ts` (10 tests; fake DB returns only the context tenant's rows, plus a leaking mode that models an RLS-bypassing role) | pass |
| Mutation: iterate the default tenant only | 8 of 10 unit tests fail |
| Real-process integration test `outbound-webhook-recovery-tenant-iteration.test.cjs`: isolated migrated DB, API running as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner), stuck deliveries in two non-default directory tenants and the default tenant, a fresh delivery that must be left alone, a directory tenant with none | pass: each stuck delivery gains `queue_job_id = outbound-webhook:<its own tenant>:<id>` and `last_enqueue_attempt_at`; the fresh delivery is untouched; audit totals `recovered 3, tenantsEvaluated 4, tenantsFailed 0`; sessions all `vexa_runtime_ci` |
| Mutation: iterate the default tenant only, in the built API | integration test **fails** (`tenant A's stuck delivery must be recovered under tenant A`); source restored (0 markers) and dist rebuilt |
| Existing in-process test `outbound-webhook-stuck-queued-recovery.test.cjs` | its fixture tenant now also gets a `WorkspaceDirectory` row (the sweep iterates the directory); passes, including the second-sweep no-duplicate check |
| Existing timer spec (DEF-PC-013) | its stub now rejects at the directory read, the scan's first query; the assertion (a DB error is logged, never an unhandled rejection) is unchanged and passes |
| Lane registration | `scripts/restricted-role-lane.v1.json` 31 → 32 tests, 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; inventory entry moved to `migrated`, `noArgTenantRawSites` 1 → 0 |

Local-run note: the real-process tests need the CI environment variables of the `restricted-role-lane` job (JWT, credential key, Redis, R2 placeholders, `APP_ENV=development`, `AUTH_MODE=local`, `QUEUE_BACKEND=memory`); without them the API does not boot.

## 4. Behaviour and cost notes

- Query volume: the job now opens one short transaction per tenant per minute (bounded concurrency 4, indexed by `idx_outbound_webhook_deliveries_stuck_queued` on `tenant_key, status, attempted_at, created_at`). At pilot scale this is negligible; at large tenant counts a cheaper discovery (one directory-wide pre-filter) would be a later optimisation, not a correctness change.
- A delivery whose tenant has no directory row is not recovered by this job (see the orphan limit above).

## 5. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not touch delivery processing or the queue; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 6. Rollback

Revert the PR. The previous single scan returns, which is correct only for the current superuser runtime.
