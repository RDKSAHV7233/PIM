# SEC-DB-RLS-001: tenant iteration helper and credential-rotation sweeps (increment I-1)

Date: 2026-10-07
Baseline: `origin/main` at `a71fc6d1` (M1b merged, `main` CI green)
Issue: #1189. Plan: the approved sequence I-1 to I-6, then RLS-3 and RLS-4.
Type: **application change, no production behaviour change today** (the production runtime role is still a superuser, so RLS is bypassed either way). It makes the key-rotation path correct for the day the runtime role is restricted. No production access, no credential change, no role change, no AI provider path.

## 1. The failure this prevents

Both credential-rotation entry points scanned `connector_credentials` through the context-free client. Under row level security that client has no tenant, so it sees only the `default` tenant. After the role cutover a key rotation would have re-encrypted one tenant's credentials and reported success, while every other tenant stayed on the old key, and the heartbeat's "is anything stale?" check would never have noticed.

| Path | Before | Now |
|---|---|---|
| `ConnectorCredentialService.rotateAllCredentials` (runs automatically at startup after a key-version change) | one scan, default tenant only | iterates every tenant |
| `ConnectorCredentialEncryptionService.rotateKey` (operator procedure, `scripts/rotate-credentials.ts`) | same | iterates every tenant, dry run included |
| `ConnectorHeartbeatService.runKeyRotationIfNeeded` (decides whether rotation runs at all) | one count, default tenant only | per-tenant count; a tenant whose count cannot be read is **not** treated as "nothing stale" |

## 2. The helper: `common/tenant/tenant-iteration.ts`

Per tenant: transaction starts, `set_config('app.tenant_key', <tenant>, true)`, **all** of that tenant's work runs on the transaction client, commit or rollback. The callback is given only the transaction client and never the base client, because a query on any other connection has no tenant context.

- **No per-tenant pools.** `PrismaService.tenant(key)` creates a client and pool per tenant (`connection_limit` 5, 50 cached, oldest evicted); iterating hundreds of tenants would churn pools. This runs on one client's connections.
- **Concurrency:** default 4, configurable (argument or `TENANT_ITERATION_CONCURRENCY`), clamped to 1..8, never unbounded. The bound is per invocation: three simultaneous invocations (several schedulers) may reach 3 x 4 in-flight transactions. The unit test documents that rather than hiding it; the rotation itself runs under the heartbeat's advisory lock, so only one replica runs it.
- **Tenants listed:** every `WorkspaceDirectory` tenant (active or not) plus the default tenant. The directory is not RLS-scoped, so the list is readable by a restricted role.
- **Explicit result per tenant:** `{ tenantKey, status, examinedCount, changedCount, failedCount, errorCode?, durationMs }`. Totals are derived from these. The error code is a stable code, never the message (messages can carry row values).
- **Failure isolation and status:** one tenant failing rolls back only that tenant. A tenant that reports item failures (an undecryptable credential) is marked failed while its other rotations stay committed. The overall status is `SUCCESS` only when everything succeeded, `PARTIAL_FAILURE` when some failed, `FAILED` when all failed. 42 evaluated / 40 rotated / 1 current / 1 failed is degraded, never success.
- **Orphans: unverified, not zero.** A restricted role cannot see credentials whose tenant is missing from the directory, so it cannot prove there are none. Every summary says `orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE"`; no code path emits an orphan count of zero. Detecting orphans needs an approved audit mechanism (a privileged read-only query run by an operator), which does not exist yet.

## 3. Evidence

- **Unit (1,051 tests across `common`, `connector-framework`, `connector-installer`, all pass).** A purpose-built in-memory fake models RLS: the base client sees only the default tenant, a transaction sees only the tenant set in it, a throwing transaction rolls back only its tenant. New cases cover non-default tenants rotated and re-decryptable, default tenant byte-identical, a failing tenant not undoing another's work, `PARTIAL_FAILURE` surfaced, the concurrency cap, and the heartbeat triggering rotation when **only** a non-default tenant is stale.
- **Mutation checks (each reverted to the old unscoped behaviour, tests must fail):** `rotateAllCredentials` (6 failures), `rotateKey` (5), heartbeat stale check (4).
- **Real PostgreSQL, restricted role.** `tenant-iteration.test.cjs`: 60 tenants each see exactly their own row (positive, non-empty); a query outside the transaction has no tenant context; 61 tenants iterate with a peak of 4 connections (per-tenant clients would open far more); three simultaneous invocations complete with every tenant once. It refuses to run as a role that bypasses RLS. Mutation (tenant never set) fails it.
- **Real PostgreSQL, restricted role, both entry points, dedicated throwaway database.** `credential-rotation-tenant-iteration.test.cjs` migrates its own database (so rotating key versions cannot disturb other tests), grants the restricted role, and asserts on rows that must exist: dry run finds 2 rotatable credentials across two non-default tenants and writes nothing; the real run rotates them v1 to v2 and they decrypt to the original secrets; the undecryptable credential is left exactly as it was; the default tenant's already-current credential is byte-identical; the run is `PARTIAL_FAILURE`. Then a real API process, connected as the restricted role, re-encrypts a third tenant's credential at startup, leaves the others untouched, and logs the rotation as degraded. **Mutation on the built code:** reverting `rotateKey` to the unscoped scan fails it with "got 0"; reverting the heartbeat check fails it because tenant c is never rotated.

## 4. Known deviations and limits

- **One unreproduced lane failure.** In the first full lane run with the two new tests included, `rls-isolation.test.cjs` failed after 61 seconds (it passes alone in 9 seconds, and the lane before this change passed it in 17 seconds). An identical rerun passed 29 of 30 with only the tracked M2 expected failure, and I found no connection-exhaustion or pool-timeout messages in the log. The 61 seconds matches the lane's known 60-second API-health start-up timeout under six-way concurrency (seen once before on `bulk-publish-runs-installation-filter`). I have **not** proven the cause. If it recurs in CI, re-run once and then bisect against the two new tests, which add connection pressure (a 60-tenant seed, three concurrent invocations, a throwaway database).
- The two integration tests are not yet in the restricted-role lane list; that registration, and the CLI's per-tenant output (`scripts/`), are a small follow-up PR, because this change already spans API source, API tests and docs and the PR scope guard allows three risk domains. They pass locally as the restricted role.
- The three service files still hold the base client that `forEachTenant` runs on, so they stay `open` in the call-site inventory with updated plans; `runHeartbeat` (installation scans) is still cross-tenant and is I-4.
- Rotation of a very large tenant runs in one transaction (60 s timeout); a timeout fails that tenant only and the next run resumes (idempotent).
- Connection use is bounded per invocation, not globally across replicas; the heartbeat's advisory lock keeps rotation to one replica.
- `CONNECTOR_HEARTBEAT_INITIAL_DELAY_MS` (default 30000) was added so the end-to-end test does not wait 30 seconds; invalid values keep the default.

## 5. Next

PR 2: register both integration tests in the lane and print per-tenant results from the rotation CLI. Then I-2 (provisioning seed), I-3 (billing jobs, each with the discover-and-act assertion), I-4 (remaining sweepers, including `runHeartbeat`).
