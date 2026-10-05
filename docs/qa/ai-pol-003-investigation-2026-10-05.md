# AI-POL-003 Investigation: secret-text guard semantics

Date: 2026-10-05
Baseline: `origin/main` at `17e51916` (includes AI-POL-002)
Type: investigation only. No product code, fixture, schema or CI change. The experiments below were run on temporary working-tree patches that were reverted; nothing is committed.

Goal: take the 3 remaining false positives to 0 (`incorrectlyBlockedCases` 3 to 0) **without weakening real credential protection**. This changes a security control, so Security owns the decision. This document defines the replacement semantics and the evidence for them so Security can approve or amend them before any code.

## 1. Headline

The current guard is both **too aggressive and not aggressive enough**. Measured on a prototype comparison:

| Measure | Current bare-word guard | Proposed explicit detections |
|---|---|---|
| innocent product phrases flagged (36) | **24** | **0** |
| the 3 catalog probe cases | blocked | pass |
| real-format credential samples caught (37) | **15 (41%)** | **32 (86%)** |
| "mention without a value" phrases flagged (6) | 5 | 0 (by design) |

The current guard misses most real credential formats because they contain no keyword: cloud access key ids, Slack, Stripe, Google, SendGrid, Shopify and WooCommerce tokens, JWTs, `Authorization: Basic ...` headers, and database URLs with an embedded password. Replacing bare words with explicit credential shapes removes the false positives and catches more real secrets.

## 2. Where the guard lives

One bare-word regex, five copies:

| Copy | Used for |
|---|---|
| `IntelligenceService.hasSecretLikeText` | input leaf classification (strings and array elements); `assertSafeJson` on model output, evidence citations, reviewer edits and the `evaluation` JSON; operational text (`safeText`) |
| `apps/api/test/ai-eval/scorers.ts` (`SECRET_LIKE`) | safety scorer, mirrors the service |
| `scripts/validate-ai-eval-golden-catalog-v2.cjs` (`SECRET_LIKE`) | catalog guard-word probe check, mirrors the service |
| `scripts/validate-ai-pol-provider-payload-policy.cjs` (`SECRET_VALUE_PATTERN`) | static fixture validation |
| `apps/api/src/audit/audit.service.ts` (`isSensitiveTextValue`) | audit metadata redaction. Out of scope: it redacts rather than rejects, so a false positive there is harmless |

No reusable credential-shape detector exists elsewhere in the repo. This is NEW work.

**The guard is not only on the input side.** `assertSafeJson` applies it to model output values and to evidence citations, which usually quote source text. Fixing input classification alone would clear the payload block but the probes would then be rejected on output. The experiment in section 4 confirms the replacement works end to end only when both sides change.

## 3. Findings

- **F1: false positives are structural.** A bare word cannot tell `Password Keeper Notebook` from a credential. In the benign corpus, 24 of 36 innocent phrases (67%) were flagged.
- **F2: false negatives are the bigger risk.** 22 of 37 real-format samples were not flagged by the current guard. Several are the exact formats Vexa connectors handle (Shopify admin tokens, WooCommerce consumer key and secret).
- **F3: one rule is being used for two different jobs.** Free-text product content (where legitimate words occur) and operational identifier fields (provider keys, ids, notes, where no secret-ish word should ever appear) share the same check. They need different strictness.
- **F4: five copies drift.** They must become one module plus shared vectors, as AI-POL-002 did for path semantics.
- **F5: the FAST metric has a blind spot.** `incorrectlyBlockedCases` counts only `payload_blocked`. A guard false positive on output surfaces as `output_rejected` and would not be counted separately. A `incorrectlyRejectedCases` counter is needed.
- **F6: the evidence is author-constructed.** The benign and credential corpora were written for this investigation. No production supplier text was sampled. See section 8.

## 4. Experiments

All run against the committed catalog and committed policy fixture, on temporary patches.

**4.1 Corpus comparison (prototype detectors, scratch spec).** Credential samples were assembled at runtime from fragments so no token-shaped literal appears in any file.

