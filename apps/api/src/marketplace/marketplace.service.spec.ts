import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ExportJobStatus } from "@prisma/client";
import { UnrecoverableError } from "bullmq";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { MarketplaceService } from "./marketplace.service";

function makeService(productOverride?: Record<string, unknown>) {
  const product = productOverride ?? {
    id: "prod1",
    status: "approved",
    categoryId: "cat1",
    brand: "TestBrand",
  };

  const prisma = {
    tenant: jest.fn().mockReturnValue({
      product: {
        findUnique: jest.fn().mockResolvedValue(product),
        update: jest.fn().mockResolvedValue(product),
      },
      marketplaceExportJob: {
        create: jest.fn().mockResolvedValue({ id: "job1" }),
      },
    }),
  };

  const connectorFramework = {
    getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    requireInstallation: jest.fn().mockResolvedValue({
      slug: "flipkart",
      capabilities: ["PUBLISH", "VALIDATE"],
    }),
  };

  const connectorRegistry = {
    get: jest.fn(),
    list: jest.fn().mockReturnValue([]),
  };

  const planUsageService = {
    assertExportJobQuota: jest.fn().mockResolvedValue(undefined),
    recordExportJobUsage: jest.fn().mockResolvedValue(undefined),
  };

  const queueService = {
    enqueueExportJob: jest.fn().mockResolvedValue(undefined),
  };

  const metricsService = {
    recordExportEvent: jest.fn(),
  };

  const connectorMappingService = {
    evaluateConnectorPublishReadiness: jest.fn().mockResolvedValue({ ok: true, blockers: [], warnings: [] }),
  };

  const notificationsService = {
    notifyExportJobCreated: jest.fn().mockResolvedValue(undefined),
  };

  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  const accessPolicy = {
    assertSensitivePayloadAccessAllowed: jest.fn().mockResolvedValue(undefined),
    assertProductAccess: jest.fn().mockResolvedValue(undefined),
    assertChannelAccess: jest.fn().mockResolvedValue(undefined),
  };

  const mediaStorage = {
    isLocalMode: jest.fn().mockReturnValue(false),
  };

  return new MarketplaceService(
    prisma as never,
    connectorFramework as never,
    connectorRegistry as never,
    planUsageService as never,
    queueService as never,
    metricsService as never,
    connectorMappingService as never,
    notificationsService as never,
    logger as never,
    accessPolicy as never,
    { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
    mediaStorage as never,
  );
}

describe("MarketplaceService.createExportJob — approval gate", () => {
  const dto = { channel: "flipkart", fallbackAcknowledged: false };

  it("does not throw approval gate error when product is approved", async () => {
    const svc = makeService({ id: "p1", status: "approved", categoryId: "cat1", brand: "B" });
    // Approved products pass the gate — any subsequent error is a deeper mock gap, not approval policy
    const error = await svc.createExportJob("p1", dto as never).catch((e: unknown) => e);
    if (error instanceof Error) {
      expect(error.message).not.toMatch(/must be approved/);
    }
  });

  it("does not throw approval gate error when product is active", async () => {
    const svc = makeService({ id: "p1", status: "active", categoryId: "cat1", brand: "B" });
    const error = await svc.createExportJob("p1", dto as never).catch((e: unknown) => e);
    if (error instanceof Error) {
      expect(error.message).not.toMatch(/must be approved/);
    }
  });

  it("blocks export when product is draft", async () => {
    const svc = makeService({ id: "p1", status: "draft", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(BadRequestException);
  });

  it("blocks export when product is in_review", async () => {
    const svc = makeService({ id: "p1", status: "in_review", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(BadRequestException);
  });

  it("blocks export when product is rejected", async () => {
    const svc = makeService({ id: "p1", status: "rejected", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(BadRequestException);
  });

  it("blocks export when product is archived", async () => {
    const svc = makeService({ id: "p1", status: "archived", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(BadRequestException);
  });

  it("error message includes current status", async () => {
    const svc = makeService({ id: "p1", status: "draft", categoryId: "cat1", brand: "B" });
    await expect(svc.createExportJob("p1", dto as never)).rejects.toThrow(
      /Current status: draft/,
    );
  });

  it("throws NotFoundException when product does not exist", async () => {
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        product: { findUnique: jest.fn().mockResolvedValue(null) },
      }),
    };
    const svc = new MarketplaceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { assertSensitivePayloadAccessAllowed: jest.fn().mockResolvedValue(undefined) } as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
    );
    await expect(svc.createExportJob("missing-id", dto as never)).rejects.toThrow(NotFoundException);
  });
});

describe("MarketplaceService.listChannels", () => {
  it("returns an array of channel objects", () => {
    const svc = makeService();
    const channels = svc.listChannels();
    expect(Array.isArray(channels)).toBe(true);
    expect(channels.length).toBeGreaterThan(0);
  });

  it("each channel has a channel field", () => {
    const svc = makeService();
    const channels = svc.listChannels();
    for (const ch of channels) {
      expect(ch).toHaveProperty("channel");
    }
  });
});

// ─── MarketplaceService.triggerConnectorExport ────────────────────────────────

describe("MarketplaceService.triggerConnectorExport", () => {
  const MOCK_EXPORT_FILE = {
    buffer: Buffer.from("xlsx"),
    filename: "meesho_kurtis_20260528.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };

  const MOCK_INSTALLATION_ROW = { id: "inst_1", connectorId: "conn_1", tenantKey: "tenant1" };

  // Shape returned by resolveInstallationWithSlug ($queryRaw JOIN result)
  const MOCK_RESOLVED_ROW = {
    id: "inst_1",
    connectorId: "conn_1",
    tenantKey: "tenant1",
    connectorSlug: "meesho",
    capabilities: [],
  };

  function makeExportService(installationRow: unknown = MOCK_INSTALLATION_ROW) {
    // resolveInstallationWithSlug uses $queryRaw; return [] when installationRow is null
    // (simulates missing installation → NotFoundException path)
    const queryRawResult = installationRow ? [MOCK_RESOLVED_ROW] : [];

    const tenantDb = {
      // $queryRaw is called by resolveInstallationWithSlug
      $queryRaw: jest.fn().mockResolvedValue(queryRawResult),
      connectorInstallation: {
        findFirst: jest.fn().mockResolvedValue(installationRow),
      },
      connectorDefinition: {
        findUnique: jest.fn().mockResolvedValue({ slug: "meesho" }),
      },
      product: {
        // product.findUnique used by buildConnectorProductPayload — spied away in happy-path tests
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const prisma = {
      tenant: jest.fn().mockReturnValue(tenantDb),
    };

    const connectorFramework = {
      getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireInstallation: jest.fn().mockResolvedValue({
        id: "inst_1",
        slug: "meesho",
        capabilities: ["VALIDATE", "EXCEL_EXPORT"],
      }),
      exportProducts: jest.fn().mockResolvedValue(MOCK_EXPORT_FILE),
    };

    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { assertSensitivePayloadAccessAllowed: jest.fn().mockResolvedValue(undefined) } as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
    );

    return { svc, prisma, connectorFramework, tenantDb };
  }

  it("throws BadRequestException when productIds is empty", async () => {
    const { svc } = makeExportService();
    await expect(svc.triggerConnectorExport("inst_1", [])).rejects.toThrow(BadRequestException);
  });

  it("error message mentions productIds when empty", async () => {
    const { svc } = makeExportService();
    await expect(svc.triggerConnectorExport("inst_1", [])).rejects.toThrow(/productIds/);
  });

  it("throws NotFoundException when installation row is not found", async () => {
    const { svc } = makeExportService(null /* no installation row */);
    await expect(svc.triggerConnectorExport("missing_inst", ["p1"])).rejects.toThrow(NotFoundException);
  });

  it("returns buffer, filename, and mimeType from connectorFramework.exportProducts", async () => {
    const { svc, connectorFramework } = makeExportService();
    // Bypass the complex buildConnectorProductPayload internal DB chain
    jest.spyOn(svc as unknown as Record<string, jest.Mock>, "buildConnectorProductPayload")
      .mockResolvedValue({ sku: "SKU-001", title: "Test Kurti", mrp: 999, sellingPrice: 799, productType: "kurtis" });

    const result = await svc.triggerConnectorExport("inst_1", ["prod_1"]);
    expect(result.buffer).toEqual(MOCK_EXPORT_FILE.buffer);
    expect(result.filename).toBe(MOCK_EXPORT_FILE.filename);
    expect(result.mimeType).toBe(MOCK_EXPORT_FILE.mimeType);
    expect(connectorFramework.exportProducts).toHaveBeenCalledTimes(1);
  });

  it("passes resolved installation record and mapped products to exportProducts", async () => {
    const { svc, connectorFramework } = makeExportService();
    const fakePayload = { sku: "SKU-001", title: "Test Kurti", mrp: 999, sellingPrice: 799, productType: "kurtis" };
    jest.spyOn(svc as unknown as Record<string, jest.Mock>, "buildConnectorProductPayload")
      .mockResolvedValue(fakePayload);

    await svc.triggerConnectorExport("inst_1", ["p1", "p2"]);

    expect(connectorFramework.exportProducts).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "meesho", capabilities: expect.arrayContaining(["EXCEL_EXPORT"]) }),
      [fakePayload, fakePayload],
    );
  });
});

// ─── MarketplaceService.triggerBulkPublish — F-4 approval/readiness gate ──────

// Bulk-Publish Goes Async, Story 3/4: minimal in-memory fake for the two new Prisma
// models (MarketplaceBulkPublishRun/RunItem) — enough of create/findUnique/update/
// findMany/updateMany/groupBy behavior for createBulkPublishRun + processBulkPublishRun
// to run against for real, the same "real pipeline, fake DB" approach
// makeRealExportPipelineService already uses for the export-job tables above.
function makeBulkPublishRunStore() {
  const runs = new Map<string, Record<string, unknown>>();
  const items = new Map<string, Record<string, unknown>>();
  let seq = 0;

  const run = {
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      const id = `run_${++seq}`;
      const { items: itemsInput, ...runFields } = data as { items?: { create?: Array<Record<string, unknown>> } };
      const row = { id, ...runFields };
      runs.set(id, row);
      for (const itemData of itemsInput?.create ?? []) {
        const itemId = `item_${++seq}`;
        items.set(itemId, { id: itemId, runId: id, attemptCount: 0, retryEligible: true, ...itemData });
      }
      return Promise.resolve(row);
    }),
    findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) => Promise.resolve(runs.get(id) ?? null)),
    update: jest.fn(({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const existing = runs.get(id);
      if (!existing) return Promise.resolve(null);
      const merged = { ...existing };
      for (const [key, value] of Object.entries(data)) {
        merged[key] =
          value && typeof value === "object" && "increment" in (value as Record<string, unknown>)
            ? Number(existing[key] ?? 0) + Number((value as { increment: number }).increment)
            : value;
      }
      runs.set(id, merged);
      return Promise.resolve(merged);
    }),
  };

  const item = {
    findMany: jest.fn(({ where }: { where: { runId: string; status?: string } }) =>
      Promise.resolve(
        [...items.values()].filter(
          (row) => row.runId === where.runId && (where.status === undefined || row.status === where.status),
        ),
      ),
    ),
    updateMany: jest.fn(({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
      const existing = items.get(where.id);
      if (!existing || (where.status !== undefined && existing.status !== where.status)) {
        return Promise.resolve({ count: 0 });
      }
      items.set(where.id, { ...existing, ...data });
      return Promise.resolve({ count: 1 });
    }),
    update: jest.fn(({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const existing = items.get(id);
      if (!existing) return Promise.resolve(null);
      const merged = { ...existing };
      for (const [key, value] of Object.entries(data)) {
        merged[key] =
          value && typeof value === "object" && "increment" in (value as Record<string, unknown>)
            ? Number(existing[key] ?? 0) + Number((value as { increment: number }).increment)
            : value;
      }
      items.set(id, merged);
      return Promise.resolve(merged);
    }),
    groupBy: jest.fn(({ where }: { where: { runId: string } }) => {
      const counts = new Map<string, number>();
      for (const row of items.values()) {
        if (row.runId !== where.runId) continue;
        const status = String(row.status);
        counts.set(status, (counts.get(status) ?? 0) + 1);
      }
      return Promise.resolve([...counts.entries()].map(([status, count]) => ({ status, _count: { status: count } })));
    }),
  };

  return { marketplaceBulkPublishRun: run, marketplaceBulkPublishRunItem: item, runs, items };
}

// Bulk-Publish Goes Async, Story 3/4: triggerBulkPublish's return type is now a union
// (synchronous Amazon-native result vs. queued async run) — these narrow it for tests
// that know statically which branch their fixture takes, instead of `as any`-casting
// at every call site.
type BulkPublishSyncResult = { feedId: string; feedDocumentId: string; productCount: number; submissionIds: string[]; excluded: Array<{ productId: string; reason: string }> };
type BulkPublishAsyncResult = { async: true; runId: string; status: "queued"; requestedCount: number; excludedCount: number; excluded: Array<{ productId: string; reason: string }> };
function expectSyncResult(result: BulkPublishSyncResult | BulkPublishAsyncResult): BulkPublishSyncResult {
  if ("async" in result) throw new Error("expected a synchronous bulk-publish result, got an async run");
  return result;
}
function expectAsyncResult(result: BulkPublishSyncResult | BulkPublishAsyncResult): BulkPublishAsyncResult {
  if (!("async" in result)) throw new Error("expected an async bulk-publish run, got a synchronous result");
  return result;
}

describe("MarketplaceService.triggerBulkPublish — approval/readiness gate", () => {
  const MOCK_RESOLVED_ROW = {
    id: "inst_1",
    connectorId: "conn_1",
    tenantKey: "tenant1",
    connectorSlug: "amazon",
    capabilities: [],
  };

  function makeBulkPublishService(
    productsById: Record<string, { status: string; categoryId: string }>,
    options: { connectorSlug?: string; capabilities?: string[] } = {},
  ) {
    const connectorSlug = options.connectorSlug ?? "amazon";
    const capabilities = options.capabilities ?? ["BULK_PUBLISH"];
    const bulkPublishRunStore = makeBulkPublishRunStore();

    const tenantDb = {
      $queryRaw: jest.fn().mockResolvedValue([{ ...MOCK_RESOLVED_ROW, connectorSlug }]),
      product: {
        findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
          Promise.resolve(productsById[id] ? { id, ...productsById[id] } : null),
        ),
        findMany: jest.fn(({ where: { id } }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            id.in.filter((productId) => productsById[productId]).map((productId) => ({ id: productId, ...productsById[productId] })),
          ),
        ),
      },
      connectorSubmission: {
        upsert: jest.fn(({ create }: { create: { id?: string } }) =>
          Promise.resolve({ id: `sub_${create.id ?? Math.random()}` }),
        ),
      },
      ...bulkPublishRunStore,
    };

    const prisma = { tenant: jest.fn().mockReturnValue(tenantDb) };

    const connectorFramework = {
      getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireInstallation: jest.fn().mockResolvedValue({ id: "inst_1", slug: connectorSlug, capabilities }),
      publishBulk: jest.fn().mockImplementation((_installation: unknown, products: unknown[]) =>
        Promise.resolve({
          feedId: "feed_1",
          feedDocumentId: "doc_1",
          productCount: products.length,
          skus: products.map((_p, i) => `SKU-${i}`),
        }),
      ),
    };

    const connectorMappingService = {
      evaluatePublishReadiness: jest.fn().mockResolvedValue({ ok: true, blockers: [], warnings: [] }),
    };

    // Default: never blocks. Tests that need to exercise the submissions plan-limit
    // preflight override this per-case (see the nested describe block below).
    const planUsageService = {
      checkLimit: jest.fn().mockResolvedValue({ allowed: true, resource: "submissions", limit: 999999, current: 0 }),
    };

    const queueService = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      planUsageService as never,
      queueService as never,
      {} as never,
      connectorMappingService as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      { assertSensitivePayloadAccessAllowed: jest.fn().mockResolvedValue(undefined) } as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
    );
    jest.spyOn(svc as unknown as Record<string, jest.Mock>, "buildConnectorProductPayload")
      .mockImplementation((id: unknown) => Promise.resolve({ sku: `SKU-${id}`, title: "T", mrp: 1, sellingPrice: 1 }));

    return { svc, connectorFramework, connectorMappingService, tenantDb, planUsageService, queueService, bulkPublishRunStore };
  }

  // Builds a service where createExportJob runs for real (not spied away), with a
  // behaviorally-realistic access-policy double instead of the blanket-allow stub used
  // above. #550 escaped the existing suite specifically because every test spied over
  // createExportJob entirely (bypassing its actor/permission check) or stubbed
  // assertSensitivePayloadAccessAllowed to unconditionally resolve — so a broken actor
  // could never surface as a failure. This harness exists to make that class of
  // regression observable again.
  function makeRealExportPipelineService(
    productsById: Record<string, { status: string; categoryId: string }>,
    options: { connectorSlug?: string; capabilities?: string[] } = {},
  ) {
    const connectorSlug = options.connectorSlug ?? "shopify";
    const capabilities = options.capabilities ?? ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"];
    const bulkPublishRunStore = makeBulkPublishRunStore();

    const tenantDb = {
      $queryRaw: jest.fn().mockResolvedValue([{ ...MOCK_RESOLVED_ROW, connectorSlug }]),
      product: {
        findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
          Promise.resolve(productsById[id] ? { id, version: 1, updatedAt: new Date("2026-01-01"), brand: "B", ...productsById[id] } : null),
        ),
        findMany: jest.fn(({ where: { id } }: { where: { id: { in: string[] } } }) =>
          Promise.resolve(
            id.in.filter((productId) => productsById[productId]).map((productId) => ({ id: productId, ...productsById[productId] })),
          ),
        ),
      },
      connectorSubmission: {
        upsert: jest.fn(({ create }: { create: { id?: string } }) =>
          Promise.resolve({ id: `sub_${create.id ?? Math.random()}` }),
        ),
      },
      marketplaceExportJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: { data: { productId: string } }) =>
          Promise.resolve({ id: `job_${data.productId}`, retryCount: 0 }),
        ),
      },
      ...bulkPublishRunStore,
    };

    const prisma = { tenant: jest.fn().mockReturnValue(tenantDb) };

    const connectorFramework = {
      getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireInstallation: jest.fn().mockResolvedValue({ id: "inst_1", slug: connectorSlug, capabilities }),
    };

    const connectorMappingService = {
      evaluatePublishReadiness: jest.fn().mockResolvedValue({ ok: true, blockers: [], warnings: [] }),
      assertPublishReadyForExport: jest.fn().mockResolvedValue(undefined),
    };

    // Mirrors the real AccessPolicyService.canExportToMarketplace gate (admin/publisher/
    // channel_manager only) instead of unconditionally allowing every actor — the one
    // check #550 broke. Throws ForbiddenException, matching the real deny() helper
    // (access-policy.service.ts) exactly, since Bulk-Publish Goes Async's worker
    // (processBulkPublishRun) classifies exceptions by type to decide excluded-vs-failed.
    const accessPolicy = {
      assertSensitivePayloadAccessAllowed: jest.fn(
        async (actor: { actorRole?: string } | undefined, opts: { action: string }) => {
          if (opts.action !== "marketplace.export") return;
          const role = String(actor?.actorRole ?? "").trim().toLowerCase();
          if (role === "admin" || role === "publisher" || role === "channel_manager") return;
          throw new ForbiddenException("SENSITIVE_PAYLOAD_RESTRICTED: marketplace.export denied for this actor");
        },
      ),
      assertProductAccess: jest.fn().mockResolvedValue(undefined),
      assertChannelAccess: jest.fn().mockResolvedValue(undefined),
    };

    const errorCaptureService = { captureUnexpected: jest.fn().mockResolvedValue(undefined) };

    const planUsageService = {
      checkLimit: jest.fn().mockResolvedValue({ allowed: true, resource: "submissions", limit: 999999, current: 0 }),
    };

    const queueService = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      planUsageService as never,
      queueService as never,
      {} as never,
      connectorMappingService as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      accessPolicy as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
      errorCaptureService as never,
    );
    jest.spyOn(svc as unknown as Record<string, jest.Mock>, "simulateProduct").mockResolvedValue({
      channel: connectorSlug,
      templateId: undefined,
      mappingSource: "default",
      missingFields: [],
      complianceSummary: {},
      mappedPayload: { sku: "SKU-x" },
    });
    jest.spyOn(svc as unknown as Record<string, jest.Mock>, "enqueueExportJobForExecution").mockResolvedValue(undefined);
    jest.spyOn(svc as unknown as Record<string, jest.Mock>, "buildConnectorProductPayload")
      .mockImplementation((id: unknown) => Promise.resolve({ sku: `SKU-${id}`, title: "T", mrp: 1, sellingPrice: 1 }));

    return { svc, tenantDb, connectorMappingService, errorCaptureService, planUsageService, queueService, bulkPublishRunStore };
  }

  // #550: bulkPublishViaQueuedExportJobs called createExportJob(productId, dto, undefined)
  // — dropping the actor entirely — so every product was denied by the real permission
  // check regardless of readiness. Wiring-level tests that spy over createExportJob (like
  // "falls back to queued per-product export jobs" above) can verify the argument is
  // passed correctly, but can't prove the *consequence* of dropping it, since they never
  // let the real check run. This test does, with a behaviorally-realistic access-policy
  // double: it is the concrete regression guard for the invariant that a batch of
  // genuinely ready products must never come back fully excluded.
  it("never returns an all-excluded result for an all-ready Shopify batch with a valid actor (regression guard for #550)", async () => {
    const { svc, queueService, bulkPublishRunStore } = makeRealExportPipelineService({
      "a1": { status: "approved", categoryId: "cat1" },
      "a2": { status: "active", categoryId: "cat1" },
    });
    const actor = { actorId: "user_1", actorRole: "publisher" as const, tenantId: "tenant1" };

    // Bulk-Publish Goes Async, Story 3: for a non-native connector this now only queues
    // a run — the approval-status excludes still happen synchronously (asserted below),
    // but the actor/access-policy check #550 regression-guards moved into the worker
    // (processBulkPublishRun), so this test runs that worker directly against the
    // payload triggerBulkPublish actually enqueued, same as production would.
    const result = expectAsyncResult(await svc.triggerBulkPublish("inst_1", ["a1", "a2"], actor));
    expect(result.requestedCount).toBe(2);
    expect(result.excluded).toHaveLength(0);

    const payload = queueService.enqueue.mock.calls[0][1];
    await (svc as unknown as { processBulkPublishRun: (p: unknown) => Promise<void> }).processBulkPublishRun(payload);

    const items = [...bulkPublishRunStore.items.values()];
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.status === "succeeded")).toBe(true);
  });

  it("returns an all-excluded result when the actor is missing, even though every product is ready — proves the guard above is meaningful", async () => {
    const { svc, queueService, bulkPublishRunStore } = makeRealExportPipelineService({
      "a1": { status: "approved", categoryId: "cat1" },
      "a2": { status: "active", categoryId: "cat1" },
    });

    // The approval-status-only preflight can't see the missing-actor problem — both
    // products are still eligible at queue time. The access-policy denial only surfaces
    // once the worker actually calls createExportJob per item.
    const result = expectAsyncResult(await svc.triggerBulkPublish("inst_1", ["a1", "a2"], undefined));
    expect(result.excluded).toHaveLength(0);

    const payload = queueService.enqueue.mock.calls[0][1];
    await (svc as unknown as { processBulkPublishRun: (p: unknown) => Promise<void> }).processBulkPublishRun(payload);

    const items = [...bulkPublishRunStore.items.values()];
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.status === "excluded")).toBe(true);
    expect(items.every((item) => String(item.reason).includes("SENSITIVE_PAYLOAD_RESTRICTED"))).toBe(true);
  });

  // #554: the eligibility loop and createExportJob previously each independently fetched the
  // product and evaluated readiness for the same productId/connector/installation — twice the
  // DB round trips per product for no behavioral reason. This asserts the actual fix, not just
  // that wiring passes the right arguments: for an eligible product, product.findUnique and
  // evaluatePublishReadiness must each run exactly once per product across the whole bulk-publish
  // request, not twice.
  // PIM#655 — createExportJob's pre-flight connector validation runs in a try/catch that
  // only logged a warning on failure, with no path to Error Authority. This factory's
  // connectorFramework double has no `validate` method at all, so the pre-flight block
  // genuinely throws here (TypeError) exactly like a real broken pre-flight check would —
  // proving the capture call fires on a real exception, not a synthetic one.
  it("captures a pre-flight validation failure to Error Authority as a non-blocking warning (#655)", async () => {
    const { svc, errorCaptureService } = makeRealExportPipelineService({
      "a1": { status: "approved", categoryId: "cat1" },
    });
    const actor = { actorId: "user_1", actorRole: "publisher" as const, tenantId: "tenant1" };

    const job = await svc.createExportJob(
      "a1",
      { channel: "shopify", installationId: "inst_1", fallbackAcknowledged: false } as never,
      actor,
    );

    expect(job).toBeDefined(); // the job still gets created — pre-flight failure must not block it
    expect(errorCaptureService.captureUnexpected).toHaveBeenCalledTimes(1);
    const captureArgs = errorCaptureService.captureUnexpected.mock.calls[0][0] as { severity: string; category: string; routeTemplate: string };
    expect(captureArgs.severity).toBe("p3");
    expect(captureArgs.category).toBe("internal");
    expect(captureArgs.routeTemplate).toBe("marketplace:create-export-job:pre-flight-validation");
  });

  // Bulk-Publish Goes Async, Story 3/4 superseded the original #554 fix's premise for this
  // path: the old synchronous eligibility loop and createExportJob each independently
  // evaluated readiness/fetched the product, so #554 deduplicated that overlap. The async
  // run creation (createBulkPublishRun) does no per-product readiness check at all — only
  // a batched approval-status query — so there's no longer a second evaluation to dedupe
  // against here; each product is fetched/readiness-checked exactly once, inside
  // createExportJob, when the worker processes its item. (createExportJob's own internal
  // dedup between its product fetch and simulateProduct's — the other half of #554 — is
  // covered directly by the "Phase 655"/createExportJob-level tests, unaffected by this.)
  it("fetches and readiness-checks each product exactly once, inside the worker, not during run creation (#554)", async () => {
    const { svc, tenantDb, connectorMappingService, queueService, bulkPublishRunStore } = makeRealExportPipelineService({
      "a1": { status: "approved", categoryId: "cat1" },
      "a2": { status: "active", categoryId: "cat1" },
    });
    const actor = { actorId: "user_1", actorRole: "publisher" as const, tenantId: "tenant1" };

    const result = expectAsyncResult(await svc.triggerBulkPublish("inst_1", ["a1", "a2"], actor));
    expect(result.excluded).toHaveLength(0);
    // Run creation itself must not have fetched or readiness-checked any product yet —
    // only the batched approval-status query (product.findMany) runs at this point.
    expect(tenantDb.product.findUnique).not.toHaveBeenCalled();
    expect(connectorMappingService.assertPublishReadyForExport).not.toHaveBeenCalled();

    const payload = queueService.enqueue.mock.calls[0][1];
    await (svc as unknown as { processBulkPublishRun: (p: unknown) => Promise<void> }).processBulkPublishRun(payload);

    const items = [...bulkPublishRunStore.items.values()];
    expect(items.every((item) => item.status === "succeeded")).toBe(true);
    expect(connectorMappingService.assertPublishReadyForExport).toHaveBeenCalledTimes(2); // once per product, not 4
    expect(tenantDb.product.findUnique).toHaveBeenCalledTimes(2); // once per product, not 4-6
  });

  it("excludes a draft product and only submits the approved, ready one", async () => {
    const { svc, connectorFramework, connectorMappingService } = makeBulkPublishService({
      "draft-1": { status: "draft", categoryId: "cat1" },
      "approved-1": { status: "approved", categoryId: "cat1" },
    });
    connectorMappingService.evaluatePublishReadiness.mockResolvedValue({ ok: true, blockers: [], warnings: [] });

    const result = expectSyncResult(await svc.triggerBulkPublish("inst_1", ["draft-1", "approved-1"]));

    expect(result.submissionIds).toHaveLength(1);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].productId).toBe("draft-1");
    expect(result.excluded[0].reason).toMatch(/must be approved/i);
    expect(connectorFramework.publishBulk).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ sku: "SKU-approved-1" })]),
    );
    // the draft product's payload must never have been built or submitted
    expect(connectorFramework.publishBulk.mock.calls[0][1]).toHaveLength(1);
  });

  it("excludes an approved product that fails destination readiness", async () => {
    const { svc, connectorMappingService } = makeBulkPublishService({
      "approved-not-ready": { status: "approved", categoryId: "cat1" },
    });
    connectorMappingService.evaluatePublishReadiness.mockResolvedValue({
      ok: false,
      blockers: ["required_attribute_mapping_missing"],
      warnings: [],
    });

    await expect(svc.triggerBulkPublish("inst_1", ["approved-not-ready"])).rejects.toMatchObject({
      response: expect.objectContaining({ error: "no_eligible_products" }),
    });
  });

  it("submits all products when every one is approved and ready", async () => {
    const { svc, connectorFramework } = makeBulkPublishService({
      "a1": { status: "approved", categoryId: "cat1" },
      "a2": { status: "active", categoryId: "cat1" },
    });

    const result = expectSyncResult(await svc.triggerBulkPublish("inst_1", ["a1", "a2"]));

    expect(result.excluded).toHaveLength(0);
    expect(result.submissionIds).toHaveLength(2);
    expect(connectorFramework.publishBulk.mock.calls[0][1]).toHaveLength(2);
  });

  it("queues an async run for a connector without BULK_PUBLISH (Shopify), and the worker publishes each item via createExportJob", async () => {
    const { svc, connectorFramework, queueService, bulkPublishRunStore } = makeBulkPublishService(
      {
        "a1": { status: "approved", categoryId: "cat1" },
        "a2": { status: "active", categoryId: "cat1" },
      },
      { connectorSlug: "shopify", capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"] },
    );
    const createExportJobSpy = jest
      .spyOn(svc as unknown as Record<string, jest.Mock>, "createExportJob")
      .mockImplementation((productId: unknown) => Promise.resolve({ id: `job_${productId as string}` }));
    const actor = { actorId: "user_1", actorRole: "publisher" as const, tenantId: "tenant1" };

    const result = expectAsyncResult(await svc.triggerBulkPublish("inst_1", ["a1", "a2"], actor));

    // the Amazon feed path must never be invoked for a connector lacking BULK_PUBLISH
    expect(connectorFramework.publishBulk).not.toHaveBeenCalled();
    expect(result.excluded).toHaveLength(0);
    expect(result.requestedCount).toBe(2);
    expect(result.status).toBe("queued");

    const payload = queueService.enqueue.mock.calls[0][1] as { actor: unknown };
    // #550: the request actor must reach the worker's createExportJob call — payloads
    // enqueued without one caused every product to be denied by the real permission
    // check, which is exactly what made bulk publish 0% functional for Shopify/WooCommerce
    // in production.
    expect(payload.actor).toEqual(actor);
    await (svc as unknown as { processBulkPublishRun: (p: unknown) => Promise<void> }).processBulkPublishRun(payload);

    expect(createExportJobSpy).toHaveBeenCalledTimes(2);
    // Bulk-Publish Goes Async, Story 4: unlike the old synchronous fallback, the worker
    // calls createExportJob WITHOUT a precomputed product/readiness — a fresh re-check
    // after the async delay is correct here, since the product may have changed since
    // the run was requested.
    expect(createExportJobSpy).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({ channel: "shopify", installationId: "inst_1" }),
      actor,
    );
    const items = [...bulkPublishRunStore.items.values()];
    expect(items.every((item) => item.status === "succeeded")).toBe(true);
    expect(items.map((item) => item.exportJobId).sort()).toEqual(["job_a1", "job_a2"]);
  });

  it("excludes only the item whose export job fails, in the async Shopify worker", async () => {
    const { svc, queueService, bulkPublishRunStore } = makeBulkPublishService(
      {
        "ok-1": { status: "approved", categoryId: "cat1" },
        "bad-1": { status: "approved", categoryId: "cat1" },
      },
      { connectorSlug: "shopify", capabilities: [] },
    );
    jest
      .spyOn(svc as unknown as Record<string, jest.Mock>, "createExportJob")
      .mockImplementation((productId: unknown) => {
        if (productId === "bad-1") {
          return Promise.reject(new Error("readiness check failed"));
        }
        return Promise.resolve({ id: `job_${productId as string}` });
      });

    await svc.triggerBulkPublish("inst_1", ["ok-1", "bad-1"]);
    const payload = queueService.enqueue.mock.calls[0][1];
    await (svc as unknown as { processBulkPublishRun: (p: unknown) => Promise<void> }).processBulkPublishRun(payload);

    const items = [...bulkPublishRunStore.items.values()];
    const ok = items.find((item) => item.productId === "ok-1");
    const bad = items.find((item) => item.productId === "bad-1");
    expect(ok).toMatchObject({ status: "succeeded", exportJobId: "job_ok-1" });
    // a plain Error (not BadRequest/NotFound/Forbidden) is an operational failure, not an
    // ineligible-product exclusion — left retry-eligible for a future requeue.
    expect(bad).toMatchObject({ status: "failed", reason: "readiness check failed", retryEligible: true });

    const runs = [...bulkPublishRunStore.runs.values()];
    expect(runs[0]).toMatchObject({ status: "completed_with_errors", succeededCount: 1, failedCount: 1 });
  });

  // ─── TC-06 / #545 / Story 8: non-BULK_PUBLISH batch size ──────────────────────
  // The synchronous per-product loop that timed out at 46 products (#545/TC-06) is gone
  // for this path — createBulkPublishRun only queues a run, so an oversized batch no
  // longer risks the 20s web-request timeout. The old hard 50-product service-level
  // ceiling is retired; TriggerBulkPublishDto's ArrayMaxSize(2000) is the only remaining
  // bound, and it's a sanity limit on request size, not a scaling workaround.

  it("accepts a non-BULK_PUBLISH batch well over the old 50-product ceiling — queues a run instead of running any per-product loop synchronously", async () => {
    const productIds = Array.from({ length: 51 }, (_, i) => `p${i}`);
    const productsById: Record<string, { status: string; categoryId: string }> = {};
    for (const id of productIds) {
      productsById[id] = { status: "approved", categoryId: "cat1" };
    }
    const { svc, queueService } = makeBulkPublishService(productsById, {
      connectorSlug: "shopify",
      capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"],
    });

    const result = expectAsyncResult(await svc.triggerBulkPublish("inst_1", productIds));

    expect(result.requestedCount).toBe(51);
    expect(result.excluded).toHaveLength(0);
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
  });

  it("still runs the native BULK_PUBLISH path (Amazon) synchronously for a large batch", async () => {
    const productIds = Array.from({ length: 60 }, (_, i) => `p${i}`);
    const productsById: Record<string, { status: string; categoryId: string }> = {};
    for (const id of productIds) {
      productsById[id] = { status: "approved", categoryId: "cat1" };
    }
    const { svc, connectorFramework } = makeBulkPublishService(productsById, {
      connectorSlug: "amazon",
      capabilities: ["BULK_PUBLISH"],
    });

    const result = expectSyncResult(await svc.triggerBulkPublish("inst_1", productIds));

    expect(result.excluded).toHaveLength(0);
    expect(result.submissionIds).toHaveLength(60);
    expect(connectorFramework.publishBulk).toHaveBeenCalled();
  });

  // Regression coverage for the second bypass found during the Rev. 7 report review: the
  // single-product export-job endpoints (createExportJob / createExportJobAlias) enforce
  // the plan's monthly submissions limit via PlanGuard at the controller layer, but
  // PlanGuard is an HTTP decorator — triggerBulkPublish is a separate route that never
  // passes through it, and neither branch inside it (native Amazon feed, or the
  // queued-per-product fallback used for Shopify/WooCommerce) called checkLimit itself.
  // A tenant could call this endpoint repeatedly — each call individually within
  // NON_BULK_PUBLISH_BATCH_CEILING — to blow past their monthly submissions cap entirely.
  describe("submissions plan-limit enforcement", () => {
    it("checkLimit is called with the eligible-product count, not the raw requested count", async () => {
      const { svc, planUsageService } = makeBulkPublishService({
        a1: { status: "approved", categoryId: "cat1" },
        a2: { status: "active", categoryId: "cat1" },
        "not-ready": { status: "draft", categoryId: "cat1" }, // excluded by the readiness gate
      });

      await svc.triggerBulkPublish("inst_1", ["a1", "a2", "not-ready"]);

      // 3 requested, but only 2 are eligible — the limit check must reflect what will
      // actually create a submission, not the raw batch size.
      expect(planUsageService.checkLimit).toHaveBeenCalledWith("submissions", 2, "tenant1");
    });

    it("blocks the whole batch with PLAN_LIMIT_EXCEEDED when it would exceed the monthly submissions cap (native BULK_PUBLISH path)", async () => {
      const { svc, tenantDb, connectorFramework, planUsageService } = makeBulkPublishService({
        a1: { status: "approved", categoryId: "cat1" },
        a2: { status: "active", categoryId: "cat1" },
      });
      planUsageService.checkLimit.mockResolvedValue({
        allowed: false,
        resource: "submissions",
        limit: 500,
        current: 502,
      });

      await expect(svc.triggerBulkPublish("inst_1", ["a1", "a2"])).rejects.toMatchObject({
        status: 402,
        response: {
          error: "PLAN_LIMIT_EXCEEDED",
          resource: "submissions",
          limit: 500,
          current: 502,
        },
      });

      // Blocked before any submission is actually created.
      expect(connectorFramework.publishBulk).not.toHaveBeenCalled();
      expect(tenantDb.connectorSubmission.upsert).not.toHaveBeenCalled();
    });

    it("blocks the whole batch with PLAN_LIMIT_EXCEEDED when it would exceed the cap (queued-per-product fallback path, e.g. Shopify/WooCommerce)", async () => {
      const { svc, tenantDb, planUsageService } = makeRealExportPipelineService({
        a1: { status: "approved", categoryId: "cat1" },
        a2: { status: "active", categoryId: "cat1" },
      });
      planUsageService.checkLimit.mockResolvedValue({
        allowed: false,
        resource: "submissions",
        limit: 500,
        current: 502,
      });
      const actor = { actorId: "user_1", actorRole: "publisher" as const, tenantId: "tenant1" };

      await expect(svc.triggerBulkPublish("inst_1", ["a1", "a2"], actor)).rejects.toMatchObject({
        status: 402,
        response: { error: "PLAN_LIMIT_EXCEEDED", resource: "submissions" },
      });

      expect(tenantDb.marketplaceExportJob.create).not.toHaveBeenCalled();
    });

    it("an in-limit batch is unaffected — still publishes normally", async () => {
      const { svc, planUsageService } = makeBulkPublishService({
        a1: { status: "approved", categoryId: "cat1" },
        a2: { status: "active", categoryId: "cat1" },
      });
      planUsageService.checkLimit.mockResolvedValue({
        allowed: true,
        resource: "submissions",
        limit: 500,
        current: 2,
      });

      const result = expectSyncResult(await svc.triggerBulkPublish("inst_1", ["a1", "a2"]));

      expect(result.submissionIds).toHaveLength(2);
      expect(result.excluded).toHaveLength(0);
    });
  });
});

