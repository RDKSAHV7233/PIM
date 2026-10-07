# AI network-guard transition plan (Stream B, B8)

Date: 2026-10-07
Baseline: `origin/main` at `a475cc0f` (line numbers below are as of that commit)
Type: **documentation and test plan only.** No validator, spec, guard, CI step or source file is changed by this document. The existing guards keep forbidding network code **everywhere** until 004b-ii-a is separately authorised.
Status: **proposal / awaiting human approval** (Security, Backend, QA).

## 1. The transition in one line

| | Rule |
|---|---|
| **Today** | network, provider SDK and provider-client code are forbidden **everywhere** in governed AI code |
| **After 004b-ii-a** | allowed **only** in one approved directory, `apps/api/src/intelligence/live/` (the adapter zone), held to stricter positive rules; forbidden everywhere else exactly as today |

The change is a **scan-scope change plus one new validator**, not a loosening of any pattern. No regular expression is relaxed. Where the new rule needs the old validators not to see the zone, the zone directory is **excluded from the network and credential rules only**; the SDK-import rule keeps scanning the zone.

## 2. Inventory of today's guards

| # | Guard | What it forbids | Scope it scans | Effect on a `live/` directory |
|---|---|---|---|---|
| G1 | `validate-ai-sec-no-direct-product-writes.cjs` (`GOVERNED_FORBIDDEN_PATTERNS`, line 19 on) | SDK imports (`openai`, `@anthropic-ai/sdk`, ...); client instantiation incl. the literal `ProviderAdapter`; provider execution calls incl. `fetch(`, `axios.post/get/request(`; Product, Catalog, AutoSuggestions imports; write routes | `GOVERNED_AI_DIRS`: `apps/api/src/intelligence`, `ai`, `ai-core`, `rejection-intelligence` (directory scan, recursive) | would **fail** on the zone's `fetch(`; needs a scoped exclusion for the `provider_execution_call` rule only |
| G2 | `validate-ai-prov-provider-execution-eligibility.cjs` (`source.sdk`, `source.network`, `source.credentials`, lines about 288 to 296) | SDK imports; `fetch(`, `axios.`, `undici`, `node:http(s)`, `new OpenAI`, `new Anthropic`, `XMLHttpRequest`; any `api_key`, `authorization:` or `bearer ` in the control, gates, maintenance and money files | `governedSource`: every non-spec source file under `apps/api/src/intelligence` (recursive) | would **fail** on the zone's network use; the credentials rule reads four named files, so the zone is unaffected |
| G3 | `validate-ai-prov-adapter-contract.cjs` (`source.network`, `source.sdk`, `source.config`, line 111 on) | `fetch(`, `axios.`, `httpClient.`, clients; SDK imports; **`process.env`, `API_KEY`, `SECRET`, `TOKEN`** | six **named** files only (service, types, module, fixture adapter, controller, boundary) | the zone is **not scanned** by this validator at all, so it needs no exclusion, but it also does **not police** the zone: the zone validator (section 4) must |
| G4 | `validate-ai-core-capability-registry.cjs` (line 73), `validate-ai-core-provider-payload-dry-run.cjs` (line 42), `validate-ai-pol-tenant-policy-runtime.cjs` (line 72), `validate-ai-prov-output-validation.cjs` (line 63) | `fetch(`, `axios.`, provider names, `ProviderAdapter` (the Vexa-owned `IntelligenceProviderAdapter` is carved out), Product mutation, Catalog and AutoSuggestions services | one **named** file each (registry, service) | unaffected; they keep forbidding network in those files, which is correct |
| G5 | `intelligence.module.spec.ts` (line 42) | `fetch(` in the module source | the module file | unaffected; the module wires the live adapter by token, it does not contain network code |
| G6 | `ai-eval-fast.spec.ts` (lines 26 to 97), `intelligence-execution-control.service.spec.ts` (lines 29 to 59) | **runtime**: `globalThis.fetch` is spied and asserted **not called** | the FAST harness run, the control-plane tests | unaffected, and must stay: they prove no outbound call from FAST or the control plane |

## 3. Verified weaknesses of the current guards (tighten, do not relax)

These are in the current guards on `main` and are independent of the zone; closing them is a **tightening** that belongs in the transition PR or just before it.

