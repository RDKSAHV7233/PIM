import type { AppRole } from "../common/rbac/roles";

export type IntelligenceCapabilityStatus = "planned" | "disabled";

export interface IntelligenceActor {
  actorId?: string;
  actorRole?: AppRole;
  tenantId?: string;
  effectiveRoles?: string[];
}

export interface IntelligenceCapabilitySummary {
  id: string;
  status: IntelligenceCapabilityStatus;
  canonicalMutation: false;
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