// Bulk-Publish Goes Async, Story 5/7: getBulkPublishRun (single-run status polling) and
// listBulkPublishRuns (Jobs workspace panel listing) — both read-only, so a lean
// purpose-built prisma double is enough here rather than the full run/item store used
// by the createBulkPublishRun/processBulkPublishRun tests above.
describe("MarketplaceService.getBulkPublishRun / listBulkPublishRuns", () => {
  function makeReadOnlyService(runs: Array<Record<string, unknown>>) {
    const tenantDb = {
      marketplaceBulkPublishRun: {
        findUnique: jest.fn(({ where: { id } }: { where: { id: string } }) =>
          Promise.resolve(runs.find((run) => run.id === id) ?? null),
        ),
        findMany: jest.fn(({ where, orderBy, take }: { where?: { OR?: Array<Record<string, unknown>> }; orderBy: unknown; take: number }) => {
          let filtered = runs;
          const cursorClause = where?.OR;
          if (cursorClause) {
            filtered = runs.filter((run) => {
              const updatedAtLt = cursorClause[0]?.updatedAt as { lt: Date } | undefined;
              const eqClause = cursorClause[1] as { updatedAt: Date; id: { lt: string } } | undefined;
              const runUpdatedAt = run.updatedAt as Date;
              if (updatedAtLt && runUpdatedAt < updatedAtLt.lt) return true;
              if (eqClause && runUpdatedAt.getTime() === eqClause.updatedAt.getTime() && (run.id as string) < eqClause.id.lt) return true;
              return false;
            });
          }
          const sorted = [...filtered].sort((a, b) => {
            const diff = (b.updatedAt as Date).getTime() - (a.updatedAt as Date).getTime();
            return diff !== 0 ? diff : (b.id as string).localeCompare(a.id as string);
          });
          return Promise.resolve(sorted.slice(0, take));
        }),
      },
    };
    const prisma = { tenant: jest.fn().mockReturnValue(tenantDb) };
    const svc = new MarketplaceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
    );
    return { svc, tenantDb };
  }

  it("getBulkPublishRun returns the run with its items", async () => {
    const { svc, tenantDb } = makeReadOnlyService([{ id: "run_1", status: "completed", updatedAt: new Date("2026-01-01") }]);
    tenantDb.marketplaceBulkPublishRun.findUnique.mockResolvedValueOnce({
      id: "run_1",
      status: "completed",
      items: [{ id: "item_1", status: "succeeded" }],
    });

    const result = await svc.getBulkPublishRun("run_1");

    expect(result).toMatchObject({ id: "run_1", status: "completed" });
  });

  it("getBulkPublishRun throws NotFoundException for an unknown run", async () => {
    const { svc } = makeReadOnlyService([]);
    await expect(svc.getBulkPublishRun("missing")).rejects.toThrow(NotFoundException);
  });

  it("listBulkPublishRuns without pagination returns the most recent runs first, capped", async () => {
    const runs = Array.from({ length: 5 }, (_, i) => ({
      id: `run_${i}`,
      status: "completed",
      updatedAt: new Date(2026, 0, i + 1),
    }));
    const { svc } = makeReadOnlyService(runs);

    const result = (await svc.listBulkPublishRuns()) as Array<{ id: string }>;

    expect(result[0].id).toBe("run_4"); // most recently updated first
    expect(result).toHaveLength(5);
  });

  it("listBulkPublishRuns with cursor pagination pages through runs in updatedAt-desc order", async () => {
    const runs = Array.from({ length: 5 }, (_, i) => ({
      id: `run_${i}`,
      status: "completed",
      updatedAt: new Date(2026, 0, i + 1),
    }));
    const { svc } = makeReadOnlyService(runs);

    const page1 = await svc.listBulkPublishRuns({ pagination: "cursor", limit: 2 });
    expect("items" in page1 ? page1.items.map((r) => r.id) : []).toEqual(["run_4", "run_3"]);
    expect("nextCursor" in page1 ? page1.nextCursor : null).toBeTruthy();

    const page2 = await svc.listBulkPublishRuns({
      pagination: "cursor",
      limit: 2,
      cursor: "nextCursor" in page1 ? (page1.nextCursor ?? undefined) : undefined,
    });
    expect("items" in page2 ? page2.items.map((r) => r.id) : []).toEqual(["run_2", "run_1"]);
  });
});

