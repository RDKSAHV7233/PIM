// Unit tests for api_keys and outbound_webhooks plan-limit enforcement,
// expired billing status hard-block, and PLAN_LIMITS seed value correctness.
// All database calls are stubbed so these run in-process with no DB dependency.

import { PlanUsageService } from "./plan-usage.service";
import { PLAN_LIMITS } from "./plan-limits.seed";

const USAGE_STUB = {
  tenantKey: "acme",
  month: "2026-06",
  planTier: "GROWTH",
  skuCount: 0,
  submissionCount: 0,
  storageGb: 0,
  connectorInstallationsCount: 0,
  connectorAccountsCount: 0,
  updatedAt: new Date(),
};

const BASE_LIMITS = {
  planTier: "GROWTH",
  maxSkus: 10000,
  maxSubmissionsPerMonth: 10000,
  maxUsers: 20,
  maxStorageGb: 100,
  maxConnectorInstallations: 10,
  maxAccountsPerConnector: 10,
  maxApiKeys: 3,
  maxOutboundWebhooks: 3,
  maxImportRowsPerJob: 10000,
};

function makeService(options: {
  planTier: string;
  apiKeyCount: number;
  webhookCount: number;
  maxApiKeys: number;
  maxOutboundWebhooks: number;
  billingStatus?: string;
}) {
  const apiAccessKey = { count: jest.fn().mockResolvedValue(options.apiKeyCount) };
  const outboundWebhookEndpoint = { count: jest.fn().mockResolvedValue(options.webhookCount) };
  const tenantClient = { apiAccessKey, outboundWebhookEndpoint };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
  const cache = { getOrSet: jest.fn() };

  const service = new PlanUsageService(prisma as never, {} as never, cache as never);

  jest.spyOn(service as never, "getOrCreateTenantPlanProfile").mockResolvedValue({
    tenantKey: "acme",
    planTier: options.planTier,
    billingStatus: options.billingStatus ?? "active_paid",
    accessStatus: "active",
    effectiveFrom: null,
    trialEndsAt: null,
    paidThroughAt: null,
    billingContactEmail: null,
    updatedBy: null,
  } as never);

  jest.spyOn(service as never, "recomputeUsage").mockResolvedValue({
    ...USAGE_STUB,
    planTier: options.planTier,
  } as never);

  jest.spyOn(service as never, "getPlanLimits").mockResolvedValue({
    ...BASE_LIMITS,
    planTier: options.planTier,
    maxApiKeys: options.maxApiKeys,
    maxOutboundWebhooks: options.maxOutboundWebhooks,
  } as never);

  return { service, prisma, apiAccessKey, outboundWebhookEndpoint };
}

// ---------------------------------------------------------------------------
// api_keys enforcement
// ---------------------------------------------------------------------------

describe("PlanUsageService.checkLimit — api_keys", () => {
  it("TRIAL (maxApiKeys=0): creation attempt returns allowed=false, limit=0", async () => {
    const { service } = makeService({
      planTier: "TRIAL", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 0, maxOutboundWebhooks: 0,
    });
    const result = await service.checkLimit("api_keys", 1, "acme");
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
    expect(result.resource).toBe("api_keys");
  });

  it("STARTER (maxApiKeys=0): creation attempt returns allowed=false", async () => {
    const { service } = makeService({
      planTier: "STARTER", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 0, maxOutboundWebhooks: 0,
    });
    const result = await service.checkLimit("api_keys", 1, "acme");
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
  });

  it("GROWTH (maxApiKeys=3, existing=2): creation allowed — current would be 3", async () => {
    const { service } = makeService({
      planTier: "GROWTH", apiKeyCount: 2, webhookCount: 0, maxApiKeys: 3, maxOutboundWebhooks: 3,
    });
    const result = await service.checkLimit("api_keys", 1, "acme");
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(3);
    expect(result.limit).toBe(3);
  });

  it("GROWTH (maxApiKeys=3, existing=3): creation blocked — would exceed limit", async () => {
    const { service } = makeService({
      planTier: "GROWTH", apiKeyCount: 3, webhookCount: 0, maxApiKeys: 3, maxOutboundWebhooks: 3,
    });
    const result = await service.checkLimit("api_keys", 1, "acme");
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(4);
    expect(result.limit).toBe(3);
  });

  it("revoked keys are excluded: count query uses revokedAt=null filter", async () => {
    const { service, apiAccessKey } = makeService({
      planTier: "GROWTH", apiKeyCount: 1, webhookCount: 0, maxApiKeys: 3, maxOutboundWebhooks: 3,
    });
    await service.checkLimit("api_keys", 1, "acme");
    expect(apiAccessKey.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { revokedAt: null } }),
    );
  });

  it("tenant isolation: count query targets the supplied tenant key", async () => {
    const { service, prisma } = makeService({
      planTier: "GROWTH", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 3, maxOutboundWebhooks: 3,
    });
    await service.checkLimit("api_keys", 1, "my-tenant");
    expect(prisma.tenant).toHaveBeenCalledWith(
      expect.stringContaining("my-tenant"),
    );
  });
});

