import { ForbiddenException } from "@nestjs/common";
import type { PrismaService } from "../prisma/prisma.service";
import { IntelligenceService } from "./intelligence.service";

describe("IntelligenceService", () => {
  const aiExecution = {
    upsert: jest.fn(),
    update: jest.fn(),
  };
  const prisma = {
    tenant: jest.fn().mockReturnValue({ aiExecution }),
  } as unknown as PrismaService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("exposes only the governed boundary with provider execution and canonical mutation disabled", () => {
    const service = new IntelligenceService(prisma);

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
    const service = new IntelligenceService(prisma);

    expect(() => service.getBoundaryStatus({ actorId: "user-1", actorRole: "editor" })).toThrow(ForbiddenException);
  });

  it("creates an idempotent tenant-scoped AiExecution without provider execution", async () => {
    aiExecution.upsert.mockResolvedValue({ id: "exec-1" });
    const service = new IntelligenceService(prisma);

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
    const service = new IntelligenceService(prisma);

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
    const service = new IntelligenceService(prisma);

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
});
