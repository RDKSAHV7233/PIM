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

### 2.2 Strict parsing, fail closed

- G0 is ON only if the trimmed, case-insensitive value is exactly `true`. Unset, empty, `1`, `yes`, `on`, `TRUE ` with trailing junk, or any other string is OFF. This is stricter than some existing flags on purpose: an AI-spend lever must not be turned on by a typo.
- Any thrown or timed-out read of G1, G2 or G4 is `DENY` with reason `control_unreadable`. A database or Redis blip never fails open.
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
updated_by        text, updated_at timestamptz
```

The migration seeds the row with `enabled = false, kill_switch = true`. A missing row is `DENY`. One uncached primary-key read per AI call is negligible at this volume (a handful of calls, each seconds long). The table is not tenant-scoped, so it does not enter `TENANT_SCOPED_MODELS`; the implementation PR must check the repo's RLS coverage guard (`verify-tenant-rls.cjs` and `tenant-scope.spec.ts`) and record how a deliberately global table is exempted. Operator procedure and a drill are required before enablement (section 11).

### 2.4 Kill-switch semantics (runbook alignment)

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
| (none) | `reserved` | admission passes all gates and the conditional UPDATE reserves | `reserved_spend += estimate` | `+1` |
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

| Outcome | Terminal state | Spend |
|---|---|---|
| Provider returned usage (success, refusal, invalid output, unsafe output) | `reconciled` | actual from provider usage |
| HTTP response received that is a definitive error with no inference (401, 403, 429, 400 before inference, 5xx body) | `cancelled` | none, released |
| Transport-level unknown: timeout, abort, connection reset after the request was sent | `expired` | **reserved estimate** (conservative: the provider may have billed) |
| Failure before any request was sent (gate re-check, circuit open, fingerprint mismatch, adapter unavailable) | `cancelled` | none, released |

The "definitive error means not billed" rule is a proposal for FinOps and Privacy to confirm against the provider's billing terms. If it is wrong the safe direction is to settle those at the estimate too, which only tightens the budget.

### 3.4 Reservation key and retries (closes F2)

- The unique key becomes `(tenant_key, request_fingerprint, attempt_number)`. The runbook requires retries to reuse the idempotency fingerprint, so the attempt number is what makes each billable attempt its own reservation. This also makes a `budget_blocked` row a record of one attempt, not a permanent verdict on the fingerprint.
- `AiExecution` stays one row per fingerprint (existing unique `(tenant_key, idempotency_fingerprint)`) and its `attempt_number` and `max_attempts` advance. `ai_provider_budget_reservations.execution_id` is set at claim.
- Each attempt re-runs **all five gates** and reserves again (a retry can bill again; runbook and 004 investigation section 6).
- A retry is permitted only for `timeout`, `rate_limited` and `upstream_5xx`, at most 2 attempts in total, with backoff and jitter, honouring `Retry-After` up to a 30 s cap. Never retried: `auth_failed`, `schema_invalid`, `input_not_allowed`, blocked or refused output, `output_rejected`, any budget denial, any kill switch, any circuit-open.
- A retry never starts while the previous attempt's reservation is `dispatching` and unexpired.

### 3.5 Atomic reservation (closes F7)

Authorisation reserves before any provider call, by the same single-statement shape 004a introduced, which stays:

```
UPDATE ai_provider_budget_policies
   SET reserved_spend_micros = reserved_spend_micros + $est, request_count = request_count + 1, version = version + 1
 WHERE id = $id AND tenant_key = $tenant AND enabled
   AND request_count < request_limit
   AND reserved_spend_micros + spent_spend_micros + $est <= spend_limit_micros
