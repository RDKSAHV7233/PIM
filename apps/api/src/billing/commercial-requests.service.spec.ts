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
  const tenantCommercialRequestUpdate = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({
      id: "req_existing",
      tenantKey: "acme",
      requestType: "upgrade",
      requestedBy: "user_1",
      requesterRole: "admin",
      currentPlanTier: "STARTER",
      requestedPlanTier: "GROWTH",
      currentBillingStatus: "trial",
      currentAccessStatus: "active",
      usageSnapshot: null,
      notes: null,
      source: "admin_plan",
      createdAt: new Date(0),
      updatedAt: new Date(0),
      resolvedAt: null,
      resolvedBy: null,
      ...data,
    }),
  );
  const executeRawMock = jest.fn().mockResolvedValue(undefined);
  // createOrReuseOverageFlag/createOrReuseUpgradeRequest wrap their
  // check-then-create in db.$transaction(async (tx) => ...) with a
  // pg_advisory_xact_lock() taken via tx.$executeRaw first — the tx object
  // exposes the same model methods as tenantClient itself, so the mock
  // transaction just invokes the callback with tenantClient as `tx`.
  const tenantClient = {
    tenantCommercialRequest: {
      findFirst: tenantCommercialRequestFindFirst,
      create: tenantCommercialRequestCreate,
      update: tenantCommercialRequestUpdate,
    },
    workspaceDirectory: {
      findUnique: jest.fn().mockResolvedValue({ workspaceSlug: "acme", displayName: "Acme" }),
    },
    $executeRaw: executeRawMock,
    $transaction: jest.fn().mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback(tenantClient)),
  };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
  // SEC-DB-RLS-001: the operator reads (find by id, listing, overview) go through the direct client one tenant at a time, inside a
  // transaction in that tenant's context. The directory lists the tenants to visit (here "acme"; the default tenant is always added).
  // A row is only visible to the iteration of its own tenant, as under row level security.
  const directClientFindFirst = jest.fn().mockResolvedValue(null);
  const directTx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    tenantCommercialRequest: {
      findFirst: jest.fn(async (args: { where: { tenantKey?: string } }) => {
        const row = (await directClientFindFirst(args)) as { tenantKey?: string } | null;
        return row && row.tenantKey === args.where.tenantKey ? row : null;
      }),
    },
  };
  const directClient = {
    workspaceDirectory: { findMany: jest.fn().mockResolvedValue([{ tenantKey: "acme" }]) },
    $transaction: jest.fn((fn: (tx: typeof directTx) => Promise<unknown>) => fn(directTx)),
  };
  const prismaDirect = { getClient: jest.fn().mockReturnValue(directClient) };
  const setTenantPlanTierForTenant = jest.fn().mockResolvedValue(undefined);
  // Defaults to STARTER so it matches pendingUpgradeRequest()'s default
  // currentPlanTier snapshot below -- i.e. "nothing has changed the tier
  // since the request was filed" is true by default, letting the auto-apply
  // guard proceed in tests that don't care about the clobber-guard itself.
  const getTenantPlanProfile = jest.fn().mockResolvedValue({ planTier: "STARTER", effectiveFrom: new Date(0).toISOString() });
  const planUsageService = { setTenantPlanTierForTenant, getTenantPlanProfile };

  const service = new CommercialRequestsService(prisma as never, prismaDirect as never, planUsageService as never);
  return {
    service,
    tenantCommercialRequestFindFirst,
    tenantCommercialRequestCreate,
    tenantCommercialRequestUpdate,
    executeRawMock,
    directClientFindFirst,
    setTenantPlanTierForTenant,
    getTenantPlanProfile,
  };
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

  // PIM: concurrency guard — see the method's own doc comment. Two concurrent
  // SSO logins for the same tenant could otherwise both pass the "no existing
  // open flag" check before either INSERT commits, creating duplicate rows.
  it("acquires a per-tenant-and-requestType advisory lock before checking for an existing flag", async () => {
    const { service, executeRawMock, tenantCommercialRequestFindFirst } = makeService(null);

    await service.createOrReuseOverageFlag("acme", {
      resource: "users",
      current: 1000,
      limit: 999,
      currentPlanTier: "ENTERPRISE",
      currentBillingStatus: "active_paid",
      currentAccessStatus: "active",
      source: "sso_auto_provisioning",
    });

    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const lockSql = String(executeRawMock.mock.calls[0][0]?.sql ?? "");
    expect(lockSql).toMatch(/pg_advisory_xact_lock/);
    // The check-then-create sequence runs inside the lock, not before it —
    // otherwise the lock provides no protection against the race at all.
    expect(executeRawMock.mock.invocationCallOrder[0]).toBeLessThan(
      tenantCommercialRequestFindFirst.mock.invocationCallOrder[0],
    );
  });

  it("locks with a key scoped to both tenant and requestType, so different tenants/resources never contend", async () => {
    const { service, executeRawMock } = makeService(null);

    await service.createOrReuseOverageFlag("acme", {
      resource: "users",
      current: 1000,
      limit: 999,
      currentPlanTier: "ENTERPRISE",
      currentBillingStatus: "active_paid",
      currentAccessStatus: "active",
      source: "sso_auto_provisioning",
    });

    const lockKeyArg = executeRawMock.mock.calls[0][0]?.values?.[0];
    expect(String(lockKeyArg)).toBe("commercial-request:acme:users_limit_overage");
  });
});

