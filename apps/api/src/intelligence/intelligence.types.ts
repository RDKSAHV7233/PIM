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

export interface ClassifyIntelligencePayloadInput {
  tenantKey: string;
  capability: string;
  providerKey?: string;
  payload: Prisma.InputJsonValue;
  redactedFields?: string[];
}

export interface IntelligencePayloadClassificationResult {
  allowed: boolean;
  policyId?: string;
  policyVersion?: string;
  blockedFields: string[];
  redactedFields: string[];
  unknownFields: string[];
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
