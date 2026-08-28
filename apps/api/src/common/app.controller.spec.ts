import { ServiceUnavailableException } from "@nestjs/common";
import { AppController } from "./app.controller";

describe("AppController - readiness", () => {
  function buildController(
    getPoolStats: () => Promise<unknown>,
    checkRedisReady: () => Promise<void> = () => Promise.resolve(),
    getHealthSnapshot: () => Promise<unknown> = () => Promise.resolve({ available: false }),
  ) {
    const prismaService = { getPoolStats } as any;
    const queueService = {
      checkRedisReady,
      getMetrics: jest.fn().mockResolvedValue({ export: { waiting: 0, active: 0, failed: 0 } }),
      getBackend: jest.fn().mockReturnValue("bullmq"),
      isWorkerEnabled: jest.fn().mockReturnValue(true),
    } as any;
    const authExportStorageService = {} as any;
    const observability = {} as any;
    const cacheService = { getHealthSnapshot } as any;
    return new AppController(prismaService, queueService, authExportStorageService, observability, cacheService);
  }

  it("returns 200 status:ready when database and queue are reachable", async () => {
    const controller = buildController(
      () => Promise.resolve({ active: 1, idle: 2, waiting: 0, applicationName: "vexa-pim-api" }),
      () => Promise.resolve(),
    );

    const result = await controller.readiness();

    expect(result).toEqual({ status: "ready" });
  });

  it("throws 503 when the database is unreachable", async () => {
    const controller = buildController(
      () => Promise.reject(new Error("connection refused to db.internal:5432 user=vexa")),
    );

    await expect(controller.readiness()).rejects.toThrow(ServiceUnavailableException);

    try {
      await controller.readiness();
      throw new Error("expected readiness() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse();
      expect(response).toEqual({ status: "not_ready" });
      expect(JSON.stringify(response)).not.toContain("db.internal");
      expect(JSON.stringify(response)).not.toContain("vexa");
    }
  });

  it("throws 503 when Redis is unreachable", async () => {
    const controller = buildController(
      () => Promise.resolve({ active: 1, idle: 2, waiting: 0, applicationName: "vexa-pim-api" }),
      () => Promise.reject(new Error("ECONNREFUSED redis://redis.internal:6379")),
    );

    await expect(controller.readiness()).rejects.toThrow(ServiceUnavailableException);

    try {
      await controller.readiness();
      throw new Error("expected readiness() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse();
      expect(response).toEqual({ status: "not_ready" });
      expect(JSON.stringify(response)).not.toContain("redis.internal");
    }
  });

  it("throws 503 when both database and Redis are unreachable", async () => {
    const controller = buildController(
      () => Promise.reject(new Error("db down")),
      () => Promise.reject(new Error("redis down")),
    );

    await expect(controller.readiness()).rejects.toThrow(ServiceUnavailableException);
  });

  it("includes a sanitized Redis health snapshot on internal health", async () => {
    const controller = buildController(
      () => Promise.resolve({ active: 1, idle: 2, waiting: 0, applicationName: "vexa-pim-api" }),
      () => Promise.resolve(),
      () =>
        Promise.resolve({
          available: true,
          usedMemory: 123456,
          maxMemory: 0,
          maxMemoryPolicy: "noeviction",
          blockedClients: 2,
          connectedClients: 9,
        }),
    );

    const result = await controller.healthInternal();

    expect(result.redis).toEqual({
      available: true,
      usedMemory: 123456,
      maxMemory: 0,
      maxMemoryPolicy: "noeviction",
      blockedClients: 2,
      connectedClients: 9,
    });
    expect(JSON.stringify(result.redis)).not.toContain("redis://");
    expect(JSON.stringify(result.redis)).not.toContain("redis_version");
  });
});
