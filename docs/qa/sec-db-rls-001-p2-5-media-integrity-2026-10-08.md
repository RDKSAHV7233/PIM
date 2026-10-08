# SEC-DB-RLS-001 P2.5: media-integrity scan under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `b1d18b3c` (#1259)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed. The scan is read-only (no media, product or storage mutation); that contract is unchanged.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

## 1. Defect

`MediaIntegrityService.runBoundedScan()` (scheduled daily when `MEDIA_INTEGRITY_SCHEDULE_ENABLED=true`, also callable directly) was **one global scan over every tenant's media**: a single `(createdAt, id)` cursor, one global checkpoint, `mediaAsset.count()` and `mediaAsset.findMany()` through `PrismaDirectService`, the context-free client. Under forced row level security that client sees **no** tenant's media, so after the cutover the scan would have counted zero eligible rows, examined nothing and recorded **complete, clean coverage** (`status: ok`, `coverageComplete: true`). That is worse than a failure: the only control that detects missing or invalid media would report health while looking at nothing.

The platform tables it writes (`media_integrity_scan_runs`, `media_integrity_scan_checkpoints`) carry no tenant key and are not row-level-secured; they were not the problem.

## 2. Change (`apps/api/src/media/media-integrity.service.ts`)

A global cursor cannot exist without a view across tenants, so the scan is now **per tenant**:

- **Tenants** come from the workspace directory plus the default tenant (`listTenantKeys`, the existing helper). No new abstraction.
- **Per-tenant cursor and checkpoint.** Each tenant's `(createdAt, id)` cursor is stored under `<checkpoint key>::<tenant key>` in the existing checkpoint table (no schema change). The old single global key is no longer read; the first run after deploy starts every tenant's cycle afresh, which is harmless for a read-only scan.
- **Transactions:** every count and page is a short transaction in that tenant's own context (`forEachTenant` with that one tenant), filtered by `tenantKey`, so it is correct whether or not the role bypasses RLS. **Storage probes run outside any transaction**, so a slow object-store call never holds a database transaction open.
- **Per-run budget** (`maxRowsPerRun`, default 5,000) is shared across tenants. Tenants are visited **least recently completed first** (a never-scanned tenant first, a tenant in the middle of a cycle before a fresh one), so a tenant that has just finished a cycle cannot starve the others. A tenant not reached keeps its cursor and checkpoint untouched and the run reports `continuationPending`.
- **Coverage semantics preserved:** `complete` still means every tenant's cycle started fresh and every tenant was read to its end in this run; `rowsEligible` is the sum of per-tenant counts; `rowsExamined`, `truncated`, `continuationPending`, `totals`, `byStorageKind`, `affectedTenantCount` and `activeProductImpactCount` mean what they meant.
- **Unreadable tenant:** logged as an **error** by tenant and stable error code (never the message), counted in the new `impact.unreadableTenantCount` (inside an existing JSON column, so no migration), its cursor is left as it was, and the run is `partial` with `complete: false`. A scan that could not read a tenant never reports complete coverage. A directory read failure marks the whole run `failed`, never "scanned the default tenant only".
- The scheduler's completion log now includes `unreadableTenantCount`. No endpoint, no new environment variable, no OpenAPI change.
- **Orphan limit (stated):** a runtime role cannot enumerate tenants that have media but no directory row; such a tenant is not scanned.

## 3. Evidence

| Check | Result |
|---|---|
| `media-integrity.service.spec.ts` (16 tests, rewritten; the 7 earlier behaviours kept and re-expressed per tenant). The fake database: the context-free client sees no media, a transaction sees only its tenant's, plus a leaking mode | pass: path classification, capped scan stays partial and advances the tenant's cursor, ok only for complete clean coverage, missing / storage-error / invalid / unverifiable separation, resume from a persisted per-tenant cursor without offset pagination, a throwing probe, no paths / filenames / tenant names / secrets in the result; new: every-tenant scan, tenant-scoped reads, an RLS-bypassing role, per-run budget across tenants, least-recently-completed-first order, an unreadable tenant, directory failure, no mutation |
| Existing scheduler spec and the rest of `src/media` | pass (90 tests in `src/media`) |
| Mutation: scan the default tenant only | 11 of 16 unit tests fail |
| Real-process test `media-integrity-scan-tenant-iteration.test.cjs`: isolated migrated DB, API running as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner), scheduled scan enabled with a 500 ms first run; 2 media rows in tenant A (one linked to an approved product), 1 in tenant B, 1 in the default tenant, a tenant with none; every storage path malformed so no object store is contacted | pass on the run row the scan records: 4 of 4 rows examined and eligible, complete coverage, 4 invalid paths, `byStorageKind.malformed` 4, 3 affected tenants, 1 active-product impact, 0 unreadable tenants, status `partial` (defects found); per-tenant checkpoints for A, B and the default tenant with cleared cursors and none for the empty tenant |
| Mutation: scan the default tenant only, in the built API | the real-process test **fails** (`all four media rows of the three tenants must be examined (saw 1)`); source restored (diff against the backup is empty), dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 39 → 40 tests, 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; entry plan and positive assertion updated; the file stays `open` (the context-free client remains as the carrier of the tenant transactions and for the platform scan tables) |

## 4. Behaviour changes worth knowing

- The first scan after deploy restarts every tenant's cycle (the old global checkpoint is ignored).
- Per-run row budget is now shared across tenants rather than one global ordered stream, so the order in which media is examined within a run differs; a full cycle still covers every row of every tenant.
- Cost: one count and one page transaction per tenant per run, plus the probes, instead of one global count and pages. Negligible at pilot scale.

## 5. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not change what a scan reports about a given media row, enable the scheduled scan anywhere, or touch signed-media activation (`MEDIA_URL_SIGNING_KEY` stays unset); it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 6. Rollback

Revert the PR. The previous global scan and its global checkpoint return (the per-tenant checkpoint rows are inert), which is correct only for the current superuser runtime.
