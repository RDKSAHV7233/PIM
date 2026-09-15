// Coverage for ConnectorWebhookLeaseSweeperService.runSweep() — zero test
// coverage before, despite being explicitly documented in its own file as
// "directly testable" and despite closing a real gap (a worker crash mid-
// webhook-processing previously left the row stuck forever, since recovery
// was redelivery-driven only). redriveStrandedWebhookEvent() itself is
// already covered (PR #835) — this covers the sweeper's own orchestration
// around it: outcome aggregation, single-flight, and error isolation.

import { ConnectorWebhookLeaseSweeperService } from "./connector-webhook-lease-sweeper.service";
import type { PrismaDirectService } from "../prisma/prisma-direct.service";
import type { ConnectorWebhookIngestionService } from "./connector-webhook-ingestion.service";

function makeStubs(strandedRows: any[]) {
  const findMany = jest.fn().mockResolvedValue(strandedRows);
  const prismaDirect = {
    getClient: jest.fn().mockReturnValue({ connectorWebhookEvent: { findMany } }),
  } as unknown as PrismaDirectService;
  const ingestion = { redriveStrandedWebhookEvent: jest.fn() } as unknown as ConnectorWebhookIngestionService;
  return { prismaDirect, ingestion, findMany };
}

const ROW_A = { id: "wh-a", tenantKey: "tenant-a", installationId: "install-1" };
const ROW_B = { id: "wh-b", tenantKey: "tenant-a", installationId: "install-1" };
const ROW_C = { id: "wh-c", tenantKey: "tenant-a", installationId: "install-1" };

describe("ConnectorWebhookLeaseSweeperService.runSweep — stranded webhook recovery (no prior coverage)", () => {
  it("returns a zeroed summary and never calls the ingestion service when nothing is stranded", async () => {
    const stubs = makeStubs([]);
    const service = new ConnectorWebhookLeaseSweeperService(stubs.prismaDirect, stubs.ingestion);

    const summary = await service.runSweep();

    expect(summary).toEqual({ scanned: 0, processed: 0, failed: 0, retried: 0, skipped: 0 });
    expect(stubs.ingestion.redriveStrandedWebhookEvent).not.toHaveBeenCalled();
  });

  it("aggregates every outcome type into the matching summary bucket", async () => {
    const stubs = makeStubs([ROW_A, ROW_B, ROW_C]);
    (stubs.ingestion.redriveStrandedWebhookEvent as jest.Mock)
      .mockResolvedValueOnce({ id: "wh-a", outcome: "processed" })
      .mockResolvedValueOnce({ id: "wh-b", outcome: "failed" })
      .mockResolvedValueOnce({ id: "wh-c", outcome: "retry" });
    const service = new ConnectorWebhookLeaseSweeperService(stubs.prismaDirect, stubs.ingestion);

    const summary = await service.runSweep();

    expect(summary).toEqual({ scanned: 3, processed: 1, failed: 1, retried: 1, skipped: 0 });
  });

  it("counts a 'skipped' outcome from the ingestion service correctly", async () => {
    const stubs = makeStubs([ROW_A]);
    (stubs.ingestion.redriveStrandedWebhookEvent as jest.Mock).mockResolvedValue({ id: "wh-a", outcome: "skipped" });
    const service = new ConnectorWebhookLeaseSweeperService(stubs.prismaDirect, stubs.ingestion);

    const summary = await service.runSweep();

    expect(summary.skipped).toBe(1);
  });

  it("isolates one row's redrive failure as skipped — the rest of the batch still gets processed", async () => {
    const stubs = makeStubs([ROW_A, ROW_B]);
    (stubs.ingestion.redriveStrandedWebhookEvent as jest.Mock)
      .mockRejectedValueOnce(new Error("db timeout"))
      .mockResolvedValueOnce({ id: "wh-b", outcome: "processed" });
    const service = new ConnectorWebhookLeaseSweeperService(stubs.prismaDirect, stubs.ingestion);

    const summary = await service.runSweep();

    expect(summary).toEqual({ scanned: 2, processed: 1, failed: 0, retried: 0, skipped: 1 });
  });

  it("is single-flight: a sweep already running skips a concurrent second call entirely", async () => {
    const stubs = makeStubs([ROW_A]);
    (stubs.ingestion.redriveStrandedWebhookEvent as jest.Mock).mockResolvedValue({ id: "wh-a", outcome: "processed" });
    const service = new ConnectorWebhookLeaseSweeperService(stubs.prismaDirect, stubs.ingestion);

    const firstRun = service.runSweep();
    const secondSummary = await service.runSweep();

    // The single-flight guard is set synchronously before the first await, so the second
    // call reliably observes it already set and returns a zeroed summary without scanning.
    expect(secondSummary).toEqual({ scanned: 0, processed: 0, failed: 0, retried: 0, skipped: 0 });
    expect(stubs.prismaDirect.getClient).toHaveBeenCalledTimes(1);

    await firstRun;
  });

  it("scopes the scan to a single tenant when tenantKey is provided (deterministic-test path)", async () => {
    const stubs = makeStubs([ROW_A]);
    (stubs.ingestion.redriveStrandedWebhookEvent as jest.Mock).mockResolvedValue({ id: "wh-a", outcome: "processed" });
    const service = new ConnectorWebhookLeaseSweeperService(stubs.prismaDirect, stubs.ingestion);

    await service.runSweep({ tenantKey: "tenant-a" });

    expect(stubs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantKey: "tenant-a" }) }),
    );
  });

  it("passes a caller-supplied batchSize and maxAttempts through instead of the env-configured defaults", async () => {
    const stubs = makeStubs([ROW_A]);
    (stubs.ingestion.redriveStrandedWebhookEvent as jest.Mock).mockResolvedValue({ id: "wh-a", outcome: "processed" });
    const service = new ConnectorWebhookLeaseSweeperService(stubs.prismaDirect, stubs.ingestion);

    await service.runSweep({ batchSize: 7, maxAttempts: 2 });

    expect(stubs.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 7 }));
    expect(stubs.ingestion.redriveStrandedWebhookEvent).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 2 }),
    );
  });
});
