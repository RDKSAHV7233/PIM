import { ForbiddenException } from "@nestjs/common";
import { InternalOpsController } from "./internal-ops.controller";
import { InternalOpsSummaryService } from "./internal-ops-summary.service";

function makeDb(overrides?: {
  failMedia?: boolean;
  failReadinessProductData?: boolean;
  failReadinessMapping?: boolean;
  failReadinessConnector?: boolean;
  empty?: boolean;
}) {
  const countDistinct = jest.fn((query: unknown) => {
    const text = String(
      (query as { sql?: string; text?: string; strings?: string[] })?.sql ??
        (query as { text?: string })?.text ??
        (query as { strings?: string[] })?.strings?.join(" ") ??
        query,
    );
    if (text.includes('"ValidationIssue"')) {
      if (overrides?.failReadinessProductData) {
        return Promise.reject(new Error("validation issue distinct aggregate failed"));
      }
      if (overrides?.empty) {
        return Promise.resolve([{ count: 0 }]);
      }
      return Promise.resolve([{ count: text.includes('"productId"') ? 1 : 2 }]);
    }
    if (text.includes("connector_mapping_versions")) {
      if (overrides?.failReadinessMapping) {
        return Promise.reject(new Error("mapping tenant aggregate failed"));
      }
      return Promise.resolve([{ count: overrides?.empty ? 0 : 1 }]);
    }
    if (text.includes("connector_installations")) {
      if (overrides?.failReadinessConnector) {
        return Promise.reject(new Error("connector readiness aggregate failed"));
      }
      return Promise.resolve([{ count: overrides?.empty ? 0 : 2 }]);
    }
    return Promise.resolve([{ count: 0 }]);
  });
  const tx = {
    $queryRaw: countDistinct,
    marketplaceExportJob: {
      groupBy: jest.fn((args: { where?: { status?: { in?: string[] } } }) => {
        const statuses = args.where?.status?.in ?? [];
        if (statuses.includes("completed")) {
          return Promise.resolve(overrides?.empty ? [] : [
            { status: "completed", _count: { _all: 8 } },
            { status: "failed", _count: { _all: 1 } },
            { status: "dead_letter", _count: { _all: 1 } },
          ]);
        }
        return Promise.resolve(overrides?.empty ? [] : [
          { status: "queued", _count: { _all: 2 } },
          { status: "processing", _count: { _all: 3 } },
          { status: "failed", _count: { _all: 4 } },
          { status: "dead_letter", _count: { _all: 5 } },
        ]);
      }),
      count: jest.fn().mockResolvedValue(overrides?.empty ? 0 : 2),
    },
    bulkImportJob: {
      groupBy: jest.fn().mockResolvedValue(overrides?.empty ? [] : [
        { status: "queued", _count: { _all: 7 } },
        { status: "retrying", _count: { _all: 1 } },
        { status: "failed", _count: { _all: 2 } },
        { status: "dead_letter", _count: { _all: 3 } },
      ]),
      count: jest.fn().mockResolvedValue(overrides?.empty ? 0 : 1),
      aggregate: jest.fn().mockResolvedValue(
        overrides?.empty ? { _sum: { failedRows: null, deadLetterRows: null } } : { _sum: { failedRows: 5, deadLetterRows: 2 } },
      ),
    },
    bulkImportRun: {
      count: jest.fn().mockResolvedValue(overrides?.empty ? 0 : 4),
      aggregate: jest.fn().mockResolvedValue(
        overrides?.empty ? { _sum: { failedRows: null, deadLetterRows: null } } : { _sum: { failedRows: 6, deadLetterRows: 3 } },
      ),
    },
    connectorSubmission: {
      groupBy: jest.fn().mockResolvedValue(overrides?.empty ? [] : [
        { status: "SUCCESS", _count: { _all: 9 } },
        { status: "ERROR", _count: { _all: 1 } },
        { status: "REJECTED", _count: { _all: 2 } },
      ]),
    },
    validationIssue: {
      count: jest.fn((args: { where?: { severity?: string } }) => {
        if (overrides?.failReadinessProductData) {
          return Promise.reject(new Error("validation issue count failed"));
        }
        if (overrides?.empty) {
          return Promise.resolve(0);
        }
        return Promise.resolve(args.where?.severity === "warning" ? 3 : 2);
      }),
      groupBy: jest.fn(() => {
        if (overrides?.failReadinessProductData) {
          return Promise.reject(new Error("validation issue rule aggregate failed"));
        }
        return Promise.resolve(overrides?.empty ? [] : [
          { ruleCode: "GST_HSN_REQUIRED", severity: "error", _count: { ruleCode: 1 } },
          { ruleCode: "ATTR_REQUIRED_SECRET_SIZE", severity: "error", _count: { ruleCode: 2 } },
          { ruleCode: "CUSTOMER_SECRET_RULE_123", severity: "warning", _count: { ruleCode: 3 } },
        ]);
      }),
    },
    connectorMappingVersion: {
      count: jest.fn((args: { where?: Record<string, unknown> }) => {
        if (overrides?.failReadinessMapping) {
          return Promise.reject(new Error("mapping aggregate failed"));
        }
        if (overrides?.empty) {
          return Promise.resolve(0);
        }
        const where = args.where ?? {};
        if (Array.isArray(where.OR)) {
          return Promise.resolve(1);
        }
        const compatibilityState = where.compatibilityState;
        if (compatibilityState === "blocked") return Promise.resolve(0);
        if (compatibilityState === "remap_required") return Promise.resolve(1);
        if (compatibilityState === "deprecated") return Promise.resolve(1);
        if (typeof compatibilityState === "object") return Promise.resolve(1);
        if (where.fallbackAckRequired === true) return Promise.resolve(1);
        return Promise.resolve(0);
      }),
    },
    connectorInstallation: {
      count: jest.fn((args: { where?: { status?: string; updatedAt?: unknown } }) => {
        if (overrides?.empty) {
          return Promise.resolve(0);
        }
        const counts: Record<string, number> = {
          ACTIVE: 10,
          CREDENTIAL_EXPIRED: 1,
          DISABLED: 3,
          PAUSED: 2,
        };
        return Promise.resolve(counts[String(args.where?.status ?? "")] ?? 0);
      }),
      groupBy: jest.fn().mockResolvedValue(overrides?.empty ? [] : [
        { status: "ACTIVE", _count: { _all: 10 } },
        { status: "PAUSED", _count: { _all: 2 } },
        { status: "CREDENTIAL_EXPIRED", _count: { _all: 1 } },
        { status: "DISABLED", _count: { _all: 3 } },
      ]),
    },
    mediaAsset: {
      count: jest.fn(() => {
        if (overrides?.failMedia) {
          return Promise.reject(new Error("media unavailable"));
        }
        return Promise.resolve(overrides?.empty ? 0 : 42);
      }),
    },
  };
  return {
    tx,
    client: {
      $transaction: jest.fn((fn: (txArg: typeof tx) => Promise<unknown>, _options?: unknown) => fn(tx)),
    },
  };
}

