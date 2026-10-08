# SEC-DB-RLS-001 P2.3c: connector webhook lease sweeper under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `4cbbdf5d` (#1248)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

Third of four stale-recovery sweepers (P2.3a bulk-edit #1246 and P2.3b bulk-import #1247 merged; P2.3d export-job reconciliation follows).

## 1. Defect

`ConnectorWebhookLeaseSweeperService.runSweep()` (every 5 minutes, 2 minute boot delay) listed connector webhook events whose processing lease had expired (`processing_status IN ('received','processing')` and `processing_lease_until < now`) with one `findMany` through `PrismaDirectService`, the context-free client. Under forced row level security a context-free session sees **no** tenant's rows, so a restricted role would find nothing to recover: webhook events stranded by a crashed worker, whose connector never re-sends them, would stay in `received`/`processing` forever (the exact gap this sweeper exists to close) while the sweep logged "no stranded events". The re-drive (`redriveStrandedWebhookEvent`) already runs under the event's own tenant (`prisma.tenant(input.tenantKey)`); only discovery was wrong.

## 2. Change (`apps/api/src/connector-framework/connector-webhook-lease-sweeper.service.ts`)

- Discovery runs per tenant through the existing `forEachTenant` (transaction-local tenant context, bounded concurrency). No new tenant-iteration abstraction.
- The SQL also filters `WHERE tenant_key = <the tenant it is given>`, so it is correct whether or not the role bypasses RLS; a row belonging to another tenant is counted as a failure and never acted on. Column order still matches `idx_connector_webhooks_recovery`.
- Per-tenant results are merged **oldest first** (by `received_at`) and cut to the batch bound (default 100, or the caller's `batchSize`); each tenant's query is capped at the same bound.
- `options.tenantKey` keeps its meaning (scope a sweep to one tenant, for deterministic tests) and does not read the directory.
- The re-drive loop and its outcome buckets (`processed`, `failed`, `retried`, `skipped`) are unchanged.
- Unreadable tenants are logged as an **error** by stable code (never the message) and returned as `tenantsFailed`; a directory read failure **rejects** (the scheduler's existing catch logs it). The summary gains `tenantsEvaluated`, `tenantsFailed` and `orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE"`; existing fields keep their meaning.
- The service no longer uses `PrismaDirectService` (it injects `PrismaService`).
- `CONNECTOR_WEBHOOK_LEASE_SWEEP_INITIAL_DELAY_MS` (>= 100) shortens the first sweep for tests; unset or invalid keeps 2 minutes.
- **Orphan limit (stated):** a runtime role cannot enumerate tenants that have events but no directory row; such a tenant is not iterated. No legacy scan is kept, to avoid re-driving an event twice.

## 3. Evidence

| Check | Result |
|---|---|
| Unit spec `connector-webhook-lease-sweeper.service.spec.ts` (14 tests; fake DB shows only the context tenant's rows, plus a leaking mode that models an RLS-bypassing role) | pass; the earlier behaviours (outcome buckets, single-flight, error isolation, `tenantKey` scope, batch/attempt overrides) are retained |
| Mutation: sweep the default tenant only | 10 of 14 unit tests fail |
| Real-process integration test `connector-webhook-lease-sweeper-tenant-iteration.test.cjs`: isolated migrated DB, API running as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner); stranded events in two non-default directory tenants (2 and 1) and the default tenant, a still-leased event and a processed event that must be left alone, a directory tenant with none | pass: all four stranded events are re-driven (attempt count 1, `lease recovery:` outcome, released to `received` because no installation exists and the attempt cap is not reached), each still under its own tenant; the leased and processed events are untouched; sessions all `vexa_runtime_ci` |
| Mutation: sweep the default tenant only, in the built API | integration test **fails** (`wh_a1_… must have been re-driven (attempts=0)`); source restored (0 markers), dist rebuilt |
| Existing in-process test `connector-webhook-lease-recovery.test.cjs` (case C drives the real sweeper end to end to `processed`) | passes with the sweeper now built on `PrismaService` and `runSweep({ tenantKey })` |
| Lane registration | `scripts/restricted-role-lane.v1.json` 34 → 35 tests, 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; direct-client files 30 → 29, raw SQL sites 89 → 90 |

The integration fixture deliberately has no connector installation, so the re-drive takes its documented failure path (acquire the row, bump the attempt count, release it for the next sweep). That is a real per-tenant database effect and proves the sweeper reached and acted on each tenant's events under the restricted role without building a connector fixture; the "processed" path is covered by the existing in-process test.

Local-run note: the real-process tests need the CI environment variables of the `restricted-role-lane` job; without them the API does not boot.

## 4. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not touch webhook ingestion or connectors; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 5. Rollback

Revert the PR. The previous direct-client read returns, which is correct only for the current superuser runtime.
