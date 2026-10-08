// Coverage for ConnectorWebhookLeaseSweeperService.runSweep() — it closes a real gap (a worker crash mid-webhook-processing
// previously left the row stuck forever, since recovery was redelivery-driven only). redriveStrandedWebhookEvent() itself is
// already covered (PR #835) — this covers the sweeper's own orchestration around it: tenant discovery, outcome aggregation,
// single-flight, and error isolation.
//
// SEC-DB-RLS-001 P2.3c: discovery is PER TENANT (forEachTenant) inside that tenant's own transaction. The fake database models the
// one property that matters: a transaction sees only the rows of the tenant whose context it set (as a restricted role would),
// unless `leakAcrossTenants` models a role that bypasses row level security.
import { Prisma } from "@prisma/client";
import { ConnectorWebhookLeaseSweeperService } from "./connector-webhook-lease-sweeper.service";
import type { ConnectorWebhookIngestionService } from "./connector-webhook-ingestion.service";

type Stranded = { id: string; tenantKey: string; installationId: string; receivedAt?: Date };

function makeStubs(
  strandedRows: Stranded[],
  options: { directory?: string[]; failTenants?: string[]; leakAcrossTenants?: boolean; directoryError?: Error } = {},
) {
  const rows = strandedRows.map((row, index) => ({ receivedAt: new Date(Date.UTC(2026, 9, 1, 0, index)), ...row }));
  const selectCalls: Array<{ tenantKey: string; now: Date; limit: number }> = [];
  const makeTx = () => {
    let context = "";
    return {
      $queryRaw: jest.fn(async (first: unknown, ...rest: unknown[]) => {
        if (Array.isArray(first)) {
          context = String(rest[0]);
          return [];
        }
        const sql = first as Prisma.Sql;
        const filterTenant = String(sql.values[0]);
        selectCalls.push({ tenantKey: filterTenant, now: sql.values[1] as Date, limit: Number(sql.values[2]) });
        if (options.failTenants?.includes(filterTenant)) {
          throw Object.assign(new Error("connection postgres://user:SECRET@host/db reset"), { code: "P1001" });
        }
        const visible = options.leakAcrossTenants ? rows : rows.filter((r) => r.tenantKey === context);
        const filtered = options.leakAcrossTenants ? visible : visible.filter((r) => r.tenantKey === filterTenant);
        return [...filtered].sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime()).slice(0, Number(sql.values[2]));
      }),
    };
  };
  const findMany = jest.fn(async () => {
    if (options.directoryError) {
      throw options.directoryError;
    }
    return (options.directory ?? []).map((tenantKey) => ({ tenantKey }));
  });
  const client = { workspaceDirectory: { findMany }, $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())) };
  const prisma = { tenant: jest.fn(() => client) };
  const ingestion = { redriveStrandedWebhookEvent: jest.fn() } as unknown as ConnectorWebhookIngestionService;
  return { prisma, ingestion, findMany, selectCalls };
}

const ROW_A = { id: "wh-a", tenantKey: "tenant-a", installationId: "install-1" };
const ROW_B = { id: "wh-b", tenantKey: "tenant-a", installationId: "install-1" };
const ROW_C = { id: "wh-c", tenantKey: "tenant-a", installationId: "install-1" };

const build = (stubs: ReturnType<typeof makeStubs>) =>
  new ConnectorWebhookLeaseSweeperService(stubs.prisma as never, stubs.ingestion);
const redrive = (stubs: ReturnType<typeof makeStubs>) => stubs.ingestion.redriveStrandedWebhookEvent as jest.Mock;

