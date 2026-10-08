# SEC-DB-RLS-001 P2.8b: the commercial-requests operator views read every tenant

Date: 2026-10-09
Baseline: `origin/main` at `cc908d8b` (#1269)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role, policy or configuration is changed. **No generic bypass, no cross-tenant policy and no schema change.**

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

Second slice of the "class C" items. The inventory called this one "decision-needed" (iteration versus a maintenance read). The maintenance-read option would add a cross-tenant policy, which this programme is removing (7.2b), so the existing tenant iteration is the consistent answer and needs no decision.

## 1. The defect

`CommercialRequestsService` backs the platform-operator upgrade queue. Three reads went through the context-free direct client against `tenant_commercial_requests` (tenant-keyed, row-level-secured) with no tenant filter:

- `listUpgradeRequestsInternal` (also the CSV export): the queue.
- `getUpgradeRequestOverviewInternal`: the counts (total, open, acknowledged, resolved, cancelled, recent, stale, attention) and the oldest active request.
- `findRequestByIdInternal`, used by the status action: an operator names a request by id only.

Under a restricted role that client sees only the default tenant's requests. The queue would list almost nothing, every overview figure would undercount, and an operator could not act on another tenant's request (it reads as `COMMERCIAL_REQUEST_NOT_FOUND`), so upgrade requests of real customers would sit unanswered with nothing showing why.

Known-tenant writes and tenant-side reads already used `prisma.tenant(<tenant>)` and are unchanged. `WorkspaceDirectory` has no row level security; its directory lookup is unchanged.

## 2. Change (`apps/api/src/billing/commercial-requests.service.ts`)

A private `collectAcrossTenants` runs a read once per tenant through the existing `forEachTenant` (one short transaction per tenant, tenant context set inside it, 5 second per-tenant timeout), and `assertEveryTenantRead` turns any unreadable tenant into a thrown error. No new abstraction.

- **Listing:** each tenant returns its newest `limit` rows (query filtered by `tenantKey`); the rows are merged newest first (`createdAt` desc, `id` desc) and cut to `limit`, so the result is the same `limit` newest requests overall. A tenant filter reads that tenant only.
- **Overview:** each tenant is counted in its own transaction; the nine counts are summed and the oldest active request is the earliest across tenants. Same output shape.
- **Find by id:** each tenant is searched with `{ id, tenantKey }`; a match in any readable tenant is returned even if another tenant could not be read. "Not found" is reported only when every tenant was read; otherwise the call throws.
- **Unreadable tenant:** the listing and the overview throw `COMMERCIAL_REQUESTS_TENANT_READ_FAILED n [tenant:code]` (stable codes, never a database message) rather than return a queue or totals with that tenant silently missing. The status action already maps any failure to the generic `UPGRADE_REQUEST_STATUS_UPDATE_FAILED` response.
- A row that belongs to another tenant than the iteration's fails that tenant's read (correct with or without RLS).
- Orphan limit (stated): a tenant with requests but no directory row is not covered.
- Controller, DTOs, response shapes, OpenAPI, CSV format: unchanged.

## 3. Evidence

| Check | Result |
|---|---|
| `commercial-requests.service.spec.ts` (26 tests; the existing 18 keep their substance, the shared direct-client mock now iterates the directory and only shows a row to its own tenant's iteration; 8 new on an RLS-faithful fake that rejects any query without a tenant filter or for another tenant than the transaction context) | pass: listing across tenants newest first under the limit; tenant filter reads one tenant; overview sums and takes the earliest active; find-by-id in a non-default tenant; not-found only when all tenants read; unreadable tenant fails listing and overview with codes only; a find in a readable tenant survives another tenant's failure and an unfound one then throws |
| Mutation: iterate the default tenant only | 12+ tests fail, covering every existing update test and the new views |
| Real-database test `commercial-requests-restricted-role.test.cjs`: isolated migrated DB, the real service in a child process whose database environment is `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner); 5 upgrade requests over the default tenant and two non-default directory tenants plus an overage flag that must not count | pass: **the former context-free listing returns the default tenant's request only**; the new listing returns all 5 newest first without the flag; the tenant filter returns that tenant's 2; the overview totals (5 total, 3 open, 1 acknowledged, 1 resolved, 1 stale open, 1 stale acknowledged, 2 attention) are exact; an operator acknowledged a non-default tenant's request and the write is stored |
| Mutation: default tenant only, in the built service | the real-database test **fails** (`COMMERCIAL_REQUEST_NOT_FOUND` for the non-default request); dist restored byte-identical |
| Lane | `scripts/restricted-role-lane.v1.json` 43 → 44 tests; config test passes |
| `validate-sec-db-call-sites.cjs` | pass; entry reclassified C → A (tenant iteration), stays `open` under the ratchet's definition (the context-free client remains as the carrier of the tenant transactions and for `WorkspaceDirectory`) |
| `tsc -p tsconfig.build.json --noEmit`; `jest src/billing` | clean; 14 suites / 230 tests pass |

## 4. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant, role or policy, and does not claim cutover readiness. It does not touch the remaining class C items (`auth.service` pre-tenant identity lookups, the `media.service` unsigned branch, which waits on `MEDIA_URL_SIGNING_KEY`, a human gate). The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

Cost note: each operator call now makes one short query (the overview, ten) per directory tenant. This is an operator-only surface, and the work is milliseconds at pilot scale.

## 5. Rollback

Revert the PR. The single context-free queries return, which are correct only for the current superuser runtime.
