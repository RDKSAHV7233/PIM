import { Injectable } from "@nestjs/common";
import { BulkImportJobStatus, BulkImportRunStatus, ExportJobStatus, type Prisma } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { ObservabilityDbService } from "../error-authority/observability-db.service";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import type {
  InternalOpsCardAvailability,
  InternalOpsStatusCount,
  InternalOpsSummaryResponse,
} from "./internal-ops.types";

const OPERATIONAL_WINDOW_DAYS = 7;
const INVENTORY_WINDOW_DAYS = 90;
const STUCK_LOOKBACK_DAYS = 30;
const STUCK_THRESHOLD_HOURS = 6;
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
    const stuckFrom = subtractDays(now, STUCK_LOOKBACK_DAYS);
    const stuckBefore = new Date(now.getTime() - STUCK_THRESHOLD_HOURS * 60 * 60 * 1000);

    const [jobs, imports, publishing, connectors, errors, mediaIntegrity] = await Promise.all([
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
        stuckThresholdHours: STUCK_THRESHOLD_HOURS,
        queryTimeoutMs: QUERY_TIMEOUT_MS,
      },
      jobs,
      imports,
      publishing,
      connectors,
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
