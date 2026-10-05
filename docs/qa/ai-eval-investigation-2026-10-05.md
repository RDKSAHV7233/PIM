# AI-EVAL Investigation (pre AI-EVAL-002)

Date: 2026-10-05
Baseline: `origin/main` at `1e45faa8` (includes AI-PROV-003b, merge `0dd732b9`)
Type: investigation only. No harness code, no schema, no provider, no CI change in this increment.

## 0. Preflight: #1158 / `0dd732b9`

| Check | Result |
|---|---|
| PR #1158 checks | 6/6 pass: detect-changes, build, connector-network-transport (22, 24), backend-tests, e2e |
| Check runs on merge commit `0dd732b9` | 7/7 success, including `deploy-staging` |
| `0dd732b9` ancestor of `origin/main` | yes |

The evaluation baseline starts from a green, deployed AI-PROV-003b.

## 1. Findings that change the plan

1. **`AI-EVAL-001` is already taken.** #1132 shipped a static Golden Catalog foundation: `test-fixtures/ai-eval/golden-catalog.v1.json` (8 items), `scripts/validate-ai-eval-golden-catalog.cjs` (+ test), a README and a plan doc. The deterministic harness must therefore be **AI-EVAL-002**, not a second AI-EVAL-001.
2. **The existing catalog blends axes into one weighted score.** `evaluationAxes` is five weighted axes summing to 100 (factuality 35, completeness 25, taxonomy fit 20, safety 10, channel neutrality 10). That is exactly the single "AI score" to avoid, and it lets safety be traded against completeness. v1 stays untouched as historical compatibility only; v2 defines independent axes (structural, factual, evidence, safety) with independent gates.
3. **No AI validator runs in CI.** No workflow or `package.json` script references any `validate-ai-*` script, including the AI-EVAL-001 validator. They run only when someone runs them by hand. By contrast `npm run test:unit --workspace @pim1/api` (every `*.spec.ts`) runs in the `backend-tests` job. A Jest spec is therefore a CI entrypoint with **zero workflow changes**.
4. **The existing fixture adapter cannot drive an evaluation.** `FixtureIntelligenceAdapter` echoes `product.title`. FAST mode needs a replay adapter that serves recorded candidate outputs per case, including deliberately flawed ones.
5. **FAST mode measures the pipeline and the scorers, not model quality.** Replayed output is fixed, so FAST proves the harness catches regressions in validation, policy and scoring. It says nothing about a model. Reports must label this to avoid it being read as quality evidence.
6. **"Gate B" for VEXA-AI-001 is not defined in the repo.** The only "Gate B" docs are unrelated programme gates. The report schema below is a proposal; the Gate B consumer contract needs a CTO/QA decision.
7. **Pipeline text guard can reject legitimate catalog text.** `hasSecretLikeText` rejects any string containing words such as `token`, `password`, `secret`, `credential`. Injection and secret-leak cases will be blocked by design, but benign product copy containing those words would also be rejected. The harness must distinguish "blocked as expected" from "blocked wrongly" and record that as a separate counter.

## 2. Inventory: REUSE / EXTEND / NEW / DEFER

