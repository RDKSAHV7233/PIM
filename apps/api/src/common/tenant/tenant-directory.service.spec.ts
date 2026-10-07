import * as bcrypt from "bcryptjs";
import { Logger } from "@nestjs/common";
import { TenantDirectoryService } from "./tenant-directory.service";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function makeService(options: { existingMarketForTenant?: boolean; seedFails?: boolean } = {}) {
  const authIdentity = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ id: "auth_1" }),
    update: jest.fn(),
  };
  const workspaceDirectory = {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn(({ data }) => Promise.resolve(data)),
    update: jest.fn(),
  };
  // The direct (context-free) client: the pricing seed must NOT use it. Its pricing models throw if touched.
  const mustNotBeUsed = () => {
    throw new Error("the direct client must not be used for the pricing seed");
  };
  const directClient = {
    workspaceDirectory,
    authIdentity,
    market: { findFirst: jest.fn(mustNotBeUsed), create: jest.fn(mustNotBeUsed) },
    currency: { create: jest.fn(mustNotBeUsed) },
    priceList: { create: jest.fn(mustNotBeUsed) },
    $transaction: jest.fn(mustNotBeUsed),
  };
  const prismaDirect = { getClient: jest.fn().mockReturnValue(directClient) };

  // One tenant client per tenant, recording what the seed creates and for whom.
  const created: Array<{ tenant: string; model: string; data: Record<string, unknown> }> = [];
  const tenantClients = new Map<string, any>();
  const clientFor = (tenant: string) => {
    if (!tenantClients.has(tenant)) {
      const record = (model: string) =>
        jest.fn(({ data }: { data: Record<string, unknown> }) => {
          if (options.seedFails) {
            return Promise.reject(new Error("new row violates row-level security policy"));
          }
          created.push({ tenant, model, data });
          return Promise.resolve({ id: `${model}_${created.length}`, ...data });
        });
      const client: any = {
        market: {
          findFirst: jest.fn().mockResolvedValue(options.existingMarketForTenant ? { id: "market_existing" } : null),
          create: record("market"),
        },
        currency: { create: record("currency") },
        priceList: { create: record("priceList") },
      };
      client.$transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn(client));
      tenantClients.set(tenant, client);
    }
    return tenantClients.get(tenant);
  };
  const prisma = { tenant: jest.fn((tenant: string) => clientFor(tenant)) };
  const svc = new TenantDirectoryService(prisma as never, prismaDirect as never);
  return { svc, authIdentity, prisma, directClient, created, tenantClients };
}

describe("TenantDirectoryService — initial admin password source", () => {
  const originalAuthMode = process.env.AUTH_MODE;
  const originalAppEnv = process.env.APP_ENV;
  const originalSharedPassword = process.env.PIM_AUTH_PASSWORD;

  afterEach(() => {
    restoreEnv("AUTH_MODE", originalAuthMode);
    restoreEnv("APP_ENV", originalAppEnv);
    restoreEnv("PIM_AUTH_PASSWORD", originalSharedPassword);
  });

  it("provisionWorkspace never hashes the shared PIM_AUTH_PASSWORD fallback for a new tenant admin", async () => {
    process.env.AUTH_MODE = "db";
    process.env.APP_ENV = "staging";
    process.env.PIM_AUTH_PASSWORD = "shared-password-must-not-be-used";
    const { svc, authIdentity } = makeService();

    await svc.provisionWorkspace({
      tenantKey: "tenant-a",
      workspaceSlug: "tenant-a",
      displayName: "Tenant A",
      initialAdminUserId: "admin@example.test",
    });

    const createPayload = authIdentity.create.mock.calls[0]?.[0]?.data;
    expect(createPayload).toMatchObject({
      tenantKey: "tenant-a",
      userId: "admin@example.test",
      role: "admin",
      isActive: true,
      passwordHash: null,
    });
  });

  it("provisionWorkspaceWithPasswordHash stores only the explicit hash supplied by the caller", async () => {
    process.env.AUTH_MODE = "db";
    process.env.APP_ENV = "staging";
    process.env.PIM_AUTH_PASSWORD = "shared-password-must-not-be-used";
    const explicitHash = await bcrypt.hash("Explicit#Password2026", 12);
    const { svc, authIdentity } = makeService();

    await svc.provisionWorkspaceWithPasswordHash({
      tenantKey: "tenant-a",
      workspaceSlug: "tenant-a",
      displayName: "Tenant A",
      initialAdminUserId: "admin@example.test",
      initialAdminPasswordHash: explicitHash,
    });

    const createPayload = authIdentity.create.mock.calls[0]?.[0]?.data;
    expect(createPayload.passwordHash).toBe(explicitHash);
    await expect(bcrypt.compare("Explicit#Password2026", createPayload.passwordHash)).resolves.toBe(true);
    await expect(bcrypt.compare("shared-password-must-not-be-used", createPayload.passwordHash)).resolves.toBe(false);
  });
});

