import type { ConnectorLaunchStage } from "../connector-framework/connector-launch-policy";
import type { PublicationConditionId, PublicationReasonCode, PublicationReasonOwner } from "./publication-target.reason-catalog";

/**
 * Inputs and outputs of the publication-target evaluator (ADR-0015).
 *
 * Fact convention used by every input field, so that "not looked up" can never be mistaken for "looked up and absent":
 *   undefined = unknown (the fact was not supplied or could not be read)   -> condition `unknown`, target unavailable
 *   null      = known to be absent (no installation, no mapping, ...)       -> the condition's own failure code
 *   a value   = known
 */

// ─── Evidence (the manifest itself arrives in 5.1c; the shape is fixed by the design document) ───────────────

export type EvidencePath = "direct_adapter" | "product_pipeline";

export type CertificationLevel =
  | "untested"
  | "unit_tested"
  | "integration_tested"
  | "sandbox_verified"
  | "production_verified"
  | "certified";

export const CERTIFICATION_LEVEL_ORDER: readonly CertificationLevel[] = [
  "untested",
  "unit_tested",
  "integration_tested",
  "sandbox_verified",
  "production_verified",
  "certified",
];

/**
 * Who or what produced the evidence. `AI_RUN` is technical QA evidence executed by an AI agent; it never counts as
 * a named human sign-off. `UNKNOWN` means the source does not say who executed it.
 */
export type EvidenceExecutionType = "AI_RUN" | "HUMAN_RUN" | "UNKNOWN";

export type EvidenceEnvironment = "PRODUCTION" | "SANDBOX" | "LOCAL";

export interface CapabilityEvidence {
  connector: string;
  capability: string;
  path: EvidencePath;
  level: CertificationLevel;
  evidenceRef: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  /** Authoritative expiry. Past it, or when absent on verified evidence, the capability needs recertification. */
  reverifyBy: string | null;

  // Provenance. Required on every entry above `untested` (enforced by validateEvidenceManifest); absent on untested.
  /** The role the evidence counts for (for example QA). A role is not a person and not an approval. */
  evidenceRole?: string;
  executionType?: EvidenceExecutionType;
  /**
   * True only when a named human approved this evidence against the governance gate. Technical evidence, however
   * good, leaves this false; `certified` requires it.
   */
  humanApproval?: boolean;
  environment?: EvidenceEnvironment;
  fixture?: string | null;
  /** Provider-submission ids that trace the run (required for product_pipeline evidence). */
  submissionIds?: readonly string[];
  assertions?: Readonly<Record<string, boolean>>;
  limitations?: readonly string[];
}

// ─── Facts ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface ConnectorDefinitionFact {
  slug: string;
  displayName: string;
  isActive: boolean;
  capabilities: readonly string[];
}

/** The part of resolveConnectorLaunchPolicy's result the evaluator consumes. */
export interface LaunchPolicyFact {
  launchStage: ConnectorLaunchStage;
  /** Set (to CONNECTOR_POLICY_MISSING) only when the policy is the fail-closed default. */
  reason?: "CONNECTOR_POLICY_MISSING";
}

export interface CommercialSupportFact {
  commerciallySupported: boolean;
  /** Only "PO" counts; the Product Owner is accountable for this flag. */
  approvedBy: string | null;
  approvalRef: string | null;
}

export interface TenantEntitlementFact {
  releaseStage: ConnectorLaunchStage;
  validFrom: Date;
  validUntil: Date | null;
  revokedAt: Date | null;
}

export type TargetSchemaState = "ready" | "missing" | "stale";

export interface InstallationFact {
  /** connector_installations.status, e.g. ACTIVE, CREDENTIAL_EXPIRED, DISABLED. */
  status: string;
  authorizationComplete: boolean;
}

export type CredentialValidationOutcome = "VALID" | "INVALID" | "INDETERMINATE" | "CONFIGURATION_ERROR";

export interface CredentialFact {
  /** connector_installations.status; CREDENTIAL_EXPIRED is what INVALID writes. */
  installationStatus: string;
  /** The most recent validation attempt's outcome, or null if no attempt is recorded. */
  lastOutcome: CredentialValidationOutcome | null;
  /** When a validation last came back VALID. null = never. */
  lastValidAt: Date | null;
  /**
   * Whether that last VALID was established by authenticating against the provider. TOKEN_ONLY (a held,
   * unexpired token with no provider call) is false. null = not known, which counts as not verified.
   */
  lastValidProviderVerified: boolean | null;
}

