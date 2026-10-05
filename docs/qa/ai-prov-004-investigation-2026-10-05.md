# AI-PROV-004 Investigation: first controlled live provider

Date: 2026-10-05
Baseline: `origin/main` at `17e51916` (includes AI-POL-002)
Type: read-only planning. **No provider SDK, no credentials, no network call, no live-provider code.** Nothing in this document authorises implementation.

Hold conditions (unchanged): AI-POL-003 implemented with Security approval, FAST baseline re-recorded, and the `main` CI and deploy run for `17e51916` confirmed green. At the time of writing that run was still in progress.

## 0. Summary of recommendations

| Topic | Recommendation |
|---|---|
| Provider | Anthropic Messages API, one provider, one model |
| Model | Pick one model through an offline FULL-mode bake-off on the approved synthetic catalog. Default candidate `claude-haiku-4-5-20251001`; reference comparison `claude-sonnet-5-5` |
| Data leaving Vexa | title, description, brand, categoryPath, attributes.*, supplierSpecifications.* only. `internalNotes` and supplier contact are **excluded** even though they are redactable |
| Execution | queue job, never on the request thread |
| Gates | four independent gates, any one failing means no provider call |
| Spend | per-tenant atomic reservation plus a platform ceiling plus a provider-side cap. **This does not exist yet** and is the largest new piece |
| Environment | there is a single Railway environment bound to production, so there is no pre-production to test in. First enablement is production, flag off, one internal tenant |
| Build order | 004a controls and budget (no provider), 004b adapter behind the controls with the flag off, 004c FULL-mode runner |

## 1. What already exists (reuse) and what does not

| Need | State |
|---|---|
| per-tenant kill switch, opt-out, provider execution flag, allowed providers, retention, payload size, training and raw-storage flags | **exists** on `AiTenantPolicy`; `killSwitchEnabled` and `tenantOptOut` default true; `allowModelTraining` and `allowRawPayloadStorage` are forced false on write |
| execution telemetry (provider, model, region, request id, tokens incl. cached and reasoning, estimated and actual cost, pricing version, attempt, retryable, failure class and safe message, status code, duration) | **exists** on `AiExecution`; statuses already include `budget_blocked`, `provider_disabled`, `timed_out`; failure classes include `provider_timeout`, `provider_rate_limited`, `provider_auth_error`, `provider_5xx`, `provider_schema_invalid`, `unsafe_output`, `budget_exhausted` |
| classification, redaction evidence, output validation, provenance, payload fingerprint | **exists** (AI-POL-001/002, AI-PROV-001/002) |
| provider-neutral adapter boundary, failure normalisation, `finishStatus` enforcement | **exists** (AI-PROV-003/003b) |
| operations contract (fail closed, degrade Intelligence only, kill switch semantics, idempotency fingerprint) | **exists** as `docs/runbooks/ai-intelligence-operations.md` and `validate-ai-sre-operations-contract.cjs` |
| feature-flag convention | **exists**: `FEATURE_*_ENABLED` environment variables |
| job queue with attempts, concurrency and a circuit-open event | **exists** (`queue.service.ts`) |
| retry policy vocabulary (operation, idempotency, automatic retry allowed or not) | **exists** for connectors (`connector-retry-policy.ts`) |
| **budget enforcement** | **does not exist.** `budgetPeriodKey` is only a label on executions; there is no limit, reservation or counter |
| global (platform) kill switch with fast effect | **does not exist** |
| live adapter, provider credentials handling, FULL-mode runner | **do not exist** (intentionally) |

The connector HTTP client and pinned transport exist to reach tenant-supplied hosts safely. A first-party provider has one fixed host, so that machinery is not needed and coupling AI to connector internals is not recommended. Reuse the retry-policy vocabulary, not the client.

## 2. Provider and model

**Proposed:** Anthropic Messages API. One provider keeps the first increment small and matches the programme rule of one provider, one model, one narrow capability, no routing or fallback.

**Model selection is not decided here.** The approved Golden Catalog does not exist yet (all 64 cases are DRAFT), so no defensible choice can be made today. Proposal: once cases are approved, run an offline FULL-mode comparison on synthetic data only, `claude-haiku-4-5-20251001` against `claude-sonnet-5-5`, and choose the cheaper model that clears the thresholds set from that baseline. Haiku is the default candidate on cost and latency for structured extraction. The chosen model id and version are pinned in configuration and in `pricingVersion`. Pricing figures are deliberately not copied here; they must be pinned from the provider's pricing page at implementation time.

**Output contract.** Use a forced single tool call with a strict input schema for `suggestions`, so the provider returns structured data rather than free text, then pass it through the existing structured-output validator unchanged. `schemaValid` still means structural validity only.

## 3. Data handling and privacy (inputs for Privacy review)

Verified against the provider's published pages on 2026-10-05; Privacy must confirm against the signed agreement:

