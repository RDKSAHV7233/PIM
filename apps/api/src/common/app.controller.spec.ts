import { ServiceUnavailableException } from "@nestjs/common";
import { AppController } from "./app.controller";

describe("AppController - readiness", () => {
  function buildController(
    getPoolStats: () => Promise<unknown>,
    checkRedisReady: () => Promise<void> = () => Promise.resolve(),
  ) {
    const prismaService = { getPoolStats } as any;
    const queueService = { checkRedisReady } as any;
    const authExportStorageService = {} as any;
    const observability = {} as any;
    return new AppController(prismaService, queueService, authExportStorageService, observability);
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
});
