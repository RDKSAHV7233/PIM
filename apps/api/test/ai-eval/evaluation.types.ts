import type { FixtureIntelligenceAdapterRunResult, IntelligenceCapabilityId } from "../../src/intelligence/intelligence.types";

export type EvaluationMode = "FAST";
export type ExpectedPipelineOutcome = "succeeded" | "payload_blocked" | "output_rejected";
export type ApprovalStatus = "DRAFT" | "APPROVED";
export type Criticality = "standard" | "high" | "zero_tolerance";

export interface GoldenFact {
  field: string;
  value: unknown;
  source: string;
}

export interface GoldenCase {
  caseId: string;
  category: string;
  capability: IntelligenceCapabilityId;
  approvalStatus: ApprovalStatus;
  securityTags: string[];
  input: Record<string, unknown> & { attributes?: Record<string, unknown> };
  payloadExtras?: Record<string, unknown>;
  expected: {
    requiredFacts: GoldenFact[];
    allowedAlternatives: Array<{ field: string; acceptedValues: unknown[] }>;
    allowedInferences: Array<{ field: string; value: unknown }>;
    mustRemainUnknown: string[];
    prohibitedOutputs: string[];
    conflicts?: Array<{ field: string; values: unknown[]; sources: string[] }>;
  };
  provenanceExpectations: Array<{ field: string; mustCite: string[]; minEvidence: number }>;
  scoring: { caseWeight: number; criticality: Criticality; expectedPipelineOutcome: ExpectedPipelineOutcome };
}

export interface GoldenCatalog {
  catalogId: string;
  version: number;
  cases: GoldenCase[];
}

/** What the scorers need from one pipeline run; independent of Nest, Prisma and provider code. */
export interface ScorableSuggestion {
  fieldPath: string;
  suggestedValue: unknown;
  evidence: Array<{ sourceField?: unknown; citation?: unknown }>;
}

export interface CaseRunResult {
  caseId: string;
  status: FixtureIntelligenceAdapterRunResult["status"];
  schemaValid: boolean;
  adapterInvoked: boolean;
  providerCallAttempted: boolean;
  proposed: ScorableSuggestion[];
  accepted: ScorableSuggestion[];
  blockedReasons: Array<"guard_word" | "unknown_field_path" | "blocked_field">;
}

export interface StructuralCaseScore {
  caseId: string;
  pass: boolean;
  expected: ExpectedPipelineOutcome;
  actual: string;
  incorrectlyBlocked: boolean;
  unexpectedlyAllowed: boolean;
}

export interface FactualCaseScore {
  caseId: string;
  evaluated: boolean;
  requiredFacts: number;
  matchedFacts: number;
  acceptedSuggestions: number;
  correctSuggestions: number;
  prohibitedOutputHits: number;
  unknownFilled: number;
  conflictsResolved: number;
}

export interface EvidenceCaseScore {
  caseId: string;
  evaluated: boolean;
  suggestionsWithExpectation: number;
  suggestionsWithValidEvidence: number;
  evidenceItems: number;
  validEvidenceItems: number;
}

export interface SafetyCaseScore {
  caseId: string;
  prohibitedAccepted: number;
  blockedPayloadReachedAdapter: number;
  unexpectedlyAllowed: number;
  secretLikeAccepted: number;
  providerCallsAttempted: number;
}

export interface AxisCounts {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface ScopeScores {
  caseCount: number;
  structural: AxisCounts;
  factual: {
    recall: AxisCounts;
    precision: AxisCounts;
    prohibitedOutputHits: number;
    unknownFilled: number;
    conflictsResolved: number;
    notEvaluatedCases: number;
  };
  evidence: { coverage: AxisCounts; validity: AxisCounts };
  safety: {
    prohibitedAccepted: number;
    blockedPayloadReachedAdapter: number;
    unexpectedlyAllowed: number;
    secretLikeAccepted: number;
    providerCallsAttempted: number;
    violations: number;
  };
  counters: { incorrectlyBlockedCases: number; unexpectedlyAllowed: number };
}

export interface SideEffectCounters {
  suggestionWrites: number;
  forbiddenDelegateAccesses: number;
}
