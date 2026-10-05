import type { AppRole } from "../common/rbac/roles";
import type { Prisma } from "@prisma/client";

export type IntelligenceCapabilityStatus = "planned" | "disabled";

export type IntelligenceCapabilityGateStatus = "blocked_until_gate_b";

export type IntelligenceCapabilityId =
  | "product_attribute_extraction"
  | "product_specification_extraction"
  | "evidence_backed_suggestions";

export interface IntelligenceActor {
  actorId?: string;
  actorRole?: AppRole;
  tenantId?: string;
  effectiveRoles?: string[];
}

export interface IntelligenceCapabilitySummary {
  id: IntelligenceCapabilityId;
  status: IntelligenceCapabilityStatus;
  gateStatus: IntelligenceCapabilityGateStatus;
  ai001Scope: "in_scope";
  canonicalMutation: false;
  providerExecution: false;
  humanReviewRequired: true;
  evidenceRequired: true;
  allowedEntityTypes: readonly ["product"];
  promptContractVersion: string;
  schemaContractVersion: string;
  outputContractVersion: string;
}

export interface IntelligenceBoundaryStatus {
  tenantId: string;
  module: "IntelligenceModule";
  status: "boundary_only";
  providerExecutionEnabled: false;
  canonicalProductMutationEnabled: false;
  capabilities: IntelligenceCapabilitySummary[];
}

export type AiExecutionStatus =
  | "queued"
  | "validating"
  | "blocked"
  | "running"
  | "succeeded"
  | "failed"
  | "timed_out"
  | "budget_blocked"
  | "provider_disabled"
  | "cancelled";

export type AiExecutionCostSource = "none" | "estimated" | "actual" | "provider";

export type AiExecutionFailureClass =
  | "validation_error"
  | "classification_blocked"
  | "redaction_failed"
  | "tenant_policy_blocked"
  | "budget_exhausted"
  | "provider_disabled"
  | "provider_timeout"
  | "provider_rate_limited"
  | "provider_auth_error"
  | "provider_5xx"
  | "provider_schema_invalid"
  | "unsafe_output"
  | "internal_error";

export interface CreateAiExecutionInput {
  tenantKey: string;
  capability: string;
  entityType: string;
  entityId: string;
  sourceVersion: number;
  sourceHash: string;
  requestFingerprint: string;
  promptVersion: string;
  schemaVersion: string;
  sourceRecordId?: string | null;
  createdByActorId?: string | null;
  createdByActorRole?: string | null;
  correlationId?: string | null;
  idempotencyFingerprint?: string | null;
  status?: AiExecutionStatus;
  providerKey?: string | null;
  providerDisplayName?: string | null;
  modelKey?: string | null;
  providerRegion?: string | null;
  providerPolicyVersion?: string | null;
  classificationPolicyVersion?: string | null;
  redactionPolicyVersion?: string | null;
  promptTemplateHash?: string | null;
  schemaHash?: string | null;
  outputContractVersion?: string | null;
  capabilityContractVersion?: string | null;
  attemptNumber?: number;
  maxAttempts?: number;
  budgetPeriodKey?: string | null;
}

export interface FinalizeAiExecutionInput {
  status: AiExecutionStatus;
  providerRequestId?: string | null;
  modelVersion?: string | null;
  startedAt?: Date | string | null;
  finishedAt?: Date | string | null;
  durationMs?: number | null;
  retryable?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  billableUnits?: number;
  estimatedCostMicros?: number;
  actualCostMicros?: number | null;
  currency?: string;
  costSource?: AiExecutionCostSource;
  pricingVersion?: string | null;
  failureClass?: AiExecutionFailureClass | null;
  failureCode?: string | null;
  failureMessageSafe?: string | null;
  providerStatusCode?: number | null;
  providerCallAttempted?: boolean;
  auditEventIds?: string[];
  validationEvidenceId?: string | null;
  classificationEvidenceId?: string | null;
  redactionEvidenceId?: string | null;
  requestPayloadHash?: string | null;
  responsePayloadHash?: string | null;
  generatedPayloadHash?: string | null;
  suggestionIds?: string[];
  requestPayloadStorageRef?: string | null;
  responsePayloadStorageRef?: string | null;
  containsBlockedData?: boolean;
  containsCredentials?: boolean;
  redactedFields?: string[];
  blockedFields?: string[];
}

export type AiSuggestionStatus =
  | "generated"
  | "pending_review"
  | "accepted"
  | "edited"
  | "rejected"
  | "blocked_stale"
  | "blocked_tampered"
  | "blocked_unauthorized"
  | "applied";

export type AiSuggestionReviewDecision = "accept" | "edit" | "reject";

export type AiDataClassification = "AI_ALLOWED" | "AI_ALLOWED_WITH_REDACTION" | "AI_BLOCKED";

export type AiTenantPolicyStatus = "draft" | "active" | "disabled";

export interface AiFieldClassificationRule {
  classification: AiDataClassification;
  redactionEvidenceRequired?: boolean;
}