| Candidate | Where | Decision | Notes |
|---|---|---|---|
| Golden catalog v1 (8 items) | `test-fixtures/ai-eval/golden-catalog.v1.json` | **REUSE** | Keep untouched and ID-stable. Import the 8 items into v2 by reference. Source of `requiredFacts` / `allowedInferences` / `disallowedClaims` / `qualitySignals`. |
| Catalog validator | `scripts/validate-ai-eval-golden-catalog.cjs` | **EXTEND** | Hard-codes `catalogId` and `version === 1`. Add a v2 validator beside it. Reuse its forbidden-binding-key walk (`provider`, `model`, `route`, `tenantKey`, ...). Avoid those key names in v2. |
| Review-workflow case fixtures | `test-fixtures/ai-gov/review-workflow-cases.v1.json` (9) | **REUSE** | Pattern for case-style fixtures and stale/wrong-tenant/idempotency cases. |
| Provider payload policy examples | `test-fixtures/ai-policy/provider-payload-policy.v1.json` (18 fields, 1 allowed + 3 blocked examples) | **REUSE** | Seeds for security cases: PII, secret, connector credential payloads. |
| Telemetry / provenance fixtures | `test-fixtures/ai-core/*.v1.json` | **REUSE** | Provenance field expectations for the evidence axis. |
| Structured-output validation | `IntelligenceService.validateStructuredOutputForSuggestions` | **REUSE** | Source of the structural verdict. Do not re-implement. |
| Pipeline entry | `IntelligenceService.runFixtureAdapterContract` | **REUSE** | The only service call the harness should make. |
| Provider-neutral interface | `IntelligenceProviderAdapter` | **REUSE** | Replay adapter implements it. |
| Fixture adapter | `FixtureIntelligenceAdapter` | **REUSE (unchanged)** | Stays the module binding. Not an evaluation driver. |
| Replay adapter | none | **NEW** | Test-only, never in module providers. Serves recorded candidates by case ID. |
| Scorers (structural, factual, provenance, safety) | none; no precision/recall code relevant to AI | **NEW** | Pure TS, no Nest, no Prisma. |
| Catalog completeness / quality scoring | `test:integration:catalog-completeness`, marketplace readiness | **DEFER / do not couple** | Product-quality domain. Evaluation must not import it. |
| `rejection-intelligence` scoring | `apps/api/src/rejection-intelligence` | **DEFER / do not couple** | Different feature, not AI-001. |
| Golden catalog v2 schema + 50-75 cases | none | **NEW** | See section 4. |
| Thresholds file | none | **NEW** | Versioned, per axis. |
| Report writer (machine-readable) | none | **NEW** | See section 6. |
| CI entrypoint | `backend-tests` runs all `*.spec.ts` | **REUSE** | A Jest spec runs in CI with no workflow edit. |
| CI wiring of existing `validate-ai-*` scripts | `.github/workflows/ci.yml` | **NEW, separate PR** | CI risk domain. Not bundled with harness work. |
| Provider-backed (FULL) evaluation | none | **DEFER** | After AI-POL and a controlled provider (AI-PROV-004). |

## 3. Where evaluation lives

```
apps/api/src/intelligence/evaluation/     pure TS: scorers, runner, report types, replay adapter
apps/api/src/intelligence/evaluation/*.spec.ts   CI entrypoint (picked up by test:unit)
test-fixtures/ai-eval/                    catalog v2, candidates, thresholds (data only)
scripts/validate-ai-eval-golden-catalog-v2.cjs   static schema validator (data only)
```

Rules:
- `evaluation/` imports only `intelligence.types`, `IntelligenceService` (its public runner method) and its own files. It must not import Product, Catalog, Quality, AutoSuggestions, connectors or any provider SDK.
- Nothing under `evaluation/` is registered in `IntelligenceModule`, so it has no runtime path and no route.
- The existing `ProviderAdapter` tripwires already forbid concrete provider names; the replay adapter is named `ReplayEvaluationAdapter` and implements `IntelligenceProviderAdapter`.
- The harness uses the same mocked-Prisma approach as the existing intelligence specs, so it persists nothing and writes no Product data.

## 4. Golden Catalog v2 schema (proposed)

New file `golden-catalog.v2.json`; v1 is not modified.

```
caseId              stable, unique (v1 IDs reused: AI-GC-APP-001 ...)
capability          one of the AI-001 in-scope capability IDs
category            clean_extraction | messy_supplier_text | units_specs | ambiguity |
                    contradiction | invalid_data | missing_data | security_adversarial
input               fixture product payload (no binding keys)
expected
  requiredFacts       [{field, value, source}]
  allowedAlternatives [{field, acceptedValues[], basis}]   normalised synonyms and units
  allowedInferences   [{field, value, basis}]              carried from v1
  mustRemainUnknown   [field]                              no source, no fact
  prohibitedOutputs   [string | {field, pattern}]          carried from v1 disallowedClaims
provenanceExpectations
  [{field, mustCite: sourceField[], minEvidence}]
securityTags        [] e.g. prompt_injection, secret_exfiltration, pii, authority_field_override,
                    instruction_in_data
approvalStatus      DRAFT | APPROVED   (DRAFT excluded from authoritative scoring)
scoring
  weightInAxis        per-axis case weight (never a cross-axis weight)
  criticality         standard | high | zero_tolerance
  expectedPipelineOutcome   succeeded | payload_blocked | output_rejected
```

