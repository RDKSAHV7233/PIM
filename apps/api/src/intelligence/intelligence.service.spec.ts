import { ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type { PrismaService } from "../prisma/prisma.service";
import { IntelligenceCapabilityRegistry } from "./intelligence-capability.registry";
import { IntelligenceService } from "./intelligence.service";

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

  const createService = () => new IntelligenceService(prisma, new IntelligenceCapabilityRegistry());

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
});
