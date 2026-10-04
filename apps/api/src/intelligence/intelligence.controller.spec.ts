import { IntelligenceController } from "./intelligence.controller";
import { IntelligenceService } from "./intelligence.service";

describe("IntelligenceController", () => {
  it("exposes a read-only boundary endpoint and no apply or mutate handlers", () => {
    const service = new IntelligenceService({} as never);
    const controller = new IntelligenceController(service);
    const handlerNames = Object.getOwnPropertyNames(IntelligenceController.prototype);

    expect(handlerNames).toEqual(["constructor", "getBoundary"]);
    expect(handlerNames.some((name) => /apply|mutate|update|delete|write/i.test(name))).toBe(false);

    const result = controller.getBoundary({
      pimUserId: "user-1",
      pimRole: "editor",
      pimTenant: "tenant-a",
      pimEffectiveRoles: [],
    } as never);

    expect(result).toMatchObject({
      tenantId: "tenant-a",
      providerExecutionEnabled: false,
      canonicalProductMutationEnabled: false,
    });
  });
});
