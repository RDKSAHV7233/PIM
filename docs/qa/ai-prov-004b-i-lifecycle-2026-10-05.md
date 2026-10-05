# AI-PROV-004b-i Evidence: reservation lifecycle, platform controls and BIGINT money

Date: 2026-10-05
Baseline: `origin/main` at `658f32a8` (includes the 004b design #1176 and its review conditions #1178)
Design: [ai-prov-004b-design-2026-10-05.md](ai-prov-004b-design-2026-10-05.md)
Type: **control-plane implementation. No provider SDK, no credential, no outbound request, no live provider response, no customer-facing route, no Product mutation, no suggestion persistence.** Nothing in this change authorises a real provider call.

## 1. Scope

In scope (as authorised for 004b-i): BIGINT migration, platform controls, tenant and platform budget tables, reservation lifecycle, claim, reconcile, cancel, expire, lease handling, exactly-once settlement, PostgreSQL concurrency tests, fixed lock order, fail-closed gates, scheduled sweeper.

Still excluded: provider SDK, provider credential, outbound `fetch`, live provider request or response, customer-facing route, Product mutation. 004b-ii (the adapter zone and guard transition) is not started.

## 2. What changed

| Area | Change |
|---|---|
| Migration `20261005120000_ai_provider_budget_lifecycle` | every `*_micros` column to `BIGINT` (budget policies, reservations, `ai_executions`); USD 1,000,000 sanity ceiling; reservation `attempt_number`, `expires_at`, `claimed_at`, `lease_expires_at`, `claim_token`, `settled_at`, `settlement_reason`; status set `reserved, dispatching, reconciled, cancelled, expired, budget_blocked`; key widened to `(tenant, fingerprint, attempt)`; new `ai_provider_budget_charges` (RLS forced), `ai_platform_controls` (seeded deny-all) and `ai_platform_budget_periods` (no rows seeded); an **explicit SELECT-only maintenance policy** on the three tenant-scoped budget tables (section 3a) |
| `intelligence-money.ts` | `bigint` parsing that accepts a bigint, a digit string or a safe non-negative integer and nothing else; decimal-string output; no global `BigInt` serialisation patch |
| `intelligence-execution-gates.ts` | pure gate logic: strict deploy flag, platform control, tenant policy, live capability allow-list, budget row validity, UTC period keys, the one fixed counter lock order, lease constants |
| `intelligence-execution-control.service.ts` | `admit` (G0 to G4 and the atomic four-counter reservation), `claim`, `revalidateBeforeDispatch`, `settle`, `sweepExpired`, and the generic `runWithReservation` wrapper. No caller exists |
| `intelligence-reservation-maintenance.service.ts` | scheduled sweeper (advisory lock, unref'd timers, `AI_RESERVATION_SWEEP_DISABLED` off switch) and a read-only counter audit |
| `intelligence.service.ts` | the 004a `evaluateExecutionEligibility` is removed (superseded by `admit`); `finalizeExecution` takes money through the bigint boundary |
| `tenant-scope.ts` | `AiProviderBudgetCharge` added (it has a `tenant_key`) |
| `validate-ai-prov-provider-execution-eligibility.cjs` | rewritten for the new structure, with 18 mutation tests and 6 governed-source tests proving each rule fires |
| CI | one new step runs the real-PostgreSQL test in `backend-tests` |

## 3. Behaviour against the design

| Design rule | Implemented as |
|---|---|
| Authority `G0 AND G1 AND G2 AND G3 AND G4`, DENY on false, missing, unreadable, expired or malformed | `admit` evaluates in that order; a thrown read is `control_unreadable`; a missing platform row is `platform_control_missing` |
| Deploy flag ON only for the exact word `true` | `parseDeployFlag`, read on every call, never cached |
| Instant, uncached kill switch | `ai_platform_controls` row read per call, at admission and again before dispatch |
| Re-validate every mutable control before dispatch | `revalidateBeforeDispatch` re-reads flag, platform control (kill, enabled, allow-list, provider and model pin, request cap), tenant policy, every charged budget window, claim token and lease |
| `reserved -> dispatching -> reconciled / cancelled / expired` | compare-and-set `updateMany` on the current status; counters change in the same transaction |
| Claim arbitrates dispatch | `claim` is a compare-and-set on `status = reserved` and an unexpired reservation; losers get `duplicate_in_flight` |
| Exactly-once settlement | status compare-and-set; a repeat is a no-op, a different second `actual` is reported as `reconcileConflict` and never applied |
| Four counters, fixed lock order | platform month, platform day, tenant month, tenant day, always; all four fit or the transaction rolls back |
| Billing rule | usage reconciles; confirmed non-billable and pre-dispatch failures release; timeout, 5xx and ambiguous settle at the reserved estimate |
| Zero defaults | no budget row seeded, every limit and `max_request_cost_micros` default `0`, the control row seeded `enabled=false, kill_switch=true`, empty allow-list |
| BIGINT, decimal strings on every boundary | `bigint` inside; admission results carry strings; `JSON.stringify` of a result is tested |
| Sweeper works under forced RLS | an explicit, transaction-local, SELECT-only maintenance marker (section 3a), proved with a role that is neither superuser nor BYPASSRLS |
| Late result and crash recovery | leases on `reserved` and `dispatching`; admission sweeps first; a scheduled sweeper covers a quiet system; a late result cannot settle an `expired` reservation |

### 3a. Sweeper and audit under forced row level security

The budget tables use `FORCE ROW LEVEL SECURITY`. A connection with no tenant context sees only the `default` tenant, so a scheduled sweeper that looks across tenants would silently miss every other tenant's expired reservations unless it relies on the database role happening to own the table or bypass RLS. That reliance is not acceptable, so it is replaced by an explicit path:

- The migration adds one **SELECT-only** policy per table (`ai_maintenance_read_<table>`) that applies when the transaction-local setting `app.ai_maintenance` is `on`. No marker value can insert, update or delete.
- The sweeper's tenant discovery and the counter audit run inside one transaction that sets the marker with `set_config('app.ai_maintenance', 'on', true)`. The final argument makes it transaction-local, so it never leaks to the pooled connection.
- Every state change still goes through the tenant-scoped client, one tenant at a time. Discovery only reads which tenants have expired work.
- The validator pins this: the policy is SELECT-only, the marker is set only in the maintenance service and only transaction-locally, and nothing else in the module mentions it.

**Proof against the deployed role model.** The deployed role's attributes are not visible from here, so the test does not assume them. The integration test creates a role `ai_rls_probe` that is `NOSUPERUSER NOBYPASSRLS` and does not own the tables, and runs **every service under test as that role** (the admin connection does setup and inspection only). It asserts the role flags and that RLS is enabled and forced, then shows: with no tenant context the role sees none of another tenant's reservations; inside the maintenance transaction it sees reservations across tenants but an UPDATE or DELETE on another tenant's rows affects 0 rows; the marker does not outlive its transaction; and the scheduled sweeper then cancels both tenants' expired reservations and the audit runs clean.

Mutation checks: with the sweeper's marker switched off, `recovery`, `rls`, `integrity` and the final audit fail (the sweeper is blind under RLS, and the audit reports false drift); with a write-capable maintenance policy added to the database, `rls` fails.

### Deviations from the design text (for reviewers)

1. **`max_tenants` is replaced by `allowed_tenant_keys`.** The design capped how many tenants hold a live budget. Counting that needs a cross-tenant read, which tenant-scoped access cannot do. An explicit tenant allow-list on the platform control row is the stronger control and matches the rollout rule "explicit tenant allowlist". Empty means no tenant.
2. **Admission is idempotent while a reservation is unclaimed.** The design said an existing reservation for the same key returns DENY. Returning `ALLOW` with the same reservation id for an unclaimed, unexpired reservation lets a redelivered job recover without waiting for the TTL, and is safe because only the claim compare-and-set can dispatch. After a claim, admission denies with `reservation_in_flight`; after settlement, `reservation_settled`. The integration test shows six concurrent identical admissions produce one reservation, one charge, and exactly one winning claim.
3. **The circuit-breaker check is not implemented.** There is no provider and therefore no breaker; it belongs to 004b-ii with the adapter.
4. **Run statuses.** The wrapper reports `denied`, `duplicate_in_flight`, `provider_disabled`, `completed`, `result_discarded` and `work_threw`. Mapping those onto the persisted `AiExecution` statuses is part of the adapter increment, because nothing persists an execution from this path yet.

## 4. Verification

All results are from this change set, run on 2026-10-05.

```text
Prisma client regenerated from the new schema; prisma migrate deploy applied all migrations to a clean PostgreSQL 16.
Realistic-state migration check, repeated on the final migration (including the maintenance policies): rows seeded in the 004a shape (an ai_executions row at 2147483000 micros, a budget
policy at 2000000000, a reserved reservation), then migrated. Values preserved, types now bigint, status and
attempt defaults correct, control row seeded deny-all, platform periods empty.

node apps/api/test/integration/ai-provider-budget-lifecycle.test.cjs   (real PostgreSQL 16, services run as a NOSUPERUSER NOBYPASSRLS role, also with CI=true)
  PASS gates: every default denies, each gate fails alone, healthy request is allowed and charges four counters
  PASS money: limits and costs above 2^31 are stored and settled exactly as BIGINT
  PASS atomicity: concurrent admissions never exceed a counter (spend, request limit, platform), at exact boundaries
  PASS idempotency and claim: duplicate admission shares one reservation, and exactly one claimant wins
  PASS lifecycle: every transition has the exact counter effect and settles exactly once
  PASS recovery: leases expire, sweepers are idempotent and concurrent-safe, late results are discarded
  PASS pre-dispatch re-validation and the guarded run
  PASS isolation: another tenant cannot claim, settle or affect a reservation
  PASS rls: the services run as a role subject to forced RLS, and the sweeper uses an explicit read-only maintenance path
  PASS integrity: the counter audit is clean after a randomised concurrent workload, and detects injected drift
  PASS final counter audit is clean
  PASS zero Product and AiSuggestion writes

Jest: tenant-scope, intelligence service/module/controller/registry, FAST harness, scorers, payload policy, secret
detection, money, gates, control service: 12 suites, 400 tests, all pass.
All validate-ai-*.cjs validators and their tests: pass.
check-unsafe-raw-comments: pass.   verify-tenant-rls: pass (ai_provider_budget_charges discovered, no missing policies).
```

**Post-claim fail-closed and monotonic settlement.** If the kill switch or any control fails the re-check after the claim, the reservation is `cancelled` and released, the work never runs, a later claim returns `not_reserved`, the same attempt cannot be admitted again (`reservation_settled`), and three rounds of repeated cancel, reconcile and sweep attempts leave all four counters byte-for-byte unchanged. If the cancel itself fails after a failed re-check, the failure surfaces, the work still never runs, the reservation stays `dispatching` so no second dispatcher can claim it, and the lease expiry settles it as `expired` at the reserved estimate. A timeout or ambiguous dispatch therefore always ends conservatively settled, and no terminal state ever changes counters twice.

**Mutation check of the integration test.** To prove the test detects a broken implementation, defects were injected and each was caught:

| Injected defect | Result |
|---|---|
| remaining-budget predicate removed from the conditional UPDATE | `atomicity` and `recovery` fail |
| claim without the `status = reserved` compare-and-set | `idempotency and claim`, `lifecycle`, `recovery`, `re-validation`, `integrity` fail |
| settlement without the status compare-and-set | `lifecycle`, `recovery`, `re-validation`, `integrity` fail |
| sweeper without the maintenance marker | `recovery`, `rls`, `integrity`, final audit fail |
| a write-capable maintenance policy in the database | `rls` fails |

**Static checks (validator).** 0 provider SDK imports, 0 network calls, 0 provider credentials, 0 Product mutations, 0 AutoSuggestions references, 0 suggestion writes, 0 routes in the control plane, 0 unlisted environment reads (the allow-list is the deploy flag and the sweeper off switch), 0 conversions of money to a JavaScript number, no global `BigInt` patch, platform tables writable only by operators, and no caller of the control plane outside the intelligence module. Finding: the 004a validator's network check ended in a `\b` after `(`, which can never match, so it could not have fired. The rewrite uses a correct pattern and a negative test proves it.

Type-check: `tsc` reports only the five pre-existing errors in `common/security/pinned-undici-transport.ts`, caused by the `undici` module missing from this machine's borrowed `node_modules`. CI is authoritative for the build.

## 5. Rollback and forward fix

- Widening to `BIGINT` loses nothing and old readers are unaffected until a value exceeds 2^31 - 1, which cannot happen before a budget is configured. No rollback of the type change is needed.
- The new tables and columns are additive. Before any reservation exists they can be dropped. After reservations exist, reconcile or cancel them first (`sweepExpired`, then the counter audit).
- The status CHECK is a superset; the key widening is safe because the 004a table is empty and `attempt_number` defaults to 1.
- `ai_executions` may hold fixture-path rows. The `ALTER ... TYPE BIGINT` rewrites that small table under a short exclusive lock. Pre-flight: `SELECT count(*) FROM ai_executions`.

## 6. Operator facts

The kill switch is one statement and takes effect on the next admission and on the pre-dispatch re-check of anything already admitted:

```sql
UPDATE ai_platform_controls SET kill_switch = true, updated_by = '<operator>', updated_at = NOW() WHERE id = 'global';
```

The seeded state is `enabled = false, kill_switch = true`, no provider, no model, no tenant, request cap `0`, and there are no platform budget rows. Enabling is a gated change recorded per section 11 and 12 of the design; it is not part of this increment.

## 7. Risks and open items

- **Platform counters are a hot row.** Every admission serialises on the platform day and month rows. That is intended at concurrency 2 and is what makes the platform ceiling exact.
- **Scale trigger (recorded now).** Revisit the platform day and month hot-row serialisation before horizontal provider-worker scaling, or before materially higher sustained provider concurrency than the pilot's 2. Keep the fixed lock order when doing so.
- **Sweeper under RLS** is no longer an assumption: see section 3a.
- **No caller exists.** `runWithReservation` is exercised only by tests. Nothing in the product, queue or any route calls it.
- **Not authorised by this change:** a real provider call. That stays blocked on AI-POL-003 Security sign-off, the Privacy decisions from #1170, provider and model approval, a human-provisioned credential and provider-side cap, flags-default-OFF proof, kill-switch proof and lifecycle proof.

## 8. Review gate

| Reviewer | Decision needed |
|---|---|
| CTO / Architecture | the state machine, the four-counter lock order, the three deviations in section 3 |
| SRE / Backend | lease and TTL numbers, the sweeper, the platform control row, the hot-row trade-off |
| Security | the platform control row as the kill switch, the credential-free and network-free proof, platform tables writable only by operators |
| QA / Evaluation | the real-PostgreSQL suite and the mutation results |
| FinOps | nothing is configured by this change; the pilot envelope is applied later by an operator |
| Migration review | the BIGINT widening of `ai_executions` and the new key |

Size: this change is larger than the default 2,500-line scope bound because the migration, the control service and its real-PostgreSQL proof are one cohesive unit that was verified together. It needs the `cto-large-pr-approved` label, and the `cto-required-team-approved` label for the migration and workflow files. Labels are added by a human and need a new push to take effect.
