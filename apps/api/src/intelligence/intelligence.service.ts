import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { IntelligenceCapabilityRegistry } from "./intelligence-capability.registry";
import {
  isSecretLikeKey,
  isValidPayloadSegment,
  parseRule,
  resolveLeaf,
  validateRulePath,
  wildcardSegments,
  type ParsedPolicyRule,
} from "./intelligence-payload-policy";
import { hasCredentialShape, violatesGuard, type GuardMode } from "./intelligence-secret-detection";
import {
  INTELLIGENCE_PROVIDER_ADAPTER,
  normalizeIntelligenceAdapterException,
  normalizeIntelligenceAdapterFailure,
} from "./intelligence-adapter-boundary";
import { InvalidMoneyError, parseMicros } from "./intelligence-money";
import type {
  AiDataClassification,
  AiFieldClassificationRule,
  ClassifyIntelligencePayloadInput,
  CreateAiSuggestionInput,
  CreateAiExecutionInput,
  FinalizeAiExecutionInput,
  FixtureIntelligenceAdapterRunResult,
  IntelligenceActor,
  IntelligenceBoundaryStatus,
  IntelligenceCapabilitySummary,
  IntelligencePayloadBlockReason,
  IntelligencePayloadClassificationResult,
  IntelligencePayloadDryRunResult,
  IntelligenceProviderOutputSuggestionCandidate,
  IntelligenceProviderOutputValidationResult,
  PrepareIntelligencePayloadDryRunInput,
  RecordPolicyBlockedExecutionInput,
  ReviewAiSuggestionInput,
  IntelligenceAdapterResponse,
  IntelligenceProviderAdapter,
  RunFixtureIntelligenceAdapterInput,
  AiProviderExecutionMode,
  UpsertAiTenantPolicyInput,
  ValidateIntelligenceProviderOutputInput,
} from "./intelligence.types";

const AI_DATA_CLASSIFICATIONS = new Set<AiDataClassification>(["AI_ALLOWED", "AI_ALLOWED_WITH_REDACTION", "AI_BLOCKED"]);
const PROVIDER_OUTPUT_AUTHORITY_FIELDS = new Set([
  "tenantKey",
  "executionId",
  "capability",
  "entityType",
  "entityId",
  "sourceRecordId",
  "sourceVersion",
  "sourceHash",
  "promptVersion",
  "schemaVersion",
  "generationFingerprint",
  "idempotencyFingerprint",
]);

