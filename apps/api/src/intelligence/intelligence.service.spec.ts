import { ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PrismaService } from "../prisma/prisma.service";
import { IntelligenceCapabilityRegistry } from "./intelligence-capability.registry";
import { FixtureIntelligenceAdapter } from "./intelligence-fixture.adapter";
import { IntelligenceAdapterError } from "./intelligence-adapter-boundary";
import { IntelligenceService } from "./intelligence.service";
import type { IntelligenceAdapterRequest, IntelligenceAdapterResponse, IntelligenceProviderAdapter } from "./intelligence.types";

describe("IntelligenceService", () => {
  const aiExecution = {
    upsert: jest.fn(),
    update: jest.fn(),
  };
  const aiSuggestion = {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  };
  const aiTenantPolicy = {
    upsert: jest.fn(),
    findFirst: jest.fn(),
  };
  const prisma = {
    tenant: jest.fn().mockReturnValue({ aiExecution, aiSuggestion, aiTenantPolicy }),
  } as unknown as PrismaService;
  const evidence = [
    {
      sourceField: "supplier.specifications.material",
      sourceRecordId: "source-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      citation: "Supplier specifications row 10",
      evidenceHash: "sha256:evidence",
    },
  ];

  const stableJsonStringify = (value: unknown): string => {
    if (value === null || typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonStringify(record[key])}`)
      .join(",")}}`;
  };

  const hashJson = (value: unknown) => `sha256:${createHash("sha256").update(stableJsonStringify(value)).digest("hex")}`;

  const storedSuggestion = {
    id: "suggestion-1",
    tenantKey: "tenant-a",
    executionId: "exec-1",
    capability: "product_attribute_extraction",
    entityType: "product",
    entityId: "prod-1",
    fieldPath: "attributes.material",
    sourceRecordId: "source-1",
    sourceVersion: 3,
    sourceHash: "sha256:source",
    promptVersion: "prompt-v1",
    schemaVersion: "schema-v1",
    generatedPayload: { value: "Cotton" },
    suggestedValue: "Cotton",
    evidence,
    generatedPayloadHash: hashJson({ value: "Cotton" }),
    suggestedValueHash: hashJson("Cotton"),
    evidenceHash: hashJson(evidence),
  };
  const activePolicy = {
    id: "policy-1",
    tenantKey: "tenant-a",
    capability: "product_attribute_extraction",
    providerKey: "default",
    policyVersion: "ai-pol-v1",
    status: "active",
    intelligenceEnabled: true,
    providerExecutionEnabled: true,
    killSwitchEnabled: false,
    tenantOptOut: false,
    maxPayloadBytes: 0,
    allowRawPayloadStorage: false,
    defaultClassification: "AI_BLOCKED",
    allowedCapabilities: ["product_attribute_extraction"],
    allowedProviderKeys: ["default"],
    fieldClassifications: {
      "product.title": { classification: "AI_ALLOWED" },
      "product.internalNotes": { classification: "AI_ALLOWED_WITH_REDACTION", redactionEvidenceRequired: true },
      "connector.apiKey": { classification: "AI_BLOCKED" },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createService = (fixtureAdapter: IntelligenceProviderAdapter = new FixtureIntelligenceAdapter()) =>
    new IntelligenceService(prisma, new IntelligenceCapabilityRegistry(), fixtureAdapter);

  it("exposes only the governed boundary with provider execution and canonical mutation disabled", () => {
    const service = createService();

    const status = service.getBoundaryStatus({
      actorId: "user-1",
      actorRole: "editor",
      tenantId: "tenant-a",
    });

    expect(status).toMatchObject({
      tenantId: "tenant-a",
      module: "IntelligenceModule",
      status: "boundary_only",
      providerExecutionEnabled: false,
      canonicalProductMutationEnabled: false,
    });
    expect(status.capabilities.length).toBeGreaterThan(0);
    expect(status.capabilities.every((capability) => capability.canonicalMutation === false)).toBe(true);
  });

  it("requires tenant context before exposing the boundary", () => {
    const service = createService();

    expect(() => service.getBoundaryStatus({ actorId: "user-1", actorRole: "editor" })).toThrow(ForbiddenException);
  });

  it("creates an idempotent tenant-scoped AiExecution without provider execution", async () => {
    aiExecution.upsert.mockResolvedValue({ id: "exec-1" });
    const service = createService();

    await service.createExecution({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      entityType: "product",
      entityId: "prod-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      requestFingerprint: "sha256:request",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      createdByActorId: "user-1",
    });

    expect(prisma.tenant).toHaveBeenCalledWith("tenant-a");
    expect(aiExecution.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantKey_idempotencyFingerprint: {
            tenantKey: "tenant-a",
            idempotencyFingerprint: expect.stringMatching(/^sha256:/),
          },
        },
        create: expect.objectContaining({
          tenantKey: "tenant-a",
          capability: "product_attribute_extraction",
          providerKey: null,
          modelKey: null,
          status: "queued",
        }),
        update: {},
      }),
    );
  });

  it("finalizes blocked executions with zero provider cost", async () => {
    aiExecution.update.mockResolvedValue({ id: "exec-1", status: "provider_disabled" });
    const service = createService();

    await service.finalizeExecution("exec-1", "tenant-a", {
      status: "provider_disabled",
      providerCallAttempted: false,
      failureClass: "provider_disabled",
      estimatedCostMicros: 0,
      inputTokens: 0,
      outputTokens: 0,
    });

    expect(aiExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "exec-1",
          tenantKey: "tenant-a",
        },
        data: expect.objectContaining({
          status: "provider_disabled",
          providerCallAttempted: false,
          estimatedCostMicros: 0,
          totalTokens: 0,
          costSource: "none",
          containsCredentials: false,
        }),
      }),
    );
  });

  it("rejects sensitive telemetry values", async () => {
    const service = createService();

    await expect(
      service.createExecution({
        tenantKey: "tenant-a",
        capability: "product_attribute_extraction",
        entityType: "product",
        entityId: "prod-1",
        sourceVersion: 1,
        sourceHash: "sha256:source",
        requestFingerprint: "sha256:request",
        promptVersion: "prompt-v1",
        schemaVersion: "schema-v1",
        providerKey: "api_key_should_not_be_here",
      }),
    ).rejects.toThrow("forbidden sensitive telemetry");
  });

  it("creates a tenant-scoped immutable AiSuggestion with factual evidence", async () => {
    aiSuggestion.upsert.mockResolvedValue({ id: "suggestion-1" });
    const service = createService();

    await service.createSuggestion({
      tenantKey: "tenant-a",
      executionId: "exec-1",
      capability: "product_attribute_extraction",
      entityType: "product",
      entityId: "prod-1",
      fieldPath: "attributes.material",
      sourceRecordId: "source-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      generatedPayload: { value: "Cotton" },
      suggestedValue: "Cotton",
      evidence,
      confidence: 0.82,
    });

    expect(prisma.tenant).toHaveBeenCalledWith("tenant-a");
    expect(aiSuggestion.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantKey_idempotencyFingerprint: {
            tenantKey: "tenant-a",
            idempotencyFingerprint: expect.stringMatching(/^sha256:/),
          },
        },
        create: expect.objectContaining({
          tenantKey: "tenant-a",
          executionId: "exec-1",
          fieldPath: "attributes.material",
          suggestedValue: "Cotton",
          suggestedValueHash: hashJson("Cotton"),
          generatedPayloadHash: hashJson({ value: "Cotton" }),
          evidenceHash: hashJson(evidence),
          status: "pending_review",
        }),
        update: {},
      }),
    );
  });

  it("uses a deterministic idempotency fingerprint for the same suggestion", async () => {
    aiSuggestion.upsert.mockResolvedValue({ id: "suggestion-1" });
    const service = createService();
    const input = {
      tenantKey: "tenant-a",
      executionId: "exec-1",
      capability: "product_attribute_extraction",
      entityType: "product",
      entityId: "prod-1",
      fieldPath: "attributes.material",
      sourceRecordId: "source-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      generatedPayload: { value: "Cotton" },
      suggestedValue: "Cotton",
      evidence,
    };

    await service.createSuggestion(input);
    await service.createSuggestion(input);

    const first = aiSuggestion.upsert.mock.calls[0][0].where.tenantKey_idempotencyFingerprint.idempotencyFingerprint;
    const second = aiSuggestion.upsert.mock.calls[1][0].where.tenantKey_idempotencyFingerprint.idempotencyFingerprint;
    expect(first).toEqual(second);
  });

  it("rejects factual suggestions without evidence", async () => {
    const service = createService();

    await expect(
      service.createSuggestion({
        tenantKey: "tenant-a",
        executionId: "exec-1",
        capability: "product_attribute_extraction",
        entityType: "product",
        entityId: "prod-1",
        fieldPath: "attributes.material",
        sourceRecordId: "source-1",
        sourceVersion: 3,
        sourceHash: "sha256:source",
        promptVersion: "prompt-v1",
        schemaVersion: "schema-v1",
        generatedPayload: { value: "Cotton" },
        suggestedValue: "Cotton",
      }),
    ).rejects.toThrow("require evidence");
  });

  it("rejects evidence that does not match the suggestion source", async () => {
    const service = createService();

    await expect(
      service.createSuggestion({
        tenantKey: "tenant-a",
        executionId: "exec-1",
        capability: "product_attribute_extraction",
        entityType: "product",
        entityId: "prod-1",
        fieldPath: "attributes.material",
        sourceRecordId: "source-1",
        sourceVersion: 3,
        sourceHash: "sha256:source",
        promptVersion: "prompt-v1",
        schemaVersion: "schema-v1",
        generatedPayload: { value: "Cotton" },
        suggestedValue: "Cotton",
        evidence: [{ ...evidence[0], sourceRecordId: "other-source" }],
      }),
    ).rejects.toThrow("sourceRecordId");
  });

  it("rejects sensitive suggestion payloads", async () => {
    const service = createService();

    await expect(
      service.createSuggestion({
        tenantKey: "tenant-a",
        executionId: "exec-1",
        capability: "product_attribute_extraction",
        entityType: "product",
        entityId: "prod-1",
        fieldPath: "attributes.material",
        sourceRecordId: "source-1",
        sourceVersion: 3,
        sourceHash: "sha256:source",
        promptVersion: "prompt-v1",
        schemaVersion: "schema-v1",
        generatedPayload: { value: "api_key_should_not_be_here" },
        suggestedValue: "Cotton",
        evidence,
      }),
    ).rejects.toThrow("forbidden sensitive telemetry");
  });

  it("accepts a suggestion without overwriting the generated suggested value", async () => {
    aiSuggestion.findUnique.mockResolvedValue(storedSuggestion);
    aiSuggestion.update.mockResolvedValue({ id: "suggestion-1", status: "accepted" });
    const service = createService();

    await service.reviewSuggestion("suggestion-1", "tenant-a", {
      decision: "accept",
      reviewedBy: "reviewer-1",
      currentSourceVersion: 3,
      currentSourceHash: "sha256:source",
      auditEventIds: ["audit-generation-1", "audit-review-1"],
    });

    expect(aiSuggestion.findUnique).toHaveBeenCalledWith({ where: { id: "suggestion-1", tenantKey: "tenant-a" } });
    expect(aiSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "suggestion-1", tenantKey: "tenant-a" },
        data: expect.objectContaining({
          status: "accepted",
          reviewDecision: "accept",
          reviewedValue: "Cotton",
          reviewedValueHash: hashJson("Cotton"),
        }),
      }),
    );
    expect(aiSuggestion.update.mock.calls[0][0].data).not.toHaveProperty("suggestedValue");
  });

  it("stores edited reviewer value separately from the generated suggestion", async () => {
    aiSuggestion.findUnique.mockResolvedValue(storedSuggestion);
    aiSuggestion.update.mockResolvedValue({ id: "suggestion-1", status: "edited" });
    const service = createService();

    await service.reviewSuggestion("suggestion-1", "tenant-a", {
      decision: "edit",
      reviewedValue: "Organic Cotton",
      reviewedBy: "reviewer-1",
      reviewReason: "Supplier evidence includes organic certification.",
      currentSourceVersion: 3,
      currentSourceHash: "sha256:source",
    });

    expect(aiSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "edited",
          reviewDecision: "edit",
          reviewedValue: "Organic Cotton",
          reviewedValueHash: hashJson("Organic Cotton"),
          reviewReason: "Supplier evidence includes organic certification.",
        }),
      }),
    );
    expect(aiSuggestion.update.mock.calls[0][0].data).not.toHaveProperty("suggestedValue");
  });

  it("blocks stale suggestion review", async () => {
    aiSuggestion.findUnique.mockResolvedValue(storedSuggestion);
    aiSuggestion.update.mockResolvedValue({ id: "suggestion-1", status: "blocked_stale" });
    const service = createService();

    await expect(
      service.reviewSuggestion("suggestion-1", "tenant-a", {
        decision: "accept",
        reviewedBy: "reviewer-1",
        currentSourceVersion: 4,
        currentSourceHash: "sha256:new-source",
      }),
    ).rejects.toThrow("source is stale");
    expect(aiSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "blocked_stale" }),
      }),
    );
  });

  it("blocks tampered generated payload review", async () => {
    aiSuggestion.findUnique.mockResolvedValue({
      ...storedSuggestion,
      generatedPayloadHash: "sha256:tampered",
    });
    aiSuggestion.update.mockResolvedValue({ id: "suggestion-1", status: "blocked_tampered" });
    const service = createService();

    await expect(
      service.reviewSuggestion("suggestion-1", "tenant-a", {
        decision: "accept",
        reviewedBy: "reviewer-1",
        currentSourceVersion: 3,
        currentSourceHash: "sha256:source",
      }),
    ).rejects.toThrow("tamper validation");
    expect(aiSuggestion.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "blocked_tampered" }),
      }),
    );
  });

  it("does not review suggestions outside the active tenant scope", async () => {
    aiSuggestion.findUnique.mockResolvedValue(null);
    const service = createService();

    await expect(
      service.reviewSuggestion("suggestion-1", "tenant-b", {
        decision: "accept",
        reviewedBy: "reviewer-1",
      }),
    ).rejects.toThrow("not found");
    expect(prisma.tenant).toHaveBeenCalledWith("tenant-b");
    expect(aiSuggestion.findUnique).toHaveBeenCalledWith({ where: { id: "suggestion-1", tenantKey: "tenant-b" } });
  });

  it("creates tenant-scoped AiTenantPolicy with fail-closed defaults", async () => {
    aiTenantPolicy.upsert.mockResolvedValue({ id: "policy-1" });
    const service = createService();

    await service.upsertTenantPolicy({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      providerKey: "default",
      policyVersion: "ai-pol-v1",
      status: "active",
      intelligenceEnabled: true,
      providerExecutionEnabled: true,
      killSwitchEnabled: false,
      tenantOptOut: false,
      allowedCapabilities: ["product_attribute_extraction"],
      allowedProviderKeys: ["default"],
      fieldClassifications: {
        "product.title": { classification: "AI_ALLOWED" },
        "connector.apiKey": { classification: "AI_BLOCKED" },
      },
      redactionPolicyVersion: "redaction-v1",
      classificationPolicyHash: "sha256:policy",
      createdByActorId: "security-1",
    });

    expect(prisma.tenant).toHaveBeenCalledWith("tenant-a");
    expect(aiTenantPolicy.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantKey_capability_providerKey_policyVersion: {
            tenantKey: "tenant-a",
            capability: "product_attribute_extraction",
            providerKey: "default",
            policyVersion: "ai-pol-v1",
          },
        },
        create: expect.objectContaining({
          allowModelTraining: false,
          allowRawPayloadStorage: false,
          killSwitchEnabled: false,
          tenantOptOut: false,
          fieldClassifications: expect.objectContaining({
            "connector.apiKey": { classification: "AI_BLOCKED", redactionEvidenceRequired: false },
          }),
        }),
      }),
    );
  });

  it("blocks classification when no active tenant policy exists", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(null);
    const service = createService();

    const result = await service.classifyPayloadForIntelligence({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      payload: { product: { title: "Cotton Kurta" } },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("No active tenant policy");
  });

  it("blocks classification when the policy kill switch is enabled", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue({ ...activePolicy, killSwitchEnabled: true });
    const service = createService();

    const result = await service.classifyPayloadForIntelligence({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      payload: { product: { title: "Cotton Kurta" } },
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("does not permit");
  });

  it("blocks unknown fields by default", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    const service = createService();

    const result = await service.classifyPayloadForIntelligence({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      payload: { product: { title: "Cotton Kurta", unknownFact: "raw" } },
    });

    expect(result.allowed).toBe(false);
    expect(result.unknownFields).toContain("product.unknownFact");
  });

  it("blocks AI_BLOCKED fields before payload use", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    const service = createService();

    const result = await service.classifyPayloadForIntelligence({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      payload: { product: { title: "Cotton Kurta" }, connector: { apiKey: "removed" } },
    });

    expect(result.allowed).toBe(false);
    expect(result.blockedFields).toContain("connector.apiKey");
  });

  it("requires redaction evidence for redactable fields", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    const service = createService();

    const result = await service.classifyPayloadForIntelligence({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      payload: { product: { title: "Cotton Kurta", internalNotes: "[REDACTED]" } },
    });

    expect(result.allowed).toBe(false);
    expect(result.blockedFields).toContain("product.internalNotes");
  });

  it("rejects secret-like values even in allowed fields", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    const service = createService();

    const result = await service.classifyPayloadForIntelligence({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      payload: { product: { title: "bearer token leaked" } },
    });

    expect(result.allowed).toBe(false);
    expect(result.blockedFields).toContain("product.title");
  });

  it("allows sanitized payloads when tenant policy permits every field", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    const service = createService();

    const result = await service.classifyPayloadForIntelligence({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      payload: { product: { title: "Cotton Kurta", internalNotes: "[REDACTED]" } },
      redactedFields: ["product.internalNotes"],
    });

    expect(result.allowed).toBe(true);
    expect(result.blockedFields).toEqual([]);
    expect(result.redactedFields).toEqual(["product.internalNotes"]);
    expect(result.payloadHash).toBeUndefined();
  });

  it("dry-runs an allowed intelligence payload without recording execution telemetry", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    const service = createService();

    const result = await service.prepareIntelligencePayloadDryRun({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      payload: { product: { title: "Cotton Kurta", internalNotes: "[REDACTED]" } },
      redactedFields: ["product.internalNotes"],
    });

    expect(result).toMatchObject({
      allowed: true,
      executionRecorded: false,
      providerCallAttempted: false,
      estimatedCostMicros: 0,
    });
    expect(result.payloadFingerprint).toMatch(/^sha256:/);
    expect(aiExecution.update).not.toHaveBeenCalled();
  });

  it("dry-runs and records blocked zero-cost telemetry when a payload cannot be used", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    aiExecution.update.mockResolvedValue({ id: "exec-1", status: "blocked" });
    const service = createService();

    const result = await service.prepareIntelligencePayloadDryRun({
      tenantKey: "tenant-a",
      capability: "product_attribute_extraction",
      executionId: "exec-1",
      payload: { product: { title: "Cotton Kurta" }, connector: { apiKey: "blocked" } },
      auditEventIds: ["audit-dry-run-blocked-1"],
    });

    expect(result).toMatchObject({
      allowed: false,
      payloadFingerprint: undefined,
      executionRecorded: true,
      providerCallAttempted: false,
      estimatedCostMicros: 0,
    });
    expect(result.classification.blockedFields).toContain("connector.apiKey");
    expect(aiExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exec-1", tenantKey: "tenant-a" },
        data: expect.objectContaining({
          status: "blocked",
          providerCallAttempted: false,
          estimatedCostMicros: 0,
          totalTokens: 0,
          requestPayloadHash: null,
          blockedFields: ["connector.apiKey"],
        }),
      }),
    );
  });

  it("records policy-blocked execution telemetry with zero cost and no request payload hash", async () => {
    aiExecution.update.mockResolvedValue({ id: "exec-1", status: "blocked" });
    const service = createService();

    await service.recordPolicyBlockedExecution({
      executionId: "exec-1",
      tenantKey: "tenant-a",
      result: {
        allowed: false,
        blockedFields: ["connector.apiKey"],
        unknownFields: [],
        redactedFields: [],
        classificationEvidenceId: "classification:blocked",
        reason: "Payload contains blocked or unknown fields.",
      },
      auditEventIds: ["audit-policy-blocked-1"],
    });

    expect(aiExecution.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "exec-1", tenantKey: "tenant-a" },
        data: expect.objectContaining({
          status: "blocked",
          providerCallAttempted: false,
          estimatedCostMicros: 0,
          totalTokens: 0,
          requestPayloadHash: null,
          containsCredentials: false,
          blockedFields: ["connector.apiKey"],
        }),
      }),
    );
  });

  it("validates provider-shaped output into suggestion inputs without persistence or provider calls", async () => {
    const service = createService();

    const result = await service.validateStructuredOutputForSuggestions({
      tenantKey: "tenant-a",
      executionId: "exec-1",
      capability: "product_attribute_extraction",
      entityType: "product",
      entityId: "prod-1",
      sourceRecordId: "source-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      providerOutput: {
        suggestions: [
          {
            fieldPath: "attributes.material",
            suggestedValue: "Cotton",
            generatedPayload: { value: "Cotton", unit: null },
            evidence,
            confidence: 0.91,
            attributeFamily: "material",
          },
        ],
      },
      auditEventIds: ["audit-output-validation-1"],
    });

    expect(result).toMatchObject({
      schemaValid: true,
      suggestionCount: 1,
      providerCallAttempted: false,
      canonicalProductMutationEnabled: false,
      errors: [],
    });
    expect(result.outputPayloadHash).toMatch(/^sha256:/);
    expect(result.validationEvidenceId).toMatch(/^provider-output-validation:/);
    expect(result.validatedSuggestions[0]).toMatchObject({
      tenantKey: "tenant-a",
      executionId: "exec-1",
      capability: "product_attribute_extraction",
      entityType: "product",
      entityId: "prod-1",
      fieldPath: "attributes.material",
      suggestedValue: "Cotton",
      evidence,
      requiresEvidence: true,
      validationEvidenceId: result.validationEvidenceId,
    });
    expect(aiSuggestion.upsert).not.toHaveBeenCalled();
    expect(aiExecution.update).not.toHaveBeenCalled();
  });

  it("rejects provider output suggestions without source-matched evidence", async () => {
    const service = createService();

    const result = await service.validateStructuredOutputForSuggestions({
      tenantKey: "tenant-a",
      executionId: "exec-1",
      capability: "product_attribute_extraction",
      entityType: "product",
      entityId: "prod-1",
      sourceRecordId: "source-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      providerOutput: {
        suggestions: [
          {
            fieldPath: "attributes.material",
            suggestedValue: "Cotton",
            generatedPayload: { value: "Cotton" },
            evidence: [],
          },
        ],
      },
    });

    expect(result.schemaValid).toBe(false);
    expect(result.validatedSuggestions).toEqual([]);
    expect(result.errors.join("\n")).toContain("require evidence");
    expect(result.providerCallAttempted).toBe(false);
    expect(result.canonicalProductMutationEnabled).toBe(false);
  });

  it("rejects provider output containing secret-like generated values", async () => {
    const service = createService();

    const result = await service.validateStructuredOutputForSuggestions({
      tenantKey: "tenant-a",
      executionId: "exec-1",
      capability: "product_attribute_extraction",
      entityType: "product",
      entityId: "prod-1",
      sourceRecordId: "source-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      providerOutput: {
        suggestions: [
          {
            fieldPath: "attributes.material",
            suggestedValue: "Cotton",
            generatedPayload: { value: "bearer token leaked" },
            evidence,
          },
        ],
      },
    });

    expect(result.schemaValid).toBe(false);
    expect(result.errors.join("\n")).toContain("forbidden sensitive telemetry");
    expect(result.outputPayloadHash).toBeUndefined();
  });

  it("runs the fixture adapter contract through dry-run and structured validation without persistence", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    const fixtureAdapter = new FixtureIntelligenceAdapter();
    const adapterSpy = jest.spyOn(fixtureAdapter, "generateStructuredOutput");
    const service = createService(fixtureAdapter);

    const result = await service.runFixtureAdapterContract({
      tenantKey: "tenant-a",
      executionId: "exec-1",
      capability: "product_attribute_extraction",
      entityType: "product",
      entityId: "prod-1",
      sourceRecordId: "source-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      correlationId: "corr-1",
      payload: { product: { title: "Cotton Kurta", internalNotes: "[REDACTED]" } },
      redactedFields: ["product.internalNotes"],
      auditEventIds: ["audit-fixture-contract-1"],
    });

    expect(result).toMatchObject({
      status: "succeeded",
      payloadAllowed: true,
      providerCallAttempted: false,
      canonicalProductMutationEnabled: false,
      errors: [],
    });
    expect(adapterSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "tenant-a",
        capability: "product_attribute_extraction",
        entityType: "product",
        payloadFingerprint: expect.stringMatching(/^sha256:/),
        correlationId: "corr-1",
      }),
    );
    expect(result.adapterResponse).toMatchObject({
      adapterKey: "fixture",
      modelKey: "fixture-model",
      region: "local",
      providerCallAttempted: false,
      usage: expect.objectContaining({
        estimatedCostMicros: 0,
        billableUnits: 0,
      }),
    });
    expect(result.outputValidation).toMatchObject({
      schemaValid: true,
      suggestionCount: 1,
      providerCallAttempted: false,
      canonicalProductMutationEnabled: false,
    });
    expect(aiSuggestion.upsert).not.toHaveBeenCalled();
  });

  it("blocks disallowed payloads before the fixture adapter boundary", async () => {
    aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    const fixtureAdapter = new FixtureIntelligenceAdapter();
    const adapterSpy = jest.spyOn(fixtureAdapter, "generateStructuredOutput");
    const service = createService(fixtureAdapter);

    const result = await service.runFixtureAdapterContract({
      tenantKey: "tenant-a",
      executionId: "exec-1",
      capability: "product_attribute_extraction",
      entityType: "product",
      entityId: "prod-1",
      sourceRecordId: "source-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      correlationId: "corr-1",
      payload: { product: { title: "Cotton Kurta" }, connector: { apiKey: "blocked" } },
    });

    expect(result).toMatchObject({
      status: "payload_blocked",
      payloadAllowed: false,
      providerCallAttempted: false,
      canonicalProductMutationEnabled: false,
    });
    expect(result.errors.join("\n")).toContain("blocked");
    expect(adapterSpy).not.toHaveBeenCalled();
  });

  describe("adapter contract hardening", () => {
    const baseInput = {
      tenantKey: "tenant-a",
      executionId: "exec-1",
      capability: "product_attribute_extraction" as const,
      entityType: "product" as const,
      entityId: "prod-1",
      sourceRecordId: "source-1",
      sourceVersion: 3,
      sourceHash: "sha256:source",
      promptVersion: "prompt-v1",
      schemaVersion: "schema-v1",
      correlationId: "corr-1",
      payload: { product: { title: "Cotton Kurta" } },
    };

    const stubResponse = (overrides: Partial<IntelligenceAdapterResponse> = {}): IntelligenceAdapterResponse => ({
      adapterKey: "stub",
      modelKey: "stub-model",
      modelVersion: "stub-model-v1",
      region: "eu-test",
      requestId: "stub-request-1",
      finishStatus: "completed",
      latencyMs: 1,
      usage: {
        inputTokens: 1,
        outputTokens: 1,
        billableUnits: 1,
        estimatedCostMicros: 5,
        currency: "USD",
        pricingVersion: "stub-v1",
      },
      providerCallAttempted: false,
      ...overrides,
    });

    const stubAdapter = (behavior: (request: IntelligenceAdapterRequest) => Promise<IntelligenceAdapterResponse>) => {
      const generateStructuredOutput = jest.fn(behavior);
      const adapter: IntelligenceProviderAdapter = { adapterKey: "stub", generateStructuredOutput };
      return { adapter, generateStructuredOutput };
    };

    const validSuggestions = (request: IntelligenceAdapterRequest) => ({
      suggestions: [
        {
          fieldPath: "attributes.title",
          attributeFamily: "title",
          suggestedValue: "Cotton Kurta",
          confidence: 0.9,
          evidence: [
            {
              sourceField: "product.title",
              sourceRecordId: request.sourceRecordId,
              sourceVersion: request.sourceVersion,
              sourceHash: request.sourceHash,
              citation: "stub",
              evidenceHash: "sha256:evidence",
            },
          ],
        },
      ],
    });

    beforeEach(() => {
      aiTenantPolicy.findFirst.mockResolvedValue(activePolicy);
    });

    const expectNoPersistence = () => expect(aiSuggestion.upsert).not.toHaveBeenCalled();

    it("accepts any adapter that implements the provider-neutral interface", async () => {
      const { adapter, generateStructuredOutput } = stubAdapter(async (request) =>
        stubResponse({ structuredOutput: validSuggestions(request) }),
      );

      const result = await createService(adapter).runFixtureAdapterContract(baseInput);

      expect(generateStructuredOutput).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ status: "succeeded", errors: [], canonicalProductMutationEnabled: false });
      expect(result.adapterResponse).toMatchObject({ adapterKey: "stub", modelKey: "stub-model", region: "eu-test" });
      expectNoPersistence();
    });

    it("rejects malformed structured output", async () => {
      const { adapter } = stubAdapter(async () => stubResponse({ structuredOutput: { suggestions: "not-an-array" } }));

      const result = await createService(adapter).runFixtureAdapterContract(baseInput);

      expect(result.status).toBe("output_rejected");
      expect(result.outputValidation?.schemaValid).toBe(false);
      expect(result.errors.join("\n")).toContain("suggestions must be an array");
      expectNoPersistence();
    });

    it("rejects a suggestion that is missing provenance", async () => {
      const { adapter } = stubAdapter(async () =>
        stubResponse({
          structuredOutput: {
            suggestions: [{ fieldPath: "attributes.title", attributeFamily: "title", suggestedValue: "Cotton Kurta", confidence: 0.9 }],
          },
        }),
      );

      const result = await createService(adapter).runFixtureAdapterContract(baseInput);

      expect(result.status).toBe("output_rejected");
      expect(result.outputValidation?.schemaValid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expectNoPersistence();
    });

    it("rejects a completed response without structured output", async () => {
      const { adapter } = stubAdapter(async () => stubResponse());

      const result = await createService(adapter).runFixtureAdapterContract(baseInput);

      expect(result.status).toBe("output_rejected");
      expect(result.outputValidation).toBeUndefined();
      expect(result.errors).toEqual(["Intelligence adapter completed without structured output."]);
    });

    it("normalizes a throwing adapter and never exposes the raw exception text", async () => {
      const rawMessage = "401 https://api.vendor.example/v1?key=sk-live-secret Authorization: Bearer abc.def req_9f8e7d";
      const { adapter } = stubAdapter(async () => {
        throw new Error(rawMessage);
      });

      const result = await createService(adapter).runFixtureAdapterContract(baseInput);

      expect(result).toMatchObject({
        status: "adapter_failed",
        payloadAllowed: true,
        providerCallAttempted: true,
        canonicalProductMutationEnabled: false,
        adapterError: { errorClass: "internal_error", errorCode: "adapter_exception", message: "Intelligence adapter failed." },
        errors: ["Intelligence adapter failed."],
      });
      const serialized = JSON.stringify(result);
      for (const leaked of ["sk-live-secret", "Bearer", "api.vendor.example", "req_9f8e7d", "401"]) {
        expect(serialized).not.toContain(leaked);
      }
      expect(result.outputValidation).toBeUndefined();
      expectNoPersistence();
    });

    it("keeps only the class and a safe code from a classified adapter error", async () => {
      const classified = stubAdapter(async () => {
        throw new IntelligenceAdapterError("rate_limited", "vendor_429");
      });
      const unsafeCode = stubAdapter(async () => {
        throw new IntelligenceAdapterError("timeout", "https://vendor.example/?k=secret");
      });

      const first = await createService(classified.adapter).runFixtureAdapterContract(baseInput);
      const second = await createService(unsafeCode.adapter).runFixtureAdapterContract(baseInput);

      expect(first.adapterError).toEqual({
        errorClass: "rate_limited",
        errorCode: "vendor_429",
        message: "Intelligence adapter is rate limited.",
      });
      expect(second.adapterError).toEqual({
        errorClass: "timeout",
        errorCode: "adapter_error",
        message: "Intelligence adapter timed out.",
      });
      expect(JSON.stringify(second)).not.toContain("secret");
    });

    it.each(["failed", "blocked"] as const)("does not validate structured output when finishStatus=%s", async (finishStatus) => {
      const { adapter } = stubAdapter(async (request) =>
        stubResponse({
          finishStatus,
          structuredOutput: validSuggestions(request),
          errorClass: "bogus-class" as never,
          errorCode: "https://vendor.example/?k=secret",
        }),
      );
      const validateSpy = jest.spyOn(IntelligenceService.prototype, "validateStructuredOutputForSuggestions");

      const result = await createService(adapter).runFixtureAdapterContract(baseInput);

      expect(result.status).toBe(finishStatus === "failed" ? "adapter_failed" : "adapter_blocked");
      expect(result.outputValidation).toBeUndefined();
      expect(validateSpy).not.toHaveBeenCalled();
      expect(result.adapterResponse?.structuredOutput).toBeUndefined();
      expect(result.adapterError).toMatchObject({
        errorClass: "internal_error",
        errorCode: finishStatus === "failed" ? "adapter_failed" : "adapter_blocked",
      });
      expect(JSON.stringify(result)).not.toContain("secret");
      expectNoPersistence();
      validateSpy.mockRestore();
    });

    it("fails closed on an unknown finishStatus", async () => {
      const { adapter } = stubAdapter(async (request) =>
        stubResponse({ finishStatus: "partial" as never, structuredOutput: validSuggestions(request) }),
      );

      const result = await createService(adapter).runFixtureAdapterContract(baseInput);

      expect(result).toMatchObject({
        status: "adapter_status_invalid",
        adapterError: { errorClass: "internal_error", errorCode: "adapter_status_invalid" },
      });
      expect(result.outputValidation).toBeUndefined();
      expect(result.adapterResponse).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain("partial");
      expectNoPersistence();
    });

    it("never invokes the adapter for blocked input", async () => {
      const { adapter, generateStructuredOutput } = stubAdapter(async () => stubResponse());

      const result = await createService(adapter).runFixtureAdapterContract({
        ...baseInput,
        payload: { product: { title: "Cotton Kurta" }, connector: { apiKey: "blocked" } },
      });

      expect(result.status).toBe("payload_blocked");
      expect(generateStructuredOutput).not.toHaveBeenCalled();
    });
  });
});
