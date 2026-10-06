import type {
  CapabilityEvidence,
  PublicationCondition,
  PublicationEvaluationContext,
  PublicationTargetEvaluation,
  PublicationTargetInput,
} from "./publication-target.types";
import type { PublicationConditionId } from "./publication-target.reason-catalog";
import { evaluatePublicationTarget } from "./publication-target.evaluator";

/** Test fixtures only. Not imported by production code (see the invariants spec). */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
export const NOW = new Date("2026-10-06T12:00:00.000Z");

export const CONTEXT: PublicationEvaluationContext = {
  now: NOW,
  // required window = 2 x 12h + 6h = 30h; 72h is supportable
  credentialFreshness: { windowMs: 72 * HOUR_MS, heartbeatMaxRotationMs: 12 * HOUR_MS, schedulerIntervalMs: 6 * HOUR_MS },
  outcomeSettlementExists: false,
};

export function pipelineEvidence(overrides: Partial<CapabilityEvidence> = {}): CapabilityEvidence {
  return {
    connector: "acme",
    capability: "PUBLISH",
    path: "product_pipeline",
    level: "certified",
    evidenceRef: "PR#1",
    verifiedAt: "2026-10-01",
    verifiedBy: "QA",
    reverifyBy: new Date(NOW.getTime() + 60 * DAY_MS).toISOString(),
    ...overrides,
  };
}

/** A product-scope input on which every one of the twelve conditions passes. */
export function readyInput(overrides: Partial<PublicationTargetInput> = {}): PublicationTargetInput {
  return {
    slug: "acme",
    scope: "product",
    definition: { slug: "acme", displayName: "Acme", isActive: true, capabilities: ["PUBLISH", "VALIDATE"] },
    runtimeRegistered: true,
    launchPolicy: { launchStage: "live" },
    evidence: [pipelineEvidence()],
    commercialSupport: { commerciallySupported: true, approvedBy: "PO", approvalRef: "PO-APPROVAL-1" },
    tenantEntitlement: null,
    targetSchema: "ready",
    installation: { status: "ACTIVE", authorizationComplete: true },
    credential: {
      installationStatus: "ACTIVE",
      lastOutcome: "VALID",
      lastValidAt: new Date(NOW.getTime() - 2 * HOUR_MS),
      lastValidProviderVerified: true,
    },
    mapping: { compatibilityState: "compatible" },
    product: { blockingIssueCount: 0 },
    priorOutcome: { unsettledUnknownOutcome: false, createClassification: "PROVEN_IDEMPOTENT" },
    ...overrides,
  };
}

export function evaluate(
  overrides: Partial<PublicationTargetInput> = {},
  context: Partial<PublicationEvaluationContext> = {},
): PublicationTargetEvaluation {
  return evaluatePublicationTarget(readyInput(overrides), { ...CONTEXT, ...context });
}

export function condition(result: PublicationTargetEvaluation, id: PublicationConditionId): PublicationCondition {
  const found = result.conditions.find((entry) => entry.id === id);
  if (!found) throw new Error(`condition ${id} missing from result`);
  return found;
}