describe("CommercialRequestsService.createOrReuseUpgradeRequest", () => {
  it("creates a new open upgrade request when none exists", async () => {
    const { service, tenantCommercialRequestCreate } = makeService(null);

    const result = await service.createOrReuseUpgradeRequest("acme", {
      requestedBy: "user_1",
      requesterRole: "admin",
      currentPlanTier: "STARTER",
      requestedPlanTier: "GROWTH",
      currentBillingStatus: "trial",
      currentAccessStatus: "active",
      source: "admin_plan",
    });

    expect(result.created).toBe(true);
    expect(tenantCommercialRequestCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ requestType: "upgrade", status: "open" }) }),
    );
  });

  it("is idempotent — reuses an existing open upgrade request instead of creating a duplicate", async () => {
    const { service, tenantCommercialRequestCreate } = makeService({
      id: "req_existing",
      tenantKey: "acme",
      requestType: "upgrade",
      status: "open",
      requestedBy: "user_1",
      requesterRole: "admin",
      currentPlanTier: "STARTER",
      requestedPlanTier: "GROWTH",
      currentBillingStatus: "trial",
      currentAccessStatus: "active",
      usageSnapshot: null,
      notes: null,
      source: "admin_plan",
      resolvedAt: null,
      resolvedBy: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const result = await service.createOrReuseUpgradeRequest("acme", {
      requestedBy: "user_2",
      requesterRole: "admin",
      currentPlanTier: "STARTER",
      requestedPlanTier: "GROWTH",
      currentBillingStatus: "trial",
      currentAccessStatus: "active",
      source: "admin_plan",
    });

    expect(result.created).toBe(false);
    expect(result.item.id).toBe("req_existing");
    expect(tenantCommercialRequestCreate).not.toHaveBeenCalled();
  });

  // PIM: concurrency guard — an admin double-clicking "Request upgrade", or two
  // near-simultaneous requests, could otherwise both pass the "no existing open
  // request" check before either INSERT commits, creating duplicate open
  // upgrade requests for the same tenant.
  it("acquires a per-tenant advisory lock before checking for an existing request", async () => {
    const { service, executeRawMock, tenantCommercialRequestFindFirst } = makeService(null);

    await service.createOrReuseUpgradeRequest("acme", {
      requestedBy: "user_1",
      requesterRole: "admin",
      currentPlanTier: "STARTER",
      requestedPlanTier: "GROWTH",
      currentBillingStatus: "trial",
      currentAccessStatus: "active",
      source: "admin_plan",
    });

    expect(executeRawMock).toHaveBeenCalledTimes(1);
    expect(String(executeRawMock.mock.calls[0][0]?.sql ?? "")).toMatch(/pg_advisory_xact_lock/);
    expect(executeRawMock.mock.invocationCallOrder[0]).toBeLessThan(
      tenantCommercialRequestFindFirst.mock.invocationCallOrder[0],
    );
  });
});

