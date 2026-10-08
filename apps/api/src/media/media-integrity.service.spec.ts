import { MediaIntegrityService } from "./media-integrity.service";

type Asset = {
  id: string;
  tenantKey: string;
  productId: string | null;
  variantId: string | null;
  storagePath: string;
  createdAt: Date;
  product: { status: string | null; deletedAt: Date | null } | null;
};

function makeRow(overrides: Partial<Asset> = {}): Asset {
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

type Checkpoint = { checkpointKey: string; cursorCreatedAt: Date | null; cursorId: string | null; cycleStartedAt: Date; lastRunId?: string | null; rowsEligible?: number | null };

// SEC-DB-RLS-001 P2.5: media is scanned PER TENANT. The fake database models the properties that matter: the context-free client
// (the base client) sees no media at all, a transaction sees only the media of the tenant whose context it set (as a restricted role
// would), unless `leakAcrossTenants` models a role that bypasses row level security. The platform scan-run and checkpoint tables are
// not row-level-secured and are visible to every client.
function makeService(options: {
  assets?: Asset[];
  directory?: string[];
  checkpoints?: Checkpoint[];
  failTenants?: string[];
  leakAcrossTenants?: boolean;
  directoryError?: Error;
  probeObjectKey?: jest.Mock;
  probeLocalPath?: jest.Mock;
} = {}) {
  const assets = options.assets ?? [];
  const checkpointStore = new Map<string, Checkpoint>((options.checkpoints ?? []).map((c) => [c.checkpointKey, { ...c }]));
  const transactionTenants: string[] = [];
  const mediaReads: Array<{ tenantKey: string; cursor: unknown; take: number }> = [];

  const mediaAssetFor = (visibleTenant: () => string) => ({
    count: jest.fn(async (args: { where?: { tenantKey?: string } } = {}) => {
      const tenant = args.where?.tenantKey;
      if (options.failTenants?.includes(String(tenant))) {
        throw Object.assign(new Error("connection postgres://user:SECRET@host/db reset"), { code: "P1001" });
      }
      return assets.filter((a) => (options.leakAcrossTenants || a.tenantKey === visibleTenant()) && (!tenant || a.tenantKey === tenant)).length;
    }),
    findMany: jest.fn(async (args: { where?: any; take?: number }) => {
      const tenant = args.where?.tenantKey as string | undefined;
      if (options.failTenants?.includes(String(tenant))) {
        throw Object.assign(new Error("connection postgres://user:SECRET@host/db reset"), { code: "P1001" });
      }
      const cursorClause = args.where?.OR as Array<any> | undefined;
      const cursor = cursorClause ? { createdAt: cursorClause[0].createdAt.gt as Date, id: cursorClause[1].id.gt as string } : null;
      mediaReads.push({ tenantKey: String(tenant), cursor, take: Number(args.take) });
      return assets
        .filter((a) => (options.leakAcrossTenants || a.tenantKey === visibleTenant()) && (!tenant || a.tenantKey === tenant))
        .filter((a) => !cursor || a.createdAt > cursor.createdAt || (a.createdAt.getTime() === cursor.createdAt.getTime() && a.id > cursor.id))
        .sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime() || x.id.localeCompare(y.id))
        .slice(0, args.take);
    }),
    update: jest.fn(() => {
      throw new Error("MediaAsset mutation is not allowed in media integrity scans");
    }),
    delete: jest.fn(() => {
      throw new Error("MediaAsset delete is not allowed in media integrity scans");
    }),
  });

  const clientFor = (visibleTenant: () => string): any => ({
    mediaAsset: mediaAssetFor(visibleTenant),
    product: {
      update: jest.fn(() => {
        throw new Error("Product mutation is not allowed in media integrity scans");
      }),
    },
    workspaceDirectory: {
      findMany: jest.fn(async () => {
        if (options.directoryError) {
          throw options.directoryError;
        }
        return (options.directory ?? []).map((tenantKey) => ({ tenantKey }));
      }),
    },
    mediaIntegrityScanRun: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    mediaIntegrityScanCheckpoint: {
      findMany: jest.fn(async (args: { where: { checkpointKey: { startsWith: string } } }) =>
        [...checkpointStore.values()].filter((c) => c.checkpointKey.startsWith(args.where.checkpointKey.startsWith)),
      ),
      upsert: jest.fn(async (args: { where: { checkpointKey: string }; create: Checkpoint; update: Partial<Checkpoint> }) => {
        const existing = checkpointStore.get(args.where.checkpointKey);
        checkpointStore.set(args.where.checkpointKey, existing ? { ...existing, ...args.update } : { ...args.create });
        return {};
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  });

  const base: any = clientFor(() => "default");
  // The context-free client sees no media at all.
  base.mediaAsset = { count: jest.fn(async () => 0), findMany: jest.fn(async () => []), update: jest.fn(), delete: jest.fn() };
  base.$transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    let tenant = "default";
    const tx = clientFor(() => tenant);
    tx.$queryRaw = jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (String(strings.join("?")).includes("set_config")) {
        tenant = String(values[0]);
        transactionTenants.push(tenant);
      }
      return [];
    });
    return fn(tx);
  });

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

  const service = new MediaIntegrityService({ getClient: () => base } as never, mediaStorage as never);
  const logger = { error: jest.fn(), warn: jest.fn(), log: jest.fn() };
  (service as unknown as { logger: unknown }).logger = logger;
  return { service, db: base, mediaStorage, checkpointStore, transactionTenants, mediaReads, logger };
}

