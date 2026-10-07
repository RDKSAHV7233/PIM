// SEC-DB-RLS-001 I-5a: raw SQL that filters by tenant by hand must also run on THAT tenant's client.
//
// These sites used `prisma.tenant()` with no argument, which resolves the tenant from the request context. The manual
// `WHERE "tenantKey" = <tenant>` filter was right only while the request tenant equalled the filter tenant, and a raw query on a
// client with no (or a different) tenant context returns nothing under row level security. Each site now passes its own tenant
// explicitly, so the connection's tenant and the filter's tenant cannot drift apart.
//
// A call with no argument is detectable: the recorded call has no first argument. Each case therefore asserts the client was
// requested WITH the tenant, never without one, and that the tenant also appears in the SQL parameters.

import { runWithTenantContext } from "./tenant-context";
import { BulkImportService } from "../../bulk-import/bulk-import.service";
import { CatalogService } from "../../catalog/catalog.service";
import { ConnectorPermissionService } from "../../connector-installer/connector-permission.service";

const TENANT = "tenant-b-i5a";

/** The values bound into a Prisma.sql template (or the positional params of a plain raw call). */
function boundValues(call: unknown[]): unknown[] {
  const first = call[0] as { values?: unknown[] } | undefined;
  return first && Array.isArray(first.values) ? first.values : call.slice(1);
}

function tenantCallArgs(prisma: { tenant: jest.Mock }) {
  return prisma.tenant.mock.calls.map((c) => c[0]);
}

/**
 * A PrismaService stand-in with two kinds of client:
 *  - tenant(TENANT): the client the raw SQL must run on;
 *  - tenant() with no argument: a context-free client whose RAW methods throw, because under row level security a raw query on a
 *    client with no tenant returns nothing. ORM calls on it still work (they carry their own tenant filter).
 * A raw statement therefore succeeds only when the site passed its tenant explicitly.
 */
function makePrisma(tenantClient: any, noArgOrmClient: any = {}) {
  const contextFree: any = {
    ...noArgOrmClient,
    $queryRaw: jest.fn(() => {
      throw new Error("raw SQL ran on a client with no explicit tenant");
    }),
    $executeRaw: jest.fn(() => {
      throw new Error("raw SQL ran on a client with no explicit tenant");
    }),
  };
  return { tenant: jest.fn((key?: string) => (key === TENANT ? tenantClient : contextFree)), contextFree };
}

