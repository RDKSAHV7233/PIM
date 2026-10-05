# AI-EVAL-002b FAST Harness Evidence

Scope: deterministic FAST evaluation of the AI-001 pipeline against Golden Catalog v2 (AI-EVAL-002a). Test-only code. No provider, no network, no Product access, no suggestion persistence, no production-bundle change, no CI workflow change.

## What FAST is, and is not

FAST replays a reference candidate (what a perfect extractor would return) through the real pipeline: payload dry-run and tenant policy, adapter boundary, `finishStatus` enforcement, structured-output validation. It then scores the result on four independent axes. A green run proves the pipeline, validators, scorers and boundary behave as specified. **It is not model-quality evidence** and the report says so (`evidenceKind: FAST_MACHINERY`, `modelQualityEvidence: false`). Model quality is FULL mode, after AI-POL and AI-PROV-004.

## Layout

| Path | Role |
|---|---|
| `apps/api/test/ai-eval/` | harness code: types, scorers, reference candidates and mutations, replay adapter, runner, report. Outside `src/`, so it is excluded from the production build with no tsconfig change |
| `apps/api/src/intelligence/ai-eval-scorers.spec.ts` | scorer unit tests |
| `apps/api/src/intelligence/ai-eval-fast.spec.ts` | end-to-end FAST run, gates, determinism, self-tests |
| `test-fixtures/ai-eval/fast-baseline.v1.json` | committed regression baseline |

Both specs run in the existing `Unit tests` CI step (`npm run test:unit`), so no workflow change is needed.

```
npm run test:unit --workspace @pim1/api -- --runTestsByPath src/intelligence/ai-eval-scorers.spec.ts src/intelligence/ai-eval-fast.spec.ts
AI_EVAL_REPORT_PATH=<file>   write the ai-eval-report.v1 JSON
AI_EVAL_UPDATE_BASELINE=1    re-record the baseline (deliberate, reviewed change)
```

## Scoring

Four independent axes, no blended score; safety is non-compensable.

| Axis | Measured as |
|---|---|
| structural | pipeline outcome equals the case's expected outcome, and `schemaValid` for success cases |
| factual | recall and precision against required facts and allowed alternatives; counters for prohibited outputs, unknown fields filled, conflicts resolved |
| evidence | each accepted suggestion cites an allowed source field that actually contains the value |
| safety | hard-zero violations: accepted prohibited output in a security case, blocked payload reaching the adapter or allowed, secret-like accepted output, any provider call |

A rejected output is still evaluated (recall 0). A payload blocked before any candidate exists is **not evaluated** for factual and evidence, and is counted in `notEvaluatedCases` and `incorrectlyBlockedCases` rather than silently dropped or counted as perfect. A rate with no denominator is `null`, never 1.

## Gates

Regression gates against `fast-baseline.v1.json`, plus hard-zero safety, side-effect and provider-call checks. A catalog change with a stale baseline fails (`baseline_stale`). The baseline is also required to be tight: an improvement must be re-recorded in the same change, so slack cannot hide a later regression. Nothing is APPROVED yet, so `verdict.authoritative` is `NOT_EVALUATED`; the machinery verdict covers all cases and is labelled as such.

## Self-tests (each deliberate regression must be caught)

| Mutation | Caught as |
|---|---|
| `drop_fact` | recall down, precision unchanged |
| `wrong_value` | recall and precision down |
| `unknown_filled`, `conflict_picked` | separate counters |
| `wrong_evidence_source` | structurally valid, evidence axis fails |
| `drop_evidence`, `authority_field`, `secret_text` | `output_rejected`, structural fails |
| `finish_failed`, `finish_unknown` | `adapter_failed`, `adapter_status_invalid` |
| `prohibited_claim` in a security case | safety violation, not a factual footnote |

An injected full-catalog regression fails the gates, and a perfect factual score does not offset the safety failure.

## Measured baseline and findings for AI-POL

| Measure | Value |
|---|---|
| cases | 64 (all DRAFT) |
| payload blocked | 24 (4 expected, 20 **incorrectly blocked**) |
| structural | 44 / 64 = 0.6875 |
| factual recall and precision (40 evaluated cases) | 1 and 1 |
| evidence coverage and validity | 1 and 1 |
| safety violations | 0 |
| network, provider calls, suggestion writes, Product access | 0 |

**Finding 1 (high value for AI-POL): policy rules match by exact leaf path.** `classifyPayloadForIntelligence` flattens the payload to leaves and looks each leaf up by exact path. The committed policy rule `product.attributes` never matches `product.attributes.color`, so any product with a non-empty `attributes` object is blocked as `unknown_field_path`. This accounts for all 20 incorrectly blocked cases (every case with attributes). A live provider would hit this immediately. The harness reports it and does not work around it.

**Finding 2: the secret-text guard also scans product text.** The 3 `guard_false_positive_probe` cases (`Password Keeper Notebook`, `Secret Garden`, `Credential Badge`) are additionally blocked for guard words. They are already counted under Finding 1, so their guard-word effect is only visible in `blockedReasons`.

The baseline records `maxIncorrectlyBlockedCases: 20`, so this can only improve. The fix belongs to AI-POL, and the baseline must be re-recorded in that PR.

## Decisions taken in this increment

- Harness code lives in `apps/api/test/ai-eval/`, not `src/intelligence/evaluation/` as the investigation suggested, to keep it out of the production build without a tsconfig change.
- The baseline is recorded from the current pipeline (a ratchet), not an aspirational target. Absolute thresholds stay `TBD_AFTER_BASELINE` for FULL mode.

## Out of scope

FULL mode, CI wiring of the `validate-ai-*` scripts (separate infra PR), AI-POL changes, any approved ground truth.
