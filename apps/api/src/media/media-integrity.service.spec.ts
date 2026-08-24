import { MediaIntegrityService } from "./media-integrity.service";

function makeRow(overrides: Partial<{
  id: string;
  tenantKey: string;
  productId: string | null;
  variantId: string | null;
  storagePath: string;
  createdAt: Date;
  product: { status: string | null; deletedAt: Date | null } | null;
}> = {}) {
  return {
    id: overrides.id ?? "asset-1",
    tenantKey: overrides.tenantKey ?? "admin",
    productId: overrides.productId ?? null,
    variantId: overrides.variantId ?? null,
    storagePath: overrides.storagePath ?? "media/admin/asset-1.jpg",
    createdAt: overrides.createdAt ?? new Date("2026-08-24T10:00:00.000Z"),
    product: overrides.product ?? null,
  };
}

function makeService(options: {
  rows?: unknown[][];
  count?: number;
  checkpoint?: { cursorCreatedAt: Date | null; cursorId: string | null; cycleStartedAt?: Date } | null;
  probeObjectKey?: jest.Mock;
  probeLocalPath?: jest.Mock;
} = {}) {
  const db = {
    mediaIntegrityScanRun: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    mediaIntegrityScanCheckpoint: {
      findUnique: jest.fn().mockResolvedValue(options.checkpoint ?? null),
      upsert: jest.fn().mockResolvedValue({}),
    },
    mediaAsset: {
      count: jest.fn().mockResolvedValue(options.count ?? 0),
      findMany: jest.fn(),
      update: jest.fn(() => {
        throw new Error("MediaAsset mutation is not allowed in media integrity scans");
      }),
      delete: jest.fn(() => {
        throw new Error("MediaAsset delete is not allowed in media integrity scans");
      }),
    },
    product: {
      update: jest.fn(() => {
        throw new Error("Product mutation is not allowed in media integrity scans");
      }),
    },
  };
  const queuedRows = [...(options.rows ?? [])];
  db.mediaAsset.findMany.mockImplementation(() => Promise.resolve(queuedRows.shift() ?? []));

  const mediaStorage = {
    storageSnapshot: jest.fn(() => ({
      mode: "object_storage",
      backend: "object_storage",
      objectStorageConfigured: true,
      publicUrlConfigured: true,
    })),
    probeObjectKey: options.probeObjectKey ?? jest.fn().mockResolvedValue({ status: "exists" }),
    probeLocalPath: options.probeLocalPath ?? jest.fn((_storagePath: string, enabled: boolean) =>
      Promise.resolve(enabled ? { status: "exists" } : { status: "unverifiable", reason: "local_filesystem_probe_disabled" }),
    ),
    upload: jest.fn(() => {
      throw new Error("storage writes are not allowed in media integrity scans");
    }),
    delete: jest.fn(() => {
      throw new Error("storage deletes are not allowed in media integrity scans");
    }),
  };

  const service = new MediaIntegrityService({ getClient: () => db } as never, mediaStorage as never);
  return { service, db, mediaStorage };
}

