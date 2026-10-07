import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { getTenantKeyFromContext } from "./tenant-context";
import { DEFAULT_TENANT_KEY } from "./tenant.constants";
import {
  TENANT_ITERATION_DEFAULTS,
  TenantIterationIncompleteError,
  TenantIterationListingError,
  TenantIterationService,
  assertTenantIterationComplete,
} from "./tenant-iteration.service";

type DirectoryRow = { tenantKey: string; isActive: boolean };

/**
 * A fake WorkspaceDirectory that honours the parts of the query the helper relies on (keyset `gt` cursor, `isActive`,
 * ascending order, `take`). A fake that ignored them would pass a helper that never paginates.
 */
function makeDirectory(rows: DirectoryRow[], options: { failOnCall?: number } = {}) {
  let calls = 0;
  const findMany = jest.fn(async (args: { where?: { isActive?: boolean; tenantKey?: { gt?: string } }; take: number }) => {
    calls += 1;
    if (options.failOnCall === calls) {
      throw new Error("directory unavailable");
    }
    let selected = [...rows].sort((a, b) => (a.tenantKey < b.tenantKey ? -1 : a.tenantKey > b.tenantKey ? 1 : 0));
    if (args.where?.isActive !== undefined) {
      selected = selected.filter((row) => row.isActive === args.where?.isActive);
    }
    const gt = args.where?.tenantKey?.gt;
    if (gt !== undefined) {
      selected = selected.filter((row) => row.tenantKey > gt);
    }
    return selected.slice(0, args.take).map((row) => ({ tenantKey: row.tenantKey }));
  });
  const tenant = jest.fn(() => ({ workspaceDirectory: { findMany } }));
  return { prisma: { tenant } as never, findMany, tenant };
}