describe("MarketplaceService.getBatchReadiness", () => {
  function mockResolvedMapping() {
    return {
      channel: "amazon",
      displayName: "Amazon",
      requiredFields: ["title"],
      fieldMap: { title: "item_name" },
      templateId: null,
      templateName: null,
      source: "system_pack",
    };
  }

  it("returns one readiness summary per requested product and requested channel only", async () => {
    const svc = makeService();
    const svcInternal = svc as unknown as Record<string, jest.Mock>;

    jest.spyOn(svcInternal, "getProductsForSimulation").mockResolvedValue([
      { id: "prod-1", categoryId: "cat-1", validationIssues: [] },
      { id: "prod-2", categoryId: "cat-2", validationIssues: [] },
    ]);
    jest.spyOn(svcInternal, "getEffectiveMappingCached").mockResolvedValue(mockResolvedMapping());
    // No publish-capable connector installed for this tenant — every channel picks up
    // the "nowhere to publish to" error alongside its content/mapping errors.
    jest.spyOn(svcInternal, "getPublishCapableChannels").mockResolvedValue(new Set());
    jest.spyOn(svcInternal, "buildSimulationFromProduct").mockImplementation(async (_product, channel) => ({
      missingFields: channel === "amazon" ? ["title", "brand"] : ["attributes.mainImageUrl"],
      channelIssues: [
        {
          severity: "error",
          code: "CHANNEL_REQUIRED_FIELD",
          fieldPath: channel === "amazon" ? "title" : "attributes.mainImageUrl",
          sellerMessage: "Required field missing",
          message: "Required field missing",
        },
      ],
      complianceSummary: { errorCount: 1, warningCount: 0 },
    }));

    const result = await svc.getBatchReadiness(["prod-1", "prod-2"], ["amazon", "shopify"]);

    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.productId)).toEqual(["prod-1", "prod-2"]);
    expect(result.items[0]?.readiness.map((entry) => entry.channel)).toEqual(["amazon", "shopify"]);
    expect(result.items[1]?.readiness.map((entry) => entry.channel)).toEqual(["amazon", "shopify"]);
    expect(result.items[0]?.readiness[0]).toMatchObject({
      channel: "amazon",
      status: "errors",
      errorCount: 4,
      warningCount: 0,
    });
    expect(result.items[0]?.readiness[1]).toMatchObject({
      channel: "shopify",
      status: "errors",
      errorCount: 3,
      warningCount: 0,
    });
  });

  it("dedupes required field channel errors and refreshes counts after simulation changes", async () => {
    const svc = makeService();
    const svcInternal = svc as unknown as Record<string, jest.Mock>;

    jest.spyOn(svcInternal, "getProductsForSimulation").mockResolvedValue([
      { id: "prod-1", categoryId: "cat-1", validationIssues: [] },
    ]);
    jest.spyOn(svcInternal, "getEffectiveMappingCached").mockResolvedValue(mockResolvedMapping());
    jest.spyOn(svcInternal, "getPublishCapableChannels").mockResolvedValue(new Set());

    const buildSimulationFromProduct = jest.spyOn(svcInternal, "buildSimulationFromProduct");
    buildSimulationFromProduct
      .mockResolvedValueOnce({
        missingFields: ["title", "brand"],
        channelIssues: [
          {
            severity: "error",
            code: "CHANNEL_REQUIRED_FIELD",
            fieldPath: "title",
            sellerMessage: "Title is required",
            message: "Title is required",
          },
          {
            severity: "error",
            code: "CHANNEL_REQUIRED_FIELD",
            fieldPath: "brand",
            sellerMessage: "Brand is required",
            message: "Brand is required",
          },
          {
            severity: "error",
            code: "CHANNEL_IMAGE",
            fieldPath: "attributes.mainImageUrl",
            sellerMessage: "Main image missing",
            message: "Main image missing",
          },
          {
            severity: "warning",
            code: "CHANNEL_COPY",
            fieldPath: "description",
            sellerMessage: "Description should be longer",
            message: "Description should be longer",
          },
        ],
        complianceSummary: { errorCount: 1, warningCount: 2 },
      })
      .mockResolvedValueOnce({
        missingFields: [],
        channelIssues: [
          {
            severity: "warning",
            code: "CHANNEL_COPY",
            fieldPath: "description",
            sellerMessage: "Description should be longer",
            message: "Description should be longer",
          },
        ],
        complianceSummary: { errorCount: 0, warningCount: 1 },
      });

    const initial = await svc.getBatchReadiness(["prod-1"], ["amazon"]);
    const refreshed = await svc.getBatchReadiness(["prod-1"], ["amazon"]);

    expect(initial.items[0]?.readiness[0]).toMatchObject({
      channel: "amazon",
      status: "errors",
      errorCount: 5,
      warningCount: 3,
    });
    // Still "errors" (not "warnings") after content/mapping issues clear — no
    // publish-capable connector is installed, so the channel stays blocked.
    expect(refreshed.items[0]?.readiness[0]).toMatchObject({
      channel: "amazon",
      status: "errors",
      errorCount: 1,
      warningCount: 2,
    });
    expect(refreshed.items[0]?.readiness[0]?.errorCount).toBeLessThan(initial.items[0]?.readiness[0]?.errorCount ?? 0);
  });

  it("returns unknown readiness for requested products that are no longer found", async () => {
    const svc = makeService();
    const svcInternal = svc as unknown as Record<string, jest.Mock>;

    jest.spyOn(svcInternal, "getProductsForSimulation").mockResolvedValue([
      { id: "prod-1", categoryId: "cat-1", validationIssues: [] },
    ]);
    jest.spyOn(svcInternal, "getEffectiveMappingCached").mockResolvedValue(mockResolvedMapping());
    jest.spyOn(svcInternal, "getPublishCapableChannels").mockResolvedValue(new Set());
    jest.spyOn(svcInternal, "buildSimulationFromProduct").mockResolvedValue({
      missingFields: [],
      channelIssues: [],
      complianceSummary: { errorCount: 0, warningCount: 0 },
    });

    const result = await svc.getBatchReadiness(["prod-1", "prod-missing"], ["flipkart"]);

    expect(result.items).toHaveLength(2);
    expect(result.items[1]).toEqual({
      productId: "prod-missing",
      readiness: [
        {
          channel: "flipkart",
          status: "unknown",
          errorCount: 0,
          warningCount: 0,
        },
      ],
    });
  });
});

