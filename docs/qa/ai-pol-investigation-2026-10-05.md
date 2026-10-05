# AI-POL Investigation: payload policy path semantics

Date: 2026-10-05
Baseline: `origin/main` at `22905574` (includes the AI-EVAL FAST harness, #1163)
Type: investigation only. No product code, schema, fixture or CI change in this increment.

Trigger: the FAST baseline records `incorrectlyBlockedCases: 20`. This document explains why, what else the same code gets wrong, and proposes explicit path semantics with a corrected acceptance target.

## 1. Blast radius

- `classifyPayloadForIntelligence` is called only from inside `IntelligenceService` (the payload dry-run and the adapter contract runner). Nothing else in `apps/`, `packages/` or `scripts/` calls it.
- The only HTTP route in the intelligence module is `GET boundary`. There is no route to create or edit a tenant policy.
- `upsertTenantPolicy` has no caller in the repo, and the `ai_tenant_policy` migration inserts no rows. No code path in the repo creates a policy. (Production rows cannot be ruled out from the repo alone, but nothing here can have created them.)
- `fieldClassifications` is a JSON column, so a semantics change needs no migration.

Changing semantics therefore affects no live behaviour. It affects the service, its tests, the static fixture and validators, and the FAST harness.

## 2. Current behaviour (code facts)

`classifyPayloadForIntelligence` in `intelligence.service.ts`:

1. Flatten the payload to leaves. Objects recurse; an **array is a single leaf** at the array's path; primitives are leaves; empty objects produce no leaf.
2. Look up each leaf by **exact path** in the tenant policy's `fieldClassifications`.
3. No rule: the leaf is recorded as unknown and treated with `defaultClassification` (`AI_BLOCKED` by default), so the payload is blocked.
4. `AI_BLOCKED`: blocked. `AI_ALLOWED_WITH_REDACTION`: blocked unless the exact path is in `redactedFields`.
5. For any other leaf whose value is a **string**, apply the secret-text guard (`hasSecretLikeText`, a bare-word regex). Only string leaves are scanned; key names, arrays and numbers are not.

Matching is exact, case-sensitive and by full path. There is no inheritance, wildcard or specificity rule, and no document describes one. The AI-POL-001 doc is explicitly a static foundation, and the committed fixture simply lists container paths such as `product.attributes` and `product.supplierSpecifications` as `AI_ALLOWED`.

## 3. Probe results (current behaviour, run against the committed fixture policy)

| # | Payload shape | Result today | Assessment |
|---|---|---|---|
| P01 | `product.attributes = {color: "navy"}` | blocked, unknown path | **usability bug** (the 20 cases) |
| P11 | `product.supplierSpecifications = {material: ...}` | blocked, unknown path | same bug; the fixture lists this as allowed |
| P12 | `supplierSpecifications = "cotton 100%"` | allowed | works only because it is a string |
| P03 | `attributes = "navy cotton"` | allowed | exact rule matches a scalar |
| P02 | `attributes = {}` | allowed | empty object has no leaf; harmless |
| P07 | `customer = {}` | allowed | empty blocked parent has no data; harmless |
| P08 | `connector.apiKey = ""` | blocked | blocked by path, regardless of value |
| P10 | title `Secret Garden Colouring Book` | blocked | text-guard false positive |
| P09 | `attributes.password = "x"` | blocked | blocked only because the path is unknown |
| P13 | literal key `"product.title"` at top level | allowed | **path ambiguity**: a dotted key is indistinguishable from a nested path |
| P14 | literal key `"product.attributes.color"` | blocked (unknown) | same ambiguity, fails closed today |
| **P04** | `attributes = ["api key abc123"]` | **allowed** | **security gap** |
| **P05** | `categoryPath = ["Apparel", "password hunter2"]` | **allowed** | **security gap** |
| **P06** | `categoryPath = [{token: "abc"}]` | **allowed** | **security gap** |
| P15 | `media.extra.a = 1` | blocked, unknown | fails closed |
| P16, P17 | number, boolean, null leaves | allowed | not text; acceptable |

## 4. Findings

- **F1 (usability, the 20 cases).** Exact-path matching means the container rule `product.attributes` never covers `product.attributes.<key>`. All 20 should-succeed cases that carry a non-empty `attributes` object are blocked. `supplierSpecifications` has the same defect. A real product always has attributes, so a live provider would be unusable.
- **F2 (security gap, array contents are never scanned).** Arrays are single leaves and the text guard only scans string leaves. Secret-like text inside any array (`categoryPath`, an attributes array) bypasses the guard, and objects nested in arrays are not classified at all. This exists today, independent of F1.
- **F3 (key names are never scanned).** The guard looks at values only. Today a secret-named key under `attributes` is stopped only because its path is unknown. **Any fix for F1 that allows children would silently reopen this** unless key names are checked too.
- **F4 (path ambiguity).** Keys containing dots collide with nested paths (P13). Harmless today, but it becomes an evasion route once wildcards exist, so payload key segments must be validated.
- **F5 (two matchers).** The static fixture validator (`validate-ai-pol-provider-payload-policy.cjs`) has its own exact-path matcher separate from the service. Changing one without the other would let them diverge.
- **F6 (acceptance target is not reachable by path semantics alone).** Of the 20 blocked cases, 3 (`guard_false_positive_probe`: Password Keeper Notebook, Secret Garden, Credential Badge) are *also* blocked by the bare-word text guard. A path fix takes 20 to **3**, not 0. Reaching 0 requires refining the text guard, which weakens a security control and needs Security sign-off. It should be a separate story.

## 5. Options

| Option | Description | Verdict |
|---|---|---|
| A. Explicit path grammar | `a.b` exact, `a.b.*` direct children, `a.b.**` full subtree; deny-overrides precedence; validated segments | **Recommended.** Auditable, backward compatible, no silent widening |
| B. Implicit prefix inheritance | a rule on `a.b` also covers everything under it | Rejected. Silently changes the meaning of every existing rule, cannot be narrowed to one level, and `internalNotes`-style exceptions become error-prone |
| C. Reshape payloads in the builder (flatten attributes to a string/array) | keep exact matching | Rejected. Loses structure that evidence and provenance need, and moves a policy decision into every caller |

## 6. Proposed semantics (Option A)

**Rule grammar.** A rule path is dot-separated segments. A segment is `[A-Za-z0-9_-]+`. The last segment may instead be `*` or `**`. Anything else (empty segment, wildcard mid-path, wildcard mixed with letters, whitespace, leading or trailing dot) is rejected when the policy is saved, so a bad rule fails at write time, not at classification time.

| Rule | Matches |
|---|---|
| `product.attributes` | exactly that leaf (a scalar or array value). Unchanged from today |
| `product.attributes.*` | direct children only; not the parent, not grandchildren |
| `product.attributes.**` | any descendant (one or more segments below); not the parent |

**Precedence: deny overrides.** For a leaf, collect every matching rule. Any `AI_BLOCKED` match blocks. Else any `AI_ALLOWED_WITH_REDACTION` match requires the exact path in `redactedFields`. Else `AI_ALLOWED`. No match falls to `defaultClassification` (unknown). Consequence: a wildcard allow can never override a more specific block, and there are no allow exceptions inside a blocked subtree. That is intentionally conservative.

**Payload-side hardening (these close F2 to F4 and make wildcards safe):**
1. Every payload key segment must match `[A-Za-z0-9_-]+`. A leaf with a non-conforming key (dots, spaces, `*`) is blocked as `invalid_path_segment`. This removes the dotted-key ambiguity. Callers must normalise supplier attribute keys before building the payload.
2. For a leaf matched by a **wildcard** rule, run the secret-text check on the wildcard-matched key segments. A key such as `password` or `apiKey` under `attributes.*` is blocked as `secret_like_key`.
3. Arrays: scan every string element with the text guard. Scalar elements are otherwise governed by the array's own path rule. **Objects inside arrays are blocked** (`unsupported_array_element`) in this version, fail closed. Revisit only when a case needs them (for example `media.altText`).
4. Keep the empty-container behaviour: no data, no leaf, no decision.

**Fixture and validator.** Change the committed policy rules `product.attributes` and `product.supplierSpecifications` to `product.attributes.*` and `product.supplierSpecifications.*` (keep the exact form only if a scalar value must remain legal). Both the service and the static validator must use **one set of conformance vectors**, stored as data (`test-fixtures/ai-policy/path-semantics.v1.json`) and consumed by a Jest spec and by the CJS validator, so the two matchers cannot diverge (F5).

## 7. Corrected acceptance target

Two stories, because the text guard is a separate security trade-off.

**AI-POL-002: explicit path semantics, array scanning, key-name guard**

```
FAST incorrectlyBlockedCases      20 -> 3   (the 3 remaining are the guard-word probes)
FAST structural                   0.6875 -> 0.9531 (61/64) expected; measured and re-recorded in the PR
safety violations                 0
blocked secret paths allowed      0   (customer.*, auth.password, connector.*, billing.*, tenant.internalKey)
unknown unsafe paths allowed      0   (conformance vectors, incl. dotted keys, secret-named keys, array contents)
provider calls during FAST        0
Product mutation / suggestion writes   0
```

**AI-POL-003: text-guard refinement (needs Security approval)**

```
FAST incorrectlyBlockedCases      3 -> 0
```

Replace bare-word matching on free text with detection of credential-shaped content (key/value assignments such as `password=...`, `Bearer <token>`, provider key prefixes, JWT and long hex/base64 strings), while keeping word-level blocking on **key names**. This shrinks false positives but also changes what the guard catches, so it needs its own adversarial vectors and Security sign-off. Until then the baseline ceiling stays at 3.

## 8. Test plan for AI-POL-002

- Conformance vectors (data-driven): exact, `*`, `**`, parent-not-matched, grandchild-not-matched-by-`*`, deny-overrides, redaction interaction, invalid rule grammar rejected at save, invalid payload segment blocked.
- P01 to P17 above, each with its new expected result. P04 to P06 become *blocked*; P01, P11 become *allowed*; P09 becomes blocked as `secret_like_key`; P13, P14 become blocked as `invalid_path_segment`.
- FAST harness: re-run and confirm `incorrectlyBlockedCases` 20 to 3, safety 0, `unexpectedlyAllowed` 0, then re-record `fast-baseline.v1.json` with the evidence in the PR. The harness's own "baseline must be tight" test enforces that.
- Existing classification tests (unknown fields blocked, `AI_BLOCKED`, redaction, secret-like values) stay green unchanged.
- `validate-ai-pol-tenant-policy-runtime.cjs` pattern checks keep passing, or are updated in the same PR with justification.

## 9. Open decisions

1. **Grammar sign-off:** `*` and `**` as the last segment only, segment charset `[A-Za-z0-9_-]`. Owner: Security + CTO.
2. **Deny-overrides with no allow exceptions** inside blocked subtrees. Owner: Security.
3. **Objects inside arrays blocked for now** (fail closed). Owner: QA + PIM SME, because it affects media and variant data later.
4. **Key normalisation is the payload builder's job.** Non-conforming keys are blocked, not repaired. Owner: Backend.
5. **AI-POL-003 (text-guard refinement)** as a separate, Security-approved story, or accept a permanent ceiling of 3 probe cases. Owner: Security + QA.

## 10. Sequence

```
AI-POL investigation (this PR, docs only)
  -> owners confirm sections 6, 7 and 9
  -> AI-POL-002 branch from fresh origin/main (includes #1164 if merged, otherwise rebase)
  -> rerun FAST, confirm 20 -> 3 with safety 0, re-record baseline with evidence
  -> AI-POL-003 (Security-gated), 3 -> 0
  -> AI-PROV-004
```

AI-PROV-004 stays on hold until AI-POL-002 is implemented and the baseline is re-recorded.
