// listEnrichedTenants moved to commercial-tenant-snapshots.spec.ts (SEC-DB-RLS-001 P2.1b-ii: per-tenant reads of the RLS-protected
// data). This file keeps the signup-request listing, which reads a non-RLS table through the context-free client.
import { PlanUsageService } from "./plan-usage.service";

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