describe("MarketplaceService.getPublishCapableChannels (VEXA-202)", () => {
  function makeServiceWithRawRows(rows: Array<{ slug: string; capabilities: string[]; metadata: unknown; credentialsValidated?: boolean }>) {
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        $queryRawUnsafe: jest.fn().mockResolvedValue(rows), // RLS-BYPASS: manual tenant filter
      }),
    };
    const connectorFramework = {
      getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    };
    const connectorRegistry = { get: jest.fn(), list: jest.fn().mockReturnValue([]) };
    const planUsageService = {};
    const queueService = {};
    const metricsService = {};
    const connectorMappingService = {};
    const notificationsService = {};
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const accessPolicy = {};
    const mediaStorage = {};

    return new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      connectorRegistry as never,
      planUsageService as never,
      queueService as never,
      metricsService as never,
      connectorMappingService as never,
      notificationsService as never,
      logger as never,
      accessPolicy as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      mediaStorage as never,
    );
  }

  it("excludes a Shopify installation that is ACTIVE but has not completed OAuth (no metadata.shopId)", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "shopify", capabilities: ["PUBLISH"], metadata: { authMode: "guided_managed_install", shopDomain: "qa-managed-test.myshopify.com" } },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("shopify")).toBe(false);
  });

  it("includes a Shopify installation once metadata.shopId is recorded (OAuth completed)", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "shopify", capabilities: ["PUBLISH"], metadata: { shopDomain: "qa-managed-test.myshopify.com", shopId: "gid://shopify/Shop/1" } },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("shopify")).toBe(true);
  });

  it("does not require metadata.shopId for non-Shopify connectors", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "flipkart", capabilities: ["PUBLISH", "VALIDATE"], metadata: {}, credentialsValidated: true },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("flipkart")).toBe(true);
  });

  it("excludes a Flipkart installation that is ACTIVE but has no validated credentials (VEXA-301-SPIKE: blank-credentials install)", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "flipkart", capabilities: ["PUBLISH", "VALIDATE"], metadata: {}, credentialsValidated: false },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("flipkart")).toBe(false);
  });

  it("includes a Flipkart installation once credentials have been validated", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "flipkart", capabilities: ["PUBLISH", "VALIDATE"], metadata: {}, credentialsValidated: true },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("flipkart")).toBe(true);
  });

  it("excludes an Amazon installation that is ACTIVE but has no validated credentials", async () => {
    const svc = makeServiceWithRawRows([
      { slug: "amazon-in", capabilities: ["PUBLISH", "VALIDATE"], metadata: {}, credentialsValidated: false },
    ]);
    const result = await (svc as unknown as { getPublishCapableChannels: () => Promise<Set<string>> }).getPublishCapableChannels();
    expect(result.has("amazon")).toBe(false);
  });
});

