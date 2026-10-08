# SEC-DB-RLS-001 P2.6b: internal-ops alert watchdogs under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `ae00ad6f` (#1265)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role, policy or configuration is changed. **No generic bypass and no cross-tenant policy is added.**

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

Second half of P2.6 (P2.6a, the operator summary, merged as #1265).

## 1. What was and was not a problem

`InternalOpsAlertsService` has 13 raw SQL statements. **All 13 target `ops_alert_states`**, a global platform table keyed by `alert_key`: it has no tenant key, is not row-level-secured, and the identity model gives the runtime full CRUD on it. They need no tenant context and are not changed. (The inventory's earlier "maintenance-read policy" idea for this file is therefore not needed, and none is added.)

The defect is in the **two reads of tenant data** that feed the two watchdogs:

- `countStuckJobs`: `marketplaceExportJob.count` and `bulkImportJob.count` of active jobs not updated for 6 hours, through the context-free direct client.
- `countRecentAuthEmailJobFailures`: `kpiMetricEvent.count` of `auth.email.job_failed` events in the last 15 minutes, through the same client.

Under forced row level security that client sees no tenant's rows, so both counts would always be **zero**. The stuck-job watchdog and the auth-email-failure watchdog could never alert, and every evaluation would also take the "not breached" path and **reset** the alert's breach state, so a real problem would look like a healthy platform.

## 2. Change (`apps/api/src/internal-ops/internal-ops-alerts.service.ts`)

- Both counts are taken **per tenant** through the existing `forEachTenant` (one short transaction per tenant, tenant context set inside it, 3 second per-tenant timeout as before) in a new private `sumAcrossTenants`, and summed. Every query also filters by `tenantKey`, so each count is correct whether or not the role bypasses RLS.
- **The auth-email threshold applies to the sum**, as it did to the single platform-wide count: failures spread over several tenants, none above the threshold alone, still alert.
- **Fail open, loudly, on a partial read:** if any tenant cannot be read, `sumAcrossTenants` throws, and the evaluation takes its existing "failed open" path (a warning naming the tenants and stable error codes, never a database message). It raises **no** alert on a partial count and does **not** reset the alert state, so an unreadable tenant can neither fake an alert nor hide one.
- Alert state handling, thresholds, cooldowns, delivery and the envelope are unchanged. No endpoint, response shape or OpenAPI change.
- Orphan limit (stated): a tenant with data but no directory row is not counted.

## 3. Evidence

| Check | Result |
|---|---|
| `internal-ops-alerts.service.spec.ts` (56 tests; the 51 earlier ones unchanged in substance, 5 new). The shared mock gains an empty directory and a tenant-transaction client, so the earlier cases are the single-tenant case; the one count assertion now also expects `tenantKey: "default"` | pass |
| New multi-tenant tests: every count answers by the tenant in its own filter (the fake throws on a query with none) | pass: stuck jobs of other tenants raise the alert; a healthy zero only when every tenant is zero; per-tenant transactions filtered by tenant; auth-email failures summed over tenants breach the threshold although no tenant does alone; an unreadable tenant fails the evaluation open, queues nothing, does not reset the alert state, and is logged by code without the message |
| Mutation: count the default tenant only | 4 of 56 unit tests fail |
| Real-database test `internal-ops-alerts-restricted-role.test.cjs`: isolated migrated DB, the real service in a child process whose database environment is `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner), delivery stubbed with a recording queue (nothing is sent); stuck jobs over two non-default tenants (plus a fresh job that must not count), recent failed auth-email events over two non-default tenants and the default tenant (plus an hour-old event outside the window) | pass: 4 stuck jobs (3 exports, 1 import) and an alert queued; 5 failures summed (no tenant over the threshold of 3 alone) and an alert queued; neither evaluation fails open; `ops_alert_states` records both alerts with send time and cooldown, written under the restricted role |
| Mutation: count the default tenant only, in the built service | the real-database test **fails** (`3 stuck exports … + 1 stuck import …`); source restored (diff against the backup is empty), dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 41 → 42 tests, 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; entry reclassified (class A, tenant-iteration) with the plan and assertion above; the file stays `open` under the ratchet's definition (the context-free client remains as the carrier of the tenant transactions and for `ops_alert_states`) |

## 4. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant, role or policy; it does not change any alert threshold, cooldown, destination or payload; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 5. Rollback

Revert the PR. The previous platform-wide counts return, which are correct only for the current superuser runtime.
