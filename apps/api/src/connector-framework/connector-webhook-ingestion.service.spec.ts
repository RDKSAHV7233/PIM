// Coverage for ConnectorWebhookIngestionService — zero test coverage before,
// despite implementing the exact-once dedup/reservation and crash-recovery
// (lease redrive) logic for every inbound connector webhook (WooCommerce,
// Shopify order/product update events). The per-connector HMAC signature
// verification itself is already tested (shopify.connector.spec.ts,
// woocommerce.connector.spec.ts) — this covers what sits behind that: does a
// duplicate delivery of the same event actually get deduped, does a stalled
// in-flight event correctly get picked back up, and does a genuinely
// still-in-flight event get left alone rather than double-processed.
//
// The one thing this can't unit-test is the real Postgres advisory lock
// (pg_advisory_xact_lock) reserveWebhookEvent() takes — that's a native DB
// primitive with no meaningful mock. Everything downstream of "the lock was
// acquired" (the branch logic on existing row state) is covered here.

import { ConnectorWebhookIngestionService } from "./connector-webhook-ingestion.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { ConnectorRegistry } from "./connector.registry";
import type { LoggerService } from "../common/logging/logger.service";
import type { ParsedWebhookEvent } from "./connector.interface";

// Minimal Prisma atomic-operator support ({ increment: N }) so a mock update
// actually mutates numeric fields the way real Prisma would, instead of
// stamping the operator object itself onto the field.
function applyPrismaData(row: any, data: Record<string, any>) {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === "object" && "increment" in value) {
      row[key] = (row[key] ?? 0) + value.increment;
    } else {
      row[key] = value;
    }
  }
}

function makeParsedEvent(overrides: Partial<ParsedWebhookEvent> = {}): ParsedWebhookEvent {
  return {
    eventType: "order.updated",
    rawEventId: "evt-1",
    channelErrors: [],
    ...overrides,
  };
}

function makeStubs(existingWebhookRow: any = null) {
  const webhookRows = new Map<string, any>();
  if (existingWebhookRow) {
    webhookRows.set(existingWebhookRow.id, existingWebhookRow);
  }
  const submissionRows = new Map<string, any>();

  const txConnectorWebhookEvent = {
    findFirst: jest.fn().mockImplementation(({ where }: any) => {
      if (where.id) {
        const row = webhookRows.get(where.id);
        return Promise.resolve(row && row.tenantKey === where.tenantKey ? row : null);
      }
      for (const row of webhookRows.values()) {
        if (row.tenantKey === where.tenantKey && row.installationId === where.installationId && row.externalEventId === where.externalEventId) {
          return Promise.resolve(row);
        }
      }
      return Promise.resolve(null);
    }),
    update: jest.fn().mockImplementation(({ where, data }: any) => {
      const row = webhookRows.get(where.id);
      applyPrismaData(row, data);
      return Promise.resolve(row);
    }),
    create: jest.fn().mockImplementation(({ data }: any) => {
      webhookRows.set(data.id, { ...data });
      return Promise.resolve({ id: data.id });
    }),
    updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
      const row = webhookRows.get(where.id);
      if (!row) return Promise.resolve({ count: 0 });
      if (typeof where.processingStatus === "string" && row.processingStatus !== where.processingStatus) {
        return Promise.resolve({ count: 0 });
      }
      if (where.processingStatus?.in && !where.processingStatus.in.includes(row.processingStatus)) {
        return Promise.resolve({ count: 0 });
      }
      if (where.externalEventId && row.externalEventId !== where.externalEventId) {
        return Promise.resolve({ count: 0 });
      }
      if (where.processingLeaseUntil?.lt && !(row.processingLeaseUntil < where.processingLeaseUntil.lt)) {
        return Promise.resolve({ count: 0 });
      }
      applyPrismaData(row, data);
      return Promise.resolve({ count: 1 });
    }),
  };

  const txConnectorSubmission = {
    findFirst: jest.fn().mockImplementation(({ where }: any) => {
      for (const row of submissionRows.values()) {
        if (row.externalRef === where.externalRef) return Promise.resolve(row);
      }
      return Promise.resolve(null);
    }),
    updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
      const row = submissionRows.get(where.id);
      if (row) Object.assign(row, data);
      return Promise.resolve({ count: row ? 1 : 0 });
    }),
  };

  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(undefined),
    // RLS-BYPASS: manual tenant filter — stub only, mirrors the real tenantRaw() call this mock stands in for.
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    connectorWebhookEvent: txConnectorWebhookEvent,
    connectorSubmission: txConnectorSubmission,
  };

  const tenantClient = {
    connectorInstallation: {
      findFirst: jest.fn().mockResolvedValue({ id: "install-1", tenantKey: "tenant-a", connectorId: "def-1" }),
    },
    connectorDefinition: {
      findUnique: jest.fn().mockResolvedValue({ slug: "woocommerce" }),
    },
    connectorWebhookEvent: txConnectorWebhookEvent,
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };

  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) } as unknown as PrismaService;
  const logger = { info: jest.fn(), warn: jest.fn() } as unknown as LoggerService;

  return { prisma, logger, webhookRows, submissionRows, txConnectorWebhookEvent, txConnectorSubmission };
}