export interface UpsertAiTenantPolicyInput {
  tenantKey: string;
  policyVersion: string;
  capability?: string;
  providerKey?: string;
  status?: AiTenantPolicyStatus;
  intelligenceEnabled?: boolean;
  providerExecutionEnabled?: boolean;
  killSwitchEnabled?: boolean;
  tenantOptOut?: boolean;
  allowModelTraining?: boolean;
  allowHumanProviderReview?: boolean;
  allowRawPayloadStorage?: boolean;
  retentionDays?: number;
  maxPayloadBytes?: number;
  defaultClassification?: AiDataClassification;
  allowedCapabilities?: string[];
  allowedProviderKeys?: string[];
  fieldClassifications?: Record<string, AiFieldClassificationRule>;
  redactionPolicyVersion: string;
  classificationPolicyHash: string;
  dataUseNotes?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | string | null;
  auditEventIds?: string[];
  createdByActorId?: string | null;
  updatedByActorId?: string | null;
}

export type AiProviderExecutionMode = "live_provider";

export type AiProviderExecutionDecision = "ALLOW" | "DENY";

export type AiProviderExecutionDenialReason =
  | "platform_feature_disabled"
  | "platform_kill_switch"
  | "missing_tenant_policy"
  | "invalid_tenant_policy"
  | "tenant_provider_disabled"
  | "capability_disallowed"
  | "execution_mode_disabled"
  | "missing_budget_policy"
  | "invalid_budget_policy"
  | "budget_exhausted"
  | "budget_indeterminate"
  | "invalid_request";

export interface EvaluateProviderExecutionEligibilityInput {
  tenantKey: string;
  capability: IntelligenceCapabilityId;
  providerKey?: string;
  executionMode?: AiProviderExecutionMode;
  budgetPeriodKey: string;
  requestFingerprint: string;
  requestedEstimatedCostMicros: number;
  currency?: string;
  correlationId?: string | null;
  platformProviderExecutionEnabled?: boolean;
  platformKillSwitchEnabled?: boolean;
}

export interface ProviderExecutionEligibilityResult {
  decision: AiProviderExecutionDecision;
  allowed: boolean;
  denialReason?: AiProviderExecutionDenialReason;
  tenantKey: string;
  capability: IntelligenceCapabilityId;
  providerKey: string;
  executionMode: AiProviderExecutionMode;
  policyId?: string;
  policyVersion?: string;
  budgetPolicyId?: string;
  budgetPeriodKey: string;
  reservationId?: string;
  requestFingerprint: string;
  requestedEstimatedCostMicros: number;
  reservedCostMicros: number;
  currency: string;
  providerCallAttempted: false;
  canonicalProductMutationEnabled: false;
}

export interface ClassifyIntelligencePayloadInput {
  tenantKey: string;
  capability: string;
  providerKey?: string;
  payload: Prisma.InputJsonValue;
  redactedFields?: string[];
}

export type IntelligencePayloadBlockReason =
  | "unknown_path"
  | "blocked_by_policy"
  | "redaction_required"
  | "secret_like_text"
  | "secret_like_key"
  | "invalid_path_segment"
  | "unsupported_array_element"
  | "unsupported_payload_shape";

export interface IntelligencePayloadClassificationResult {
  allowed: boolean;
  policyId?: string;
  policyVersion?: string;
  blockedFields: string[];
  redactedFields: string[];
  unknownFields: string[];
  /** Why fields were blocked: reason codes only, never paths or values. */
  blockedReasons?: IntelligencePayloadBlockReason[];
  classificationEvidenceId: string;
  redactionEvidenceId?: string;
  payloadHash?: string;
  reason?: string;
}

export interface RecordPolicyBlockedExecutionInput {
  executionId: string;
  tenantKey: string;
  result: IntelligencePayloadClassificationResult;
  auditEventIds?: string[];
}

export interface PrepareIntelligencePayloadDryRunInput extends ClassifyIntelligencePayloadInput {
  executionId?: string | null;
  auditEventIds?: string[];
}

export interface IntelligencePayloadDryRunResult {
  allowed: boolean;
  classification: IntelligencePayloadClassificationResult;
  payloadFingerprint?: string;
  executionRecorded: boolean;
  providerCallAttempted: false;
  estimatedCostMicros: 0;
}

export interface IntelligenceProviderOutputSuggestionCandidate {
  fieldPath: string;
  suggestedValue: Prisma.InputJsonValue;
  generatedPayload?: Prisma.InputJsonValue;
  evidence?: Prisma.InputJsonValue[];
  requiresEvidence?: boolean;
  confidence?: number | null;
  attributeFamily?: string | null;
}

export interface ValidateIntelligenceProviderOutputInput {
  tenantKey: string;
  executionId: string;
  capability: string;
  entityType: string;
  entityId: string;
  sourceRecordId: string;
  sourceVersion: number;
  sourceHash: string;
  promptVersion: string;
  schemaVersion: string;
  providerOutput: Prisma.InputJsonValue;
  auditEventIds?: string[];
}

