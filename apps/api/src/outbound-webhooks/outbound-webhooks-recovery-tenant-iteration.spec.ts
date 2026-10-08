// SEC-DB-RLS-001 P2.2: stuck-queued webhook delivery recovery reaches EVERY tenant.
//
// Before: ONE scan through `prisma.tenant()` (no argument) over outbound_webhook_deliveries. Under row level security that sees only the
// default tenant, so the recovery job would re-enqueue one tenant's stuck deliveries and quietly leave every other tenant's stuck.
// After: the scan runs per tenant inside that tenant's own transaction (forEachTenant), filters by the tenant it is given, merges the
// results oldest-first under the overall limit, and reports tenants it could not read.
//
// The fake database below models the one property that matters: rows are returned only for the tenant whose context is set in the
// transaction (as a restricted role would see them), unless a test turns `leakAcrossTenants` on to model a role that bypasses RLS.
import { Prisma } from "@prisma/client";
import { OutboundWebhooksService } from "./outbound-webhooks.service";

type StuckRow = { id: string; tenantKey: string; endpointId: string; createdAt: Date };

function row(tenantKey: string, id: string, ageMs: number): StuckRow {
  return { id, tenantKey, endpointId: `ep-${tenantKey}`, createdAt: new Date(Date.now() - ageMs) };
}

function makeHarness(options: {
  directory?: string[];
  rows?: StuckRow[];
  failTenants?: string[];
  leakAcrossTenants?: boolean;
  directoryError?: Error;
}) {
  const rows = options.rows ?? [];
  const selectCalls: Array<{ tenantKey: string; limit: number }> = [];

  const makeTx = () => {
    let context = "";
    return {
      $queryRaw: jest.fn(async (first: unknown, ...rest: unknown[]) => {
        if (Array.isArray(first)) {
          // `SELECT set_config('app.tenant_key', ${tenantKey}, true)` (tagged template): remember the transaction's tenant context.
          context = String(rest[0]);
          return [];
        }
        const sql = first as Prisma.Sql;
        const filterTenant = String(sql.values[0]);
        const limit = Number(sql.values[sql.values.length - 1]);
        selectCalls.push({ tenantKey: filterTenant, limit });
        if (options.failTenants?.includes(filterTenant)) {
          throw Object.assign(new Error("connection postgres://user:SECRET@host/db reset"), { code: "P1001" });
        }
        const visible = options.leakAcrossTenants ? rows : rows.filter((r) => r.tenantKey === context);
        const filtered = options.leakAcrossTenants ? visible : visible.filter((r) => r.tenantKey === filterTenant);
        return [...filtered].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).slice(0, limit);
      }),
    };
  };

  const baseClient = {
    workspaceDirectory: {
      findMany: jest.fn(async () => {
        if (options.directoryError) {
          throw options.directoryError;
        }
        return (options.directory ?? []).map((tenantKey) => ({ tenantKey }));
      }),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
  };

  const updated: Array<{ tenantKey: string; id: string }> = [];
  const prisma = {
    tenant: jest.fn((tenantKey?: string) => {
      if (tenantKey === undefined) {
        return baseClient;
      }
      return {
        outboundWebhookDelivery: {
          update: jest.fn(async (args: { where: { id: string }; data: { status: string } }) => {
            updated.push({ tenantKey, id: args.where.id });
            return { id: args.where.id, status: args.data.status };
          }),
        },
      };
    }),
  };

  const enqueued: Array<{ tenantKey: string; deliveryId: string }> = [];
  const queueService = {
    processWithBackpressure: jest.fn(),
    enqueue: jest.fn(async (_name: string, payload: { tenantKey: string; deliveryId: string }) => {
      enqueued.push({ tenantKey: payload.tenantKey, deliveryId: payload.deliveryId });
    }),
  };
  const auditService = { record: jest.fn(async () => undefined) };

  const service = new OutboundWebhooksService(prisma as never, auditService as never, queueService as never, {} as never);
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn(), debug: jest.fn() };
  (service as unknown as { logger: unknown }).logger = logger;
  return { service, enqueued, updated, selectCalls, auditService, logger, baseClient };
}