describe("ConnectorWebhookLeaseSweeperService.runSweep — stranded webhook recovery", () => {
  it("returns a zeroed summary and never calls the ingestion service when nothing is stranded", async () => {
    const stubs = makeStubs([]);
    const summary = await build(stubs).runSweep();

    expect(summary).toMatchObject({ scanned: 0, processed: 0, failed: 0, retried: 0, skipped: 0, tenantsFailed: 0 });
    expect(redrive(stubs)).not.toHaveBeenCalled();
  });

  it("aggregates every outcome type into the matching summary bucket", async () => {
    const stubs = makeStubs([ROW_A, ROW_B, ROW_C], { directory: ["tenant-a"] });
    redrive(stubs)
      .mockResolvedValueOnce({ id: "wh-a", outcome: "processed" })
      .mockResolvedValueOnce({ id: "wh-b", outcome: "failed" })
      .mockResolvedValueOnce({ id: "wh-c", outcome: "retry" });

    const summary = await build(stubs).runSweep();

    expect(summary).toMatchObject({ scanned: 3, processed: 1, failed: 1, retried: 1, skipped: 0 });
  });

  it("counts a 'skipped' outcome from the ingestion service correctly", async () => {
    const stubs = makeStubs([ROW_A], { directory: ["tenant-a"] });
    redrive(stubs).mockResolvedValue({ id: "wh-a", outcome: "skipped" });

    const summary = await build(stubs).runSweep();

    expect(summary.skipped).toBe(1);
  });

  it("isolates one row's redrive failure as skipped — the rest of the batch still gets processed", async () => {
    const stubs = makeStubs([ROW_A, ROW_B], { directory: ["tenant-a"] });
    redrive(stubs).mockRejectedValueOnce(new Error("db timeout")).mockResolvedValueOnce({ id: "wh-b", outcome: "processed" });

    const summary = await build(stubs).runSweep();

    expect(summary).toMatchObject({ scanned: 2, processed: 1, failed: 0, retried: 0, skipped: 1 });
  });

  it("is single-flight: a sweep already running skips a concurrent second call entirely", async () => {
    const stubs = makeStubs([ROW_A], { directory: ["tenant-a"] });
    redrive(stubs).mockResolvedValue({ id: "wh-a", outcome: "processed" });
    const service = build(stubs);

    const firstRun = service.runSweep();
    const secondSummary = await service.runSweep();

    // The single-flight guard is set synchronously before the first await, so the second
    // call reliably observes it already set and returns a zeroed summary without scanning.
    expect(secondSummary).toMatchObject({ scanned: 0, processed: 0, failed: 0, retried: 0, skipped: 0 });
    expect(stubs.prisma.tenant).toHaveBeenCalledTimes(1);

    await firstRun;
  });

  it("scopes the scan to a single tenant when tenantKey is provided (deterministic-test path)", async () => {
    const stubs = makeStubs([ROW_A], { directory: ["tenant-a", "tenant-z"] });
    redrive(stubs).mockResolvedValue({ id: "wh-a", outcome: "processed" });

    await build(stubs).runSweep({ tenantKey: "tenant-a" });

    expect(stubs.selectCalls.map((c) => c.tenantKey)).toEqual(["tenant-a"]);
    expect(stubs.findMany).not.toHaveBeenCalled();
  });

  it("passes a caller-supplied batchSize and maxAttempts through instead of the env-configured defaults", async () => {
    const stubs = makeStubs([ROW_A], { directory: ["tenant-a"] });
    redrive(stubs).mockResolvedValue({ id: "wh-a", outcome: "processed" });

    await build(stubs).runSweep({ batchSize: 7, maxAttempts: 2 });

    for (const call of stubs.selectCalls) {
      expect(call.limit).toBe(7);
    }
    expect(redrive(stubs)).toHaveBeenCalledWith(expect.objectContaining({ maxAttempts: 2 }));
  });

  // ---- SEC-DB-RLS-001 P2.3c: tenant discovery -------------------------------------------------------------------------------------

  it("re-drives the stranded events of every non-default directory tenant, not only the default tenant (the silent single-tenant failure)", async () => {
    const stubs = makeStubs(
      [
        { id: "wh-default", tenantKey: "default", installationId: "i-d" },
        { id: "wh-b", tenantKey: "tenant-b", installationId: "i-b" },
        { id: "wh-c", tenantKey: "tenant-c", installationId: "i-c" },
      ],
      { directory: ["tenant-b", "tenant-c"] },
    );
    redrive(stubs).mockResolvedValue({ id: "x", outcome: "processed" });

    const summary = await build(stubs).runSweep();

    const redriven = redrive(stubs).mock.calls.map((c) => `${c[0].tenantKey}/${c[0].id}`).sort();
    expect(redriven).toEqual(["default/wh-default", "tenant-b/wh-b", "tenant-c/wh-c"]);
    expect(summary).toMatchObject({ scanned: 3, processed: 3, tenantsEvaluated: 3, tenantsFailed: 0 });
  });

  it("filters every per-tenant query by that tenant and by the lease cutoff", async () => {
    const stubs = makeStubs([], { directory: ["tenant-b"] });
    const before = Date.now();
    await build(stubs).runSweep();

    expect(stubs.selectCalls.map((c) => c.tenantKey).sort()).toEqual(["default", "tenant-b"]);
    for (const call of stubs.selectCalls) {
      expect(call.now.getTime()).toBeGreaterThanOrEqual(before);
    }
  });

  it("with a role that bypasses row level security, no event is re-driven once per tenant (no duplicate work)", async () => {
    const stubs = makeStubs(
      [
        { id: "wh-default", tenantKey: "default", installationId: "i-d" },
        { id: "wh-b", tenantKey: "tenant-b", installationId: "i-b" },
      ],
      { directory: ["tenant-b"], leakAcrossTenants: true },
    );
    redrive(stubs).mockResolvedValue({ id: "x", outcome: "processed" });

    const summary = await build(stubs).runSweep();

    expect(redrive(stubs).mock.calls.map((c) => c[0].id).sort()).toEqual(["wh-b", "wh-default"]);
    // Rows that belong to another tenant than the iteration's are reported as failures, never silently re-acted-on.
    expect(summary.tenantsFailed).toBeGreaterThan(0);
  });

  it("applies the batch bound across tenants, oldest first", async () => {
    const stubs = makeStubs(
      [
        { id: "new-default", tenantKey: "default", installationId: "i", receivedAt: new Date(Date.UTC(2026, 9, 1, 9)) },
        { id: "old-b", tenantKey: "tenant-b", installationId: "i", receivedAt: new Date(Date.UTC(2026, 9, 1, 1)) },
        { id: "mid-c", tenantKey: "tenant-c", installationId: "i", receivedAt: new Date(Date.UTC(2026, 9, 1, 5)) },
      ],
      { directory: ["tenant-b", "tenant-c"] },
    );
    redrive(stubs).mockResolvedValue({ id: "x", outcome: "processed" });

    const summary = await build(stubs).runSweep({ batchSize: 2 });

    expect(redrive(stubs).mock.calls.map((c) => c[0].id)).toEqual(["old-b", "mid-c"]);
    expect(summary.scanned).toBe(2);
  });

  it("one unreadable tenant does not hide the others, and is logged by code, never by message", async () => {
    const stubs = makeStubs(
      [
        { id: "wh-b", tenantKey: "tenant-b", installationId: "i-b" },
        { id: "wh-c", tenantKey: "tenant-c", installationId: "i-c" },
      ],
      { directory: ["tenant-b", "tenant-c"], failTenants: ["tenant-b"] },
    );
    redrive(stubs).mockResolvedValue({ id: "x", outcome: "processed" });
    const service = build(stubs);
    const errorSpy = jest.spyOn((service as unknown as { logger: { error: (m: string) => void } }).logger, "error").mockImplementation(() => undefined);

    const summary = await service.runSweep();

    expect(redrive(stubs).mock.calls.map((c) => c[0].id)).toEqual(["wh-c"]);
    expect(summary).toMatchObject({ scanned: 1, processed: 1, tenantsFailed: 1 });
    expect(errorSpy).toHaveBeenCalled();
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("SECRET");
  });

  it("a directory read failure rejects instead of quietly sweeping only the default tenant", async () => {
    const stubs = makeStubs([{ id: "wh-default", tenantKey: "default", installationId: "i" }], { directoryError: new Error("directory unreadable") });

    await expect(build(stubs).runSweep()).rejects.toThrow("directory unreadable");
    expect(redrive(stubs)).not.toHaveBeenCalled();
  });

  it("states that orphan detection by a runtime role is unverified", async () => {
    const summary = await build(makeStubs([])).runSweep();
    expect(summary.orphanDetection).toBe("UNVERIFIED_BY_RUNTIME_ROLE");
  });
});
