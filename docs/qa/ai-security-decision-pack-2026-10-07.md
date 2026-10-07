# Vexa AI Security decision pack (Stream B, B2)

Date: 2026-10-07
Baseline: `origin/main` at `ec9b166c`
Type: **documentation only.** No provider code, no SDK, no credential, no network path, no change to any validator or guard.
Status: **proposal / awaiting human approval.** The recommendations below are the author's. **Claude cannot sign for Security.** Only the Security owner can record a decision, in their own name, in the sign-off block (section 7) or in a pull request.

## 1. What Security is being asked to decide

Fifteen topics block the first controlled provider call. For each one this pack gives: what already exists (with evidence), what does not, a **proposed** recommendation (`APPROVE`, `APPROVE_WITH_CONDITIONS` or `REWORK`), and the evidence Security should see before signing. Evidence is labelled **implemented** (merged code, a validator or a test), **design** (written in `ai-prov-004b-design-2026-10-05.md`, not yet code) or **absent**.

Nothing here approves 004b-ii implementation, a provider call, a key, a budget or a tenant. Those stay held (see `vexa-ai-programme-ledger-2026-10-07.md`, #1216).

## 2. Summary

| # | Topic | Implemented / design | Proposed recommendation |
|---|---|---|---|
| 1 | AI-POL-003 (credential detection semantics) | implemented (#1173) | APPROVE_WITH_CONDITIONS |
| 2 | Credential-shaped detection coverage | implemented, with a verified gap | APPROVE_WITH_CONDITIONS (add `pim1_`) |
| 3 | Blocked-data rules | implemented (AI-POL-001/002) | APPROVE |
| 4 | Token-prefix list ownership | decided (Security owns), process absent | APPROVE_WITH_CONDITIONS |
| 5 | Provider network boundary (adapter zone) | design only | APPROVE_WITH_CONDITIONS |
| 6 | Permitted telemetry | design; fields partly implemented | APPROVE |
| 7 | Prohibited logging | design; hash-only storage implemented | APPROVE_WITH_CONDITIONS |
| 8 | Provider credential storage | design; runbook is B6 | APPROVE_WITH_CONDITIONS |
| 9 | Adapter isolation (import graph, one `fetch`) | design only | APPROVE_WITH_CONDITIONS |
| 10 | Retry behaviour | design only | APPROVE |
| 11 | Circuit breaker | design only | APPROVE_WITH_CONDITIONS |
| 12 | Kill-switch enforcement | implemented (control row, gates); pre-dispatch recheck design | APPROVE_WITH_CONDITIONS |
| 13 | Budget enforcement | implemented (#1181) | APPROVE_WITH_CONDITIONS |
| 14 | No Product mutation | implemented (#1133 guard and tests) | APPROVE |
| 15 | No AutoSuggestions direct apply | implemented (review workflow, guard) | APPROVE |

The conditions are collected in section 6. Two of them are findings that were not in earlier reviews and need Security's attention first (section 5).

## 3. Topic detail

### 3.1 AI-POL-003: credential detection semantics
- **Implemented (#1169, #1173).** One bare-word regex that served two jobs was replaced by two explicit modes in `intelligence-secret-detection.ts`: FREE_TEXT (input leaves, model output values, evidence citations, reviewer edits: explicit credential shapes only) and STRICT (operational identifier fields and notes: bare-word check, unchanged). Every JSON key name always goes through the stricter `isSecretLikeKey`. Matched text is never returned, only detector ids.
- **Measured (FAST harness):** 0 incorrectly blocked, 0 incorrectly rejected, 0 safety violations, 4 of 4 expected-blocked payloads blocked.
- **Accepted losses, recorded knowingly:** text that mentions a credential word with no value now passes in free text (for example `bearer token leaked`); four documented residual misses (a bare base64 blob, a keyword split across words, a bare hex digest, `password hunter` with no digit); three documented residual false positives.
- **Not on file:** a recorded Security review. #1169 and #1173 were merged without one. The PR text asks Security to confirm the "Decisions implemented" and "What is lost" sections.
- **Proposed: APPROVE_WITH_CONDITIONS.** Confirm the loss list above in writing; require the supplier-text tuning set (about 200 items, under privacy review) before a live provider, because every corpus measured so far was author-constructed.

### 3.2 Credential-shaped detection coverage
- **Implemented detectors:** PEM private key, `Authorization` header, bearer token, keyword assignment, keyword-space-value, keyword-prose-value, connection string with embedded password, and `token_prefix` for: AWS access key id, GitHub, Slack, Stripe, LLM-provider `sk-` style, Google, SendGrid, Shopify (`shp*_`), WooCommerce (`ck_`/`cs_`), JWT.
- **Verified gap (new):** Vexa's own API keys are issued as `pim1_<id>.<secret>` (`buildPlainTextApiKey`, `apps/api/src/api-keys/api-key-auth.ts`; the secret is 32 random bytes, base64url). There is **no `pim1_` rule** in `TOKEN_PREFIXES` and **no `pim1` vector** in `test-fixtures/ai-policy/secret-detection.v1.json`. A Vexa API key pasted into supplier text, or echoed in model output, is caught only if a keyword (`api_key=`, `Bearer`, ...) happens to sit next to it.
- **Also absent as prefix rules** (no claim that Vexa uses them, listed because the provider and connector set will grow): the format of `INTERNAL_OPS_API_KEY` (an operator secret with no prefix), Railway tokens, Resend keys, Twilio and Azure formats. Security decides which are in scope (topic 4).
- **Proposed: APPROVE_WITH_CONDITIONS.** Add a `pim1_` token-prefix detector and a conformance vector (fragment-assembled, like the others; the vectors file has a self-check that it contains no contiguous credential shape). This is a Security-owned detection change implemented by Backend; it is a separate small PR, not part of this pack.

### 3.3 Blocked-data rules
- **Implemented (#1135, #1145, #1165, #1167):** every field is classified `AI_ALLOWED`, `AI_ALLOWED_WITH_REDACTION` or `AI_BLOCKED`; the default is `AI_BLOCKED`; path grammar `*` / `**` with deny-overriding allow; a tenant policy gates capability and provider. In the Golden Catalog the four `payload_blocked` cases (customer email, connector access token, auth password, billing card number) block 4 of 4.
- **Held for Privacy (B3):** the full field-by-field classification of Vexa data. Security signs the *mechanism*; Privacy signs the *classification*.
- **Proposed: APPROVE** for the mechanism, on the evidence of the policy validators and the FAST result.

### 3.4 Token-prefix list ownership
- **Decided:** Security owns the list and its detection semantics; Backend implements and may not widen or relax it alone (004b design section 13).
- **Absent:** a process. No named owner, no change procedure, no review cadence.
- **Proposed: APPROVE_WITH_CONDITIONS.** Name the owner. Require that any new connector, provider or Vexa-issued credential format adds a prefix rule and a vector in the same PR that introduces the format; add that to the PR checklist.

### 3.5 Provider network boundary (adapter zone)
- **Design only:** one directory, `apps/api/src/intelligence/live/`, may contain the network client; everywhere else stays forbidden. SDK imports stay forbidden everywhere (plain `fetch`). Today the three 004b-i validators forbid network code in every governed file; that is the safe default until 004b-ii and is **not** to be loosened before then (see B8).
- **Zone rules (design):** exactly one file with `fetch(`; URL a `const` string literal for the single approved HTTPS host; `redirect: "error"`; an `AbortSignal` with the configured timeout; no retry loop inside the zone; no Prisma; no import from Product, Catalog, Quality or AutoSuggestions; one credential-source function; the zone never logs, stringifies or throws a request or response body.
- **Proposed: APPROVE_WITH_CONDITIONS.** Approve the boundary as designed, on condition that each zone rule is enforced by a validator with a **negative test** before 004b-ii merges (B8), and that 004b-ii merges as a shell that cannot send (no key, flag off, a test asserting no request leaves the process).

### 3.6 Permitted telemetry
- **Design:** one structured event per execution outcome with `correlationId`, `tenantKey`, `capability`, `attemptNumber`, `executionId`, `reservationId`, `providerKey`, `modelKey`, `modelVersion`, `providerRegion`, `providerRequestId`, the first denying `gate`, `providerCallAttempted`, cost fields **as decimal strings**, `latencyMs`, `finishStatus`, normalised error class and code, `retryable`, `reservationOutcome`. `AiExecution` already carries most of these; `validate-ai-core-execution-telemetry.cjs` lints fixture telemetry.
- **Proposed: APPROVE.** Security should confirm that `providerRequestId` and `tenantKey` in logs are acceptable under Privacy's retention rules (B3).

### 3.7 Prohibited logging
- **Design:** never logged, in any log, metric, error message, audit row or thrown exception: the prompt or any part of it, the request payload, the provider response body, the provider key or any header, product field values, tenant secrets. **Implemented:** hash-only storage (`allowRawPayloadStorage` forced false), detector results report ids and never matched text.
- **Absent:** an automated check that no logging call in the zone can receive a body. A review rule is not a control.
- **Proposed: APPROVE_WITH_CONDITIONS.** Require a validator plus a negative test that fails if the zone logs, stringifies or interpolates a request or response variable, and a unit test that a thrown adapter error contains only a normalised class and code.

### 3.8 Provider credential storage
- **Design:** the provider key is a **platform** secret in a service environment variable, never in the database, never in the repository, never logged; read only through one credential-source function that returns nothing when unset (unset means `adapter_unavailable`, a fail-closed result); a provider workspace dedicated to Vexa with its own provider-side spend cap.
- **Not decided:** who creates the key, naming, rotation and revocation, emergency revoke, audit owner. Those are the B6 runbook.
- **Context Security should weigh:** the production runtime database role is a superuser (SEC-DB-RLS-001, #1189), so a provider key is not exposed *by* that finding, but the environment variable is readable by anyone with Railway service access. The runbook must name the audience.
- **Proposed: APPROVE_WITH_CONDITIONS.** Approve environment-variable storage for the pilot; require B6 before any key exists; require that the key never be shared with another service or environment.

### 3.9 Adapter isolation
- **Design:** the zone is a pure function from request to response; the FAST harness and every `*.spec.ts` outside the zone may never import the zone (import-graph validator); a CODEOWNERS entry on the zone requires Security review.
- **Verified gap (new):** the repository has **no CODEOWNERS file**, and the GitHub plan cannot enforce branch protection or required reviews (2026-10-06 check: no branch protection, rulesets unavailable on the plan). The "CODEOWNERS requires Security review" control in the design is therefore **not enforceable today**, and the validator-only controls carry the weight.
- **Proposed: APPROVE_WITH_CONDITIONS.** Do not rely on CODEOWNERS until review enforcement exists; make the import-graph and zone validators required CI checks the moment the plan allows it (the same governance blocker as the database role cutover); until then Security review is a convention recorded in the PR, not a gate.

### 3.10 Retry behaviour
- **Design:** retries belong to the orchestrator, not the adapter, because **each attempt needs a new reservation**; at most two attempts; retry on timeout, 429 (honouring `Retry-After`) and 5xx; never on 401/403, which opens the circuit and alerts; the reservation key is `(tenant, fingerprint, attempt)`, so a retry cannot double-charge the same reservation.
- **Proposed: APPROVE.** The design prevents an unbounded spend loop by construction; the reservation lifecycle tests (merged in #1181) already prove exactly-once settlement for the lifecycle this depends on.

### 3.11 Circuit breaker
- **Design:** in-process breaker and semaphore (concurrency 2); opens on an auth failure; checked **before** reserving so an open circuit costs no budget.
- **Stated limit:** it assumes **one API replica** (the current Railway topology). If the API scales out, the breaker becomes per-process and the platform ceiling plus the provider-side cap carry the guarantee.
- **Proposed: APPROVE_WITH_CONDITIONS.** Accept for the pilot on the one-replica assumption; require the assumption to be asserted at startup or documented as a precondition of enabling the provider; require a drill that an auth failure opens the circuit and stops further calls.

### 3.12 Kill-switch enforcement
- **Implemented (#1181, #1185):** the platform control row is DB-backed and **read on every call, never cached**; deny-all is seeded; default is `enabled = false`, `kill switch = true`. Production dormant proof: 12 of 12 required deny controls PROVEN under the deployed role, with the stated limit that the role is a superuser (an application-layer proof, not a database-isolation proof).
- **Design:** every mutable control is re-evaluated **immediately before dispatch**; a kill switch between admission and dispatch cancels; a kill switch during the call discards the result and settles at actual cost.
- **Not yet done:** the production kill-switch drill (held; needs explicit human authorization; B10 prepares the runbook).
- **Proposed: APPROVE_WITH_CONDITIONS.** Approve the design; require the drill to pass and be recorded before any provider request; require the dormant proof to be re-run once the restricted runtime role is in production.

### 3.13 Budget enforcement
- **Implemented (#1181):** four counters charged atomically per call (tenant day and month, platform day and month) plus a per-request cap; `BIGINT` micros; **zero defaults**; claim, settle and expire; sweeper; counter-drift audit; a real-PostgreSQL concurrency suite in CI.
- **Conservative rule:** only a proven non-billable outcome releases a reservation to zero; everything ambiguous settles at the estimate.
- **Dependency on Stream A:** #1214 changes how the sweeper and audit read across tenants; 7.2b later drops the maintenance policies. Security should treat the budget control plane as **recertified after that**, not before.
- **Proposed: APPROVE_WITH_CONDITIONS.** Zero defaults stay; every non-zero budget is a human-set operator configuration (B5); recertify the sweeper and audit after #1214 and 7.2b.

### 3.14 No Product mutation
- **Implemented (#1133):** `validate-ai-sec-no-direct-product-writes.cjs` forbids Product, Catalog, Quality and AutoSuggestions imports, write routes (`@Post/@Patch/@Put/@Delete`) and Product mutation in the governed AI files; `canonicalProductMutationEnabled: false` is a literal in every result type; in 004b **no product code path calls the orchestrator at all** (its only callers are tests and the later FULL-mode runner).
- **Proposed: APPROVE.** Keep the guard unchanged by 004b-ii (design section 5: Product, Catalog, Quality and AutoSuggestions rules are explicitly unchanged).

### 3.15 No AutoSuggestions direct apply
- **Implemented:** suggestions enter the governed review path as `pending_review`; a human accepts or rejects; the review workflow contract is validated by `validate-ai-gov-review-workflow.cjs` (suggested value is immutable; the reviewer edit is a separate field). Nothing is applied automatically.
- **Proposed: APPROVE.** Re-confirm at any point a product-flow caller is proposed (a separate, later, individually reviewed increment).

## 4. What would change a recommendation

Any of these would move the recommendation to `REWORK` for the topic named: evidence that a request, response body or key reaches a log (3.7); a way for the zone to import Product or Prisma (3.5, 3.9); a retry path that reuses a reservation (3.10); a non-zero default budget (3.13); a caller of the orchestrator from a product flow (3.14).

## 5. New findings for Security's attention

| # | Finding | Evidence | Effect |
|---|---|---|---|
| F-1 | Vexa's own API-key format `pim1_<id>.<secret>` has no detector and no vector | `api-key-auth.ts` (`buildPlainTextApiKey`); `TOKEN_PREFIXES`; `secret-detection.v1.json` has no `pim1` entry | a Vexa key in supplier text or model output is caught only by an adjacent keyword; fix is a Security-owned detector plus vector |
| F-2 | The "CODEOWNERS on the zone" control cannot be enforced: no CODEOWNERS file, and no branch protection or required reviews on this GitHub plan | repository search; 2026-10-06 branch-protection check | Security review of the zone is convention, not a gate, until the plan changes; validators must carry the control |
| F-3 | Every AI production proof so far was taken under a superuser role | SEC-DB-RLS-001 (#1189), #1185 | proofs are application-layer; re-run after the restricted role is in production |
| F-4 | Circuit breaker and concurrency limits assume one API replica | design section 15 | scaling out weakens a control silently unless the assumption is checked |

## 6. Consolidated conditions

**Before 004b-ii may start (design and shell):**
1. Security records its decision on topics 1 to 15 in section 7.
2. Name the token-prefix list owner and add the change procedure (topic 4).
3. Add the `pim1_` detector and vector (F-1), as a Security-owned change.
4. Agree that validators, not CODEOWNERS, carry the zone controls (F-2), and that each gets a negative test (B8).

**Before 004b-ii may merge:** it merges as a shell that cannot send (no key, flag off, test asserting no outbound request), with the zone validators, the import-graph validator and the logging validator and their negative tests.

**Before the first provider request:** Privacy decisions (B3), provider and model (B4), spend caps (B5), key runbook and a human-provisioned key (B6), dormant proof re-run and kill-switch drill (B9, B10), the supplier-text tuning set, and Stream A's readiness signal.

## 7. Sign-off block (blank; for the Security owner only)

| # | Topic | Decision (`APPROVE` / `APPROVE_WITH_CONDITIONS` / `REWORK`) | Conditions or notes |
|---|---|---|---|
| 1 | AI-POL-003 | [ ] | |
| 2 | Credential-shaped detection coverage | [ ] | |
| 3 | Blocked-data rules | [ ] | |
| 4 | Token-prefix ownership | [ ] | |
| 5 | Provider network boundary | [ ] | |
| 6 | Permitted telemetry | [ ] | |
| 7 | Prohibited logging | [ ] | |
| 8 | Provider credential storage | [ ] | |
| 9 | Adapter isolation | [ ] | |
| 10 | Retry behaviour | [ ] | |
| 11 | Circuit breaker | [ ] | |
| 12 | Kill-switch enforcement | [ ] | |
| 13 | Budget enforcement | [ ] | |
| 14 | No Product mutation | [ ] | |
| 15 | No AutoSuggestions direct apply | [ ] | |

Security owner (name / role): ____________________  Date: ____________________

## 8. What this pack does not do

It signs nothing and records no approval. It adds no detector, validator, guard, code, flag, budget, key, tenant enablement or network path. It does not loosen any existing AI validator. The `pim1_` detector (F-1) is described, not implemented. The kill-switch drill and the first provider call remain held.