| Corpus | n | Current | Proposed required set |
|---|---|---|---|
| catalog input strings | 462 | flags exactly the 3 probes | flags none |
| innocent product phrases | 36 | 24 false positives | 0 |
| mention-only phrases ("bearer token leaked", "includes the password") | 6 | 5 flagged | 0 |
| real-format credentials | 37 | 15 caught | 32 caught |
| innocent text shaped like an assignment ("Password: optional on this journal") | 3 | 3 flagged | 3 flagged (known residual) |

Not caught by the required set: prose disclosures with `is`/`was`, a bare long hex digest, a base64 blob with no header, and a keyword split across words. These are the optional rules D3b and D6 (section 5) or accepted residuals.

**4.2 End-to-end FAST with the replacement swapped in at the value level.** Structural **64/64**, `incorrectlyBlockedCases` **0**, the 3 probes `succeeded` with their suggestions accepted, safety violations **0**. Then the existing intelligence and harness suites were run against the same patch to find what behaviour changes: 6 tests fail, and each is an informative decision, not a bug:

| Failing test | What it encodes | Proposed resolution |
|---|---|---|
| FAST "baseline must be tight" | the improvement itself | re-record the baseline |
| "rejects secret-like values even in allowed fields" and "rejects provider output containing secret-like generated values" | prose that only *mentions* a secret ("bearer token leaked") | accept: no value, no credential. This is the false-positive class |
| "keeps the secret-text guard on wildcard-admitted string values" | "includes the password" | accept, same reason |
| "rejects sensitive suggestion payloads" | a fake marker value (`api_key_should_not_be_here`) used as a test token | accept for free text; cover credential shapes with real vectors instead |
| "rejects sensitive telemetry values" | an operational field (`providerKey`) containing an api-key-like name | **keep strict**: this is the identifier context (F3) |

Notably the prose-with-value cases ("password hunter2", "api key abc123", the `secret_text` mutant) stay blocked, because of rule D3c.

## 5. Proposed detection semantics

Explicit, enumerated detections. Nothing is "looks secret-ish".

| ID | Detection | Example shape (described, not a literal) |
|---|---|---|
| D1 | PEM private key header | the `BEGIN ... PRIVATE KEY` marker line |
| D2 | authorization header or bearer token | `Authorization:` with Bearer/Basic/Digest/Token and a value; `Bearer` followed by 12 or more token characters |
| D3 | key/value assignment | a credential keyword, then `:` or `=`, then a value of 4 or more characters (covers JSON, query strings and `.env` style) |
| D3c | keyword, whitespace, digit-bearing value | "password" or "api key" followed by a token that contains a digit and is at least 4 characters |
| D4 | well-known token prefixes | cloud access key id, GitHub, Slack, Stripe, OpenAI/Anthropic style, Google, SendGrid, **Shopify**, **WooCommerce**, JWT |
| D5 | connection string with embedded password | `scheme://user:password@host`, including empty-user forms such as Redis |
| D3b (optional) | prose disclosure | keyword, then `is`/`was`, then a value containing a digit or symbol |
| D6 (optional) | long bare hex digest | 40 or more hex characters |

Credential keywords for D3, D3c and D3b: password, passwd, pwd, secret, client secret, api key, access key, auth token, access token, refresh token, private key, token, credential(s).

**Recommendation for the optional rules:** D3b ON (no false positives in any corpus because it requires a digit or symbol in the value). D6 OFF until production text is sampled, because product data may legitimately contain hashes.

### Two guard modes (resolves F3)

| Mode | Used for | Behaviour |
|---|---|---|
| FREE_TEXT | input string leaves and string array elements; model output values; evidence citations; reviewer-edited values | D1 to D5 and D3c (plus D3b if approved) |
| STRICT | operational identifier fields and notes (`safeText`, policy fields, telemetry), the `evaluation` JSON, and **all JSON key names** | unchanged bare-word check for values; the stricter `isSecretLikeKey` (separators dropped, so camelCase compounds are caught) for keys |

