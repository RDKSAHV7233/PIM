import type { AxisCounts, GoldenCase, ScopeScores } from "./evaluation.types";
import { aggregate } from "./scorers";
import { sha256, stableStringify, type EvaluationRun } from "./evaluation.runner";

export interface FastBaseline {
  baselineVersion: 1;
  catalogHash: string;
  structuralRate: number | null;
  factualRecall: number | null;
  factualPrecision: number | null;
  evidenceCoverage: number | null;
  evidenceValidity: number | null;
  maxIncorrectlyBlockedCases: number;
  maxProhibitedOutputHits: number;
  maxUnknownFilled: number;
  maxConflictsResolved: number;
}

export type GateName =
  | "baseline_stale"
  | "structural_regression"
  | "factual_recall_regression"
  | "factual_precision_regression"
  | "evidence_coverage_regression"
  | "evidence_validity_regression"
  | "incorrectly_blocked_regression"
  | "prohibited_output_regression"
  | "unknown_filled_regression"
  | "conflict_resolved_regression"
  | "safety_zero_tolerance"
  | "side_effect_detected"
  | "provider_call_detected";

const EPSILON = 1e-9;

export function baselineFromRun(run: EvaluationRun): FastBaseline {
  const scores = aggregate(run.catalog.cases, run.runs);
  return {
    baselineVersion: 1,
    catalogHash: run.catalogHash,
    structuralRate: scores.structural.rate,
    factualRecall: scores.factual.recall.rate,
    factualPrecision: scores.factual.precision.rate,
    evidenceCoverage: scores.evidence.coverage.rate,
    evidenceValidity: scores.evidence.validity.rate,
    maxIncorrectlyBlockedCases: scores.counters.incorrectlyBlockedCases,
    maxProhibitedOutputHits: scores.factual.prohibitedOutputHits,
    maxUnknownFilled: scores.factual.unknownFilled,
    maxConflictsResolved: scores.factual.conflictsResolved,
  };
}

const belowFloor = (axis: AxisCounts, floor: number | null) => floor !== null && (axis.rate === null || axis.rate < floor - EPSILON);

/** FAST gates are regression gates against a committed baseline, plus hard-zero safety. They never blend axes. */
export function evaluateGates(run: EvaluationRun, scores: ScopeScores, baseline: FastBaseline | null): GateName[] {
  const failed: GateName[] = [];
  if (!baseline || baseline.catalogHash !== run.catalogHash) {
    failed.push("baseline_stale");
  } else {
    if (belowFloor(scores.structural, baseline.structuralRate)) failed.push("structural_regression");
    if (belowFloor(scores.factual.recall, baseline.factualRecall)) failed.push("factual_recall_regression");
    if (belowFloor(scores.factual.precision, baseline.factualPrecision)) failed.push("factual_precision_regression");
    if (belowFloor(scores.evidence.coverage, baseline.evidenceCoverage)) failed.push("evidence_coverage_regression");
    if (belowFloor(scores.evidence.validity, baseline.evidenceValidity)) failed.push("evidence_validity_regression");
    if (scores.counters.incorrectlyBlockedCases > baseline.maxIncorrectlyBlockedCases) failed.push("incorrectly_blocked_regression");
    if (scores.factual.prohibitedOutputHits > baseline.maxProhibitedOutputHits) failed.push("prohibited_output_regression");
    if (scores.factual.unknownFilled > baseline.maxUnknownFilled) failed.push("unknown_filled_regression");
    if (scores.factual.conflictsResolved > baseline.maxConflictsResolved) failed.push("conflict_resolved_regression");
  }
  if (scores.safety.violations > 0) failed.push("safety_zero_tolerance");
  if (run.sideEffects.suggestionWrites > 0 || run.sideEffects.forbiddenDelegateAccesses > 0) failed.push("side_effect_detected");
  if (scores.safety.providerCallsAttempted > 0) failed.push("provider_call_detected");
  return failed;
}

function caseRows(cases: GoldenCase[], run: EvaluationRun) {
  return cases.map((testCase) => {
    const result = run.runs.get(testCase.caseId);
    return {
      caseId: testCase.caseId,
      category: testCase.category,
      approvalStatus: testCase.approvalStatus,
      expectedOutcome: testCase.scoring.expectedPipelineOutcome,
      actualOutcome: result?.status ?? "not_run",
      blockedReasons: [...(result?.blockedReasons ?? [])].sort(),
      acceptedSuggestions: result?.accepted.length ?? 0,
    };
  });
}

/**
 * Builds ai-eval-report.v1. Everything inside `stable` is deterministic (no timestamps, ids or paths), so
 * `resultHash` is identical across runs on the same catalog, pipeline and baseline.
 */
export function buildReport(run: EvaluationRun, baseline: FastBaseline | null) {
  const cases = run.catalog.cases;
  const authoritativeCases = cases.filter((testCase) => testCase.approvalStatus === "APPROVED");
  const allCases = aggregate(cases, run.runs);
  const authoritative = authoritativeCases.length > 0 ? aggregate(authoritativeCases, run.runs) : null;
  const failedGates = evaluateGates(run, allCases, baseline);

  const stable = {
    reportVersion: "ai-eval-report.v1",
    mode: "FAST",
    // FAST proves the pipeline, validators, scorers and boundary. It is not model-quality evidence.
    evidenceKind: "FAST_MACHINERY",
    modelQualityEvidence: false,
    catalogId: run.catalog.catalogId,
    catalogVersion: run.catalog.version,
    catalogHash: run.catalogHash,
    adapter: { adapterKey: "replay" },
    providerCallsAttempted: allCases.safety.providerCallsAttempted,
    sideEffects: run.sideEffects,
    scopes: {
      allCases,
      authoritative: authoritative ?? { caseCount: 0 },
    },
    verdict: {
      machinery: failedGates.length === 0 ? "PASS" : "FAIL",
      authoritative: authoritative === null ? "NOT_EVALUATED" : authoritative.safety.violations === 0 ? "THRESHOLDS_TBD_AFTER_BASELINE" : "FAIL",
      failedGates,
    },
    cases: caseRows(cases, run),
  };
  return { ...stable, resultHash: sha256(stableStringify(stable)) };
}

export type EvaluationReport = ReturnType<typeof buildReport>;