describe("bulk import templates: raw SQL runs on the template's own tenant", () => {
  function makeService(options: { versionRows?: unknown[]; templateRows?: unknown[] } = {}) {
    const tenantClient: any = {
      $queryRaw: jest.fn().mockResolvedValueOnce(options.versionRows ?? []).mockResolvedValue(options.templateRows ?? []),
      $executeRaw: jest.fn().mockResolvedValue(1),
      category: { findUnique: jest.fn().mockResolvedValue({ id: "cat-1", name: "Category" }) },
      attributeDefinition: { findMany: jest.fn().mockResolvedValue([]) },
      bulkImportJob: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = makePrisma(tenantClient, {
      category: tenantClient.category,
      attributeDefinition: tenantClient.attributeDefinition,
      bulkImportJob: tenantClient.bulkImportJob,
    });
    const accessPolicy = {
      assertCategoryAccess: jest.fn().mockResolvedValue(undefined),
      applyBulkImportRowVisibility: jest.fn().mockImplementation((_a: unknown, j: unknown) => j),
    };
    const service = new BulkImportService(
      prisma as never,
      {} as never,
      {} as never,
      accessPolicy as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
    );
    return { service, prisma, tenantClient };
  }

  it("createTemplate reads the next version and inserts the template on the tenant's client, using the version it read", async () => {
    const { service, prisma, tenantClient } = makeService({ versionRows: [{ nextVersion: 3 }] });
    const dto = { name: "My template", categoryId: "cat-1", sourceFormat: "csv", mapping: { sku: "skuCode" } } as never;

    let created: unknown;
    try {
      created = await runWithTenantContext(TENANT, () => service.createTemplate(dto, undefined));
    } catch {
      // The response mapping after the two raw statements needs more of the service than this test stubs; the raw statements
      // are what is under test, so a late failure is tolerated, a missing statement is not (asserted below).
    }

    // Both raw statements reached the tenant's client (they would have thrown on the context-free one).
    expect(tenantClient.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tenantClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(prisma.contextFree.$queryRaw).not.toHaveBeenCalled();
    expect(prisma.contextFree.$executeRaw).not.toHaveBeenCalled();
    const insert = boundValues(tenantClient.$executeRaw.mock.calls[0]);
    const select = boundValues(tenantClient.$queryRaw.mock.calls[0]);
    expect(select).toContain(TENANT);
    expect(insert).toContain(TENANT);
    expect(insert).toContain(3); // the version that was READ for this tenant is the version written
    void created;
  });

  it("getTemplate looks the template up on the tenant's client and filters by the same tenant", async () => {
    const { service, prisma, tenantClient } = makeService({ templateRows: [] });

    await expect(runWithTenantContext(TENANT, () => service.getTemplate("tpl-1", undefined, undefined))).rejects.toThrow(/not found/i);

    expect(tenantClient.$queryRaw).toHaveBeenCalledTimes(1);
    expect(boundValues(tenantClient.$queryRaw.mock.calls[0])).toContain(TENANT);
    expect(tenantCallArgs(prisma)).toContain(TENANT);
    expect(prisma.contextFree.$queryRaw).not.toHaveBeenCalled();
  });

  it("an explicit tenant that differs from the request context is refused before any query", async () => {
    const { service, tenantClient } = makeService();
    await expect(runWithTenantContext(TENANT, () => service.getTemplate("tpl-1", "some-other-tenant", undefined))).rejects.toThrow(/mismatch/i);
    expect(tenantClient.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("catalog channel filter: the raw JOIN runs on the tenant's client", () => {
  it("advancedSearchProducts filters connector submissions by the tenant and runs on that tenant's client", async () => {
    const tenantClient: any = {
      connectorDefinition: { findFirst: jest.fn().mockResolvedValue({ id: "cdef-amazon" }) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const prisma = makePrisma(tenantClient, { connectorDefinition: tenantClient.connectorDefinition });
    const accessPolicy = { buildProductScopeWhere: jest.fn().mockResolvedValue({}) };
    const service = new CatalogService(prisma as never, {} as never, {} as never, {} as never, {} as never, accessPolicy as never, {} as never);

    const result: any = await runWithTenantContext(TENANT, () => service.advancedSearchProducts({ channelSlug: "amazon-in" }, undefined));

    expect(result.items).toEqual([]);
    expect(result.filters).toEqual({ channelSlug: "amazon-in" });
    expect(tenantClient.$queryRaw).toHaveBeenCalledTimes(1);
    const values = boundValues(tenantClient.$queryRaw.mock.calls[0]);
    expect(values.filter((v) => v === TENANT)).toHaveLength(2); // both joined tables are filtered by the tenant
    expect(values).toContain("cdef-amazon");
    expect(tenantCallArgs(prisma)).toContain(TENANT);
    expect(prisma.contextFree.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("connector permissions: the identity lookup runs on the tenant's client", () => {
  const originalAuthMode = process.env.AUTH_MODE;
  afterEach(() => {
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
  });

  it("userExistsForTenant (db auth mode) queries the tenant's client and filters by the same tenant", async () => {
    process.env.AUTH_MODE = "db";
    const tenantClient: any = { $queryRaw: jest.fn().mockResolvedValue([{ userId: "user-1", isActive: true }]) };
    const prisma = makePrisma(tenantClient);
    const service = new ConnectorPermissionService(prisma as never, {} as never, {} as never);

    const exists = await runWithTenantContext(TENANT, () => (service as any).userExistsForTenant("user-1"));

    expect(exists).toBe(true); // a row was actually found and used, not just "no error"
    expect(tenantClient.$queryRaw).toHaveBeenCalledTimes(1);
    expect(boundValues(tenantClient.$queryRaw.mock.calls[0])).toEqual(expect.arrayContaining([TENANT, "user-1"]));
    expect(tenantCallArgs(prisma)).toContain(TENANT);
    expect(prisma.contextFree.$queryRaw).not.toHaveBeenCalled();
  });

  it("reports an inactive user as not existing (the row's data decides, not the mere presence of a row)", async () => {
    process.env.AUTH_MODE = "db";
    const tenantClient: any = { $queryRaw: jest.fn().mockResolvedValue([{ userId: "user-1", isActive: false }]) };
    const service = new ConnectorPermissionService(makePrisma(tenantClient) as never, {} as never, {} as never);
    expect(await runWithTenantContext(TENANT, () => (service as any).userExistsForTenant("user-1"))).toBe(false);
  });
});
