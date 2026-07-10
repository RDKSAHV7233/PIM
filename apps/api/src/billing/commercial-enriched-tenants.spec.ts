import { PlanUsageService } from "./plan-usage.service";

const WORKSPACE_ROWS = [
  { tenantKey: "acme", workspaceSlug: "acme-co", displayName: "Acme Corp", isActive: true, createdAt: new Date("2026-06-01") },
  { tenantKey: "beta", workspaceSlug: "beta-co", displayName: "Beta Inc", isActive: true, createdAt: new Date("2026-06-15") },
];

const PROFILE_TRIAL = { tenantKey: "acme", planTier: "TRIAL", billingStatus: "trial", accessStatus: "active", trialEndsAt: new Date("2026-07-15"), paidThroughAt: null, graceEndsAt: null, cancelledAt: null, suspendedAt: null, suspensionReason: null, billingContactEmail: null };
const PROFILE_GROWTH = { tenantKey: "beta", planTier: "GROWTH", billingStatus: "active_paid", accessStatus: "active", trialEndsAt: null, paidThroughAt: null, graceEndsAt: null, cancelledAt: null, suspendedAt: null, suspensionReason: null, billingContactEmail: null };

const USAGE_ACME = { tenantKey: "acme", skuCount: 42, submissionCount: 5, storageGb: 0.5, connectorInstallationsCount: 1 };
const USAGE_BETA = { tenantKey: "beta", skuCount: 1200, submissionCount: 80, storageGb: 12.3, connectorInstallationsCount: 3 };

const CONNECTOR_ROWS = [
  { tenantKey: "acme", slug: "shopify", displayName: "Shopify", accountCount: 1 },
  { tenantKey: "beta", slug: "amazon", displayName: "Amazon", accountCount: 2 },
  { tenantKey: "beta", slug: "shopify", displayName: "Shopify", accountCount: 1 },
];

const ADMIN_ROWS = [
  { tenantKey: "acme", userId: "admin@acme.com" },
  { tenantKey: "beta", userId: "admin@beta.com" },
];

const USER_COUNT_ROWS = [
  { tenantKey: "acme", _count: 2 },
  { tenantKey: "beta", _count: 8 },
];