// PIM: bug fix — "Resolve" on /admin/commercial's pending-upgrade-requests table
// only ever updated the TenantCommercialRequest row's own status; it never
// applied the tenant's requested plan tier anywhere. Ops would click Resolve,
// the request would vanish from the pending list (and from the tenant's own
// "pending" banner via getOpenUpgradeRequestForTenant), but the tenant stayed
// on their old plan tier indefinitely — silently, with no error and no
// indication anything was left undone.
describe("CommercialRequestsService.updateUpgradeRequestStatusInternal", () => {
  function pendingUpgradeRequest(overrides: Record<string, unknown> = {}) {
    return {
      id: "req_existing",
      tenantKey: "acme",
      requestType: "upgrade",
      status: "open",
      requestedBy: "user_1",
      requesterRole: "admin",
      currentPlanTier: "STARTER",
      requestedPlanTier: "GROWTH",
      currentBillingStatus: "trial",
      currentAccessStatus: "active",
      usageSnapshot: null,
      notes: null,
      source: "admin_plan",
      resolvedAt: null,
      resolvedBy: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...overrides,
    };
  }

  it("applies the tenant's requested plan tier when resolving an upgrade request", async () => {
    const { service, directClientFindFirst, setTenantPlanTierForTenant, tenantCommercialRequestUpdate } =
      makeService();
    directClientFindFirst.mockResolvedValue(pendingUpgradeRequest());

    const result = await service.updateUpgradeRequestStatusInternal("req_existing", "resolved", "ops_1");

    expect(setTenantPlanTierForTenant).toHaveBeenCalledWith("acme", "GROWTH", "ops_1");
    expect(result.appliedPlanTier).toBe("GROWTH");
    expect(tenantCommercialRequestUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "req_existing" }, data: expect.objectContaining({ status: "resolved" }) }),
    );
    // Tier applied before the request is marked resolved — see the ordering
    // rationale in the service: a failure here must leave the request open.
    expect(setTenantPlanTierForTenant.mock.invocationCallOrder[0]).toBeLessThan(
      tenantCommercialRequestUpdate.mock.invocationCallOrder[0],
    );
  });

  // The tenant's tier can legitimately be "TRIAL" (a non-tier sentinel value,
  // not one of the 4 real plan tiers) when this is their first-ever upgrade —
  // confirm that common case isn't broken by the clobber-guard below, which
  // must compare currentPlanTier as a plain string, not run it through the
  // 4-tier-only requestedPlanTier validator (which would reject "TRIAL" to
  // null and make the guard never fire for the most common upgrade path).
  it("applies the tier for a trial tenant's first upgrade (currentPlanTier snapshot is 'TRIAL', not a real tier)", async () => {
    const { service, directClientFindFirst, getTenantPlanProfile, setTenantPlanTierForTenant } = makeService();
    directClientFindFirst.mockResolvedValue(pendingUpgradeRequest({ currentPlanTier: "TRIAL" }));
    getTenantPlanProfile.mockResolvedValue({ planTier: "TRIAL", effectiveFrom: new Date(0).toISOString() });

    const result = await service.updateUpgradeRequestStatusInternal("req_existing", "resolved", "ops_1");

    expect(setTenantPlanTierForTenant).toHaveBeenCalledWith("acme", "GROWTH", "ops_1");
    expect(result.appliedPlanTier).toBe("GROWTH");
  });

  // Guards against clobbering a tier ops already changed by hand between the
  // request being filed and resolved -- e.g. ops used the separate "Change
  // tier" control to apply a different/negotiated tier, then came back to
  // close out the original request. Resolving must not silently revert that.
  it("does not apply the requested tier if the tenant's live tier has already diverged from the request's snapshot", async () => {
    const { service, directClientFindFirst, getTenantPlanProfile, setTenantPlanTierForTenant } = makeService();
    directClientFindFirst.mockResolvedValue(pendingUpgradeRequest({ currentPlanTier: "STARTER", requestedPlanTier: "GROWTH" }));
    // Ops already manually moved the tenant to ENTERPRISE via the separate
    // "Change tier" control -- live tier no longer matches the STARTER
    // snapshot the request was filed against.
    getTenantPlanProfile.mockResolvedValue({ planTier: "ENTERPRISE", effectiveFrom: new Date(0).toISOString() });

    const result = await service.updateUpgradeRequestStatusInternal("req_existing", "resolved", "ops_1");

    expect(setTenantPlanTierForTenant).not.toHaveBeenCalled();
    expect(result.appliedPlanTier).toBeNull();
    // The request itself still resolves -- only the tier auto-apply is skipped.
    expect(result.item.status).toBe("resolved");
  });

  it("is a no-op tier-apply when the live tier already matches what was requested (idempotent re-resolve)", async () => {
    const { service, directClientFindFirst, getTenantPlanProfile, setTenantPlanTierForTenant } = makeService();
    directClientFindFirst.mockResolvedValue(pendingUpgradeRequest({ currentPlanTier: "STARTER", requestedPlanTier: "GROWTH" }));
    getTenantPlanProfile.mockResolvedValue({ planTier: "GROWTH", effectiveFrom: new Date(0).toISOString() });

    const result = await service.updateUpgradeRequestStatusInternal("req_existing", "resolved", "ops_1");

    expect(setTenantPlanTierForTenant).not.toHaveBeenCalled();
    expect(result.appliedPlanTier).toBeNull();
  });

  it("does not apply a tier when the tenant's request didn't specify one", async () => {
    const { service, directClientFindFirst, setTenantPlanTierForTenant } = makeService();
    directClientFindFirst.mockResolvedValue(pendingUpgradeRequest({ requestedPlanTier: null }));

    await service.updateUpgradeRequestStatusInternal("req_existing", "resolved", "ops_1");

    expect(setTenantPlanTierForTenant).not.toHaveBeenCalled();
  });

  it("does not apply a tier when cancelling a request, even if one was requested", async () => {
    const { service, directClientFindFirst, setTenantPlanTierForTenant } = makeService();
    directClientFindFirst.mockResolvedValue(pendingUpgradeRequest());

    await service.updateUpgradeRequestStatusInternal("req_existing", "cancelled", "ops_1");

    expect(setTenantPlanTierForTenant).not.toHaveBeenCalled();
  });

  it("does not apply a tier when only acknowledging a request", async () => {
    const { service, directClientFindFirst, setTenantPlanTierForTenant } = makeService();
    directClientFindFirst.mockResolvedValue(pendingUpgradeRequest());

    await service.updateUpgradeRequestStatusInternal("req_existing", "acknowledged", "ops_1");

    expect(setTenantPlanTierForTenant).not.toHaveBeenCalled();
  });

  it("does not mark the request resolved if applying the tier fails", async () => {
    const { service, directClientFindFirst, setTenantPlanTierForTenant, tenantCommercialRequestUpdate } =
      makeService();
    directClientFindFirst.mockResolvedValue(pendingUpgradeRequest());
    setTenantPlanTierForTenant.mockRejectedValue(new Error("db unavailable"));

    await expect(service.updateUpgradeRequestStatusInternal("req_existing", "resolved", "ops_1")).rejects.toThrow(
      "db unavailable",
    );
    expect(tenantCommercialRequestUpdate).not.toHaveBeenCalled();
  });

  it("rejects a non-upgrade request (e.g. an overage flag) rather than silently resolving it", async () => {
    const { service, directClientFindFirst, setTenantPlanTierForTenant } = makeService();
    directClientFindFirst.mockResolvedValue(
      pendingUpgradeRequest({ requestType: "users_limit_overage", requestedPlanTier: null }),
    );

    await expect(service.updateUpgradeRequestStatusInternal("req_existing", "resolved", "ops_1")).rejects.toThrow(
      "COMMERCIAL_REQUEST_NOT_AN_UPGRADE_REQUEST",
    );
    expect(setTenantPlanTierForTenant).not.toHaveBeenCalled();
  });

  it("throws when the request does not exist", async () => {
    const { service, directClientFindFirst } = makeService();
    directClientFindFirst.mockResolvedValue(null);

    await expect(service.updateUpgradeRequestStatusInternal("req_missing", "resolved", "ops_1")).rejects.toThrow(
      "COMMERCIAL_REQUEST_NOT_FOUND",
    );
  });
});

