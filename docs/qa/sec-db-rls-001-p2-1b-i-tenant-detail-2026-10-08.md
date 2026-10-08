# SEC-DB-RLS-001 P2.1b-i: commercial tenant-detail view under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `da15c172` (#1252)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

P2.1b (the plan-usage operator views) is split because the views differ in kind: this increment is the single-tenant view (the tenant is known, so the fix is the tenant's own client); the multi-tenant listings and the overview (P2.1b-ii) need per-tenant reads with application-side aggregation and are a separate, larger change.

## 1. Defect

`PlanUsageService.getTenantDetail(tenantKey)` (internal commercial-operations view, system-admin boundary) read `TenantPlanProfile`, `PlanUsage` and `connector_installations` (two raw queries) through `PrismaDirectService`, the context-free client, although the tenant is known. Under forced row level security a context-free session sees **none** of those rows, so after the cutover the view would silently show every tenant as the default TRIAL plan with zero usage and no connectors. Nothing would error; an operator would read a wrong commercial picture. The other reads (`WorkspaceDirectory`, `PublicSignupRequest`, `AuthIdentity`, `connector_definitions`) are not RLS-protected and are unaffected.

## 2. Change (`apps/api/src/billing/plan-usage.service.ts`, `getTenantDetail` only)

- The three RLS-protected reads (plan profile, current-month usage, connector list and connector count) now go through `this.prisma.tenant(tenantKey)`: the requested tenant's own client, with the tenant filter kept in every query.
- The non-RLS reads stay on the context-free client, so the number of database operations and the response shape are unchanged (8 operations, same fields).
- No new abstraction, no new endpoint, no response-shape change (so no OpenAPI change).

## 3. Evidence

| Check | Result |
|---|---|
| Existing `commercial-tenant-detail.spec.ts` (62 tests: scoping, SQL shape, identity classification, no-secrets, operation count) | pass unchanged in substance; its `prisma.tenant()` now returns the same mock so every earlier assertion still checks what is queried |
| New "which client reads which table" tests (5): context-free mock sees nothing in the RLS tables, the tenant client sees the tenant's rows | pass: the view comes from the tenant client; the tenant client is opened for the requested tenant only; no RLS table is read through the context-free client; non-RLS tables still are; an unknown tenant never opens plan reads |
| Mutation: read the RLS tables through the context-free client again | 2 unit tests fail |
| Real-database test `plan-usage-tenant-detail-restricted-role.test.cjs`: isolated migrated DB, the real service built in a child process whose database environment is `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner), asked for two non-default tenants with different plans, usage, connectors and users plus a directory tenant with no data | pass: the child is verified not superuser/BYPASSRLS; A = ENTERPRISE / active_paid / 7000 SKUs / 2 connectors / 2 users, B = GROWTH / past_due / suspended / 300 SKUs / 1 connector / 1 user, none of A's data in B; C shows empty sections |
| Mutation: read the RLS tables through the context-free client again, in the built service | the real-database test **fails** (`tenant A's plan must not collapse to the default TRIAL`), the exact silent failure described above; source restored (diff against the backup is empty), dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 36 → 37 tests, 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; the file stays `open` (see section 4) |

The test also confirms, on a freshly migrated database, that `AuthIdentity` is not row-level-secured: the user counts come back through the context-free client under the restricted role.

Local-run note: the real-database test needs the CI environment variables of the `restricted-role-lane` job.

## 4. What remains (P2.1b-ii) and what stays open

- `listEnrichedTenants`, `buildCommercialTenantRows` (behind `searchCommercialTenants`, `listCommercialTenantsInternal`, the CSV export and `getCommercialTenantOverview`) still read the RLS tables `TenantPlanProfile`, `PlanUsage` and `connector_installations` through the context-free client. They span many tenants, so they need per-tenant reads with application-side aggregation. Design notes for that increment: rank and slice on directory fields first (the ranking does not use plan data) so only the returned page is enriched; the overview aggregates every tenant, so it costs one tenant read per tenant (acceptable at pilot scale, to be revisited with the reporting identity); a tenant that cannot be read must fail loudly, never fall back to a default TRIAL.
- The file remains `open` in the call-site inventory until P2.1b-ii lands and the P2.8 class C decision settles the remaining non-RLS direct-client reads.

## 5. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not change any response shape or endpoint; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 6. Rollback

Revert the PR. The previous context-free reads return, which are correct only for the current superuser runtime.