describe("MediaIntegrityService", () => {
  it("classifies only observable storage path kinds", () => {
    const { service } = makeService();

    expect(service.classifyStoragePath("media/admin/asset.jpg")).toBe("object_key");
    expect(service.classifyStoragePath("/app/storage/media/admin/asset.jpg")).toBe("legacy_local_path");
    expect(service.classifyStoragePath("C:\\app\\storage\\media\\admin\\asset.jpg")).toBe("legacy_local_path");
    expect(service.classifyStoragePath("https://cdn.example.test/media/admin/asset.jpg")).toBe("external_url");
    expect(service.classifyStoragePath("")).toBe("empty");
    expect(service.classifyStoragePath("media/admin/../secret.jpg")).toBe("malformed");
    expect(service.classifyStoragePath("media\\admin\\asset.jpg")).toBe("malformed");
  });

  it("keeps capped scans partial and advances the stable cursor", async () => {
    const rows = [
      [makeRow({ id: "asset-1", createdAt: new Date("2026-08-24T10:00:00.000Z") })],
      [makeRow({ id: "asset-2", createdAt: new Date("2026-08-24T10:01:00.000Z") })],
    ];
    const { service, db, mediaStorage } = makeService({ rows, count: 3 });

    const result = await service.runBoundedScan({ pageSize: 1, maxRowsPerRun: 2 });

    expect(result.status).toBe("partial");
    expect(result.coverage).toEqual({
      complete: false,
      rowsExamined: 2,
      rowsEligible: 3,
      truncated: true,
      continuationPending: true,
    });
    expect(db.mediaAsset.findMany).toHaveBeenCalledTimes(2);
    expect(db.mediaIntegrityScanRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cursorId: "asset-2",
        rowsExamined: 2,
        rowsEligible: 3,
        coverageComplete: false,
        continuationPending: true,
      }),
    }));
    expect(db.mediaIntegrityScanCheckpoint.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ cursorId: "asset-2", rowsEligible: 3 }),
    }));
    expect(mediaStorage.upload).not.toHaveBeenCalled();
    expect(mediaStorage.delete).not.toHaveBeenCalled();
    expect(db.mediaAsset.update).not.toHaveBeenCalled();
    expect(db.mediaAsset.delete).not.toHaveBeenCalled();
    expect(db.product.update).not.toHaveBeenCalled();
  });

  it("reports ok only for complete clean coverage", async () => {
    const { service } = makeService({
      rows: [[makeRow({ id: "asset-1" })]],
      count: 1,
    });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(result.status).toBe("ok");
    expect(result.coverage.complete).toBe(true);
    expect(result.coverage.continuationPending).toBe(false);
    expect(result.totals.exists).toBe(1);
    expect(result.totals.missing).toBe(0);
  });

  it("separates missing, unavailable, invalid, and unverifiable states", async () => {
    const probeObjectKey = jest
      .fn()
      .mockResolvedValueOnce({ status: "missing" })
      .mockResolvedValueOnce({ status: "storage_error", reason: "TimeoutError" });
    const { service } = makeService({
      count: 5,
      probeObjectKey,
      rows: [[
        makeRow({
          id: "missing-object",
          tenantKey: "admin",
          productId: "product-1",
          product: { status: "approved", deletedAt: null },
          storagePath: "media/admin/missing.jpg",
        }),
        makeRow({ id: "storage-error", tenantKey: "admin", storagePath: "media/admin/error.jpg" }),
        makeRow({ id: "legacy", tenantKey: "vbs", storagePath: "/app/storage/media/vbs/legacy.jpg" }),
        makeRow({ id: "external", tenantKey: "vbs", storagePath: "https://cdn.example.test/image.jpg" }),
        makeRow({ id: "empty", tenantKey: "vbs", storagePath: "" }),
      ]],
    });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10, localFileProbeEnabled: false });

    expect(result.status).toBe("partial");
    expect(result.totals).toEqual({
      exists: 0,
      missing: 1,
      invalidPath: 2,
      unverifiable: 1,
      storageErrors: 1,
    });
    expect(result.impact).toEqual({
      affectedTenantCount: 2,
      activeProductImpactCount: 1,
    });
    expect(result.byStorageKind).toEqual({
      object_key: 2,
      legacy_local_path: 1,
      empty: 1,
      external_url: 1,
      malformed: 0,
    });
  });

  it("resumes from a persisted cursor without offset pagination", async () => {
    const cursorCreatedAt = new Date("2026-08-24T09:00:00.000Z");
    const { service, db } = makeService({
      count: 2,
      checkpoint: {
        cursorCreatedAt,
        cursorId: "asset-previous",
        cycleStartedAt: new Date("2026-08-24T08:00:00.000Z"),
      },
      rows: [[makeRow({ id: "asset-next", createdAt: new Date("2026-08-24T10:00:00.000Z") })]],
    });

    await service.runBoundedScan({ pageSize: 1, maxRowsPerRun: 1 });

    expect(db.mediaAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { createdAt: { gt: cursorCreatedAt } },
          { createdAt: cursorCreatedAt, id: { gt: "asset-previous" } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 1,
    }));
  });

  it("keeps scanning when one storage probe throws unexpectedly", async () => {
    const probeObjectKey = jest
      .fn()
      .mockRejectedValueOnce(new Error("transient r2 failure"))
      .mockResolvedValueOnce({ status: "exists" });
    const { service } = makeService({
      count: 2,
      probeObjectKey,
      rows: [[
        makeRow({ id: "asset-error", storagePath: "media/admin/error.jpg" }),
        makeRow({ id: "asset-ok", storagePath: "media/admin/ok.jpg" }),
      ]],
    });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(result.status).toBe("partial");
    expect(result.totals.storageErrors).toBe(1);
    expect(result.totals.exists).toBe(1);
    expect(probeObjectKey).toHaveBeenCalledTimes(2);
  });

  it("does not serialize paths, filenames, tenant names, or secrets in the result", async () => {
    const { service } = makeService({
      count: 1,
      rows: [[makeRow({
        id: "asset-sensitive",
        tenantKey: "tenant-sensitive-name",
        storagePath: "/app/storage/media/tenant-sensitive-name/private-file-name.jpg",
      })]],
    });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10, localFileProbeEnabled: false });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("/app/storage");
    expect(serialized).not.toContain("private-file-name");
    expect(serialized).not.toContain("tenant-sensitive-name");
    expect(result.safety).toEqual({
      mediaAssetMutations: false,
      productMutations: false,
      storageWrites: false,
      storageDeletes: false,
      rawPathsIncluded: false,
      fileNamesIncluded: false,
      secretValuesIncluded: false,
    });
  });
});
