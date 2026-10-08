# SEC-DB-RLS-001 P2.4: connector credential heartbeat under the restricted runtime role

Date: 2026-10-08
Baseline: `origin/main` at `7aaff291` (#1255; CI and Deploy Staging succeeded for this head and for `79daa437`)
Type: **source + test change.** No production effect until merged and deployed; no credential, flag, role or configuration is changed.

State: **IMPLEMENTED and TESTED locally.** Not MERGED, DEPLOYED or RUNTIME_VERIFIED at the time of writing.

The heartbeat's startup key-rotation trigger was migrated earlier (I-4, `credential-rotation-tenant-iteration.test.cjs`). This increment migrates `runHeartbeat` itself, the remainder named in the inventory.

## 1. Defect

`ConnectorHeartbeatService.runHeartbeat()` (every 6 hours, 30 second boot delay) validates connector credentials. It listed active installations (`ACTIVE`, `CREDENTIAL_EXPIRED`, one batch of 50) with one `findMany` through `PrismaDirectService`, the context-free client, and `recordOutcome` wrote each result (attempt time, outcome, reason, `CREDENTIAL_EXPIRED` / `ACTIVE` transitions) through the same client. Under forced row level security a context-free session sees and updates **no** tenant's rows. After the cutover:

- the batch would be empty, so **no credential would ever be validated and none would ever be marked expired**, while each tick logged "completed" with zero counts;
- even an installation found by some other means would have had its outcome silently lost (`updateMany` matching zero rows).

`connector_definitions` (the slug lookup) is not RLS-protected and was unaffected.

## 2. Change (`apps/api/src/connector-framework/connector-heartbeat.service.ts`)

- **Discovery** runs per tenant through the existing `forEachTenant` (the file already used it for the rotation trigger): one transaction per tenant, tenant context set inside it, bounded concurrency. No new abstraction. Each query also filters `tenantKey = <the tenant it is given>`, so it is correct whether or not the role bypasses RLS; a row of another tenant is counted as a failure and never acted on.
- **Batch semantics preserved.** Each tenant contributes at most one batch (50, same order: never-attempted first, then longest-unattempted, then id). The tenants' results are merged in that same order and cut to one batch of 50, so every installation is still visited once before any is visited twice, across tenants.
- **Outcome recording** now runs inside the installation's own tenant transaction, the facts write and the status transition together (previously two separate writes). A failed write throws, so the caller counts it as an error exactly as a failed query did before; the batch continues.
- **Unreadable tenant:** logged as an **error** with its tenant key and stable error code (never the message), and the readable tenants are still checked that tick. A directory read failure rejects out of the tick (the scheduler's existing handling logs it).
- The verifier call, classification, outcome rules (`lastValidatedAt` only on VALID, only INVALID expires, VALID promotes expired back to active, INDETERMINATE / CONFIGURATION_ERROR change no status) are unchanged.
- No endpoint, response shape or OpenAPI change; no new environment variable (`CONNECTOR_HEARTBEAT_INITIAL_DELAY_MS` already existed).
- The file still uses `PrismaDirectService`, but only as the carrier of the tenant transactions and for the non-RLS connector catalogue, so it remains `open` under the call-site ratchet's definition.

## 3. Evidence

| Check | Result |
|---|---|
| `connector-heartbeat.service.spec.ts` (38 tests, 6 new). The stub database now behaves like RLS: the base client sees only the default tenant, a transaction sees only the tenant set inside it, and every call records the tenant it ran under | pass: all 32 earlier behaviours (truthful VALID / INVALID / INDETERMINATE / CONFIGURATION_ERROR handling, legacy boolean fallback, batch rotation through a 120-installation fleet, single flight, counters, rotation trigger) hold against the RLS-faithful stub; new tests cover every-tenant validation, outcome writes under the installation's own tenant, merge order and batch bound across tenants, an unreadable tenant, and a failed outcome write |
| Mutation: discover the default tenant only | 25 of 38 unit tests fail |
| Real-process test `connector-heartbeat-tenant-iteration.test.cjs`: isolated migrated DB, API running as `vexa_runtime_ci` (NOSUPERUSER NOBYPASSRLS non-owner), heartbeat enabled with a 500 ms first run; installations in two non-default directory tenants (active and credential-expired in A, one in B), in the default tenant, a disabled one that must be left alone, a directory tenant with none | pass: all four checked installations get a recorded attempt time and outcome (`INDETERMINATE`, the no-credentials path, no provider call), each still under its own tenant; the disabled installation is untouched; sessions all `vexa_runtime_ci` |
| Mutation: discover the default tenant only, in the built API | the real-process test **fails** (`inst_a1_… must have a recorded validation attempt`); source restored (diff against the backup is empty), dist rebuilt |
| Lane registration | `scripts/restricted-role-lane.v1.json` 37 → 38 tests, 0 expected failures |
| `validate-sec-db-call-sites.cjs` | pass; entry plan and positive assertion updated |

The fixture installations have no stored credentials, so validation takes the documented no-credentials path and no provider is contacted. The test asserts the recorded attempt and outcome, which are exactly the writes that would have been lost.

## 4. What this does not do

It does not change `vexa_app_v2`, `DATABASE_URL`, any credential, flag, tenant or role; it does not touch connector behaviour, WooCommerce status (`p1_blocker_hold` is unchanged) or any provider call; it does not claim cutover readiness. The restricted-runtime cutover remains `CUTOVER_BLOCKED`.

## 5. Rollback

Revert the PR. The previous context-free read and write return, which are correct only for the current superuser runtime.
