import { ServiceUnavailableException } from "@nestjs/common";
import { AppController } from "./app.controller";

describe("AppController - readiness", () => {
  function buildController(getPoolStats: () => Promise<unknown>) {
    const prismaService = { getPoolStats } as any;
    const queueService = {} as any;
    const authExportStorageService = {} as any;
    const observability = {} as any;
    return new AppController(prismaService, queueService, authExportStorageService, observability);
  }

  it("returns 200 status:ready when the database is reachable", async () => {
    const controller = buildController(() => Promise.resolve({ active: 1, idle: 2, waiting: 0, applicationName: "vexa-pim-api" }));

    const result = await controller.readiness();

    expect(result).toEqual({ status: "ready" });
  });

  it("throws a 503 ServiceUnavailableException with a generic body when the database is unreachable", async () => {
    const controller = buildController(() => Promise.reject(new Error("connection refused to db.internal:5432 user=vexa")));

    await expect(controller.readiness()).rejects.toThrow(ServiceUnavailableException);

    try {
      await controller.readiness();
      throw new Error("expected readiness() to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      const response = (error as ServiceUnavailableException).getResponse();
      expect(response).toEqual({ status: "not_ready" });
      // The underlying DB error message must never leak into the HTTP response body.
      expect(JSON.stringify(response)).not.toContain("db.internal");
      expect(JSON.stringify(response)).not.toContain("vexa");
    }
  });
});