const CP = (tenantKey: string, extra: Partial<Checkpoint> = {}): Checkpoint => ({
  checkpointKey: `media-integrity:default::${tenantKey}`,
  cursorCreatedAt: null,
  cursorId: null,
  cycleStartedAt: new Date("2026-08-20T00:00:00.000Z"),
  ...extra,
});

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

  it("keeps capped scans partial and advances the tenant's stable cursor", async () => {
    const assets = [
      makeRow({ id: "asset-1", createdAt: new Date("2026-08-24T10:00:00.000Z") }),
      makeRow({ id: "asset-2", createdAt: new Date("2026-08-24T10:01:00.000Z") }),
      makeRow({ id: "asset-3", createdAt: new Date("2026-08-24T10:02:00.000Z") }),
    ];
    const { service, db, checkpointStore } = makeService({ assets, directory: ["admin"] });

    const result = await service.runBoundedScan({ pageSize: 1, maxRowsPerRun: 2 });

    expect(result.status).toBe("partial");
    expect(result.coverage).toEqual({
      complete: false,
      rowsExamined: 2,
      rowsEligible: 3,
      truncated: true,
      continuationPending: true,
    });
    expect(db.mediaIntegrityScanRun.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        rowsExamined: 2,
        rowsEligible: 3,
        coverageComplete: false,
        continuationPending: true,
      }),
    }));
    // the cursor lives in the tenant's own checkpoint, not in one global one
    expect(checkpointStore.get("media-integrity:default::admin")).toMatchObject({ cursorId: "asset-2", rowsEligible: 3 });
  });

  it("reports ok only for complete clean coverage", async () => {
    const { service, checkpointStore } = makeService({ assets: [makeRow()], directory: ["admin"] });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(result.status).toBe("ok");
    expect(result.coverage).toMatchObject({ complete: true, rowsExamined: 1, rowsEligible: 1, continuationPending: false });
    expect(result.impact.unreadableTenantCount).toBe(0);
    // a finished cycle clears the tenant's cursor
    expect(checkpointStore.get("media-integrity:default::admin")).toMatchObject({ cursorCreatedAt: null, cursorId: null });
  });

  it("separates missing, unavailable, invalid, and unverifiable states", async () => {
    const assets = [
      makeRow({ id: "exists", createdAt: new Date("2026-08-24T10:00:00.000Z"), storagePath: "media/admin/exists.jpg" }),
      makeRow({ id: "missing", createdAt: new Date("2026-08-24T10:01:00.000Z"), storagePath: "media/admin/missing.jpg", productId: "p1", product: { status: "approved", deletedAt: null } }),
      makeRow({ id: "storage-error", createdAt: new Date("2026-08-24T10:02:00.000Z"), storagePath: "media/admin/storage-error.jpg" }),
      makeRow({ id: "invalid", createdAt: new Date("2026-08-24T10:03:00.000Z"), storagePath: "https://cdn.example.test/a.jpg" }),
      makeRow({ id: "local", createdAt: new Date("2026-08-24T10:04:00.000Z"), storagePath: "/app/storage/media/admin/local.jpg" }),
    ];
    const probeObjectKey = jest.fn(async (key: string) => {
      if (key.endsWith("missing.jpg")) return { status: "missing" };
      if (key.endsWith("storage-error.jpg")) return { status: "storage_error" };
      return { status: "exists" };
    });
    const { service } = makeService({ assets, directory: ["admin"], probeObjectKey });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(result.totals).toEqual({ exists: 1, missing: 1, invalidPath: 1, unverifiable: 1, storageErrors: 1 });
    expect(result.byStorageKind).toMatchObject({ object_key: 3, external_url: 1, legacy_local_path: 1 });
    expect(result.impact).toMatchObject({ affectedTenantCount: 1, activeProductImpactCount: 1, unreadableTenantCount: 0 });
    expect(result.status).toBe("partial");
  });

  it("resumes from a persisted per-tenant cursor without offset pagination", async () => {
    const assets = [
      makeRow({ id: "asset-1", createdAt: new Date("2026-08-24T10:00:00.000Z") }),
      makeRow({ id: "asset-2", createdAt: new Date("2026-08-24T10:01:00.000Z") }),
      makeRow({ id: "asset-3", createdAt: new Date("2026-08-24T10:02:00.000Z") }),
    ];
    const { service, mediaReads } = makeService({
      assets,
      directory: ["admin"],
      checkpoints: [CP("admin", { cursorCreatedAt: new Date("2026-08-24T10:01:00.000Z"), cursorId: "asset-2" })],
    });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(mediaReads[0].cursor).toEqual({ createdAt: new Date("2026-08-24T10:01:00.000Z"), id: "asset-2" });
    expect(result.coverage.rowsExamined).toBe(1);
    // continuing a cycle is never reported as a complete pass
    expect(result.coverage.complete).toBe(false);
  });

  it("keeps scanning when one storage probe throws unexpectedly", async () => {
    const assets = [
      makeRow({ id: "asset-1", createdAt: new Date("2026-08-24T10:00:00.000Z"), storagePath: "media/admin/one.jpg" }),
      makeRow({ id: "asset-2", createdAt: new Date("2026-08-24T10:01:00.000Z"), storagePath: "media/admin/two.jpg" }),
    ];
    const probeObjectKey = jest.fn()
      .mockRejectedValueOnce(new Error("probe exploded"))
      .mockResolvedValueOnce({ status: "exists" });
    const { service } = makeService({ assets, directory: ["admin"], probeObjectKey });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(result.totals).toMatchObject({ exists: 1, storageErrors: 1 });
    expect(result.coverage.rowsExamined).toBe(2);
  });

  it("does not serialize paths, filenames, tenant names, or secrets in the result", async () => {
    const { service } = makeService({
      assets: [makeRow({ tenantKey: "secret-tenant-name", storagePath: "media/secret-tenant-name/private-file-name.jpg" })],
      directory: ["secret-tenant-name"],
      probeObjectKey: jest.fn().mockResolvedValue({ status: "missing" }),
    });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("secret-tenant-name");
    expect(serialized).not.toContain("private-file-name");
    expect(serialized).not.toContain("media/");
  });

  // ---- SEC-DB-RLS-001 P2.5: per-tenant scanning --------------------------------------------------------------------------------

  it("scans the media of every non-default directory tenant, not only the default tenant (the silent empty scan)", async () => {
    const assets = [
      makeRow({ id: "d1", tenantKey: "default", createdAt: new Date("2026-08-24T10:00:00.000Z") }),
      makeRow({ id: "b1", tenantKey: "tenant-b", createdAt: new Date("2026-08-24T10:01:00.000Z") }),
      makeRow({ id: "b2", tenantKey: "tenant-b", createdAt: new Date("2026-08-24T10:02:00.000Z") }),
      makeRow({ id: "c1", tenantKey: "tenant-c", createdAt: new Date("2026-08-24T10:03:00.000Z") }),
    ];
    const { service, mediaStorage, transactionTenants } = makeService({ assets, directory: ["tenant-b", "tenant-c"] });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(result.coverage).toMatchObject({ complete: true, rowsExamined: 4, rowsEligible: 4 });
    expect(mediaStorage.probeObjectKey).toHaveBeenCalledTimes(4);
    expect([...new Set(transactionTenants)].sort()).toEqual(["default", "tenant-b", "tenant-c"]);
    expect(result.status).toBe("ok");
  });

  it("MUTATION: the old single read through the context-free client sees no media, and would have reported an empty scan", async () => {
    const { db } = makeService({ assets: [makeRow({ tenantKey: "tenant-b" })], directory: ["tenant-b"] });
    expect(await db.mediaAsset.count()).toBe(0);
    expect(await db.mediaAsset.findMany({})).toEqual([]);
  });

  it("reads each page inside that tenant's own transaction and filters it by that tenant", async () => {
    const { service, mediaReads } = makeService({
      assets: [makeRow({ id: "b1", tenantKey: "tenant-b" }), makeRow({ id: "c1", tenantKey: "tenant-c" })],
      directory: ["tenant-b", "tenant-c"],
    });
    await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });
    expect(mediaReads.map((r) => r.tenantKey).sort()).toEqual(["tenant-b", "tenant-c"]);
  });

  it("with a role that bypasses row level security, each tenant's media is still scanned only once", async () => {
    const assets = [
      makeRow({ id: "d1", tenantKey: "default", createdAt: new Date("2026-08-24T10:00:00.000Z") }),
      makeRow({ id: "b1", tenantKey: "tenant-b", createdAt: new Date("2026-08-24T10:01:00.000Z") }),
    ];
    const { service, mediaStorage } = makeService({ assets, directory: ["tenant-b"], leakAcrossTenants: true });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(mediaStorage.probeObjectKey).toHaveBeenCalledTimes(2);
    expect(result.coverage.rowsExamined).toBe(2);
  });

  it("applies the per-run row budget across tenants and leaves unreached tenants' cursors untouched", async () => {
    const assets = [
      makeRow({ id: "b1", tenantKey: "tenant-b", createdAt: new Date("2026-08-24T10:00:00.000Z") }),
      makeRow({ id: "b2", tenantKey: "tenant-b", createdAt: new Date("2026-08-24T10:01:00.000Z") }),
      makeRow({ id: "c1", tenantKey: "tenant-c", createdAt: new Date("2026-08-24T10:02:00.000Z") }),
    ];
    const { service, checkpointStore } = makeService({ assets, directory: ["tenant-b", "tenant-c"] });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 2 });

    expect(result.coverage).toMatchObject({ complete: false, rowsExamined: 2, rowsEligible: 3, continuationPending: true, truncated: true });
    expect(checkpointStore.has("media-integrity:default::tenant-c")).toBe(false);
  });

  it("visits the least recently completed tenant first, so a finished tenant cannot starve the others", async () => {
    const assets = [
      makeRow({ id: "b1", tenantKey: "tenant-b", createdAt: new Date("2026-08-24T10:00:00.000Z") }),
      makeRow({ id: "c1", tenantKey: "tenant-c", createdAt: new Date("2026-08-24T10:01:00.000Z") }),
    ];
    const { service, mediaReads } = makeService({
      assets,
      directory: ["tenant-b", "tenant-c"],
      // tenant-b completed a cycle recently, tenant-c long ago, the default tenant has never been scanned
      checkpoints: [CP("tenant-b", { cycleStartedAt: new Date("2026-08-24T09:00:00.000Z") }), CP("tenant-c", { cycleStartedAt: new Date("2026-08-01T00:00:00.000Z") })],
    });

    await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 1 });

    // budget of one row: tenant-c (oldest) is read, tenant-b is not
    expect(mediaReads.map((r) => r.tenantKey)).toEqual(["tenant-c"]);
  });

  it("one unreadable tenant does not hide the others: the run is partial, counts it, logs it by code and never by message", async () => {
    const assets = [
      makeRow({ id: "b1", tenantKey: "tenant-b", createdAt: new Date("2026-08-24T10:00:00.000Z") }),
      makeRow({ id: "c1", tenantKey: "tenant-c", createdAt: new Date("2026-08-24T10:01:00.000Z") }),
    ];
    const { service, mediaStorage, logger, checkpointStore } = makeService({ assets, directory: ["tenant-b", "tenant-c"], failTenants: ["tenant-b"] });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(mediaStorage.probeObjectKey).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("partial");
    expect(result.coverage.complete).toBe(false);
    expect(result.impact.unreadableTenantCount).toBe(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logger.error.mock.calls)).toContain("tenant-b");
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("SECRET");
    expect(checkpointStore.has("media-integrity:default::tenant-b")).toBe(false);
  });

  it("a directory read failure marks the run failed instead of quietly scanning only the default tenant", async () => {
    const { service, db } = makeService({ directoryError: new Error("directory unreadable"), assets: [makeRow({ tenantKey: "default" })] });

    const result = await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });

    expect(result.status).toBe("failed");
    expect(db.mediaIntegrityScanRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "failed", errorMessage: "directory unreadable" }) }),
    );
  });

  it("never mutates media, products or storage", async () => {
    const { service, db, mediaStorage } = makeService({ assets: [makeRow({ tenantKey: "tenant-b" })], directory: ["tenant-b"] });
    await service.runBoundedScan({ pageSize: 10, maxRowsPerRun: 10 });
    expect(db.mediaAsset.update).not.toHaveBeenCalled();
    expect(db.mediaAsset.delete).not.toHaveBeenCalled();
    expect(mediaStorage.upload).not.toHaveBeenCalled();
    expect(mediaStorage.delete).not.toHaveBeenCalled();
  });
});
