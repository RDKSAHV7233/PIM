// SEC-DB-RLS-001 P2.1b-ii: the multi-tenant internal commercial views (enriched listing, search, CSV export, overview) read the
// RLS-protected plan profile, usage and connector data PER TENANT, never through the context-free client.
//
// The fake below models the properties that matter:
//   - the context-free ("direct") client has NO model for the RLS tables at all, so any read of them through it throws;
//   - a tenant transaction sees only the rows of the tenant whose context it set (as a restricted role would), unless
//     `leakAcrossTenants` models a role that bypasses row level security;
//   - every statement is checked to carry the tenant it is given.
import { Prisma } from "@prisma/client";
import { PlanUsageService } from "./plan-usage.service";

type Workspace = { tenantKey: string; workspaceSlug: string; displayName: string; isActive: boolean; createdAt: Date; updatedAt: Date };
type Profile = {
  planTier: string; billingStatus: string; accessStatus: string;
  trialEndsAt: Date | null; paidThroughAt: Date | null; graceEndsAt: Date | null; cancelledAt: Date | null; suspendedAt: Date | null;
  suspensionReason: string | null; billingContactEmail: string | null;
};
type UsageRow = { month: string; planTier: string; skuCount: number; submissionCount: number; storageGb: number; connectorInstallationsCount: number };

const profile = (planTier: string, billingStatus: string, extra: Partial<Profile> = {}): Profile => ({
  planTier, billingStatus, accessStatus: "active", trialEndsAt: null, paidThroughAt: null, graceEndsAt: null, cancelledAt: null,
  suspendedAt: null, suspensionReason: null, billingContactEmail: null, ...extra,
});

function workspace(key: string, createdDay: number, extra: Partial<Workspace> = {}): Workspace {
  return {
    tenantKey: key, workspaceSlug: `${key}-co`, displayName: `${key} Corp`, isActive: true,
    createdAt: new Date(Date.UTC(2026, 5, createdDay)), updatedAt: new Date(Date.UTC(2026, 6, createdDay)), ...extra,
  };
}

function makeFake(options: {
  workspaces: Workspace[];
  profiles?: Record<string, Profile>;
  usage?: Record<string, UsageRow[]>;
  connectors?: Record<string, Array<{ slug: string; displayName: string; accountCount: number }>>;
  admins?: Array<{ tenantKey: string; userId: string }>;
  failTenants?: string[];
  leakAcrossTenants?: boolean;
}) {
  const snapshotReads: string[] = [];
  const transactions: string[] = [];
  const directoryScans: Array<{ skip?: number; take?: number }> = [];

  const makeTx = () => {
    let context = "";
    return {
      $queryRaw: jest.fn(async (first: unknown, ...rest: unknown[]) => {
        if (Array.isArray(first)) {
          context = String(rest[0]);
          transactions.push(context);
          return [];
        }
        const sql = first as Prisma.Sql;
        const text = sql.strings.join("?");
        const tenant = String(sql.values[0]);
        // every statement must carry the tenant it is given in every tenant clause
        expect(sql.values.filter((v) => typeof v === "string" && v === tenant).length).toBeGreaterThanOrEqual(1);
        if (options.failTenants?.includes(tenant)) {
          throw Object.assign(new Error("connection postgres://user:SECRET@host/db reset"), { code: "P1001" });
        }
        const visible = options.leakAcrossTenants || tenant === context;
        if (text.includes("FROM (SELECT 1) AS one")) {
          snapshotReads.push(tenant);
          const p = visible ? options.profiles?.[tenant] : undefined;
          const latest = visible ? [...(options.usage?.[tenant] ?? [])].sort((a, b) => b.month.localeCompare(a.month))[0]?.planTier ?? null : null;
          return [{ ...(p ?? { planTier: null, billingStatus: null, accessStatus: null, trialEndsAt: null, paidThroughAt: null, graceEndsAt: null, cancelledAt: null, suspendedAt: null, suspensionReason: null, billingContactEmail: null }), latestUsagePlanTier: latest }];
        }
        if (text.includes('FROM "PlanUsage"')) {
          const month = String(sql.values[1]);
          const row = visible ? options.usage?.[tenant]?.find((u) => u.month === month) : undefined;
          return row ? [row] : [];
        }
        if (text.includes("connector_installations")) {
          return visible ? options.connectors?.[tenant] ?? [] : [];
        }
        throw new Error(`unexpected statement: ${text.slice(0, 80)}`);
      }),
    };
  };

  const tenantClients = new Map<string, ReturnType<typeof makeTenantClient>>();
  function makeTenantClient(tk: string) {
    const adminsForTenant = (options.admins ?? []).filter((a) => a.tenantKey === tk);
    return {
      authIdentity: {
        findMany: jest.fn(async () => adminsForTenant),
        count: jest.fn(async () => adminsForTenant.length),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
    };
  }
  const prisma = {
    tenant: jest.fn((tk: string) => {
      if (!tenantClients.has(tk)) tenantClients.set(tk, makeTenantClient(tk));
      return tenantClients.get(tk)!;
    }),
  };

  // The context-free client: workspaces, identities and signups only. No tenantPlanProfile, planUsage or $queryRaw.
  const direct = {
    workspaceDirectory: {
      findMany: jest.fn(async (args?: { skip?: number; take?: number }) => {
        directoryScans.push({ skip: args?.skip, take: args?.take });
        const sorted = [...options.workspaces].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.tenantKey.localeCompare(b.tenantKey));
        const skip = args?.skip ?? 0;
        return sorted.slice(skip, args?.take === undefined ? undefined : skip + args.take);
      }),
    },
    authIdentity: {
      findMany: jest.fn(async () => options.admins ?? []),
      groupBy: jest.fn(async () => [] as Array<{ tenantKey: string; _count: number }>),
    },
  };

  const service = new PlanUsageService(prisma as never, { getClient: jest.fn().mockReturnValue(direct) } as never, { getOrSet: jest.fn() } as never);
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
  (service as unknown as { logger: unknown }).logger = logger;
  return { service, direct, prisma, snapshotReads, transactions, directoryScans, logger };
}

