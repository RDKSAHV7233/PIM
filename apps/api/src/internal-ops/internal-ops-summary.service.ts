import { Injectable } from "@nestjs/common";
import {
  BulkImportJobStatus,
  BulkImportRunStatus,
  ExportJobStatus,
  Prisma,
  RuleSeverity,
  ValidationIssueStatus,
} from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { ObservabilityDbService } from "../error-authority/observability-db.service";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import type {
  InternalOpsAggregateAvailability,
  InternalOpsCardAvailability,
  InternalOpsReadinessImpact,
  InternalOpsReadinessRuleFamilyCount,
  InternalOpsStatusCount,
  InternalOpsSummaryResponse,
} from "./internal-ops.types";
import {
  INTERNAL_OPS_STUCK_LOOKBACK_DAYS,
  INTERNAL_OPS_STUCK_THRESHOLD_HOURS,
} from "./internal-ops.constants";

const OPERATIONAL_WINDOW_DAYS = 7;
const INVENTORY_WINDOW_DAYS = 90;
const QUERY_TIMEOUT_MS = 2_500;

const EXPORT_ACTIVE_STATUSES = [ExportJobStatus.queued, ExportJobStatus.processing, ExportJobStatus.retrying] as const;
const IMPORT_JOB_ACTIVE_STATUSES = [
  BulkImportJobStatus.queued,
  BulkImportJobStatus.processing,
  BulkImportJobStatus.retrying,
] as const;
const IMPORT_RUN_ACTIVE_STATUSES = [
  BulkImportRunStatus.uploaded,
  BulkImportRunStatus.validating,
  BulkImportRunStatus.preflight_ready,
  BulkImportRunStatus.processing,
] as const;
const EXPORT_FAILURE_STATUSES = [ExportJobStatus.failed, ExportJobStatus.dead_letter] as const;
const SUBMISSION_FAILURE_STATUSES = ["ERROR", "REJECTED", "SUPPRESSED"] as const;
const CONNECTOR_STATUSES = ["ACTIVE", "PAUSED", "CREDENTIAL_EXPIRED", "DISABLED"] as const;
const MAPPING_BLOCKING_COMPATIBILITY_STATES = ["blocked", "remap_required"] as const;
const MAPPING_WARNING_COMPATIBILITY_STATES = ["deprecated"] as const;
const READINESS_TOP_RULE_FAMILY_LIMIT = 10;
const READINESS_RULE_CODE_GROUP_LIMIT = 50;

const SAFE_PLATFORM_RULE_CODES = new Set([
  "GST_HSN_REQUIRED",
  "GST_HSN_FORMAT",
  "GST_RATE_REQUIRED",
  "GST_RATE_UNCOMMON",
  "PRICING_NO_DEFAULT_PRICES",
  "PRICING_INCOMPLETE",
]);

const CONNECTOR_STATUS_IMPACT: Record<(typeof CONNECTOR_STATUSES)[number], InternalOpsReadinessImpact> = {
  ACTIVE: "STATUS",
  PAUSED: "WARNING",
  CREDENTIAL_EXPIRED: "BLOCKER",
  DISABLED: "STATUS",
};

type StatusGroupRow = {
  status: string;
  _count: {
    _all: number;
  };
};

type SumRows = {
  _sum: {
    failedRows?: number | null;
    deadLetterRows?: number | null;
  };
};

type RuleFamilyGroupRow = {
  ruleCode: string;
  severity: string;
  _count: {
    ruleCode?: number | null;
    _all?: number | null;
  };
};

type CountDistinctRow = {
  count: number | bigint | string | null;
};