export type MappingCompatibilityState = "compatible" | "deprecated" | "remap_required" | "blocked";

export interface MappingFact {
  compatibilityState: MappingCompatibilityState;
}

export interface ProductFact {
  blockingIssueCount: number;
}

/** docs/design/connector-write-retry-policy.md: only AMBIGUOUS creates make another publish unsafe. */
export type CreateClassification = "AMBIGUOUS" | "PROVEN_IDEMPOTENT" | "PROVEN_RECONCILABLE";

export interface PriorOutcomeFact {
  /** A submission for this product on this installation is recorded PROVIDER_OUTCOME_UNKNOWN and not settled. */
  unsettledUnknownOutcome: boolean;
  createClassification: CreateClassification;
}

// ─── Input and context ──────────────────────────────────────────────────────────────────────────────────────

export type PublicationEvaluationScope = "tenant" | "product";

export interface PublicationTargetInput {
  slug: string;
  /** "tenant" evaluates one installation; "product" adds the product-scope conditions. */
  scope: PublicationEvaluationScope;
  definition: ConnectorDefinitionFact | null | undefined;
  runtimeRegistered: boolean | undefined;
  launchPolicy: LaunchPolicyFact | undefined;
  evidence: readonly CapabilityEvidence[] | undefined;
  commercialSupport: CommercialSupportFact | null | undefined;
  tenantEntitlement: TenantEntitlementFact | null | undefined;
  targetSchema: TargetSchemaState | undefined;
  installation: InstallationFact | null | undefined;
  credential: CredentialFact | null | undefined;
  mapping: MappingFact | null | undefined;
  /** Product scope only. */
  product?: ProductFact | undefined;
  priorOutcome?: PriorOutcomeFact | undefined;
}

export interface CredentialFreshnessPolicy {
  windowMs: number;
  /** The supported time for every eligible installation to receive one validation attempt. */
  heartbeatMaxRotationMs: number;
  schedulerIntervalMs: number;
}

export interface PublicationEvaluationContext {
  now: Date;
  credentialFreshness: CredentialFreshnessPolicy;
  /**
   * Whether an operator can settle an unknown outcome (an append-only resolution event). Until it exists the
   * PRIOR_PROVIDER_OUTCOME_UNKNOWN block is reported but not enforced, so it cannot become permanent.
   */
  outcomeSettlementExists: boolean;
}

// ─── Output ─────────────────────────────────────────────────────────────────────────────────────────────────

export type PublicationConditionScope = "platform" | "tenant" | "product";
export type PublicationConditionStatus = "pass" | "fail" | "warn" | "not_applicable" | "unknown";

/**
 * "enforced": a failure here makes the target unavailable under today's rollout.
 * "shadow_only": the failure is reported and counted in `available`, but must not be enforced against the current
 * publish path (PRIOR_PROVIDER_OUTCOME_UNKNOWN until outcome settlement exists).
 */
export type PublicationEnforcement = "enforced" | "shadow_only";

export interface PublicationCondition {
  id: PublicationConditionId;
  scope: PublicationConditionScope;
  status: PublicationConditionStatus;
  code: PublicationReasonCode | null;
  /** True when this condition makes the target unavailable (status fail or unknown). */
  blocking: boolean;
  owner: PublicationReasonOwner | null;
  message: string;
  evidenceRef: string | null;
  enforcement: PublicationEnforcement;
}

export interface PublicationTargetEvaluation {
  key: string;
  scope: PublicationEvaluationScope;
  evaluatedAt: string;
  /** The full contract: true only when no condition is fail or unknown. */
  available: boolean;
  /**
   * What is true if only enforced conditions count. Differs from `available` only through shadow_only conditions.
   * 5.1d compares this, and `shadowOnlyReasonCodes`, with today's behavior; nothing enforces it.
   */
  availableUnderCurrentEnforcement: boolean;
  blockers: PublicationCondition[];
  warnings: PublicationCondition[];
  /** Codes of blockers then warnings, de-duplicated, in chain order. */
  reasonCodes: PublicationReasonCode[];
  /** Codes of blocking conditions that are not enforced yet. */
  shadowOnlyReasonCodes: PublicationReasonCode[];
  /** The full chain, always, in the fixed order. */
  conditions: PublicationCondition[];
}