function makeService(overrides?: {
  failMedia?: boolean;
  failReadinessProductData?: boolean;
  failReadinessMapping?: boolean;
  failReadinessConnector?: boolean;
  empty?: boolean;
  errorStorage?: boolean;
}) {
  const db = makeDb(overrides);
  const prismaDirect = { getClient: jest.fn().mockReturnValue(db.client) };
  const observabilityDb = {
    countOpenP0P1Issues: jest.fn().mockResolvedValue({
      count: overrides?.empty ? 0 : 3,
      storageAvailable: overrides?.errorStorage ?? true,
    }),
  };
  const logger = { warn: jest.fn() };
  return {
    service: new InternalOpsSummaryService(prismaDirect as never, observabilityDb as never, logger as never),
    db,
    observabilityDb,
    logger,
  };
}

describe("InternalOpsSummaryService", () => {
  it("aggregates each Increment 1 card from bounded read models", async () => {
    const { service, db, observabilityDb } = makeService();

    const summary = await service.getSummary();

    expect(summary.jobs).toEqual(expect.objectContaining({
      availability: "available",
      active: 13,
      stuck: 3,
      failed: 6,
      deadLetter: 8,
    }));
    expect(summary.imports).toEqual(expect.objectContaining({
      availability: "available",
      activeRuns: 4,
      failedRows: 11,
      dlqRows: 5,
    }));
    expect(summary.publishing.exports).toEqual({ success: 8, failed: 2, successRate: 80 });
    expect(summary.publishing.submissions).toEqual({ success: 9, failed: 3, successRate: 75 });
    expect(summary.connectors).toEqual(expect.objectContaining({
      totalInstallations: 16,
      byStatus: [
        { status: "active", count: 10 },
        { status: "paused", count: 2 },
        { status: "credential_expired", count: 1 },
        { status: "disabled", count: 3 },
      ],
    }));
    expect(summary.readiness).toEqual(expect.objectContaining({
      availability: "available",
      message: null,
      productData: expect.objectContaining({
        availability: "available",
        blockedProducts: 1,
        blockingIssues: 2,
        warningIssues: 3,
        affectedTenants: 2,
        topRuleFamilies: [
          { ruleFamily: "CUSTOM_RULE", impact: "WARNING", count: 3 },
          { ruleFamily: "ATTR_REQUIRED_*", impact: "BLOCKER", count: 2 },
          { ruleFamily: "GST_HSN_REQUIRED", impact: "BLOCKER", count: 1 },
        ],
      }),
      mapping: expect.objectContaining({
        availability: "available",
        blockingMappings: 1,
        warningMappings: 1,
        affectedTenants: 1,
        signals: {
          compatibilityBlocked: 0,
          remapRequired: 1,
          fallbackAckRequired: 1,
          deprecated: 1,
        },
      }),
      connector: expect.objectContaining({
        availability: "available",
        blockingInstallations: 1,
        warningInstallations: 2,
        affectedTenants: 2,
        byStatus: [
          { status: "ACTIVE", impact: "STATUS", count: 10 },
          { status: "PAUSED", impact: "WARNING", count: 2 },
          { status: "CREDENTIAL_EXPIRED", impact: "BLOCKER", count: 1 },
          { status: "DISABLED", impact: "STATUS", count: 3 },
        ],
      }),
    }));
    expect(JSON.stringify(summary.readiness)).not.toContain("CUSTOMER_SECRET_RULE_123");
    expect(summary.errors).toEqual(expect.objectContaining({
      availability: "available",
      p0p1OpenCount: 3,
      href: "/internal/ops/errors",
    }));
    expect(summary.mediaIntegrity).toEqual(expect.objectContaining({
      totalAssets: 42,
      orphanDetectionIncluded: false,
    }));
    expect(summary.windows.operational.dateFrom).toBeTruthy();
    expect(summary.windows.inventory.dateFrom).toBeTruthy();
    expect(summary.windows.queryTimeoutMs).toBe(2500);
    expect(db.client.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
    expect(observabilityDb.countOpenP0P1Issues).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 2500 }));
  });

  it("returns deterministic zero-count empty state", async () => {
    const { service } = makeService({ empty: true });

    const summary = await service.getSummary();

    expect(summary.jobs.active).toBe(0);
    expect(summary.imports.failedRows).toBe(0);
    expect(summary.publishing.exports.successRate).toBe(0);
    expect(summary.connectors.byStatus).toEqual([]);
    expect(summary.readiness).toEqual(expect.objectContaining({
      availability: "available",
      productData: expect.objectContaining({
        blockedProducts: 0,
        blockingIssues: 0,
        warningIssues: 0,
        affectedTenants: 0,
        topRuleFamilies: [],
      }),
      mapping: expect.objectContaining({
        blockingMappings: 0,
        warningMappings: 0,
        affectedTenants: 0,
        signals: {
          compatibilityBlocked: 0,
          remapRequired: 0,
          fallbackAckRequired: 0,
          deprecated: 0,
        },
      }),
      connector: expect.objectContaining({
        blockingInstallations: 0,
        warningInstallations: 0,
        affectedTenants: 0,
        byStatus: [],
      }),
    }));
    expect(summary.errors.p0p1OpenCount).toBe(0);
    expect(summary.mediaIntegrity.totalAssets).toBe(0);
  });

  it("isolates one unavailable dependency to its card", async () => {
    const { service, logger } = makeService({ failMedia: true });

    const summary = await service.getSummary();

    expect(summary.jobs.availability).toBe("available");
    expect(summary.mediaIntegrity).toEqual(expect.objectContaining({
      availability: "unavailable",
      totalAssets: 0,
      errorMessage: "Summary source unavailable",
    }));
    expect(logger.warn).toHaveBeenCalledWith(
      "Internal ops summary card unavailable.",
      expect.objectContaining({ card: "media_integrity" }),
    );
  });

  it("returns partial readiness when one persisted readiness source is unavailable", async () => {
    const { service, logger } = makeService({ failReadinessConnector: true });

    const summary = await service.getSummary();

    expect(summary.readiness.availability).toBe("partial");
    expect(summary.readiness.message).toBe("One or more readiness sources are unavailable");
    expect(summary.readiness.productData.availability).toBe("available");
    expect(summary.readiness.mapping.availability).toBe("available");
    expect(summary.readiness.connector).toEqual(expect.objectContaining({
      availability: "unavailable",
      blockingInstallations: null,
      warningInstallations: null,
      affectedTenants: null,
      byStatus: null,
    }));
    expect(logger.warn).toHaveBeenCalledWith(
      "Internal ops summary card unavailable.",
      expect.objectContaining({ card: "readiness_connector" }),
    );
  });

  it("returns unavailable readiness when every persisted readiness source is unavailable", async () => {
    const { service } = makeService({
      failReadinessProductData: true,
      failReadinessMapping: true,
      failReadinessConnector: true,
    });

    const summary = await service.getSummary();

    expect(summary.readiness.availability).toBe("unavailable");
    expect(summary.readiness.message).toBe("One or more readiness sources are unavailable");
    expect(summary.readiness.productData.availability).toBe("unavailable");
    expect(summary.readiness.mapping.availability).toBe("unavailable");
    expect(summary.readiness.connector.availability).toBe("unavailable");
  });
});

describe("InternalOpsController", () => {
  it("allows admin app-role after boundary decorators pass", async () => {
    const service = { getSummary: jest.fn().mockResolvedValue({ asOf: "now" }) };
    const controller = new InternalOpsController(service as never);

    await expect(controller.getSummary({ pimRole: "admin" } as never)).resolves.toEqual({ asOf: "now" });
  });

  it.each(["editor", "publisher", "viewer", "connector_admin", undefined])(
    "denies %s app-role even when a request reaches the controller",
    async (pimRole) => {
      const service = { getSummary: jest.fn() };
      const controller = new InternalOpsController(service as never);

      expect(() => controller.getSummary({ pimRole } as never)).toThrow(ForbiddenException);
      expect(service.getSummary).not.toHaveBeenCalled();
    },
  );
});
