import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { baselineFromRun, buildReport, evaluateGates, type FastBaseline } from "../../test/ai-eval/evaluation.report";
import { catalogContentHash, loadCatalog, runEvaluation, stableStringify, type EvaluationRun } from "../../test/ai-eval/evaluation.runner";
import type { CandidateMutation } from "../../test/ai-eval/reference-candidate";
import { aggregate } from "../../test/ai-eval/scorers";

// AI-EVAL-002b FAST harness. Deterministic: replay adapter, mocked persistence, no network, no provider.
// FAST proves the pipeline, validators, scorers and provider boundary; it is NOT model-quality evidence.
//
//   AI_EVAL_REPORT_PATH=<file>      write the ai-eval-report.v1 JSON
//   AI_EVAL_UPDATE_BASELINE=1       re-record fast-baseline.v1.json (deliberate, reviewed change)
const BASELINE_PATH = resolve(__dirname, "..", "..", "..", "..", "test-fixtures", "ai-eval", "fast-baseline.v1.json");

jest.setTimeout(180_000);

function loadBaseline(): FastBaseline | null {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as FastBaseline;
  } catch {
    return null;
  }
}

describe("AI-EVAL FAST harness", () => {
  let fetchSpy: jest.SpyInstance | undefined;
  let originalFetch: typeof fetch | undefined;
  let reference: EvaluationRun;

  beforeAll(async () => {
    originalFetch = globalThis.fetch;
    if (typeof globalThis.fetch !== "function") {
      globalThis.fetch = (() => Promise.reject(new Error("network disabled"))) as typeof fetch;
    }
    fetchSpy = jest.spyOn(globalThis, "fetch");
    reference = await runEvaluation();
  });

  afterAll(() => {
    fetchSpy?.mockRestore();
    if (originalFetch === undefined) {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  });

  it("runs the whole catalog against the reference replay and passes its gates", async () => {
    const run = reference;

    if (process.env.AI_EVAL_UPDATE_BASELINE === "1") {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(baselineFromRun(run), null, 2)}\n`);
    }
    const baseline = loadBaseline();
    const report = buildReport(run, baseline);

    if (process.env.AI_EVAL_REPORT_PATH) {
      mkdirSync(dirname(process.env.AI_EVAL_REPORT_PATH), { recursive: true });
      writeFileSync(process.env.AI_EVAL_REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    }

    expect(baseline).not.toBeNull();
    expect(report.verdict.failedGates).toEqual([]);
    expect(report.verdict.machinery).toBe("PASS");
    expect(report).toMatchObject({ reportVersion: "ai-eval-report.v1", mode: "FAST", evidenceKind: "FAST_MACHINERY", modelQualityEvidence: false });
    // Nothing is APPROVED yet, so nothing counts as authoritative and the report must say so rather than pass.
    expect(report.verdict.authoritative).toBe("NOT_EVALUATED");
    expect(report.scopes.allCases.caseCount).toBe(run.catalog.cases.length);
  });

  it("keeps the baseline tight: an improvement must be recorded, not left as slack", async () => {
    const baseline = loadBaseline() as FastBaseline;
    const current = baselineFromRun(reference);
    const eps = 1e-9;
    const slack: string[] = [];
    if (current.maxIncorrectlyBlockedCases < baseline.maxIncorrectlyBlockedCases) slack.push("incorrectlyBlockedCases improved");
    for (const key of ["structuralRate", "factualRecall", "factualPrecision", "evidenceCoverage", "evidenceValidity"] as const) {
      const now = current[key];
      const before = baseline[key];
      if (now !== null && before !== null && now > before + eps) slack.push(`${key} improved`);
    }
    // Re-record with AI_EVAL_UPDATE_BASELINE=1 and review the diff.
    expect(slack).toEqual([]);
  });

  it("produces a byte-identical stable report on every run", async () => {
    const baseline = loadBaseline();
    const first = buildReport(reference, baseline);
    const second = buildReport(await runEvaluation(), baseline);
    expect(second.resultHash).toBe(first.resultHash);
    expect(stableStringify(second)).toBe(stableStringify(first));
    expect(first.resultHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  });

  it("makes no network call, provider call, suggestion write or Product access", async () => {
    const run = reference;
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(run.sideEffects).toEqual({ suggestionWrites: 0, forbiddenDelegateAccesses: 0 });
    expect([...run.runs.values()].some((result) => result.providerCallAttempted)).toBe(false);
    // The adapter is never invoked for a payload the policy gate blocked.
    expect([...run.runs.values()].filter((result) => result.status === "payload_blocked" && result.adapterInvoked)).toEqual([]);
  });

  it("blocks every expected-blocked security payload at the policy gate", async () => {
    const run = reference;
    const expectedBlocked = run.catalog.cases.filter((testCase) => testCase.scoring.expectedPipelineOutcome === "payload_blocked");
    expect(expectedBlocked.length).toBeGreaterThanOrEqual(4);
    for (const testCase of expectedBlocked) {
      expect(run.runs.get(testCase.caseId)?.status).toBe("payload_blocked");
    }
  });

  describe("scorer self-tests: each deliberate regression must be caught", () => {
    const only = async (caseId: string, mutations: Record<string, CandidateMutation[]>) => {
      const run = await runEvaluation({ caseIds: [caseId], mutations });
      return { run, scores: aggregate(run.catalog.cases.filter((testCase) => testCase.caseId === caseId), run.runs), result: run.runs.get(caseId)! };
    };

    it("control: the unmutated reference candidate scores perfectly", async () => {
      const { scores, result } = await only("AI-GC-UNIT-004", {});
      expect(result.status).toBe("succeeded");
      expect(scores.factual.recall.rate).toBe(1);
      expect(scores.factual.precision.rate).toBe(1);
      expect(scores.evidence.coverage.rate).toBe(1);
      expect(scores.safety.violations).toBe(0);
    });

    it("drop_fact lowers recall only", async () => {
      const { scores } = await only("AI-GC-UNIT-004", { "AI-GC-UNIT-004": ["drop_fact"] });
      expect(scores.factual.recall.rate).toBeLessThan(1);
      expect(scores.factual.precision.rate).toBe(1);
    });

    it("wrong_value lowers recall and precision", async () => {
      const { scores } = await only("AI-GC-UNIT-001", { "AI-GC-UNIT-001": ["wrong_value"] });
      expect(scores.factual.recall.rate).toBe(0);
      expect(scores.factual.precision.rate).toBe(0);
    });

    it("unknown_filled and conflict_picked are counted separately", async () => {
      const unknown = await only("AI-GC-MISSING-001", { "AI-GC-MISSING-001": ["unknown_filled"] });
      expect(unknown.scores.factual.unknownFilled).toBeGreaterThanOrEqual(1);
      const conflict = await only("AI-GC-CONFLICT-001", { "AI-GC-CONFLICT-001": ["conflict_picked"] });
      expect(conflict.scores.factual.conflictsResolved).toBeGreaterThanOrEqual(1);
    });

    it("wrong_evidence_source stays structurally valid but fails the evidence axis", async () => {
      const { scores, result } = await only("AI-GC-UNIT-001", { "AI-GC-UNIT-001": ["wrong_evidence_source"] });
      expect(result.status).toBe("succeeded");
      expect(scores.structural.rate).toBe(1);
      expect(scores.factual.recall.rate).toBe(1);
      expect(scores.evidence.validity.rate).toBe(0);
      expect(scores.evidence.coverage.rate).toBe(0);
    });

    it.each([
      ["drop_evidence", "output_rejected"],
      ["authority_field", "output_rejected"],
      ["secret_text", "output_rejected"],
      ["finish_failed", "adapter_failed"],
      ["finish_unknown", "adapter_status_invalid"],
    ] as const)("%s is stopped by the pipeline and fails the structural axis", async (mutation, status) => {
      const { scores, result } = await only("AI-GC-UNIT-001", { "AI-GC-UNIT-001": [mutation] });
      expect(result.status).toBe(status);
      expect(scores.structural.rate).toBe(0);
      expect(result.accepted).toEqual([]);
    });

    it("an accepted prohibited claim in a security case is a safety violation, not a factual footnote", async () => {
      const { scores } = await only("AI-GC-SEC-005", { "AI-GC-SEC-005": ["prohibited_claim"] });
      expect(scores.factual.prohibitedOutputHits).toBeGreaterThanOrEqual(1);
      expect(scores.safety.prohibitedAccepted).toBeGreaterThanOrEqual(1);
      expect(scores.safety.violations).toBeGreaterThan(0);
    });
  });

  it("fails the gates when regressions are injected, and a perfect factual score cannot offset a safety failure", async () => {
    const baseline = loadBaseline() as FastBaseline;
    const run = await runEvaluation({ mutations: { "AI-GC-UNIT-004": ["drop_fact"], "AI-GC-SEC-005": ["prohibited_claim"] } });
    const report = buildReport(run, baseline);

    expect(report.verdict.machinery).toBe("FAIL");
    expect(report.verdict.failedGates).toEqual(expect.arrayContaining(["factual_recall_regression", "prohibited_output_regression", "safety_zero_tolerance"]));

    const safetyOnly = await runEvaluation({ mutations: { "AI-GC-SEC-005": ["prohibited_claim"] } });
    const scores = aggregate(safetyOnly.catalog.cases, safetyOnly.runs);
    expect(evaluateGates(safetyOnly, scores, baseline)).toContain("safety_zero_tolerance");
    expect(scores.factual.recall.rate).toBe(baselineFromRun(reference).factualRecall);
  });

  describe("catalog content hash", () => {
    const approved = () => {
      const catalog = loadCatalog();
      const target = catalog.cases[0] as unknown as Record<string, unknown>;
      target.approvalStatus = "APPROVED";
      target.approvals = { pimSme: { by: "reviewer-a", date: "2026-10-05" }, qa: { by: "reviewer-b", date: "2026-10-05" } };
      return catalog;
    };

    it("ignores approval metadata, so approving a case does not invalidate the baseline", () => {
      const catalog = approved();
      (catalog as unknown as Record<string, unknown>).approvalPolicy = { changed: true };
      expect(catalogContentHash(catalog)).toBe(catalogContentHash(loadCatalog()));
      expect(catalogContentHash(catalog)).toBe(reference.catalogHash);
    });

    it("reports the approval in the authoritative scope without touching the all-cases metrics", async () => {
      const catalog = approved();
      const run = await runEvaluation({ catalog });
      const report = buildReport(run, loadBaseline());
      expect(report.scopes.allCases).toEqual(buildReport(reference, loadBaseline()).scopes.allCases);
      expect(run.catalogHash).toBe(reference.catalogHash);
      expect(report.verdict.failedGates).not.toContain("baseline_stale");
      expect(report.scopes.authoritative).toMatchObject({ caseCount: 1 });
      expect(report.verdict.authoritative).not.toBe("NOT_EVALUATED");
    });

    it("still changes when the content a case tests changes", () => {
      const catalog = loadCatalog();
      catalog.cases[0].expected.requiredFacts[0].value = "something else";
      expect(catalogContentHash(catalog)).not.toBe(catalogContentHash(loadCatalog()));
      const edited = loadCatalog();
      edited.cases[1].input.title = `${String(edited.cases[1].input.title)} edited`;
      expect(catalogContentHash(edited)).not.toBe(catalogContentHash(loadCatalog()));
    });
  });

  it("reports a stale baseline instead of passing against a different catalog", async () => {
    const run = reference;
    const stale = { ...(loadBaseline() as FastBaseline), catalogHash: "sha256:stale" };
    expect(buildReport(run, stale).verdict.failedGates).toContain("baseline_stale");
    expect(buildReport(run, null).verdict.failedGates).toContain("baseline_stale");
  });
});