// ─── MarketplaceService.queueDeltaSync — connector-submission enqueue handoff ──
//
// Regression coverage for the bug where scheduled/manual delta sync created
// MarketplaceExportJob rows at status=queued but never handed them to the
// connector-submission worker (queueService.enqueue was never called), so the
// rows sat at `queued` forever. createExportJob and requeueExportJob always
// enqueued after creating; queueDeltaSync was the one path that didn't.

describe("MarketplaceService.queueDeltaSync — connector-submission enqueue handoff", () => {
  const INSTALLATION_ROW = {
    id: "inst_1",
    connectorId: "conn_1",
    tenantKey: "tenant1",
    connectorSlug: "shopify",
    capabilities: ["PUBLISH"],
  };

  function makeDeltaSyncService(options: {
    candidates?: Array<{ product_id: string; version: number; category_id: string }>;
    createImpl?: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    enqueueImpl?: (...args: unknown[]) => Promise<void>;
    isJobPresentImpl?: (...args: unknown[]) => Promise<boolean>;
  } = {}) {
    const candidates = options.candidates ?? [
      { product_id: "p1", version: 2, category_id: "cat1" },
      { product_id: "p2", version: 3, category_id: "cat1" },
    ];

    const marketplaceExportJob = {
      create: jest.fn(
        options.createImpl ??
          (({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ id: `job-${data.productId as string}` })),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };

    const db = {
      $queryRaw: jest.fn().mockResolvedValue([INSTALLATION_ROW]),
      $queryRawUnsafe: jest.fn().mockResolvedValue(candidates), // RLS-BYPASS: manual tenant filter
      marketplaceExportJob,
    };

    const prisma = {
      // Same mock regardless of args: covers both `this.prisma.tenant(tenantKey)`
      // (used directly in queueDeltaSync) and `this.prisma.tenant()` (used inside
      // the shared enqueueExportJobForExecution helper).
      tenant: jest.fn().mockReturnValue(db),
    };

    const connectorFramework = {
      getCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
      requireCurrentTenantKey: jest.fn().mockReturnValue("tenant1"),
    };

    const queueService = {
      enqueue: jest.fn(options.enqueueImpl ?? (() => Promise.resolve(undefined))),
      isJobPresent: jest.fn(options.isJobPresentImpl ?? (() => Promise.resolve(false))),
      processScheduledSync: jest.fn(),
      processWithBackpressure: jest.fn(),
    };

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );

    return { svc, db, queueService, marketplaceExportJob, logger };
  }

  it("enqueues a CONNECTOR_SUBMISSION job for every export job it creates", async () => {
    const { svc, queueService } = makeDeltaSyncService();

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 2, skipped: 0 });
    expect(queueService.enqueue).toHaveBeenCalledTimes(2);
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p1", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p1_0" },
    );
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p2", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p2_0" },
    );
  });

  it("the scheduled-sync cron handler drives the same enqueue path as a manual run (not a separate, divergeable copy)", async () => {
    // There are two distinct queue layers here: registerRepeatableSync's BullMQ
    // schedule only queues the *orchestration* trigger — processScheduledSync's
    // handler still has to call queueDeltaSync, which is what actually creates
    // and enqueues the CONNECTOR_SUBMISSION work. A fix applied only to a manual
    // "run sync now" call site (and not to queueDeltaSync itself) would leave the
    // cron path silently broken; this test exercises the cron wiring directly so
    // that scenario cannot pass.
    const { svc, queueService } = makeDeltaSyncService();

    svc.onModuleInit();
    expect(queueService.processScheduledSync).toHaveBeenCalledTimes(1);
    const scheduledHandler = queueService.processScheduledSync.mock.calls[0][0] as (
      payload: unknown,
    ) => Promise<void>;

    await scheduledHandler({ tenantKey: "tenant1", installationId: "inst_1" });

    expect(queueService.enqueue).toHaveBeenCalledTimes(2);
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p1", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p1_0" },
    );
  });

  it("enqueues nothing when there are no delta-sync candidates", async () => {
    const { svc, queueService, marketplaceExportJob } = makeDeltaSyncService({ candidates: [] });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 0, skipped: 0 });
    expect(marketplaceExportJob.create).not.toHaveBeenCalled();
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("does not enqueue for a candidate whose DB row creation failed", async () => {
    const { svc, queueService } = makeDeltaSyncService({
      createImpl: ({ data }) => {
        if (data.productId === "p1") {
          return Promise.reject(new Error("db unavailable"));
        }
        return Promise.resolve({ id: `job-${data.productId as string}` });
      },
    });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 1, skipped: 1 });
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p2", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p2_0" },
    );
  });

  it("marks the row failed (not silently queued) when the queue enqueue call itself fails", async () => {
    const { svc, db, marketplaceExportJob } = makeDeltaSyncService({
      candidates: [{ product_id: "p1", version: 2, category_id: "cat1" }],
      enqueueImpl: () => Promise.reject(new Error("redis unreachable")),
      isJobPresentImpl: () => Promise.resolve(false), // the add() genuinely never landed
    });

    const result = await svc.queueDeltaSync("inst_1");

    // The row was created but the handoff failed — it must NOT be counted as
    // a genuinely queued (worker-visible) job.
    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(marketplaceExportJob.updateMany).toHaveBeenCalledWith({
      where: { id: "job-p1", status: ExportJobStatus.queued },
      data: { status: ExportJobStatus.failed, failureReason: "Queue enqueue failed" },
    });
    void db;
  });

  it("leaves the row queued (not falsely marked failed) when isJobPresent itself cannot answer", async () => {
    // enqueue fails AND the presence check fails too (e.g. same Redis outage) — this
    // is genuinely unknown, not confirmed-absent, so the row must not be asserted as
    // `failed`. It still counts as `skipped` in this call's return value because no
    // enqueue was ever confirmed to succeed.
    //
    // The underlying errors intentionally carry sensitive-looking content (host,
    // port, a credential-bearing URL, a stack) to prove the diagnostic log never
    // forwards raw error text — only a coarse, non-sensitive error code.
    const enqueueError = Object.assign(
      new Error("connect ECONNREFUSED redis://default:s3cr3t-pass@10.0.4.12:6379"),
      { code: "ECONNREFUSED", stack: "Error: connect ECONNREFUSED\n    at TCPConnectWrap.afterConnect (net.js:1)" },
    );
    const presenceCheckError = Object.assign(
      new Error("getaddrinfo ENOTFOUND internal-redis.vexapim-prod.svc.cluster.local"),
      { code: "ENOTFOUND" },
    );

    const { svc, marketplaceExportJob, logger } = makeDeltaSyncService({
      candidates: [{ product_id: "p1", version: 2, category_id: "cat1" }],
      enqueueImpl: () => Promise.reject(enqueueError),
      isJobPresentImpl: () => Promise.reject(presenceCheckError),
    });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(marketplaceExportJob.updateMany).not.toHaveBeenCalled();

    // Operator-visible signal distinguishing "queued" from "queued but the
    // execution handoff could not be verified" without a DB status/enum change.
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, loggedContext] = logger.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(loggedContext).toEqual({
      event: "QUEUE_HANDOFF_UNVERIFIED",
      jobId: "job-p1",
      connectorSlug: "shopify",
      retryCount: 0,
      queueJobId: "job-p1_0",
      enqueueErrorCode: "ECONNREFUSED",
      presenceCheckErrorCode: "ENOTFOUND",
    });

    // Narrow data-safety regression: no raw message/stack/connection material of any
    // kind should reach the log, under any key name.
    const serializedContext = JSON.stringify(loggedContext);
    expect(serializedContext).not.toContain("s3cr3t-pass");
    expect(serializedContext).not.toContain("10.0.4.12");
    expect(serializedContext).not.toContain("internal-redis.vexapim-prod");
    expect(serializedContext).not.toContain("ECONNREFUSED redis://");
    expect(loggedContext).not.toHaveProperty("stack");
    expect(loggedContext).not.toHaveProperty("payload");
    expect(loggedContext).not.toHaveProperty("credentials");
    expect(loggedContext).not.toHaveProperty("redisUrl");
    expect(loggedContext).not.toHaveProperty("connectionString");
    expect(loggedContext).not.toHaveProperty("enqueueError");
    expect(loggedContext).not.toHaveProperty("presenceCheckError");
  });

  it("does not mark the row failed if isJobPresent shows the enqueue actually landed", async () => {
    const { svc, marketplaceExportJob } = makeDeltaSyncService({
      candidates: [{ product_id: "p1", version: 2, category_id: "cat1" }],
      enqueueImpl: () => Promise.reject(new Error("client-side timeout after add() succeeded")),
      isJobPresentImpl: () => Promise.resolve(true), // BullMQ confirms the job is really there
    });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(marketplaceExportJob.updateMany).not.toHaveBeenCalled();
  });

  it("counts a P2002 (concurrent-active) conflict as skipped, not queued", async () => {
    const { Prisma } = require("@prisma/client"); // eslint-disable-line @typescript-eslint/no-var-requires
    const p2002 = Object.assign(
      new Error("Unique constraint failed on the fields: (`tenantKey`,`productId`,`installation_id`)"),
      { code: "P2002", meta: { target: ["tenantKey", "productId", "installation_id"] } },
    );
    Object.setPrototypeOf(p2002, (Prisma?.PrismaClientKnownRequestError ?? Error).prototype);

    const { svc, queueService } = makeDeltaSyncService({
      candidates: [
        { product_id: "p1", version: 2, category_id: "cat1" },
        { product_id: "p2", version: 3, category_id: "cat1" },
      ],
      createImpl: ({ data }) => {
        if (data.productId === "p1") return Promise.reject(p2002);
        return Promise.resolve({ id: `job-${data.productId as string}` });
      },
    });

    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 1, skipped: 1 });
    expect(queueService.enqueue).toHaveBeenCalledTimes(1);
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p2", connectorSlug: "shopify", tenantKey: "tenant1" },
      { jobId: "job-p2_0" },
    );
  });

  it("throws NotFoundException when the installation does not exist", async () => {
    const { svc, db } = makeDeltaSyncService();
    (db.$queryRaw as jest.Mock).mockResolvedValue([]);
    await expect(svc.queueDeltaSync("missing-inst")).rejects.toThrow(NotFoundException);
  });

  it("rejects delta sync for a connector installation without PUBLISH capability", async () => {
    const { svc, db } = makeDeltaSyncService();
    (db.$queryRaw as jest.Mock).mockResolvedValue([{ ...INSTALLATION_ROW, capabilities: ["VALIDATE"] }]);
    await expect(svc.queueDeltaSync("inst_1")).rejects.toThrow(BadRequestException);
  });
});

