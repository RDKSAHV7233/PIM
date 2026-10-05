# AI-POL-002 Explicit Path Semantics Evidence

Scope: implements sections 6 to 8 of `ai-pol-investigation-2026-10-05.md` (merged in #1165). No provider, route, schema, migration, Product or CI-workflow change. Classification has no caller outside `IntelligenceService`, and no code path in the repo creates tenant policies, so no live behaviour changes.

## Semantics implemented

| Rule | Meaning |
|---|---|
| `a.b.c` | exact leaf (unchanged) |
| `a.b.*` | direct children of `a.b` only |
| `a.b.**` | any descendant of `a.b` |

- A wildcard is only valid as the last segment; segments are `[A-Za-z0-9_-]+`. Invalid rule paths are rejected when a tenant policy is saved (`upsertTenantPolicy`). A stored rule that no longer satisfies the grammar is dropped at classification time, so the leaves it covered fail closed as unknown.
- Deny overrides: any matching `AI_BLOCKED` rule wins, then `AI_ALLOWED_WITH_REDACTION`, then `AI_ALLOWED`. No allow exceptions inside a blocked subtree.
- Matching is segment-wise and case-sensitive (`product.attributesX` is not under `product.attributes`).

Payload-side hardening, which closes the investigation's F2 to F4:

| Behaviour | Reason code |
|---|---|
| a payload key that is not `[A-Za-z0-9_-]+` (dots, spaces, `*`) blocks the leaf | `invalid_path_segment` |
| a wildcard-admitted key that looks like a credential (`password`, `secretKey`, `clientSecret`, `access-token`) blocks the leaf | `secret_like_key` |
| string elements of an array are scanned by the text guard | `secret_like_text` |
| objects or arrays inside an array block the leaf (fail closed) | `unsupported_array_element` |
| a payload whose root is not an object is blocked | `unsupported_payload_shape` |

`blockedReasons` on the classification result carries reason codes only, never paths or values. The key-name check is stricter than the value check: separators are dropped before matching, because the value guard only matches whole words and would miss camelCase compounds such as `secretKey`.

## One matcher contract, two implementations

`test-fixtures/ai-policy/path-semantics.v1.json` holds data-driven vectors (rule grammar, payload segments, secret-like keys, and 16 resolution cases). The TypeScript matcher (`intelligence-payload-policy.ts`) and the static validator's CommonJS port must both satisfy every vector, so they cannot diverge. The validator tests also confirm the vectors can fail (a wrong expectation is detected).

The committed policy fixture now uses `product.attributes.*` and `product.supplierSpecifications.*`. The validator additionally classifies the fixture's own example payloads leaf by leaf: the allowed example must have no blocked leaf, each blocked example must have at least one, and each wildcard rule is shown to be load-bearing by removing it.

## Behaviour change versus the investigation probes

| Probe | Before | After |
|---|---|---|
| P01 `attributes.color` | blocked (unknown) | **allowed** |
| P11 `supplierSpecifications.material` | blocked (unknown) | **allowed** |
| P04/P05 secret text inside an array | **allowed** | blocked `secret_like_text` |
| P06 object inside an array | **allowed** | blocked `unsupported_array_element` |
| P09 `attributes.password` | blocked (unknown) | blocked `secret_like_key` |
| P13 literal key `"product.title"` | allowed | blocked `invalid_path_segment` |
| P08 `connector.apiKey = ""` | blocked | blocked |
| root payload is a string or array | allowed (nothing classified) | blocked `unsupported_payload_shape` |

## Acceptance (measured with the FAST harness)

| Target | Before | After |
|---|---|---|
| incorrectly blocked cases | 20 | **3** |
| structural | 44/64 = 0.6875 | **61/64 = 0.953125** |
| factual recall and precision | 95/95 | 150/150 (57 cases now reach the scorers) |
| evidence coverage and validity | 95/95 | 150/150 |
| safety violations | 0 | **0** |
| expected-blocked payloads blocked (customer, connector, auth, billing) | 4/4 | **4/4**, reason `blocked_by_policy` |
| unexpectedly allowed | 0 | **0** |
| provider calls, suggestion writes, Product access | 0 | **0** |

The 3 remaining cases are exactly the `guard_false_positive_probe` cases (Password Keeper Notebook, Secret Garden, Credential Badge), now blocked only for `secret_like_text`. **The earlier "20 to 0" target is not reachable by path semantics alone** (see the investigation, F6). Taking those 3 to 0 means refining the text guard, which needs Security sign-off and is a separate story (AI-POL-003). `fast-baseline.v1.json` is re-recorded with `maxIncorrectlyBlockedCases: 3` and the new structural rate; the catalog hash is unchanged. The harness's "baseline must be tight" test failed against the old baseline with exactly `incorrectlyBlockedCases improved` and `structuralRate improved`, which is how the re-record was forced and reviewed.

## Verification (local)

- 7 intelligence suites, 188 tests pass (new: matcher vectors, 19 service tests for the semantics and hardening).
- All 28 `validate-ai-*` scripts pass, run as the CI step runs them.
- `tsc -p tsconfig.json` shows no error in `src/intelligence` or `test/ai-eval`.
- Local `node_modules` had a stale Prisma client, so Jest ran with ts-jest diagnostics off and `tsc` was filtered for the missing-model errors. CI is the authoritative build.

## Out of scope

Text-guard refinement (AI-POL-003, Security-gated), objects inside arrays (`media`, variants), payload-builder key normalisation (callers must normalise supplier keys; non-conforming keys are blocked, not repaired), FULL-mode evaluation, AI-PROV-004.
