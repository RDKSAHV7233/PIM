import { createHash } from "node:crypto";
import type { IntelligenceAdapterRequest, IntelligenceAdapterResponse } from "../../src/intelligence/intelligence.types";
import type { GoldenCase } from "./evaluation.types";

export type CandidateMutation =
  | "drop_fact"
  | "wrong_value"
  | "prohibited_claim"
  | "unknown_filled"
  | "conflict_picked"
  | "drop_evidence"
  | "wrong_evidence_source"
  | "authority_field"
  | "secret_text"
  | "finish_failed"
  | "finish_unknown";

type Suggestion = Record<string, unknown> & { fieldPath: string; evidence?: Array<Record<string, unknown>> };

const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function sourceText(testCase: GoldenCase, source: string): string {
  let current: unknown = testCase.input;
  for (const segment of source.replace(/^input\./, "").split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return "";
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : JSON.stringify(current ?? "");
}

function suggestion(testCase: GoldenCase, request: IntelligenceAdapterRequest, field: string, value: unknown, source: string): Suggestion {
  const citation = sourceText(testCase, source).slice(0, 200);
  return {
    fieldPath: `attributes.${field}`,
    attributeFamily: field,
    suggestedValue: value,
    generatedPayload: { value, source: "replay" },
    confidence: 1,
    evidence: [
      {
        sourceField: `product.${source.replace(/^input\./, "")}`,
        sourceRecordId: request.sourceRecordId,
        sourceVersion: request.sourceVersion,
        sourceHash: request.sourceHash,
        citation,
        evidenceHash: sha(`${request.sourceHash}|${source}|${citation}`),
      },
    ],
  };
}

/**
 * The reference candidate is what a perfect extractor would return for a case. FAST mode replays it, so a
 * green run proves the pipeline, validators and scorers are wired correctly. It says nothing about model quality.
 */
export function buildReferenceSuggestions(testCase: GoldenCase, request: IntelligenceAdapterRequest): Suggestion[] {
  return testCase.expected.requiredFacts.map((fact) => suggestion(testCase, request, fact.field, fact.value, fact.source));
}

export function applyMutations(testCase: GoldenCase, request: IntelligenceAdapterRequest, base: Suggestion[], mutations: CandidateMutation[]): Suggestion[] {
  let suggestions: Suggestion[] = base.map((entry) => ({ ...entry, evidence: entry.evidence?.map((item) => ({ ...item })) }));
  for (const mutation of mutations) {
    switch (mutation) {
      case "drop_fact":
        suggestions = suggestions.slice(1);
        break;
      case "wrong_value":
        suggestions = suggestions.map((entry, index) => (index === 0 ? { ...entry, suggestedValue: "incorrect-value", generatedPayload: { value: "incorrect-value" } } : entry));
        break;
      case "prohibited_claim":
        suggestions.push(suggestion(testCase, request, "claim", testCase.expected.prohibitedOutputs[0] ?? "prohibited", "title"));
        break;
      case "unknown_filled":
        suggestions.push(suggestion(testCase, request, testCase.expected.mustRemainUnknown[0] ?? "unknownField", "fabricated-value", "title"));
        break;
      case "conflict_picked": {
        const conflict = testCase.expected.conflicts?.[0];
        if (conflict) {
          suggestions.push(suggestion(testCase, request, conflict.field, conflict.values[0], conflict.sources[0]));
        }
        break;
      }
      case "drop_evidence":
        suggestions = suggestions.map((entry, index) => (index === 0 ? { ...entry, evidence: [] } : entry));
        break;
      case "wrong_evidence_source":
        suggestions = suggestions.map((entry, index) =>
          index === 0 ? { ...entry, evidence: entry.evidence?.map((item) => ({ ...item, sourceField: "product.categoryPath" })) } : entry,
        );
        break;
      case "authority_field":
        suggestions = suggestions.map((entry, index) => (index === 0 ? { ...entry, tenantKey: "other-tenant" } : entry));
        break;
      case "secret_text":
        suggestions = suggestions.map((entry, index) => (index === 0 ? { ...entry, suggestedValue: "api key abc123", generatedPayload: { value: "api key abc123" } } : entry));
        break;
      default:
        break;
    }
  }
  return suggestions;
}

export function replayResponse(
  request: IntelligenceAdapterRequest,
  suggestions: Suggestion[],
  finishStatus: IntelligenceAdapterResponse["finishStatus"] | "unknown",
): IntelligenceAdapterResponse {
  return {
    adapterKey: "replay",
    modelKey: "replay-reference",
    modelVersion: "replay-reference-v1",
    region: "local",
    requestId: `replay:${sha(request.correlationId).slice(7, 23)}`,
    finishStatus: finishStatus as IntelligenceAdapterResponse["finishStatus"],
    latencyMs: 0,
    structuredOutput: { suggestions } as unknown as IntelligenceAdapterResponse["structuredOutput"],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      billableUnits: 0,
      estimatedCostMicros: 0,
      currency: "USD",
      pricingVersion: "replay-free-v1",
    },
    providerCallAttempted: false,
  };
}