@Injectable()
export class InternalOpsSummaryService {
  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly observabilityDb: ObservabilityDbService,
    private readonly logger: LoggerService,
  ) {}

  async getSummary(): Promise<InternalOpsSummaryResponse> {
    const now = new Date();
    const operationalFrom = subtractDays(now, OPERATIONAL_WINDOW_DAYS);
    const inventoryFrom = subtractDays(now, INVENTORY_WINDOW_DAYS);
    const stuckFrom = subtractDays(now, INTERNAL_OPS_STUCK_LOOKBACK_DAYS);
    const stuckBefore = new Date(now.getTime() - INTERNAL_OPS_STUCK_THRESHOLD_HOURS * 60 * 60 * 1000);

    const [jobs, imports, publishing, connectors, readiness, errors, mediaIntegrity] = await Promise.all([
      this.resolveCard("jobs", () => this.getJobs(operationalFrom, stuckFrom, stuckBefore), {
        active: 0,
        stuck: 0,
        failed: 0,
        deadLetter: 0,
        marketplaceExportJobs: [],
        bulkImportJobs: [],
      }),
      this.resolveCard("imports", () => this.getImports(operationalFrom), {
        activeRuns: 0,
        failedRows: 0,
        dlqRows: 0,
        runFailedRows: 0,
        jobFailedRows: 0,
        runDlqRows: 0,
        jobDlqRows: 0,
      }),
      this.resolveCard("publishing", () => this.getPublishing(operationalFrom), {
        exports: { success: 0, failed: 0, successRate: 0 },
        submissions: { success: 0, failed: 0, successRate: 0 },
      }),
      this.resolveCard("connectors", () => this.getConnectors(inventoryFrom), {
        totalInstallations: 0,
        byStatus: [],
      }),
      this.getReadiness(now),
      this.resolveErrorsCard(operationalFrom, now),
      this.resolveCard("media_integrity", () => this.getMediaIntegrity(inventoryFrom), {
        totalAssets: 0,
        orphanDetectionIncluded: false as const,
      }),
    ]);

    return {
      asOf: now.toISOString(),
      windows: {
        operational: {
          dateFrom: operationalFrom.toISOString(),
          dateTo: now.toISOString(),
        },
        inventory: {
          dateFrom: inventoryFrom.toISOString(),
          dateTo: now.toISOString(),
        },
        stuckThresholdHours: INTERNAL_OPS_STUCK_THRESHOLD_HOURS,
        queryTimeoutMs: QUERY_TIMEOUT_MS,
      },
      jobs,
      imports,
      publishing,
      connectors,
      readiness,
      errors,
      mediaIntegrity,
    };
  }

  private async getJobs(operationalFrom: Date, stuckFrom: Date, stuckBefore: Date) {
    return this.withPrimaryDbTimeout(async (db) => {
      const [exportRows, importRows, stuckExports, stuckImports] = await Promise.all([
        db.marketplaceExportJob.groupBy({
          by: ["status"] as const,
          where: {
            updatedAt: { gte: operationalFrom },
            status: { in: [...EXPORT_ACTIVE_STATUSES, ExportJobStatus.failed, ExportJobStatus.dead_letter] },
          },
          _count: { _all: true },
        }),
        db.bulkImportJob.groupBy({
          by: ["status"] as const,
          where: {
            updatedAt: { gte: operationalFrom },
            status: { in: [...IMPORT_JOB_ACTIVE_STATUSES, BulkImportJobStatus.failed, BulkImportJobStatus.dead_letter] },
          },
          _count: { _all: true },
        }),
        db.marketplaceExportJob.count({
          where: {
            status: { in: [...EXPORT_ACTIVE_STATUSES] },
            updatedAt: { gte: stuckFrom, lte: stuckBefore },
          },
        }),
        db.bulkImportJob.count({
          where: {
            status: { in: [...IMPORT_JOB_ACTIVE_STATUSES] },
            updatedAt: { gte: stuckFrom, lte: stuckBefore },
          },
        }),
      ]);

      const exportCounts = statusCounts(exportRows as StatusGroupRow[]);
      const importCounts = statusCounts(importRows as StatusGroupRow[]);
      return {
        active: sumStatuses(exportCounts, EXPORT_ACTIVE_STATUSES) + sumStatuses(importCounts, IMPORT_JOB_ACTIVE_STATUSES),
        stuck: Number(stuckExports ?? 0) + Number(stuckImports ?? 0),
        failed: countFor(exportCounts, ExportJobStatus.failed) + countFor(importCounts, BulkImportJobStatus.failed),
        deadLetter: countFor(exportCounts, ExportJobStatus.dead_letter) + countFor(importCounts, BulkImportJobStatus.dead_letter),
        marketplaceExportJobs: exportCounts,
        bulkImportJobs: importCounts,
      };
    });
  }

  private async getImports(operationalFrom: Date) {
    return this.withPrimaryDbTimeout(async (db) => {
      const [activeRuns, runRows, jobRows] = await Promise.all([
        db.bulkImportRun.count({
          where: {
            updatedAt: { gte: operationalFrom },
            status: { in: [...IMPORT_RUN_ACTIVE_STATUSES] },
          },
        }),
        db.bulkImportRun.aggregate({
          where: {
            updatedAt: { gte: operationalFrom },
          },
          _sum: {
            failedRows: true,
            deadLetterRows: true,
          },
        }),
        db.bulkImportJob.aggregate({
          where: {
            updatedAt: { gte: operationalFrom },
          },
          _sum: {
            failedRows: true,
            deadLetterRows: true,
          },
        }),
      ]);

      const runFailedRows = safeSum(runRows as SumRows, "failedRows");
      const jobFailedRows = safeSum(jobRows as SumRows, "failedRows");
      const runDlqRows = safeSum(runRows as SumRows, "deadLetterRows");
      const jobDlqRows = safeSum(jobRows as SumRows, "deadLetterRows");

      return {
        activeRuns: Number(activeRuns ?? 0),
        failedRows: runFailedRows + jobFailedRows,
        dlqRows: runDlqRows + jobDlqRows,
        runFailedRows,
        jobFailedRows,
        runDlqRows,
        jobDlqRows,
      };
    });
  }

  private async getPublishing(operationalFrom: Date) {
    return this.withPrimaryDbTimeout(async (db) => {
      const [exportRows, submissionRows] = await Promise.all([
        db.marketplaceExportJob.groupBy({
          by: ["status"] as const,
          where: {
            updatedAt: { gte: operationalFrom },
            status: { in: [ExportJobStatus.completed, ...EXPORT_FAILURE_STATUSES] },
          },
          _count: { _all: true },
        }),
        db.connectorSubmission.groupBy({
          by: ["status"] as const,
          where: {
            submittedAt: { gte: operationalFrom },
            status: { in: ["SUCCESS", ...SUBMISSION_FAILURE_STATUSES] },
          },
          _count: { _all: true },
        }),
      ]);

      const exportCounts = statusCounts(exportRows as StatusGroupRow[]);
      const submissionCounts = statusCounts(submissionRows as StatusGroupRow[]);
      const exportSuccess = countFor(exportCounts, ExportJobStatus.completed);
      const exportFailed = sumStatuses(exportCounts, EXPORT_FAILURE_STATUSES);
      const submissionSuccess = countFor(submissionCounts, "SUCCESS");
      const submissionFailed = sumStatuses(submissionCounts, SUBMISSION_FAILURE_STATUSES);

      return {
        exports: {
          success: exportSuccess,
          failed: exportFailed,
          successRate: successRate(exportSuccess, exportFailed),
        },
        submissions: {
          success: submissionSuccess,
          failed: submissionFailed,
          successRate: successRate(submissionSuccess, submissionFailed),
        },
      };
    });
  }

  private async getConnectors(inventoryFrom: Date) {
    return this.withPrimaryDbTimeout(async (db) => {
      const byStatus = await Promise.all(
        CONNECTOR_STATUSES.map(async (status) => ({
          status: status.toLowerCase(),
          count: await db.connectorInstallation.count({
            where: {
              updatedAt: { gte: inventoryFrom },
              status,
            },
          }),
        })),
      ).then((rows) => rows.filter((row) => row.count > 0));
      return {
        totalInstallations: byStatus.reduce((sum, row) => sum + row.count, 0),
        byStatus,
      };
    });
  }

  private async getReadiness(now: Date): Promise<InternalOpsSummaryResponse["readiness"]> {
    const [productData, mapping, connector] = await Promise.all([
      this.resolveReadinessSource("readiness_product_data", () => this.getReadinessProductData(), {
        blockedProducts: null,
        blockingIssues: null,
        warningIssues: null,
        affectedTenants: null,
        topRuleFamilies: null,
      }),
      this.resolveReadinessSource("readiness_mapping", () => this.getReadinessMapping(), {
        blockingMappings: null,
        warningMappings: null,
        affectedTenants: null,
        signals: {
          compatibilityBlocked: null,
          remapRequired: null,
          fallbackAckRequired: null,
          deprecated: null,
        },
      }),
      this.resolveReadinessSource("readiness_connector", () => this.getReadinessConnector(), {
        blockingInstallations: null,
        warningInstallations: null,
        affectedTenants: null,
        byStatus: null,
      }),
    ]);

    const sourceAvailabilities = [productData.availability, mapping.availability, connector.availability];
    const availability = resolveAggregateAvailability(sourceAvailabilities);
    return {
      availability,
      asOf: now.toISOString(),
      message: availability === "available" ? null : "One or more readiness sources are unavailable",
      productData,
      mapping,
      connector,
    };
  }

  private async getReadinessProductData(): Promise<Omit<InternalOpsSummaryResponse["readiness"]["productData"], "availability">> {
    return this.withPrimaryDbTimeout(async (db) => {
      const [blockedProducts, blockingIssues, warningIssues, affectedTenants, ruleRows] = await Promise.all([
        this.countReadinessBlockedProducts(db),
        db.validationIssue.count({
          where: {
            status: ValidationIssueStatus.open,
            severity: RuleSeverity.error,
          },
        }),
        db.validationIssue.count({
          where: {
            status: ValidationIssueStatus.open,
            severity: RuleSeverity.warning,
          },
        }),
        this.countReadinessProductDataTenants(db),
        db.validationIssue.groupBy({
          by: ["ruleCode", "severity"] as const,
          where: { status: ValidationIssueStatus.open },
          _count: { ruleCode: true },
          orderBy: { _count: { ruleCode: "desc" } },
          take: READINESS_RULE_CODE_GROUP_LIMIT,
        }),
      ]);

      return {
        blockedProducts: Number(blockedProducts ?? 0),
        blockingIssues: Number(blockingIssues ?? 0),
        warningIssues: Number(warningIssues ?? 0),
        affectedTenants: Number(affectedTenants ?? 0),
        topRuleFamilies: normalizeRuleFamilyCounts(ruleRows as RuleFamilyGroupRow[]),
      };
    });
  }

  private async getReadinessMapping(): Promise<Omit<InternalOpsSummaryResponse["readiness"]["mapping"], "availability">> {
    return this.withPrimaryDbTimeout(async (db) => {
      const publishedWhere = { lifecycleState: "published" } satisfies Prisma.ConnectorMappingVersionWhereInput;
      const blockingWhere = {
        ...publishedWhere,
        OR: [
          { compatibilityState: "blocked" },
          { compatibilityState: "remap_required" },
          { fallbackAckRequired: true },
        ],
      } satisfies Prisma.ConnectorMappingVersionWhereInput;
      const warningWhere = {
        ...publishedWhere,
        compatibilityState: { in: [...MAPPING_WARNING_COMPATIBILITY_STATES] },
      } satisfies Prisma.ConnectorMappingVersionWhereInput;
      const affectedWhere = {
        ...publishedWhere,
        OR: [
          { compatibilityState: { in: [...MAPPING_BLOCKING_COMPATIBILITY_STATES, ...MAPPING_WARNING_COMPATIBILITY_STATES] } },
          { fallbackAckRequired: true },
        ],
      } satisfies Prisma.ConnectorMappingVersionWhereInput;

      const [
        blockingMappings,
        warningMappings,
        affectedTenants,
        compatibilityBlocked,
        remapRequired,
        fallbackAckRequired,
        deprecated,
      ] = await Promise.all([
        db.connectorMappingVersion.count({ where: blockingWhere }),
        db.connectorMappingVersion.count({ where: warningWhere }),
        this.countReadinessMappingTenants(db),
        db.connectorMappingVersion.count({ where: { ...publishedWhere, compatibilityState: "blocked" } }),
        db.connectorMappingVersion.count({ where: { ...publishedWhere, compatibilityState: "remap_required" } }),
        db.connectorMappingVersion.count({ where: { ...publishedWhere, fallbackAckRequired: true } }),
        db.connectorMappingVersion.count({ where: { ...publishedWhere, compatibilityState: "deprecated" } }),
      ]);

      return {
        blockingMappings: Number(blockingMappings ?? 0),
        warningMappings: Number(warningMappings ?? 0),
        affectedTenants: Number(affectedTenants ?? 0),
        signals: {
          compatibilityBlocked: Number(compatibilityBlocked ?? 0),
          remapRequired: Number(remapRequired ?? 0),
          fallbackAckRequired: Number(fallbackAckRequired ?? 0),
          deprecated: Number(deprecated ?? 0),
        },
      };
    });
  }

  private async getReadinessConnector(): Promise<Omit<InternalOpsSummaryResponse["readiness"]["connector"], "availability">> {
    return this.withPrimaryDbTimeout(async (db) => {
      const [statusCountsResult, affectedTenants] = await Promise.all([
        Promise.all(
          CONNECTOR_STATUSES.map(async (status) => ({
            status,
            impact: CONNECTOR_STATUS_IMPACT[status],
            count: await db.connectorInstallation.count({ where: { status } }),
          })),
        ),
        this.countReadinessConnectorTenants(db),
      ]);
      const byStatus = statusCountsResult
        .filter((row) => row.count > 0)
        .map((row) => ({
          status: row.status,
          impact: row.impact,
          count: Number(row.count ?? 0),
        }));

      return {
        blockingInstallations: countFor(byStatus, "CREDENTIAL_EXPIRED"),
        warningInstallations: countFor(byStatus, "PAUSED"),
        affectedTenants: Number(affectedTenants ?? 0),
        byStatus,
      };
    });
  }

  private async countReadinessBlockedProducts(db: Prisma.TransactionClient): Promise<number> {
    const rows = await db.$queryRaw<CountDistinctRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT "productId")::bigint AS "count"
      FROM "ValidationIssue"
      WHERE "status" = ${ValidationIssueStatus.open}::"ValidationIssueStatus"
        AND "severity" = ${RuleSeverity.error}::"RuleSeverity"
    `);
    return firstCount(rows);
  }

  private async countReadinessProductDataTenants(db: Prisma.TransactionClient): Promise<number> {
    const rows = await db.$queryRaw<CountDistinctRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT "tenantKey")::bigint AS "count"
      FROM "ValidationIssue"
      WHERE "status" = ${ValidationIssueStatus.open}::"ValidationIssueStatus"
    `);
    return firstCount(rows);
  }

  private async countReadinessMappingTenants(db: Prisma.TransactionClient): Promise<number> {
    const rows = await db.$queryRaw<CountDistinctRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT tenant_key)::bigint AS "count"
      FROM connector_mapping_versions
      WHERE lifecycle_state = 'published'
        AND (
          compatibility_state IN (${Prisma.join([...MAPPING_BLOCKING_COMPATIBILITY_STATES, ...MAPPING_WARNING_COMPATIBILITY_STATES])})
          OR fallback_ack_required = true
        )
    `);
    return firstCount(rows);
  }

  private async countReadinessConnectorTenants(db: Prisma.TransactionClient): Promise<number> {
    const rows = await db.$queryRaw<CountDistinctRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT tenant_key)::bigint AS "count"
      FROM connector_installations
      WHERE status IN (${Prisma.join(["PAUSED", "CREDENTIAL_EXPIRED"])})
    `);
    return firstCount(rows);
  }

  private async getMediaIntegrity(inventoryFrom: Date) {
    return this.withPrimaryDbTimeout(async (db) => ({
      totalAssets: await db.mediaAsset.count({
        where: {
          createdAt: { gte: inventoryFrom },
        },
      }),
      orphanDetectionIncluded: false as const,
    }));
  }

  private async resolveErrorsCard(dateFrom: Date, dateTo: Date) {
    try {
      const result = await this.observabilityDb.countOpenP0P1Issues({
        dateFrom,
        dateTo,
        timeoutMs: QUERY_TIMEOUT_MS,
      });
      return {
        availability: result.storageAvailable ? ("available" as const) : ("unavailable" as const),
        p0p1OpenCount: result.count,
        storageAvailable: result.storageAvailable,
        href: "/internal/ops/errors" as const,
        errorMessage: result.storageAvailable ? null : "Error Authority storage unavailable",
      };
    } catch (error: unknown) {
      this.logCardFailure("errors", error);
      return {
        availability: "unavailable" as const,
        p0p1OpenCount: 0,
        storageAvailable: false,
        href: "/internal/ops/errors" as const,
        errorMessage: "Error Authority storage unavailable",
      };
    }
  }

  private async resolveCard<T extends Record<string, unknown>>(
    card: string,
    producer: () => Promise<T>,
    fallback: T,
  ): Promise<T & { availability: InternalOpsCardAvailability; errorMessage: string | null }> {
    try {
      const value = await producer();
      return {
        ...value,
        availability: "available",
        errorMessage: null,
      };
    } catch (error: unknown) {
      this.logCardFailure(card, error);
      return {
        ...fallback,
        availability: "unavailable",
        errorMessage: "Summary source unavailable",
      };
    }
  }

  private async resolveReadinessSource<T extends Record<string, unknown>>(
    source: string,
    producer: () => Promise<T>,
    fallback: T,
  ): Promise<T & { availability: InternalOpsCardAvailability }> {
    try {
      const value = await producer();
      return {
        ...value,
        availability: "available",
      };
    } catch (error: unknown) {
      this.logCardFailure(source, error);
      return {
        ...fallback,
        availability: "unavailable",
      };
    }
  }

  private async withPrimaryDbTimeout<T>(operation: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const db = this.prismaDirect.getClient();
    return db.$transaction(
      async (tx) => operation(tx),
      { timeout: QUERY_TIMEOUT_MS + 500 },
    );
  }

  private logCardFailure(card: string, error: unknown) {
    this.logger.warn("Internal ops summary card unavailable.", {
      card,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}

function subtractDays(value: Date, days: number): Date {
  return new Date(value.getTime() - days * 24 * 60 * 60 * 1000);
}

function statusCounts(rows: StatusGroupRow[], mapStatus: (status: string) => string = (status) => status): InternalOpsStatusCount[] {
  return rows
    .map((row) => ({
      status: mapStatus(String(row.status ?? "").trim()),
      count: Number(row._count?._all ?? 0),
    }))
    .filter((row) => row.status.length > 0)
    .sort((a, b) => a.status.localeCompare(b.status));
}

function resolveAggregateAvailability(
  values: InternalOpsCardAvailability[],
): InternalOpsAggregateAvailability {
  const available = values.filter((value) => value === "available").length;
  if (available === values.length) {
    return "available";
  }
  return available === 0 ? "unavailable" : "partial";
}

function countFor(rows: InternalOpsStatusCount[], status: string): number {
  return rows.find((row) => row.status === status)?.count ?? 0;
}

function sumStatuses(rows: InternalOpsStatusCount[], statuses: readonly string[]): number {
  return statuses.reduce((sum, status) => sum + countFor(rows, status), 0);
}

function successRate(success: number, failed: number): number {
  const total = success + failed;
  return total === 0 ? 0 : Number(((success / total) * 100).toFixed(2));
}

function safeSum(rows: SumRows, field: "failedRows" | "deadLetterRows"): number {
  return Number(rows._sum?.[field] ?? 0);
}

function firstCount(rows: CountDistinctRow[]): number {
  return Number(rows[0]?.count ?? 0);
}

function normalizeRuleFamilyCounts(rows: RuleFamilyGroupRow[]): InternalOpsReadinessRuleFamilyCount[] {
  const counts = new Map<string, { ruleFamily: string; impact: "BLOCKER" | "WARNING"; count: number }>();
  for (const row of rows) {
    const ruleFamily = normalizeRuleFamily(row.ruleCode);
    const impact = row.severity === RuleSeverity.warning ? "WARNING" : "BLOCKER";
    const key = `${impact}:${ruleFamily}`;
    const current = counts.get(key) ?? { ruleFamily, impact, count: 0 };
    current.count += Number(row._count?.ruleCode ?? row._count?._all ?? 0);
    counts.set(key, current);
  }
  return Array.from(counts.values())
    .sort((left, right) => right.count - left.count || left.impact.localeCompare(right.impact) || left.ruleFamily.localeCompare(right.ruleFamily))
    .slice(0, READINESS_TOP_RULE_FAMILY_LIMIT);
}

function normalizeRuleFamily(ruleCode: string): string {
  const normalized = String(ruleCode ?? "").trim().toUpperCase();
  if (normalized.startsWith("ATTR_REQUIRED_")) {
    return "ATTR_REQUIRED_*";
  }
  if (normalized.startsWith("ATTR_TYPE_")) {
    return "ATTR_TYPE_*";
  }
  if (normalized.startsWith("ATTR_ALLOWED_")) {
    return "ATTR_ALLOWED_*";
  }
  if (SAFE_PLATFORM_RULE_CODES.has(normalized)) {
    return normalized;
  }
  return "CUSTOM_RULE";
}