// ─── CONNECTOR_SUBMISSION worker boundary — tenant context restoration ────────
// (BUG-MKT-QUEUE-002)
//
// Root cause: the worker callback registered via processWithBackpressure has no
// HTTP request to inherit AsyncLocalStorage tenant context from, so every
// ambient `this.prisma.tenant()` call inside processExportJob (and its
// siblings) silently fell back to DEFAULT_TENANT_KEY and could never find a
// real tenant's row. The fix restores context once at the top of the worker
// callback, sourced from a required `tenantKey` field on the queue payload,
// before dispatching to any mode. These tests exercise the REAL
// runWithTenantContext/getTenantKeyFromContext machinery (not mocked) against
// a small per-tenant fake Prisma client, so a regression that reintroduces the
// ambient-fallback bug would make the "correct tenant" test fail exactly the
// way production did.

describe("CONNECTOR_SUBMISSION worker boundary — tenant context restoration", () => {
  const { getTenantKeyFromContext } = require("../common/tenant/tenant-context");

  function emptyTenantDb() {
    return {
      marketplaceExportJob: {
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
  }

  function makeWorkerBoundaryService(dbByTenant: Record<string, unknown> = {}) {
    const prisma = {
      // Mirrors the real PrismaService.tenant(): explicit arg wins, otherwise
      // ambient AsyncLocalStorage context — genuinely exercised here, not stubbed.
      tenant: jest.fn((explicitKey?: string) => {
        const key = explicitKey ?? getTenantKeyFromContext();
        return dbByTenant[key] ?? emptyTenantDb();
      }),
    };
    const connectorFramework = {
      getCurrentTenantKey: jest.fn(() => getTenantKeyFromContext()),
    };
    const queueService = {
      processScheduledSync: jest.fn(),
      processWithBackpressure: jest.fn(),
      enqueue: jest.fn(),
      isJobPresent: jest.fn(),
    };
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );
    return { svc, prisma, queueService, logger };
  }

  function captureWorkerHandler(svc: MarketplaceService, queueService: { processWithBackpressure: jest.Mock }) {
    svc.onModuleInit();
    // Bulk-Publish Goes Async, Story 4 registered a second processWithBackpressure
    // consumer (MARKETPLACE_BULK_PUBLISH) alongside this one (CONNECTOR_SUBMISSION) in
    // the same registerConnectorWorker() — select by queue name (arg 0) rather than
    // assuming this is the only/first call.
    const call = queueService.processWithBackpressure.mock.calls.find(
      (c: unknown[]) => c[0] === QUEUE_NAMES.CONNECTOR_SUBMISSION,
    );
    expect(call).toBeDefined();
    // processWithBackpressure(queueName, options, handler)
    return call![2] as (payload: unknown) => Promise<void>;
  }

  it("restores the payload's tenant before dispatch — the job is found under the correct tenant", async () => {
    // ExportJobStatus.completed short-circuits processExportJob immediately after
    // the tenant-scoped lookup, which is exactly the boundary this test needs to
    // prove crossed correctly — no need to stub the rest of the publish pipeline.
    const completedJob = { id: "job-1", status: ExportJobStatus.completed, tenantKey: "tenantA" };
    const { svc, queueService } = makeWorkerBoundaryService({
      tenantA: { marketplaceExportJob: { findUnique: jest.fn().mockResolvedValue(completedJob) } },
    });
    const handler = captureWorkerHandler(svc, queueService);

    await handler({ jobId: "job-1", connectorSlug: "shopify", tenantKey: "tenantA" });
    // No throw = success: processExportJob found the row and its own tenant-
    // consistency assertion (existing.tenantKey === activeTenantKey) passed.
  });

  it("does not leak another tenant's job when the payload names a different tenant", async () => {
    // The same job id exists — but only under tenantA. A payload claiming tenantB
    // must not be able to see it: this is the isolation half of the fix, proving
    // the restored context actually scopes the lookup rather than merely existing.
    const completedJob = { id: "job-1", status: ExportJobStatus.completed, tenantKey: "tenantA" };
    const { svc, queueService } = makeWorkerBoundaryService({
      tenantA: { marketplaceExportJob: { findUnique: jest.fn().mockResolvedValue(completedJob) } },
    });
    const handler = captureWorkerHandler(svc, queueService);

    await expect(
      handler({ jobId: "job-1", connectorSlug: "shopify", tenantKey: "tenantB" }),
    ).rejects.toThrow("Export job not found");
  });

  it.each(["export-job" as const, "status-sync" as const, "submission-retry" as const])(
    "fails closed with UnrecoverableError for mode=%s when tenantKey is missing — never falls back to a default tenant",
    async (mode) => {
      const { svc, queueService, prisma, logger } = makeWorkerBoundaryService();
      const handler = captureWorkerHandler(svc, queueService);
      const processExportJobSpy = jest.spyOn(svc, "processExportJob");
      const autoSyncSpy = jest.spyOn(svc as unknown as { autoSyncSubmissionStatus: () => unknown }, "autoSyncSubmissionStatus" as never);
      const retrySpy = jest.spyOn(svc as unknown as { processLiveSubmissionRetry: () => unknown }, "processLiveSubmissionRetry" as never);

      const payload =
        mode === "export-job"
          ? { jobId: "job-1", connectorSlug: "shopify" }
          : mode === "status-sync"
            ? { mode, submissionId: "sub-1", connectorSlug: "shopify" }
            : { mode, submissionId: "sub-1", connectorSlug: "shopify" };

      await expect(handler(payload)).rejects.toThrow(UnrecoverableError);

      expect(processExportJobSpy).not.toHaveBeenCalled();
      expect(autoSyncSpy).not.toHaveBeenCalled();
      expect(retrySpy).not.toHaveBeenCalled();
      // The ambient-fallback bug this fix closes is specifically "silently resolve
      // to DEFAULT_TENANT_KEY and query anyway" — so no tenant-scoped client should
      // ever be requested for a payload with no tenant identity at all.
      expect(prisma.tenant).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ event: "QUEUE_TENANT_CONTEXT_MISSING" }),
      );
    },
  );

  it("logs no raw payload content for the missing-tenantKey diagnostic — mode only", async () => {
    const { svc, queueService, logger } = makeWorkerBoundaryService();
    const handler = captureWorkerHandler(svc, queueService);

    await expect(
      handler({ mode: "submission-retry", submissionId: "sub-secret-1", connectorSlug: "shopify" }),
    ).rejects.toThrow(UnrecoverableError);

    const [, loggedContext] = logger.error.mock.calls[0] as [string, Record<string, unknown>];
    expect(loggedContext).toEqual({ event: "QUEUE_TENANT_CONTEXT_MISSING", mode: "submission-retry" });
    expect(JSON.stringify(loggedContext)).not.toContain("sub-secret-1");
  });
});

