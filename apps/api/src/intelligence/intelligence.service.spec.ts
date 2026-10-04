import { ForbiddenException } from "@nestjs/common";
import { IntelligenceService } from "./intelligence.service";

describe("IntelligenceService", () => {
  it("exposes only the governed boundary with provider execution and canonical mutation disabled", () => {
    const service = new IntelligenceService();

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
    const service = new IntelligenceService();

    expect(() => service.getBoundaryStatus({ actorId: "user-1", actorRole: "editor" })).toThrow(ForbiddenException);
  });
});
