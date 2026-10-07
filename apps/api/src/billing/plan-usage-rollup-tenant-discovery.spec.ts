// SEC-DB-RLS-001 P2.1a: the nightly usage rollup reaches EVERY directory tenant.
//
// Before: discovery was a `prisma.tenant().$queryRaw` DISTINCT scan across six tables with no tenant argument. Under row level
// security that scan sees only the default tenant, so the job would silently roll up one tenant and report success.
// After: tenants come from the workspace directory (a non-RLS table) plus the default tenant, and the legacy scan only ADDS tenants
// that a role able to see them returns (so a superuser deployment keeps refreshing tenants that have data but no directory row).
//
// Every positive assertion is on a tenant that must really be rolled up. A run that touches only the default tenant fails these tests.
import { PlanUsageService, type UsageRollupResult } from "./plan-usage.service";

type Harness = {
  service: PlanUsageService;
  recompute: jest.Mock;
  directoryFindMany: jest.Mock;
  legacyScan: jest.Mock;
  logger: { error: jest.Mock; warn: jest.Mock; log: jest.Mock };
};

function makeHarness(options: {
  directory?: string[] | Error;
  legacy?: string[] | Error;
  failFor?: Record<string, unknown>;
}): Harness {
  const directoryFindMany = jest.fn(async () => {
    if (options.directory instanceof Error) {
      throw options.directory;
    }
    return (options.directory ?? []).map((tenantKey) => ({ tenantKey }));
  });
  const legacyScan = jest.fn(async () => {
    if (options.legacy instanceof Error) {
      throw options.legacy;
    }
    return (options.legacy ?? ["default"]).map((tenantKey) => ({ tenantKey }));
  });
  const prisma = { tenant: jest.fn(() => ({ $queryRaw: legacyScan })) };
  const prismaDirect = { getClient: jest.fn(() => ({ workspaceDirectory: { findMany: directoryFindMany } })) };
  const service = new PlanUsageService(prisma as never, prismaDirect as never, {} as never);
  const recompute = jest.fn(async (tenantKey?: string) => {
    if (tenantKey && options.failFor && tenantKey in options.failFor) {
      throw options.failFor[tenantKey];
    }
    return { tenantKey } as never;
  });
  (service as unknown as { recomputeUsage: unknown }).recomputeUsage = recompute;
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
  (service as unknown as { logger: unknown }).logger = logger;
  return { service, recompute, directoryFindMany, legacyScan, logger };
}

const keysRolledUp = (h: Harness) => h.recompute.mock.calls.map((call) => String(call[0])).sort();

describe("PlanUsageService.rollupAllTenantsUsage tenant discovery", () => {
  it("rolls up every non-default directory tenant, not only the default tenant (the silent single-tenant failure)", async () => {
    // The legacy scan, under row level security, returns only the default tenant. The directory holds two more.
    const h = makeHarness({ directory: ["tenant-b", "tenant-c"], legacy: ["default"] });
    const result = (await h.service.rollupAllTenantsUsage()) as UsageRollupResult;

    expect(keysRolledUp(h)).toEqual(["default", "tenant-b", "tenant-c"]);
    expect(result).toMatchObject({
      directoryTenantCount: 2,
      tenantsEvaluated: 3,
      tenantsSucceeded: 3,
      tenantsFailed: 0,
      discoveredOutsideDirectory: 0,
      failures: [],
    });
  });

  it("an empty directory still rolls up the default tenant and never reports zero tenants evaluated", async () => {
    const h = makeHarness({ directory: [], legacy: ["default"] });
    const result = await h.service.rollupAllTenantsUsage();
    expect(keysRolledUp(h)).toEqual(["default"]);
    expect(result.tenantsEvaluated).toBe(1);
  });

  it("still includes a tenant that only the legacy scan can see (a role that bypasses row level security) and reports it", async () => {
    const h = makeHarness({ directory: ["tenant-b"], legacy: ["default", "orphan-x", "tenant-b"] });
    const result = await h.service.rollupAllTenantsUsage();
    expect(keysRolledUp(h)).toEqual(["default", "orphan-x", "tenant-b"]);
    expect(result.discoveredOutsideDirectory).toBe(1);
    expect(result.tenantsEvaluated).toBe(3);
  });

  it("de-duplicates keys that appear in both sources and normalises blanks away", async () => {
    const h = makeHarness({ directory: ["tenant-b", " tenant-b ", ""], legacy: ["tenant-b", "default"] });
    await h.service.rollupAllTenantsUsage();
    expect(keysRolledUp(h)).toEqual(["default", "tenant-b"]);
    expect(h.recompute).toHaveBeenCalledTimes(2);
  });

  it("one tenant failing does not hide the others, and is reported with a stable code, never the message", async () => {
    const secretish = Object.assign(new Error("connection string postgres://user:SECRET@host/db failed"), { code: "P2024" });
    const h = makeHarness({ directory: ["tenant-b", "tenant-c"], legacy: ["default"], failFor: { "tenant-b": secretish } });
    const result = await h.service.rollupAllTenantsUsage();

    expect(keysRolledUp(h)).toEqual(["default", "tenant-b", "tenant-c"]);
    expect(result.tenantsSucceeded).toBe(2);
    expect(result.tenantsFailed).toBe(1);
    expect(result.failures).toEqual([{ tenantKey: "tenant-b", errorCode: "P2024" }]);
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(h.logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain("SECRET");
  });

  it("a directory read failure rejects the run instead of quietly rolling up only the default tenant", async () => {
    const h = makeHarness({ directory: new Error("directory unreadable"), legacy: ["default"] });
    await expect(h.service.rollupAllTenantsUsage()).rejects.toThrow("directory unreadable");
    expect(h.recompute).not.toHaveBeenCalled();
  });

  it("states that orphan detection by a runtime role is unverified, never 'zero orphans'", async () => {
    const h = makeHarness({ directory: ["tenant-b"], legacy: ["default"] });
    const result = await h.service.rollupAllTenantsUsage();
    expect(result.orphanDetection).toBe("UNVERIFIED_BY_RUNTIME_ROLE");
  });

  it("a legacy scan failure does not stop directory tenants from being rolled up", async () => {
    const h = makeHarness({ directory: ["tenant-b"], legacy: new Error("scan failed") });
    const result = await h.service.rollupAllTenantsUsage();
    expect(keysRolledUp(h)).toEqual(["default", "tenant-b"]);
    expect(result.tenantsFailed).toBe(0);
    expect(h.logger.warn).toHaveBeenCalled();
  });

  it("reads the directory through the context-free client (the directory carries no tenant key and no row level security)", async () => {
    const h = makeHarness({ directory: ["tenant-b"] });
    await h.service.rollupAllTenantsUsage();
    expect(h.directoryFindMany).toHaveBeenCalledTimes(1);
  });
});
