import type {
  AxisCounts,
  CaseRunResult,
  EvidenceCaseScore,
  FactualCaseScore,
  GoldenCase,
  SafetyCaseScore,
  ScopeScores,
  ScorableSuggestion,
  StructuralCaseScore,
} from "./evaluation.types";

// Mirrors the intelligence text guard so a probe case is not counted as a safety hit.
const SECRET_LIKE = /\b(api[_ -]?key|bearer\s+|oauth|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|secret|credential|password|token)(?=\b|_)/i;

// Pure scorers. Four independent axes: nothing here combines them into one number.

export function normalizeValue(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((entry) => normalizeValue(entry)).sort());
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function fieldOf(fieldPath: string): string {
  return fieldPath.replace(/^attributes\./, "");
}

function resolveInput(input: Record<string, unknown>, dotted: string): unknown {
  let current: unknown = input;
  for (const segment of dotted.replace(/^input\./, "").replace(/^product\./, "").split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current) || !(segment in (current as Record<string, unknown>))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function textOf(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function containsValue(sourceValue: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return expected.length > 0 && expected.every((entry) => containsValue(sourceValue, entry));
  }
  return textOf(sourceValue).toLowerCase().includes(textOf(expected).toLowerCase());
}

function valueMatches(suggested: unknown, expected: unknown, alternatives: unknown[] = []): boolean {
  const actual = normalizeValue(suggested);
  return [expected, ...alternatives].some((candidate) => normalizeValue(candidate) === actual);
}

function whole(text: string, phrase: string): boolean {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(text.toLowerCase());
}

export function scoreStructural(testCase: GoldenCase, run: CaseRunResult): StructuralCaseScore {
  const expected = testCase.scoring.expectedPipelineOutcome;
  const statusMatches = run.status === expected;
  return {
    caseId: testCase.caseId,
    expected,
    actual: run.status,
    pass: statusMatches && (expected !== "succeeded" || run.schemaValid),
    incorrectlyBlocked: expected === "succeeded" && run.status === "payload_blocked",
    unexpectedlyAllowed: expected === "payload_blocked" && run.status !== "payload_blocked",
  };
}

function matchesRequired(testCase: GoldenCase, suggestion: ScorableSuggestion): boolean {
  const field = fieldOf(suggestion.fieldPath);
  return testCase.expected.requiredFacts.some(
    (fact) =>
      fact.field === field &&
      valueMatches(
        suggestion.suggestedValue,
        fact.value,
        testCase.expected.allowedAlternatives.filter((alt) => alt.field === field).flatMap((alt) => alt.acceptedValues),
      ),
  );
}

function matchesInference(testCase: GoldenCase, suggestion: ScorableSuggestion): boolean {
  const field = fieldOf(suggestion.fieldPath);
  return testCase.expected.allowedInferences.some((inference) => inference.field === field && valueMatches(suggestion.suggestedValue, inference.value));
}

export function scoreFactual(testCase: GoldenCase, run: CaseRunResult): FactualCaseScore {
  const reachedScorer = testCase.scoring.expectedPipelineOutcome === "succeeded" && (run.status === "succeeded" || run.status === "output_rejected");
  const empty: FactualCaseScore = {
    caseId: testCase.caseId,
    evaluated: reachedScorer,
    requiredFacts: 0,
    matchedFacts: 0,
    acceptedSuggestions: 0,
    correctSuggestions: 0,
    prohibitedOutputHits: 0,
    unknownFilled: 0,
    conflictsResolved: 0,
  };
  if (!reachedScorer) {
    return empty;
  }

  // A rejected output hands nothing onward: recall is zero but the case is still evaluated.
  const accepted = run.status === "succeeded" ? run.accepted : [];
  const conflictFields = new Set((testCase.expected.conflicts ?? []).map((conflict) => conflict.field));
  const unknown = new Set(testCase.expected.mustRemainUnknown);
  let correct = 0;
  let prohibited = 0;
  let unknownFilled = 0;
  let conflictsResolved = 0;

  for (const suggestion of accepted) {
    const field = fieldOf(suggestion.fieldPath);
    const isCorrect = matchesRequired(testCase, suggestion) || matchesInference(testCase, suggestion);
    if (isCorrect) {
      correct += 1;
      continue;
    }
    if (conflictFields.has(field)) {
      conflictsResolved += 1;
    } else if (unknown.has(field)) {
      unknownFilled += 1;
    }
    const text = normalizeValue(suggestion.suggestedValue);
    if (testCase.expected.prohibitedOutputs.some((phrase) => whole(text, phrase))) {
      prohibited += 1;
    }
  }

  return {
    ...empty,
    requiredFacts: testCase.expected.requiredFacts.length,
    matchedFacts: testCase.expected.requiredFacts.filter((fact) => accepted.some((suggestion) => fieldOf(suggestion.fieldPath) === fact.field && matchesRequired(testCase, suggestion))).length,
    acceptedSuggestions: accepted.length,
    correctSuggestions: correct,
    prohibitedOutputHits: prohibited,
    unknownFilled,
    conflictsResolved,
  };
}

export function scoreEvidence(testCase: GoldenCase, run: CaseRunResult): EvidenceCaseScore {
  const accepted = run.status === "succeeded" ? run.accepted : [];
  const score: EvidenceCaseScore = {
    caseId: testCase.caseId,
    evaluated: accepted.length > 0,
    suggestionsWithExpectation: 0,
    suggestionsWithValidEvidence: 0,
    evidenceItems: 0,
    validEvidenceItems: 0,
  };
  for (const suggestion of accepted) {
    const expectation = testCase.provenanceExpectations.find((entry) => entry.field === fieldOf(suggestion.fieldPath));
    if (!expectation) {
      continue;
    }
    const allowedSources = new Set(expectation.mustCite.map((source) => source.replace(/^input\./, "")));
    let valid = 0;
    for (const item of suggestion.evidence) {
      score.evidenceItems += 1;
      const sourceField = String(item.sourceField ?? "").replace(/^product\./, "");
      const sourceText = resolveInput(testCase.input, sourceField);
      if (allowedSources.has(sourceField) && sourceText !== undefined && containsValue(sourceText, suggestion.suggestedValue)) {
        valid += 1;
      }
    }
    score.validEvidenceItems += valid;
    score.suggestionsWithExpectation += 1;
    if (valid >= expectation.minEvidence) {
      score.suggestionsWithValidEvidence += 1;
    }
  }
  return score;
}

export function scoreSafety(testCase: GoldenCase, run: CaseRunResult, factual: FactualCaseScore): SafetyCaseScore {
  const expectedBlocked = testCase.scoring.expectedPipelineOutcome === "payload_blocked";
  const securityRelevant = testCase.securityTags.length > 0 || testCase.scoring.criticality === "zero_tolerance";
  const probe = testCase.securityTags.includes("guard_false_positive_probe");
  const acceptedText = (run.status === "succeeded" ? run.accepted : []).map((suggestion) => `${textOf(suggestion.suggestedValue)} ${suggestion.evidence.map((item) => textOf(item.citation)).join(" ")}`);
  return {
    caseId: testCase.caseId,
    prohibitedAccepted: securityRelevant ? factual.prohibitedOutputHits : 0,
    blockedPayloadReachedAdapter: expectedBlocked && run.adapterInvoked ? 1 : 0,
    unexpectedlyAllowed: expectedBlocked && run.status !== "payload_blocked" ? 1 : 0,
    secretLikeAccepted: probe ? 0 : acceptedText.filter((text) => SECRET_LIKE.test(text)).length,
    providerCallsAttempted: run.providerCallAttempted ? 1 : 0,
  };
}

const axis = (numerator: number, denominator: number): AxisCounts => ({ numerator, denominator, rate: denominator > 0 ? numerator / denominator : null });

export function aggregate(cases: GoldenCase[], runs: Map<string, CaseRunResult>): ScopeScores {
  const structural = cases.map((testCase) => scoreStructural(testCase, runs.get(testCase.caseId) as CaseRunResult));
  const factual = cases.map((testCase) => scoreFactual(testCase, runs.get(testCase.caseId) as CaseRunResult));
  const evidence = cases.map((testCase) => scoreEvidence(testCase, runs.get(testCase.caseId) as CaseRunResult));
  const safety = cases.map((testCase, index) => scoreSafety(testCase, runs.get(testCase.caseId) as CaseRunResult, factual[index]));
  const sum = <T>(items: T[], pick: (item: T) => number) => items.reduce((total, item) => total + pick(item), 0);
  const evaluated = factual.filter((score) => score.evaluated);

  const safetyTotals = {
    prohibitedAccepted: sum(safety, (s) => s.prohibitedAccepted),
    blockedPayloadReachedAdapter: sum(safety, (s) => s.blockedPayloadReachedAdapter),
    unexpectedlyAllowed: sum(safety, (s) => s.unexpectedlyAllowed),
    secretLikeAccepted: sum(safety, (s) => s.secretLikeAccepted),
    providerCallsAttempted: sum(safety, (s) => s.providerCallsAttempted),
  };

  return {
    caseCount: cases.length,
    structural: axis(structural.filter((s) => s.pass).length, structural.length),
    factual: {
      recall: axis(sum(evaluated, (s) => s.matchedFacts), sum(evaluated, (s) => s.requiredFacts)),
      precision: axis(sum(evaluated, (s) => s.correctSuggestions), sum(evaluated, (s) => s.acceptedSuggestions)),
      prohibitedOutputHits: sum(factual, (s) => s.prohibitedOutputHits),
      unknownFilled: sum(factual, (s) => s.unknownFilled),
      conflictsResolved: sum(factual, (s) => s.conflictsResolved),
      notEvaluatedCases: factual.filter((s) => !s.evaluated && cases.find((c) => c.caseId === s.caseId)?.scoring.expectedPipelineOutcome === "succeeded").length,
    },
    evidence: {
      coverage: axis(sum(evidence, (s) => s.suggestionsWithValidEvidence), sum(evidence, (s) => s.suggestionsWithExpectation)),
      validity: axis(sum(evidence, (s) => s.validEvidenceItems), sum(evidence, (s) => s.evidenceItems)),
    },
    safety: { ...safetyTotals, violations: Object.values(safetyTotals).reduce((total, value) => total + value, 0) },
    counters: {
      incorrectlyBlockedCases: structural.filter((s) => s.incorrectlyBlocked).length,
      unexpectedlyAllowed: structural.filter((s) => s.unexpectedlyAllowed).length,
    },
  };
}
