# SEC-DB-RLS-001 P2.3d: export-job reconciliation under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `00ec1836` (#1249)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

Last of the four stale-recovery sweepers (P2.3a bulk-edit #1246, P2.3b bulk-import #1247, P2.3c webhook lease sweeper #1249 merged).

## 1. Defect

`ExportJobReconciliationService.runReconciliation()` (every 6 hours, 2 minute boot delay) listed marketplace export jobs stuck `queued`/`processing`/`retrying` for over 30 minutes with one `findMany` through `PrismaDirectService`, the context-free client. Under forced row level security a context-free session sees **no** tenant's rows, so a restricted role would find nothing to reconcile: export jobs whose queue job vanished or finished (worker crash, Redis flush) would stay "active" forever, blocking the user from seeing a failure or retrying, while the run logged zero examined. The per-row step (queue snapshot check, then a tenant-scoped `updateMany` under `runWithTenantContext`) was already correct; only discovery was wrong.

## 2. Change (`apps/api/src/marketplace/export-job-reconciliation.service.ts`)

- Discovery runs per tenant through the existing `forEachTenant` (transaction-local tenant context, bounded concurrency). No new tenant-iteration abstraction.
- The SQL also filters `WHERE "tenantKey" = <the tenant it is given>`, so it is correct whether or not the role bypasses RLS; a row belonging to another tenant is counted as a failure and never acted on.
- Per-tenant results are merged **oldest first** (by `updatedAt`) and cut to the original 200-job bound (each tenant's query is capped at the same bound), so one run still examines at most 200 jobs.
- The per-row step is unchanged: queue check via `getJobSnapshot`, skip while the queue job is live, otherwise fail the job with a `Reconciled: …` reason only if it is still active.
- Unreadable tenants are logged as an **error** by stable code (never the message) and returned as `tenantsFailed`; a directory read failure **rejects** (the scheduler's existing fail-open catch logs it). The result gains `tenantsEvaluated`, `tenantsFailed` and `orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE"`; `examined`, `reconciled` and `errors` keep their meaning.
- The service no longer uses `PrismaDirectService` (its constructor drops that parameter).
- `EXPORT_JOB_RECONCILE_INITIAL_DELAY_MS` (>= 100) shortens the first run for tests; unset or invalid keeps 2 minutes.
- **Orphan limit (stated):** a runtime role cannot enumerate tenants that have jobs but no directory row; such a tenant is not iterated. No legacy scan is kept, to avoid reconciling a job twice.

## 3. Evidence

| Check | Result |
|---|---|
| Unit spec `export-job-reconciliation.service.spec.ts` (17 tests; fake DB shows only the context tenant's rows, plus a leaking mode that models an RLS-bypassing role) | pass; the earlier behaviours (queue-state handling, retryCount job ids, error isolation, idempotence, overlap guard) are retained |
| Mutation: reconcile the default tenant only | 15 of 17 unit tests fail |
| Real-process integration test `export-job-reconciliation-tenant-iteration.test.cjs`: isolated migrated DB, API running as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner); stale active export jobs in two non-default directory tenants (2 and 1) and the default tenant, a fresh job and a completed job that must be left alone, a directory tenant with none | pass: all four stale jobs become `failed` with a `Reconciled:` reason, each still under its own tenant; the fresh and completed jobs are untouched; sessions all `vexa_runtime_ci` |
| Mutation: reconcile the default tenant only, in the built API | integration test **fails** (`ej_a1_… must be reconciled to failed (saw queued)`); source restored (0 markers), dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 35 → 36 tests, 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; direct-client files 29 → 28, raw SQL sites 90 → 91 |

The integration run uses the in-memory queue backend, which holds no queue job for the fixture jobs, so the "no corresponding queue job" branch is the one exercised; the terminal-state and live-job branches are covered by the unit spec.

Local-run note: the real-process tests need the CI environment variables of the `restricted-role-lane` job; without them the API does not boot.

## 4. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not touch export processing or the queue; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 5. Rollback

Revert the PR. The previous direct-client read returns, which is correct only for the current superuser runtime.
