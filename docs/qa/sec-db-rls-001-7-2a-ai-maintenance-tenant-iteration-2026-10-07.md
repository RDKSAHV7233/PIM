# SEC-DB-RLS-001 7.2a: the AI reservation sweeper and counter audit iterate tenants

Date: 2026-10-07
Baseline: `origin/main` at `03f26bd2`
Issue: #1189. Evidence: `SEC-DB-RLS-001-production-identity-evidence-2026-10-06.md` (D-022). Design: `sec-db-rls-001-stage1-remediation-design-2026-10-07.md` section 4.
Type: **behavior change in one service. No migration, no role, grant, RLS or credential change, no production access.**

## 1. What changed and why

`IntelligenceReservationMaintenanceService` read across tenants through a transaction-local session setting, `app.ai_maintenance = 'on'`, which three `SELECT` policies honoured. The production evidence showed that the ordinary application identity can set that setting, so it is a cross-tenant path inside the ordinary runtime and not a separately governed one. The owner decided it does not satisfy the target isolation model and must be removed (record D-022).

This change moves both readers off the setting. The policies themselves are dropped in a separate migration, 7.2b, **only after this change is deployed and runtime-verified**: dropping them first would silently empty the deployed sweeper.

| Reader | Before | After |
|---|---|---|
| Sweeper discovery (`runSweep`) | one cross-tenant `distinct tenantKey` query behind the setting | `forEachTenant`: per tenant, a transaction with the tenant context set inside it, two counts for expired work, filtered by that tenant key explicitly. Tenants with work are swept exactly as before through the tenant client, at most 50 per tick |
| Counter audit (`auditCounters`) | one cross-tenant join behind the setting | per tenant, that tenant's budget-policy counters against its own charges and reservations; each tenant also reports its share of every platform counter, the shares are added, and the totals are compared once with `ai_platform_budget_periods` (a platform table with no RLS) |

Behaviors added on purpose:
- A tenant that cannot be read is **counted and logged by error code only**, never treated as "nothing expired". The summary gains `tenantsEvaluated` and `tenantsFailed`.
- One tenant's sweep failing no longer stops the others (it is counted; the next tick retries it).
- The audit **throws** when any tenant could not be read, rather than reporting a clean result from a partial read.
- Every query filters by the tenant key explicitly, so the result is the same today (the production role is a superuser and bypasses RLS) and after the cutover (RLS enforced).
- Audit rows are returned in a deterministic order (scope, counter id, field).

The shared helper is `forEachTenant` in `apps/api/src/common/tenant/tenant-iteration.ts`.

## 2. Evidence

- **Unit spec** `intelligence-reservation-maintenance.service.spec.ts`, 15 tests. The fake base client has no reservation model, so a read outside a per-tenant transaction fails loudly, and a transaction sees only the tenant set inside it. Covers: a non-default tenant's expired reservation is found and swept; tenants with and without work; explicit tenant-key filters; not-yet-expired work is left alone; the 50-tenant cap in tenant order; an unreadable tenant counted without leaking its message; a failing sweep isolated; the overlap guard; platform shares added across tenants; platform drift; scope fallback; tenant drift sorted deterministically; the audit throws on an incomplete read; the source no longer sets or reads the setting.
- **Mutation check: 15 of 15 caught** (discovery through the base client, tenant filter dropped, failures not counted, no batch cap, a failing sweep stopping the others, no throw on an incomplete audit, shares overwritten instead of summed, scope fallback changed, no sorting, overlap guard removed, dispatching ignored, expiry inverted, the retired setting returning, requests not added, a message leaked into the log). The first run of the "failure stops the others" mutant was a compile error, not a failing test; it was redone as a compiling rethrow and fails one test.
- **Real PostgreSQL 16 as a restricted role** (`apps/api/test/integration/ai-provider-budget-lifecycle.test.cjs`, run against a fresh database with every migration applied; the services run as `ai_rls_probe`: NOSUPERUSER, NOBYPASSRLS, not the owner, forced RLS): all scenarios pass, including the RLS scenario (both tenants swept, none failed, every directory tenant plus the default evaluated), the randomised concurrent workload with a clean audit, injected tenant-counter drift reported and then clean, and **injected platform-counter drift reported and then clean**. The test now registers its tenants in the workspace directory as production provisioning does, and grants its role `SELECT` on `WorkspaceDirectory` (the production runtime role holds that table in the I1 manifest). The assertions that the setting works were removed: that mechanism is being retired.
- **Static guard updated, not bypassed.** `scripts/validate-ai-prov-provider-execution-eligibility.cjs` (a `build` job step) required the sweeper to set the retired marker. It now requires the opposite: the sweeper and audit must not set or read `app.ai_maintenance` (comments that explain the retirement are allowed) and must reach tenants through `forEachTenant`. Its negative fixtures were updated: the retired marker returning, a maintenance read returning, iteration removed, a comment-only mention allowed, and a real use hidden after a URL on the same line still detected. The migration checks for the three policies are unchanged until 7.2b drops them. `scripts/ai-control-plane-proof.cjs` (not run in CI) still demonstrates the policies and is updated in 7.2b.
- `tsc` (build config) clean; the call-site ratchet passes with the entry reclassified from class D to class A and **two raw-SQL sites, unchanged** (the platform-periods read uses the Prisma model, not raw SQL); the raw-SQL comment check passes.

## 3. Limits

- **No change in production behavior is claimed**: the production runtime role is still a superuser, so before and after the sweeper finds the same work. What changes is that it no longer depends on the setting or on bypassing RLS.
- **Directory coverage:** a tenant key that holds reservations but is absent from `WorkspaceDirectory` is not visited. A superuser scan used to see it. The helper cannot prove there are none (`orphanDetection: UNVERIFIED_BY_RUNTIME_ROLE`); a read-only production check of distinct tenant keys against the directory is a Sprint 9 pre-cutover item.
- **Cost:** the discovery now runs two counts per tenant per tick (every 60 s) instead of one query. With concurrency 4 it is cheap at tens of tenants; it is not measured at hundreds.
- The platform-counter comparison runs after all tenants are read, so it is a snapshot, not a transaction across tenants; the same was true of the former single query under concurrent writes.
- Deployment is a human step. 7.2b waits for it and for a runtime check that the deployed sweeper processes a non-default tenant with a non-empty result.

## 4. Rollback

Revert the PR. The three `SELECT` policies still exist (they are not touched here), so the previous code works again.