const month = new Date().toISOString().slice(0, 7);

describe("PlanUsageService.listEnrichedTenants — per-tenant reads of RLS-protected data", () => {
  it("returns each tenant's own plan, usage and connectors although the context-free client sees none of them", async () => {
    const f = makeFake({
      workspaces: [workspace("acme", 1), workspace("beta", 15)],
      profiles: { acme: profile("TRIAL", "trial", { billingContactEmail: "billing@acme.com" }), beta: profile("GROWTH", "active_paid") },
      usage: {
        acme: [{ month, planTier: "TRIAL", skuCount: 42, submissionCount: 5, storageGb: 0.5, connectorInstallationsCount: 1 }],
        beta: [{ month, planTier: "GROWTH", skuCount: 1200, submissionCount: 80, storageGb: 12.3, connectorInstallationsCount: 3 }],
      },
      connectors: {
        acme: [{ slug: "shopify", displayName: "Shopify", accountCount: 1 }],
        beta: [{ slug: "amazon", displayName: "Amazon", accountCount: 2 }, { slug: "shopify", displayName: "Shopify", accountCount: 1 }],
      },
      admins: [{ tenantKey: "acme", userId: "Admin@Acme.com" }, { tenantKey: "beta", userId: "admin@beta.com" }],
    });

    const results = await f.service.listEnrichedTenants();

    const acme = results.find((r) => r.tenantKey === "acme")!;
    const beta = results.find((r) => r.tenantKey === "beta")!;
    expect(results.map((r) => r.tenantKey)).toEqual(["beta", "acme"]); // newest first
    expect(acme.planTier).toBe("TRIAL");
    expect(acme.billingContactEmail).toBe("billing@acme.com");
    expect(acme.usage).toMatchObject({ skuCount: 42, submissionCount: 5, storageGb: 0.5, connectorInstallationsCount: 1 });
    expect(acme.connectors).toHaveLength(1);
    expect(acme.adminEmails).toEqual(["admin@acme.com"]);
    expect(beta.planTier).toBe("GROWTH");
    expect(beta.billingStatus).toBe("active_paid");
    expect(beta.usage?.skuCount).toBe(1200);
    expect(beta.connectors).toHaveLength(2);
  });

  it("reads each returned tenant inside that tenant's own transaction", async () => {
    const f = makeFake({ workspaces: [workspace("acme", 1), workspace("beta", 15)], profiles: { acme: profile("TRIAL", "trial"), beta: profile("GROWTH", "active_paid") } });
    await f.service.listEnrichedTenants();
    expect([...f.transactions].sort()).toEqual(["acme", "beta"]);
  });

  it("handles null usage gracefully", async () => {
    const f = makeFake({ workspaces: [workspace("acme", 1)], profiles: { acme: profile("TRIAL", "trial") } });
    const results = await f.service.listEnrichedTenants();
    expect(results).toHaveLength(1);
    expect(results[0].usage).toBeNull();
    expect(results[0].connectors).toEqual([]);
    expect(results[0].adminEmails).toEqual([]);
  });

  it("caps limit to 100", async () => {
    const f = makeFake({ workspaces: Array.from({ length: 130 }, (_, i) => workspace(`t${String(i).padStart(3, "0")}`, (i % 28) + 1)) });
    const results = await f.service.listEnrichedTenants({ limit: 999 });
    expect(results.length).toBe(100);
  });

  it("filters by billingStatus on the per-tenant profile", async () => {
    const f = makeFake({
      workspaces: [workspace("acme", 1), workspace("beta", 15)],
      profiles: { acme: profile("TRIAL", "trial"), beta: profile("GROWTH", "active_paid") },
    });
    const results = await f.service.listEnrichedTenants({ billingStatus: "TRIAL" });
    expect(results.map((r) => r.tenantKey)).toEqual(["acme"]);
    expect(results[0].billingStatus).toBe("trial");
  });

  it("filters by planTier on the per-tenant profile", async () => {
    const f = makeFake({
      workspaces: [workspace("acme", 1), workspace("beta", 15)],
      profiles: { acme: profile("TRIAL", "trial"), beta: profile("GROWTH", "active_paid") },
    });
    const results = await f.service.listEnrichedTenants({ planTier: "growth" });
    expect(results.map((r) => r.tenantKey)).toEqual(["beta"]);
    expect(results[0].planTier).toBe("GROWTH");
  });

  it("a tenant without a profile never matches a filter", async () => {
    const f = makeFake({ workspaces: [workspace("acme", 1)], profiles: {} });
    expect(await f.service.listEnrichedTenants({ billingStatus: "trial" })).toEqual([]);
  });

  it("returns an empty array when no tenant matches the filter", async () => {
    const f = makeFake({ workspaces: [workspace("acme", 1)], profiles: { acme: profile("TRIAL", "trial") } });
    expect(await f.service.listEnrichedTenants({ billingStatus: "cancelled" })).toEqual([]);
  });

  it("scans the newest workspaces a page at a time and stops once the limit is met", async () => {
    // 120 workspaces, newest first by creation day then key; only every 10th one is GROWTH.
    const workspaces = Array.from({ length: 120 }, (_, i) => workspace(`t${String(i).padStart(3, "0")}`, 28 - Math.floor(i / 5)));
    const profiles: Record<string, Profile> = {};
    for (const w of workspaces) {
      profiles[w.tenantKey] = profile(Number(w.tenantKey.slice(1)) % 10 === 0 ? "GROWTH" : "TRIAL", "trial");
    }
    const f = makeFake({ workspaces, profiles });

    const results = await f.service.listEnrichedTenants({ planTier: "GROWTH", limit: 3 });

    expect(results).toHaveLength(3);
    expect(results.every((r) => r.planTier === "GROWTH")).toBe(true);
    // three matches exist within the first 21 newest tenants, so the first page of 50 is enough and no second page is read
    expect(f.directoryScans.filter((s) => s.skip !== undefined)).toEqual([{ skip: 0, take: 50 }]);
  });

  it("reads further pages when the first page does not hold enough matches", async () => {
    const workspaces = Array.from({ length: 120 }, (_, i) => workspace(`t${String(i).padStart(3, "0")}`, 28 - Math.floor(i / 5)));
    const profiles: Record<string, Profile> = {};
    for (const w of workspaces) {
      profiles[w.tenantKey] = profile(Number(w.tenantKey.slice(1)) >= 100 ? "GROWTH" : "TRIAL", "trial");
    }
    const f = makeFake({ workspaces, profiles });

    const results = await f.service.listEnrichedTenants({ planTier: "GROWTH", limit: 5 });

    expect(results).toHaveLength(5);
    expect(f.directoryScans.filter((s) => s.skip !== undefined).map((s) => s.skip)).toEqual([0, 50, 100]);
  });

  it("with a role that bypasses row level security, each tenant still gets only its own data", async () => {
    const f = makeFake({
      workspaces: [workspace("acme", 1), workspace("beta", 15)],
      profiles: { acme: profile("TRIAL", "trial"), beta: profile("GROWTH", "active_paid") },
      usage: { beta: [{ month, planTier: "GROWTH", skuCount: 9, submissionCount: 1, storageGb: 1, connectorInstallationsCount: 0 }] },
      leakAcrossTenants: true,
    });
    const results = await f.service.listEnrichedTenants();
    expect(results.find((r) => r.tenantKey === "acme")!.usage).toBeNull();
    expect(results.find((r) => r.tenantKey === "beta")!.usage?.skuCount).toBe(9);
  });

  it("one unreadable tenant fails the whole view loudly, by code and never by message, instead of showing a defaulted TRIAL plan", async () => {
    const f = makeFake({
      workspaces: [workspace("acme", 1), workspace("beta", 15)],
      profiles: { acme: profile("ENTERPRISE", "active_paid"), beta: profile("GROWTH", "active_paid") },
      failTenants: ["acme"],
    });

    await expect(f.service.listEnrichedTenants()).rejects.toThrow("COMMERCIAL_TENANT_READ_FAILED");
    expect(f.logger.error).toHaveBeenCalledTimes(1);
    const logged = JSON.stringify(f.logger.error.mock.calls);
    expect(logged).toContain("acme:P1001");
    expect(logged).not.toContain("SECRET");
  });

  it("a readable tenant that simply has no profile or usage is shown as the default TRIAL plan (distinct from a read failure)", async () => {
    const f = makeFake({ workspaces: [workspace("acme", 1)], profiles: {} });
    const results = await f.service.listEnrichedTenants();
    expect(results[0].planTier).toBe("TRIAL");
  });
});

