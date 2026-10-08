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
import { forEachTenant } from "../common/tenant/tenant-iteration";
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
// Only ACTIVE installations are counted for inconclusive / configuration-problem checks: an expired
// installation is already a blocker, and a stale outcome on a paused or disabled one is not news.
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
        latestRun: null,
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
    return this.acrossTenants(
      async (db, tenantKey) => {
        const [exportRows, importRows, stuckExports, stuckImports] = await Promise.all([
          db.marketplaceExportJob.groupBy({
            by: ["status"] as const,
            where: {
              tenantKey,
              updatedAt: { gte: operationalFrom },
              status: { in: [...EXPORT_ACTIVE_STATUSES, ExportJobStatus.failed, ExportJobStatus.dead_letter] },
            },
            _count: { _all: true },
          }),
          db.bulkImportJob.groupBy({
            by: ["status"] as const,
            where: {
              tenantKey,
              updatedAt: { gte: operationalFrom },
              status: { in: [...IMPORT_JOB_ACTIVE_STATUSES, BulkImportJobStatus.failed, BulkImportJobStatus.dead_letter] },
            },
            _count: { _all: true },
          }),
          db.marketplaceExportJob.count({
            where: {
              tenantKey,
              status: { in: [...EXPORT_ACTIVE_STATUSES] },
              updatedAt: { gte: stuckFrom, lte: stuckBefore },
            },
          }),
          db.bulkImportJob.count({
            where: {
              tenantKey,
              status: { in: [...IMPORT_JOB_ACTIVE_STATUSES] },
              updatedAt: { gte: stuckFrom, lte: stuckBefore },
            },
          }),
        ]);
        return {
          exportRows: exportRows as StatusGroupRow[],
          importRows: importRows as StatusGroupRow[],
          stuckExports: Number(stuckExports ?? 0),
          stuckImports: Number(stuckImports ?? 0),
        };
      },
      (parts) => {
        const exportCounts = statusCounts(sumStatusRows(parts.flatMap((part) => part.exportRows)));
        const importCounts = statusCounts(sumStatusRows(parts.flatMap((part) => part.importRows)));
        return {
          active: sumStatuses(exportCounts, EXPORT_ACTIVE_STATUSES) + sumStatuses(importCounts, IMPORT_JOB_ACTIVE_STATUSES),
          stuck: parts.reduce((sum, part) => sum + part.stuckExports + part.stuckImports, 0),
          failed: countFor(exportCounts, ExportJobStatus.failed) + countFor(importCounts, BulkImportJobStatus.failed),
          deadLetter: countFor(exportCounts, ExportJobStatus.dead_letter) + countFor(importCounts, BulkImportJobStatus.dead_letter),
          marketplaceExportJobs: exportCounts,
          bulkImportJobs: importCounts,
        };
      },
    );
  }

  private async getImports(operationalFrom: Date) {
    return this.acrossTenants(
      async (db, tenantKey) => {
        const [activeRuns, runRows, jobRows] = await Promise.all([
          db.bulkImportRun.count({
            where: {
              tenantKey,
              updatedAt: { gte: operationalFrom },
              status: { in: [...IMPORT_RUN_ACTIVE_STATUSES] },
            },
          }),
          db.bulkImportRun.aggregate({
            where: {
              tenantKey,
              updatedAt: { gte: operationalFrom },
            },
            _sum: {
              failedRows: true,
              deadLetterRows: true,
            },
          }),
          db.bulkImportJob.aggregate({
            where: {
              tenantKey,
              updatedAt: { gte: operationalFrom },
            },
            _sum: {
              failedRows: true,
              deadLetterRows: true,
            },
          }),
        ]);
        return {
          activeRuns: Number(activeRuns ?? 0),
          runFailedRows: safeSum(runRows as SumRows, "failedRows"),
          jobFailedRows: safeSum(jobRows as SumRows, "failedRows"),
          runDlqRows: safeSum(runRows as SumRows, "deadLetterRows"),
          jobDlqRows: safeSum(jobRows as SumRows, "deadLetterRows"),
        };
      },
      (parts) => {
        const total = (pick: (part: (typeof parts)[number]) => number) => parts.reduce((sum, part) => sum + pick(part), 0);
        const runFailedRows = total((part) => part.runFailedRows);
        const jobFailedRows = total((part) => part.jobFailedRows);
        const runDlqRows = total((part) => part.runDlqRows);
        const jobDlqRows = total((part) => part.jobDlqRows);
        return {
          activeRuns: total((part) => part.activeRuns),
          failedRows: runFailedRows + jobFailedRows,
          dlqRows: runDlqRows + jobDlqRows,
          runFailedRows,
          jobFailedRows,
          runDlqRows,
          jobDlqRows,
        };
      },
    );
  }

  private async getPublishing(operationalFrom: Date) {
    return this.acrossTenants(
      async (db, tenantKey) => {
        const [exportRows, submissionRows] = await Promise.all([
          db.marketplaceExportJob.groupBy({
            by: ["status"] as const,
            where: {
              tenantKey,
              updatedAt: { gte: operationalFrom },
              status: { in: [ExportJobStatus.completed, ...EXPORT_FAILURE_STATUSES] },
            },
            _count: { _all: true },
          }),
          db.connectorSubmission.groupBy({
            by: ["status"] as const,
            where: {
              tenantKey,
              submittedAt: { gte: operationalFrom },
              status: { in: ["SUCCESS", ...SUBMISSION_FAILURE_STATUSES] },
            },
            _count: { _all: true },
          }),
        ]);
        return { exportRows: exportRows as StatusGroupRow[], submissionRows: submissionRows as StatusGroupRow[] };
      },
      (parts) => {
        const exportCounts = statusCounts(sumStatusRows(parts.flatMap((part) => part.exportRows)));
        const submissionCounts = statusCounts(sumStatusRows(parts.flatMap((part) => part.submissionRows)));
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
      },
    );
  }

  private async getConnectors(inventoryFrom: Date) {
    return this.acrossTenants(
      async (db, tenantKey) =>
        Promise.all(
          CONNECTOR_STATUSES.map(async (status) => ({
            status: status.toLowerCase(),
            count: await db.connectorInstallation.count({
              where: {
                tenantKey,
                updatedAt: { gte: inventoryFrom },
                status,
              },
            }),
          })),
        ),
      (parts) => {
        const totals = new Map<string, number>();
        for (const row of parts.flat()) {
          totals.set(row.status, (totals.get(row.status) ?? 0) + row.count);
        }
        // Same order and filtering as before: the fixed status order, statuses with a zero count omitted.
        const byStatus = CONNECTOR_STATUSES.map((status) => ({ status: status.toLowerCase(), count: totals.get(status.toLowerCase()) ?? 0 })).filter(
          (row) => row.count > 0,
        );
        return {
          totalInstallations: byStatus.reduce((sum, row) => sum + row.count, 0),
          byStatus,
        };
      },
    );
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
        inconclusiveInstallations: null,
        configurationProblemInstallations: null,
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
    return this.acrossTenants(
      async (db, tenantKey) => {
        const [blockedProducts, blockingIssues, warningIssues, openIssues, ruleRows] = await Promise.all([
          this.countReadinessBlockedProducts(db, tenantKey),
          db.validationIssue.count({
            where: {
              tenantKey,
              status: ValidationIssueStatus.open,
              severity: RuleSeverity.error,
            },
          }),
          db.validationIssue.count({
            where: {
              tenantKey,
              status: ValidationIssueStatus.open,
              severity: RuleSeverity.warning,
            },
          }),
          db.validationIssue.count({ where: { tenantKey, status: ValidationIssueStatus.open } }),
          // Not cut to the platform-wide limit here: the limit applies after the tenants are merged.
          db.validationIssue.groupBy({
            by: ["ruleCode", "severity"] as const,
            where: { tenantKey, status: ValidationIssueStatus.open },
            _count: { ruleCode: true },
          }),
        ]);
        return {
          blockedProducts: Number(blockedProducts ?? 0),
          blockingIssues: Number(blockingIssues ?? 0),
          warningIssues: Number(warningIssues ?? 0),
          hasOpenIssues: Number(openIssues ?? 0) > 0,
          ruleRows: ruleRows as RuleFamilyGroupRow[],
        };
      },
      (parts) => ({
        blockedProducts: parts.reduce((sum, part) => sum + part.blockedProducts, 0),
        blockingIssues: parts.reduce((sum, part) => sum + part.blockingIssues, 0),
        warningIssues: parts.reduce((sum, part) => sum + part.warningIssues, 0),
        // A tenant is affected when it has at least one open issue (was COUNT(DISTINCT tenantKey) over open issues).
        affectedTenants: parts.filter((part) => part.hasOpenIssues).length,
        topRuleFamilies: normalizeRuleFamilyCounts(topRuleGroups(parts.flatMap((part) => part.ruleRows))),
      }),
    );
  }

  private async getReadinessMapping(): Promise<Omit<InternalOpsSummaryResponse["readiness"]["mapping"], "availability">> {
    return this.acrossTenants(
      async (db, tenantKey) => {
        const publishedWhere = { tenantKey, lifecycleState: "published" } satisfies Prisma.ConnectorMappingVersionWhereInput;
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
          affectedMappings,
          compatibilityBlocked,
          remapRequired,
          fallbackAckRequired,
          deprecated,
        ] = await Promise.all([
          db.connectorMappingVersion.count({ where: blockingWhere }),
          db.connectorMappingVersion.count({ where: warningWhere }),
          db.connectorMappingVersion.count({ where: affectedWhere }),
          db.connectorMappingVersion.count({ where: { ...publishedWhere, compatibilityState: "blocked" } }),
          db.connectorMappingVersion.count({ where: { ...publishedWhere, compatibilityState: "remap_required" } }),
          db.connectorMappingVersion.count({ where: { ...publishedWhere, fallbackAckRequired: true } }),
          db.connectorMappingVersion.count({ where: { ...publishedWhere, compatibilityState: "deprecated" } }),
        ]);
        return {
          blockingMappings: Number(blockingMappings ?? 0),
          warningMappings: Number(warningMappings ?? 0),
          affected: Number(affectedMappings ?? 0) > 0,
          compatibilityBlocked: Number(compatibilityBlocked ?? 0),
          remapRequired: Number(remapRequired ?? 0),
          fallbackAckRequired: Number(fallbackAckRequired ?? 0),
          deprecated: Number(deprecated ?? 0),
        };
      },
      (parts) => {
        const total = (pick: (part: (typeof parts)[number]) => number) => parts.reduce((sum, part) => sum + pick(part), 0);
        return {
          blockingMappings: total((part) => part.blockingMappings),
          warningMappings: total((part) => part.warningMappings),
          // was COUNT(DISTINCT tenant_key) over the affected published mapping versions
          affectedTenants: parts.filter((part) => part.affected).length,
          signals: {
            compatibilityBlocked: total((part) => part.compatibilityBlocked),
            remapRequired: total((part) => part.remapRequired),
            fallbackAckRequired: total((part) => part.fallbackAckRequired),
            deprecated: total((part) => part.deprecated),
          },
        };
      },
    );
  }

  private async getReadinessConnector(): Promise<Omit<InternalOpsSummaryResponse["readiness"]["connector"], "availability">> {
    return this.acrossTenants(
      async (db, tenantKey) => {
        const [statusCountsResult, inconclusiveInstallations, configurationProblemInstallations] = await Promise.all([
          Promise.all(
            CONNECTOR_STATUSES.map(async (status) => ({
              status,
              count: await db.connectorInstallation.count({ where: { tenantKey, status } }),
            })),
          ),
          db.connectorInstallation.count({ where: { tenantKey, status: "ACTIVE", lastValidationOutcome: "INDETERMINATE" } }),
          db.connectorInstallation.count({ where: { tenantKey, status: "ACTIVE", lastValidationOutcome: "CONFIGURATION_ERROR" } }),
        ]);
        return {
          statusCounts: statusCountsResult.map((row) => ({ status: row.status, count: Number(row.count ?? 0) })),
          inconclusiveInstallations: Number(inconclusiveInstallations ?? 0),
          configurationProblemInstallations: Number(configurationProblemInstallations ?? 0),
        };
      },
      (parts) => {
        const totals = new Map<string, number>();
        for (const row of parts.flatMap((part) => part.statusCounts)) {
          totals.set(row.status, (totals.get(row.status) ?? 0) + row.count);
        }
        const byStatus = CONNECTOR_STATUSES.map((status) => ({
          status,
          impact: CONNECTOR_STATUS_IMPACT[status],
          count: totals.get(status) ?? 0,
        }))
          .filter((row) => row.count > 0)
          .map((row) => ({ status: row.status, impact: row.impact, count: row.count }));
        // was COUNT(DISTINCT tenant_key) over installations that are PAUSED or CREDENTIAL_EXPIRED
        const affectedTenants = parts.filter((part) =>
          part.statusCounts.some((row) => (row.status === "PAUSED" || row.status === "CREDENTIAL_EXPIRED") && row.count > 0),
        ).length;

        return {
          blockingInstallations: countFor(byStatus, "CREDENTIAL_EXPIRED"),
          warningInstallations: countFor(byStatus, "PAUSED"),
          // The last credential check was inconclusive (provider unreachable) or hit a configuration
          // problem. Counted apart from blockers: neither proves the credentials are bad.
          inconclusiveInstallations: parts.reduce((sum, part) => sum + part.inconclusiveInstallations, 0),
          configurationProblemInstallations: parts.reduce((sum, part) => sum + part.configurationProblemInstallations, 0),
          affectedTenants,
          byStatus,
        };
      },
    );
  }

  private async countReadinessBlockedProducts(db: Prisma.TransactionClient, tenantKey: string): Promise<number> {
    // RLS-BYPASS: manual tenant filter — "tenantKey" = ${tenantKey} below, on a transaction whose tenant context is that tenant.
    // The platform-wide figure is the sum over tenants, computed by the caller.
    const rows = await db.$queryRaw<CountDistinctRow[]>(Prisma.sql`
      SELECT COUNT(DISTINCT "productId")::bigint AS "count"
      FROM "ValidationIssue"
      WHERE "tenantKey" = ${tenantKey}
        AND "status" = ${ValidationIssueStatus.open}::"ValidationIssueStatus"
        AND "severity" = ${RuleSeverity.error}::"RuleSeverity"
    `);
    return firstCount(rows);
  }

  private async getMediaIntegrity(inventoryFrom: Date) {
    const totalAssets = await this.acrossTenants(
      (db, tenantKey) => db.mediaAsset.count({ where: { tenantKey, createdAt: { gte: inventoryFrom } } }),
      (counts) => counts.reduce((sum, count) => sum + Number(count ?? 0), 0),
    );
    // The scan-run table is a platform table (no tenant key, not row-level-secured): read it directly.
    const latestRun = await this.withPlatformDbTimeout((db) =>
      db.mediaIntegrityScanRun.findFirst({
        orderBy: { startedAt: "desc" },
        select: {
          id: true,
          status: true,
          startedAt: true,
          completedAt: true,
          coverageComplete: true,
          rowsExamined: true,
          rowsEligible: true,
          continuationPending: true,
          totals: true,
          impact: true,
        },
      }),
    );
    return {
      totalAssets,
      latestRun: latestRun ? normalizeMediaIntegrityRun(latestRun) : null,
      orphanDetectionIncluded: false as const,
    };
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

  /**
   * Runs `read` once per tenant, each in a short transaction in that tenant's own context (forEachTenant), and merges the per-tenant
   * partials in the application. Every query inside `read` also filters by the tenant it is given, so the result is correct whether or
   * not the role bypasses row level security.
   *
   * SEC-DB-RLS-001: these platform-wide counts used to be single queries through the context-free client, which under row level
   * security sees no tenant's rows, so every figure would have been zero while the card reported itself available. A tenant that
   * cannot be read makes the whole card fail (and show as unavailable): a figure is never silently an undercount.
   */
  private async acrossTenants<P, R>(read: (db: Prisma.TransactionClient, tenantKey: string) => Promise<P>, merge: (parts: P[]) => R): Promise<R> {
    const parts: P[] = [];
    const summary = await forEachTenant(
      this.prismaDirect.getClient(),
      async (tx, tenantKey) => {
        parts.push(await read(tx, tenantKey));
        return { examinedCount: 1, changedCount: 0 };
      },
      { timeoutMs: QUERY_TIMEOUT_MS + 500 },
    );
    if (summary.tenantsFailed > 0) {
      const failures = summary.results.filter((result) => result.status === "failed").map((result) => `${result.tenantKey}:${result.errorCode ?? "UNKNOWN"}`);
      throw new Error(`INTERNAL_OPS_TENANT_READ_FAILED ${summary.tenantsFailed}/${summary.tenantsEvaluated} [${failures.join(", ")}]`);
    }
    return merge(parts);
  }

  /** For platform tables that carry no tenant key and are not row-level-secured. */
  private async withPlatformDbTimeout<T>(operation: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
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

/** Sums grouped status rows of several tenants into one row per status. */
function sumStatusRows(rows: StatusGroupRow[]): StatusGroupRow[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const status = String(row.status ?? "");
    totals.set(status, (totals.get(status) ?? 0) + Number(row._count?._all ?? 0));
  }
  return [...totals.entries()].map(([status, count]) => ({ status, _count: { _all: count } }));
}

/** Merges per-tenant (rule code, severity) groups, then keeps the platform-wide top groups, as the single grouped query used to. */
function topRuleGroups(rows: RuleFamilyGroupRow[]): RuleFamilyGroupRow[] {
  const totals = new Map<string, RuleFamilyGroupRow>();
  for (const row of rows) {
    const key = `${row.severity}\u0000${row.ruleCode}`;
    const count = Number(row._count?.ruleCode ?? row._count?._all ?? 0);
    const current = totals.get(key);
    if (current) {
      current._count = { ruleCode: Number(current._count.ruleCode ?? 0) + count };
    } else {
      totals.set(key, { ruleCode: row.ruleCode, severity: row.severity, _count: { ruleCode: count } });
    }
  }
  return [...totals.values()]
    .sort((x, y) => Number(y._count.ruleCode ?? 0) - Number(x._count.ruleCode ?? 0) || x.ruleCode.localeCompare(y.ruleCode))
    .slice(0, READINESS_RULE_CODE_GROUP_LIMIT);
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

type MediaIntegrityRunRow = {
  id: string;
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  coverageComplete: boolean;
  rowsExamined: number;
  rowsEligible: number | null;
  continuationPending: boolean;
  totals: unknown;
  impact: unknown;
};

function normalizeMediaIntegrityRun(row: MediaIntegrityRunRow): NonNullable<InternalOpsSummaryResponse["mediaIntegrity"]["latestRun"]> {
  const totals = asRecord(row.totals);
  const impact = asRecord(row.impact);
  return {
    runId: row.id,
    status: String(row.status ?? "").trim() || "unknown",
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    coverageComplete: row.coverageComplete,
    rowsExamined: Number(row.rowsExamined ?? 0),
    rowsEligible: row.rowsEligible === null ? null : Number(row.rowsEligible ?? 0),
    continuationPending: row.continuationPending,
    totals: {
      missing: safeNumber(totals.missing),
      invalidPath: safeNumber(totals.invalidPath),
      unverifiable: safeNumber(totals.unverifiable),
      storageErrors: safeNumber(totals.storageErrors),
    },
    impact: {
      affectedTenantCount: safeNumber(impact.affectedTenantCount),
      activeProductImpactCount: safeNumber(impact.activeProductImpactCount),
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