Key names currently use the bare-word value check in `assertSafeJson`; moving them to `isSecretLikeKey` makes them consistent with the wildcard-key check added in AI-POL-002. It is slightly stricter (camelCase compounds are now caught) and is called out as a decision.

### One implementation, shared vectors (resolves F4)

A single `intelligence-secret-detection.ts` exports both modes. The harness scorer imports it directly. The static policy validator and the catalog validator use CommonJS ports. All must satisfy shared data-driven vectors in `test-fixtures/ai-policy/secret-detection.v1.json`. **Credential vectors are stored as fragment lists joined at test time, never as literals**, so (a) no token-shaped string is committed, which would trip secret scanning and push protection, and (b) nobody mistakes a vector for a live credential. Innocent-text vectors are a separate named list so a regression back to bare-word matching is caught by name.

## 6. What changes, and what is lost (for Security to accept knowingly)

Lost, by design, in FREE_TEXT mode:
- text that only mentions a credential word without a value (`bearer token leaked`, `includes the password`, `Do not share your secret`)
- the fake marker value `api_key_should_not_be_here` in output values
- prose with no digit ("password hunter"), a base64 blob with no header, a keyword split across words ("pass word is x")

Residual false positives that remain: innocent text shaped like an assignment (`Password: optional on this journal`, `Token: brass, 25 mm`). Assignment-shaped text is exactly what a credential looks like, so this is accepted rather than tuned away.

Gained: detection of the 17 real-format samples the current guard misses, including connector-relevant token formats.

## 7. Acceptance targets for AI-POL-003 (implementation)

```
Usability
FAST incorrectlyBlockedCases       3 -> 0
FAST structural                    61/64 -> 64/64 (measured in experiment 4.2)
innocent-text corpus               0 flagged, as a named, separately failing test list
(including the 3 catalog probes and words: token, password, key, secret, credential, oauth, bearer)

Security
every credential category in D1..D5 and D3c blocked (fragment-assembled vectors)
API keys, Bearer/Authorization headers, password assignments, connection strings blocked
credential-shaped content blocked in input leaves, array elements, model output values,
  evidence citations and reviewer edits
STRICT fields and all key names unchanged or stricter
safety violations                  0
blocked secret paths allowed       0
provider calls / Product mutation  0
```

Also add the `incorrectlyRejectedCases` counter (F5) and re-record `fast-baseline.v1.json` with evidence in the same PR.

## 8. Risks and open decisions

1. **Context split (FREE_TEXT vs STRICT)** and the call-site mapping in section 5. Owner: Security.
2. **Detection set:** approve D1 to D5 and D3c; decide D3b (recommend ON) and D6 (recommend OFF). Owner: Security.
3. **Accept the loss of mention-only detection** listed in section 6. Owner: Security + QA.
4. **Key-name check consistency** (`isSecretLikeKey` for every key). Owner: Security.
5. **Token-prefix list ownership.** New provider formats appear over time; D4 needs an owner and an update trigger (for example when a connector or provider is added). Owner: Backend + Security.
6. **Corpus caveat.** The corpora here are author-constructed. Before enabling this against a live provider, Security and PIM SME should supply a tuning set of real supplier text (about 200 items, under privacy review) to measure false positives offline. This is a people task and blocks nothing in AI-POL-003 itself, but it should happen before AI-PROV-004 goes live.
7. **No live behaviour change.** As in AI-POL-002, nothing outside `IntelligenceService` calls classification and no code path creates policies, so the change is observable only in tests and the harness until a provider is wired in.

## 9. Sequence

```
this PR (docs only)
  -> Security confirms sections 5, 6 and 8
  -> AI-POL-003 implementation (module, vectors, call-site mapping, tests, baseline re-record)
  -> FAST rerun: 3 -> 0, safety 0
  -> confirm main CI green
  -> AI-PROV-004 live-provider implementation
```
