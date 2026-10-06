import { MissingConnectorTenantError, tenantDb } from "./tenant-db";

describe("tenantDb (SEC-DB-RLS-001 M1b)", () => {
  const makeStubs = () => {
    const tenantClients = new Map<string, object>();
    const prisma = {
      tenant: jest.fn().mockImplementation((key: string) => {
        if (!tenantClients.has(key)) {
          tenantClients.set(key, { which: `tenant:${key}` });
        }
        return tenantClients.get(key);
      }),
    };
    const directClient = { which: "direct" };
    const fallback = { getClient: jest.fn().mockReturnValue(directClient) };
    return { prisma, fallback, directClient };
  };

  it("returns the tenant client of the tenant it is given, never the direct client", () => {
    const { prisma, fallback } = makeStubs();
    const db = tenantDb(prisma as never, fallback as never, "tenant-b");
    expect(db).toEqual({ which: "tenant:tenant-b" });
    expect(prisma.tenant).toHaveBeenCalledWith("tenant-b");
    expect(fallback.getClient).not.toHaveBeenCalled();
  });

  it("gives two tenants two different clients", () => {
    const { prisma, fallback } = makeStubs();
    expect(tenantDb(prisma as never, fallback as never, "tenant-a")).not.toBe(tenantDb(prisma as never, fallback as never, "tenant-b"));
  });

  it("trims the tenant before using it", () => {
    const { prisma, fallback } = makeStubs();
    tenantDb(prisma as never, fallback as never, "  tenant-b  ");
    expect(prisma.tenant).toHaveBeenCalledWith("tenant-b");
  });

  it.each([["empty string", ""], ["whitespace", "   "], ["undefined", undefined], ["null", null]])(
    "refuses a blank tenant (%s) instead of quietly meaning the default tenant",
    (_label, value) => {
      const { prisma, fallback } = makeStubs();
      expect(() => tenantDb(prisma as never, fallback as never, value as never)).toThrow(MissingConnectorTenantError);
      expect(prisma.tenant).not.toHaveBeenCalled();
      expect(fallback.getClient).not.toHaveBeenCalled();
    },
  );

  it("uses the fallback only when no tenant client was injected (tests that build a connector by hand)", () => {
    const { fallback, directClient } = makeStubs();
    expect(tenantDb(undefined, fallback as never, "tenant-b")).toBe(directClient);
  });

  it("still refuses a blank tenant when there is no tenant client", () => {
    const { fallback } = makeStubs();
    expect(() => tenantDb(undefined, fallback as never, "")).toThrow(MissingConnectorTenantError);
  });
});