Each case carries `approvalStatus: DRAFT | APPROVED`. Cases without PIM SME approval of their expected facts stay `DRAFT` and are excluded from authoritative scoring (they may run, but are reported separately and never count toward a gate). Security cases additionally need Security approval.

Dataset target: about 60 cases.

| Group | Cases |
|---|---|
| Clean extraction (incl. the 8 v1 items) | 12 |
| Messy supplier text | 10 |
| Units and specs | 8 |
| Ambiguity | 6 |
| Contradictions | 6 |
| Invalid data | 6 |
| Missing data / no-source | 6 |
| Security / adversarial (prompt injection in descriptions, secret-like text, authority-field override attempts, blocked-field payloads, unsupported health claims) | 10 |

## 5. Scores: four independent axes, never one number

| Axis | Measures | Source of truth | Gate style |
|---|---|---|---|
| Structural | pipeline outcome and `schemaValid` per case | `runFixtureAdapterContract` result | rate vs threshold |
| Factual | precision and recall against `requiredFacts` and `allowedAlternatives`; prohibited-output hits; unknown-stays-unknown | catalog expected data | rate vs threshold; prohibited hit is its own counter |
| Evidence / provenance | every suggestion cites a real input source that supports the value | catalog `provenanceExpectations` plus input | rate vs threshold |
| Safety (non-compensable) | forbidden mutation, secret or PII exposure, injection compliance, blocked field crossing, authority-field override | catalog `securityTags` plus pipeline result | **hard zero**, not a rate |

Safety is **non-compensable**: a perfect score on any other axis never offsets a safety failure, and there is no blended score. `incorrectlyBlockedCases` (a legitimate case blocked, for example by the secret-text guard) is a first-class report metric, so over-aggressive blocking cannot pass as safe behaviour. `schemaValid = true` is not factual correctness, and the factual score must be computable when structure fails (counted as zero recall, not skipped). Cost, latency and tokens are reported as informational fields, FULL mode only.

## 6. Execution modes and report

Semantics (decided, see section 8):

- **FAST** = deterministic evaluation of the pipeline, schemas, scorers, provenance handling, security handling and replay behaviour. It does not measure model quality.
- **FULL** = controlled live-provider evaluation of factual quality, evidence quality, model behaviour, latency and cost.
- **Gate B consumes FAST evidence only** until AI-PROV-004 has produced FULL baselines. FAST proves the evaluation machinery and provider boundary are safe and deterministic. FULL thresholds apply later, before live-provider acceptance and pilot progression.

| Mode | Adapter | Used for | Network |
|---|---|---|---|
| `FAST` | `ReplayEvaluationAdapter` serving recorded candidates, including deliberately flawed "mutant" candidates that each scorer must catch | every PR via `test:unit` | none |
| `FULL` | controlled real provider | provider, prompt or schema changes; release candidates | **DEFERRED**; added only after AI-POL and AI-PROV-004 |

FAST thresholds are regression-based against a committed baseline (a deterministic replay should not move). Absolute pilot thresholds apply to FULL.

Report `ai-eval-report.v1` (JSON, stable key order, no timestamps inside the hashed section):

```
reportVersion, mode, catalogVersion, catalogHash, thresholdsVersion, gitSha
adapter {adapterKey}, providerCallsAttempted (must be 0 in FAST)
axes {structural, factual, provenance, safety}   each with numerator, denominator, rate, threshold, pass
counters {prohibitedOutputHits, incorrectlyBlockedCases, unexpectedlyAllowed, zeroToleranceViolations}
cases [{caseId, category, outcome, perAxis, failures[]}]
verdict PASS | FAIL, failedGates[]
resultHash          sha256 of the stable section
```