- By default the provider does not use inputs or outputs from commercial API products to train models ([source](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training)). This is consistent with `allowModelTraining = false`.
- Standard retention for API inputs and outputs is automatic deletion within 30 days ([source](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data)). Zero data retention is available by arrangement with the provider's sales team and does not apply to every feature ([source](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)).
- Commercial customers are the data controller and the provider is the processor ([source](https://privacy.claude.com/en/articles/9267385-does-anthropic-act-as-a-data-processor-or-controller)).
- Inference geography can be restricted to US-only infrastructure per request or workspace default, at a price premium for current models; workspace data at rest is US ([source](https://platform.claude.com/docs/en/manage-claude/data-residency)).

Open privacy decisions: sign the data processing agreement; decide whether to request zero data retention for tenant data (recommended before real tenant data); decide whether `inference_geo` must be pinned (the Vexa API runs in us-west2, but tenants may be elsewhere); update the sub-processor disclosure and tenant notice; confirm `retentionDays` semantics in the tenant policy.

## 4. Exactly what may leave Vexa

| Allowed (AI_ALLOWED) | Excluded in the first live increment |
|---|---|
| `product.title`, `product.description`, `product.brand`, `product.categoryPath`, `product.attributes.*`, `product.supplierSpecifications.*` | `product.internalNotes` and `supplier.contactEmail` (redactable, but not needed for extraction, so data minimisation says do not send) |
| | every `AI_BLOCKED` path: customer email and phone, auth password, connector credentials, billing card number, tenant internal key |
| | `product.media` (objects in arrays are blocked since AI-POL-002) and price fields (not in the policy) |

The prompt is built **only from these allow-listed fields**. It must never serialise the whole payload object.

## 5. Redaction and classification enforcement point

Enforcement already happens in the payload dry-run. For a live provider that is not enough on its own, because a later code path could skip it. Proposed defence in depth, all inside the adapter boundary:

1. The service passes the adapter only a request that carries the `payloadFingerprint` produced by an allowed dry-run. The live adapter recomputes the fingerprint from the payload it was handed and refuses on mismatch (tamper or bypass).
2. The adapter re-applies the FREE_TEXT secret check (AI-POL-003) to the final serialised prompt, as a last-line control.
3. Prompt assembly takes named fields only (section 4).
4. Nothing is stored beyond hashes: `allowRawPayloadStorage` is already forced false.

## 6. Execution model, timeouts, retries, circuit breaker

- **Queue job, not request thread.** The API is a single replica with a 400 MB heap, so concurrency must be capped (proposal: 2) and a slow provider must never hold HTTP requests. The queue already provides attempts, concurrency and a circuit-open event.
- **Timeout:** one attempt, 20 seconds hard (proposal; tune from FULL latency data).
- **Retries:** at most 2 attempts total, only for timeout, rate limit (honouring `Retry-After`) and 5xx. Never retry authentication, schema, or validation failures. Retries reuse the same idempotency fingerprint and must not create a duplicate suggestion set (runbook rule).
- **Cost of retries:** a retry can bill again, so each attempt re-checks the budget before it is sent.
- **Circuit breaker:** in-process, per provider, with closed, open and half-open states (a single replica makes in-process state adequate). Opening produces `provider_disabled`, not an error storm. Thresholds are proposals to be set with SRE.
- **Provider outage:** fail closed, degrade Intelligence only, record no cost for calls that did not execute, keep reviewers able to see existing suggestions (runbook).

## 7. Gates, feature flag and kill switch

Four independent gates, evaluated before any provider call. Any single failure means status `provider_disabled` (or `blocked`), zero provider calls, zero cost:

1. **Platform flag** `FEATURE_INTELLIGENCE_PROVIDER_ENABLED`, default **off**, following the `FEATURE_*_ENABLED` convention.
2. **Platform kill switch** that takes effect faster than a redeploy (see below).
3. **Tenant policy:** `status = active`, `intelligenceEnabled`, `providerExecutionEnabled`, `killSwitchEnabled = false`, `tenantOptOut = false`, provider key in `allowedProviderKeys`, capability in `allowedCapabilities`, and `approvedBy`/`approvedAt` present.
4. **Budget** (section 8).

**Kill-switch speed is an open design point.** Changing a Railway variable normally triggers a redeploy (to be confirmed with SRE), which is likely too slow as an emergency lever. Options: a small DB-backed platform control row read with a short cache, or an operator script that bulk-sets `killSwitchEnabled = true` on all policies. The second needs no new table but is a write against many rows. Owner: SRE + Backend.

**Per-tenant enablement:** no policy row means no provider call. First enablement is one internal tenant only, created by an operator with an approver recorded.

## 8. Spend ceiling (the largest new piece)

Three independent layers:

| Layer | Mechanism |
|---|---|
| per call | hard `max_tokens` cap and an input size cap (`maxPayloadBytes` already exists) |
| per tenant per period | new budget limit plus an **atomic reservation**: before the call, reserve the worst-case cost against the tenant's period counter in one conditional database statement; after the call, reconcile to actual cost. Failure to reserve gives `budget_blocked` and no provider call. `budgetPeriodKey` and the cost columns already exist |
| platform | a global ceiling, and a **provider-side spend cap** in the provider console as a backstop independent of Vexa code. The provider-side limit mechanism must be verified before relying on it |

This needs a schema addition (limit and counter), so it is a migration PR and the first piece to build (004a).

## 9. Telemetry

Reuse `AiExecution` as is: provider key, model and version, region, request id, token counts including cached and reasoning, estimated and actual cost with `costSource` and `pricingVersion`, attempt number, retryable, safe failure class and code, status code, duration. Store no raw prompt or response.

Add metrics and alerts: provider calls by outcome, latency histogram, cost micros, breaker state, `budget_blocked` count, `unsafe_output` count. Alert on: breaker open, budget above 80%, any `unsafe_output`, any authentication failure.

## 10. Credentials and environment

- The provider key is a **platform** secret in an environment variable, never in the database, never logged, never in telemetry. It needs a documented rotation procedure and a provider workspace dedicated to Vexa with its own spend limit.
- **There is only one deployed environment** (the "Staging" environment is bound to the production app). Nothing can be tried in a pre-production environment first. The mitigation is layered: flag off by default, one internal tenant, provider-side cap, and a FULL-mode evaluation on synthetic data before any tenant data is sent.
- Setting or reading Railway variables is a human step; it is not something an agent should do.

## 11. Dependency choice

Either the provider's official SDK or plain `fetch` to one fixed HTTPS host. Recommendation: plain `fetch`, no SDK, because one non-streaming call does not need it, it adds no new supply-chain surface, and the adapter interface makes it replaceable. If the SDK is chosen, disable its built-in retries so Vexa's retry and budget policy stays the only one. Decision for Backend and Security (dependency review).

## 12. Guard-stage transition (must be deliberate)

Several guards currently forbid any provider client by design ("in this guard stage"): the AI-SEC-001 validator forbids instantiating provider or model clients in `apps/api/src/intelligence`; `module.spec.ts` and two validators forbid provider names and `fetch(` in the service, module and controller. AI-PROV-004b must change these **in the same PR, with Security review**, to allow exactly one adapter file and keep forbidding everything elsewhere. The module must still import no Product, Catalog, Quality or AutoSuggestions code, add no public write route, and perform no Product mutation. Those guards stay.

## 13. FULL-mode evaluation design

| Aspect | Design |
|---|---|
| purpose | measure factual quality, evidence quality, model behaviour, latency and cost; FAST already covers the machinery |
| data | **only APPROVED Golden Catalog cases** (synthetic). Nothing authoritative can run until PIM SME, QA and Security approvals exist. Until then FULL numbers are informational |
| trigger | manual and explicit (spend), plus before provider, prompt or schema changes and release candidates. Never in PR CI |
| determinism | pinned model version, lowest-variance sampling settings, prompt and schema hashes recorded, N repeated runs (proposal: 3) to measure variance |
| output | `ai-eval-report.v1` with `mode: FULL`, `evidenceKind: FULL_MODEL_QUALITY`, plus cost, latency and token summaries and per-axis rates |
| thresholds | `TBD_AFTER_BASELINE`: the first run records a baseline, then QA, PIM SME, Security and CTO set thresholds per the signed authority model |
| safety | safety stays hard-zero and non-compensable; any accepted prohibited output, secret exposure or blocked-field crossing fails the run regardless of other scores |
| cost guard | run budget cap, and the same four gates apply |

## 14. Build order and acceptance

```
AI-POL-003 (Security-approved, implemented, baseline re-recorded)  [gate]
confirm main CI green for 17e51916                                  [gate]
004a  controls and budget: migration, reservation, platform flag and kill switch, metrics. No provider.
004b  adapter behind the controls, flag OFF, guard-stage transition, no tenant data
004c  FULL-mode runner on approved synthetic cases
first enablement: one internal tenant, flag on only after 004c baseline and Privacy sign-off
```

Acceptance for 004b, at minimum: flag off means zero outbound calls (tested); each of the four gates failing independently means zero calls and the right status; a fingerprint mismatch is refused; the budget reservation is atomic under concurrency (tested); a provider outage opens the breaker and core PIM health stays green; FAST harness still reports safety 0 with zero provider calls (FAST never loads the live adapter); no Product mutation, no public route, no suggestion persistence beyond the existing governed path.

## 15. Decisions requested

1. Provider (Anthropic) and the bake-off approach for choosing the model. Owner: CTO + QA.
2. Privacy: DPA, zero data retention, `inference_geo`, sub-processor disclosure. Owner: Privacy + Security.
3. Fields permitted to leave, including the exclusion of `internalNotes` and supplier contact. Owner: Security + PIM SME.
4. Kill-switch mechanism with fast effect. Owner: SRE + Backend.
5. Budget design and the provider-side cap. Owner: CTO + Data/FinOps.
6. Fetch versus SDK. Owner: Backend + Security.
7. Guard-stage transition wording. Owner: Security.
8. Golden Catalog approvals, which gate FULL-mode authority. Owner: PIM SME, QA, Security.
