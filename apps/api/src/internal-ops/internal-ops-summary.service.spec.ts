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
      count: jest.fn((args: { where?: { status?: string | { in: string[] }; updatedAt?: unknown; lastValidationOutcome?: string } }) => {
        if (overrides?.failReadinessConnector && args.where?.lastValidationOutcome === "INDETERMINATE") {
          return Promise.reject(new Error("connector readiness aggregate failed"));
        }
        if (overrides?.empty) {
          return Promise.resolve(0);
        }
        // Only ACTIVE installations are counted, so an expired one is never counted twice.
        if (args.where?.lastValidationOutcome === "INDETERMINATE") return Promise.resolve(args.where.status === "ACTIVE" ? 4 : 99);
        if (args.where?.lastValidationOutcome === "CONFIGURATION_ERROR") return Promise.resolve(args.where.status === "ACTIVE" ? 1 : 99);
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
    mediaIntegrityScanRun: {
      findFirst: jest.fn(() => Promise.resolve(overrides?.empty ? null : {
        id: "scan-run-1",
        status: "partial",
        startedAt: new Date("2026-08-24T10:00:00.000Z"),
        completedAt: new Date("2026-08-24T10:01:00.000Z"),
        coverageComplete: false,
        rowsExamined: 40,
        rowsEligible: 42,
        continuationPending: true,
        totals: {
          missing: 1,
          invalidPath: 2,
          unverifiable: 3,
          storageErrors: 4,
          storagePath: "/app/storage/media/customer/private-file.jpg",
        },
        impact: {
          affectedTenantCount: 2,
          activeProductImpactCount: 1,
          tenantKey: "customer-private",
        },
      })),
    },
  };
  return {
    tx,
    client: {
      // SEC-DB-RLS-001 P2.6a: the cards read per tenant. An empty directory leaves the default tenant only, so these cases are the
      // single-tenant case of the merge; the multi-tenant cases are further down.
      workspaceDirectory: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: (txArg: typeof tx) => Promise<unknown>, _options?: unknown) => fn(tx)),
      mediaIntegrityScanRun: tx.mediaIntegrityScanRun,
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
        affectedTenants: 1, // one tenant (the default) in this single-tenant case; was a platform-wide DISTINCT count
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
        inconclusiveInstallations: 4,
        configurationProblemInstallations: 1,
        affectedTenants: 1, // one tenant (the default) in this single-tenant case; was a platform-wide DISTINCT count
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
      latestRun: {
        runId: "scan-run-1",
        status: "partial",
        startedAt: "2026-08-24T10:00:00.000Z",
        completedAt: "2026-08-24T10:01:00.000Z",
        coverageComplete: false,
        rowsExamined: 40,
        rowsEligible: 42,
        continuationPending: true,
        totals: {
          missing: 1,
          invalidPath: 2,
          unverifiable: 3,
          storageErrors: 4,
        },
        impact: {
          affectedTenantCount: 2,
          activeProductImpactCount: 1,
        },
      },
      orphanDetectionIncluded: false,
    }));
    expect(JSON.stringify(summary.mediaIntegrity)).not.toContain("/app/storage");
    expect(JSON.stringify(summary.mediaIntegrity)).not.toContain("customer-private");
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
        inconclusiveInstallations: 0,
        configurationProblemInstallations: 0,
        affectedTenants: 0,
        byStatus: [],
      }),
    }));
    expect(summary.errors.p0p1OpenCount).toBe(0);
    expect(summary.mediaIntegrity.totalAssets).toBe(0);
    expect(summary.mediaIntegrity.latestRun).toBeNull();
  });

  it("isolates one unavailable dependency to its card", async () => {
    const { service, logger } = makeService({ failMedia: true });

    const summary = await service.getSummary();

    expect(summary.jobs.availability).toBe("available");
    expect(summary.mediaIntegrity).toEqual(expect.objectContaining({
      availability: "unavailable",
      totalAssets: 0,
      latestRun: null,
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
      inconclusiveInstallations: null,
      configurationProblemInstallations: null,
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
    const controller = new InternalOpsController(service as never, {} as never);

    await expect(controller.getSummary({ pimRole: "admin" } as never)).resolves.toEqual({ asOf: "now" });
  });

  it.each(["editor", "publisher", "viewer", "connector_admin", undefined])(
    "denies %s app-role even when a request reaches the controller",
    async (pimRole) => {
      const service = { getSummary: jest.fn() };
      const controller = new InternalOpsController(service as never, {} as never);

      expect(() => controller.getSummary({ pimRole } as never)).toThrow(ForbiddenException);
      expect(service.getSummary).not.toHaveBeenCalled();
    },
  );
});

// ---- SEC-DB-RLS-001 P2.6a: the cards read per tenant and merge ----------------------------------------------------------------------
// Each query answers according to the tenant in ITS OWN filter (the fake throws if a query carries none), and the context-free client
// sees nothing at all, as a restricted role with no tenant context would. The figures must come out as the sums over tenants.
type TenantData = {
  exportByStatus?: Record<string, number>;
  importJobByStatus?: Record<string, number>;
  submissionByStatus?: Record<string, number>;
  stuckExports?: number;
  stuckImports?: number;
  activeRuns?: number;
  runFailed?: number;
  runDlq?: number;
  jobFailed?: number;
  jobDlq?: number;
  connectors?: Record<string, number>;
  inconclusive?: number;
  configProblem?: number;
  issuesError?: number;
  issuesWarning?: number;
  issuesOpen?: number;
  blockedProducts?: number;
  rules?: Array<{ ruleCode: string; severity: string; count: number }>;
  mappingBlocking?: number;
  mappingWarning?: number;
  mappingAffected?: number;
  mediaAssets?: number;
};

function makeMultiTenantService(data: Record<string, TenantData>, options: { failTenants?: string[]; failIn?: string } = {}) {
  const untenantedQueries: string[] = [];
  const tenantOf = (name: string, args: { where?: { tenantKey?: string } }): string => {
    const tenantKey = args.where?.tenantKey;
    if (!tenantKey) {
      untenantedQueries.push(name);
      throw new Error("query without a tenant filter: " + name);
    }
    if (options.failTenants?.includes(tenantKey) && (!options.failIn || options.failIn === name)) {
      throw Object.assign(new Error("connection postgres://user:SECRET@host/db reset"), { code: "P1001" });
    }
    return tenantKey;
  };
  const rowsFor = (record: Record<string, number> | undefined, statuses: string[]) =>
    Object.entries(record ?? {}).filter(([status]) => statuses.includes(status)).map(([status, count]) => ({ status, _count: { _all: count } }));

  const makeTx = () => ({
    $queryRaw: jest.fn(async (first: unknown) => {
      if (Array.isArray(first)) {
        return [];
      }
      const sql = first as { values: unknown[] };
      const tenantKey = String(sql.values[0]);
      return [{ count: data[tenantKey]?.blockedProducts ?? 0 }];
    }),
    marketplaceExportJob: {
      groupBy: jest.fn(async (args: any) => rowsFor(data[tenantOf("exportGroupBy", args)]?.exportByStatus, args.where.status.in)),
      count: jest.fn(async (args: any) => data[tenantOf("exportCount", args)]?.stuckExports ?? 0),
    },
    bulkImportJob: {
      groupBy: jest.fn(async (args: any) => rowsFor(data[tenantOf("importGroupBy", args)]?.importJobByStatus, args.where.status.in)),
      count: jest.fn(async (args: any) => data[tenantOf("importCount", args)]?.stuckImports ?? 0),
      aggregate: jest.fn(async (args: any) => {
        const t = data[tenantOf("importJobAggregate", args)];
        return { _sum: { failedRows: t?.jobFailed ?? null, deadLetterRows: t?.jobDlq ?? null } };
      }),
    },
    bulkImportRun: {
      count: jest.fn(async (args: any) => data[tenantOf("runCount", args)]?.activeRuns ?? 0),
      aggregate: jest.fn(async (args: any) => {
        const t = data[tenantOf("runAggregate", args)];
        return { _sum: { failedRows: t?.runFailed ?? null, deadLetterRows: t?.runDlq ?? null } };
      }),
    },
    connectorSubmission: {
      groupBy: jest.fn(async (args: any) => rowsFor(data[tenantOf("submissionGroupBy", args)]?.submissionByStatus, args.where.status.in)),
    },
    validationIssue: {
      count: jest.fn(async (args: any) => {
        const t = data[tenantOf("issueCount", args)];
        if (args.where.severity === "error") return t?.issuesError ?? 0;
        if (args.where.severity === "warning") return t?.issuesWarning ?? 0;
        return t?.issuesOpen ?? 0;
      }),
      groupBy: jest.fn(async (args: any) => {
        const t = data[tenantOf("issueGroupBy", args)];
        return (t?.rules ?? []).map((rule) => ({ ruleCode: rule.ruleCode, severity: rule.severity, _count: { ruleCode: rule.count } }));
      }),
    },
    connectorMappingVersion: {
      count: jest.fn(async (args: any) => {
        const t = data[tenantOf("mappingCount", args)];
        const where = args.where;
        if (Array.isArray(where.OR)) return where.OR.length === 3 ? (t?.mappingBlocking ?? 0) : (t?.mappingAffected ?? 0);
        if (typeof where.compatibilityState === "object") return t?.mappingWarning ?? 0;
        return 0;
      }),
    },
    connectorInstallation: {
      count: jest.fn(async (args: any) => {
        const t = data[tenantOf("installationCount", args)];
        if (args.where.lastValidationOutcome === "INDETERMINATE") return t?.inconclusive ?? 0;
        if (args.where.lastValidationOutcome === "CONFIGURATION_ERROR") return t?.configProblem ?? 0;
        return t?.connectors?.[String(args.where.status)] ?? 0;
      }),
    },
    mediaAsset: {
      count: jest.fn(async (args: any) => data[tenantOf("mediaCount", args)]?.mediaAssets ?? 0),
    },
    mediaIntegrityScanRun: { findFirst: jest.fn(async () => null) },
  });

  const contextFree = {
    mediaIntegrityScanRun: { findFirst: jest.fn(async () => null) },
    marketplaceExportJob: { groupBy: jest.fn(async () => []), count: jest.fn(async () => 0) },
    validationIssue: { count: jest.fn(async () => 0), groupBy: jest.fn(async () => []) },
    connectorInstallation: { count: jest.fn(async () => 0) },
  };
  const client = {
    ...contextFree,
    workspaceDirectory: { findMany: jest.fn().mockResolvedValue(Object.keys(data).filter((key) => key !== "default").map((tenantKey) => ({ tenantKey }))) },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
  };
  const logger = { warn: jest.fn() };
  const observabilityDb = { countOpenP0P1Issues: jest.fn().mockResolvedValue({ count: 0, storageAvailable: true }) };
  const service = new InternalOpsSummaryService({ getClient: () => client } as never, observabilityDb as never, logger as never);
  return { service, client, logger, untenantedQueries };
}

describe("InternalOpsSummaryService — per-tenant reads of RLS-protected data (SEC-DB-RLS-001 P2.6a)", () => {
  const TENANTS: Record<string, TenantData> = {
    default: {
      exportByStatus: { queued: 1, completed: 4, failed: 1 },
      importJobByStatus: { queued: 2, failed: 1 },
      submissionByStatus: { SUCCESS: 5, ERROR: 1 },
      stuckExports: 1,
      activeRuns: 1,
      runFailed: 2,
      jobFailed: 1,
      connectors: { ACTIVE: 3, PAUSED: 1 },
      inconclusive: 1,
      issuesError: 2,
      issuesWarning: 1,
      issuesOpen: 3,
      blockedProducts: 2,
      rules: [{ ruleCode: "GST_HSN_REQUIRED", severity: "error", count: 2 }],
      mappingBlocking: 1,
      mappingAffected: 1,
      mediaAssets: 10,
    },
    "tenant-b": {
      exportByStatus: { processing: 2, completed: 6, dead_letter: 2 },
      importJobByStatus: { retrying: 1, dead_letter: 1 },
      submissionByStatus: { SUCCESS: 3, REJECTED: 2 },
      stuckExports: 2,
      stuckImports: 1,
      activeRuns: 2,
      runFailed: 3,
      runDlq: 1,
      jobDlq: 2,
      connectors: { ACTIVE: 2, CREDENTIAL_EXPIRED: 2, DISABLED: 1 },
      configProblem: 2,
      issuesError: 3,
      issuesWarning: 2,
      issuesOpen: 5,
      blockedProducts: 3,
      rules: [
        { ruleCode: "GST_HSN_REQUIRED", severity: "error", count: 3 },
        { ruleCode: "ATTR_REQUIRED_SIZE", severity: "error", count: 1 },
      ],
      mappingBlocking: 2,
      mappingWarning: 1,
      mappingAffected: 3,
      mediaAssets: 5,
    },
    "tenant-c": {}, // a tenant with no data at all
  };

  it("sums every card over the tenants, although the context-free client sees nothing (the silent all-zero summary)", async () => {
    const { service, client } = makeMultiTenantService(TENANTS);

    const summary = await service.getSummary();

    // jobs: active = queued + processing + retrying over export and import jobs
    expect(summary.jobs).toMatchObject({ availability: "available", active: 1 + 2 + 2 + 1, stuck: 1 + 2 + 1, failed: 1 + 1, deadLetter: 2 + 1 });
    expect(summary.imports).toMatchObject({ availability: "available", activeRuns: 3, failedRows: 2 + 3 + 1, dlqRows: 1 + 2, runFailedRows: 5, jobFailedRows: 1 });
    expect(summary.publishing.exports).toEqual({ success: 10, failed: 3, successRate: Number(((10 / 13) * 100).toFixed(2)) });
    expect(summary.publishing.submissions).toEqual({ success: 8, failed: 3, successRate: Number(((8 / 11) * 100).toFixed(2)) });
    expect(summary.connectors).toMatchObject({ availability: "available", totalInstallations: 3 + 1 + 2 + 2 + 1 });
    expect(summary.mediaIntegrity).toMatchObject({ availability: "available", totalAssets: 15 });
    expect(summary.readiness.productData).toMatchObject({ blockedProducts: 5, blockingIssues: 5, warningIssues: 3 });
    expect(summary.readiness.mapping).toMatchObject({ blockingMappings: 3, warningMappings: 1 });
    expect(summary.readiness.connector).toMatchObject({ blockingInstallations: 2, warningInstallations: 1, inconclusiveInstallations: 1, configurationProblemInstallations: 2 });
    // the context-free client was never asked for any RLS-protected figure
    expect(client.marketplaceExportJob.groupBy).not.toHaveBeenCalled();
    expect(client.validationIssue.count).not.toHaveBeenCalled();
    expect(client.connectorInstallation.count).not.toHaveBeenCalled();
  });

  it("counts affected tenants exactly: the tenants that have the condition, not the sum of their rows", async () => {
    const { service } = makeMultiTenantService(TENANTS);
    const summary = await service.getSummary();
    // open issues: default and tenant-b (tenant-c has none); mappings affected: default and tenant-b; paused/expired connectors: default and tenant-b
    expect(summary.readiness.productData.affectedTenants).toBe(2);
    expect(summary.readiness.mapping.affectedTenants).toBe(2);
    expect(summary.readiness.connector.affectedTenants).toBe(2);
  });

  it("merges the rule families across tenants before taking the platform-wide top", async () => {
    const { service } = makeMultiTenantService(TENANTS);
    const summary = await service.getSummary();
    expect(summary.readiness.productData.topRuleFamilies).toEqual([
      { ruleFamily: "GST_HSN_REQUIRED", impact: "BLOCKER", count: 5 },
      { ruleFamily: "ATTR_REQUIRED_*", impact: "BLOCKER", count: 1 },
    ]);
  });

  it("every query carries its own tenant filter", async () => {
    const { service, untenantedQueries } = makeMultiTenantService(TENANTS);
    await service.getSummary();
    expect(untenantedQueries).toEqual([]);
  });

  it("one unreadable tenant makes the cards that read it unavailable, never a silent undercount, and is logged without the message", async () => {
    const { service, logger } = makeMultiTenantService(TENANTS, { failTenants: ["tenant-b"], failIn: "exportGroupBy" });

    const summary = await service.getSummary();

    expect(summary.jobs.availability).toBe("unavailable");
    expect(summary.jobs.active).toBe(0);
    expect(summary.publishing.availability).toBe("unavailable");
    // a card that does not touch the failing statement is unaffected
    expect(summary.imports.availability).toBe("available");
    expect(summary.connectors.availability).toBe("available");
    const logged = JSON.stringify(logger.warn.mock.calls);
    expect(logged).toContain("tenant-b");
    expect(logged).toContain("P1001");
    expect(logged).not.toContain("SECRET");
  });
});