// ---- SEC-DB-RLS-001: the operator views read every tenant -------------------------------------------------------------------------------------
// The fake direct client is RLS-faithful: every query runs in a transaction whose tenant context the iteration set, and sees only that
// tenant's requests. A query with no tenant filter would see every row in a bypass role, so the fake also fails any query that has none.
describe("CommercialRequestsService — operator views across tenants (SEC-DB-RLS-001)", () => {
  type Row = {
    id: string;
    tenantKey: string;
    requestType: string;
    status: string;
    createdAt: Date;
    resolvedAt: Date | null;
  };

  const day = 24 * 60 * 60 * 1000;
  const ago = (days: number) => new Date(Date.now() - days * day);
  const row = (id: string, tenantKey: string, status: string, createdDaysAgo: number, resolvedDaysAgo: number | null = null, requestType = "upgrade"): Row => ({
    id,
    tenantKey,
    requestType,
    status,
    createdAt: ago(createdDaysAgo),
    resolvedAt: resolvedDaysAgo === null ? null : ago(resolvedDaysAgo),
  });

  function matches(r: Row, where: Record<string, any>): boolean {
    if (where.tenantKey === undefined) throw new Error("query without a tenant filter");
    if (where.tenantKey !== r.tenantKey) return false;
    if (where.requestType && where.requestType !== r.requestType) return false;
    if (where.id && where.id !== r.id) return false;
    if (where.status) {
      if (typeof where.status === "string" && where.status !== r.status) return false;
      if (where.status.in && !where.status.in.includes(r.status)) return false;
    }
    if (where.createdAt?.gte && !(r.createdAt >= where.createdAt.gte)) return false;
    if (where.createdAt?.lt && !(r.createdAt < where.createdAt.lt)) return false;
    if (where.resolvedAt?.gte && !(r.resolvedAt && r.resolvedAt >= where.resolvedAt.gte)) return false;
    if (where.OR && !where.OR.some((clause: Record<string, any>) => matches(r, { ...clause, tenantKey: where.tenantKey, requestType: where.requestType }))) return false;
    return true;
  }

  function makeViews(rows: Row[], options: { directory?: string[]; failTenant?: string } = {}) {
    const seenTenants: string[] = [];
    const makeTx = (context: { tenant: string }) => {
      const guard = (where: Record<string, any>) => {
        if (options.failTenant && where.tenantKey === options.failTenant) {
          throw Object.assign(new Error("connection postgres://u:SECRET@h/db reset"), { code: "P1001" });
        }
        if (where.tenantKey !== context.tenant) throw new Error("query for another tenant than the transaction context");
      };
      return {
        $queryRaw: async (_strings: unknown, ...values: unknown[]) => {
          context.tenant = String(values[0]);
          seenTenants.push(context.tenant);
          return [];
        },
        tenantCommercialRequest: {
          count: async (args: { where: Record<string, any> }) => {
            guard(args.where);
            return rows.filter((r) => matches(r, args.where)).length;
          },
          findMany: async (args: { where: Record<string, any>; take?: number }) => {
            guard(args.where);
            return rows
              .filter((r) => matches(r, args.where))
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
              .slice(0, args.take ?? 1000);
          },
          findFirst: async (args: { where: Record<string, any>; orderBy?: unknown }) => {
            guard(args.where);
            const found = rows.filter((r) => matches(r, args.where)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            return found[0] ?? null;
          },
        },
      };
    };
    const direct = {
      workspaceDirectory: {
        findMany: jest.fn(async (args: { where?: { tenantKey?: { in: string[] } } }) =>
          args?.where?.tenantKey
            ? args.where.tenantKey.in.map((tenantKey) => ({ tenantKey, workspaceSlug: tenantKey, displayName: tenantKey.toUpperCase() }))
            : (options.directory ?? []).map((tenantKey) => ({ tenantKey })),
        ),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx({ tenant: "" }))),
    };
    const prisma = { tenant: jest.fn() };
    const service = new CommercialRequestsService(prisma as never, { getClient: () => direct } as never, {} as never);
    return { service, direct, seenTenants };
  }

  const rows: Row[] = [
    row("r1", "default", "open", 0.1),
    row("r2", "tenant-b", "open", 3), // open for 3 days: stale (open > 1 day)
    row("r3", "tenant-b", "acknowledged", 5), // acknowledged > 3 days: stale
    row("r4", "tenant-c", "resolved", 20, 1),
    row("r5", "tenant-c", "cancelled", 30),
    row("r6", "tenant-c", "open", 1.5, null, "storage_limit_overage"), // not an upgrade request
  ];

  it("lists the requests of every tenant, newest first, under the overall limit", async () => {
    const { service } = makeViews(rows, { directory: ["tenant-b", "tenant-c"] });
    const items = await service.listUpgradeRequestsInternal({ limit: 4 });
    expect(items.map((item) => item.id)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("a tenant filter reads that tenant only", async () => {
    const { service, seenTenants } = makeViews(rows, { directory: ["tenant-b", "tenant-c"] });
    const items = await service.listUpgradeRequestsInternal({ tenantKey: "tenant-b" });
    expect(items.map((item) => item.id)).toEqual(["r2", "r3"]);
    expect(seenTenants).toEqual(["tenant-b"]);
  });

  it("the overview sums every tenant and takes the earliest active request across tenants", async () => {
    const { service } = makeViews(rows, { directory: ["tenant-b", "tenant-c"] });
    const overview = await service.getUpgradeRequestOverviewInternal();
    expect(overview).toMatchObject({
      totalRequests: 5, // the overage flag is not an upgrade request
      openRequests: 2, // r1, r2
      acknowledgedRequests: 1, // r3
      activeRequests: 3,
      resolvedRequests: 1,
      cancelledRequests: 1,
      staleOpenRequests: 1, // r2 only (r1 is hours old)
      staleAcknowledgedRequests: 1,
      attentionRequiredRequests: 2,
    });
    expect(overview.recentRequests).toBe(3); // r1, r2, r3 created within 7 days
    expect(overview.recentResolvedRequests).toBe(1); // r4 resolved a day ago
    expect(new Date(overview.oldestActiveRequestCreatedAt as string).getTime()).toBe(rows[2].createdAt.getTime()); // r3, the oldest active
  });

  it("finds a request that lives in a tenant other than the default one", async () => {
    const { service } = makeViews(rows, { directory: ["tenant-b", "tenant-c"] });
    const found = await (service as unknown as { findRequestByIdInternal(id: string): Promise<{ id: string; tenantKey: string } | null> }).findRequestByIdInternal("r4");
    expect(found).toMatchObject({ id: "r4", tenantKey: "tenant-c" });
  });

  it("reports not-found only when every tenant was read", async () => {
    const { service } = makeViews(rows, { directory: ["tenant-b", "tenant-c"] });
    await expect(service.updateUpgradeRequestStatusInternal("nope", "resolved", "ops_1")).rejects.toThrow("COMMERCIAL_REQUEST_NOT_FOUND");
  });

  it("an unreadable tenant fails the listing and the overview instead of returning figures without it (codes only, no message)", async () => {
    const { service } = makeViews(rows, { directory: ["tenant-b", "tenant-c"], failTenant: "tenant-b" });
    for (const call of [() => service.listUpgradeRequestsInternal({}), () => service.getUpgradeRequestOverviewInternal()]) {
      const error = await call().catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("COMMERCIAL_REQUESTS_TENANT_READ_FAILED");
      expect((error as Error).message).toContain("tenant-b:P1001");
      expect((error as Error).message).not.toContain("SECRET");
    }
  });

  it("a request found in a readable tenant is returned although another tenant is unreadable; an unfound one then fails rather than reading as not found", async () => {
    const { service } = makeViews(rows, { directory: ["tenant-b", "tenant-c"], failTenant: "tenant-b" });
    const find = (id: string) => (service as unknown as { findRequestByIdInternal(id: string): Promise<{ id: string } | null> }).findRequestByIdInternal(id);
    await expect(find("r4")).resolves.toMatchObject({ id: "r4" });
    await expect(find("r2")).rejects.toThrow("COMMERCIAL_REQUESTS_TENANT_READ_FAILED");
  });
});
