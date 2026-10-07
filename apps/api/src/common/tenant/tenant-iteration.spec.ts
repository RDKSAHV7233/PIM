import { makeFakeRlsDb } from "./fake-rls-db-spec";
import {
  TENANT_ITERATION_DEFAULT_CONCURRENCY,
  TENANT_ITERATION_MAX_CONCURRENCY,
  forEachTenant,
  listTenantKeys,
  resolveTenantIterationConcurrency,
  summarizeTenantRuns,
} from "./tenant-iteration";

const row = (id: string, tenantKey: string, keyVersion = "v1") => ({ id, tenantKey, encryptedValue: `cipher-${id}`, keyVersion });

describe("listTenantKeys", () => {
  it("returns every directory tenant plus the default tenant, de-duplicated and sorted", async () => {
    const db = makeFakeRlsDb([], ["tenant-b", "tenant-a", "tenant-a", "  ", "default"]);
    const listed = await listTenantKeys(db.base);
    expect(listed.tenantKeys).toEqual(["default", "tenant-a", "tenant-b"]);
    expect(listed.directoryTenantCount).toBe(5);
  });

  it("includes the default tenant even when the directory is empty", async () => {
    const db = makeFakeRlsDb([], []);
    expect((await listTenantKeys(db.base)).tenantKeys).toEqual(["default"]);
  });
});

describe("resolveTenantIterationConcurrency", () => {
  it("defaults to 4", () => {
    expect(TENANT_ITERATION_DEFAULT_CONCURRENCY).toBe(4);
    expect(resolveTenantIterationConcurrency(undefined, {})).toBe(4);
  });
  it("is configurable by argument and environment", () => {
    expect(resolveTenantIterationConcurrency(2, {})).toBe(2);
    expect(resolveTenantIterationConcurrency(undefined, { TENANT_ITERATION_CONCURRENCY: "3" })).toBe(3);
  });
  it.each([["0", 0], ["negative", -3], ["NaN", Number.NaN], ["Infinity", Number.POSITIVE_INFINITY]])("refuses %s and uses the default or the cap", (_label, value) => {
    const resolved = resolveTenantIterationConcurrency(value as number, {});
    expect(resolved).toBeGreaterThanOrEqual(1);
    expect(resolved).toBeLessThanOrEqual(TENANT_ITERATION_MAX_CONCURRENCY);
  });
  it("is never unbounded: a huge request is clamped to the maximum", () => {
    expect(resolveTenantIterationConcurrency(10_000, {})).toBe(TENANT_ITERATION_MAX_CONCURRENCY);
  });
});

describe("forEachTenant: tenant context", () => {
  it("runs each tenant's work inside that tenant's own transaction and only sees that tenant's rows", async () => {
    const db = makeFakeRlsDb([row("a1", "tenant-a"), row("a2", "tenant-a"), row("b1", "tenant-b"), row("d1", "default")], ["tenant-a", "tenant-b"]);
    const seen: Record<string, string[]> = {};
    const summary = await forEachTenant(db.base, async (tx, tenantKey) => {
      const rows = await tx.connectorCredential.findMany({ where: {}, orderBy: [{ id: "asc" }] });
      seen[tenantKey] = rows.map((r: { id: string }) => r.id);
      return { examinedCount: rows.length, changedCount: 0 };
    });

    expect(seen).toEqual({ default: ["d1"], "tenant-a": ["a1", "a2"], "tenant-b": ["b1"] });
    expect(summary.examinedTotal).toBe(4);
    expect(summary.overall).toBe("SUCCESS");
    expect(summary.results.map((r) => [r.tenantKey, r.examinedCount])).toEqual([["default", 1], ["tenant-a", 2], ["tenant-b", 1]]);
  });

  it("a query on the base client (no tenant context) sees only the default tenant: this is the silent failure the helper prevents", async () => {
    const db = makeFakeRlsDb([row("a1", "tenant-a"), row("d1", "default")], ["tenant-a"]);
    const viaBase = await db.base.connectorCredential.findMany({ where: {} });
    expect(viaBase.map((r: { id: string }) => r.id)).toEqual(["d1"]);
  });

  it("sets the tenant before any work, in the same transaction", async () => {
    const db = makeFakeRlsDb([], ["tenant-a"]);
    const order: string[] = [];
    await forEachTenant(db.base, async (tx, tenantKey) => {
      order.push(`work:${tenantKey}`);
      await tx.connectorCredential.count({ where: {} });
      return { examinedCount: 0, changedCount: 0 };
    });
    expect(db.transactionTenants.sort()).toEqual(["default", "tenant-a"]);
    expect(order.sort()).toEqual(["work:default", "work:tenant-a"]);
  });

  it("never reads through the base client while iterating", async () => {
    const db = makeFakeRlsDb([row("a1", "tenant-a")], ["tenant-a"]);
    await forEachTenant(db.base, async (tx) => {
      const rows = await tx.connectorCredential.findMany({ where: {} });
      return { examinedCount: rows.length, changedCount: 0 };
    });
    expect(db.baseCredentialReads).toBe(0);
  });
});