function makeRegistry(connector: any) {
  return { getConnector: jest.fn().mockReturnValue(connector) } as unknown as ConnectorRegistry;
}

describe("ConnectorWebhookIngestionService.ingest — exact-once dedup (no prior coverage)", () => {
  it("rejects without persisting anything when the connector's own signature check returns null", async () => {
    const stubs = makeStubs();
    const connector = {
      capabilities: ["WEBHOOK_RECEIVE"],
      requiresWebhookSignatureVerification: true,
      parseWebhookEvent: jest.fn().mockResolvedValue(null),
    };
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);

    const result = await service.ingest({
      tenantKey: "tenant-a",
      installationId: "install-1",
      rawBody: Buffer.from("{}"),
      headers: {},
    });

    expect(result).toEqual({ accepted: false, duplicate: false, reason: "invalid_signature_or_payload" });
    expect(stubs.webhookRows.size).toBe(0);
  });

  it("rejects cleanly when the connector doesn't support webhook parsing at all", async () => {
    const stubs = makeStubs();
    const connector = { capabilities: [] };
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);

    const result = await service.ingest({
      tenantKey: "tenant-a",
      installationId: "install-1",
      rawBody: Buffer.from("{}"),
      headers: {},
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("does not support webhook parsing");
  });

  it("accepts a fresh event: reserves it, processes it, and marks it processed", async () => {
    const stubs = makeStubs();
    const connector = {
      capabilities: ["WEBHOOK_RECEIVE"],
      requiresWebhookSignatureVerification: true,
      parseWebhookEvent: jest.fn().mockResolvedValue(makeParsedEvent()),
    };
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);

    const result = await service.ingest({
      tenantKey: "tenant-a",
      installationId: "install-1",
      rawBody: Buffer.from('{"id":1}'),
      headers: {},
    });

    expect(result.accepted).toBe(true);
    expect(result.duplicate).toBe(false);
    const row = [...stubs.webhookRows.values()][0];
    expect(row.processingStatus).toBe("processed");
    expect(row.processedAt).toBeInstanceOf(Date);
  });

  it("treats a fully processed duplicate delivery as a no-op duplicate, not a reprocess", async () => {
    const stubs = makeStubs({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      externalEventId: "evt-1",
      processedAt: new Date(),
      processingStatus: "processed",
      processingLeaseUntil: null,
    });
    const connector = {
      capabilities: ["WEBHOOK_RECEIVE"],
      requiresWebhookSignatureVerification: true,
      parseWebhookEvent: jest.fn().mockResolvedValue(makeParsedEvent()),
    };
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);

    const result = await service.ingest({
      tenantKey: "tenant-a",
      installationId: "install-1",
      rawBody: Buffer.from("{}"),
      headers: {},
    });

    expect(result).toMatchObject({ accepted: true, duplicate: true, reason: "processed" });
    expect(stubs.txConnectorSubmission.updateMany).not.toHaveBeenCalled();
  });

  it("treats a still-in-flight event (unexpired lease) as duplicate — never double-processes concurrently", async () => {
    const stubs = makeStubs({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      externalEventId: "evt-1",
      processedAt: null,
      processingStatus: "processing",
      processingLeaseUntil: new Date(Date.now() + 60_000),
    });
    const connector = {
      capabilities: ["WEBHOOK_RECEIVE"],
      requiresWebhookSignatureVerification: true,
      parseWebhookEvent: jest.fn().mockResolvedValue(makeParsedEvent()),
    };
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);

    const result = await service.ingest({
      tenantKey: "tenant-a",
      installationId: "install-1",
      rawBody: Buffer.from("{}"),
      headers: {},
    });

    expect(result).toMatchObject({ duplicate: true, reason: "in_progress" });
  });

  it("re-processes a stale in-flight event whose lease already expired (crash recovery), not a duplicate", async () => {
    const stubs = makeStubs({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      externalEventId: "evt-1",
      processedAt: null,
      processingStatus: "processing",
      processingLeaseUntil: new Date(Date.now() - 60_000), // expired
    });
    const connector = {
      capabilities: ["WEBHOOK_RECEIVE"],
      requiresWebhookSignatureVerification: true,
      parseWebhookEvent: jest.fn().mockResolvedValue(makeParsedEvent()),
    };
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);

    const result = await service.ingest({
      tenantKey: "tenant-a",
      installationId: "install-1",
      rawBody: Buffer.from("{}"),
      headers: {},
    });

    expect(result.duplicate).toBe(false);
    expect(result.accepted).toBe(true);
  });

  it("marks the event failed and rethrows when processing throws after reservation", async () => {
    const stubs = makeStubs();
    const connector = {
      capabilities: ["WEBHOOK_RECEIVE"],
      requiresWebhookSignatureVerification: true,
      parseWebhookEvent: jest.fn().mockResolvedValue(makeParsedEvent({ externalRef: "ref-does-not-matter" })),
    };
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);
    // Force the second transaction (processReservedWebhookEvent, which looks up and
    // updates the submission) to throw partway through.
    stubs.txConnectorSubmission.findFirst.mockRejectedValue(new Error("boom"));

    await expect(
      service.ingest({ tenantKey: "tenant-a", installationId: "install-1", rawBody: Buffer.from("{}"), headers: {} }),
    ).rejects.toThrow("boom");

    const row = [...stubs.webhookRows.values()][0];
    expect(row.processingStatus).toBe("failed");
    expect(row.lastError).toBe("boom");
  });
});

