# SEC-DB-RLS-001 P2.6a: internal-ops summary under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `b616bea0` (#1263)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role, policy or configuration is changed. **No generic bypass and no cross-tenant SELECT policy is added** (the inventory's original idea of a "maintenance-read" policy is not used).

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

P2.6 is split: this document covers the operator **summary** (`internal-ops-summary.service.ts`); the operator **alerts** (`internal-ops-alerts.service.ts`, 13 raw SQL sites) are P2.6b.

## 1. Defect

`InternalOpsSummaryService.getSummary()` backs the internal-ops dashboard. Every RLS-backed card was one platform-wide query through `PrismaDirectService`, the context-free client: jobs (export and bulk-import status counts, stuck counts), imports (active runs, failed and dead-letter rows), publishing (export and submission success rates), connectors (installations by status), the three readiness sources (open validation issues, published mapping versions, installation statuses) and the media total. Under forced row level security that client sees **no** tenant's rows, so after the cutover every figure would be zero while each card still reported `availability: "available"`. An operator would read "no failed jobs, no blockers" for a platform that has them.

Not affected: the error-authority card (a separate observability database) and the media latest-run (a platform table with no tenant key).

## 2. Change (`apps/api/src/internal-ops/internal-ops-summary.service.ts`)

- Each card reads **per tenant** through the existing `forEachTenant` (one short transaction per tenant, tenant context set inside it, bounded concurrency) in a new private `acrossTenants(read, merge)` helper that replaces the old single-transaction wrapper. No new abstraction.
- **Every query filters by the tenant it is given** (`tenantKey` added to each `where`; the one remaining raw query carries `"tenantKey" = ${tenantKey}`), so each figure is correct whether or not the role bypasses RLS.
- **Exact merging in the application:**
  - status counts and row sums are added (grouped status rows are summed per status);
  - **affected-tenant counts** (open validation issues, affected published mappings, paused or expired installations) are the number of tenants that have the condition, not a sum of rows (the old `COUNT(DISTINCT tenant)` raw queries are removed; they become a per-tenant presence check);
  - the platform-wide **top rule families** are taken after merging the tenants: each tenant returns its full (rule code, severity) groups, the groups are summed, cut to the same 50-group limit and normalised to families as before, so a rule spread thinly over many tenants still ranks correctly (a per-tenant top-N would not);
  - `blockedProducts` stays a distinct-product count per tenant, summed (a product belongs to exactly one tenant).
- **Per-card isolation is preserved:** each card has its own tenant pass, so a failure in one card's statements leaves the others available, as before.
- **Fail loudly:** if any tenant cannot be read, the card that was reading it throws and the existing `resolveCard` shows it `unavailable` with its zero fallback and the existing `errorMessage`; the card-failure warning names the tenant and a stable error code (never the message, which can embed connection strings). A figure is never silently an undercount.
- The media latest-run reads the platform table in a small timeout-bounded transaction on its own.
- Response shape, endpoint and OpenAPI are unchanged.

## 3. Evidence

| Check | Result |
|---|---|
| `internal-ops-summary.service.spec.ts` (16 tests; the 11 earlier ones run as the single-tenant case with an empty directory; 5 new) | pass; the earlier expectations hold except `affectedTenants`, which is now 1 for the single tenant (the old mock returned a platform-wide distinct count of 2 directly) |
| New multi-tenant tests: a fake whose every query answers by the tenant in its own filter (it throws on a query with none), and whose context-free client sees nothing | pass: exact sums across the default tenant, a data-rich tenant and an empty tenant; exact affected-tenant counting; rule families merged before the top; no query without a tenant filter; one unreadable tenant makes only the cards that read it unavailable and is logged without the message |
| Mutation: pass over the default tenant only | 4 of 16 unit tests fail |
| Real-database test `internal-ops-summary-restricted-role.test.cjs`: isolated migrated DB, the real service in a child process whose database environment is `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner); export jobs, import jobs, submissions, connector installations and media in two non-default directory tenants and the default tenant, an empty tenant | pass with exact figures: 4 active / 2 failed / 1 dead-letter jobs, 6 failed and 1 dead-letter import rows, publishing 6 ok / 2 failed (75%) and 3 ok / 2 failed (60%), 5 installations (2 active, 1 paused, 1 credential-expired, 1 disabled), readiness connector 1 blocking / 1 warning / **2 affected tenants**, 4 media assets; every card available |
| Mutation: pass over the default tenant only, in the built service | the real-database test **fails** (`active jobs span tenants A and B`); source restored (diff against the backup is empty), dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 40 → 41 tests, 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; raw SQL sites in this file 4 → 1, inventory counts updated; the direct-client entry stays `open` (the context-free client remains as the carrier of the tenant transactions and for the platform scan table) |

Validation-issue and mapping-version figures are covered by the unit tests; the real-database fixture covers the tables that need no cross-table parents (it would need a full product-validation fixture to add them).

## 4. Cost and limits

- Each card now opens one short transaction per tenant, so a summary costs about (cards x tenants) transactions instead of (cards) queries. Negligible at pilot scale. At large tenant counts this is the case for the planned reporting identity (`vexa_reporter`, which exists for cross-tenant aggregates); that is a later, human decision and is not assumed here.
- A tenant that has data but no directory row is not included (the stated orphan limit of runtime-role iteration).

## 5. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant, role or policy; it does not change what any card means; it does not touch the alerts service (P2.6b); it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 6. Rollback

Revert the PR. The previous single platform-wide queries return, which are correct only for the current superuser runtime.
