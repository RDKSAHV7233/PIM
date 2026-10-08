# SEC-DB-RLS-001 P2.3a: bulk-edit stale-operation sweeper under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `86d64b02` (#1243)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

P2.3 covers four stale-recovery sweepers that share one defect. They are split into separate PRs (one dominant risk each, one real-process test each): **P2.3a bulk-edit (this document)**, P2.3b bulk-import stale rows, P2.3c connector webhook lease sweeper, P2.3d export-job reconciliation.

## 1. Defect

`BulkEditStaleOperationRecoveryService.recoverStaleOperations()` (every 15 minutes, 3 minute boot delay) listed stuck `queued`/`processing` operations with one `findMany` through `PrismaDirectService`, the context-free client, with the comment "this direct client legitimately sees every tenant". Under forced row level security a context-free session sees **no** tenant's rows, so a restricted role would find nothing to recover: every operation stuck by a crashed worker (F-014: an operation stays `processing` forever with frozen counts) would stay stuck while the sweep reported nothing to do. The per-operation recovery (`markStuckOperationFailed` under `runWithTenantContext`) was already correct; only discovery was wrong.

## 2. Change (`apps/api/src/bulk-edit/bulk-edit-stale-operation-recovery.service.ts`)

- Discovery runs per tenant through the existing `forEachTenant` (transaction-local tenant context, bounded concurrency). No new tenant-iteration abstraction.
- The SQL also filters `WHERE "tenantKey" = <the tenant it is given>`, so it is correct whether or not the role bypasses RLS; a row belonging to another tenant is counted as a failure and never acted on.
- Per-tenant results are merged **oldest first** and cut to the existing 500 batch limit (each tenant's query is capped at the same limit), preserving the single read's `take: 500` bound.
- Acting is unchanged: each operation is failed through `bulkEditService.markStuckOperationFailed` inside that operation's own tenant context, which recounts its items and only writes if the operation is still queued/processing.
- A tenant that could not be read is logged as an **error** with its stable error code (never the message) and returned as `tenantsFailed`; a directory read failure **rejects** (the scheduler's existing catch logs it). The result is now `{ recoveredOperations, tenantsEvaluated, tenantsFailed, orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE" }`; `recoveredOperations` keeps its meaning.
- The service no longer uses `PrismaDirectService` (it injects `PrismaService`); the inventory moves the file out of the direct-client list.
- `BULK_EDIT_STALE_RECOVERY_INITIAL_DELAY_MS` (>= 100) shortens the first sweep for tests; unset or invalid keeps 3 minutes.
- **Orphan limit (stated):** a runtime role cannot enumerate tenants that have operations but no directory row; such a tenant is not iterated. No legacy scan is kept, to avoid acting twice on an operation.

## 3. Evidence

| Check | Result |
|---|---|
| Unit spec `bulk-edit-stale-operation-recovery.service.spec.ts` (12 tests; fake DB shows only the context tenant's rows, plus a leaking mode that models an RLS-bypassing role) | pass; the earlier behaviours (threshold, per-tenant context, error isolation, `recovered:false`, overlap guard) are retained |
| Mutation: iterate the default tenant only | 9 of 12 unit tests fail |
| Real-process integration test `bulk-edit-stale-recovery-tenant-iteration.test.cjs`: isolated migrated DB, API running as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner); stale `processing` operations in two non-default directory tenants and the default tenant, a fresh one that must be left alone, a directory tenant with none | pass: all three stale operations become `failed`; counts are exactly each tenant's own (A 2 applied / 1 failed, B 1 / 0, default 0 / 0); the fresh operation stays `processing`; sessions all `vexa_runtime_ci` |
| Mutation: iterate the default tenant only, in the built API | integration test **fails** (`tenant A's stale operation must be recovered`); source restored (0 markers), dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 32 → 33 tests (after merging main, which carries P2.2), 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; direct-client files 32 → 31, raw SQL sites 86 → 87 |

Local-run note: the real-process tests need the CI environment variables of the `restricted-role-lane` job; without them the API does not boot.

## 4. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not touch bulk-edit processing; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 5. Rollback

Revert the PR. The previous direct-client read returns, which is correct only for the current superuser runtime.