// ---------------------------------------------------------------------------
// outbound_webhooks enforcement
// ---------------------------------------------------------------------------

describe("PlanUsageService.checkLimit — outbound_webhooks", () => {
  it("TRIAL (maxOutboundWebhooks=0): creation attempt returns allowed=false", async () => {
    const { service } = makeService({
      planTier: "TRIAL", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 0, maxOutboundWebhooks: 0,
    });
    const result = await service.checkLimit("outbound_webhooks", 1, "acme");
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
    expect(result.resource).toBe("outbound_webhooks");
  });

  it("STARTER (maxOutboundWebhooks=0): creation attempt returns allowed=false", async () => {
    const { service } = makeService({
      planTier: "STARTER", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 0, maxOutboundWebhooks: 0,
    });
    const result = await service.checkLimit("outbound_webhooks", 1, "acme");
    expect(result.allowed).toBe(false);
  });

  it("GROWTH (maxOutboundWebhooks=3, existing=2): creation allowed", async () => {
    const { service } = makeService({
      planTier: "GROWTH", apiKeyCount: 0, webhookCount: 2, maxApiKeys: 3, maxOutboundWebhooks: 3,
    });
    const result = await service.checkLimit("outbound_webhooks", 1, "acme");
    expect(result.allowed).toBe(true);
    expect(result.current).toBe(3);
  });

  it("GROWTH (maxOutboundWebhooks=3, existing=3): creation blocked", async () => {
    const { service } = makeService({
      planTier: "GROWTH", apiKeyCount: 0, webhookCount: 3, maxApiKeys: 3, maxOutboundWebhooks: 3,
    });
    const result = await service.checkLimit("outbound_webhooks", 1, "acme");
    expect(result.allowed).toBe(false);
    expect(result.current).toBe(4);
  });

  it("inactive webhooks are excluded: count query uses isActive=true filter", async () => {
    const { service, outboundWebhookEndpoint } = makeService({
      planTier: "GROWTH", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 3, maxOutboundWebhooks: 3,
    });
    await service.checkLimit("outbound_webhooks", 1, "acme");
    expect(outboundWebhookEndpoint.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it("tenant isolation: count query targets the supplied tenant key", async () => {
    const { service, prisma } = makeService({
      planTier: "GROWTH", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 3, maxOutboundWebhooks: 3,
    });
    await service.checkLimit("outbound_webhooks", 1, "another-tenant");
    expect(prisma.tenant).toHaveBeenCalledWith(
      expect.stringContaining("another-tenant"),
    );
  });
});

// ---------------------------------------------------------------------------
// Expired billing status — hard-block for all resources
// ---------------------------------------------------------------------------

describe("PlanUsageService.checkLimit — expired billingStatus", () => {
  it("blocks api_keys creation: returns allowed=false, limit=0, current=1", async () => {
    const { service } = makeService({
      planTier: "TRIAL", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 0, maxOutboundWebhooks: 0,
      billingStatus: "expired",
    });
    const result = await service.checkLimit("api_keys", 1, "acme");
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
    expect(result.current).toBe(1);
    expect(result.resource).toBe("api_keys");
  });

  it("blocks skus creation when billing is expired — regardless of sku headroom", async () => {
    const { service } = makeService({
      planTier: "GROWTH", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 3, maxOutboundWebhooks: 3,
      billingStatus: "expired",
    });
    const result = await service.checkLimit("skus", 1, "acme");
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
  });

  it("blocks outbound_webhooks creation when billing is expired", async () => {
    const { service } = makeService({
      planTier: "GROWTH", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 3, maxOutboundWebhooks: 3,
      billingStatus: "expired",
    });
    const result = await service.checkLimit("outbound_webhooks", 1, "acme");
    expect(result.allowed).toBe(false);
    expect(result.limit).toBe(0);
  });

  it("does NOT call recomputeUsage for expired tenants — early exit before DB usage read", async () => {
    const { service } = makeService({
      planTier: "TRIAL", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 0, maxOutboundWebhooks: 0,
      billingStatus: "expired",
    });
    const recomputeSpy = jest.spyOn(service as never, "recomputeUsage");
    await service.checkLimit("skus", 1, "acme");
    expect(recomputeSpy).not.toHaveBeenCalled();
  });

  it("active_paid GROWTH tenant is NOT blocked — control case", async () => {
    const { service } = makeService({
      planTier: "GROWTH", apiKeyCount: 0, webhookCount: 0, maxApiKeys: 3, maxOutboundWebhooks: 3,
      billingStatus: "active_paid",
    });
    const result = await service.checkLimit("api_keys", 1, "acme");
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PLAN_LIMITS seed — tier values (migration smoke substitute for unit layer)
// ---------------------------------------------------------------------------

describe("PLAN_LIMITS seed — correct values for all four tiers", () => {
  function tierLimits(planTier: string) {
    const row = PLAN_LIMITS.find((r) => r.planTier === planTier);
    if (!row) throw new Error(`No seed row for tier: ${planTier}`);
    return row;
  }

  it("TRIAL: 100 SKUs, 2 users, 0 API keys, 0 webhooks, 500 import rows", () => {
    const t = tierLimits("TRIAL");
    expect(t.maxSkus).toBe(100);
    expect(t.maxUsers).toBe(2);
    expect(t.maxApiKeys).toBe(0);
    expect(t.maxOutboundWebhooks).toBe(0);
    expect(t.maxImportRowsPerJob).toBe(500);
  });

  it("STARTER: 500 SKUs, 3 users, 0 API keys, 0 webhooks, 2000 import rows", () => {
    const t = tierLimits("STARTER");
    expect(t.maxSkus).toBe(500);
    expect(t.maxUsers).toBe(3);
    expect(t.maxApiKeys).toBe(0);
    expect(t.maxOutboundWebhooks).toBe(0);
    expect(t.maxImportRowsPerJob).toBe(2000);
  });

  it("GROWTH: 10000 SKUs, 20 users, 3 API keys, 3 webhooks, 10000 import rows", () => {
    const t = tierLimits("GROWTH");
    expect(t.maxSkus).toBe(10000);
    expect(t.maxUsers).toBe(20);
    expect(t.maxApiKeys).toBe(3);
    expect(t.maxOutboundWebhooks).toBe(3);
    expect(t.maxImportRowsPerJob).toBe(10000);
  });

  it("ENTERPRISE: 100000 SKUs, 50 API keys, 50 webhooks, 30000 import rows", () => {
    const t = tierLimits("ENTERPRISE");
    expect(t.maxSkus).toBe(100000);
    expect(t.maxApiKeys).toBe(50);
    expect(t.maxOutboundWebhooks).toBe(50);
    expect(t.maxImportRowsPerJob).toBe(30000);
  });

  it("all four tiers are present — no tier is missing from seed", () => {
    const tiers = PLAN_LIMITS.map((r) => r.planTier).sort();
    expect(tiers).toEqual(["ENTERPRISE", "GROWTH", "STARTER", "TRIAL"]);
  });
});