export interface IntelligenceProviderValidatedSuggestion {
  tenantKey: string;
  executionId: string;
  capability: string;
  entityType: string;
  entityId: string;
  fieldPath: string;
  sourceRecordId: string;
  sourceVersion: number;
  sourceHash: string;
  promptVersion: string;
  schemaVersion: string;
  generatedPayload: Prisma.InputJsonValue;
  suggestedValue: Prisma.InputJsonValue;
  evidence: Prisma.InputJsonValue[];
  requiresEvidence: boolean;
  confidence?: number | null;
  attributeFamily?: string | null;
  validationEvidenceId: string;
  auditEventIds?: string[];
}

export interface IntelligenceProviderOutputValidationResult {
  schemaValid: boolean;
  suggestionCount: number;
  outputPayloadHash?: string;
  validationEvidenceId: string;
  errors: string[];
  validatedSuggestions: IntelligenceProviderValidatedSuggestion[];
  providerCallAttempted: false;
  canonicalProductMutationEnabled: false;
}

export type IntelligenceAdapterFinishStatus = "completed" | "blocked" | "failed";

export const INTELLIGENCE_ADAPTER_FINISH_STATUSES: readonly IntelligenceAdapterFinishStatus[] = ["completed", "blocked", "failed"];

export type IntelligenceAdapterErrorClass =
  | "input_not_allowed"
  | "schema_invalid"
  | "adapter_unavailable"
  | "timeout"
  | "rate_limited"
  | "auth_failed"
  | "upstream_5xx"
  | "internal_error";

export interface IntelligenceAdapterUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  billableUnits: number;
  estimatedCostMicros: number;
  currency: string;
  pricingVersion: string;
}

export interface IntelligenceAdapterRequest {
  tenantKey: string;
  capability: IntelligenceCapabilityId;
  entityType: "product";
  entityId: string;
  sourceRecordId: string;
  sourceVersion: number;
  sourceHash: string;
  promptVersion: string;
  schemaVersion: string;
  payload: Prisma.InputJsonValue;
  payloadFingerprint: string;
  correlationId: string;
}

export interface IntelligenceAdapterResponse {
  adapterKey: string;
  modelKey: string;
  modelVersion: string;
  region: string;
  requestId: string;
  finishStatus: IntelligenceAdapterFinishStatus;
  latencyMs: number;
  structuredOutput?: Prisma.InputJsonValue;
  usage: IntelligenceAdapterUsage;
  errorClass?: IntelligenceAdapterErrorClass;
  errorCode?: string;
  providerCallAttempted: boolean;
}

/**
 * Vexa-owned provider boundary. Implementations translate a governed request into a
 * provider-shaped structured result. They must not persist suggestions or mutate Product data.
 */
export interface IntelligenceProviderAdapter {
  readonly adapterKey: string;
  generateStructuredOutput(request: IntelligenceAdapterRequest): Promise<IntelligenceAdapterResponse>;
}

export interface IntelligenceAdapterNormalizedError {
  errorClass: IntelligenceAdapterErrorClass;
  errorCode: string;
  message: string;
}

export type IntelligenceAdapterRunStatus =
  | "succeeded"
  | "payload_blocked"
  | "adapter_failed"
  | "adapter_blocked"
  | "adapter_status_invalid"
  | "output_rejected";

export interface RunFixtureIntelligenceAdapterInput extends PrepareIntelligencePayloadDryRunInput {
  capability: IntelligenceCapabilityId;
  entityType: "product";
  entityId: string;
  sourceRecordId: string;
  sourceVersion: number;
  sourceHash: string;
  promptVersion: string;
  schemaVersion: string;
  correlationId: string;
}

export interface FixtureIntelligenceAdapterRunResult {
  status: IntelligenceAdapterRunStatus;
  payloadAllowed: boolean;
  adapterResponse?: IntelligenceAdapterResponse;
  adapterError?: IntelligenceAdapterNormalizedError;
  outputValidation?: IntelligenceProviderOutputValidationResult;
  errors: string[];
  providerCallAttempted: boolean;
  canonicalProductMutationEnabled: false;
}

export interface CreateAiSuggestionInput {
  tenantKey: string;
  executionId: string;
  capability: string;
  entityType: string;
  entityId: string;
  fieldPath: string;
  sourceRecordId: string;
  sourceVersion: number;
  sourceHash: string;
  promptVersion: string;
  schemaVersion: string;
  generatedPayload: Prisma.InputJsonValue;
  suggestedValue: Prisma.InputJsonValue;
  evidence?: Prisma.InputJsonValue[];
  requiresEvidence?: boolean;
  confidence?: number | null;
  attributeFamily?: string | null;
  generationFingerprint?: string | null;
  idempotencyFingerprint?: string | null;
  validationEvidenceId?: string | null;
  auditEventIds?: string[];
  evaluation?: Prisma.InputJsonValue;
}

export interface ReviewAiSuggestionInput {
  decision: AiSuggestionReviewDecision;
  reviewedBy: string;
  reviewedValue?: Prisma.InputJsonValue | null;
  reviewReason?: string | null;
  reviewedAt?: Date | string | null;
  currentSourceVersion?: number;
  currentSourceHash?: string | null;
  auditEventIds?: string[];
}
