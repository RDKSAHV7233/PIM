import { IntelligenceCapabilityRegistry } from "./intelligence-capability.registry";
import { IntelligenceExecutionControlService } from "./intelligence-execution-control.service";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * Mock-level checks for the paths that must never reach the database or the network. The concurrency, lifecycle and
 * recovery guarantees are proven against a real PostgreSQL in test/integration/ai-provider-budget-lifecycle.test.cjs.
 */
class TestControl extends IntelligenceExecutionControlService {
  flag = true;
  protected deployFlagEnabled(): boolean {
    return this.flag;
  }
}

const baseInput = {
  tenantKey: "tenant-a",
  capability: "product_attribute_extraction" as const,
  providerKey: "anthropic",
  modelKey: "model-x",
  requestFingerprint: "sha256:req",
  requestedEstimatedCostMicros: 1_000,
};

describe("IntelligenceExecutionControlService (no database, no network)", () => {
  const tenantClient = { aiPlatformControl: { findUnique: jest.fn() }, $transaction: jest.fn() };
  const prisma = { tenant: jest.fn(() => tenantClient) } as unknown as PrismaService;
  let service: TestControl;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TestControl(prisma, new IntelligenceCapabilityRegistry());
    fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(() => {
      throw new Error("no network call is permitted in the control plane");
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("denies at G0 without touching the database when the deploy flag is off", async () => {
    service.flag = false;
    const result = await service.admit(baseInput);
    expect(result).toMatchObject({ decision: "DENY", allowed: false, denialReason: "platform_feature_disabled", providerCallAttempted: false });
    expect(prisma.tenant).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("denies a missing platform control row and an unreadable one, and never opens a transaction", async () => {
    tenantClient.aiPlatformControl.findUnique.mockResolvedValueOnce(null);
    expect((await service.admit(baseInput)).denialReason).toBe("platform_control_missing");

    tenantClient.aiPlatformControl.findUnique.mockRejectedValueOnce(new Error("connection refused"));
    expect((await service.admit(baseInput)).denialReason).toBe("control_unreadable");

    expect(tenantClient.$transaction).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("denies the seeded default row (disabled, kill switch on) as a kill switch", async () => {
    tenantClient.aiPlatformControl.findUnique.mockResolvedValueOnce({
      id: "global",
      enabled: false,
      killSwitch: true,
      allowedProvider: null,
      allowedModel: null,
      allowedTenantKeys: [],
      maxRequestCostMicros: 0n,
    });
    expect((await service.admit(baseInput)).denialReason).toBe("platform_kill_switch");
    expect(tenantClient.$transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed input as invalid_request before any read", async () => {
    for (const bad of [
      { ...baseInput, requestedEstimatedCostMicros: 0 },
      { ...baseInput, requestedEstimatedCostMicros: -1 },
      { ...baseInput, requestedEstimatedCostMicros: 1.5 },
      { ...baseInput, requestedEstimatedCostMicros: "1e3" },
      { ...baseInput, requestedEstimatedCostMicros: Number.MAX_SAFE_INTEGER + 2 },
      { ...baseInput, currency: "EUR" },
      { ...baseInput, attemptNumber: 0 },
      { ...baseInput, attemptNumber: 11 },
      { ...baseInput, requestFingerprint: "" },
      { ...baseInput, modelKey: "" },
      { tenantKey: "tenant-a" } as never,
    ]) {
      expect((await service.admit(bad)).denialReason).toBe("invalid_request");
    }
    expect(prisma.tenant).not.toHaveBeenCalled();
  });

  it("denies a capability outside the code-level live allow-list before reading any control", async () => {
    const result = await service.admit({ ...baseInput, capability: "product_specification_extraction" });
    expect(result.denialReason).toBe("capability_disallowed");
    expect(prisma.tenant).not.toHaveBeenCalled();
  });

  it("returns money only as decimal strings, so a result is always JSON serialisable", async () => {
    service.flag = false;
    const result = await service.admit({ ...baseInput, requestedEstimatedCostMicros: 5_000_000_000n });
    expect(typeof result.requestedEstimatedCostMicros).toBe("string");
    expect(result.requestedEstimatedCostMicros).toBe("5000000000");
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("reports no provider call and no canonical mutation on every denial", async () => {
    service.flag = false;
    const result = await service.admit(baseInput);
    expect(result.providerCallAttempted).toBe(false);
    expect(result.canonicalProductMutationEnabled).toBe(false);
  });
});
