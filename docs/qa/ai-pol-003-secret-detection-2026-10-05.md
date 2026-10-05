# AI-POL-003 Explicit Credential Detection Evidence

Scope: implements sections 5 to 7 of `ai-pol-003-investigation-2026-10-05.md` (merged in #1169). No provider, route, schema, migration, Product or CI-workflow change. As with AI-POL-002, nothing outside `IntelligenceService` calls this code and no code path creates policies, so the change is observable only in tests and the FAST harness until a provider is wired in.

**Assumption to confirm.** #1169 was merged without a recorded Security review comment. This PR treats the merge as the go-ahead for the investigation's recommendations, and asks Security to confirm sections "Decisions implemented" and "What is lost" below on this PR before it is merged. Live-provider work (AI-PROV-004) stays on hold until that confirmation.

## What changed

A single bare-word regex that served two jobs is replaced by two explicit modes in one module, `intelligence-secret-detection.ts`.

| Mode | Used for | Behaviour |
|---|---|---|
| FREE_TEXT | input string leaves and string array elements; model output values (`providerOutput`, `generatedPayload`, `suggestedValue`); evidence citations; reviewer-edited values | explicit credential shapes only (below) |
| STRICT | operational identifier fields and notes (`safeText`: provider key, review reason, ids), and the `evaluation` JSON values | unchanged bare-word check |
| keys | every JSON key name in `assertSafeJson` | always the stricter `isSecretLikeKey` (separators dropped, so `secretKey`, `client_secret`, `access-token` are caught) |

Detections in FREE_TEXT mode (matched text is never returned, only detector ids):

| Detector | Catches |
|---|---|
| `pem_private_key` | the PEM private-key header line |
| `authorization_header` | `Authorization:` with Bearer, Basic, Digest or Token and a value |
| `bearer_token` | `Bearer` followed by 12 or more token characters |
| `keyword_assignment` | a credential keyword, then `:` or `=`, then a value of 4 or more characters |
| `keyword_space_value` | a credential keyword, whitespace, then a digit-bearing token of 4 or more characters |
| `keyword_prose_value` | keyword, `is`/`was`, then a value containing a digit or symbol |
| `token_prefix` | cloud access key id, GitHub, Slack, Stripe, LLM-provider style, Google, SendGrid, **Shopify**, **WooCommerce**, JWT |
| `connection_string` | `scheme://user:password@host`, including empty-user forms such as Redis |

A bare long hex digest (investigation rule D6) is intentionally **not** included: product data may legitimately contain hashes and it needs a production text sample first.

## Shared vectors, and nothing token-shaped committed

`test-fixtures/ai-policy/secret-detection.v1.json` holds the conformance vectors: 34 credentials covering every detector, 37 innocent phrases, 6 mention-only phrases, 3 documented residual false positives, 4 documented residual misses, and STRICT expectations. Credentials are stored as **fragments joined at test time**. A self-check test asserts the vectors file itself contains no contiguous credential shape, which also caught a real mistake while writing it (a database-URL fragment still held a whole scheme). The TypeScript module and the static validator's CommonJS port both satisfy every vector.

## Measured result (FAST harness, re-recorded)

| | Before (#1167) | After |
|---|---|---|
| `incorrectlyBlockedCases` | 3 | **0** |
| `incorrectlyRejectedCases` (new) | not measured | **0** |
| structural | 61/64 | **64/64** |
| factual recall and precision | 150/150 | 158/158 (all 60 should-succeed cases now reach the scorers) |
| evidence coverage and validity | 150/150 | 158/158 |
| safety violations | 0 | **0** |
| expected-blocked payloads (customer, connector, auth, billing) | 4/4 | **4/4**, `blocked_by_policy` |
| provider calls, suggestion writes, Product access | 0 | **0** |

The 3 guard-probe cases (Password Keeper Notebook, Secret Garden, Credential Badge) now succeed end to end, with suggestions accepted. Against the old baseline, only the "baseline must be tight" test failed, with exactly `incorrectlyBlockedCases improved` and `structuralRate improved`, which is how the re-record was forced. The harness scorer now uses the same detection module; the old "guard probe" exemption in the safety scorer is removed, so a credential shape in accepted output is a safety violation in every case.

**New metric `incorrectlyRejectedCases`.** `incorrectlyBlockedCases` only counted `payload_blocked`. A guard false positive on model output or an evidence citation surfaces as `output_rejected` and was invisible. The new counter closes that blind spot and is gated like the others.

## Decisions implemented (from the investigation)

- Context split FREE_TEXT versus STRICT, with the call-site mapping above.
- Detection set: all required detections plus `keyword_prose_value` ON; the long hex digest OFF.
- Key-name consistency: every key goes through `isSecretLikeKey`.

## What is lost, accepted knowingly

Six existing expectations changed, each listed in the investigation:

| Test | Old expectation | Now |
|---|---|---|
| secret-like input value | `bearer token leaked` rejected | a real Bearer credential is rejected; the sentence alone passes |
| secret-like generated value | `bearer token leaked` rejected | a Bearer credential value is rejected |
| sensitive suggestion payload | `api_key_should_not_be_here` rejected | an `api_key=...` assignment is rejected; the marker string alone passes in free text |
| wildcard-admitted string | `includes the password` rejected | a `password=...` assignment is rejected |
| operational telemetry `providerKey` | rejected | **unchanged, still rejected** (STRICT) |
| baseline tightness | n/a | baseline re-recorded |

Text that only mentions a credential word with no value now passes, for example `bearer token leaked` or `Do not share your secret`. Assignment-shaped innocent text (`Password: optional on this journal`) is still flagged on purpose. Documented residual misses: a base64 blob with no header, a keyword split across words, a bare hex digest, and `password hunter` with no digit. Each is a vector, so a change to any of them is deliberate.

Other static fixture validators (`telemetry`, `provenance`, `gov-review`) keep their own bare-word patterns on purpose: they lint synthetic fixtures for hygiene and are not the runtime guard. The v2 catalog validator keeps the bare-word rule for the `guard_false_positive_probe` tag, which is a catalog-hygiene rule: untagged cases must not contain guard words, and the tagged probes must.

## Verification (local)

- 8 intelligence suites, **361 tests pass**: detection vectors, innocent-text and credential tests across input leaves, array elements, output values, citations, generated payloads and reviewer edits, STRICT fields, key names, and the existing path-semantics and harness suites.
- Static policy validator and its tests pass with negative checks that the vectors can fail.
- All **28** `validate-ai-*` scripts pass, run as the CI step runs them.
- `tsc` shows no error in `src/intelligence` or `test/ai-eval`.
- Caveat: local `node_modules` had a stale Prisma client, so Jest ran with ts-jest diagnostics off and `tsc` was filtered for missing-model errors. CI is the authoritative build.

## Open items

- Security confirmation of the decisions and the loss list above.
- A real supplier text tuning set (about 200 items, under privacy review) to measure false positives before a live provider. The corpora used so far are author-constructed.
- Ownership of the token-prefix list as new connectors or providers are added.
- AI-PROV-004 stays on hold until this is merged, Security has confirmed, and CI is green.