RETURNING id
```

Row-level locking in PostgreSQL serialises concurrent updates to the same row and re-evaluates the predicate against the new value, so two workers cannot both pass the same remaining-budget check. This is **proven against a real PostgreSQL** in the `backend-tests` job, which already runs `postgres:16` and `prisma migrate deploy` (section 10), not with a mocked Prisma client. Exact-boundary behaviour (`reserved + spent + est == limit` passes, one micro over fails) is part of that test.

### 3.6 Period handling (closes F5)

The period key is derived on the server from the budget policy window (UTC calendar month, `YYYY-MM`) and is never accepted from the caller. A reservation records its `budget_policy_id`; reconcile, cancel and expiry always act on **that** policy row even if the period rolled over meanwhile. A budget policy past `period_ends_at` is `DENY invalid_budget_policy`, so a missing next-period row fails closed.

### 3.7 Platform ceiling (closes F8)

004b adds no platform counter. Total exposure is bounded by three things that must all be stated in the enablement record:

1. `ai_platform_controls.max_tenants`: admission denies if more tenants than this have an enabled budget policy for the live mode.
2. The sum of enabled tenants' `spend_limit_micros` for the period, which is therefore at most `max_tenants x ceiling`. An alert fires if it exceeds a platform cap value held in configuration.
3. A **provider-side spend cap** in the provider console, set lower than the sum above, as a backstop independent of Vexa code (the mechanism and its enforcement behaviour must be verified before relying on it; a human step).

### 3.8 Crash recovery and expiry

Every non-terminal state has a lease. No reservation can hold budget indefinitely.

| State | Lease | When it lapses |
|---|---|---|
| `reserved` (unclaimed) | `expires_at = created_at + 15 min` (admission-to-dispatch TTL, tune with SRE) | the worker died or the job was dropped before dispatch: `cancelled`, released, `request_count` decremented (the call provably never happened) |
| `dispatching` | `lease_expires_at = claimed_at + 20 s timeout + 60 s grace` | the worker died mid-call or lost the response: `expired`, settled at the estimate, flagged for operator review. The sweeper never retries. A queue-level retry, if permitted by 3.4, creates a new reservation |

**Who sweeps.** No scheduler is required. Every admission first sweeps expired reservations for its own policy row (bounded, at most 20 per call, same compare-and-set transitions, so concurrent sweepers are safe). There is also an explicit `sweepExpiredReservations` method for tests and the operator drill. If nothing is being admitted, nothing is consuming the budget, so a lingering row is harmless. An alert fires on the age of the oldest non-terminal reservation (over 15 minutes), so a stuck row is visible even without traffic.

**Late result.** If a result arrives after the sweeper expired its reservation (the claim compare-and-set no longer matches), it is **discarded** (`result_discarded`), not persisted as suggestions, the spend stays settled at the estimate, and an alert fires. Because the lease is longer than the timeout, this should be rare.

**Duplicate reconciliation.** A second reconcile or cancel finds the status already terminal (zero rows). It is a no-op returning the first outcome. If the second call's `actual` differs from the recorded one, a `reconcile_conflict` event is logged (not applied) so that a defect is visible.

## 4. Money: `BIGINT` decision

Adopted as recommended, **before** any real usage. Every `*_micros` column becomes `BIGINT`:

| Table | Columns |
|---|---|
| `ai_provider_budget_policies` | `spend_limit_micros`, `reserved_spend_micros`, `spent_spend_micros` |
| `ai_provider_budget_reservations` | `requested_estimated_cost_micros`, `reserved_cost_micros`, `actual_cost_micros` |
| `ai_executions` | `estimated_cost_micros`, `actual_cost_micros` |

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
| Rate limited (429) | `adapter_failed` | `failed` / `provider_rate_limited` | `cancelled` | yes | yes, honouring `Retry-After` | no |
| Auth failure (401/403) | `adapter_failed` | `failed` / `provider_auth_error` | `cancelled` | yes | **no**; opens the circuit and alerts | no |
| Provider 5xx | `adapter_failed` | `failed` / `provider_5xx` | `cancelled` | yes | yes, if attempt < 2 | no |
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

## 11. Rollout

| Stage | State | Evidence required to advance |
|---|---|---|
| R0 | 004b merged. `FEATURE_INTELLIGENCE_PROVIDER_ENABLED` unset. `ai_platform_controls` is `enabled=false, kill_switch=true`. No provider key exists in any environment. Zero callers | a test and a production query showing zero outbound provider requests, flags default OFF, kill switch default ON |
| R1 | Kill-switch drill. A stub endpoint stands in; operator flips `kill_switch`; the next call and an in-flight call behave as in 2.4, recorded with timings. Counter-drift audit run | drill record attached to the enablement record |
| R2 | **Synthetic only.** One internal tenant on the allow-list, one capability, one approved provider and model, small ceiling (engineering proposal: at most USD 5 per period, FinOps to set), provider-side cap below it. Only approved synthetic Golden Catalog data (004c). Needs the unblock items below | 004c baseline and thresholds set per the authority model |
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

## 13. Decisions requested (design approval gate)

| Reviewer | Decision | Scope |
|---|---|---|
| CTO / Architecture | **APPROVE** | the five gates, the 004b-i / 004b-ii split, the zone rule, no caller in 004b |
| Security | **APPROVE architecture boundary** | zone rule and its positive checks, plain `fetch` over SDK, credential handling, discard-on-kill, CODEOWNERS on the zone |
| SRE / Backend | **APPROVE reservation lifecycle** | state machine, claim step, leases and opportunistic sweep, DB platform control row, confirm that a Railway variable change redeploys, concurrency and timeout numbers |
| Privacy | **REVIEW provider-data assumptions** | no prompt or payload in logs, the billing assumption in 3.3, data-retention inputs carried over from #1170. Does not replace the #1170 decisions |
| QA / Evaluation | **APPROVE failure and test matrix** | sections 6 and 10, the real-PostgreSQL requirement |
| FinOps | **SET** | spend ceiling and the platform cap, `max_tenants`, whether "definitive error means not billed" holds |

This design does not substitute for the missing AI-POL-003 Security sign-off or for the Privacy decisions from #1170.

## 14. Implementation PR plan

| PR | Dominant risk domain | Contents | Needs |
|---|---|---|---|
| 004b-i | data and control plane | migration: `BIGINT`, reservation columns (`claimed_at`, `lease_expires_at`, `expires_at`, `claim_token`), new status CHECK, new unique key, `ai_platform_controls`; claim, settle, sweep, audit; strict flags and gates; orchestrator against a test double; the real-PostgreSQL suite; update the 004a validator | migration review PASS; `cto-required-team-approved` label (applied by a human, then a new push) |
| 004b-ii | security boundary | the zone, the single `fetch`, credential source, zone validators and updated guards, CODEOWNERS, stub-server tests; flag OFF, no key | Security review PASS; label; no real provider call, no tenant data |

Scope guard: each PR stays under 60 files and 2,500 lines, and under 25 cross-domain files.

## 15. Open items and risks

- Whether a Railway variable change redeploys the service is **assumed, not verified**; SRE to confirm. If it does not, G0 is faster than assumed, but the DB row stays because it also needs no deploy rights.
- The "definitive error means not billed" rule (3.3) and the 15-minute unclaimed TTL are proposals.
- The in-process circuit breaker and semaphore assume one replica. If the API is scaled out, both become per-process and the platform ceiling plus the provider-side cap carry the guarantee.
- A conservative estimate over-reserves, so the effective capacity under a small ceiling is lower than the nominal one. That is intended and is visible in utilisation metrics.
- The Golden Catalog is still all DRAFT, so FULL-mode numbers remain informational until the approvals in the approval packet exist.
- The token-prefix list for credential detection still has no owner.