describe("MarketplaceService.processExportJob — tenant-consistency self-check", () => {
  it("throws if the loaded row's tenantKey does not match the active tenant (defense-in-depth)", async () => {
    // Structurally this should be unreachable in production (the tenant-scope
    // Prisma extension already injects tenantKey into the query), but the check
    // exists to fail loudly if that guarantee is ever broken — verify it actually
    // fires rather than being dead code.
    const prisma = {
      tenant: jest.fn().mockReturnValue({
        marketplaceExportJob: {
          findUnique: jest.fn().mockResolvedValue({ id: "job-1", status: "queued", tenantKey: "tenantB" }),
        },
      }),
    };
    const connectorFramework = { getCurrentTenantKey: jest.fn().mockReturnValue("tenantA") };
    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );

    await expect(svc.processExportJob("job-1")).rejects.toThrow(/[Tt]enant/);
  });
});

// ─── Producer-side strict tenant accessor (BUG-MKT-QUEUE-002, Gate 2) ─────────
//
// getCurrentTenantKey() is intentionally lenient — it silently resolves to
// DEFAULT_TENANT_KEY when no AsyncLocalStorage context exists, which is fine
// for the many read paths that tolerate it. requireCurrentTenantKey() is the
// strict sibling used specifically to stamp queue payloads: a contextless
// producer must fail loudly, never mint a payload that looks valid but names
// the wrong tenant. These tests use the REAL context implementation (not
// mocked) so a regression that swaps requireCurrentTenantKey() back to the
// lenient accessor at a producer call site would make the first test fail.

