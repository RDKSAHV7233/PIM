# SEC-DB-RLS-001 P2.1b-ii: multi-tenant commercial views under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `44e2ca5d` (#1253)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

Second half of P2.1b (P2.1b-i, the single-tenant detail view, merged as #1253).

## 1. Defect

The internal commercial-operations views that span many tenants read the RLS-protected `TenantPlanProfile`, `PlanUsage` and `connector_installations` with one batched query through `PrismaDirectService`, the context-free client:

- `listEnrichedTenants` (plan/billing filters, usage, connectors),
- `buildCommercialTenantRows`, behind `searchCommercialTenants`, `listCommercialTenantsInternal`, the CSV export and `getCommercialTenantOverview`.

Under forced row level security that client sees **none** of those rows. After the cutover every tenant would silently show as the default TRIAL plan with no usage or connectors, the plan and billing filters would match nothing, and the overview would count every tenant as a trial. Nothing would error.

## 2. Change (`apps/api/src/billing/plan-usage.service.ts`)

- New private `readTenantCommercialSnapshots(tenantKeys, { usageMonth?, connectors? })`: the RLS-protected data of each tenant is read through the existing `forEachTenant` (one short transaction per tenant on one shared client, tenant context set for that transaction, bounded concurrency). No new tenant-iteration abstraction. Every statement also filters by the tenant it is given, so it is correct whether or not the role bypasses RLS. The profile and the latest usage tier come from one statement per tenant; usage and connectors are added only when requested.
- **Why not `prisma.tenant(key)` per tenant:** each is a separate `PrismaClient` with its own connection pool, and the service keeps at most 50 (FIFO eviction with disconnect). Iterating hundreds or thousands of tenants that way would thrash pools. (Single-tenant reads, as in P2.1b-i, are fine.)
- **Fail loudly:** if any tenant cannot be read, the whole view throws `COMMERCIAL_TENANT_READ_FAILED` and the log names the tenant and a stable error code (never the message, which can embed connection strings). An operator is never shown a defaulted TRIAL plan for a tenant that could not be read. A tenant that is readable but simply has no profile or usage still shows the default TRIAL plan, as before.
- `buildCommercialTenantRows` uses the snapshots; admin emails stay one batched read (AuthIdentity is not RLS-protected).
- `listCommercialTenantsInternal` now ranks and cuts to the requested page **before** enriching: the ranking uses only directory fields (tenant key, slug, display name, admin match, workspace update time), never plan data, so only the returned page (at most 250 tenants) is read per tenant instead of up to 2,500 candidates. Results and ordering are unchanged.
- `listEnrichedTenants`: without a filter it is the newest `limit` workspaces. With a plan or billing filter the plan profile decides and is RLS-protected, so the newest workspaces are scanned 50 at a time (profiles read per tenant) until `limit` matches are found or 2,500 workspaces have been scanned. **Behaviour difference:** previously a filtered call returned an arbitrary `limit` matching profiles ordered newest-first afterwards; it now returns the `limit` newest matching tenants (deterministic), and a filter match beyond the 2,500 newest workspaces is not found. Tenants without a profile never match a filter, as before.
- `getCommercialTenantOverview` aggregates every tenant (cap 10,000), so it costs one tenant transaction per tenant. Acceptable at pilot scale; a reporting identity (the planned `vexa_reporter`) is the scalable path and is a later decision.
- No endpoint, response shape or OpenAPI change.

## 3. Evidence

| Check | Result |
|---|---|
| New spec `commercial-tenant-snapshots.spec.ts` (19 tests). The fake context-free client has **no model** for the RLS tables, so any direct read throws; transactions see only the context tenant's rows, plus a leaking mode | pass: own plan/usage/connectors/admins per tenant; per-tenant transactions; null usage; limit cap; plan and billing filters; no-profile tenants never match; page scanning (stops after the first page when enough matches, reads further pages otherwise); RLS-bypassing role still yields only each tenant's own data; one unreadable tenant fails the view by code, never message; readable-but-empty tenant is TRIAL; search enriches only the returned page; exact-key ranking; usage-tier fallback; overview aggregation and loud failure; CSV |
| Existing `commercial-enriched-tenants.spec.ts` | the `listEnrichedTenants` cases moved to the new spec; the signup-listing cases are unchanged and pass |
| Existing `commercial-tenant-detail.spec.ts` | pass unchanged |
| Mutation: the helper returns empty snapshots (what the context-free client sees under RLS) | 11 of 19 new unit tests fail |
| Real-database test `plan-usage-tenant-detail-restricted-role.test.cjs`, extended: real service in a child process as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner), two non-default tenants with different plans/usage/connectors/admins plus a tenant with none | pass: the enriched listing shows A = ENTERPRISE / 7000 SKUs / 2 connectors / 1 admin, B = GROWTH / past_due / suspended / 300 SKUs / 1 connector, C empty; the `planTier` and `billingStatus` filters each find exactly B; the search shows each tenant's own plan and access status; the overview counts enterprise, growth, past due and suspended |
| Mutation: the helper returns empty snapshots, in the built service | the real-database test **fails** (`enriched: tenant A must not collapse to the default TRIAL plan`); source restored (diff against the backup is empty), dist rebuilt |
| Lane | the extended test is already registered (37 tests, 0 expected failures); no lane change |
| `validate-sec-db-call-sites.cjs` | pass; plan-usage raw SQL sites 21 → 23 (one direct-client query removed, three tenant-scoped statements added), inventory counts updated |

## 4. What stays open

`plan-usage.service.ts` stays `open` in the call-site inventory: its remaining direct-client reads are only the **non-RLS** tables `WorkspaceDirectory`, `AuthIdentity` and `PublicSignupRequest` (plus the `connector_definitions` catalogue joined in the tenant's own transactions). Those are the P2.8 class C decision (identity and signup lookups). No RLS-protected table is read through the direct client in this file any more.

## 5. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not change any endpoint or response shape; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 6. Rollback

Revert the PR. The previous batched context-free reads return, which are correct only for the current superuser runtime.