describe("PlanUsageService commercial tenant search, export and overview — per-tenant reads", () => {
  it("search enriches only the returned page: ranking uses directory fields, not plan data", async () => {
    const workspaces = Array.from({ length: 20 }, (_, i) => workspace(`tenant-${String(i).padStart(2, "0")}`, (i % 27) + 1));
    const profiles: Record<string, Profile> = {};
    for (const w of workspaces) {
      profiles[w.tenantKey] = profile("GROWTH", "active_paid");
    }
    const f = makeFake({ workspaces, profiles });

    const results = await f.service.listCommercialTenantsInternal({ limit: 3 });

    expect(results).toHaveLength(3);
    expect(f.snapshotReads).toHaveLength(3); // 3 returned tenants read, not the 20 candidates
    expect(results.every((r) => r.planTier === "GROWTH")).toBe(true);
  });

  it("search ranks exact tenant-key matches first, then enriches that page", async () => {
    const f = makeFake({
      workspaces: [workspace("acme-labs", 20), workspace("acme", 1), workspace("other", 25)],
      profiles: { acme: profile("ENTERPRISE", "active_paid"), "acme-labs": profile("STARTER", "trial") },
    });
    const results = await f.service.listCommercialTenantsInternal({ query: "acme", limit: 2 });
    expect(results.map((r) => r.tenantKey)).toEqual(["acme", "acme-labs"]);
    expect(results[0].planTier).toBe("ENTERPRISE");
    expect(f.snapshotReads.sort()).toEqual(["acme", "acme-labs"]);
  });

  it("falls back to the latest usage tier when a tenant has no profile", async () => {
    const f = makeFake({
      workspaces: [workspace("acme", 1)],
      profiles: {},
      usage: { acme: [{ month: "2026-05", planTier: "STARTER", skuCount: 1, submissionCount: 0, storageGb: 0, connectorInstallationsCount: 0 }, { month: "2026-06", planTier: "GROWTH", skuCount: 1, submissionCount: 0, storageGb: 0, connectorInstallationsCount: 0 }] },
    });
    const results = await f.service.listCommercialTenantsInternal({ limit: 5 });
    expect(results[0].planTier).toBe("GROWTH");
  });

  it("the overview aggregates every tenant's own profile", async () => {
    const f = makeFake({
      workspaces: [workspace("a", 1), workspace("b", 2, { isActive: false }), workspace("c", 3), workspace("d", 4)],
      profiles: {
        a: profile("TRIAL", "trial"),
        b: profile("GROWTH", "active_paid"),
        c: profile("GROWTH", "past_due", { accessStatus: "suspended" }),
        d: profile("ENTERPRISE", "cancelled"),
      },
    });

    const overview = await f.service.getCommercialTenantOverview();

    expect(overview.totalTenants).toBe(4);
    expect(overview.activeWorkspaces).toBe(3);
    expect(overview.inactiveWorkspaces).toBe(1);
    expect(overview.planTierCounts).toMatchObject({ trial: 1, growth: 2, enterprise: 1 });
    expect(overview.billingStatusCounts).toMatchObject({ trial: 1, activePaid: 1, pastDue: 1, cancelled: 1 });
    expect(overview.accessStatusCounts).toMatchObject({ active: 3, suspended: 1 });
    expect([...f.transactions].sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("the overview fails loudly when a tenant cannot be read, rather than counting it as TRIAL", async () => {
    const f = makeFake({ workspaces: [workspace("a", 1), workspace("b", 2)], profiles: { a: profile("GROWTH", "active_paid"), b: profile("GROWTH", "active_paid") }, failTenants: ["b"] });
    await expect(f.service.getCommercialTenantOverview()).rejects.toThrow("COMMERCIAL_TENANT_READ_FAILED");
  });

  it("the CSV export is built from the same per-tenant rows", async () => {
    const f = makeFake({ workspaces: [workspace("acme", 1)], profiles: { acme: profile("ENTERPRISE", "active_paid") } });
    const csv = await f.service.exportCommercialTenantsCsvInternal({ limit: 5 });
    expect(csv).toContain("acme");
    expect(csv).toContain("ENTERPRISE");
  });
});
