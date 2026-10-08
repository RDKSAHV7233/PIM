# SEC-DB-RLS-001 P2.4b: WooCommerce reconciliation sweeper under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `ee75b726` (#1244), which carries #1255
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed. **WooCommerce pilot status (`p1_blocker_hold`) is not affected**: under the current superuser runtime the job finds exactly the installations it found before.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

## 1. Defect

`WooCommerceReconciliationService.runReconciliation()` (every 4 hours, 90 second boot delay) is the job that enforces PIM as the source of truth against live WooCommerce drift: it reads each active WooCommerce installation, then its successful submissions of the last 48 hours, compares each with the live product and re-publishes from PIM on drift. It listed installations with one `findMany`, and each installation's submissions with another, both through `PrismaDirectService`, the context-free client. Under forced row level security that client sees **no** tenant's rows, so after the cutover:

- the installation list would be empty and **no drift would ever be detected or corrected**, while each tick logged "completed" with all counters zero;
- the connector's own reads (credentials, installation metadata) were already migrated to the tenant client (M1b), so only this sweeper's discovery was wrong.

`connector_definitions` (the WooCommerce slug lookup) is not RLS-protected and was unaffected.

## 2. Change (`apps/api/src/connectors/woocommerce/woocommerce-reconciliation.service.ts`)

- **Installation discovery** runs per tenant through the existing `forEachTenant` (one transaction per tenant, tenant context set inside it, bounded concurrency). No new abstraction. Each query also filters `tenantKey = <the tenant it is given>`, so it is correct whether or not the role bypasses RLS; a row of another tenant is counted as a failure and never acted on. Order is unchanged (least recently updated first), now across tenants. There is still no batch cap on installations, as before.
- **Submission reads** run inside the installation's own tenant transaction, filtered by its tenant, with the same window (SUCCESS, external reference present, resolved within 48 hours, newest 50). A failed read throws to the caller.
- **Isolation:** the caller counts a failed submission read as an error, logs it (installation, tenant, error text) and continues with the other installations. Previously a database error here aborted the whole tick; this is stricter isolation, not a loosening.
- **Unreadable tenant:** logged as an **error** with its tenant key and stable error code (never the message); the readable tenants are still reconciled that tick.
- The drift check (`reconcileSubmission`), the provider-unavailable rule (never treated as "no drift"), and the republish (`updateProduct`) are unchanged.
- `WOO_RECONCILE_INITIAL_DELAY_MS` (>= 100) shortens the first run for tests; unset or invalid keeps 90 seconds.
- No endpoint, response shape or OpenAPI change.

## 3. Evidence

| Check | Result |
|---|---|
| `woocommerce-reconciliation.service.spec.ts` (14 tests, 6 new). The stub database now behaves like RLS: the base client sees only the default tenant, a transaction sees only the tenant set inside it | pass: all 8 earlier behaviours (republish on drift, none without drift, provider-unavailable blocks a republish, per-submission and per-installation isolation, single flight, empty case, running flag reset after a failed load) hold against the RLS-faithful stub; new tests cover every-tenant reconciliation with the right per-tenant context, the context-free view seeing only the default tenant, tenant-filtered submission reads, ordering across tenants, an unreadable tenant, and an unreadable submission read |
| Mutation: discover the default tenant only | 8 of 14 unit tests fail |
| Real-process test `woocommerce-reconciliation-tenant-iteration.test.cjs`: isolated migrated DB, API running as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner), reconciliation enabled with a 500 ms first run; recent successful submissions on active WooCommerce installations in two non-default directory tenants and the default tenant, an out-of-window submission and a disabled installation's submission that must be skipped, a directory tenant with none | pass: the job's own completion log reports `checked=3, republished=0` (the three in-window submissions, one per tenant, all reached; each ends as "provider read unavailable" because the fixtures have no credentials); every installation id appears in the log; the out-of-window and disabled-installation submissions never appear; no store URL appears |
| Mutation: discover the default tenant only, in the built API | the real-process test **fails** (`exactly the 3 in-window submissions of active installations must be reached (saw checked=1)`); source restored (diff against the backup is empty), dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 38 → 39 tests (after merging main, which carries the heartbeat test from #1256), 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; entry plan and positive assertion updated |

This sweeper has no database effect of its own (it reads, then calls the provider), so the observable proof is the job's counters and log lines. The fixture installations have no stored credentials and no base URL, so the connector cannot reach any store; the test also asserts no store URL appears in the output.

## 4. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not change the reconciliation rules, WooCommerce behaviour or pilot status; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 5. Rollback

Revert the PR. The previous context-free reads return, which are correct only for the current superuser runtime.
