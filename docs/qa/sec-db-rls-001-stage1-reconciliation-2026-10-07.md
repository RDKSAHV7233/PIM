# SEC-DB-RLS-001 Stage 1: reconciliation with `main` (docs only)

Date: 2026-10-07
Baseline: `origin/main` at `7e74a8e9` (`CI` and the final `Deploy Staging` green)
Type: **documentation only.** No application, test, CI or database change. No production access.
Issue: #1189.

## 1. Why this note exists

The Stage 1 design (`sec-db-rls-001-stage1-remediation-design-2026-10-07.md`, #1207) was written as a plan. Several of its slices were then merged by a different route than the design assumed, and two tenant-iteration helpers now exist on `main`. This note records what is done, what is not, which helper is for what, and the rule that stops completed work from being re-opened by reading the design document.

> Any new PR for a completed slice must demonstrate a gap against current `main`; the Stage-1 design document is no longer evidence that the work is outstanding.

## 2. Design principle (amended)

Replaces the "no job may use the context-free client" wording wherever it appears in the Stage 1 design or the call-site inventory:

> **No job may use the unscoped direct client directly. Direct database access is permitted only inside the approved transaction-scoped tenant-iteration primitive, where tenant context is established before any protected query.**

Consequences:

- A job that needs the context-free client (`PrismaDirectService`) only to start a per-tenant transaction is conforming. A job that reads or writes a protected table on the context-free client outside such a transaction is not.
- Discovery queries run inside the per-tenant transaction and also filter by the tenant key in SQL, so the result is the same whether or not the role in use is subject to row level security.
- A cross-tenant result produced by a runtime role is never reported as complete orphan detection. Orphan detection by a runtime role is `UNVERIFIED_BY_RUNTIME_ROLE`.

## 3. The two helpers, and their boundary

Both stay. They answer different questions and neither is rewritten to look like the other.

| | Transaction-scoped DB iteration | Service orchestration |
|---|---|---|
| Code | `apps/api/src/common/tenant/tenant-iteration.ts` (#1204, #1210) | `apps/api/src/common/tenant/tenant-iteration.service.ts` (#1209) |
| Shape | functions over a Prisma client (`forEachTenant`, `listTenantKeys`, `discoverAcrossTenants`, `summarizeTenantRuns`) | injectable Nest service (`TenantIterationService`, `assertTenantIterationComplete`) |
| Unit of work | **one transaction per tenant**: `set_config('app.tenant_key', key, true)`, then every query on that transaction client | per tenant: request-context run plus the per-tenant Prisma client, with a per-tenant timeout and abort signal, an overall deadline, and paged directory listing |
| Use it when | the work is several raw or ORM statements that must be atomic and tenant-bound (credential re-encryption, billing scans, audit aggregates) | the work is a call into an existing tenant-aware service that already manages its own transactions (for example an AI control service's own sweep) |
| Rule of thumb | tightly coupled database operations in one transaction | orchestrating existing tenant-aware services |

**Naming.** The transaction-scoped primitive will be renamed `forEachTenantInTransaction()`, because `forEachTenant` does not say which of the two it is. The rename is a separate code PR. Because #1214 (opened by another stream) already imports `forEachTenant`, the rename keeps `forEachTenant` as a deprecated alias for one release so that neither side breaks; the alias is removed once no caller remains, and the ratchet counts remaining callers.

**Convergence (later, not now).** Eventually: one item/summary type (`TenantIterationItem` / `TenantIterationSummary`) shared by both, and one canonical tenant discovery (`WorkspaceDirectory` union the default tenant, including inactive tenants where a sweep must reach them). Until then each helper keeps its own result type. Already-green credential and billing work is not rewritten to conform to the service.

## 4. Slice map: Stage 1 design against `main`

Verified against `git log origin/main` at `7e74a8e9`, not against the design.

| Slice | Subject | State | Evidence |
|---|---|---|---|
| 7.1 | tenant-iteration helper | **DONE, twice, by design** (two helpers, section 3) | #1204 (transaction primitive, with its first consumers); #1209 (service, no consumers yet) |
| 7.2a | AI sweeper and counter audit onto iteration | **REVIEW** | #1214 open; not automatically a duplicate (section 6) |
| 7.2b | drop the three `ai_maintenance_read_*` policies | **NOT STARTED**, gated on 7.2a merged, deployed and runtime-verified | design section 4 |
| 7.3 | credential-rotation sweeps (`rotateKey`, `rotateAllCredentials`, heartbeat) | **DONE** | #1204 (per-tenant `PARTIAL_FAILURE` result, positive-assertion tests, mutation check, restricted-role integration test); #1213 isolates the rotation test in the lane |
| 7.4 | provisioning seeds default pricing on the tenant client | **DONE** | #1206. The `auth.service` pre-tenant lookup review (class C) is **NOT done** |
| 7.5a | stale-recovery and lease sweepers | **NOT STARTED** | none |
| 7.5b | heartbeat and WooCommerce reconciliation | **PARTIAL**: heartbeat key-rotation sweep done in #1204; `runHeartbeat` and WooCommerce reconciliation not started | #1204 |
| 7.5c | media-integrity and plan-usage rollup | **NOT STARTED** (`plan-usage`, 21 raw SQL sites, is its own PR) | none |
| 7.6 | grace-period escalation, commercial reminders | **DONE** | #1210 (every tenant reached, results surfaced, failures logged as errors) |
| 7.6 | outbound-webhook stuck-delivery recovery | **NOT DONE** | planned as I-3b |
| 7.7 | class R raw SQL with an explicit tenant argument (`bulk-import`, `catalog`, `connector-permission`) | **DONE** | #1208 |
| 7.7 | `media.getAssetFile` | **DONE, activation outstanding** | #1211 (signed token), #1212 (web forwards it); `MEDIA_URL_SIGNING_KEY` still unset (section 5) |
| 7.7 | dashboards by iteration, Stripe ledger, `commercial-requests`, M1c fail-loud constructors | **NOT STARTED** | decisions D2, D3, D4 are locked |
| M1a / M1b | connector credential writes and connectors on the tenant client | **DONE** (before the design) | #1200, #1202 |
| 7.8 | identity delta against the I1 model | **NOT DONE** | `noCrossTenantMaintenanceRole` wording still to be changed |
| 7.9a-c | migrator, backup and reporter wiring | **NOT STARTED** (opt-in, nothing in production until a human provisions credentials) | none |
| 7.10 | production-shaped rehearsal v2 | **PARTIAL / INCOMPLETE** | #1240 merged the plan, restricted-role configuration seam, and shared role-name validation only. It did not merge an accepted v2 runner or prove PG16/PG18 evidence artifacts and exact-head v2 CI. |

Restricted-role lane: 30 tests, empty expected-failure baseline. Two tests that are on `main` are not yet registered in it (`billing-jobs-tenant-iteration.test.cjs`, `media-public-file-token.test.cjs`); that is a small follow-up, not a regression.

### 7.10 status correction

PR #1240 is permanently a **PARTIAL DELIVERY**. Its merged configuration seam is useful and remains credited, but it is not evidence that the production-shaped rehearsal completed. The following remain required for 7.10: an accepted v2 runner, independent PostgreSQL 16 and 18 rehearsal execution, one valid redacted evidence artifact per version, and exact-head CI that runs that implementation.

> Execution without valid evidence is **INCOMPLETE**. Evidence without successful execution is **FAIL**. 7.10 passes only when both execution and evidence pass on both PostgreSQL versions.

The eventual 7.10 closure record must cite both #1240 and the corrective implementation PR. No production role, credential, ownership, RLS, deployment, or database action follows from this correction.

## 5. Signed media URLs: a cutover prerequisite

The public media route serves unsigned while `MEDIA_URL_SIGNING_KEY` is unset, and then resolves only the default tenant under row level security. The key stays unset until it is deliberately enabled, but **activating signed media URLs, and verifying them, is a prerequisite of the restricted database-role cutover**:

1. #1211 and #1212 are deployed (they are).
2. A human provisions `MEDIA_URL_SIGNING_KEY` (at least 32 random characters) in the API service's variables. This note does not do that.
3. Verification after activation: an authenticated asset listing returns `fileToken`; a web thumbnail for a **non-default** tenant loads; an unsigned request is refused (401); an exported or marketplace image URL carries a verifying token.
4. Only then does the cutover checklist count media as closed.

## 6. Review of #1214 against the boundary

Recorded separately in the review comment and the session report; summary here so the map is complete. #1214 uses the transaction-scoped primitive (it imports `forEachTenant`), not the service, and that is the correct side of the boundary for its counter audit (atomic multi-table aggregates). Its sweeper orchestrates an existing tenant-aware service (`sweepExpired`) per tenant, which is the service-orchestration shape. It is therefore neither a duplicate of merged work nor in need of re-scoping to `TenantIterationService`. It is blocked by a failing `build` check: the AI governance validator `validate-ai-prov-provider-execution-eligibility.cjs` still requires the sweeper to set `app.ai_maintenance` transaction-locally, so removing the marker from the code fails that guard. Relaxing a governance validator is a decision for its owner, not a side effect of a code PR.

## 7. What this note does not change

Nothing in production. `vexa_app_v2` untouched. No credential, role, key or secret created or rotated. No AI provider path. The RLS-5 cutover, the kill-switch drill, 004b-ii networking and any provider call remain held for explicit human approval.
