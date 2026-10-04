import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import type {
  CreateAiExecutionInput,
  FinalizeAiExecutionInput,
  IntelligenceActor,
  IntelligenceBoundaryStatus,
  IntelligenceCapabilitySummary,
} from "./intelligence.types";

const PRODUCT_INTELLIGENCE_CAPABILITIES: readonly IntelligenceCapabilitySummary[] = [
  {
    id: "product_attribute_extraction",
    status: "planned",
    canonicalMutation: false,
  },
  {
    id: "product_specification_extraction",
    status: "planned",
    canonicalMutation: false,
  },
  {
    id: "evidence_backed_suggestions",
    status: "planned",
    canonicalMutation: false,
  },
];

@Injectable()
export class IntelligenceService {
  constructor(private readonly prisma: PrismaService) {}

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
      capabilities: PRODUCT_INTELLIGENCE_CAPABILITIES.map((capability) => ({ ...capability })),
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
    const estimatedCostMicros = this.nonNegativeInteger("estimatedCostMicros", input.estimatedCostMicros ?? 0);

    if (!providerCallAttempted && estimatedCostMicros !== 0) {
      throw new BadRequestException("Blocked executions cannot record provider cost.");
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
        actualCostMicros: this.optionalNonNegativeInteger("actualCostMicros", input.actualCostMicros),
        currency: this.safeCurrency(input.currency),
        costSource: input.costSource ?? (estimatedCostMicros > 0 ? "estimated" : "none"),
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
        redactedFields: this.stringArray(input.redactedFields) as Prisma.InputJsonValue,
        blockedFields: this.stringArray(input.blockedFields) as Prisma.InputJsonValue,
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

  private assertSafeTelemetryText(field: string, value: string | null | undefined) {
    const normalized = String(value ?? "");
    if (!normalized) {
      return;
    }
    if (/\b(api[_ -]?key|bearer\s+|oauth|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|secret|credential)/i.test(normalized)) {
      throw new BadRequestException(`${field} contains forbidden sensitive telemetry.`);
    }
  }

  private safeFailureMessage(value: string | null | undefined) {
    const normalized = this.safeText(value);
    if (!normalized) {
      return null;
    }
    return normalized.slice(0, 500);
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

  private stringArray(value: string[] | undefined) {
    return Array.isArray(value) ? value.map((item) => this.requiredText("array item", item)) : [];
  }
}