The report is written only when an output path is given by environment variable. Default runs write nothing. The Gate B consumer contract is an open decision (section 8).

## 7. Next story

**AI-EVAL-002: Golden Catalog deterministic execution harness**

Acceptance criteria:
- Runs locally and in CI through `npm run test:unit --workspace @pim1/api` with no workflow change
- Uses the replay/fixture adapter only
- Scores structure separately from truth
- Scores provenance separately from truth
- Supports security/adversarial cases with a zero-tolerance safety gate
- Produces a stable machine-readable report (same input gives byte-identical stable section and `resultHash`)
- Fails on configured regression thresholds, proven by mutant candidates each scorer must catch
- No network, no provider SDK, no Product mutation, no suggestion persistence
- `providerCallsAttempted` is 0 in FAST

Proposed PR split (respects the PR-size and single-risk-domain rules):
1. **AI-EVAL-002a** (fixtures and validation only): `golden-catalog.v2.json` with the v1 items carried over, the new cases, the v2 validator and its test.
2. **AI-EVAL-002b** (harness): `evaluation/` scorers, replay adapter, candidates, thresholds, runner spec, report writer.
3. **Separate infra PR** (CI risk domain, optional): wire the existing `validate-ai-*` scripts and the v2 validator into `ci.yml`.

## 8. Decisions (recorded for owner confirmation in this PR)

These were set by the programme direction on 2026-10-05. They become binding when the owners below confirm them on this PR. **AI-EVAL-002a does not start until that confirmation.**

| Topic | Decision |
|---|---|
| `ai-eval-report.v1` ownership | QA / AI Evaluation owns generation and interpretation. CTO and Security are required reviewers for Gate B use. Backend is accountable for fixing harness or runtime defects the report surfaces. Product / PO is not the technical consumer. |
| Threshold authority | QA / AI Evaluation proposes. PIM SME signs factual and evidence thresholds. Security signs safety thresholds. CTO signs structural and reliability thresholds and the final Gate B technical acceptance. FAST safety is hard-zero. No model-quality thresholds are invented before FULL baselines exist; they stay `TBD_AFTER_BASELINE`. |
| Existing AI validators in CI | Yes, as a separate infra PR after this docs PR, independent of AI-EVAL-002a and 002b so evaluation logic and CI plumbing are not coupled. |
| Ground truth for the new cases | PIM SME is the primary approver of expected facts. QA verifies case quality and ambiguity. Security approves adversarial and security cases. Unapproved cases are `DRAFT` and excluded from authoritative scoring. |
| Text-guard false positives | Reported as the first-class metric `incorrectlyBlockedCases`. Whether to refine the guard itself is a later AI-POL decision. |

What must be frozen before AI-EVAL-002a: the ownership model and the score semantics (four independent axes, non-compensable safety, FAST versus FULL). Numeric model-quality thresholds do not need to be frozen.

Execution sequence:

```
1. Push ai-eval-investigation, open this docs-only PR
2. Owners confirm report ownership, threshold authority, ground-truth ownership
3. Merge this PR
4. AI-EVAL-002a  v2 fixtures + validator
5. AI-EVAL-002b  FAST harness + machine-readable report
6. Separate CI infra PR  validate-ai-* wiring
7. AI-POL
8. AI-PROV-004
9. FULL evaluation mode
```

## 9. Result

```
Golden Catalog fixtures      EXTEND  (v1 REUSE as-is; v2 NEW superset, ~60 cases)
Scoring engine               NEW     (pure TS, four independent axes)
Security cases               EXTEND  (REUSE ai-policy blocked examples; NEW adversarial cases)
CI entrypoint                REUSE   (Jest spec in test:unit; validator wiring is a separate PR)
Provider-backed eval         DEFER   (FULL mode after AI-POL and AI-PROV-004)
```
