# AI-PROV-004b Design: controlled provider boundary behind flags

Date: 2026-10-05
Baseline: `origin/main` at `cb77bbdf` (includes AI-PROV-004a, #1175)
Type: **design only. No provider SDK, no credentials, no network call, no schema change, no code.** Nothing in this document authorises a real outbound call. Merging this document authorises 004b *implementation* to begin, and nothing more (section 12).

## 0. Summary of decisions

| Topic | Decision proposed here |
|---|---|
| Gates | Five independent gates, evaluated at admission and again immediately before dispatch. Every default is OFF/DENY; missing, malformed or unreadable configuration is DENY |
| Kill switch | Three layers. The fast one is a **DB-backed platform control row read on every call, never cached**; environment variables are deploy-time only because changing one restarts the single API replica |
| Reservation | Add a claim step. `reserved -> dispatching -> reconciled \| cancelled \| expired`. Reservation key becomes `(tenant, fingerprint, attempt)`. Counters and status change in the same statement or transaction |
| Crash recovery | Lease on every non-terminal state. The next admission sweeps expired reservations first, so nothing can hold budget indefinitely and no scheduler is needed |
| Authority | `deploy flag AND platform control AND tenant policy AND capability/provider pin AND budget = ALLOW`. Any `false`, missing, unreadable, expired or malformed value is DENY. Every mutable control is **re-evaluated immediately before dispatch**, not trusted from admission (2.4) |
| Budget | Four counters charged atomically per call (tenant day, tenant month, platform day, platform month) plus a per-request cap. **Zero default for every tenant**; the pilot envelope is explicit configuration, never a database default (3.7) |
| Money | `BIGINT` for every `*_micros` column (the three budget columns, the reservation columns, and `ai_executions`). `bigint` internally, decimal **strings** on every serialisation boundary |
| Guards | Replace the blanket prohibition with a zone rule: one directory may contain the network client, and everything else stays forbidden. SDK imports stay forbidden everywhere (plain `fetch`) |
| Mutation | The adapter returns governed output to the existing validator and nothing else. No Product write, no AutoSuggestions, no canonical write, no public route, and in 004b **no product code path calls the orchestrator at all** |
| Split | Implement as two PRs: **004b-i** lifecycle, `BIGINT` and gates (still zero network code), then **004b-ii** adapter zone and guard transition (flag OFF, no key, no tenant data) |

## 1. What 004a left open (review of `cb77bbdf`)

These are properties of the code on main, found by reading `evaluateExecutionEligibility` and the migration. Each is closed by a section below. None is a security regression: 004a is controls only and nothing calls a provider.

| # | Finding | Why it matters once a provider exists | Closed in |
|---|---|---|---|
| F1 | An existing `reserved` reservation with the same fingerprint returns `ALLOW` again | Two workers, or a redelivered queue job, both get `ALLOW` for one reservation and both call the provider: double spend against a single reservation | 3.2 claim step |
| F2 | A `budget_blocked` reservation is unique per `(tenant, fingerprint)` and is returned as `budget_exhausted` forever | A legitimate retry after the budget is raised, or in a new period, is permanently denied | 3.4 key |
| F3 | No transition out of `reserved`: no reconcile, cancel or expire, and `request_count` is never decremented | Budget leaks on every failure and crash; the ceiling shrinks to zero over time | 3.1, 3.3 |
| F4 | `platformProviderExecutionEnabled` and `platformKillSwitchEnabled` are inputs, not read from anywhere | There is no real flag and no real kill switch yet | 2 |
| F5 | The caller supplies `budgetPeriodKey` | A caller error or tampering selects the wrong period | 3.6 |
| F6 | `*_micros` are `Int` (32-bit, about USD 2,147.48) | Overflow or a rejected write on a legitimate monthly budget, and an expensive retrofit after data exists | 4 |
| F7 | Atomicity is shown with mocks only | A concurrency guarantee that no test exercised against a real database is not a guarantee | 3.5, 10 |
| F8 | No platform-wide ceiling, only per-tenant | Total exposure is unbounded as tenants are added | 3.7 |

## 2. Flags, kill switch and gates

### 2.1 Gates

Provider execution happens only if **all five** pass. They are evaluated in this order so the cheapest and most global checks run first, and a denial records the first gate that failed.

| # | Gate | Source of truth | Default | Read |
|---|---|---|---|---|
| G0 | Platform deploy flag `FEATURE_INTELLIGENCE_PROVIDER_ENABLED` | environment, repo `FEATURE_*_ENABLED` convention | OFF | per call (never cached at module load) |
| G1 | Platform control row | DB table `ai_platform_controls` (section 2.3) | `enabled = false`, `kill_switch = true` | per call, **uncached**, at admission and again before dispatch |
| G2 | Tenant policy | `AiTenantPolicy` (exists): `status = active`, `intelligenceEnabled`, `providerExecutionEnabled`, `killSwitchEnabled = false`, `tenantOptOut = false`, `approvedBy` and `approvedAt` present, positive `maxPayloadBytes` | `killSwitchEnabled = true`, `tenantOptOut = true` | per call, inside the admission transaction |
| G3 | Capability and provider | capability in the AI-001 registry **and** in a code-level live allow-list (one capability in 004b) **and** in the tenant `allowedCapabilities`; provider key in tenant `allowedProviderKeys` and equal to the approved provider/model pin | none allowed | per call |
| G4 | Budget | `AiProviderBudgetPolicy` plus an atomic reservation (section 3) | no row means DENY | per call |

```
G0 deploy flag  AND  G1 platform control  AND  G2 tenant policy  AND  G3 capability/provider pin  AND  G4 budget  =  ALLOW
```

The platform layers (G0, G1) are authoritative over tenant and provider settings: a tenant policy can narrow what the platform allows and can never widen it. A tenant that is fully enabled still gets `DENY` when G0 or G1 says no.

### 2.2 Strict parsing, fail closed

- G0 is ON only if the trimmed, case-insensitive value is exactly `true`. Unset, empty, `1`, `yes`, `on`, `TRUE ` with trailing junk, or any other string is OFF. This is stricter than some existing flags on purpose: an AI-spend lever must not be turned on by a typo.
- Any thrown or timed-out read of G1, G2 or G4 is `DENY` with reason `control_unreadable`. A database or Redis blip never fails open.
- An **expired** value is also DENY: a budget period past `period_ends_at`, a policy outside `effective_from`/`effective_until`, or a reservation lease that has lapsed.
- A malformed row (negative limit, `currency` not `USD`, `period_ends_at <= period_started_at`, unknown mode) is `DENY invalid_*`. 004a already does this for budget policy; 004b extends it to the platform control row.
- The result of the five gates is a closed union with no "unknown" member. The orchestrator `switch` is exhaustive and the default branch denies.

### 2.3 Kill switch: why a DB row

Changing a Railway variable normally triggers a redeploy (**to be confirmed by SRE**), and the API is one replica, so a variable change restarts everything: core PIM, imports and sessions included. That is not an acceptable emergency lever for an optional feature and it violates the runbook rule that a kill switch must not disrupt core PIM. The options considered:

| Option | Speed | Disrupts core PIM | New surface | Verdict |
|---|---|---|---|---|
| Environment variable | minutes, restarts replica | yes | none | deploy-time only (G0) |
| Bulk `UPDATE ai_tenant_policies SET kill_switch_enabled = true` | instant | no | none | kept as the **tenant** layer (G2); fine for one allow-listed tenant, awkward at scale because RLS forces tenant-by-tenant writes |
| Redis key | instant | no | depends on Redis availability; the queue can fall back to memory mode, where a key cannot be a shared source | rejected |
| **DB platform control row** | instant, one primary-key read per call | no | one small table | **chosen** |

`ai_platform_controls` (single row, `id = 'global'`, no `tenant_key`, written by operators and never by an API route):

```
enabled           boolean  NOT NULL DEFAULT false
kill_switch       boolean  NOT NULL DEFAULT true
allowed_provider  text     NULL      -- the one approved provider key; NULL means none
allowed_model     text     NULL      -- the one approved model id; NULL means none
max_tenants       integer  NOT NULL DEFAULT 0   -- operational cap, see 3.7
max_request_cost_micros bigint NOT NULL DEFAULT 0   -- per-request estimate cap; 0 denies everything
updated_by        text, updated_at timestamptz
```

The migration seeds the row with `enabled = false, kill_switch = true`. A missing row is `DENY`. One uncached primary-key read per AI call is negligible at this volume (a handful of calls, each seconds long). The table is not tenant-scoped, so it does not enter `TENANT_SCOPED_MODELS`; the implementation PR must check the repo's RLS coverage guard (`verify-tenant-rls.cjs` and `tenant-scope.spec.ts`) and record how a deliberately global table is exempted. Operator procedure and a drill are required before enablement (section 11).

### 2.4 Re-validation immediately before dispatch

Admission is a decision at one moment; controls are mutable. After the claim (3.2) and **before the network call**, the orchestrator re-reads and re-evaluates, in one pass, everything that can change:

| Re-checked | Condition to proceed |
|---|---|
| G0 | flag still exactly `true` |
| G1 | row readable, `enabled`, not `kill_switch`, and the requested provider and model still equal `allowed_provider` / `allowed_model` (the pin can change between admission and dispatch) |
| G2 | the tenant policy row re-read: still `active`, enabled, kill switch off, not opted out, approval present, provider and capability still allowed |
| G4 | every charged budget policy still `enabled`, inside its effective window, and not past its period end |
| Reservation | still `dispatching`, `claim_token` matches, lease not expired, and the lease leaves at least the request timeout |
| Circuit | still not open |

Any failure cancels and releases the reservation (3.1) with outcome `provider_disabled`, and no request is sent. The check reads fresh rows, never values captured at admission.

### 2.5 Kill-switch semantics (runbook alignment)

| When the switch becomes active | Outcome |
|---|---|
| before admission | `DENY platform_kill_switch` or `tenant_provider_disabled`, no reservation, no call |
| after admission, before dispatch | gates are re-read after the claim; reservation **cancelled and released**; no call; outcome `provider_disabled` |
| during a call | the call is not aborted from outside (billing may already have started). It ends by its own timeout at most 20 s later. The result is **discarded, not persisted as suggestions**; reservation reconciled at actual usage; execution `cancelled` with failure code `kill_switch_during_call` |
| existing suggestions | stay visible and reviewable (runbook) |

## 3. Reservation lifecycle and budget atomicity

### 3.1 State machine

`status` is `text` with a CHECK constraint today (`reserved`, `budget_blocked`, `reconciled`, `cancelled`). 004b-i replaces the CHECK with the set below.

```
                    admit (atomic conditional UPDATE)
   (no row) ───────────────────────────────────────────▶ reserved
        │ budget denied                                      │  claim (CAS, sets lease)
        ▼                                                    ▼
  budget_blocked  (terminal, denial record)             dispatching ───▶ reconciled  (result received)
                                                             │      ───▶ cancelled   (definitively not billable)
   reserved ──▶ cancelled   (gate re-check failed,           │      ───▶ expired     (lease ran out)
                              cancel, unclaimed TTL)         ▼
                                                        (terminal states never change)
```

| From | To | Trigger | Spend effect | `request_count` |
|---|---|---|---|---|
| (none) | `reserved` | admission passes all gates and all four conditional UPDATEs reserve (3.5) | `reserved_spend += estimate` on each charged counter | `+1` on each |
| (none) | `budget_blocked` | conditional UPDATE reserves nothing | none | none |
| `reserved` | `dispatching` | claim compare-and-set succeeds | none | none |
| `reserved` | `cancelled` | gate re-check fails, operator cancel, or unclaimed TTL expiry | `reserved_spend -= estimate` | `-1` (the provider was provably never called, because a call only happens after a claim) |
| `dispatching` | `reconciled` | provider returned a result, success or billed failure | `reserved_spend -= estimate`, `spent_spend += actual` | unchanged |
| `dispatching` | `cancelled` | definitive non-billable outcome (3.3) | `reserved_spend -= estimate` | `-1` |
| `dispatching` | `expired` | lease ran out, outcome unknown | `reserved_spend -= estimate`, `spent_spend += estimate` (conservative) | unchanged |

Rules that make the table safe:

1. Every transition is one `UPDATE ... WHERE id = $1 AND tenant_key = $2 AND status = $from RETURNING`. Zero rows means someone else already moved it: the caller re-reads and treats it as a no-op, never an error and never a second application of the spend effect.
2. The status change and the counter change happen **in the same transaction** with the counter update guarded on the same `RETURNING`. Status and counters cannot diverge on a crash.
3. `actual` is capped for accounting at the provider's reported usage, never at less than zero, and a reconcile whose `actual` exceeds the reservation is recorded in full (the overrun is real spend) and raises an alert; it is not truncated to the estimate.
4. **Invariant:** `reserved_spend_micros` equals the sum of `reserved_cost_micros` over reservations in `reserved` and `dispatching`, and `spent_spend_micros` equals the sum of settled costs. A read-only audit query (shipped with 004b-i, run by the operator drill and an alert, not run automatically as a repair) checks this and reports drift. Counters are never silently recomputed.

### 3.2 Claim step (closes F1)

Admission returns `ALLOW` plus a reservation id. The orchestrator then **claims**:

```
UPDATE ai_provider_budget_reservations
   SET status = 'dispatching', claimed_at = now(), lease_expires_at = now() + lease, claim_token = $token
 WHERE id = $id AND tenant_key = $tenant AND status = 'reserved'
RETURNING id
```

Only the caller that gets one row may call the provider. A redelivered job or second worker gets zero rows and stops with `duplicate_in_flight`. An admission that finds an existing reservation for the same key returns `DENY reservation_in_flight` (or the settled outcome), never a second `ALLOW`. The `claim_token` must be presented on reconcile and cancel, so a stale worker cannot settle a reservation that was reclaimed.

### 3.3 Settlement by outcome

**Principle: release a reservation to zero only when Vexa can prove that billable provider work did not occur. Otherwise reconcile from the provider's authoritative usage, or settle conservatively at the reserved estimate until authoritative usage exists.** Billing semantics depend on when a failure happens and on the provider, so there is no blanket "error means not billed" rule.

| Outcome | Terminal state | Spend |
|---|---|---|
| Failure before dispatch (gate re-check, circuit open, fingerprint mismatch, adapter unavailable, operator cancel) | `cancelled` | actual `0`, released |
| Local policy or validation rejection (classification, credential guard on input, schema check on the request) | `cancelled` | actual `0`, released |
| Provider returned authoritative usage or cost (success, refusal, invalid output, unsafe output) | `reconciled` | actual from provider usage |
| Provider **confirms** the request was rejected before inference or any billable work (for example an explicit authentication or request-validation rejection, documented by the provider as non-billable) | `cancelled` | `0`, released |
| Timeout, abort or connection loss after the request was sent | `expired` | billing **unknown**: settle at the **reserved estimate** |
| Provider 5xx or any other response that does not prove nothing was processed | `expired` | billing **unknown**: settle at the **reserved estimate** |
| Ambiguous provider failure | `expired` | settle at the **reserved estimate** |

An "unknown" settlement is provisional. If authoritative usage later becomes available (provider usage report or invoice line), an operator reconciliation may correct it downward; it is never corrected downward from an assumption. Which provider responses count as "confirmed non-billable" is an explicit allow-list in the adapter zone, set from the provider's billing terms and reviewed by FinOps and Privacy; anything not on the list is unknown. A rate-limit response (429) is on that list only if the provider's terms say so; until verified it settles at the estimate.

### 3.4 Reservation key and retries (closes F2)

- The unique key becomes `(tenant_key, request_fingerprint, attempt_number)`. The runbook requires retries to reuse the idempotency fingerprint, so the attempt number is what makes each billable attempt its own reservation. This also makes a `budget_blocked` row a record of one attempt, not a permanent verdict on the fingerprint.
- `AiExecution` stays one row per fingerprint (existing unique `(tenant_key, idempotency_fingerprint)`) and its `attempt_number` and `max_attempts` advance. `ai_provider_budget_reservations.execution_id` is set at claim.
- Each attempt re-runs **all five gates** and reserves again (a retry can bill again; runbook and 004 investigation section 6).
- A retry is permitted only for `timeout`, `rate_limited` and `upstream_5xx`, at most 2 attempts in total, with backoff and jitter, honouring `Retry-After` up to a 30 s cap. Never retried: `auth_failed`, `schema_invalid`, `input_not_allowed`, blocked or refused output, `output_rejected`, any budget denial, any kill switch, any circuit-open.
- A retry never starts while the previous attempt's reservation is `dispatching` and unexpired.

### 3.5 Atomic reservation (closes F7)

Authorisation reserves before any provider call. A call charges **four counters** and is subject to one **per-request cap**; all are reserved in one transaction, and if any one fails the whole transaction rolls back and nothing is reserved:

| Counter | Row | Key |
|---|---|---|
| tenant, day | `ai_provider_budget_policies` | tenant, capability, provider, mode, period `D:YYYY-MM-DD` |
| tenant, month | `ai_provider_budget_policies` | same scope, period `M:YYYY-MM` |
| platform, day | `ai_platform_budget_periods` (new, section 4) | period `D:YYYY-MM-DD` |
| platform, month | `ai_platform_budget_periods` | period `M:YYYY-MM` |

Per-request cap: the estimate must be at most `ai_platform_controls.max_request_cost_micros`, otherwise `DENY request_cost_exceeded` before any counter is touched.

Each counter uses the single-statement shape 004a introduced, which stays:

```
UPDATE <counter row>
   SET reserved_spend_micros = reserved_spend_micros + $est, request_count = request_count + 1, version = version + 1
 WHERE id = $id [AND tenant_key = $tenant] AND enabled
   AND request_count < request_limit
   AND reserved_spend_micros + spent_spend_micros + $est <= spend_limit_micros
RETURNING id
```

Row-level locking in PostgreSQL serialises concurrent updates to the same row and re-evaluates the predicate against the new value, so two workers cannot both pass the same remaining-budget check. To rule out deadlock the four updates always run in one fixed order (platform month, platform day, tenant month, tenant day). The platform rows are a deliberately hot spot: every admission serialises on them, which is acceptable at the planned concurrency of 2 and is what makes the platform ceiling exact rather than approximate.

The reservation records every counter it charged (a child `ai_provider_budget_charges` table, one row per counter with the amount). Settlement reverses **exactly** those rows, never recomputes them, so a period rollover or a changed policy cannot misdirect a release.

This is **proven against a real PostgreSQL** in the `backend-tests` job, which already runs `postgres:16` and `prisma migrate deploy` (section 10), not with a mocked Prisma client. Exact-boundary behaviour (`reserved + spent + est == limit` passes, one micro over fails) is part of that test, for each of the four counters.

### 3.6 Period handling (closes F5)

Period keys are derived on the server from the UTC clock: `D:YYYY-MM-DD` and `M:YYYY-MM`. They are never accepted from the caller. A call needs **both** the tenant day and tenant month rows and **both** platform rows to exist, be enabled and be inside their window; a missing row, such as an unconfigured next period, is `DENY` and fails closed. Settlement acts on the rows recorded in the charges table even if the period rolled over meanwhile.

### 3.7 Budget envelope and zero defaults (closes F8)

**No tenant has a non-zero budget by default.** The schema and migrations create no budget rows, `spend_limit_micros`, `request_limit` and `max_request_cost_micros` default to `0`, and `enabled` defaults to `false`. A migrated or new tenant therefore has `provider execution enabled = false` and `budget = 0` and is DENY until an operator explicitly configures it. Numbers below are **pilot configuration applied by a recorded operator procedure**, never a column default, a seed or a code constant.

Initial hard ceilings for the first internal live-provider phase (proposed by the programme review; operational safety caps, not economic targets; FinOps owns them):

| Control | Initial hard ceiling |
|---|---:|
| Single request, estimated cost | USD 0.25 |
| Per pilot tenant, per day | USD 5 |
| Per pilot tenant, per month | USD 25 |
| Platform, per day | USD 20 |
| Platform, per month | USD 100 |

`ai_platform_controls.max_tenants` additionally caps how many tenants may hold an enabled live budget, and a **provider-side spend cap** in the provider console, set lower than the platform monthly ceiling, is the backstop independent of Vexa code (the mechanism and its enforcement behaviour must be verified before relying on it; a human step).

These are replaced with data-derived limits after roughly the first 100 to 200 legitimate provider executions, once cost telemetry exists: normal request cost, P50, P95, P99, cost per accepted suggestion and cost per SKU. 004b-i needs no model pricing; it only needs to represent and enforce limits safely.

### 3.8 Crash recovery and expiry

Every non-terminal state has a lease. No reservation can hold budget indefinitely.

| State | Lease | When it lapses |
|---|---|---|
| `reserved` (unclaimed) | `expires_at = created_at + 15 min` (admission-to-dispatch TTL, tune with SRE) | the worker died or the job was dropped before dispatch: `cancelled`, released, `request_count` decremented (the call provably never happened) |
| `dispatching` | `lease_expires_at = claimed_at + 20 s timeout + 60 s grace` | the worker died mid-call or lost the response: `expired`, settled at the estimate, flagged for operator review. The sweeper never retries. A queue-level retry, if permitted by 3.4, creates a new reservation |

**Who sweeps.** No scheduler is required. Every admission first sweeps expired reservations that charge the counters it is about to use (bounded, at most 20 per call, same compare-and-set transitions, so concurrent sweepers are safe). There is also an explicit `sweepExpiredReservations` method for tests and the operator drill. If nothing is being admitted, nothing is consuming the budget, so a lingering row is harmless. An alert fires on the age of the oldest non-terminal reservation (over 15 minutes), so a stuck row is visible even without traffic.

**Future requirement (recorded now).** Sweeping on admission is acceptable only for the initial low-volume internal rollout. Before meaningful production scale, or before any trigger from product flows exists, a **scheduled sweeper or watchdog** is required, so a quiet system cannot leave reservations unresolved until the next request. It is a precondition for the increment that adds the first caller, and it reuses the same compare-and-set transitions, so it adds no new correctness rules.

**Late result.** If a result arrives after the sweeper expired its reservation (the claim compare-and-set no longer matches), it is **discarded** (`result_discarded`), not persisted as suggestions, the spend stays settled at the estimate, and an alert fires. Because the lease is longer than the timeout, this should be rare.

**Duplicate reconciliation.** A second reconcile or cancel finds the status already terminal (zero rows). It is a no-op returning the first outcome. If the second call's `actual` differs from the recorded one, a `reconcile_conflict` event is logged (not applied) so that a defect is visible.

## 4. Money: `BIGINT` decision

Adopted as recommended, **before** any real usage. Every `*_micros` column becomes `BIGINT`:

| Table | Columns |
|---|---|
| `ai_provider_budget_policies` | `spend_limit_micros`, `reserved_spend_micros`, `spent_spend_micros` |
| `ai_provider_budget_reservations` | `requested_estimated_cost_micros`, `reserved_cost_micros`, `actual_cost_micros` |
| `ai_executions` | `estimated_cost_micros`, `actual_cost_micros` |
| `ai_platform_budget_periods` (new) | `spend_limit_micros`, `reserved_spend_micros`, `spent_spend_micros` (platform day and month counters; not tenant scoped, `limit` defaults to `0`, no rows seeded) |
| `ai_provider_budget_charges` (new, tenant scoped) | `amount_micros` (one row per counter a reservation charged) |
| `ai_platform_controls` (new) | `max_request_cost_micros` |

`request_limit`, `request_count`, token counts and `duration_ms` stay `INTEGER`.

- **Migration safety.** The two 004a tables are empty (created in `20261005003000`, no code path writes them), so `ALTER COLUMN ... TYPE BIGINT` is instant. `ai_executions` may hold rows from the fixture path; the migration has a pre-flight `SELECT count(*)` recorded in the PR and the rewrite takes a short exclusive lock on a small table. Forward fix if it fails: the change is value-preserving and re-runnable. Rollback is not required: widening a column loses nothing, and old code reading it is unaffected until it overflows.
- **Sanity ceiling.** Add `CHECK (spend_limit_micros <= 1000000000000)` (USD 1,000,000) so a dollars-vs-micros unit error cannot create an absurd limit.
- **Arithmetic is `bigint` end to end.** Prisma maps the columns to `bigint`. Cost is computed in `bigint` from token counts and a pinned integer price table (micros per million tokens), with ceiling division, so no floating point is involved. `Number(x)` on a money value is forbidden outside a display helper that first checks `Number.isSafeInteger`.
- **Serialisation is deliberate.** `JSON.stringify` throws on `bigint`, and a global `BigInt.prototype.toJSON` patch is **forbidden** because it hides unsafe conversions. Every API response, log field, metric label source, audit payload and fixture serialises money as a **decimal string** (`"12500"`). Parsing a string into `bigint` rejects anything that is not `^[0-9]+$`.
- **Input boundary.** Existing callers pass `number`. The boundary accepts `bigint`, a decimal string, or a `number` only if `Number.isSafeInteger(n) && n >= 0`, and converts to `bigint` immediately.
- **Currency.** `USD` only in 004b. Any other currency is `DENY`.
- **Pricing.** The price table is versioned (`pricingVersion`) and pinned from the provider's pricing page at implementation time, not copied here. An unknown model has no price and is `DENY`.
- **Estimate.** Worst case before the call: input tokens bounded above by the UTF-8 byte length of the serialised request plus a fixed template overhead (a token is at least one byte, so this over-estimates and never under-estimates), plus the configured `max_tokens` output cap, priced at the pinned rates. The over-estimate is accepted; with a small ceiling it errs toward denying.

## 5. Guard transition

Today the AI-SEC-001 validator forbids, in every governed AI file, SDK imports, `new Anthropic`-style instantiation, the literal `ProviderAdapter`, and `fetch(` and similar calls, "in this guard stage". `module.spec.ts` and two other validators forbid provider names and `fetch(` in the service, module and controller. The change is a **zone rule**, not a deletion.

| Rule | Before | After 004b-ii |
|---|---|---|
| Provider SDK imports (`@anthropic-ai/sdk`, `openai`, and the rest of the list) | forbidden in all governed files | **still forbidden everywhere**, including the zone. Plain `fetch`, no SDK. If Security later chooses an SDK, that exact package name is added to a zone-only allow-list in a separate reviewed change |
| `fetch(` and other outbound calls | forbidden in all governed files | forbidden everywhere **except one directory**, the live adapter zone `apps/api/src/intelligence/live/` |
| Provider client names and `new X()` | forbidden everywhere | forbidden everywhere except the zone |
| Literal `ProviderAdapter` | forbidden (the Vexa-owned `IntelligenceProviderAdapter` is already carved out) | unchanged |
| Service, module, controller, FAST harness | no provider name, no `fetch(` | **unchanged**: still forbidden. The service reaches the adapter only through an injected interface |
| Product, Catalog, Quality, AutoSuggestions imports, `@Post/@Patch/@Put/@Delete`, Product mutation | forbidden | **unchanged** |

Positive checks that apply to the zone, enforced by the SEC-001 validator and mirrored by a spec:

1. Exactly one file in the zone contains `fetch(`, and the URL argument is a `const` string literal for the single approved HTTPS host, never a variable or a template.
2. The call sets `redirect: "error"`, uses an `AbortSignal` with the configured timeout, and has no retry loop. Retries belong to the orchestrator because each needs a new reservation.
3. The zone imports no Prisma, no Nest `Injectable` dependency on the service, and nothing from Product, Catalog, Quality or AutoSuggestions. It is a pure function from request to response.
4. The zone reads the provider key only through one credential-source function, which returns nothing when the variable is unset. An unset key is `adapter_unavailable`, a fail-closed result. The key is never logged and never placed in a thrown message.
5. The zone does not log, stringify or throw the request body or the provider response body. Only normalised error classes and codes leave it.
6. The FAST harness and every `*.spec.ts` outside the zone never import the zone (checked by an import-graph validator), so FAST can never reach a live adapter.
7. A CODEOWNERS entry on the zone directory requires Security review.

**Wiring.** The existing token `INTELLIGENCE_PROVIDER_ADAPTER` stays bound to the fixture adapter (so `runFixtureAdapterContract` and FAST are untouched). The live adapter gets a **separate token** and a separate orchestrator method; it is never bound to the fixture token. Before 004b-ii, the orchestrator in 004b-i is tested against a test double of the same interface.

## 6. Failure semantics

Every outcome has a Vexa-owned status. Provider-specific errors never leave the adapter; they are normalised by the existing boundary (`IntelligenceAdapterErrorClass`). "Called" is the recorded `providerCallAttempted`.

| Outcome | Run status | `AiExecution` status / failure class | Reservation | Called | Retry | Suggestions |
|---|---|---|---|---|---|---|
| Platform flag off | `provider_disabled` | none recorded, metric only (the feature is dormant; no write amplification) | none | no | no | no |
| Platform or tenant kill switch before admission | `provider_disabled` | `provider_disabled` / `provider_disabled`, code names the gate | none | no | no | no |
| Tenant policy, capability or provider denied | `payload_blocked` (existing) | `blocked` / `tenant_policy_blocked` | none | no | no | no |
| Payload classification or credential block (existing) | `payload_blocked` | `blocked` / `classification_blocked` | none | no | no | no |
| Budget denied or exhausted | `provider_disabled` | `budget_blocked` / `budget_exhausted` | `budget_blocked` row | no | no | no |
| Circuit open | `provider_disabled` | `provider_disabled` / `provider_disabled`, code `circuit_open` | none (checked before reserving) | no | no | no |
| Fingerprint mismatch in the adapter | `adapter_blocked` | `blocked` / `redaction_failed`, code `input_not_allowed` | `cancelled` | no | no | no |
| Kill switch between admission and dispatch | `provider_disabled` | `provider_disabled` | `cancelled` | no | no | no |
| Kill switch during the call | `result_discarded` | `cancelled`, code `kill_switch_during_call` | `reconciled` (actual) | yes | no | **discarded** |
| Timeout (20 s) | `adapter_failed` | `timed_out` / `provider_timeout` | `expired` (estimate) | yes | yes, if attempt < 2 | no |
| Rate limited (429) | `adapter_failed` | `failed` / `provider_rate_limited` | `cancelled` only if on the confirmed non-billable list (3.3), otherwise `expired` (estimate) | yes | yes, honouring `Retry-After` | no |
| Auth failure (401/403) | `adapter_failed` | `failed` / `provider_auth_error` | `cancelled` if on the confirmed list, otherwise `expired` (estimate) | yes | **no**; opens the circuit and alerts | no |
| Provider 5xx | `adapter_failed` | `failed` / `provider_5xx` | `expired` (billing unknown, estimate) | yes | yes, if attempt < 2 | no |
| Provider refusal or blocked finish | `adapter_blocked` | `failed` / `unsafe_output` or `provider_schema_invalid` per cause | `reconciled` (actual) | yes | no | no |
| Output invalid for the schema or evidence | `output_rejected` | `failed` / `provider_schema_invalid` | `reconciled` (actual) | yes | no | no |
| Output carries a credential shape (guard) | `output_rejected` | `failed` / `unsafe_output` | `reconciled` (actual) | yes | no; alert on any | no |
| Unknown `finishStatus` | `adapter_status_invalid` | `failed` / `internal_error` | `cancelled` or `expired` by whether a request was sent | per record | no | no |
| Operator cancel before dispatch | none | `cancelled` | `cancelled` | no | no | no |
| Crash before claim | none | execution left `queued` then closed by the sweeper | `cancelled` (TTL) | no | per queue | no |
| Crash after claim | none | closed by the sweeper | `expired` (estimate) | unknown, counted as yes | per queue, new reservation | no |
| Late result after expiry | `result_discarded` | unchanged | stays `expired` | yes | no | **discarded** |
| Duplicate delivery or reconcile | no-op | unchanged | unchanged | no | no | no |

Where this document names a run status the existing code does not have (`provider_disabled`, `result_discarded`), 004b-i adds it to the closed union. The existing statuses and their meaning do not change. No failure path persists a suggestion, writes a Product, or throws a raw provider message to a caller.

## 7. No mutation boundary

After 004b a live adapter still terminates at governed output.

```
orchestrator ─▶ gates + reserve + claim ─▶ adapter (HTTP, zone only)
                                              │ IntelligenceAdapterResponse
                                              ▼
             existing validateStructuredOutputForSuggestions (+ credential guard)
                                              │ validated suggestions (in memory)
                                              ▼
                          existing governed suggestion path (unchanged)
```

- No Product, Catalog, Quality or AutoSuggestions import anywhere in `apps/api/src/intelligence`, and no write route (all existing guards stay, section 5).
- `canonicalProductMutationEnabled: false` stays a literal in every result type.
- **No caller in 004b.** The orchestrator is a service method with no controller, no queue consumer and no product-flow call site. Its only callers are tests and the 004c FULL-mode runner. A queue job and a trigger from product flows are separate, later, individually reviewed increments. This is the narrowest possible blast radius and means that even a flag turned on by mistake has nothing to run.
- Suggestions produced from provider output enter the same review path as any suggestion (`pending_review`, human accept or reject). Nothing is applied automatically.

## 8. Observability

One structured log event per execution outcome, plus metrics and alerts. Correlation uses the existing `correlationId` carried on the request.

| Field | Source |
|---|---|
| `correlationId`, `tenantKey`, `capability`, `attemptNumber` | request |
| `executionId`, `reservationId` | records |
| `providerKey`, `modelKey`, `modelVersion`, `providerRegion`, `providerRequestId` | adapter response |
| `gate` (the first gate that denied, or `none`) | orchestrator |
| `providerCallAttempted` (true or false) | adapter response and record |
| `estimatedCostMicros`, `actualCostMicros`, `costSource`, `pricingVersion`, `currency` | usage, **as decimal strings** |
| `latencyMs`, `finishStatus`, `normalizedErrorClass`, `normalizedErrorCode`, `retryable` | adapter response |
| `reservationOutcome` (`reconciled`, `cancelled`, `expired`, `budget_blocked`) | settlement |

**Never logged, in any log, metric, error message, audit row or thrown exception:** the prompt or any part of it, the request payload, the provider response body, the provider key or any header, product field values, or tenant secrets. The existing hash-only storage rule holds (`allowRawPayloadStorage` is forced false).

Metrics (mapped onto the repo's existing metrics and logging facility; the implementation PR names it, and no new vendor is introduced): provider calls by outcome, latency histogram, cost micros, reservations by terminal state, oldest non-terminal reservation age, budget utilisation, circuit state, `unsafe_output` count, `result_discarded` count, `reconcile_conflict` count, gate denials by gate.

Alerts: any `unsafe_output`; circuit open; any auth failure; budget over 80%; oldest non-terminal reservation older than 15 minutes; any `reconcile_conflict` or `result_discarded`; counter-drift audit non-zero; `actual` greater than the reservation.

## 9. Execution limits (inherited, restated for review)

Concurrency cap 2 (in-process semaphore; the API is one replica with a 400 MB heap). Timeout 20 s per attempt. At most 2 attempts. In-process circuit breaker per provider (closed, open, half-open); opening yields `provider_disabled`, not an error storm. Thresholds are proposals for SRE and are tuned from 004c latency data. An output `max_tokens` cap is set and recorded.

## 10. Test and failure matrix (QA)

004b-i (no network code exists yet; the adapter is a test double of the same interface):

| Area | Cases |
|---|---|
| Gates | each of G0 to G4 failing alone gives DENY and zero calls and the right status; all pass gives ALLOW; unset, empty and garbage G0 values are OFF; G1 row missing, unreadable (injected error) or malformed is DENY; G2 default policy is DENY |
| Money | `bigint` round trip; a value above `2^31` stores and reads; a string above `Number.MAX_SAFE_INTEGER` is exact; `JSON.stringify` of a result containing money does not throw and shows strings; the unit-error CHECK rejects an absurd limit; non-safe-integer `number` input is rejected |
| Atomicity (**real PostgreSQL**, `backend-tests`) | N concurrent admissions against a budget that fits exactly K: exactly K reserve and N minus K are denied, and the counters equal K times the estimate; exact boundary passes and one micro over fails; `request_limit` boundary; cross-tenant isolation under RLS |
| Lifecycle (real PostgreSQL) | each transition in 3.1 with the exact counter deltas; duplicate reconcile is a no-op; stale `claim_token` is refused; second claim gets zero rows; admission never returns a second `ALLOW` for a claimed reservation (F1); retry creates a new reservation and a blocked attempt does not block the next (F2) |
| Recovery (real PostgreSQL) | unclaimed TTL expiry cancels and releases and decrements `request_count`; lease expiry settles at the estimate; the sweeper is idempotent and safe under concurrent runs; late result is discarded; the counter-drift audit returns zero after a randomised sequence of operations |
| Kill switch | flipped between admission and dispatch gives cancel and release; flipped during a call discards the result and reconciles actual; platform and tenant layers independently |
| Failure matrix | one test per row of section 6, asserting run status, execution status and class, reservation state and counters, `providerCallAttempted`, retry decision, and zero suggestions persisted |
| Boundaries | zero `product`, `autoSuggestion` or other-module writes across the whole suite (spy on the tenant client); FAST still reports safety 0 and zero provider calls with the live token unbound |

004b-ii adds: the zone validator and its negative tests (a second `fetch(`, a variable URL, an SDK import, a Prisma import, a log of the body, a missing `redirect: "error"`), the import-graph rule that FAST and specs never import the zone, the credential-source fail-closed test, and adapter unit tests against a **local stub HTTP server** (no real provider, no key) for each outcome row, including malformed JSON, oversized bodies, slow bodies and redirects. Existing validators are updated in the same PR so that the zone is the only exemption, with their own negative tests.

State-machine tests are first-class, in the same real-PostgreSQL suite:

- **Forbidden transitions** are asserted to be impossible (the compare-and-set returns zero rows and nothing changes): `reconciled -> reserved`, `cancelled -> dispatching`, `expired -> reconciled`, `expired -> dispatching`, `budget_blocked -> reserved`, and every transition out of a terminal state. `expired -> reconciled` is forbidden by design: a late result is discarded (3.8), never applied.
- **Exactly-once settlement:** on every terminal path (each row of section 6, plus crash recovery, duplicate delivery and concurrent settle attempts) the charged counters are released or settled **exactly once**. A randomised sequence of admit, claim, settle and sweep operations from concurrent workers ends with the counter-drift audit at zero.
- **Four-counter admission:** all four counters pass or none is charged; a failure on the last counter rolls back the first three; lock order is fixed; the per-request cap denies before touching a counter; a missing day, month or platform row is DENY.
- **Worker crash after claim, timeout while dispatching, duplicate reconciliation, lease expiry, concurrent claims, and kill-switch activation between admission and dispatch** each have a dedicated test.

## 11. Rollout

| Stage | State | Evidence required to advance |
|---|---|---|
| R0 | 004b merged. `FEATURE_INTELLIGENCE_PROVIDER_ENABLED` unset. `ai_platform_controls` is `enabled=false, kill_switch=true`. No provider key exists in any environment. Zero callers | a test and a production query showing zero outbound provider requests, flags default OFF, kill switch default ON |
| R1 | Kill-switch drill. A stub endpoint stands in; operator flips `kill_switch`; the next call and an in-flight call behave as in 2.5, recorded with timings. Counter-drift audit run | drill record attached to the enablement record |
| R2 | **Synthetic only.** One internal tenant on the allow-list, one capability, one approved provider and model, the pilot envelope in 3.7 applied by a recorded operator procedure, provider-side cap below the platform monthly ceiling. Only approved synthetic Golden Catalog data (004c). Needs the unblock items below | 004c baseline and thresholds set per the authority model |
| R3 | Real tenant data. Only after Privacy sign-off on the signed agreement, zero data retention decision and `inference_geo` decision, and a Security approval of the tenant-data field list | separate go/no-go |

There is only one deployed environment, bound to production, so R0 to R3 all happen in production. That is why every gate defaults closed, why the orchestrator has no caller, and why the first live traffic is synthetic. Setting provider keys and Railway variables, and setting the provider-side cap, are **human steps**; an agent does not do them.

## 12. Authorisation boundary

```
004b design merged
    ↓
004b implementation may begin   (004b-i, then 004b-ii; each its own PR and review)

BUT a real provider call remains BLOCKED until ALL of:
 - AI-POL-003 Security sign-off recorded            (not on file: #1173 merged without a recorded review)
 - Privacy decisions from #1170 recorded            (DPA, zero data retention, inference geo, sub-processors)
 - provider and model approved                      (pinned in ai_platform_controls and pricingVersion)
 - flags default-OFF proven                         (R0 evidence)
 - kill switch proven                               (R1 drill)
 - budget reservation lifecycle proven              (section 10 real-PostgreSQL suite green in CI)
 - provider key provisioned by a human, with a provider-side spend cap
```

Per increment, as recorded by the programme review:

| | 004b-i | 004b-ii |
|---|---|---|
| In scope | `BIGINT` migration, platform-control persistence, flag wiring, budget lifecycle, reservation claim, reconcile/cancel/expire, PostgreSQL concurrency tests, fail-closed eligibility | the adapter shell, the zone, the single `fetch`, zone validators and changed guards |
| Held | provider SDK, provider credential, outbound `fetch`, real provider response, customer-facing route | an actual provider request, until Security approval and Privacy decisions are recorded, the provider and model are approved, and a human has provisioned the credential and the provider-side cap |
| Privacy decisions needed | **no**: no customer data leaves Vexa | to merge the shell: no. To send a request: **yes** |

004b-ii may be merged as a shell that **cannot send**: no credential exists, G1 is disabled, and a test asserts that no request leaves the process. It still requires Security approval of the zone, the credential injection model, logging and redaction, fail-closed behaviour and the changed guard semantics before it starts.

## 13. Decisions requested (design approval gate)

| Reviewer | Decision | Scope |
|---|---|---|
| CTO / Architecture | **APPROVE** | the five gates, the 004b-i / 004b-ii split, the zone rule, no caller in 004b |
| Security | **APPROVE architecture boundary** | zone rule and its positive checks, plain `fetch` over SDK, credential handling, discard-on-kill, CODEOWNERS on the zone |
| SRE / Backend | **APPROVE reservation lifecycle** | state machine, claim step, leases and opportunistic sweep, DB platform control row, confirm that a Railway variable change redeploys, concurrency and timeout numbers |
| Privacy | **REVIEW provider-data assumptions** | no prompt or payload in logs, the billing assumption in 3.3, data-retention inputs carried over from #1170. Does not replace the #1170 decisions |
| QA / Evaluation | **APPROVE failure and test matrix** | sections 6 and 10, the real-PostgreSQL requirement |
| FinOps | **SET** | the pilot envelope in 3.7, `max_tenants`, the confirmed non-billable list in 3.3 |
| Security (additional) | **OWN** | the credential token-prefix catalog and detection semantics (changing it changes the data-exfiltration boundary); Backend implements and may not widen or relax it alone |

This design does not substitute for the missing AI-POL-003 Security sign-off or for the Privacy decisions from #1170.

## 14. Implementation PR plan

| PR | Dominant risk domain | Contents | Needs |
|---|---|---|---|
| 004b-i | data and control plane | migration: `BIGINT`, reservation columns (`claimed_at`, `lease_expires_at`, `expires_at`, `claim_token`), new status CHECK, new unique key, `ai_platform_controls`, `ai_platform_budget_periods`, `ai_provider_budget_charges`; four-counter admission, claim, settle, sweep, audit; strict flags and gates; orchestrator against a test double; the real-PostgreSQL suite; update the 004a validator | migration review PASS; `cto-required-team-approved` label (applied by a human, then a new push) |
| 004b-ii | security boundary | the zone, the single `fetch`, credential source, zone validators and updated guards, CODEOWNERS, stub-server tests; flag OFF, no key | Security review PASS; label; no real provider call, no tenant data |

Scope guard: each PR stays under 60 files and 2,500 lines, and under 25 cross-domain files.

## 15. Open items and risks

- Whether a Railway variable change redeploys the service is **assumed, not verified**; SRE to confirm. If it does not, G0 is faster than assumed, but the DB row stays because it also needs no deploy rights.
- The 15-minute unclaimed TTL is a proposal. The billing rule in 3.3 is deliberately conservative: only a proven non-billable outcome releases to zero.
- The platform day and month rows are a single hot row each. At concurrency 2 this is fine; it must be revisited before the API scales out or concurrency rises.
- The in-process circuit breaker and semaphore assume one replica. If the API is scaled out, both become per-process and the platform ceiling plus the provider-side cap carry the guarantee.
- A conservative estimate over-reserves, so the effective capacity under a small ceiling is lower than the nominal one. That is intended and is visible in utilisation metrics.
- The Golden Catalog is still all DRAFT, so FULL-mode numbers remain informational until the approvals in the approval packet exist.
- The token-prefix list for credential detection is now owned by **Security**, with Backend as implementation owner (section 13).

## 16. Review record and conditions incorporated

Programme review of the first version of this document, 2026-10-05 (via the programme thread, from the design summary; the reviewer could not open the PR). This is **not** a recorded sign-off by the required teams, and merging does not create one.

| Reviewer | Outcome | Incorporated |
|---|---|---|
| CTO / Architecture | APPROVE with two conditions | platform control authoritative over tenant and provider settings, with the explicit AND and DENY on false, missing, unreadable, expired or malformed (section 0, 2.1, 2.2); pre-dispatch re-evaluation of kill switch, tenant enablement, provider/model pin and reservation state (2.4) |
| Security | architecture correct, formal approval still required | zone, credential model, logging/redaction, fail-closed behaviour and changed guards need Security approval before 004b-ii (section 12, 13) |
| SRE / Backend | APPROVE direction | required crash/timeout/duplicate/expiry/concurrent-claim/kill-switch tests (section 10); scheduled sweeper recorded as a future requirement (3.8) |
| QA / Evaluation | APPROVE design | forbidden-transition and exactly-once-settlement tests are first-class (section 10) |
| Privacy | review required before network work | 004b-i does not need the #1170 decisions; no request may be sent from 004b-ii until they are recorded (section 12) |
| FinOps | direction given | zero default budgets and an explicit pilot envelope (3.7); the generic "definitive error means not billed" rule replaced by the conservative accounting principle (3.3) |
| Programme | decisions | `BIGINT` approved now; token-prefix list owned by Security; 004b-i GO only after #1176 is merged and its CI is green; 004b-ii network execution HOLD |