function makeMockDb() {
  return {
    tenantPlanProfile: { findMany: jest.fn() },
    workspaceDirectory: { findMany: jest.fn() },
    planUsage: { findMany: jest.fn() },
    authIdentity: { findMany: jest.fn(), groupBy: jest.fn() },
    publicSignupRequest: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
}

function makeService(mockDb: ReturnType<typeof makeMockDb>) {
  const prisma = { tenant: jest.fn() };
  const prismaDirect = { getClient: jest.fn().mockReturnValue(mockDb) };
  const cache = { getOrSet: jest.fn() };
  return new PlanUsageService(prisma as never, prismaDirect as never, cache as never);
}

describe("PlanUsageService.listEnrichedTenants", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let service: PlanUsageService;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = makeService(mockDb);
    jest.spyOn(service as never, "seedPlanLimits").mockResolvedValue(undefined as never);
  });

  it("returns all tenants with usage and connectors when no filters", async () => {
    mockDb.workspaceDirectory.findMany.mockResolvedValue(WORKSPACE_ROWS);
    mockDb.tenantPlanProfile.findMany.mockResolvedValue([PROFILE_TRIAL, PROFILE_GROWTH]);
    mockDb.planUsage.findMany.mockResolvedValue([USAGE_ACME, USAGE_BETA]);
    mockDb.$queryRaw.mockResolvedValue(CONNECTOR_ROWS);
    mockDb.authIdentity.findMany.mockResolvedValue(ADMIN_ROWS);
    mockDb.authIdentity.groupBy.mockResolvedValue(USER_COUNT_ROWS);

    const results = await service.listEnrichedTenants();

    expect(results).toHaveLength(2);
    const acme = results.find((r) => r.tenantKey === "acme")!;
    const beta = results.find((r) => r.tenantKey === "beta")!;
    expect(acme.usage?.skuCount).toBe(42);
    expect(acme.connectors).toHaveLength(1);
    expect(beta.usage?.skuCount).toBe(1200);
    expect(beta.connectors).toHaveLength(2);
  });

  it("filters by billingStatus at database level", async () => {
    mockDb.tenantPlanProfile.findMany
      .mockResolvedValueOnce([PROFILE_TRIAL])
      .mockResolvedValueOnce([PROFILE_TRIAL]);
    mockDb.workspaceDirectory.findMany.mockResolvedValue([WORKSPACE_ROWS[0]]);
    mockDb.planUsage.findMany.mockResolvedValue([USAGE_ACME]);
    mockDb.$queryRaw.mockResolvedValue([CONNECTOR_ROWS[0]]);
    mockDb.authIdentity.findMany.mockResolvedValue([ADMIN_ROWS[0]]);
    mockDb.authIdentity.groupBy.mockResolvedValue([USER_COUNT_ROWS[0]]);

    const results = await service.listEnrichedTenants({ billingStatus: "trial" });

    expect(results).toHaveLength(1);
    expect(results[0].billingStatus).toBe("trial");
    expect(mockDb.tenantPlanProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { billingStatus: "trial" } }),
    );
  });

  it("filters by planTier at database level", async () => {
    mockDb.tenantPlanProfile.findMany
      .mockResolvedValueOnce([PROFILE_GROWTH])
      .mockResolvedValueOnce([PROFILE_GROWTH]);
    mockDb.workspaceDirectory.findMany.mockResolvedValue([WORKSPACE_ROWS[1]]);
    mockDb.planUsage.findMany.mockResolvedValue([USAGE_BETA]);
    mockDb.$queryRaw.mockResolvedValue(CONNECTOR_ROWS.slice(1));
    mockDb.authIdentity.findMany.mockResolvedValue([ADMIN_ROWS[1]]);
    mockDb.authIdentity.groupBy.mockResolvedValue([USER_COUNT_ROWS[1]]);

    const results = await service.listEnrichedTenants({ planTier: "GROWTH" });

    expect(results).toHaveLength(1);
    expect(results[0].planTier).toBe("GROWTH");
    expect(mockDb.tenantPlanProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { planTier: "GROWTH" } }),
    );
  });

  it("returns empty array when no tenants match filter", async () => {
    mockDb.tenantPlanProfile.findMany.mockResolvedValue([]);

    const results = await service.listEnrichedTenants({ billingStatus: "cancelled" });

    expect(results).toEqual([]);
    expect(mockDb.workspaceDirectory.findMany).not.toHaveBeenCalled();
  });

  it("caps limit to 100", async () => {
    mockDb.workspaceDirectory.findMany.mockResolvedValue(WORKSPACE_ROWS);
    mockDb.tenantPlanProfile.findMany.mockResolvedValue([PROFILE_TRIAL, PROFILE_GROWTH]);
    mockDb.planUsage.findMany.mockResolvedValue([USAGE_ACME, USAGE_BETA]);
    mockDb.$queryRaw.mockResolvedValue(CONNECTOR_ROWS);
    mockDb.authIdentity.findMany.mockResolvedValue(ADMIN_ROWS);
    mockDb.authIdentity.groupBy.mockResolvedValue(USER_COUNT_ROWS);

    const results = await service.listEnrichedTenants({ limit: 999 });

    expect(results.length).toBeLessThanOrEqual(100);
  });

  it("handles null usage gracefully", async () => {
    mockDb.workspaceDirectory.findMany.mockResolvedValue([WORKSPACE_ROWS[0]]);
    mockDb.tenantPlanProfile.findMany.mockResolvedValue([PROFILE_TRIAL]);
    mockDb.planUsage.findMany.mockResolvedValue([]);
    mockDb.$queryRaw.mockResolvedValue([]);
    mockDb.authIdentity.findMany.mockResolvedValue([]);
    mockDb.authIdentity.groupBy.mockResolvedValue([]);

    const results = await service.listEnrichedTenants();

    expect(results).toHaveLength(1);
    expect(results[0].usage).toBeNull();
    expect(results[0].connectors).toEqual([]);
    expect(results[0].adminEmails).toEqual([]);
  });
});

describe("PlanUsageService.listRecentSignups", () => {
  let mockDb: ReturnType<typeof makeMockDb>;
  let service: PlanUsageService;

  beforeEach(() => {
    mockDb = makeMockDb();
    service = makeService(mockDb);
    jest.spyOn(service as never, "seedPlanLimits").mockResolvedValue(undefined as never);
  });

  it("returns recent signups sorted by createdAt desc", async () => {
    const signups = [
      { id: "s1", displayName: "New Co", workspaceSlug: "new-co", adminEmail: "a@new.co", status: "verified", createdAt: new Date("2026-07-09"), verifiedAt: new Date("2026-07-09") },
      { id: "s2", displayName: "Old Co", workspaceSlug: "old-co", adminEmail: "a@old.co", status: "pending", createdAt: new Date("2026-07-08"), verifiedAt: null },
    ];
    mockDb.publicSignupRequest.findMany.mockResolvedValue(signups);

    const results = await service.listRecentSignups(10);

    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("s1");
    expect(results[0].status).toBe("verified");
    expect(results[0].verifiedAt).not.toBeNull();
    expect(results[1].status).toBe("pending");
    expect(results[1].verifiedAt).toBeNull();
    expect(mockDb.publicSignupRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    );
  });

  it("caps limit to 50", async () => {
    mockDb.publicSignupRequest.findMany.mockResolvedValue([]);

    await service.listRecentSignups(999);

    expect(mockDb.publicSignupRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 }),
    );
  });

  it("defaults to 20 when no limit given", async () => {
    mockDb.publicSignupRequest.findMany.mockResolvedValue([]);

    await service.listRecentSignups();

    expect(mockDb.publicSignupRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 }),
    );
  });
});