describe("forEachTenant: results, failure isolation and the overall status", () => {
  it("reports an explicit result per tenant with durations", async () => {
    const db = makeFakeRlsDb([row("a1", "tenant-a")], ["tenant-a"]);
    const summary = await forEachTenant(db.base, async (tx) => {
      const rows = await tx.connectorCredential.findMany({ where: {} });
      return { examinedCount: rows.length, changedCount: rows.length };
    });
    for (const r of summary.results) {
      expect(Object.keys(r).sort()).toEqual(["changedCount", "durationMs", "examinedCount", "failedCount", "status", "tenantKey"]);
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("one tenant failing does not roll back another tenant's committed work, and the overall status is PARTIAL_FAILURE", async () => {
    const db = makeFakeRlsDb([row("a1", "tenant-a"), row("b1", "tenant-b"), row("d1", "default")], ["tenant-a", "tenant-b"]);
    db.failCommitFor.add("tenant-b");
    const summary = await forEachTenant(db.base, async (tx) => {
      const n = await tx.connectorCredential.updateMany({ where: {}, data: { keyVersion: "v2" } });
      return { examinedCount: n.count, changedCount: n.count };
    });

    expect(summary.overall).toBe("PARTIAL_FAILURE");
    expect(summary.tenantsEvaluated).toBe(3);
    expect(summary.tenantsSucceeded).toBe(2);
    expect(summary.tenantsFailed).toBe(1);
    expect(db.rows.find((r) => r.id === "a1")?.keyVersion).toBe("v2");
    expect(db.rows.find((r) => r.id === "d1")?.keyVersion).toBe("v2");
    expect(db.rows.find((r) => r.id === "b1")?.keyVersion).toBe("v1"); // rolled back, only for tenant-b
    const failed = summary.results.find((r) => r.tenantKey === "tenant-b");
    expect(failed).toMatchObject({ status: "failed", errorCode: "P2034", changedCount: 0 });
  });

  it("is FAILED, not PARTIAL_FAILURE, when every tenant fails", async () => {
    const db = makeFakeRlsDb([], ["tenant-a"]);
    const summary = await forEachTenant(db.base, async () => {
      throw new Error("boom with secret-value-123");
    });
    expect(summary.overall).toBe("FAILED");
    expect(summary.tenantsFailed).toBe(2);
  });

  it("the error code never carries the error message (messages can contain row values)", async () => {
    const db = makeFakeRlsDb([], []);
    const summary = await forEachTenant(db.base, async () => {
      throw new Error("password=hunter2");
    });
    expect(JSON.stringify(summary)).not.toContain("hunter2");
    expect(summary.results[0].errorCode).toBe("Error");
  });

  it("a tenant that reports item failures is failed (and its other work stays committed): a degraded run is never SUCCESS", async () => {
    const db = makeFakeRlsDb([row("a1", "tenant-a"), row("a2", "tenant-a")], ["tenant-a"]);
    const summary = await forEachTenant(db.base, async (tx, tenantKey) => {
      const n = await tx.connectorCredential.updateMany({ where: { id: "a1" }, data: { keyVersion: "v2" } });
      return { examinedCount: 2, changedCount: n.count, failedCount: tenantKey === "tenant-a" ? 1 : 0 };
    });
    expect(summary.overall).toBe("PARTIAL_FAILURE");
    expect(summary.failedTotal).toBe(1);
    expect(db.rows.find((r) => r.id === "a1")?.keyVersion).toBe("v2");
  });

  it("derives the totals from the per-tenant results", () => {
    const summary = summarizeTenantRuns(
      [
        { tenantKey: "a", status: "success", examinedCount: 3, changedCount: 2, failedCount: 0, durationMs: 1 },
        { tenantKey: "b", status: "failed", examinedCount: 1, changedCount: 0, failedCount: 1, errorCode: "X", durationMs: 1 },
      ],
      7,
    );
    expect(summary).toMatchObject({ examinedTotal: 4, changedTotal: 2, failedTotal: 1, tenantsEvaluated: 2, directoryTenantCount: 7, overall: "PARTIAL_FAILURE" });
  });

  it("never claims there are no orphans: it reports that orphan detection is unverified for a runtime role", async () => {
    const db = makeFakeRlsDb([], ["tenant-a"]);
    const summary = await forEachTenant(db.base, async () => ({ examinedCount: 0, changedCount: 0 }));
    expect(summary.orphanDetection).toBe("UNVERIFIED_BY_RUNTIME_ROLE");
    expect(JSON.stringify(summary)).not.toMatch(/orphan(s|Count)?"?\s*:\s*0/);
  });
});

describe("forEachTenant: bounded concurrency", () => {
  const manyTenants = Array.from({ length: 30 }, (_, i) => `tenant-${String(i).padStart(2, "0")}`);

  it("never exceeds the default of 4 in-flight tenant transactions", async () => {
    const db = makeFakeRlsDb([], manyTenants);
    await forEachTenant(db.base, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { examinedCount: 0, changedCount: 0 };
    });
    expect(db.maxConcurrentTransactions).toBeLessThanOrEqual(4);
    expect(db.maxConcurrentTransactions).toBeGreaterThan(1);
    expect(db.transactionTenants).toHaveLength(31);
  });

  it("honours a lower configured concurrency", async () => {
    const db = makeFakeRlsDb([], manyTenants);
    await forEachTenant(
      db.base,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 3));
        return { examinedCount: 0, changedCount: 0 };
      },
      { concurrency: 1 },
    );
    expect(db.maxConcurrentTransactions).toBe(1);
  });

  it("clamps a huge requested concurrency to the maximum", async () => {
    const db = makeFakeRlsDb([], manyTenants);
    await forEachTenant(
      db.base,
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { examinedCount: 0, changedCount: 0 };
      },
      { concurrency: 1000 },
    );
    expect(db.maxConcurrentTransactions).toBeLessThanOrEqual(TENANT_ITERATION_MAX_CONCURRENCY);
  });

  it("three invocations at once (several schedulers) each process every tenant exactly once", async () => {
    const db = makeFakeRlsDb([], manyTenants);
    const work = async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return { examinedCount: 1, changedCount: 0 };
    };
    const [a, b, c] = await Promise.all([forEachTenant(db.base, work), forEachTenant(db.base, work), forEachTenant(db.base, work)]);
    for (const summary of [a, b, c]) {
      expect(summary.tenantsEvaluated).toBe(31);
      expect(new Set(summary.results.map((r) => r.tenantKey)).size).toBe(31);
      expect(summary.overall).toBe("SUCCESS");
    }
    // The bound is per invocation: with 3 invocations the process may reach 3 x 4. This documents that, it does not hide it.
    expect(db.maxConcurrentTransactions).toBeLessThanOrEqual(3 * 4);
  });
});

describe("forEachTenant: targeted runs", () => {
  it("iterates exactly the tenants it is given, without adding the default tenant", async () => {
    const db = makeFakeRlsDb([], ["tenant-a", "tenant-b"]);
    const summary = await forEachTenant(db.base, async () => ({ examinedCount: 0, changedCount: 0 }), { tenantKeys: ["tenant-b", " tenant-b ", ""] });
    expect(summary.results.map((r) => r.tenantKey)).toEqual(["tenant-b"]);
    expect(db.base.workspaceDirectory.findMany).not.toHaveBeenCalled();
  });
});
