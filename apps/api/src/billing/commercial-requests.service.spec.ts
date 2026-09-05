// Focused coverage for CommercialRequestsService.createOrReuseOverageFlag — the mechanism
// TC-37's PO decision (option 2) uses to flag an over-limit tenant for commercial follow-up
// without blocking the action that caused the overage. Deliberately its own requestType
// ("<resource>_limit_overage"), not "upgrade" — see the method's own doc comment for why:
// reusing "upgrade" would make the flag visible on the tenant admin's own /admin/plan page.
import { CommercialRequestsService } from "./commercial-requests.service";

function makeService(existingOpenRequest: unknown = null) {
  const tenantCommercialRequestFindFirst = jest.fn().mockResolvedValue(existingOpenRequest);
  const tenantCommercialRequestCreate = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: "req_new",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      resolvedAt: null,
      resolvedBy: null,
      ...data,
    }),
  );
  const tenantClient = {
    tenantCommercialRequest: {
      findFirst: tenantCommercialRequestFindFirst,
      create: tenantCommercialRequestCreate,
    },
    workspaceDirectory: {
      findUnique: jest.fn().mockResolvedValue({ workspaceSlug: "acme", displayName: "Acme" }),
    },
  };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
  const prismaDirect = { getClient: jest.fn() };

  const service = new CommercialRequestsService(prisma as never, prismaDirect as never);
  return { service, tenantCommercialRequestFindFirst, tenantCommercialRequestCreate };
}

describe("CommercialRequestsService.createOrReuseOverageFlag", () => {
  it("builds requestType as '<resource>_limit_overage', not 'upgrade'", async () => {
    const { service, tenantCommercialRequestFindFirst, tenantCommercialRequestCreate } = makeService();

    await service.createOrReuseOverageFlag("acme", {
      resource: "users",
      current: 1000,
      limit: 999,
      currentPlanTier: "ENTERPRISE",
      currentBillingStatus: "active_paid",
      currentAccessStatus: "active",
      source: "sso_auto_provisioning",
    });

    expect(tenantCommercialRequestFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ requestType: "users_limit_overage" }) }),
    );
    expect(tenantCommercialRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          requestType: "users_limit_overage",
          requestedBy: "system",
          requesterRole: "system",
          status: "open",
        }),
      }),
    );
  });

  it("stores resource/current/limit in usageSnapshot", async () => {
    const { service, tenantCommercialRequestCreate } = makeService();

    await service.createOrReuseOverageFlag("acme", {
      resource: "users",
      current: 1000,
      limit: 999,
      currentPlanTier: "ENTERPRISE",
      currentBillingStatus: "active_paid",
      currentAccessStatus: "active",
      source: "sso_auto_provisioning",
    });

    expect(tenantCommercialRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          usageSnapshot: { resource: "users", current: 1000, limit: 999 },
        }),
      }),
    );
  });

  it("is idempotent — reuses an existing open flag of the same type instead of creating a duplicate", async () => {
    const { service, tenantCommercialRequestCreate } = makeService({
      id: "req_existing",
      tenantKey: "acme",
      requestType: "users_limit_overage",
      status: "open",
      requestedBy: "system",
      requesterRole: "system",
      currentPlanTier: "ENTERPRISE",
      requestedPlanTier: null,
      currentBillingStatus: "active_paid",
      currentAccessStatus: "active",
      usageSnapshot: { resource: "users", current: 1000, limit: 999 },
      notes: null,
      source: "sso_auto_provisioning",
      resolvedAt: null,
      resolvedBy: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const result = await service.createOrReuseOverageFlag("acme", {
      resource: "users",
      current: 1001,
      limit: 999,
      currentPlanTier: "ENTERPRISE",
      currentBillingStatus: "active_paid",
      currentAccessStatus: "active",
      source: "sso_auto_provisioning",
    });

    expect(result.created).toBe(false);
    expect(result.item.id).toBe("req_existing");
    expect(tenantCommercialRequestCreate).not.toHaveBeenCalled();
  });

  it("a different resource type gets its own flag, independent of an existing one for a different resource", async () => {
    // findFirst is scoped by requestType in the where clause — an existing "users_limit_overage"
    // row must not suppress a new "storage_gb_limit_overage" flag. This test locks in that the
    // query is actually scoped, not just trusting the mock's return value.
    const { service, tenantCommercialRequestFindFirst } = makeService(null);

    await service.createOrReuseOverageFlag("acme", {
      resource: "storage_gb",
      current: 600,
      limit: 500,
      currentPlanTier: "ENTERPRISE",
      currentBillingStatus: "active_paid",
      currentAccessStatus: "active",
      source: "media_upload",
    });

    expect(tenantCommercialRequestFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ requestType: "storage_gb_limit_overage" }) }),
    );
  });
});
