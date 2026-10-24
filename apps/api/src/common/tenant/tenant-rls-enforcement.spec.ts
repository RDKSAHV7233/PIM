import { makeFakeRlsDb, type FakeCredentialRow } from "./fake-rls-db-spec";
import { discoverAcrossTenants, forEachTenant } from "./tenant-iteration";

/**
 * SEC-DB-RLS-001 P0-B: Negative cross-tenant enforcement tests.
 *
 * These verify the RLS enforcement model using the fake-rls-db, which mirrors
 * the behavior of a NOBYPASSRLS runtime role:
 *   - Base client sees only the default tenant
 *   - Transaction client sees only the tenant set via set_config
 *   - Cross-tenant reads return empty
 *   - Cross-tenant writes are impossible through the tenant-iteration API
 */
describe("RLS enforcement: negative cross-tenant tests", () => {
  const TENANTS = ["alpha", "beta", "gamma"];
  const ROWS: FakeCredentialRow[] = [
    { id: "default-1", tenantKey: "default", encryptedValue: "enc-d1", keyVersion: "v1" },
    { id: "alpha-1", tenantKey: "alpha", encryptedValue: "enc-a1", keyVersion: "v1" },
    { id: "alpha-2", tenantKey: "alpha", encryptedValue: "enc-a2", keyVersion: "v1" },
    { id: "beta-1", tenantKey: "beta", encryptedValue: "enc-b1", keyVersion: "v1" },
    { id: "gamma-1", tenantKey: "gamma", encryptedValue: "enc-g1", keyVersion: "v1" },
  ];

  describe("base client (no tenant context)", () => {
    it("sees only the default tenant — never cross-tenant rows", async () => {
      const db = makeFakeRlsDb(ROWS, TENANTS);
      const results = await db.base.connectorCredential.findMany({});
      expect(results).toHaveLength(1);
      expect(results[0].tenantKey).toBe("default");
      expect(results.every((r: FakeCredentialRow) => r.tenantKey === "default")).toBe(true);
    });

    it("returns zero rows when default tenant has no data", async () => {
      const nonDefaultRows = ROWS.filter((r) => r.tenantKey !== "default");
      const db = makeFakeRlsDb(nonDefaultRows, TENANTS);
      const results = await db.base.connectorCredential.findMany({});
      expect(results).toHaveLength(0);
    });
  });

  describe("transaction client (tenant context set)", () => {
    it("sees only its own tenant's rows", async () => {
      const db = makeFakeRlsDb(ROWS, TENANTS);
      await db.base.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_key', ${"alpha"}, true)`;
        const results = await tx.connectorCredential.findMany({});
        expect(results).toHaveLength(2);
        expect(results.every((r: FakeCredentialRow) => r.tenantKey === "alpha")).toBe(true);
      });
    });

    it("cannot read another tenant's rows", async () => {
      const db = makeFakeRlsDb(ROWS, TENANTS);
      await db.base.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_key', ${"alpha"}, true)`;
        const betaAttempt = await tx.connectorCredential.findMany({ where: { tenantKey: "beta" } });
        expect(betaAttempt).toHaveLength(0);
      });
    });

    it("cannot update another tenant's rows", async () => {
      const db = makeFakeRlsDb(ROWS, TENANTS);
      await db.base.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_key', ${"alpha"}, true)`;
        const result = await tx.connectorCredential.updateMany({
          where: { tenantKey: "beta" },
          data: { encryptedValue: "HACKED" },
        });
        expect(result.count).toBe(0);
      });
      expect(db.rows.find((r) => r.id === "beta-1")!.encryptedValue).toBe("enc-b1");
    });

    it("cannot read a specific cross-tenant row by id", async () => {
      const db = makeFakeRlsDb(ROWS, TENANTS);
      await db.base.$transaction(async (tx: any) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_key', ${"alpha"}, true)`;
        await expect(
          tx.connectorCredential.update({ where: { id: "beta-1" }, data: { encryptedValue: "HACKED" } }),
        ).rejects.toThrow("Record to update not found");
      });
    });
  });

  describe("discoverAcrossTenants: cross-tenant leak detection", () => {
    it("drops rows whose tenantKey does not match the iteration tenant", async () => {
      const db = makeFakeRlsDb(ROWS, TENANTS);
      const result = await discoverAcrossTenants(
        db.base,
        async (_tx, tenantKey) => {
          return ROWS.filter((r) => r.tenantKey === tenantKey).map((r) => ({ ...r }));
        },
        { tenantKeys: TENANTS },
      );
      for (const row of result.rows) {
        const expected = ROWS.filter((r) => r.tenantKey === row.tenantKey);
        expect(expected.length).toBeGreaterThan(0);
      }
      expect(result.summary.failedTotal).toBe(0);
    });

    it("counts mismatched rows as item failures", async () => {
      const db = makeFakeRlsDb(ROWS, TENANTS);
      const result = await discoverAcrossTenants(
        db.base,
        async (_tx, _tenantKey) => {
          return ROWS.map((r) => ({ ...r }));
        },
        { tenantKeys: ["alpha"] },
      );
      const alphaOnly = result.rows.filter((r) => r.tenantKey === "alpha");
      expect(alphaOnly).toHaveLength(1);
      expect(result.summary.failedTotal).toBeGreaterThan(0);
    });
  });

  describe("forEachTenant: isolation between tenants", () => {
    it("one tenant's failure does not affect another tenant's committed work", async () => {
      const db = makeFakeRlsDb(ROWS, TENANTS);
      db.failCommitFor.add("beta");

      const summary = await forEachTenant(
        db.base,
        async (tx, tenantKey) => {
          await tx.connectorCredential.updateMany({
            data: { keyVersion: "v2" },
          });
          const count = await tx.connectorCredential.count({});
          return { examinedCount: count, changedCount: count };
        },
        { tenantKeys: TENANTS, concurrency: 1 },
      );

      expect(summary.overall).toBe("PARTIAL_FAILURE");
      expect(summary.tenantsFailed).toBe(1);
      expect(summary.tenantsSucceeded).toBe(2);

      const alphaRow = db.rows.find((r) => r.id === "alpha-1")!;
      expect(alphaRow.keyVersion).toBe("v2");

      const betaRow = db.rows.find((r) => r.id === "beta-1")!;
      expect(betaRow.keyVersion).toBe("v1");
    });

    it("reports orphanDetection as UNVERIFIED when using restricted role model", async () => {
      const db = makeFakeRlsDb(ROWS, TENANTS);
      const summary = await forEachTenant(
        db.base,
        async (_tx) => ({ examinedCount: 0, changedCount: 0 }),
        { tenantKeys: TENANTS },
      );
      expect(summary.orphanDetection).toBe("UNVERIFIED_BY_RUNTIME_ROLE");
    });
  });
});