describe("ConnectorWebhookIngestionService.redriveStrandedWebhookEvent — crash recovery (no prior coverage)", () => {
  it("skips a row that isn't actually eligible (lease not expired — already being handled elsewhere)", async () => {
    const stubs = makeStubs({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      externalEventId: "evt-1",
      processingStatus: "processing",
      processingLeaseUntil: new Date(Date.now() + 60_000), // not expired
    });
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry({}), stubs.logger);

    const result = await service.redriveStrandedWebhookEvent({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      maxAttempts: 5,
    });

    expect(result).toEqual({ id: "wh-1", outcome: "skipped" });
  });

  it("retries (doesn't fail) a redrive below the attempt cap when the connector can't replay a stored event", async () => {
    const stubs = makeStubs({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      externalEventId: "evt-1",
      eventType: "order.updated",
      payload: {},
      processingStatus: "received",
      processingAttemptCount: 1,
      processingLeaseUntil: new Date(Date.now() - 60_000),
    });
    const connector = { capabilities: ["WEBHOOK_RECEIVE"] }; // no parseStoredWebhookEvent
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);

    const result = await service.redriveStrandedWebhookEvent({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      maxAttempts: 5,
    });

    expect(result).toEqual({ id: "wh-1", outcome: "retry" });
    const row = stubs.webhookRows.get("wh-1");
    expect(row.processingStatus).toBe("received");
  });

  it("parks the row as permanently failed once the attempt cap is reached", async () => {
    const stubs = makeStubs({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      externalEventId: "evt-1",
      eventType: "order.updated",
      payload: {},
      processingStatus: "received",
      processingAttemptCount: 4, // will become 5 on acquire, equal to maxAttempts
      processingLeaseUntil: new Date(Date.now() - 60_000),
    });
    const connector = { capabilities: ["WEBHOOK_RECEIVE"] }; // still can't replay
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);

    const result = await service.redriveStrandedWebhookEvent({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      maxAttempts: 5,
    });

    expect(result).toEqual({ id: "wh-1", outcome: "failed" });
    const row = stubs.webhookRows.get("wh-1");
    expect(row.processingStatus).toBe("failed");
  });

  it("successfully re-processes a stranded event once the connector can replay it from stored state", async () => {
    const stubs = makeStubs({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      externalEventId: "evt-1",
      eventType: "order.updated",
      payload: { id: 1 },
      processingStatus: "received",
      processingAttemptCount: 1,
      processingLeaseUntil: new Date(Date.now() - 60_000),
    });
    const connector = {
      capabilities: ["WEBHOOK_RECEIVE"],
      parseStoredWebhookEvent: jest.fn().mockReturnValue(makeParsedEvent()),
    };
    const service = new ConnectorWebhookIngestionService(stubs.prisma, makeRegistry(connector), stubs.logger);

    const result = await service.redriveStrandedWebhookEvent({
      id: "wh-1",
      tenantKey: "tenant-a",
      installationId: "install-1",
      maxAttempts: 5,
    });

    expect(result).toEqual({ id: "wh-1", outcome: "processed" });
    expect(stubs.webhookRows.get("wh-1").processingStatus).toBe("processed");
  });
});
