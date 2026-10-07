# SEC-DB-RLS-001 P2.1a: plan-usage nightly rollup under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `d620c98a` (#1242)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed.

State vocabulary: IMPLEMENTED (source changed), TESTED (named tests pass locally; CI recorded on the PR), MERGED, DEPLOYED, RUNTIME_VERIFIED. This increment is **IMPLEMENTED and TESTED locally** at the time of writing. Nothing here is DEPLOYED or RUNTIME_VERIFIED.

## 1. Defect

`PlanUsageService.rollupAllTenantsUsage()` discovered tenants with one no-argument `SELECT DISTINCT "tenantKey"` over six tables, through `prisma.tenant()` (default tenant context). Under forced row level security a restricted role sees only the default tenant, so the nightly job would recompute **one** tenant and log success. Every other tenant's `PlanUsage` row (which drives plan-limit checks and the usage display) would silently stop being refreshed after the cutover. The proven per-tenant `recomputeUsage(tenantKey)` was already correct (it uses an explicit `prisma.tenant(tenantKey)` and a tenant filter); only discovery was wrong.

## 2. Change (`apps/api/src/billing/plan-usage.service.ts`)

- Tenants come from `listTenantKeys` (workspace directory, a non-RLS table, plus the default tenant), the same helper used by the other six migrated consumers. No new tenant-iteration abstraction is introduced.
- The legacy cross-table scan is **retained as a best-effort addition**: a superuser deployment (today's production) still refreshes tenants that hold data but have no directory row. Its failure is logged with a stable code and does not stop directory tenants. Under a restricted role it adds nothing and correctness does not depend on it.
- Directory read failure **rejects** the run. It never falls back to rolling up only the default tenant.
- Per-tenant failures are isolated (chunks of 10, `Promise.allSettled`) and returned as `{ tenantKey, errorCode }`; messages are never logged or returned (they can embed connection strings).
- The job returns `UsageRollupResult` (`directoryTenantCount`, `tenantsEvaluated`, `tenantsSucceeded`, `tenantsFailed`, `discoveredOutsideDirectory`, `failures`, `orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE"`) and logs `Nightly usage rollup complete|degraded: directory=… evaluated=… succeeded=… failed=… outsideDirectory=…`.
- `PLAN_USAGE_ROLLUP_INITIAL_DELAY_MS` (>= 100) shortens the first run only, for tests. Unset behaviour is unchanged.
- **Orphan limit (stated, not hidden):** a runtime role cannot enumerate tenants that have data but no directory row. The result says `UNVERIFIED_BY_RUNTIME_ROLE`; this change does not claim "orphans = 0".

## 3. Evidence

| Check | Result |
|---|---|
| Unit spec `plan-usage-rollup-tenant-discovery.spec.ts` (9 tests) | pass |
| Mutation: revert to legacy-only discovery | 3 of 9 unit tests fail |
| Real-process integration test `plan-usage-rollup-tenant-iteration.test.cjs`: isolated migrated DB, API running as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner), three non-default directory tenants (A: 2 sellable SKUs + 1 draft, 1 GiB, 1 export; B: 1 SKU, 0.5 GiB, no export; C: directory row only) plus default | pass: a `PlanUsage` row exists for every tenant incl. C and default; A = 2 SKU / 1 export / 1 GiB; B = 1 SKU / 0 export / 0.5 GiB (no cross-tenant mixing); log `directory=3 evaluated=4 succeeded=4 failed=0`; sessions all `vexa_runtime_ci` |
| Mutation: legacy-only discovery in the built API | integration test **fails** (`the rollup must create a PlanUsage row for the non-default tenant …`); the job logged `complete … evaluated=1` while three tenants existed, which is exactly the silent failure this change removes. Source restored (0 mutation markers) and dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 30 → 31 tests, 0 expected failures; `validate-sec-restricted-lane.cjs` passes |
| `validate-sec-db-call-sites.cjs` | pass, 32 files open, 86 raw SQL sites (unchanged) |

Local-run note: the integration tests start a real API process and need the CI environment variables of the `restricted-role-lane` job (JWT, credential key, Redis, R2 placeholders, `APP_ENV=development`, `AUTH_MODE=local`, `QUEUE_BACKEND=memory`). Without them the API does not boot (the sibling `billing-jobs-tenant-iteration.test.cjs` behaves the same).

## 4. Statement-by-statement audit of the 21 raw SQL sites

| # | Function | Client | Table(s) | Verdict under a restricted role |
|---|---|---|---|---|
| 1 | `seedPlanLimits` | `tenant()` | `PlanLimits` | global config, no RLS: works |
| 2 | `initializeTrialPlanProfile` | `tenant(key)` | `TenantPlanProfile` | explicit tenant: works |
| 3 | `setTenantPlanTierForTenant` | `tenant(key)` | `TenantPlanProfile` | explicit tenant: works |
| 4 | `updateCommercialStateForTenant` | `tenant(key)` | `TenantPlanProfile` | explicit tenant: works |
| 5 | `listEnrichedTenants` | direct | `connector_installations` joined to `connector_definitions` | cross-tenant listing: **open, P2.1b** |
| 6 | `getTenantDetail` (counts) | direct | `connector_installations` (RLS) joined to `connector_definitions` | per-tenant detail through the direct client: **open, P2.1b** |
| 7 | `getTenantDetail` (count) | direct | `connector_installations` (RLS) | **open, P2.1b** |
| 8-9 | `recomputeUsage` (bytes, connector counts) | `tenant(key)` | `MediaAsset`, `ConnectorInstallation` | explicit tenant + filter: works |
| 10 | `recomputeUsage` (upsert) | `tenant(key)` | `PlanUsage` | explicit tenant: works |
| 11 | `rollupAllTenantsUsage` legacy scan | `tenant()` | six tables | best-effort addition only (sees default tenant under a restricted role); **no longer load-bearing** |
| 12-14 | `getPlanLimits` (three reads) | `tenant()` | `PlanLimits` | global config: works |
| 15 | `getConnectorAccountCount` | `tenant(key)` | `ConnectorInstallation` | works |
| 16-19 | `getOrCreateTenantPlanProfile` (four) | `tenant(key)` | `TenantPlanProfile`, `PlanUsage` | works |
| 20 | `getUsageRow` | `tenant(key)` | `PlanUsage` | works |
| 21 | `getUsageSummaryRow` | `tenant(key)` | `PlanUsage` | works |

Sites 5-7 plus the Prisma-model reads in `listCommercialTenantsInternal`, `listRecentSignups`, `getCommercialTenantOverview`, `findCommercialAdminMatchTenantKeys` and `buildCommercialTenantRows` are internal operator (platform-admin) listings that still use the direct client. They are the **P2.1b** increment (tenant iteration with application-side aggregation, no generic bypass). The inventory keeps this file `open` until then.

## 5. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag or tenant; it does not demote any role; it does not touch the operator listings; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 6. Rollback

Revert the PR. The previous legacy-only discovery returns, which is correct only for the current superuser runtime.