describe("Producer tenant resolution cannot silently synthesize a default tenant", () => {
  const { requireTenantKeyFromContext, runWithTenantContext } = require("../common/tenant/tenant-context");

  function makeDeltaSyncServiceWithRealTenantAccessor(candidates: Array<{ product_id: string; version: number; category_id: string }>) {
    const marketplaceExportJob = {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: `job-${data.productId as string}` }),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: "inst_1", connectorId: "conn_1", tenantKey: "tenant1", connectorSlug: "shopify", capabilities: ["PUBLISH"] },
      ]),
      $queryRawUnsafe: jest.fn().mockResolvedValue(candidates), // RLS-BYPASS: manual tenant filter
      marketplaceExportJob,
    };
    const prisma = { tenant: jest.fn().mockReturnValue(db) };
    const connectorFramework = {
      // Real implementations, not hardcoded strings — genuinely exercises
      // "is there an established context" rather than asserting it.
      getCurrentTenantKey: jest.fn(() => require("../common/tenant/tenant-context").getTenantKeyFromContext()),
      requireCurrentTenantKey: jest.fn(() => requireTenantKeyFromContext()),
    };
    const queueService = { enqueue: jest.fn().mockResolvedValue(undefined), isJobPresent: jest.fn().mockResolvedValue(false) };
    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );
    return { svc, queueService, marketplaceExportJob };
  }

  it("never enqueues (and is honestly counted as skipped, not queued) when invoked with no tenant context at all", async () => {
    const { svc, queueService, marketplaceExportJob } = makeDeltaSyncServiceWithRealTenantAccessor([
      { product_id: "p1", version: 2, category_id: "cat1" },
    ]);

    // Deliberately NOT wrapped in runWithTenantContext — simulates a future
    // caller that forgets to establish one before reaching a producer.
    // queueDeltaSync's per-item Promise.allSettled absorbs the resulting throw
    // as a skip rather than failing the whole batch — the invariant this test
    // actually enforces is narrower and non-negotiable: the enqueue call itself
    // must never happen, and never with a fabricated tenantKey="default".
    const result = await svc.queueDeltaSync("inst_1");

    expect(result).toEqual({ queued: 0, skipped: 1 });
    expect(marketplaceExportJob.create).toHaveBeenCalled();
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("requeueExportJob rejects outright (no Promise.allSettled to absorb it) when invoked with no tenant context", async () => {
    // Unlike queueDeltaSync's bulk loop, requeueExportJob is a single direct
    // call — a missing tenant context here must surface as a genuine failure
    // to the caller, not be silently swallowed.
    const exportJobDb = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue({ id: "job-1", retryCount: 0, status: "queued", channel: "shopify" }),
    };
    const prisma = { tenant: jest.fn().mockReturnValue({ marketplaceExportJob: exportJobDb }) };
    const connectorFramework = {
      getCurrentTenantKey: jest.fn(() => require("../common/tenant/tenant-context").getTenantKeyFromContext()),
      requireCurrentTenantKey: jest.fn(() => requireTenantKeyFromContext()),
    };
    const queueService = { enqueue: jest.fn().mockResolvedValue(undefined), isJobPresent: jest.fn().mockResolvedValue(false) };
    const svc = new MarketplaceService(
      prisma as never,
      connectorFramework as never,
      {} as never,
      {} as never,
      queueService as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
    );

    await expect(svc.requeueExportJob("job-1")).rejects.toThrow(/tenant context/i);
    expect(queueService.enqueue).not.toHaveBeenCalled();
  });

  it("still works correctly when a real, explicit tenant context happens to be named 'default'", async () => {
    // The distinction that matters: "no context" (must fail) vs. "a context
    // that happens to hold the literal string default" (must succeed exactly
    // like any other tenant name) — these are not the same thing.
    const { svc, queueService } = makeDeltaSyncServiceWithRealTenantAccessor([
      { product_id: "p1", version: 2, category_id: "cat1" },
    ]);

    const result = await runWithTenantContext("default", () => svc.queueDeltaSync("inst_1"));

    expect(result).toEqual({ queued: 1, skipped: 0 });
    expect(queueService.enqueue).toHaveBeenCalledWith(
      "connector-submission",
      { jobId: "job-p1", connectorSlug: "shopify", tenantKey: "default" },
      { jobId: "job-p1_0" },
    );
  });
});

describe("MarketplaceService — primary-variant selection stability (#662)", () => {
  // Two variants; "older" was created first and is the product's true canonical
  // variant, but "newer" was *edited* most recently (so it has the later
  // updatedAt). Under the old `orderBy: updatedAt desc` selector, editing
  // *either* variant's unrelated field flips which one is picked as
  // "primary" for connector SKU/price derivation — the bug behind #662.
  const olderVariant = {
    id: "var-older",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    skuCode: "SKU-OLDER",
    mrp: 100,
    sellingPrice: 90,
    attributes: {},
    prices: [],
    inventoryQty: 5,
  };
  const newerVariant = {
    id: "var-newer",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    // Edited after olderVariant, on a field unrelated to identity/price —
    // this is what flips `updatedAt desc` ordering without any real intent
    // to change which variant is "primary".
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    skuCode: "SKU-NEWER",
    mrp: 200,
    sellingPrice: 180,
    attributes: {},
    prices: [],
    inventoryQty: 3,
  };

  function makeServiceWithVariantOrdering() {
    const findUnique = jest.fn().mockImplementation((args: { include: { variants: { orderBy: Array<Record<string, "asc" | "desc">> } } }) => {
      const orderBy = args.include.variants.orderBy;
      const sorted = [olderVariant, newerVariant].sort((a, b) => {
        for (const clause of orderBy) {
          const [field, direction] = Object.entries(clause)[0] as [string, "asc" | "desc"];
          const av = (a as Record<string, unknown>)[field] as Date;
          const bv = (b as Record<string, unknown>)[field] as Date;
          if (av.getTime() !== bv.getTime()) {
            return direction === "asc" ? av.getTime() - bv.getTime() : bv.getTime() - av.getTime();
          }
        }
        return 0;
      });
      return Promise.resolve({
        id: "prod1",
        title: "Test Product",
        description: "",
        brand: "",
        hsnCode: "",
        gstRate: null,
        attributes: {},
        category: { id: "cat1", name: "Category", path: "cat" },
        taxCodes: [],
        variants: sorted,
      });
    });

    const prisma = {
      tenant: jest.fn().mockReturnValue({
        product: { findUnique },
        mediaAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    };

    const svc = new MarketplaceService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
    );
    return { svc, findUnique };
  }

  it("derives connector SKU/price from the first-created variant, not the most-recently-edited one", async () => {
    const { svc } = makeServiceWithVariantOrdering();
    const payload = await (
      svc as unknown as { buildConnectorProductPayload: (id: string, opts?: unknown) => Promise<{ sku: string; mrp: number; sellingPrice: number }> }
    ).buildConnectorProductPayload("prod1", {});

    // olderVariant was created first — it must be treated as the canonical
    // "primary" variant regardless of which variant was edited most recently.
    expect(payload.sku).toBe("SKU-OLDER");
    expect(payload.mrp).toBe(100);
    expect(payload.sellingPrice).toBe(90);
  });

  it("resolveProductSku derives its lookup SKU from the same stable, first-created variant", async () => {
    const { svc, findUnique } = makeServiceWithVariantOrdering();
    const sku = await (svc as unknown as { resolveProductSku: (id: string) => Promise<string> }).resolveProductSku("prod1");

    expect(sku).toBe("SKU-OLDER");
    const orderBy = findUnique.mock.calls[0][0].include.variants.orderBy;
    expect(orderBy[0]).toEqual({ createdAt: "asc" });
  });

  it("editing a non-primary variant does not change canonical identity or price fields (two-phase #662 regression)", async () => {
    const variantA = {
      id: "var-a",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      skuCode: "SKU-A",
      mrp: 100,
      sellingPrice: 90,
      attributes: { color: "red" },
      prices: [],
      inventoryQty: 5,
    };
    const variantB = {
      id: "var-b",
      createdAt: new Date("2026-02-01T00:00:00.000Z"),
      updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      skuCode: "SKU-B",
      mrp: 200,
      sellingPrice: 180,
      attributes: { color: "blue" },
      prices: [],
      inventoryQty: 3,
    };

    const findUnique = jest.fn().mockImplementation((args: { include: { variants: { orderBy: Array<Record<string, "asc" | "desc">> } } }) => {
      const orderBy = args.include.variants.orderBy;
      const sorted = [variantA, variantB].sort((a, b) => {
        for (const clause of orderBy) {
          const [field, direction] = Object.entries(clause)[0] as [string, "asc" | "desc"];
          const av = (a as Record<string, unknown>)[field] as Date;
          const bv = (b as Record<string, unknown>)[field] as Date;
          if (av.getTime() !== bv.getTime()) {
            return direction === "asc" ? av.getTime() - bv.getTime() : bv.getTime() - av.getTime();
          }
        }
        return 0;
      });
      return Promise.resolve({
        id: "prod-mv",
        title: "Multi-Variant Widget",
        description: "",
        brand: "",
        hsnCode: "",
        gstRate: null,
        attributes: {},
        category: { id: "cat1", name: "Widgets", path: "widgets" },
        taxCodes: [],
        variants: sorted.map((v) => ({ ...v })),
      });
    });

    const prisma = {
      tenant: jest.fn().mockReturnValue({
        product: { findUnique },
        mediaAsset: { findFirst: jest.fn().mockResolvedValue(null) },
      }),
    };

    const svc = new MarketplaceService(
      prisma as never,
      {} as never, {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      {} as never,
      { fromRows: jest.fn().mockReturnValue([]), findDefault: jest.fn().mockReturnValue(undefined) } as never,
      { isLocalMode: jest.fn().mockReturnValue(false) } as never,
    );

    type Payload = { sku: string; mrp: number; sellingPrice: number; variants: Array<{ sku: string; sellingPrice: number; mrp: number }> };
    const build = () =>
      (svc as unknown as { buildConnectorProductPayload: (id: string, opts?: unknown) => Promise<Payload> })
        .buildConnectorProductPayload("prod-mv", {});

    // ── Phase 1: both variants in original state ──
    const snap1 = await build();

    // ── Phase 2: simulate editing variant B ──
    // Only B's updatedAt and price change; A is untouched.
    variantB.updatedAt = new Date("2026-08-01T00:00:00.000Z");
    variantB.mrp = 250;
    variantB.sellingPrice = 230;

    const snap2 = await build();

    // Canonical top-level identity/price fields MUST NOT change.
    // These are the fields that become Shopify metafield pim_connector.sku
    // and pim_connector.source_sku, and the default variant price.
    expect(snap2.sku).toBe(snap1.sku);
    expect(snap2.mrp).toBe(snap1.mrp);
    expect(snap2.sellingPrice).toBe(snap1.sellingPrice);

    // They must come from variant A (first-created).
    expect(snap1.sku).toBe("SKU-A");
    expect(snap1.mrp).toBe(100);
    expect(snap1.sellingPrice).toBe(90);

    // Per-variant payload: variant A (index 0) is unchanged across phases.
    expect(snap2.variants[0].sku).toBe("SKU-A");
    expect(snap2.variants[0].mrp).toBe(100);
    expect(snap2.variants[0].sellingPrice).toBe(90);

    // Per-variant payload: variant B's edit IS reflected in its own slot.
    expect(snap2.variants[1].sku).toBe("SKU-B");
    expect(snap2.variants[1].mrp).toBe(250);
    expect(snap2.variants[1].sellingPrice).toBe(230);

    // Sibling (A) was NOT mutated by B's edit.
    expect(snap2.variants[0].mrp).toBe(snap1.variants[0].mrp);
    expect(snap2.variants[0].sellingPrice).toBe(snap1.variants[0].sellingPrice);
  });
});
