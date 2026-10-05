import type { IntelligenceAdapterRequest, IntelligenceAdapterResponse, IntelligenceProviderAdapter } from "../../src/intelligence/intelligence.types";
import type { GoldenCase } from "./evaluation.types";
import { applyMutations, buildReferenceSuggestions, replayResponse, type CandidateMutation } from "./reference-candidate";

export const EVAL_CORRELATION_PREFIX = "eval:";

/**
 * Test-only adapter for FAST evaluation. It is never registered in IntelligenceModule and makes no network call.
 * It serves the reference candidate for a case, optionally mutated to prove that the scorers catch regressions.
 */
export class ReplayEvaluationAdapter implements IntelligenceProviderAdapter {
  readonly adapterKey = "replay";
  readonly invocations: string[] = [];
  private readonly cases = new Map<string, GoldenCase>();

  constructor(
    cases: GoldenCase[],
    private readonly mutations: Record<string, CandidateMutation[]> = {},
  ) {
    cases.forEach((testCase) => this.cases.set(testCase.caseId, testCase));
  }

  async generateStructuredOutput(request: IntelligenceAdapterRequest): Promise<IntelligenceAdapterResponse> {
    const caseId = request.correlationId.startsWith(EVAL_CORRELATION_PREFIX) ? request.correlationId.slice(EVAL_CORRELATION_PREFIX.length) : "";
    const testCase = this.cases.get(caseId);
    if (!testCase) {
      throw new Error("Replay adapter has no case for this request.");
    }
    this.invocations.push(caseId);
    const mutations = this.mutations[caseId] ?? [];
    const suggestions = applyMutations(testCase, request, buildReferenceSuggestions(testCase, request), mutations);
    const finish = mutations.includes("finish_failed") ? "failed" : mutations.includes("finish_unknown") ? "unknown" : "completed";
    return replayResponse(request, suggestions, finish);
  }
}