function active(...keys: string[]): DirectoryRow[] {
  return keys.map((tenantKey) => ({ tenantKey, isActive: true }));
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("TenantIterationService", () => {
  let warn: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("which tenants are visited", () => {
    it("visits the default tenant first, then every directory tenant once", async () => {
      const dir = makeDirectory(active("acme", "beta", "gamma"));
      const svc = new TenantIterationService(dir.prisma);
      const result = await svc.forEachTenant({ label: "t", concurrency: 1 }, async ({ tenantKey }) => tenantKey);
      expect(result.outcomes.map((o) => o.tenantKey)).toEqual([DEFAULT_TENANT_KEY, "acme", "beta", "gamma"]);
      expect(result.listed).toBe(4);
      expect(result.processed).toBe(4);
      expect(result.complete).toBe(true);
    });

    it("does not visit the default tenant twice when the directory lists it, and normalises keys", async () => {
      const dir = makeDirectory(active(DEFAULT_TENANT_KEY, "acme"));
      const svc = new TenantIterationService(dir.prisma);
      const result = await svc.forEachTenant({ label: "t", concurrency: 1 }, async ({ tenantKey }) => tenantKey);
      expect(result.outcomes.map((o) => o.tenantKey)).toEqual([DEFAULT_TENANT_KEY, "acme"]);
    });

    it("reads the directory in keyset pages and covers more tenants than one page", async () => {
      const keys = ["t01", "t02", "t03", "t04", "t05", "t06", "t07"];
      const dir = makeDirectory(active(...keys));
      const svc = new TenantIterationService(dir.prisma);
      const result = await svc.forEachTenant({ label: "t", pageSize: 3, concurrency: 1 }, async ({ tenantKey }) => tenantKey);
      expect(result.outcomes.map((o) => o.tenantKey)).toEqual([DEFAULT_TENANT_KEY, ...keys]);
      // 7 rows with a page of 3 is pages of 3, 3, 1.
      expect(dir.findMany).toHaveBeenCalledTimes(3);
      const cursors = dir.findMany.mock.calls.map((call) => call[0].where?.tenantKey?.gt);
      expect(cursors).toEqual([undefined, "t03", "t06"]);
      for (const call of dir.findMany.mock.calls) {
        expect(call[0].take).toBe(3);
      }
    });

    it("includes deactivated workspaces by default and excludes them on request", async () => {
      const rows: DirectoryRow[] = [
        { tenantKey: "live", isActive: true },
        { tenantKey: "gone", isActive: false },
      ];
      const svc = new TenantIterationService(makeDirectory(rows).prisma);
      const all = await svc.forEachTenant({ label: "t", concurrency: 1 }, async ({ tenantKey }) => tenantKey);
      expect(all.outcomes.map((o) => o.tenantKey)).toEqual([DEFAULT_TENANT_KEY, "gone", "live"]);
      const onlyActive = await svc.forEachTenant({ label: "t", concurrency: 1, includeInactive: false }, async ({ tenantKey }) => tenantKey);
      expect(onlyActive.outcomes.map((o) => o.tenantKey)).toEqual([DEFAULT_TENANT_KEY, "live"]);
    });

    it("runs exactly an explicit list without reading the directory", async () => {
      const dir = makeDirectory(active("acme"));
      const svc = new TenantIterationService(dir.prisma);
      const result = await svc.forEachTenant({ label: "t", tenantKeys: ["x", "y", "x"], concurrency: 1 }, async ({ tenantKey }) => tenantKey);
      expect(result.outcomes.map((o) => o.tenantKey)).toEqual(["x", "y"]);
      expect(result.directoryTenants).toBeNull();
      expect(dir.findMany).not.toHaveBeenCalled();
    });
  });

  describe("tenant context", () => {
    it("runs every callback in its own tenant context, with no leakage between concurrent tenants", async () => {
      const dir = makeDirectory(active("a", "b", "c", "d", "e", "f"));
      const svc = new TenantIterationService(dir.prisma);
      const seen: Array<[string, string, string]> = [];
      await svc.forEachTenant({ label: "t", concurrency: 4 }, async ({ tenantKey }) => {
        const before = getTenantKeyFromContext();
        await sleep(Math.random() * 15);
        const after = getTenantKeyFromContext();
        seen.push([tenantKey, before, after]);
      });
      expect(seen).toHaveLength(7);
      for (const [tenantKey, before, after] of seen) {
        expect(before).toBe(tenantKey);
        expect(after).toBe(tenantKey);
      }
    });
  });

  describe("bounded concurrency", () => {
    async function maxInFlight(concurrency: number | undefined, tenants: number) {
      const keys = Array.from({ length: tenants }, (_, i) => `t${String(i).padStart(3, "0")}`);
      const svc = new TenantIterationService(makeDirectory(active(...keys)).prisma);
      let inFlight = 0;
      let max = 0;
      await svc.forEachTenant({ label: "t", concurrency }, async () => {
        inFlight += 1;
        max = Math.max(max, inFlight);
        await sleep(8);
        inFlight -= 1;
      });
      return max;
    }

    it("never runs more tenants at once than the bound, and does use the bound", async () => {
      expect(await maxInFlight(3, 12)).toBe(3);
    });

    it("clamps a huge bound to the hard cap and a zero bound to one", async () => {
      expect(await maxInFlight(1000, 40)).toBeLessThanOrEqual(TENANT_ITERATION_DEFAULTS.maxConcurrency);
      expect(await maxInFlight(0, 5)).toBe(1);
    });

    it("uses the default bound when none is given", async () => {
      expect(await maxInFlight(undefined, 12)).toBe(TENANT_ITERATION_DEFAULTS.concurrency);
    });
  });

  describe("one tenant cannot stall the others", () => {
    it("times out a hanging tenant, aborts its signal, frees its slot and still processes the rest", async () => {
      const svc = new TenantIterationService(makeDirectory(active("hang", "ok1", "ok2")).prisma);
      let hungSignal: AbortSignal | undefined;
      const result = await svc.forEachTenant({ label: "t", concurrency: 1, perTenantTimeoutMs: 30 }, async ({ tenantKey, signal }) => {
        if (tenantKey === "hang") {
          hungSignal = signal;
          await new Promise<never>(() => undefined);
        }
        return tenantKey;
      });
      expect(result.timedOut).toBe(1);
      expect(result.processed).toBe(3);
      expect(result.complete).toBe(false);
      expect(hungSignal?.aborted).toBe(true);
      expect(result.outcomes.find((o) => o.tenantKey === "hang")?.outcome).toBe("timed_out");
      // With a bound of one, the tenants after the hung one were only reached because its slot was released.
      expect(result.outcomes.map((o) => o.tenantKey)).toEqual([DEFAULT_TENANT_KEY, "hang", "ok1", "ok2"]);
    });

    it("does not leak an unhandled rejection when a timed-out tenant later fails", async () => {
      const unhandled: unknown[] = [];
      const listener = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", listener);
      try {
        const svc = new TenantIterationService(makeDirectory(active("late")).prisma);
        await svc.forEachTenant({ label: "t", concurrency: 2, perTenantTimeoutMs: 15 }, async ({ tenantKey }) => {
          if (tenantKey === "late") {
            await sleep(60);
            throw new Error("rejected after the timeout");
          }
        });
        await sleep(120);
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", listener);
      }
    });
  });

  describe("failures are counted, not swallowed", () => {
    it("isolates a failing tenant and still processes the others", async () => {
      const svc = new TenantIterationService(makeDirectory(active("bad", "ok")).prisma);
      const result = await svc.forEachTenant({ label: "t", concurrency: 1 }, async ({ tenantKey }) => {
        if (tenantKey === "bad") {
          throw new TypeError("boom");
        }
        return 1;
      });
      expect(result.failed).toBe(1);
      expect(result.processed).toBe(2);
      expect(result.complete).toBe(false);
      expect(result.outcomes.find((o) => o.tenantKey === "bad")).toMatchObject({ outcome: "failed", errorName: "TypeError" });
    });

    it("records the class name and a safe code, and never logs or returns the error message", async () => {
      const svc = new TenantIterationService(makeDirectory(active("bad")).prisma);
      const result = await svc.forEachTenant({ label: "t", concurrency: 1 }, async ({ tenantKey }) => {
        if (tenantKey === "bad") {
          throw Object.assign(new Error("customer email jane@example.com token=abc123"), { code: "P2024" });
        }
      });
      const bad = result.outcomes.find((o) => o.tenantKey === "bad");
      expect(bad).toMatchObject({ outcome: "failed", errorName: "Error", errorCode: "P2024" });
      expect(JSON.stringify(result)).not.toContain("jane@example.com");
      const logged = [...warn.mock.calls, ...log.mock.calls].map((call) => String(call[0])).join("\n");
      expect(logged).not.toContain("jane@example.com");
      expect(logged).not.toContain("abc123");
      expect(logged).toContain("tenant.iteration.tenant_problem");
    });

    it("returns each tenant's value so a job can aggregate", async () => {
      const svc = new TenantIterationService(makeDirectory(active("a", "b", "c")).prisma);
      const result = await svc.forEachTenant({ label: "t", concurrency: 2 }, async ({ tenantKey }) => tenantKey.length);
      const total = result.outcomes.reduce((sum, o) => sum + (o.value ?? 0), 0);
      expect(total).toBe(DEFAULT_TENANT_KEY.length + 3);
    });

    it("assertTenantIterationComplete throws for an incomplete run and not for a complete one", async () => {
      const svc = new TenantIterationService(makeDirectory(active("bad")).prisma);
      const bad = await svc.forEachTenant({ label: "job", concurrency: 1 }, async ({ tenantKey }) => {
        if (tenantKey === "bad") {
          throw new Error("x");
        }
      });
      expect(() => assertTenantIterationComplete(bad)).toThrow(TenantIterationIncompleteError);
      const good = await svc.forEachTenant({ label: "job", concurrency: 1, tenantKeys: ["ok"] }, async () => 1);
      expect(() => assertTenantIterationComplete(good)).not.toThrow();
    });
  });

  describe("silence is made visible", () => {
    it("reports an empty explicit list as zero tenants, incomplete, and warns", async () => {
      const svc = new TenantIterationService(makeDirectory([]).prisma);
      const result = await svc.forEachTenant({ label: "job", tenantKeys: [] }, async () => 1);
      expect(result.zeroTenants).toBe(true);
      expect(result.complete).toBe(false);
      expect(String(warn.mock.calls[0]?.[0])).toContain('"zeroTenants":true');
    });

    it("warns when the directory is empty, because only the default tenant will be visited", async () => {
      const svc = new TenantIterationService(makeDirectory([]).prisma);
      const result = await svc.forEachTenant({ label: "job", concurrency: 1 }, async () => 1);
      expect(result.listed).toBe(1);
      expect(result.directoryTenants).toBe(0);
      const warned = warn.mock.calls.map((call) => String(call[0])).join("\n");
      expect(warned).toContain("tenant.iteration.empty_directory");
    });
  });

  describe("listing failures", () => {
    it("throws after in-flight tenants finish, with the partial result attached", async () => {
      const dir = makeDirectory(active("t01", "t02", "t03", "t04", "t05"), { failOnCall: 2 });
      const svc = new TenantIterationService(dir.prisma);
      let finished = 0;
      const attempt = svc.forEachTenant({ label: "job", pageSize: 2, concurrency: 2 }, async () => {
        await sleep(10);
        finished += 1;
      });
      await expect(attempt).rejects.toBeInstanceOf(TenantIterationListingError);
      const error = (await attempt.catch((e) => e)) as TenantIterationListingError;
      // Reached the default tenant and the first page; every tenant that started also finished.
      expect(error.result.listed).toBe(3);
      expect(error.result.complete).toBe(false);
      expect(finished).toBe(error.result.listed);
    });
  });

  describe("deadline and abort", () => {
    it("stops starting tenants after the deadline and reports the unstarted ones for an explicit list", async () => {
      const svc = new TenantIterationService(makeDirectory([]).prisma);
      const keys = Array.from({ length: 10 }, (_, i) => `t${i}`);
      const result = await svc.forEachTenant({ label: "job", tenantKeys: keys, concurrency: 1, deadlineMs: 30 }, async () => sleep(20));
      expect(result.deadlineReached).toBe(true);
      expect(result.processed).toBeGreaterThan(0);
      expect(result.processed).toBeLessThan(10);
      expect(result.skipped).toBe(10 - result.listed);
      expect(result.complete).toBe(false);
    });

    it("does not start any tenant when the abort signal is already set", async () => {
      const controller = new AbortController();
      controller.abort();
      const work = jest.fn(async () => 1);
      const svc = new TenantIterationService(makeDirectory(active("a")).prisma);
      const result = await svc.forEachTenant({ label: "job", signal: controller.signal }, work);
      expect(result.aborted).toBe(true);
      expect(result.listed).toBe(0);
      expect(work).not.toHaveBeenCalled();
      expect(result.complete).toBe(false);
    });
  });

  describe("wiring", () => {
    it("is injectable with only the tenant-aware PrismaService and is provided and exported by the global tenant module", () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { PrismaService } = require("../../prisma/prisma.service");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { TenantDirectoryModule } = require("./tenant-directory.module");
      expect(Reflect.getMetadata("design:paramtypes", TenantIterationService)).toEqual([PrismaService]);
      expect(Reflect.getMetadata("providers", TenantDirectoryModule)).toContain(TenantIterationService);
      expect(Reflect.getMetadata("exports", TenantDirectoryModule)).toContain(TenantIterationService);
    });
  });

  describe("no privileged client", () => {
    it("reads the directory only through the tenant client and never imports the direct client", () => {
      const source = readFileSync(join(__dirname, "tenant-iteration.service.ts"), "utf8");
      expect(source).not.toMatch(/PrismaDirectService/);
      expect(source).not.toMatch(/prisma-direct/);
      expect(source).not.toMatch(/new PrismaClient\(/);
      expect(source).toMatch(/this\.prisma\.tenant\(DEFAULT_TENANT_KEY\)\.workspaceDirectory/);
    });
  });
});