| # | Weakness | Evidence |
|---|---|---|
| W1 | Aliasing defeats the `fetch(` pattern: `const f = fetch; f(url)` does not match `\bfetch\s*\(` | checked against the G1 and G2 regexes: no match |
| W2 | Only G2 forbids `node:http` and `node:https`, and only for the string `node:https?`; `node:net`, `node:tls`, `node:dns`, `node:dgram`, `node:http2`, `node:child_process` and `node:worker_threads` are not forbidden anywhere | `import("node:net")` does not match G2's pattern |
| W3 | Dynamic loading (`require(...)`, `import(...)` with a computed specifier), `eval` and `new Function` are not forbidden | no pattern covers them |
| W4 | `WebSocket`, `EventSource` and `navigator.sendBeacon` are not forbidden | no pattern covers them |
| W5 | G3 does not scan the zone and G4 scans named files only, so a **new file** in `apps/api/src/intelligence` that is not named in any validator is covered only by G1 and G2 (recursive). That is acceptable today; it is why the zone needs its own validator | file lists above |

Proposed tightening (for the transition PR): replace the bare `fetch\s*\(` by the token `\bfetch\b` (any reference, call or alias); add `node:(net|tls|dns|dgram|http2|child_process|worker_threads)`; forbid `\brequire\s*\(`, dynamic `import(` with a non-literal, `\beval\b`, `new Function`, `WebSocket`, `EventSource`, `sendBeacon`. **Caveat found while checking:** G1 scans spec files as well as sources (its extension list includes every `.ts`), and the existing specs name the function as a string (`jest.spyOn(globalThis, "fetch")` in `ai-eval-fast.spec.ts` and `intelligence-execution-control.service.spec.ts`). A bare `fetch` token rule would fail them, so the tightened rule must either skip `*.spec.ts` or match identifier use only and not string literals; the transition PR must prove which on today's source (commit 1 in section 6). A regular-expression scan is a lint, not a proof; the runtime fetch-spy tests (G6) remain the second line.

## 4. The zone validator (new in 004b-ii-a)

A single new validator, `scripts/validate-ai-prov-live-adapter-zone.cjs`, picked up automatically by the existing `scripts/validate-ai-*.cjs` CI gate, with a `.test.cjs` of negative cases. It enforces:

**Zone content (positive rules):**

| Rule id | Rule |
|---|---|
| Z1 | the zone directory exists and contains **exactly** the allow-listed file names (`credential-source.ts`, `request-mapper.ts`, `live-adapter.ts`, `response-mapper.ts`, `error-normalizer.ts`); a new or renamed file fails until the allow-list is edited, which is a reviewed change |
| Z2 | **exactly one** file (`live-adapter.ts`) contains `fetch`, **exactly one** reference, and its URL argument is a `const` string literal for the single approved HTTPS host (never a variable, template or concatenation) |
| Z3 | that call sets `redirect: "error"` and an `AbortSignal` with the configured timeout |
| Z4 | no loop construct or `retry`/`attempt` identifier encloses the call (retries belong to the orchestrator); heuristic, backed by the unit test below |
| Z5 | no import of Prisma, Nest `Injectable`-dependent services, or anything from Product, Catalog, Quality, AutoSuggestions, `intelligence.service` or the control service |
| Z6 | `process.env` is read **only** in `credential-source.ts`, only for the one approved variable name, and that function returns nothing when it is unset |
| Z7 | no logger import, no `console.`, and no template or concatenation that places a variable named like a body, response, prompt, payload or key into a thrown message |
| Z8 | no SDK import (the G1 and G2 SDK rule still scans the zone) |
| Z9 | a CODEOWNERS entry for the zone exists (existence only: review enforcement is unavailable on the current plan, B2 finding F-2) |

**Import graph (outside the zone):**

| Rule id | Rule |
|---|---|
| I1 | the **only** importers of the zone are the orchestrator and the module wiring (allow-listed by path); any other importer fails |
| I2 | no `*.spec.ts` outside the zone's own tests, and nothing under `apps/api/test/ai-eval/`, imports the zone (FAST can never reach a live adapter) |
| I3 | no file under Product, Catalog, Quality or AutoSuggestions imports the zone or the orchestrator |
| I4 | the existing `INTELLIGENCE_PROVIDER_ADAPTER` token is still bound to the fixture adapter, and the live adapter is bound to a different token |

**Positive-result assertions.** Per the testing standard, a validator that finds nothing must not pass vacuously: the validator fails if the zone is missing in the post-transition state, if Z2 finds zero or more than one `fetch`, and if the importer scan finds the orchestrator zero times.

## 5. Required negative tests

Each row is a mutation applied to a copy of the governed source in the validator's test, with the validator expected to **fail** with the named rule. The first five are the programme's required cases.