@Injectable()
export class IntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilityRegistry: IntelligenceCapabilityRegistry,
    @Inject(INTELLIGENCE_PROVIDER_ADAPTER) private readonly adapter: IntelligenceProviderAdapter,
  ) {}

  getBoundaryStatus(actor: IntelligenceActor): IntelligenceBoundaryStatus {
    if (!actor.tenantId) {
      throw new ForbiddenException("Tenant context is required.");
    }

    return {
      tenantId: actor.tenantId,
      module: "IntelligenceModule",
      status: "boundary_only",
      providerExecutionEnabled: false,
      canonicalProductMutationEnabled: false,
      capabilities: this.capabilityRegistry.listCapabilities(),
    };
  }

  async createExecution(input: CreateAiExecutionInput) {
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const idempotencyFingerprint =
      this.safeText(input.idempotencyFingerprint) ??
      this.buildIdempotencyFingerprint({
        tenantKey,
        capability: input.capability,
        entityType: input.entityType,
        entityId: input.entityId,
        sourceVersion: input.sourceVersion,
        sourceHash: input.sourceHash,
        requestFingerprint: input.requestFingerprint,
        promptVersion: input.promptVersion,
        schemaVersion: input.schemaVersion,
      });

    return this.prisma.tenant(tenantKey).aiExecution.upsert({
      where: {
        tenantKey_idempotencyFingerprint: {
          tenantKey,
          idempotencyFingerprint,
        },
      },
      create: {
        tenantKey,
        capability: this.requiredText("capability", input.capability),
        entityType: this.requiredText("entityType", input.entityType),
        entityId: this.requiredText("entityId", input.entityId),
        sourceRecordId: this.safeText(input.sourceRecordId),
        sourceVersion: this.nonNegativeInteger("sourceVersion", input.sourceVersion),
        sourceHash: this.requiredText("sourceHash", input.sourceHash),
        requestFingerprint: this.requiredText("requestFingerprint", input.requestFingerprint),
        promptVersion: this.requiredText("promptVersion", input.promptVersion),
        schemaVersion: this.requiredText("schemaVersion", input.schemaVersion),
        idempotencyFingerprint,
        createdByActorId: this.safeText(input.createdByActorId),
        createdByActorRole: this.safeText(input.createdByActorRole),
        correlationId: this.safeText(input.correlationId),
        status: input.status ?? "queued",
        providerKey: this.safeText(input.providerKey),
        providerDisplayName: this.safeText(input.providerDisplayName),
        modelKey: this.safeText(input.modelKey),
        providerRegion: this.safeText(input.providerRegion),
        providerPolicyVersion: this.safeText(input.providerPolicyVersion),
        classificationPolicyVersion: this.safeText(input.classificationPolicyVersion),
        redactionPolicyVersion: this.safeText(input.redactionPolicyVersion),
        promptTemplateHash: this.safeText(input.promptTemplateHash),
        schemaHash: this.safeText(input.schemaHash),
        outputContractVersion: this.safeText(input.outputContractVersion),
        capabilityContractVersion: this.safeText(input.capabilityContractVersion),
        attemptNumber: this.positiveInteger("attemptNumber", input.attemptNumber ?? 1),
        maxAttempts: this.positiveInteger("maxAttempts", input.maxAttempts ?? 1),
        budgetPeriodKey: this.safeText(input.budgetPeriodKey),
      },
      update: {},
    });
  }

  async finalizeExecution(id: string, tenantKeyInput: string, input: FinalizeAiExecutionInput) {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const inputTokens = this.nonNegativeInteger("inputTokens", input.inputTokens ?? 0);
    const outputTokens = this.nonNegativeInteger("outputTokens", input.outputTokens ?? 0);
    const cachedInputTokens = this.nonNegativeInteger("cachedInputTokens", input.cachedInputTokens ?? 0);
    const reasoningTokens = this.nonNegativeInteger("reasoningTokens", input.reasoningTokens ?? 0);
    const totalTokens = inputTokens + outputTokens + cachedInputTokens + reasoningTokens;
    const providerCallAttempted = Boolean(input.providerCallAttempted);
    const estimatedCostMicros = this.microsInput("estimatedCostMicros", input.estimatedCostMicros ?? 0);
    const actualCostMicros =
      input.actualCostMicros === null || input.actualCostMicros === undefined ? null : this.microsInput("actualCostMicros", input.actualCostMicros);

    if (!providerCallAttempted && estimatedCostMicros !== 0n) {
      throw new BadRequestException("Blocked executions cannot record provider cost.");
    }
    if (!providerCallAttempted && actualCostMicros !== null) {
      throw new BadRequestException("Blocked executions cannot record actual provider cost.");
    }
    if (input.containsCredentials) {
      throw new BadRequestException("AiExecution telemetry cannot contain credentials.");
    }

    return this.prisma.tenant(tenantKey).aiExecution.update({
      where: {
        id,
        tenantKey,
      },
      data: {
        status: input.status,
        providerRequestId: this.safeText(input.providerRequestId),
        modelVersion: this.safeText(input.modelVersion),
        startedAt: this.optionalDate(input.startedAt),
        finishedAt: this.optionalDate(input.finishedAt),
        durationMs: this.optionalNonNegativeInteger("durationMs", input.durationMs),
        retryable: Boolean(input.retryable),
        inputTokens,
        outputTokens,
        cachedInputTokens,
        reasoningTokens,
        totalTokens,
        billableUnits: this.nonNegativeInteger("billableUnits", input.billableUnits ?? totalTokens),
        estimatedCostMicros,
        actualCostMicros,
        currency: this.safeCurrency(input.currency),
        costSource: input.costSource ?? (estimatedCostMicros > 0n ? "estimated" : "none"),
        pricingVersion: this.safeText(input.pricingVersion),
        failureClass: input.failureClass ?? null,
        failureCode: this.safeText(input.failureCode),
        failureMessageSafe: this.safeFailureMessage(input.failureMessageSafe),
        providerStatusCode: this.optionalNonNegativeInteger("providerStatusCode", input.providerStatusCode),
        providerCallAttempted,
        auditEventIds: this.stringArray(input.auditEventIds) as Prisma.InputJsonValue,
        validationEvidenceId: this.safeText(input.validationEvidenceId),
        classificationEvidenceId: this.safeText(input.classificationEvidenceId),
        redactionEvidenceId: this.safeText(input.redactionEvidenceId),
        requestPayloadHash: this.safeText(input.requestPayloadHash),
        responsePayloadHash: this.safeText(input.responsePayloadHash),
        generatedPayloadHash: this.safeText(input.generatedPayloadHash),
        suggestionIds: this.stringArray(input.suggestionIds) as Prisma.InputJsonValue,
        requestPayloadStorageRef: this.safeText(input.requestPayloadStorageRef),
        responsePayloadStorageRef: this.safeText(input.responsePayloadStorageRef),
        containsBlockedData: Boolean(input.containsBlockedData),
        containsCredentials: false,
        redactedFields: this.fieldPathArray(input.redactedFields) as Prisma.InputJsonValue,
        blockedFields: this.fieldPathArray(input.blockedFields) as Prisma.InputJsonValue,
      },
    });
  }

  async upsertTenantPolicy(input: UpsertAiTenantPolicyInput) {
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const capability = this.requiredText("capability", input.capability ?? "product_intelligence");
    const providerKey = this.requiredText("providerKey", input.providerKey ?? "default");
    const policyVersion = this.requiredText("policyVersion", input.policyVersion);
    const fieldClassifications = this.validateFieldClassifications(input.fieldClassifications ?? {});
    const retentionDays = this.nonNegativeInteger("retentionDays", input.retentionDays ?? 0);
    const maxPayloadBytes = this.nonNegativeInteger("maxPayloadBytes", input.maxPayloadBytes ?? 0);

    return this.prisma.tenant(tenantKey).aiTenantPolicy.upsert({
      where: {
        tenantKey_capability_providerKey_policyVersion: {
          tenantKey,
          capability,
          providerKey,
          policyVersion,
        },
      },
      create: {
        tenantKey,
        capability,
        providerKey,
        policyVersion,
        status: input.status ?? "draft",
        intelligenceEnabled: Boolean(input.intelligenceEnabled),
        providerExecutionEnabled: Boolean(input.providerExecutionEnabled),
        killSwitchEnabled: input.killSwitchEnabled !== false,
        tenantOptOut: input.tenantOptOut !== false,
        allowModelTraining: false,
        allowHumanProviderReview: Boolean(input.allowHumanProviderReview),
        allowRawPayloadStorage: false,
        retentionDays,
        maxPayloadBytes,
        defaultClassification: input.defaultClassification ?? "AI_BLOCKED",
        allowedCapabilities: this.stringArray(input.allowedCapabilities) as Prisma.InputJsonValue,
        allowedProviderKeys: this.stringArray(input.allowedProviderKeys) as Prisma.InputJsonValue,
        fieldClassifications: fieldClassifications as unknown as Prisma.InputJsonValue,
        redactionPolicyVersion: this.requiredText("redactionPolicyVersion", input.redactionPolicyVersion),
        classificationPolicyHash: this.requiredText("classificationPolicyHash", input.classificationPolicyHash),
        dataUseNotes: this.safeText(input.dataUseNotes),
        approvedBy: this.safeText(input.approvedBy),
        approvedAt: this.optionalDate(input.approvedAt),
        auditEventIds: this.stringArray(input.auditEventIds) as Prisma.InputJsonValue,
        createdByActorId: this.safeText(input.createdByActorId),
        updatedByActorId: this.safeText(input.updatedByActorId),
      },
      update: {
        status: input.status ?? "draft",
        intelligenceEnabled: Boolean(input.intelligenceEnabled),
        providerExecutionEnabled: Boolean(input.providerExecutionEnabled),
        killSwitchEnabled: input.killSwitchEnabled !== false,
        tenantOptOut: input.tenantOptOut !== false,
        allowModelTraining: false,
        allowHumanProviderReview: Boolean(input.allowHumanProviderReview),
        allowRawPayloadStorage: false,
        retentionDays,
        maxPayloadBytes,
        defaultClassification: input.defaultClassification ?? "AI_BLOCKED",
        allowedCapabilities: this.stringArray(input.allowedCapabilities) as Prisma.InputJsonValue,
        allowedProviderKeys: this.stringArray(input.allowedProviderKeys) as Prisma.InputJsonValue,
        fieldClassifications: fieldClassifications as unknown as Prisma.InputJsonValue,
        redactionPolicyVersion: this.requiredText("redactionPolicyVersion", input.redactionPolicyVersion),
        classificationPolicyHash: this.requiredText("classificationPolicyHash", input.classificationPolicyHash),
        dataUseNotes: this.safeText(input.dataUseNotes),
        approvedBy: this.safeText(input.approvedBy),
        approvedAt: this.optionalDate(input.approvedAt),
        auditEventIds: this.stringArray(input.auditEventIds) as Prisma.InputJsonValue,
        updatedByActorId: this.safeText(input.updatedByActorId),
      },
    });
  }

  async classifyPayloadForIntelligence(input: ClassifyIntelligencePayloadInput): Promise<IntelligencePayloadClassificationResult> {
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const capability = this.requiredText("capability", input.capability);
    const providerKey = this.requiredText("providerKey", input.providerKey ?? "default");
    const payload = this.requiredJson("payload", input.payload);
    const redactedFields = this.stringArray(input.redactedFields);
    const policy = await this.prisma.tenant(tenantKey).aiTenantPolicy.findFirst({
      where: {
        tenantKey,
        capability,
        providerKey,
        status: "active",
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (!policy) {
      return this.blockedClassificationResult("tenant_policy_blocked", "No active tenant policy found.");
    }
    if (!policy.intelligenceEnabled || !policy.providerExecutionEnabled || policy.killSwitchEnabled || policy.tenantOptOut) {
      return this.blockedClassificationResult("tenant_policy_blocked", "Tenant policy does not permit intelligence payload use.", policy);
    }
    if (!this.jsonStringArray(policy.allowedCapabilities).includes(capability)) {
      return this.blockedClassificationResult("tenant_policy_blocked", "Capability is not allowed by tenant policy.", policy);
    }
    if (!this.jsonStringArray(policy.allowedProviderKeys).includes(providerKey)) {
      return this.blockedClassificationResult("tenant_policy_blocked", "Provider key is not allowed by tenant policy.", policy);
    }
    if (policy.maxPayloadBytes > 0 && Buffer.byteLength(this.stableJsonStringify(payload), "utf8") > policy.maxPayloadBytes) {
      return this.blockedClassificationResult("tenant_policy_blocked", "Payload exceeds tenant policy size limit.", policy);
    }

    const rules = this.parsePolicyRules(policy.fieldClassifications);
    const blockedFields: string[] = [];
    const unknownFields: string[] = [];
    const blockedReasons = new Set<IntelligencePayloadBlockReason>();
    const block = (path: string, reason: IntelligencePayloadBlockReason) => {
      blockedFields.push(path);
      blockedReasons.add(reason);
    };

    if (!this.isRecord(payload)) {
      // Only an object can be classified field by field; any other root would otherwise carry unchecked content.
      block("$", "unsupported_payload_shape");
    }

    for (const leaf of this.isRecord(payload) ? this.payloadLeaves(payload) : []) {
      const path = this.leafDisplayPath(leaf.segments);
      if (!leaf.segments.every(isValidPayloadSegment)) {
        block(path, "invalid_path_segment");
        continue;
      }

      const { matched, effective } = resolveLeaf(rules, leaf.segments);
      if (effective === null) {
        unknownFields.push(path);
      }
      const classification = effective ?? (policy.defaultClassification as AiDataClassification);
      if (classification === "AI_BLOCKED") {
        block(path, effective === null ? "unknown_path" : "blocked_by_policy");
        continue;
      }
      if (classification === "AI_ALLOWED_WITH_REDACTION" && !redactedFields.includes(path)) {
        block(path, "redaction_required");
        continue;
      }
      // A wildcard rule admits key names nobody listed, so those key names must not look like credentials.
      if (matched.some((rule) => wildcardSegments(rule, leaf.segments).some(isSecretLikeKey))) {
        block(path, "secret_like_key");
        continue;
      }
      if (typeof leaf.value === "string") {
        if (hasCredentialShape(leaf.value)) {
          block(path, "secret_like_text");
        }
      } else if (Array.isArray(leaf.value)) {
        for (const element of leaf.value) {
          if (element !== null && typeof element === "object") {
            block(path, "unsupported_array_element");
            break;
          }
          if (typeof element === "string" && hasCredentialShape(element)) {
            block(path, "secret_like_text");
            break;
          }
        }
      }
    }

    if (blockedFields.length > 0 || unknownFields.length > 0) {
      return {
        allowed: false,
        policyId: policy.id,
        policyVersion: policy.policyVersion,
        blockedFields: [...new Set(blockedFields)],
        unknownFields: [...new Set(unknownFields)],
        blockedReasons: [...blockedReasons].sort(),
        redactedFields,
        classificationEvidenceId: this.buildEvidenceId("classification", policy.id, payload),
        redactionEvidenceId: redactedFields.length > 0 ? this.buildEvidenceId("redaction", policy.id, redactedFields) : undefined,
        reason: "Payload contains blocked or unknown fields.",
      };
    }

    return {
      allowed: true,
      policyId: policy.id,
      policyVersion: policy.policyVersion,
      blockedFields: [],
      unknownFields: [],
      redactedFields,
      classificationEvidenceId: this.buildEvidenceId("classification", policy.id, payload),
      redactionEvidenceId: redactedFields.length > 0 ? this.buildEvidenceId("redaction", policy.id, redactedFields) : undefined,
      payloadHash: policy.allowRawPayloadStorage ? this.hashJson(payload) : undefined,
    };
  }

  async recordPolicyBlockedExecution(input: RecordPolicyBlockedExecutionInput) {
    return this.finalizeExecution(input.executionId, input.tenantKey, {
      status: "blocked",
      failureClass: input.result.reason?.includes("policy") ? "tenant_policy_blocked" : "classification_blocked",
      providerCallAttempted: false,
      estimatedCostMicros: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      billableUnits: 0,
      auditEventIds: input.auditEventIds,
      classificationEvidenceId: input.result.classificationEvidenceId,
      redactionEvidenceId: input.result.redactionEvidenceId,
      requestPayloadHash: null,
      containsBlockedData: input.result.blockedFields.length > 0,
      containsCredentials: false,
      blockedFields: [...input.result.blockedFields, ...input.result.unknownFields],
      redactedFields: input.result.redactedFields,
    });
  }

  async prepareIntelligencePayloadDryRun(input: PrepareIntelligencePayloadDryRunInput): Promise<IntelligencePayloadDryRunResult> {
    const classification = await this.classifyPayloadForIntelligence(input);
    if (!classification.allowed && input.executionId) {
      await this.recordPolicyBlockedExecution({
        executionId: input.executionId,
        tenantKey: input.tenantKey,
        result: classification,
        auditEventIds: input.auditEventIds,
      });
    }

    return {
      allowed: classification.allowed,
      classification,
      payloadFingerprint: classification.allowed ? this.hashJson(input.payload) : undefined,
      executionRecorded: !classification.allowed && Boolean(input.executionId),
      providerCallAttempted: false,
      estimatedCostMicros: 0,
    };
  }

  async validateStructuredOutputForSuggestions(
    input: ValidateIntelligenceProviderOutputInput,
  ): Promise<IntelligenceProviderOutputValidationResult> {
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const capability = this.requiredText("capability", input.capability);
    const entityType = this.requiredText("entityType", input.entityType);
    const entityId = this.requiredText("entityId", input.entityId);
    const promptVersion = this.requiredText("promptVersion", input.promptVersion);
    const schemaVersion = this.requiredText("schemaVersion", input.schemaVersion);
    const source = {
      sourceRecordId: this.requiredText("sourceRecordId", input.sourceRecordId),
      sourceVersion: this.nonNegativeInteger("sourceVersion", input.sourceVersion),
      sourceHash: this.requiredText("sourceHash", input.sourceHash),
    };
    const validationEvidenceId = this.buildEvidenceId("provider-output-validation", input.executionId, input.providerOutput);
    const errors: string[] = [];
    const validatedSuggestions: IntelligenceProviderOutputValidationResult["validatedSuggestions"] = [];

    if (!this.capabilityRegistry.isInAi001Scope(capability)) {
      errors.push("capability is not in AI-001 scope.");
    }
    if (this.capabilityRegistry.isExplicitlyOutOfScope(capability)) {
      errors.push("capability is explicitly out of scope for AI-001.");
    }
    if (entityType !== "product") {
      errors.push("entityType must be product.");
    }

    try {
      this.assertSafeJson("providerOutput", input.providerOutput);
    } catch (error) {
      errors.push(this.errorMessage(error));
    }

    if (!this.isRecord(input.providerOutput)) {
      errors.push("providerOutput must be an object.");
      return this.structuredOutputValidationResult(false, 0, validationEvidenceId, errors, validatedSuggestions);
    }

    const providerOutput = input.providerOutput as Record<string, unknown>;
    const candidates = providerOutput.suggestions;
    if (!Array.isArray(candidates)) {
      errors.push("providerOutput.suggestions must be an array.");
      return this.structuredOutputValidationResult(false, 0, validationEvidenceId, errors, validatedSuggestions);
    }
    if (candidates.length === 0) {
      errors.push("providerOutput.suggestions must not be empty.");
      return this.structuredOutputValidationResult(false, 0, validationEvidenceId, errors, validatedSuggestions);
    }

    const fieldPaths = new Set<string>();
    candidates.forEach((candidate, index) => {
      const itemErrors: string[] = [];
      if (!this.isRecord(candidate)) {
        errors.push(`suggestions[${index}] must be an object.`);
        return;
      }

      const record = candidate as unknown as IntelligenceProviderOutputSuggestionCandidate;
      for (const key of Object.keys(candidate)) {
        if (PROVIDER_OUTPUT_AUTHORITY_FIELDS.has(key)) {
          itemErrors.push(`provider output must not supply server authority field ${key}.`);
        }
      }
      const generatedPayload = record.generatedPayload ?? (candidate as Prisma.InputJsonValue);
      const evidence = Array.isArray(record.evidence) ? record.evidence : [];
      let fieldPath: string | null = null;
      let confidence: number | null | undefined = null;
      let attributeFamily: string | null = null;

      try {
        fieldPath = this.requiredText(`suggestions[${index}].fieldPath`, record.fieldPath);
        this.requiredJson(`suggestions[${index}].suggestedValue`, record.suggestedValue);
        this.assertSafeJson(`suggestions[${index}].generatedPayload`, generatedPayload);
        this.assertSafeJson(`suggestions[${index}].suggestedValue`, record.suggestedValue);
        this.assertSafeJson(`suggestions[${index}].evidence`, evidence);
        this.assertEvidenceMatches(source, record.requiresEvidence !== false, evidence);
        confidence = this.optionalConfidence(record.confidence);
        attributeFamily = this.safeText(record.attributeFamily);
      } catch (error) {
        itemErrors.push(this.errorMessage(error));
      }

      if (itemErrors.length > 0 || !fieldPath) {
        errors.push(...itemErrors.map((error) => `suggestions[${index}]: ${error}`));
        return;
      }
      if (fieldPaths.has(fieldPath)) {
        errors.push(`suggestions[${index}]: duplicate fieldPath is not allowed.`);
        return;
      }
      fieldPaths.add(fieldPath);

      validatedSuggestions.push({
        tenantKey,
        executionId: this.requiredText("executionId", input.executionId),
        capability,
        entityType,
        entityId,
        fieldPath,
        sourceRecordId: source.sourceRecordId,
        sourceVersion: source.sourceVersion,
        sourceHash: source.sourceHash,
        promptVersion,
        schemaVersion,
        generatedPayload: generatedPayload as Prisma.InputJsonValue,
        suggestedValue: record.suggestedValue,
        evidence,
        requiresEvidence: record.requiresEvidence !== false,
        confidence,
        attributeFamily,
        validationEvidenceId,
        auditEventIds: input.auditEventIds,
      });
    });

    return this.structuredOutputValidationResult(errors.length === 0, candidates.length, validationEvidenceId, errors, validatedSuggestions);
  }

  async runFixtureAdapterContract(input: RunFixtureIntelligenceAdapterInput): Promise<FixtureIntelligenceAdapterRunResult> {
    const dryRun = await this.prepareIntelligencePayloadDryRun(input);
    if (!dryRun.allowed || !dryRun.payloadFingerprint) {
      return {
        status: "payload_blocked",
        payloadAllowed: false,
        errors: [dryRun.classification.reason ?? "Payload is not allowed across the intelligence adapter boundary."],
        providerCallAttempted: false,
        canonicalProductMutationEnabled: false,
      };
    }

    const request = {
      tenantKey: normalizeTenantKey(input.tenantKey),
      capability: input.capability,
      entityType: input.entityType,
      entityId: this.requiredText("entityId", input.entityId),
      sourceRecordId: this.requiredText("sourceRecordId", input.sourceRecordId),
      sourceVersion: this.nonNegativeInteger("sourceVersion", input.sourceVersion),
      sourceHash: this.requiredText("sourceHash", input.sourceHash),
      promptVersion: this.requiredText("promptVersion", input.promptVersion),
      schemaVersion: this.requiredText("schemaVersion", input.schemaVersion),
      payload: input.payload,
      payloadFingerprint: dryRun.payloadFingerprint,
      correlationId: this.requiredText("correlationId", input.correlationId),
    };

    let adapterResponse: IntelligenceAdapterResponse;
    try {
      adapterResponse = await this.adapter.generateStructuredOutput(request);
    } catch (error) {
      // The adapter was invoked, so a provider call cannot be ruled out; report it conservatively.
      const adapterError = normalizeIntelligenceAdapterException(error);
      return {
        status: "adapter_failed",
        payloadAllowed: true,
        adapterError,
        errors: [adapterError.message],
        providerCallAttempted: true,
        canonicalProductMutationEnabled: false,
      };
    }

    // finishStatus is untrusted adapter output: only an exact "completed" may proceed, anything unknown fails closed.
    const finishStatus: unknown = adapterResponse?.finishStatus;
    if (finishStatus !== "completed") {
      const known = finishStatus === "blocked" || finishStatus === "failed";
      const adapterError = known
        ? normalizeIntelligenceAdapterFailure(
            adapterResponse.errorClass,
            adapterResponse.errorCode,
            finishStatus === "blocked" ? "adapter_blocked" : "adapter_failed",
          )
        : normalizeIntelligenceAdapterFailure("internal_error", undefined, "adapter_status_invalid");
      const { structuredOutput: _discarded, ...nonSuccessResponse } = adapterResponse ?? ({} as IntelligenceAdapterResponse);
      return {
        status: !known ? "adapter_status_invalid" : finishStatus === "blocked" ? "adapter_blocked" : "adapter_failed",
        payloadAllowed: true,
        // Unknown status means the response cannot be trusted at all, so none of it is echoed back.
        adapterResponse: known
          ? { ...nonSuccessResponse, errorClass: adapterError.errorClass, errorCode: adapterError.errorCode }
          : undefined,
        adapterError,
        errors: [adapterError.message],
        providerCallAttempted: adapterResponse?.providerCallAttempted === true,
        canonicalProductMutationEnabled: false,
      };
    }

    const providerCallAttempted = adapterResponse.providerCallAttempted === true;
    if (!adapterResponse.structuredOutput) {
      return {
        status: "output_rejected",
        payloadAllowed: true,
        adapterResponse,
        errors: ["Intelligence adapter completed without structured output."],
        providerCallAttempted,
        canonicalProductMutationEnabled: false,
      };
    }

    const outputValidation = await this.validateStructuredOutputForSuggestions({
      tenantKey: input.tenantKey,
      executionId: this.requiredText("executionId", input.executionId),
      capability: input.capability,
      entityType: input.entityType,
      entityId: input.entityId,
      sourceRecordId: input.sourceRecordId,
      sourceVersion: input.sourceVersion,
      sourceHash: input.sourceHash,
      promptVersion: input.promptVersion,
      schemaVersion: input.schemaVersion,
      providerOutput: adapterResponse.structuredOutput,
      auditEventIds: input.auditEventIds,
    });

    return {
      status: outputValidation.schemaValid && outputValidation.errors.length === 0 ? "succeeded" : "output_rejected",
      payloadAllowed: true,
      adapterResponse,
      outputValidation,
      errors: outputValidation.errors,
      providerCallAttempted,
      canonicalProductMutationEnabled: false,
    };
  }

  async createSuggestion(input: CreateAiSuggestionInput) {
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const generatedPayload = this.requiredJson("generatedPayload", input.generatedPayload);
    const suggestedValue = this.requiredJson("suggestedValue", input.suggestedValue);
    const evidence = this.evidenceArray(input.evidence);
    const requiresEvidence = input.requiresEvidence !== false;

    this.assertSafeJson("generatedPayload", generatedPayload);
    this.assertSafeJson("suggestedValue", suggestedValue);
    this.assertSafeJson("evidence", evidence);
    this.assertEvidenceMatches(
      {
        sourceRecordId: this.requiredText("sourceRecordId", input.sourceRecordId),
        sourceVersion: this.nonNegativeInteger("sourceVersion", input.sourceVersion),
        sourceHash: this.requiredText("sourceHash", input.sourceHash),
      },
      requiresEvidence,
      evidence,
    );

    const generatedPayloadHash = this.hashJson(generatedPayload);
    const suggestedValueHash = this.hashJson(suggestedValue);
    const evidenceHash = evidence.length > 0 ? this.hashJson(evidence) : null;
    const sourceRecordId = this.requiredText("sourceRecordId", input.sourceRecordId);
    const sourceVersion = this.nonNegativeInteger("sourceVersion", input.sourceVersion);
    const sourceHash = this.requiredText("sourceHash", input.sourceHash);
    const capability = this.requiredText("capability", input.capability);
    const entityType = this.requiredText("entityType", input.entityType);
    const entityId = this.requiredText("entityId", input.entityId);
    const fieldPath = this.requiredText("fieldPath", input.fieldPath);
    const promptVersion = this.requiredText("promptVersion", input.promptVersion);
    const schemaVersion = this.requiredText("schemaVersion", input.schemaVersion);
    const generationFingerprint =
      this.safeText(input.generationFingerprint) ??
      this.buildSuggestionGenerationFingerprint({
        tenantKey,
        capability,
        entityType,
        entityId,
        fieldPath,
        sourceRecordId,
        sourceVersion,
        sourceHash,
        promptVersion,
        schemaVersion,
        generatedPayloadHash,
      });
    const idempotencyFingerprint =
      this.safeText(input.idempotencyFingerprint) ??
      this.buildSuggestionIdempotencyFingerprint({
        tenantKey,
        generationFingerprint,
      });

    return this.prisma.tenant(tenantKey).aiSuggestion.upsert({
      where: {
        tenantKey_idempotencyFingerprint: {
          tenantKey,
          idempotencyFingerprint,
        },
      },
      create: {
        tenantKey,
        executionId: this.requiredText("executionId", input.executionId),
        capability,
        entityType,
        entityId,
        fieldPath,
        attributeFamily: this.safeText(input.attributeFamily),
        sourceRecordId,
        sourceVersion,
        sourceHash,
        promptVersion,
        schemaVersion,
        generationFingerprint,
        idempotencyFingerprint,
        generatedPayload,
        generatedPayloadHash,
        suggestedValue,
        suggestedValueHash,
        confidence: this.optionalConfidence(input.confidence),
        evidence: evidence as Prisma.InputJsonValue,
        requiresEvidence,
        evidenceHash,
        status: "pending_review",
        validationEvidenceId: this.safeText(input.validationEvidenceId),
        auditEventIds: this.stringArray(input.auditEventIds) as Prisma.InputJsonValue,
        evaluation: this.optionalJsonObject(input.evaluation),
      },
      update: {},
    });
  }

  async reviewSuggestion(id: string, tenantKeyInput: string, input: ReviewAiSuggestionInput) {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const suggestion = await this.prisma.tenant(tenantKey).aiSuggestion.findUnique({
      where: {
        id,
        tenantKey,
      },
    });

    if (!suggestion) {
      throw new NotFoundException("AiSuggestion was not found for this tenant.");
    }

    if (
      suggestion.generatedPayloadHash !== this.hashJson(suggestion.generatedPayload) ||
      suggestion.suggestedValueHash !== this.hashJson(suggestion.suggestedValue) ||
      (suggestion.evidenceHash && suggestion.evidenceHash !== this.hashJson(suggestion.evidence))
    ) {
      await this.markSuggestionStatus(id, tenantKey, "blocked_tampered", input.auditEventIds);
      throw new BadRequestException("AiSuggestion generated payload failed tamper validation.");
    }

    if (
      (input.currentSourceVersion !== undefined && input.currentSourceVersion !== suggestion.sourceVersion) ||
      (input.currentSourceHash && input.currentSourceHash !== suggestion.sourceHash)
    ) {
      await this.markSuggestionStatus(id, tenantKey, "blocked_stale", input.auditEventIds);
      throw new BadRequestException("AiSuggestion source is stale.");
    }

    const decision = input.decision;
    const reviewedBy = this.requiredText("reviewedBy", input.reviewedBy);
    const reviewedAt = this.optionalDate(input.reviewedAt) ?? new Date();
    const auditEventIds = this.stringArray(input.auditEventIds) as Prisma.InputJsonValue;

    if (decision === "accept") {
      return this.prisma.tenant(tenantKey).aiSuggestion.update({
        where: { id, tenantKey },
        data: {
          status: "accepted",
          reviewDecision: "accept",
          reviewedValue: suggestion.suggestedValue as Prisma.InputJsonValue,
          reviewedValueHash: suggestion.suggestedValueHash,
          reviewedBy,
          reviewedAt,
          reviewReason: this.safeText(input.reviewReason),
          auditEventIds,
        },
      });
    }

    if (decision === "edit") {
      const reviewedValue = this.requiredJson("reviewedValue", input.reviewedValue);
      this.assertSafeJson("reviewedValue", reviewedValue);
      const reviewedValueHash = this.hashJson(reviewedValue);
      if (reviewedValueHash === suggestion.suggestedValueHash) {
        throw new BadRequestException("Edited suggestions must preserve a distinct reviewed value.");
      }
      return this.prisma.tenant(tenantKey).aiSuggestion.update({
        where: { id, tenantKey },
        data: {
          status: "edited",
          reviewDecision: "edit",
          reviewedValue,
          reviewedValueHash,
          reviewedBy,
          reviewedAt,
          reviewReason: this.requiredText("reviewReason", input.reviewReason),
          auditEventIds,
        },
      });
    }

    return this.prisma.tenant(tenantKey).aiSuggestion.update({
      where: { id, tenantKey },
      data: {
        status: "rejected",
        reviewDecision: "reject",
        reviewedValue: Prisma.DbNull,
        reviewedValueHash: null,
        reviewedBy,
        reviewedAt,
        reviewReason: this.requiredText("reviewReason", input.reviewReason),
        appliedValue: Prisma.DbNull,
        appliedValueHash: null,
        appliedAt: null,
        productServiceApplyTransactionId: null,
        auditEventIds,
      },
    });
  }

  private buildIdempotencyFingerprint(input: {
    tenantKey: string;
    capability: string;
    entityType: string;
    entityId: string;
    sourceVersion: number;
    sourceHash: string;
    requestFingerprint: string;
    promptVersion: string;
    schemaVersion: string;
  }) {
    const payload = [
      input.tenantKey,
      input.capability,
      input.entityType,
      input.entityId,
      String(input.sourceVersion),
      input.sourceHash,
      input.requestFingerprint,
      input.promptVersion,
      input.schemaVersion,
    ].join("|");
    return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  }

  private buildSuggestionGenerationFingerprint(input: {
    tenantKey: string;
    capability: string;
    entityType: string;
    entityId: string;
    fieldPath: string;
    sourceRecordId: string;
    sourceVersion: number;
    sourceHash: string;
    promptVersion: string;
    schemaVersion: string;
    generatedPayloadHash: string;
  }) {
    const payload = [
      input.tenantKey,
      input.capability,
      input.entityType,
      input.entityId,
      input.fieldPath,
      input.sourceRecordId,
      String(input.sourceVersion),
      input.sourceHash,
      input.promptVersion,
      input.schemaVersion,
      input.generatedPayloadHash,
    ].join("|");
    return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
  }

  private buildSuggestionIdempotencyFingerprint(input: { tenantKey: string; generationFingerprint: string }) {
    return `sha256:${createHash("sha256").update(`${input.tenantKey}|${input.generationFingerprint}`).digest("hex")}`;
  }

  private buildEvidenceId(kind: string, policyId: string, value: unknown) {
    return `${kind}:${createHash("sha256").update(`${policyId}|${this.stableJsonStringify(value)}`).digest("hex")}`;
  }

  private structuredOutputValidationResult(
    schemaValid: boolean,
    suggestionCount: number,
    validationEvidenceId: string,
    errors: string[],
    validatedSuggestions: IntelligenceProviderOutputValidationResult["validatedSuggestions"],
  ): IntelligenceProviderOutputValidationResult {
    return {
      schemaValid,
      suggestionCount,
      outputPayloadHash: schemaValid ? this.hashJson(validatedSuggestions) : undefined,
      validationEvidenceId,
      errors,
      validatedSuggestions: schemaValid ? validatedSuggestions : [],
      providerCallAttempted: false,
      canonicalProductMutationEnabled: false,
    };
  }

  private blockedClassificationResult(reasonCode: string, reason: string, policy?: { id: string; policyVersion: string }): IntelligencePayloadClassificationResult {
    return {
      allowed: false,
      policyId: policy?.id,
      policyVersion: policy?.policyVersion,
      blockedFields: [],
      redactedFields: [],
      unknownFields: [],
      classificationEvidenceId: `${reasonCode}:blocked`,
      reason,
    };
  }

  private async markSuggestionStatus(id: string, tenantKey: string, status: "blocked_stale" | "blocked_tampered", auditEventIds?: string[]) {
    await this.prisma.tenant(tenantKey).aiSuggestion.update({
      where: { id, tenantKey },
      data: {
        status,
        auditEventIds: this.stringArray(auditEventIds) as Prisma.InputJsonValue,
      },
    });
  }

  private requiredText(field: string, value: string | null | undefined) {
    const normalized = this.safeText(value);
    if (!normalized) {
      throw new BadRequestException(`${field} is required.`);
    }
    return normalized;
  }

  private safeText(value: string | null | undefined) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return null;
    }
    this.assertSafeTelemetryText("telemetry", normalized);
    return normalized;
  }

  /** STRICT by default: operational identifier fields and notes, where no secret-ish word belongs. */
  private assertSafeTelemetryText(field: string, value: string | null | undefined, mode: GuardMode = "strict") {
    const normalized = String(value ?? "");
    if (!normalized) {
      return;
    }
    if (violatesGuard(normalized, mode)) {
      throw new BadRequestException(`${field} contains forbidden sensitive telemetry.`);
    }
  }

  private validateFieldClassifications(value: Record<string, AiFieldClassificationRule>) {
    const result: Record<string, AiFieldClassificationRule> = {};
    for (const [fieldPath, rule] of Object.entries(value)) {
      const normalizedPath = String(fieldPath ?? "").trim();
      if (!normalizedPath) {
        throw new BadRequestException("field classification path is required.");
      }
      if (!AI_DATA_CLASSIFICATIONS.has(rule.classification)) {
        throw new BadRequestException("Unsupported AI data classification.");
      }
      const invalidReason = validateRulePath(normalizedPath);
      if (invalidReason) {
        throw new BadRequestException(`field classification path "${normalizedPath.slice(0, 80)}" is invalid: ${invalidReason}.`);
      }
      result[normalizedPath] = {
        classification: rule.classification,
        redactionEvidenceRequired: Boolean(rule.redactionEvidenceRequired),
      };
    }
    return result;
  }

  /** Stored rules that no longer satisfy the grammar are dropped, so the leaves they would have covered fail closed as unknown. */
  private parsePolicyRules(value: unknown): ParsedPolicyRule[] {
    const rules: ParsedPolicyRule[] = [];
    for (const [fieldPath, rule] of Object.entries(this.normalizeFieldClassifications(value))) {
      const parsed = parseRule(fieldPath, rule.classification, rule.redactionEvidenceRequired);
      if (parsed) {
        rules.push(parsed);
      }
    }
    return rules;
  }

  private normalizeFieldClassifications(value: unknown) {
    if (!this.isRecord(value)) {
      return {};
    }
    const result: Record<string, AiFieldClassificationRule> = {};
    for (const [fieldPath, rule] of Object.entries(value)) {
      if (!this.isRecord(rule)) {
        continue;
      }
      const classification = rule.classification;
      if (typeof classification === "string" && AI_DATA_CLASSIFICATIONS.has(classification as AiDataClassification)) {
        result[fieldPath] = {
          classification: classification as AiDataClassification,
          redactionEvidenceRequired: Boolean(rule.redactionEvidenceRequired),
        };
      }
    }
    return result;
  }

  private requiredJson(field: string, value: unknown): Prisma.InputJsonValue {
    if (value === undefined || value === null) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value as Prisma.InputJsonValue;
  }

  private optionalJsonObject(value: unknown): Prisma.InputJsonValue {
    if (value === undefined || value === null) {
      return {};
    }
    this.assertSafeJson("evaluation", value, "strict");
    return value as Prisma.InputJsonValue;
  }

  private evidenceArray(value: Prisma.InputJsonValue[] | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value;
  }

  private assertEvidenceMatches(
    source: { sourceRecordId: string; sourceVersion: number; sourceHash: string },
    requiresEvidence: boolean,
    evidence: Prisma.InputJsonValue[],
  ) {
    if (!requiresEvidence) {
      return;
    }
    if (evidence.length === 0) {
      throw new BadRequestException("Factual suggestions require evidence.");
    }
    for (const item of evidence) {
      if (!this.isRecord(item)) {
        throw new BadRequestException("Evidence entries must be objects.");
      }
      const evidenceRecord = item as Record<string, unknown>;
      if (evidenceRecord.sourceRecordId !== source.sourceRecordId) {
        throw new BadRequestException("Evidence sourceRecordId must match suggestion sourceRecordId.");
      }
      if (evidenceRecord.sourceVersion !== source.sourceVersion) {
        throw new BadRequestException("Evidence sourceVersion must match suggestion sourceVersion.");
      }
      if (evidenceRecord.sourceHash !== source.sourceHash) {
        throw new BadRequestException("Evidence sourceHash must match suggestion sourceHash.");
      }
      if (!evidenceRecord.sourceField || !evidenceRecord.citation || !evidenceRecord.evidenceHash) {
        throw new BadRequestException("Factual evidence must include sourceField, citation, and evidenceHash.");
      }
    }
  }

  /** Values follow `mode` (free_text for product content, strict for operational JSON). Key names are always checked strictly. */
  private assertSafeJson(field: string, value: unknown, mode: GuardMode = "free_text") {
    const visit = (current: unknown, path: string) => {
      if (typeof current === "string") {
        this.assertSafeTelemetryText(path, current, mode);
        return;
      }
      if (Array.isArray(current)) {
        current.forEach((item, index) => visit(item, `${path}[${index}]`));
        return;
      }
      if (this.isRecord(current)) {
        for (const [key, nested] of Object.entries(current)) {
          if (isSecretLikeKey(key)) {
            throw new BadRequestException(`${path}.${key} contains forbidden sensitive telemetry.`);
          }
          visit(nested, `${path}.${key}`);
        }
      }
    };
    visit(value, field);
  }

  private hashJson(value: unknown) {
    return `sha256:${createHash("sha256").update(this.stableJsonStringify(value)).digest("hex")}`;
  }

  private jsonStringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }

  /** Objects recurse by key; arrays and primitives are leaves. Empty objects carry no data and produce no leaf. */
  private payloadLeaves(value: unknown, prefix: string[] = []): Array<{ segments: string[]; value: unknown }> {
    if (!this.isRecord(value)) {
      return prefix.length > 0 ? [{ segments: prefix, value }] : [];
    }
    return Object.entries(value).flatMap(([key, child]) => this.payloadLeaves(child, [...prefix, key]));
  }

  private leafDisplayPath(segments: string[]) {
    return segments.map((segment) => (segment.length > 64 ? `${segment.slice(0, 64)}...` : segment)).join(".");
  }

  private stableJsonStringify(value: unknown): string {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableJsonStringify(item)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${this.stableJsonStringify(record[key])}`)
      .join(",")}}`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private safeFailureMessage(value: string | null | undefined) {
    const normalized = this.safeText(value);
    if (!normalized) {
      return null;
    }
    return normalized.slice(0, 500);
  }

  /** Money is a bigint inside the service. Numbers are accepted only as safe integers (see intelligence-money). */
  private microsInput(field: string, value: unknown): bigint {
    try {
      return parseMicros(field, value);
    } catch (error) {
      if (error instanceof InvalidMoneyError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private safeCurrency(value: string | null | undefined) {
    const normalized = String(value ?? "USD").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new BadRequestException("currency must be an ISO 4217 code.");
    }
    return normalized;
  }

  private positiveInteger(field: string, value: number) {
    if (!Number.isInteger(value) || value < 1) {
      throw new BadRequestException(`${field} must be a positive integer.`);
    }
    return value;
  }

  private nonNegativeInteger(field: string, value: number) {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${field} must be a non-negative integer.`);
    }
    return value;
  }

  private optionalNonNegativeInteger(field: string, value: number | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }
    return this.nonNegativeInteger(field, value);
  }

  private optionalConfidence(value: number | null | undefined) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
      throw new BadRequestException("confidence must be between 0 and 1.");
    }
    return value;
  }

  private optionalDate(value: Date | string | null | undefined) {
    if (!value) {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("Invalid execution timestamp.");
    }
    return date;
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "Provider output validation failed.";
  }

  private stringArray(value: string[] | undefined) {
    return Array.isArray(value) ? value.map((item) => this.requiredText("array item", item)) : [];
  }

  private fieldPathArray(value: string[] | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.map((item) => {
      const normalized = String(item ?? "").trim();
      if (!normalized) {
        throw new BadRequestException("field path array item is required.");
      }
      return normalized;
    });
  }
}
