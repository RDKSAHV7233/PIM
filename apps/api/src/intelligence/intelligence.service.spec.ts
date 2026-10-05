import { ForbiddenException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { PrismaService } from "../prisma/prisma.service";
import { IntelligenceCapabilityRegistry } from "./intelligence-capability.registry";
import { FixtureIntelligenceAdapter } from "./intelligence-fixture.adapter";
import { IntelligenceAdapterError } from "./intelligence-adapter-boundary";
import { IntelligenceService } from "./intelligence.service";
import type { IntelligenceAdapterRequest, IntelligenceAdapterResponse, IntelligenceProviderAdapter } from "./intelligence.types";

interface SecretVectors {
  credentials: Array<{ id: string; detector: string; parts: string[] }>;
  innocent: string[];
  mentionsWithoutValue: string[];
}
const secretVectors = JSON.parse(readFileSync(resolve(__dirname, "..", "..", "..", "..", "test-fixtures", "ai-policy", "secret-detection.v1.json"), "utf8")) as SecretVectors;
// Credentials are assembled from fragments so no contiguous credential shape is committed.
const credential = (id: string) => (secretVectors.credentials.find((vector) => vector.id === id) as SecretVectors["credentials"][number]).parts.join("");

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
        generatedPayload: { value: credential("assignment-api-key") },
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
      payload: { product: { title: credential("authorization-bearer") } },
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
            generatedPayload: { value: credential("bearer-bare") },
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

  describe("payload policy path semantics (AI-POL-002)", () => {
    const wildcardPolicy = {
      ...activePolicy,
      fieldClassifications: {
        "product.title": { classification: "AI_ALLOWED" },
        "product.description": { classification: "AI_ALLOWED" },
        "product.brand": { classification: "AI_ALLOWED" },
        "product.categoryPath": { classification: "AI_ALLOWED" },
        "product.attributes.*": { classification: "AI_ALLOWED" },
        "product.attributes.cost": { classification: "AI_BLOCKED" },
        "product.supplierSpecifications.*": { classification: "AI_ALLOWED" },
        "product.notes.*": { classification: "AI_ALLOWED_WITH_REDACTION", redactionEvidenceRequired: true },
        "customer.email": { classification: "AI_BLOCKED" },
        "connector.apiKey": { classification: "AI_BLOCKED" },
      },
    };

    const classify = async (payload: unknown, redactedFields?: string[], policy: unknown = wildcardPolicy) => {
      aiTenantPolicy.findFirst.mockResolvedValue(policy);
      return createService().classifyPayloadForIntelligence({
        tenantKey: "tenant-a",
        capability: "product_attribute_extraction",
        payload: payload as never,
        redactedFields,
      });
    };

    it("allows direct children under a children wildcard (the 20 previously blocked attribute cases)", async () => {
      const result = await classify({
        product: { title: "Kurta", attributes: { color: "navy", size: "M", sleeveLength: "three-quarter" }, supplierSpecifications: { fit: "straight" } },
      });
      expect(result).toMatchObject({ allowed: true, blockedFields: [], unknownFields: [] });
    });

    it("does not let a children wildcard reach grandchildren or the parent leaf itself", async () => {
      const grandchild = await classify({ product: { attributes: { dims: { width: "10" } } } });
      expect(grandchild).toMatchObject({ allowed: false, unknownFields: ["product.attributes.dims.width"], blockedReasons: ["unknown_path"] });
      const parentScalar = await classify({ product: { attributes: "navy cotton" } });
      expect(parentScalar).toMatchObject({ allowed: false, unknownFields: ["product.attributes"] });
    });

    it("still treats an empty container as carrying no data", async () => {
      expect((await classify({ product: { title: "Kurta", attributes: {} }, customer: {} })).allowed).toBe(true);
    });

    it("deny-overrides: a specific block beats a wildcard allow", async () => {
      const result = await classify({ product: { attributes: { color: "navy", cost: "120" } } });
      expect(result).toMatchObject({ allowed: false, blockedFields: ["product.attributes.cost"], blockedReasons: ["blocked_by_policy"] });
    });

    it.each([["password"], ["secretKey"], ["clientSecret"], ["apiKey"], ["access-token"]])("blocks a wildcard-admitted key named %p", async (key) => {
      const result = await classify({ product: { attributes: { [key]: "x" } } });
      expect(result).toMatchObject({ allowed: false, blockedReasons: ["secret_like_key"] });
      expect(result.blockedFields).toEqual([`product.attributes.${key}`]);
    });

    it("blocks keys that are not plain path segments, including dotted keys that mimic a nested path", async () => {
      const dotted = await classify({ "product.title": "Kurta" });
      expect(dotted).toMatchObject({ allowed: false, blockedReasons: ["invalid_path_segment"] });
      const mimic = await classify({ product: { attributes: { "color.shade": "navy" } } });
      expect(mimic).toMatchObject({ allowed: false, blockedReasons: ["invalid_path_segment"] });
      const spaced = await classify({ product: { attributes: { "bag count": 25 } } });
      expect(spaced).toMatchObject({ allowed: false, blockedReasons: ["invalid_path_segment"] });
      const wildcardKey = await classify({ product: { attributes: { "*": "x" } } });
      expect(wildcardKey).toMatchObject({ allowed: false, blockedReasons: ["invalid_path_segment"] });
    });

    it("scans array contents with the text guard (previously a bypass)", async () => {
      const category = await classify({ product: { categoryPath: ["Apparel", "password hunter2"] } });
      expect(category).toMatchObject({ allowed: false, blockedFields: ["product.categoryPath"], blockedReasons: ["secret_like_text"] });
      const attribute = await classify({ product: { attributes: { tags: ["fine", "api key abc123"] } } });
      expect(attribute).toMatchObject({ allowed: false, blockedReasons: ["secret_like_text"] });
      expect((await classify({ product: { categoryPath: ["Apparel", "Women", "Kurtas"], attributes: { sizes: ["S", "M", 3, true, null] } } })).allowed).toBe(true);
    });

    it("blocks objects and nested arrays inside arrays (fail closed)", async () => {
      const objectElement = await classify({ product: { categoryPath: [{ token: "abc" }] } });
      expect(objectElement).toMatchObject({ allowed: false, blockedReasons: ["unsupported_array_element"] });
      const nestedArray = await classify({ product: { categoryPath: [["a"]] } });
      expect(nestedArray).toMatchObject({ allowed: false, blockedReasons: ["unsupported_array_element"] });
    });

    it("keeps the secret-text guard on wildcard-admitted string values", async () => {
      const result = await classify({ product: { attributes: { note: credential("assignment-password-equals") } } });
      expect(result).toMatchObject({ allowed: false, blockedReasons: ["secret_like_text"] });
    });

    it("keeps explicitly blocked paths blocked, even with empty values", async () => {
      const result = await classify({ product: { title: "Kurta" }, customer: { email: "" }, connector: { apiKey: "" } });
      expect(result).toMatchObject({ allowed: false, blockedReasons: ["blocked_by_policy"] });
      expect(result.blockedFields).toEqual(["customer.email", "connector.apiKey"]);
    });

    it("blocks a payload whose root is not an object", async () => {
      for (const payload of ["api key abc123", ["password"], 5]) {
        expect(await classify(payload)).toMatchObject({ allowed: false, blockedFields: ["$"], blockedReasons: ["unsupported_payload_shape"] });
      }
    });

    it("applies redaction evidence to each leaf a wildcard rule admits", async () => {
      const payload = { product: { notes: { pickup: "weekday", contact: "removed" } } };
      expect(await classify(payload)).toMatchObject({ allowed: false, blockedReasons: ["redaction_required"] });
      expect(await classify(payload, ["product.notes.pickup"])).toMatchObject({ allowed: false, blockedFields: ["product.notes.contact"] });
      expect((await classify(payload, ["product.notes.pickup", "product.notes.contact"])).allowed).toBe(true);
    });

    it("reports reason codes only, never paths or values, in blockedReasons", async () => {
      const result = await classify({ product: { attributes: { password: "hunter2-value" } } });
      expect(JSON.stringify(result.blockedReasons)).not.toMatch(/hunter2|password|product/);
    });

    it("still blocks unknown leaves when the default classification would allow them", async () => {
      const result = await classify({ product: { unlisted: "x" } }, undefined, { ...wildcardPolicy, defaultClassification: "AI_ALLOWED" });
      expect(result).toMatchObject({ allowed: false, unknownFields: ["product.unlisted"] });
    });

    it("drops a stored rule that no longer satisfies the grammar, so its leaves fail closed", async () => {
      const policy = { ...wildcardPolicy, fieldClassifications: { "product.title": { classification: "AI_ALLOWED" }, "product.attri*butes": { classification: "AI_ALLOWED" }, "product..x": { classification: "AI_ALLOWED" } } };
      expect(await classify({ product: { title: "Kurta" } }, undefined, policy)).toMatchObject({ allowed: true });
      expect(await classify({ product: { attributes: "x" } }, undefined, policy)).toMatchObject({ allowed: false, unknownFields: ["product.attributes"] });
    });

    it("rejects an invalid rule path when a tenant policy is saved, and accepts wildcard rules", async () => {
      aiTenantPolicy.upsert.mockResolvedValue({ id: "policy-1" });
      const save = (fieldClassifications: Record<string, { classification: "AI_ALLOWED" | "AI_BLOCKED" }>) =>
        createService().upsertTenantPolicy({
          tenantKey: "tenant-a",
          capability: "product_attribute_extraction",
          providerKey: "default",
          policyVersion: "ai-pol-v2",
          redactionPolicyVersion: "redaction-v1",
          classificationPolicyHash: "sha256:policy",
          fieldClassifications,
          createdByActorId: "security-1",
        } as never);

      for (const bad of ["a.*.b", "a b", "a..b", "*", "a.b*", "a.***"]) {
        await expect(save({ [bad]: { classification: "AI_ALLOWED" } })).rejects.toThrow(/is invalid/);
      }
      expect(aiTenantPolicy.upsert).not.toHaveBeenCalled();
      await expect(save({ "product.attributes.*": { classification: "AI_ALLOWED" }, "product.attributes.**": { classification: "AI_BLOCKED" } })).resolves.toBeDefined();
      expect(aiTenantPolicy.upsert).toHaveBeenCalledTimes(1);
    });

    it("lets a payload with wildcard-admitted attributes through the adapter contract end to end", async () => {
      aiTenantPolicy.findFirst.mockResolvedValue(wildcardPolicy);
      const result = await createService().runFixtureAdapterContract({
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
        payload: { product: { title: "Cotton Kurta", attributes: { color: "navy", material: "cotton" } } },
      });
      expect(result).toMatchObject({ status: "succeeded", payloadAllowed: true, canonicalProductMutationEnabled: false });
      expect(aiSuggestion.upsert).not.toHaveBeenCalled();
    });
  });

  describe("secret detection modes (AI-POL-003)", () => {
    const wildcardPolicy = {
      ...activePolicy,
      fieldClassifications: {
        "product.title": { classification: "AI_ALLOWED" },
        "product.categoryPath": { classification: "AI_ALLOWED" },
        "product.attributes.*": { classification: "AI_ALLOWED" },
      },
    };
    const classify = async (payload: unknown) => {
      aiTenantPolicy.findFirst.mockResolvedValue(wildcardPolicy);
      return createService().classifyPayloadForIntelligence({ tenantKey: "tenant-a", capability: "product_attribute_extraction", payload: payload as never });
    };
    const validateOutput = (suggestion: Record<string, unknown>) =>
      createService().validateStructuredOutputForSuggestions({
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
        providerOutput: { suggestions: [{ fieldPath: "attributes.material", attributeFamily: "material", suggestedValue: "Cotton", generatedPayload: { value: "Cotton" }, evidence, ...suggestion }] },
      });

    it.each(secretVectors.innocent)("lets innocent product text through classification: %p", async (text) => {
      const result = await classify({ product: { title: text, categoryPath: [text], attributes: { note: text } } });
      expect(result).toMatchObject({ allowed: true, blockedFields: [] });
    });

    it.each(secretVectors.credentials.map((vector) => [vector.id, vector.parts.join("")] as const))("blocks credential %s in a title, an array element and an attribute value", async (_id, secret) => {
      for (const payload of [{ product: { title: secret } }, { product: { categoryPath: ["Apparel", secret] } }, { product: { attributes: { note: secret } } }]) {
        const result = await classify(payload);
        expect(result).toMatchObject({ allowed: false, blockedReasons: ["secret_like_text"] });
      }
    });

    it("passes text that only mentions a credential word, which is the false-positive class this change removes", async () => {
      for (const text of secretVectors.mentionsWithoutValue) {
        expect((await classify({ product: { title: text } })).allowed).toBe(true);
      }
    });

    it("accepts innocent text as model output values, evidence citations and persisted suggestions", async () => {
      for (const text of ["Secret Garden Colouring Book", "Password Keeper Notebook A5 Maroon", "Credential Badge Holder Lanyard"]) {
        const result = await validateOutput({ suggestedValue: text, generatedPayload: { value: text }, evidence: [{ ...evidence[0], citation: text }] });
        expect(result).toMatchObject({ schemaValid: true, errors: [] });
      }
      aiSuggestion.upsert.mockResolvedValue({ id: "suggestion-1" });
      await expect(
        createService().createSuggestion({
          tenantKey: "tenant-a",
          executionId: "exec-1",
          capability: "product_attribute_extraction",
          entityType: "product",
          entityId: "prod-1",
          fieldPath: "attributes.title",
          sourceRecordId: "source-1",
          sourceVersion: 3,
          sourceHash: "sha256:source",
          promptVersion: "prompt-v1",
          schemaVersion: "schema-v1",
          generatedPayload: { value: "Secret Garden Colouring Book" },
          suggestedValue: "Secret Garden Colouring Book",
          evidence,
        }),
      ).resolves.toBeDefined();
    });

    it.each(secretVectors.credentials.slice(0, 12).map((vector) => [vector.id, vector.parts.join("")] as const))("rejects credential %s as an output value, an evidence citation and a generated payload", async (_id, secret) => {
      for (const suggestion of [
        { suggestedValue: secret },
        { generatedPayload: { value: secret } },
        { evidence: [{ ...evidence[0], citation: secret }] },
      ]) {
        const result = await validateOutput(suggestion);
        expect(result.schemaValid).toBe(false);
        expect(result.errors.join("\n")).toContain("forbidden sensitive telemetry");
      }
    });

    it("rejects a credential in a reviewer-edited value", async () => {
      aiSuggestion.findUnique.mockResolvedValue(storedSuggestion);
      aiSuggestion.update.mockResolvedValue({ id: "suggestion-1", status: "edited" });
      const service = createService();
      await expect(
        service.reviewSuggestion("suggestion-1", "tenant-a", {
          decision: "edit",
          reviewedValue: credential("assignment-password-equals"),
          reviewedBy: "reviewer-1",
          currentSourceVersion: 3,
          currentSourceHash: "sha256:source",
        }),
      ).rejects.toThrow("forbidden sensitive telemetry");
      // The same edit with innocent text is accepted.
      await service.reviewSuggestion("suggestion-1", "tenant-a", {
        decision: "edit",
        reviewedValue: "Secret Garden Colouring Book",
        reviewedBy: "reviewer-1",
        reviewReason: "Corrected the title from the supplier sheet.",
        currentSourceVersion: 3,
        currentSourceHash: "sha256:source",
      });
      expect(aiSuggestion.update).toHaveBeenCalledTimes(1);
    });

    it("keeps JSON key names strict in output: a secret-named key is rejected even with an innocent value", async () => {
      for (const key of ["secretKey", "api_key", "accessToken", "password"]) {
        const result = await validateOutput({ generatedPayload: { [key]: "Cotton" } });
        expect(result.schemaValid).toBe(false);
      }
      expect((await validateOutput({ generatedPayload: { colorName: "Cotton" } })).schemaValid).toBe(true);
    });

    it("keeps operational fields strict: a secret-ish word is rejected even without a credential shape", async () => {
      for (const providerKey of ["secret-garden", "password-keeper", "api_key_should_not_be_here"]) {
        await expect(
          createService().createExecution({
            tenantKey: "tenant-a",
            capability: "product_attribute_extraction",
            entityType: "product",
            entityId: "prod-1",
            sourceVersion: 1,
            sourceHash: "sha256:source",
            requestFingerprint: "sha256:request",
            promptVersion: "prompt-v1",
            schemaVersion: "schema-v1",
            providerKey,
          }),
        ).rejects.toThrow("forbidden sensitive telemetry");
      }
    });

    it("keeps the evaluation JSON strict", async () => {
      const suggestion = {
        tenantKey: "tenant-a",
        executionId: "exec-1",
        capability: "product_attribute_extraction" as const,
        entityType: "product" as const,
        entityId: "prod-1",
        fieldPath: "attributes.title",
        sourceRecordId: "source-1",
        sourceVersion: 3,
        sourceHash: "sha256:source",
        promptVersion: "prompt-v1",
        schemaVersion: "schema-v1",
        generatedPayload: { value: "Cotton" },
        suggestedValue: "Cotton",
        evidence,
      };
      aiSuggestion.upsert.mockResolvedValue({ id: "suggestion-1" });
      await expect(createService().createSuggestion({ ...suggestion, evaluation: { note: "Secret Garden" } })).rejects.toThrow("forbidden sensitive telemetry");
      await expect(createService().createSuggestion({ ...suggestion, evaluation: { score: 1 } })).resolves.toBeDefined();
    });
  });
});