describe("OutboundWebhooksService.recoverStuckQueuedDeliveries tenant iteration", () => {
  it("recovers stuck deliveries of every non-default directory tenant, not only the default tenant (the silent single-tenant failure)", async () => {
    const h = makeHarness({
      directory: ["tenant-b", "tenant-c"],
      rows: [row("default", "d-1", 300_000), row("tenant-b", "b-1", 200_000), row("tenant-c", "c-1", 100_000)],
    });

    const result = await h.service.recoverStuckQueuedDeliveries();

    expect(h.enqueued.map((e) => `${e.tenantKey}/${e.deliveryId}`).sort()).toEqual(["default/d-1", "tenant-b/b-1", "tenant-c/c-1"]);
    expect(result).toMatchObject({ recovered: 3, failed: 0, tenantsFailed: 0 });
    expect(result.tenantsEvaluated).toBe(3);
  });

  it("scopes every delivery to its own tenant (a delivery is never enqueued or updated under another tenant)", async () => {
    const h = makeHarness({ directory: ["tenant-b"], rows: [row("default", "d-1", 120_000), row("tenant-b", "b-1", 90_000)] });
    await h.service.recoverStuckQueuedDeliveries();
    expect(h.updated.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { tenantKey: "tenant-b", id: "b-1" },
      { tenantKey: "default", id: "d-1" },
    ]);
  });

  it("filters the scan by the tenant it is given (correct with or without row level security)", async () => {
    const h = makeHarness({ directory: ["tenant-b"], rows: [row("tenant-b", "b-1", 90_000)] });
    await h.service.recoverStuckQueuedDeliveries();
    expect(h.selectCalls.map((c) => c.tenantKey).sort()).toEqual(["default", "tenant-b"]);
  });

  it("with a role that bypasses row level security, no delivery is recovered once per tenant (no duplicate enqueue)", async () => {
    const h = makeHarness({
      directory: ["tenant-b"],
      rows: [row("default", "d-1", 120_000), row("tenant-b", "b-1", 90_000)],
      leakAcrossTenants: true,
    });
    const result = await h.service.recoverStuckQueuedDeliveries();
    expect(h.enqueued.map((e) => `${e.tenantKey}/${e.deliveryId}`).sort()).toEqual(["default/d-1", "tenant-b/b-1"]);
    // Rows that belong to another tenant than the iteration's are reported as failures, never silently re-acted-on.
    expect(result.tenantsFailed).toBeGreaterThan(0);
  });

  it("applies the overall limit across tenants, oldest first", async () => {
    const h = makeHarness({
      directory: ["tenant-b", "tenant-c"],
      rows: [row("default", "d-new", 61_000), row("tenant-b", "b-old", 500_000), row("tenant-b", "b-mid", 300_000), row("tenant-c", "c-old", 400_000)],
    });
    const result = await h.service.recoverStuckQueuedDeliveries(2);
    expect(h.enqueued.map((e) => e.deliveryId)).toEqual(["b-old", "c-old"]);
    expect(result.recovered).toBe(2);
  });

  it("one unreadable tenant does not hide the others, and is reported by code, never message", async () => {
    const h = makeHarness({
      directory: ["tenant-b", "tenant-c"],
      rows: [row("tenant-b", "b-1", 90_000), row("tenant-c", "c-1", 90_000)],
      failTenants: ["tenant-b"],
    });
    const result = await h.service.recoverStuckQueuedDeliveries();
    expect(h.enqueued.map((e) => e.deliveryId)).toEqual(["c-1"]);
    expect(result.tenantsFailed).toBe(1);
    expect(h.logger.error).toHaveBeenCalled();
    expect(JSON.stringify(h.logger.error.mock.calls)).not.toContain("SECRET");
    expect(JSON.stringify(h.auditService.record.mock.calls)).not.toContain("SECRET");
  });

  it("a directory read failure rejects instead of quietly recovering only the default tenant", async () => {
    const h = makeHarness({ directoryError: new Error("directory unreadable"), rows: [row("default", "d-1", 90_000)] });
    await expect(h.service.recoverStuckQueuedDeliveries()).rejects.toThrow("directory unreadable");
    expect(h.enqueued).toEqual([]);
  });

  it("records one audit entry with the totals and the unread-tenant count", async () => {
    const h = makeHarness({ directory: ["tenant-b"], rows: [row("tenant-b", "b-1", 90_000)] });
    await h.service.recoverStuckQueuedDeliveries();
    expect(h.auditService.record).toHaveBeenCalledTimes(1);
    expect(h.auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "outbound_webhook.queued_recovery", metadata: expect.objectContaining({ recovered: 1, failed: 0, tenantsFailed: 0 }) }),
    );
  });

  it("does not audit when nothing was recovered and every tenant was readable", async () => {
    const h = makeHarness({ directory: ["tenant-b"], rows: [] });
    const result = await h.service.recoverStuckQueuedDeliveries();
    expect(result).toMatchObject({ recovered: 0, failed: 0, tenantsFailed: 0 });
    expect(h.auditService.record).not.toHaveBeenCalled();
  });

  it("states that orphan detection by a runtime role is unverified", async () => {
    const h = makeHarness({ directory: [], rows: [] });
    const result = await h.service.recoverStuckQueuedDeliveries();
    expect(result.orphanDetection).toBe("UNVERIFIED_BY_RUNTIME_ROLE");
  });
});