| # | Mutation | Expected failure |
|---|---|---|
| N1 | `fetch(` added to a file **outside** the zone (service, module, controller, FAST harness, `ai-core`) | G1 `provider_execution_call` and G2 `source.network` |
| N2 | a provider SDK import added **anywhere**, including the zone | G1 `provider_sdk_import`, G2 `source.sdk`, Z8 |
| N3 | a generic HTTP client outside the zone: `axios.post(`, `undici`, `node:https`, `XMLHttpRequest`, `http.request(` | G1 and G2 (W2 tightening adds the other node modules) |
| N4 | a Product, Catalog, Quality or Product-module file that imports the zone or the orchestrator | I3 and the G1 Product rules |
| N5 | an `auto-suggestions` file or any AutoSuggestions reference importing the adapter | I3 and G1 `auto_suggestions_reuse` |
| N6 | the alias `const f = fetch;` outside the zone | the tightened `\bfetch\b` rule (fails today: proves W1 is closed) |
| N7 | a second `fetch` in the zone, in another zone file | Z2 |
| N8 | the zone URL built from a variable, a template literal or a concatenation | Z2 |
| N9 | `redirect: "error"` removed; `AbortSignal` removed | Z3 |
| N10 | a `for`, `while` or `retry` wrapped around the zone call | Z4 |
| N11 | a Prisma, Product, Catalog, Quality, AutoSuggestions or `intelligence.service` import inside the zone | Z5 |
| N12 | `process.env` read in a zone file other than `credential-source.ts`; or a second variable name read there | Z6 |
| N13 | `console.log(response)`, `logger.error(body)` or a thrown message interpolating a prompt, payload or key variable in the zone | Z7 |
| N14 | a new file added to the zone that is not on the allow-list | Z1 |
| N15 | the FAST harness or any spec importing the zone | I2 |
| N16 | the service, module or controller importing the zone directly | I1 |
| N17 | the live adapter bound to `INTELLIGENCE_PROVIDER_ADAPTER` | I4 |
| N18 | `WebSocket`, `EventSource`, `sendBeacon`, `child_process`, a dynamic `require(` or `import(` outside the zone | the W2 to W4 tightening |
| N19 | the CODEOWNERS entry removed | Z9 |
| N20 | the zone deleted or emptied | Z1 and the positive-result assertion |

**Runtime tests that stay and are added:** the existing `fetch`-spy tests (G6) stay as they are. New: a test that, with the key variable unset, **no request leaves the process** (the shell requirement); a test, with `globalThis.fetch` stubbed, that the live adapter calls it exactly once with the one URL literal, `redirect: "error"`, an `AbortSignal`, and a body containing no tenant identifier (B7, section 11).

## 6. Sequencing inside 004b-ii-a

1. **Commit 1:** the zone validator and its `.test.cjs` with N1 to N20, plus the tightening of W1 to W4 in the existing validators, **with no zone directory yet**. CI shows the tightened guards green on today's source (proving the tightening does not break existing code) and the negative tests failing for the right reasons.
2. **Commit 2:** the scoped exclusion of the zone directory from G1's `provider_execution_call` rule and G2's `source.network` rule only, and the import-graph rules.
3. **Commit 3:** the zone shell (no orchestrator), the CODEOWNERS entry, and the test that no request leaves with the key unset.
4. PR description carries the **mutation evidence**: for each of N1 to N20, the failing validator output. A reviewer can re-run them.

## 7. Rollback

Reverting the PR restores the global prohibition: the zone directory is deleted, the exclusion is removed, and the tightened patterns (W1 to W4) may stay. Because no caller exists in 004b, nothing depends on the zone at runtime.

## 8. Dependencies and non-goals

- **Depends on** the Stream A readiness signal, B2 (Security accepts that validators, not CODEOWNERS, carry the control), B7 (design) and the human decisions in the ledger. **Until all hold, none of this is implemented.**
- **Non-goals:** implementing any of this now; loosening any pattern; choosing an SDK (plain `fetch`; if Security later chooses an SDK its exact package name is added to a zone-only allow-list in a separate reviewed change); a CI branch-protection change (unavailable on the plan).

## 9. Decision block (blank)

| Decision | Owner | Decision (`APPROVE` / `APPROVE_WITH_CONDITIONS` / `REWORK`) | Name, date |
|---|---|---|---|
| Scan-scope change instead of pattern relaxation | Security | [ ] | |
| Tightening W1 to W4 as a precondition | Security + Backend | [ ] | |
| Zone validator rules Z1 to Z9 and I1 to I4 | Security + QA | [ ] | |
| Negative test matrix N1 to N20 | QA | [ ] | |
| Sequencing and mutation evidence in the PR | CTO | [ ] | |

## 10. What this document does not do

It changes no validator, spec, guard, workflow or source file and authorises no implementation. Network code remains forbidden everywhere in governed AI code on `main`.
