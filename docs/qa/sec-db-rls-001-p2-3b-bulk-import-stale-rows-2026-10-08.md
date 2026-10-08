# SEC-DB-RLS-001 P2.3b: bulk-import stale-row sweeper under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `f76ddf43` (#1246)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

Second of four stale-recovery sweepers (P2.3a bulk-edit merged as #1246; P2.3c connector webhook lease sweeper and P2.3d export-job reconciliation follow, one PR each).

## 1. Defect

`BulkImportStaleRowRecoveryService.recoverStaleRows()` (every 15 minutes, 3 minute boot delay) read rows stuck at `processing` and **wrote** their reset to `retrying` with one cross-tenant `findMany`/`updateMany` through `PrismaDirectService`, the context-free client, then re-drove each affected job. Under forced row level security a context-free session sees **no** tenant's rows, so a restricted role would find nothing to recover: rows left at `processing` by a crashed worker would stay stuck forever (the 2026-07 production incident this sweeper exists for) while the sweep reported nothing to do. Re-driving each job under its own tenant context (`runWithTenantContext` + `processJob`) was already correct.

## 2. Change (`apps/api/src/bulk-import/bulk-import-stale-row-recovery.service.ts`)

- Discovery and reset run per tenant through the existing `forEachTenant` (transaction-local tenant context, bounded concurrency). No new tenant-iteration abstraction.
- Every statement also filters `WHERE "tenantKey" = <the tenant it is given>`, so it is correct whether or not the role bypasses RLS; a row belonging to another tenant is counted as a failure and never acted on.
- **Two passes preserve the original overall bound** (500 rows per run, oldest first). Pass 1 reads each tenant's oldest stale rows (capped at 500 per tenant); the results are merged and cut to 500; pass 2 resets exactly the chosen rows per tenant in a single `UPDATE … RETURNING`. The reset only touches a row that is **still** `processing`, so a row that finished between the passes is left alone (the previous code reset by id alone). Only rows actually reset are counted and only their jobs are re-driven (once per job, under the job's tenant).
- Unreadable tenants (either pass) are logged as an **error** by stable code (never the message) and returned as `tenantsFailed`; a directory read failure **rejects**. The result is `{ recoveredRows, reprocessedJobs, tenantsEvaluated, tenantsFailed, orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE" }`; the two original fields keep their meaning.
- The service no longer uses `PrismaDirectService` (it injects `PrismaService`).
- `BULK_IMPORT_STALE_ROW_RECOVERY_INITIAL_DELAY_MS` (>= 100) shortens the first sweep for tests; unset or invalid keeps 3 minutes.
- **Orphan limit (stated):** a runtime role cannot enumerate tenants that have rows but no directory row; such a tenant is not iterated. No legacy scan is kept, to avoid resetting a row twice.
- **Unchanged behaviour worth knowing:** `processJob` only claims jobs in `queued`/`retrying`, so a job still marked `processing` is not re-driven by this sweeper; that was true before and is not changed here.

## 3. Evidence

| Check | Result |
|---|---|
| Unit spec `bulk-import-stale-row-recovery.service.spec.ts` (13 tests; fake DB shows only the context tenant's rows, plus a leaking mode that models an RLS-bypassing role; includes the 500-row bound across tenants and the once-per-job re-drive) | pass; the earlier behaviours (threshold, per-tenant re-drive context, error isolation, overlap guard) are retained |
| Mutation: iterate the default tenant only | 11 of 13 unit tests fail |
| Real-process integration test `bulk-import-stale-row-recovery-tenant-iteration.test.cjs`: isolated migrated DB, API running as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner); stale `processing` rows in two non-default directory tenants (2 and 1) and the default tenant, a fresh row that must be left alone, a directory tenant with none | pass: all four stale rows become `retrying`, each still on its own tenant and job; the fresh row stays `processing`; sessions all `vexa_runtime_ci` |
| Mutation: iterate the default tenant only, in the built API | integration test **fails** (`every stale row of every directory tenant and of the default tenant must be reset`); source restored (0 markers), dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 33 → 34 tests, 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; direct-client files 31 → 30, raw SQL sites 87 → 89 |

Local-run note: the real-process tests need the CI environment variables of the `restricted-role-lane` job; without them the API does not boot.

## 4. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not touch bulk-import processing; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 5. Rollback

Revert the PR. The previous direct-client read/write returns, which is correct only for the current superuser runtime.