describe("TenantDirectoryService — default pricing seed (SEC-DB-RLS-001)", () => {
  const originalAuthMode = process.env.AUTH_MODE;
  beforeEach(() => {
    process.env.AUTH_MODE = "db";
  });
  afterEach(() => {
    restoreEnv("AUTH_MODE", originalAuthMode);
    jest.restoreAllMocks();
  });

  const provision = (svc: TenantDirectoryService, tenantKey = "tenant-b") =>
    svc.provisionWorkspace({ tenantKey, workspaceSlug: tenantKey, displayName: "Tenant B", initialAdminUserId: "admin@example.test" });

  it("seeds the market, the currency and the price list for a NON-DEFAULT tenant, through that tenant's own client", async () => {
    const { svc, prisma, created } = makeService();

    await provision(svc, "tenant-b");

    expect(prisma.tenant).toHaveBeenCalledWith("tenant-b");
    expect(created.map((c) => [c.tenant, c.model])).toEqual([["tenant-b", "market"], ["tenant-b", "currency"], ["tenant-b", "priceList"]]);
    expect(created.every((c) => c.data.tenantKey === "tenant-b")).toBe(true);
    expect(created.find((c) => c.model === "market")?.data).toMatchObject({ code: "IN", isDefault: true });
    expect(created.find((c) => c.model === "currency")?.data).toMatchObject({ code: "INR" });
    expect(created.find((c) => c.model === "priceList")?.data).toMatchObject({ isDefault: true, marketId: expect.any(String), currencyId: expect.any(String) });
  });

  it("never uses the context-free direct client for the seed (the direct client's pricing models throw if touched)", async () => {
    const { svc, directClient } = makeService();
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    await provision(svc, "tenant-b");

    expect(directClient.market.findFirst).not.toHaveBeenCalled();
    expect(directClient.$transaction).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled(); // had the seed used the direct client it would have thrown and been logged
  });

  it("keeps two tenants' seeds on two different tenant clients", async () => {
    const { svc, created } = makeService();
    await provision(svc, "tenant-a");
    await provision(svc, "tenant-b");
    expect(new Set(created.map((c) => c.tenant))).toEqual(new Set(["tenant-a", "tenant-b"]));
    expect(created.filter((c) => c.tenant === "tenant-a")).toHaveLength(3);
    expect(created.filter((c) => c.tenant === "tenant-b")).toHaveLength(3);
  });

  it("is idempotent: a tenant that already has a market is not seeded again", async () => {
    const { svc, created } = makeService({ existingMarketForTenant: true });
    await provision(svc, "tenant-b");
    expect(created).toHaveLength(0);
  });

  it("a failing seed does not block provisioning, but is logged as an ERROR with a stable code that names the tenant (never silent)", async () => {
    const { svc } = makeService({ seedFails: true });
    const errorSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    const result = await provision(svc, "tenant-b");

    expect(result.tenantId).toBe("tenant-b");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const message = String(errorSpy.mock.calls[0][0]);
    expect(message).toContain("TENANT_DEFAULT_PRICING_SEED_FAILED");
    expect(message).toContain('tenant="tenant-b"');
    expect(message).toContain("WITHOUT default pricing");
  });
});
