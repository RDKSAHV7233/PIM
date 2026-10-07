# AI-PROV-004b-ii final design: the approved provider adapter zone (Stream B, B7)

Date: 2026-10-07
Baseline: `origin/main` at `a475cc0f`
Type: **design only.** No network code, no SDK, no credential, no change to any validator, guard, flag or default. **Nothing here authorises implementation.**
Status: **proposal / awaiting human approval** (Security, CTO, Backend, SRE, QA, Privacy; section 14).

This document finalises `ai-prov-004b-design-2026-10-05.md` (#1176, #1178) now that 004b-i is merged (#1181). It does not replace it: gates, state machine, `BIGINT` money and the failure table stay as written there. It adds what 004b-ii needs and resolves the points the earlier design left open, mapping each onto code that exists on `main`.

## 1. Preconditions (nothing below starts before all hold)

1. Stream A signals that the tenant-isolation boundary is ready: restricted runtime architecture certified, the AI maintenance paths migrated (7.2a is merged, #1214; 7.2b and runtime verification are pending) and no unresolved cross-tenant bypass affecting AI.
2. Decisions recorded by their human owners: Security (B2), Privacy (B3), provider and model (B4), spend caps (B5), credential runbook accepted (B6).
3. The network-guard transition is planned (B8) and its negative tests are agreed.

Until then 004b-ii is this document only.

## 2. Components and where they live

```
product code (none calls the orchestrator in 004b)
        │
IntelligenceProviderOrchestrator   (service; OUTSIDE the zone; no fetch, no provider names)
   1. payload dry-run + fingerprint            (existing: AI-PROV-001, AI-POL-001/2/3)
   2. circuit check (before any reservation)
   3. control.runWithReservation(input, work)  (existing: 004b-i; admit, claim, revalidate, settle)
        └─ work(context)  ──▶  IntelligenceProviderAdapter.generateStructuredOutput(request)
                                     │  injected through a SEPARATE token, never the fixture token
                                     ▼
              apps/api/src/intelligence/live/        (the ONLY directory that may contain network code)
                 credential-source.ts   one function; returns nothing when the variable is unset
                 request-mapper.ts      pure: IntelligenceAdapterRequest → provider request body
                 live-adapter.ts        implements IntelligenceProviderAdapter; the one file with fetch(
                 response-mapper.ts     pure: provider response → IntelligenceAdapterResponse
                 error-normalizer.ts    pure: status, type, abort → IntelligenceAdapterErrorClass + code
   4. existing validateStructuredOutputForSuggestions (+ credential guard on output)
   5. existing governed suggestion path (pending_review; no Product write)
```

- The zone imports **no Prisma, no Nest service, nothing from Product, Catalog, Quality or AutoSuggestions**. It is a pure function from request to response plus one credential read.
- The existing `INTELLIGENCE_PROVIDER_ADAPTER` token stays bound to the fixture adapter, so `runFixtureAdapterContract` and the FAST harness are untouched. The live adapter has its own token and its own orchestrator method.
- `runWithReservation` already implements admission, claim, pre-dispatch revalidation, settlement and discard-on-kill (#1181). The orchestrator **uses it as is**; it adds no second reservation path.
- **Nothing in 004b-ii has a caller from product flows.** Callers are tests and the later FULL-mode runner. A queue job or a product trigger is a separate, individually reviewed increment.

## 3. The adapter interface (unchanged shape, tightened semantics)

The existing contract (`IntelligenceProviderAdapter`, `IntelligenceAdapterRequest`, `IntelligenceAdapterResponse` in `intelligence.types.ts`) is kept. Tightening, with no type change except where stated:

| Point | Rule |
|---|---|
| `providerCallAttempted` | `true` from the moment a request is handed to `fetch`; `false` only for failures before that (unset key, mapping error, pre-send abort). Never inferred afterwards |
| `region` | taken from the provider's **response** (`usage.inference_geo` on the first-party API), never from the request. If it differs from the pinned geography the result is **discarded** and an alert fires (`geo_mismatch`), because a residency promise was broken |
| `modelKey`, `modelVersion` | from the response; must equal the platform control row's `allowedModel`; a different model is a discard and an alert |
| `requestId` | the provider's request id, recorded for support and reconciliation; never logged with a body |
| `usage` | token counts from the provider's usage object; `estimatedCostMicros` is computed as tokens times the price table pinned by `pricingVersion` times the geography multiplier. It is a `number` in the existing type; per-request values are bounded by `MAX_MONEY_MICROS` (10^12), which a JS number holds exactly, and are converted to `bigint` at the control-plane boundary. No type change is needed |
| `errorClass` | the existing closed set: `input_not_allowed`, `schema_invalid`, `adapter_unavailable`, `timeout`, `rate_limited`, `auth_failed`, `upstream_5xx`, `internal_error` (section 7). No provider-specific class leaves the zone |
| exceptions | the adapter **returns** a normalised failure for every expected outcome; it throws only for programmer error. A thrown error settles as billing-unknown (conservative), so a bug cannot release budget |

## 4. Request mapping (pure, in the zone)

1. **Model and geography** come from configuration pinned in the platform control row (`allowedProvider`, `allowedModel`) and the approved geography (`"us"`); the adapter does not choose them.
2. **System prompt** is a checked-in constant selected by `promptVersion`. It contains no tenant data. Changing it changes `promptVersion` and re-runs the Golden Catalog.
3. **User content** is built from **named allow-listed fields only** (`product.title`, `description`, `brand`, `categoryPath`, `attributes.*`, `supplierSpecifications.*`, `media.altText`; B3 P8), serialised deterministically. It never serialises a whole payload object.
4. **Output schema** is selected by `schemaVersion`, strict, `additionalProperties: false`, using only schema features the provider supports (no numeric bounds, no string lengths, no recursion; B4 section 4). Anything the provider cannot enforce is enforced by the existing Vexa validator, which stays authoritative.
5. **Bounds:** `max_tokens` from configuration (proposal 4,096, the figure B5 priced); input capped by the tenant policy's `maxPayloadBytes`; a request over the cap is `input_not_allowed` before any call.
6. **Nothing identifying is sent**: no tenant key, no user id, no entity id, no correlation id, no custom header carrying Vexa data. The correlation id stays on the Vexa side and is joined to the provider request id after the fact.
7. **Last-line checks inside the adapter before `fetch`:** recompute the payload fingerprint and refuse on mismatch (`input_not_allowed`, reservation `cancelled`); re-apply the FREE_TEXT credential check (AI-POL-003) to the final serialised prompt; refuse if the key variable is unset (`adapter_unavailable`).
8. **Call shape:** non-streaming; one request; a single `const` HTTPS URL literal for the one approved host; `redirect: "error"`; an `AbortSignal` with the timeout; the key in a header that is never logged.

## 5. Response mapping (pure, in the zone)

The provider documents that on a refusal or on reaching `max_tokens` the output may not match the schema, with HTTP 200 and tokens billed (B4). The mapping therefore keys on the stop reason first and the body second:

| Provider outcome | `finishStatus` | `errorClass` / code | Next |
|---|---|---|---|
| normal completion, body parses and is an object | `completed` | none | existing validator decides; `schemaValid` still means structural validity only |
| `refusal` stop reason | `blocked` | none; code `provider_refusal` | reservation `reconciled` at actual usage; run status `adapter_blocked`; no suggestions |
| `max_tokens` stop reason | `failed` | `schema_invalid`; code `max_tokens` | reconciled at actual usage; not retried (a larger `max_tokens` is a configuration change, not a retry) |
| completion but body is not parseable JSON or not an object | `failed` | `schema_invalid`; code `unparseable` | reconciled at actual usage |
| any stop reason the mapper does not know | `failed` | `internal_error`; code `unknown_stop_reason` | the run is `adapter_status_invalid` (existing run status); reconciled if usage present, otherwise billing unknown |
| completion but the response geography or model differs from the pinned values | discard | code `geo_mismatch` or `model_mismatch` | result discarded, alert, reconciled at actual usage |

The adapter never returns `completed` for an output it could not parse. `canonicalProductMutationEnabled` stays a literal `false` in every result type.

## 6. Timeout, retry and circuit breaker

**Timeout.** 20 seconds per attempt, enforced by `AbortSignal` in the zone. The reservation lease is claim time plus 20 s plus 60 s grace (004b design 3.8); a result arriving after the lease is discarded (`late_result`). The orchestrator aborts the signal at lease expiry as well, so a hung call cannot outlive its reservation.

**Retry (orchestrator, never the zone).** Each attempt is a **new admission** with `attemptNumber + 1`, so each billable attempt is its own reservation (existing: the unique key is tenant, fingerprint, attempt). At most **2 attempts in total**; only for `timeout`, `rate_limited` and `upstream_5xx`; exponential backoff with jitter, honouring `Retry-After` up to a 30 s cap; never for `auth_failed`, `schema_invalid`, `input_not_allowed`, a blocked or refused output, `output_rejected`, any budget denial, any kill switch or an open circuit; never while the previous attempt's reservation is `dispatching` and unexpired. (The control-plane parser accepts attempt numbers up to 10; the orchestrator, not the parser, enforces 2.)

**Circuit breaker (in process; proposals for SRE to confirm).** States closed, open, half-open, checked **before** admission so an open circuit reserves nothing and costs nothing.

| Trigger | Action |
|---|---|
| one `auth_failed` | open, stay open until an operator resets it, and alert (a credential problem will not heal by waiting) |
| 3 consecutive `timeout` or `upstream_5xx` within 60 s | open for 60 s |
| open period elapsed | half-open: admit one governed request; success closes, failure re-opens with a doubled period up to 10 minutes |

**Single-replica assumption.** The breaker and the concurrency limit (2) are per process. They are valid for the current one-replica topology only; the platform ceiling and the provider-side limit carry the guarantee if that changes. The implementation records the assumption where an operator sees it and the enabling procedure includes a check of the replica count.

## 7. Error normalisation (pure, in the zone)

| Provider signal | `errorClass` | Code (examples) | Retryable | Billing outcome |
|---|---|---|---|---|
| HTTP 400 invalid request | `schema_invalid` | `provider_bad_request` | no | unknown (settle at estimate) |
| HTTP 401, 403 | `auth_failed` | `provider_auth` | no; opens the circuit | unknown |
| HTTP 404 (model not found) | `adapter_unavailable` | `model_unavailable` | no | unknown |
| HTTP 413 (request too large) | `input_not_allowed` | `request_too_large` | no | unknown |
| HTTP 429 | `rate_limited` | `provider_rate_limited` | yes, per section 6 | unknown |
| HTTP 500, 502, 503, 504 and the provider's overload status | `upstream_5xx` | `provider_5xx` | yes | unknown |
| abort, connection reset, DNS or TLS failure after send | `timeout` (abort) or `adapter_unavailable` (connect) | `provider_timeout`, `provider_unreachable` | yes for timeout | unknown |
| anything else | `internal_error` | `unclassified` | no | unknown |

"Billing outcome unknown" means the reservation settles at the **reserved estimate** (B5, section 7). The allow-list of confirmed-non-billable responses is **empty** until FinOps and Privacy extend it from the provider's billing terms; this design adds nothing to it. The exact status codes and the provider's overload code are to be confirmed from the provider's error documentation at implementation time.

## 8. Finish status, run status and `AiExecution` mapping

The Vexa vocabularies already exist; this section only fixes how the live adapter feeds them. The full outcome table is `ai-prov-004b-design` section 6 and is unchanged.

| Adapter result | Run status (existing union) | `AiExecution.status` | Reservation |
|---|---|---|---|
| `completed`, validator accepts | `succeeded` | `succeeded` | `reconciled` (actual) |
| `completed`, validator or credential guard rejects | `output_rejected` | `failed` | `reconciled` (actual) |
| `blocked` (refusal) | `adapter_blocked` | `failed` | `reconciled` (actual) |
| `failed` with a retryable class | `adapter_failed` | `failed` or `timed_out` | `expired` (estimate) unless usage proves otherwise |
| `failed` with `auth_failed` | `adapter_failed` | `failed` | unknown, at estimate; circuit opens |
| unknown finish status | `adapter_status_invalid` | `failed` | `expired` or `cancelled` by whether a request was sent |
| gate or circuit denial before reservation | `provider_disabled` | `provider_disabled` or `budget_blocked` | none or `budget_blocked` row |

**Gap to close in 004b-ii-b.** `provider_disabled`, `denied`, `duplicate_in_flight`, `result_discarded` and `work_threw` are statuses of the control service's `GovernedRunResult`; the fixture run-status union `IntelligenceAdapterRunStatus` (`succeeded`, `payload_blocked`, `adapter_failed`, `adapter_blocked`, `adapter_status_invalid`, `output_rejected`) has none of them. The orchestrator must map one vocabulary onto the other explicitly (a closed, tested mapping), not widen the fixture union silently, so FAST and the fixture contract stay unchanged.

`AiExecution` stays one row per fingerprint; `attemptNumber` advances per attempt; cost fields are decimal strings on every serialisation boundary; provider key, model, version, region, request id, token counts, cost, source and pricing version are recorded from the response; the raw payload is never stored.

## 9. Reservation lifecycle, kill-switch and budget re-checks

- **Reservation:** `work(context)` receives `reservationId`, `claimToken` and `leaseExpiresAt`. It returns `{ billing, value }` where `billing` is `usage` (provider returned usage), `confirmed_non_billable` (only if on the allow-list; empty today) or `unknown`. `work` must not throw for expected failures.
- **Kill switch before dispatch:** already implemented by `revalidateBeforeDispatch` (deploy flag, platform control row, tenant policy, capability and provider pin, reservation state), evaluated immediately before `work` runs. A change between admission and dispatch cancels the reservation at zero.
- **Kill switch during the call:** already implemented by `killActive` after the call returns; the result is **discarded**, the reservation settled at actual, an alert raised. No in-call polling is added: the call is bounded by 20 s.
- **Budget:** reserved atomically at admission across four counters plus the per-request cap (#1181). No second budget check is needed at dispatch. If provider-reported `actual` exceeds the reservation, that is an alert and a defect review (B5, section 6); the settlement records actual.
- **Safe cancellation:** before the request is handed to `fetch`, cancel is free (`cancelled`, zero). After it, the outcome is billing-unknown and settles at the estimate; the adapter never claims a cancel proved non-billable.

## 10. Telemetry and logging

One structured event per outcome with the fields in 004b design section 8; the zone emits only normalised classes and codes. **Never** in a log, metric, error message or thrown exception: the prompt or any part of it, the payload, the provider response body, the key or any header, product values, tenant secrets. The zone has no logger import that can accept a body; a validator and a negative test enforce that (B8). Metrics and alerts as in 004b design section 8, plus `geo_mismatch`, `model_mismatch` and `provider_refusal` counts.

## 11. Testing without a live provider

The earlier design said "stub-server tests". The single URL literal makes a local stub server impossible without weakening the zone rule, so the design is changed: tests replace **`globalThis.fetch`** with a stub, and assert that it was called exactly once with the one approved URL literal, `redirect: "error"`, an `AbortSignal`, and a body that matches the mapper's expected shape and contains no tenant identifier. No test imports the zone from the FAST harness (import-graph rule). A test that **no request leaves the process when the key variable is unset** is mandatory (the shell requirement). Real-PostgreSQL tests of the lifecycle already exist (#1181) and the orchestrator reuses them.

## 12. Invariants preserved (each already enforced; none relaxed)

No Product, Catalog, Quality or AutoSuggestions import under `apps/api/src/intelligence`; no write route; `canonicalProductMutationEnabled: false` literal; no public AI customer route; no autonomous publish; suggestions enter as `pending_review`; no AutoSuggestions apply; SDK imports forbidden everywhere including the zone; default deny at every gate; zero budgets by default.

## 13. Implementation slicing (later; each its own PR and review; gated by section 1)

| PR | Content | Risk domain |
|---|---|---|
| 004b-ii-a | zone shell: `credential-source`, `request-mapper`, `response-mapper`, `error-normalizer`, `live-adapter` that **cannot send** (key unset), zone validators and import-graph rule with negative tests (B8), CODEOWNERS entry, no orchestrator | security boundary |
| 004b-ii-b | orchestrator using `runWithReservation`, circuit breaker, retry, execution-record mapping, `globalThis.fetch`-stub tests; flag off, no key, no caller | backend |
| 004b-ii-c | operator commands (kill switch, budget configuration) and the `.env.example` entry with an empty value | ops |

Each stays under the repository's size and domain limits, carries the `cto-required-team-approved` label where required, and is merged by a human.

## 14. Decision block (blank)

| Decision | Owner | Decision (`APPROVE` / `APPROVE_WITH_CONDITIONS` / `REWORK`) | Name, date |
|---|---|---|---|
| Component layout and the zone as the only network path | Security + CTO | [ ] | |
| Adapter semantics (section 3), including discard on geography or model mismatch | Security + Backend | [ ] | |
| Request and response mapping (sections 4 and 5) | Backend + QA | [ ] | |
| Retry (2 attempts) and circuit breaker parameters (section 6) | SRE + Backend | [ ] | |
| Error normalisation and the empty non-billable allow-list (section 7) | Backend + FinOps + Privacy | [ ] | |
| Testing via `globalThis.fetch` stub instead of a stub server (section 11) | Security + QA | [ ] | |
| PR slicing (section 13) | CTO | [ ] | |

## 15. Open items for humans

1. The exact provider status codes and overload code (confirm from the provider's error documentation).
2. Whether the pinned model identifier is an immutable snapshot (B4, condition 3).
3. Whether the provider's response reports the geography on every response (the first-party documentation says it does; confirm for the chosen model).
4. Circuit-breaker parameters (SRE).
5. Who holds the operator access for the kill switch (B10) and whether an operator command is built in 004b-ii-c or earlier.

## 16. What this document does not do

It writes no code, adds no SDK, creates no key, enables no flag, changes no validator or guard and authorises no implementation. The guards that forbid network code everywhere stay exactly as they are until 004b-ii-a is separately authorised.
