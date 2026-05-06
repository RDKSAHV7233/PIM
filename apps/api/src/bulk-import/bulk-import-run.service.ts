import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BulkImportRunStatus, BulkImportRowStatus, BulkImportJobStatus, Prisma, RecordStatus } from "@prisma/client";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { PrismaService } from "../prisma/prisma.service";
import { AccessPolicyService, PolicyActor } from "../common/access-policy/access-policy.service";
import { QueueService } from "../queue/queue.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { BulkImportStorageService } from "./bulk-import-storage.service";
import { BulkImportService } from "./bulk-import.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { CreateBulkImportRunDto } from "./dto/create-bulk-import-run.dto";

const LARGE_IMPORT_MAX_FILE_SIZE_BYTES = 32 * 1024 * 1024; // 32 MB
const LARGE_IMPORT_ROW_CEILING = 30_000;
const LARGE_IMPORT_MODE_THRESHOLD = 10_000;
const LARGE_IMPORT_BATCH_SIZE = 1_000;
const STAGED_FILE_EXPIRY_DAYS = 7;

type LargeRunBatchPayload = {
  kind: "large_run_batch";
  runId: string;
  jobId: string;
  tenantKey: string;
  batchIndex: number;
};

type CanonicalRowPayload = {
  title?: string;
  description?: string;
  brand?: string;
  hsnCode?: string;
  gstRate?: number;
  status?: string;
  attributes?: Record<string, unknown>;
};

@Injectable()
export class BulkImportRunService implements OnModuleInit {
  private readonly logger = new Logger(BulkImportRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly queueService: QueueService,
    private readonly storageService: BulkImportStorageService,
    private readonly bulkImportService: BulkImportService,
  ) {}

  onModuleInit() {
    this.queueService.processWithBackpressure<LargeRunBatchPayload>(
      QUEUE_NAMES.BULK_IMPORT,
      {
        laneResolver: (p) => p.tenantKey,
      },
      async (payload) => {
        if (payload.kind !== "large_run_batch") {
          return;
        }
        await this.processLargeRunBatch(payload);
      },
    );
  }

  async uploadRun(
    dto: CreateBulkImportRunDto,
    fileBuffer: Buffer,
    originalName: string,
    fileSizeBytes: number,
    actor?: PolicyActor,
  ) {
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", dto.categoryId, "BulkImportRun");
    await this.requireCategory(dto.categoryId);

    if (fileSizeBytes > LARGE_IMPORT_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException(
        `File exceeds maximum allowed size of ${LARGE_IMPORT_MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
      );
    }
    if (fileBuffer.length === 0) {
      throw new BadRequestException("Uploaded file is empty.");
    }

    const tenantKey = this.resolveTenantKey();
    const runId = randomUUID();

    const { storageKey } = await this.storageService.storeStagedCsv({
      tenantKey,
      runId,
      content: fileBuffer,
    });

    const sourceExpiresAt = new Date();
    sourceExpiresAt.setDate(sourceExpiresAt.getDate() + STAGED_FILE_EXPIRY_DAYS);

    const run = await this.prisma.tenant().bulkImportRun.create({
      data: {
        id: runId,
        categoryId: dto.categoryId,
        status: BulkImportRunStatus.uploaded,
        sourceFileKey: storageKey,
        sourceName: dto.sourceName?.trim() || originalName || null,
        sourceFormat: "csv",
        sourceFileSizeBytes: fileSizeBytes,
        sourceExpiresAt,
        maxRetries: dto.maxRetries ?? 3,
        effectiveMode: null,
      },
      include: {
        category: { select: { id: true, path: true } },
      },
    });

    return run;
  }

  async listRuns(status?: string, pagination?: CursorPaginationQuery, actor?: PolicyActor) {
    const tenantKey = this.resolveTenantKey();
    const statusFilter = status ? this.parseRunStatus(status) : undefined;

    if (isCursorPagination(pagination)) {
      const limit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      if (pagination?.cursor && !token) {
        throw new BadRequestException("Invalid cursor.");
      }
      const cursorDate = token ? new Date(token.sort) : null;

      const runs = await this.prisma.tenant().bulkImportRun.findMany({
        where: {
          tenantKey,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(token && cursorDate
            ? {
                OR: [
                  { createdAt: { lt: cursorDate } },
                  { createdAt: cursorDate, id: { lt: token.id } },
                ],
              }
            : {}),
        },
        include: { category: { select: { id: true, path: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });

      const hasNext = runs.length > limit;
      const page = hasNext ? runs.slice(0, limit) : runs;
      const filtered = actor && actor.actorRole !== "admin"
        ? await this.filterRunsByScope(page, actor)
        : page;
      const last = page[page.length - 1];

      return {
        items: filtered,
        limit,
        nextCursor:
          hasNext && last
            ? encodeCursorToken({ sort: last.createdAt.toISOString(), id: last.id })
            : null,
      };
    }

    const runs = await this.prisma.tenant().bulkImportRun.findMany({
      where: {
        tenantKey,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      include: { category: { select: { id: true, path: true } } },
      orderBy: [{ createdAt: "desc" }],
      take: 50,
    });

    return actor && actor.actorRole !== "admin"
      ? await this.filterRunsByScope(runs, actor)
      : runs;
  }

  async getRun(runId: string, actor?: PolicyActor) {
    const run = await this.prisma.tenant().bulkImportRun.findUnique({
      where: { id: runId },
      include: { category: { select: { id: true, path: true } } },
    });
    if (!run) {
      throw new NotFoundException("Bulk import run not found.");
    }
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", run.categoryId, "BulkImportRun", runId);
    return run;
  }

  async validateRun(runId: string, actor?: PolicyActor) {
    const run = await this.getRun(runId, actor);

    await this.prisma.tenant().bulkImportRun.update({
      where: { id: runId },
      data: { status: BulkImportRunStatus.validating },
    });

    try {
      const stream = await this.storageService.readStagedCsvStream(run.sourceFileKey ?? "");

      const rl = createInterface({
        input: stream as unknown as NodeJS.ReadableStream,
        crlfDelay: Infinity,
      });

      let lineNumber = 0;
      let headers: string[] = [];
      let totalRows = 0;
      let blockingIssueCount = 0;
      let warningCount = 0;
      const sampleIssues: Array<{ rowNumber: number; issues: string[]; severity: string }> = [];
      const skuCodesSeen = new Map<string, number[]>();

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        if (lineNumber === 0) {
          headers = this.parseCsvLine(trimmed);
          lineNumber++;
          continue;
        }

        totalRows++;
        const values = this.parseCsvLine(trimmed);
        const row: Record<string, unknown> = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] ?? "";
        });

        const rowIssues: string[] = [];
        const title = typeof row.title === "string" ? row.title.trim() : String(row.title ?? "").trim();
        if (!title) {
          rowIssues.push("Missing required field: title");
          blockingIssueCount++;
        }

        const skuCode = typeof row.skuCode === "string" ? row.skuCode.trim() : "";
        if (skuCode) {
          const existing = skuCodesSeen.get(skuCode) ?? [];
          existing.push(totalRows);
          skuCodesSeen.set(skuCode, existing);
        }

        if (rowIssues.length > 0 && sampleIssues.length < 10) {
          sampleIssues.push({ rowNumber: totalRows, issues: rowIssues, severity: "blocking" });
        }

        lineNumber++;
      }

      // Detect duplicate skuCodes
      let duplicateCount = 0;
      for (const rowNumbers of skuCodesSeen.values()) {
        if (rowNumbers.length > 1) {
          duplicateCount++;
          blockingIssueCount += rowNumbers.length - 1;
          if (sampleIssues.length < 10) {
            sampleIssues.push({
              rowNumber: rowNumbers[0],
              issues: [`Duplicate skuCode across ${rowNumbers.length} rows`],
              severity: "blocking",
            });
          }
        }
      }

      // Check row ceiling
      let mvpCeilingExceeded = false;
      if (totalRows > LARGE_IMPORT_ROW_CEILING) {
        mvpCeilingExceeded = true;
        blockingIssueCount++;
      }

      // Determine effective mode
      let effectiveMode: "standard" | "large" | null;
      let newStatus: BulkImportRunStatus;
      let estimatedBatchCount: number | null = null;

      if (mvpCeilingExceeded) {
        effectiveMode = null;
        newStatus = BulkImportRunStatus.preflight_blocked;
      } else if (blockingIssueCount > 0) {
        effectiveMode = totalRows > LARGE_IMPORT_MODE_THRESHOLD ? "large" : "standard";
        newStatus = BulkImportRunStatus.preflight_blocked;
      } else {
        effectiveMode = totalRows > LARGE_IMPORT_MODE_THRESHOLD ? "large" : "standard";
        newStatus = BulkImportRunStatus.preflight_ready;
      }

      if (effectiveMode === "large" && !mvpCeilingExceeded) {
        estimatedBatchCount = Math.ceil(totalRows / LARGE_IMPORT_BATCH_SIZE);
      }

      const mappingSuggestion = headers.length > 0
        ? this.bulkImportService.suggestMapping(headers)
        : { mapping: {}, unmappedFields: [], unusedHeaders: [] };

      const preflightSummary = {
        mapping: mappingSuggestion.mapping,
        unmappedFields: mappingSuggestion.unmappedFields,
        unusedHeaders: mappingSuggestion.unusedHeaders,
        sampleIssues,
        canImport: blockingIssueCount === 0,
        skuCodeSummary: duplicateCount > 0 ? { duplicateCount, collisionCount: 0 } : null,
        mvpCeilingExceeded,
      };

      const updated = await this.prisma.tenant().bulkImportRun.update({
        where: { id: runId },
        data: {
          status: newStatus,
          totalRows,
          blockingIssueCount,
          warningCount,
          estimatedBatchCount,
          effectiveMode,
          preflightSummary: preflightSummary as unknown as Prisma.JsonObject,
        },
        include: { category: { select: { id: true, path: true } } },
      });

      return updated;
    } catch (error: unknown) {
      await this.prisma.tenant().bulkImportRun.update({
        where: { id: runId },
        data: { status: BulkImportRunStatus.failed },
      });
      throw error;
    }
  }

  async startRun(runId: string, actor?: PolicyActor) {
    const run = await this.getRun(runId, actor);

    if (run.effectiveMode !== "large") {
      throw new BadRequestException(
        "Only runs with effectiveMode='large' can be started via this endpoint.",
      );
    }
    if (run.status !== BulkImportRunStatus.preflight_ready) {
      throw new BadRequestException(
        `Run must be in 'preflight_ready' status to start. Current status: ${run.status}`,
      );
    }

    // Idempotency: check if jobs already exist
    const existingJobs = await this.prisma.tenant().bulkImportJob.findMany({
      where: { runId },
      select: { id: true },
    });
    if (existingJobs.length > 0) {
      return this.getRun(runId, actor);
    }

    const totalRows = run.totalRows ?? 0;
    const batchCount = Math.ceil(totalRows / LARGE_IMPORT_BATCH_SIZE);
    const tenantKey = this.resolveTenantKey();

    const jobIds: Array<{ id: string; batchIndex: number }> = [];

    await this.prisma.tenant().$transaction(async (tx) => {
      for (let i = 0; i < batchCount; i++) {
        const rowStart = i * LARGE_IMPORT_BATCH_SIZE + 1;
        const rowEnd = Math.min((i + 1) * LARGE_IMPORT_BATCH_SIZE, totalRows);
        const jobId = randomUUID();
        jobIds.push({ id: jobId, batchIndex: i });

        await tx.bulkImportJob.create({
          data: {
            id: jobId,
            categoryId: run.categoryId,
            runId,
            batchIndex: i,
            rowStart,
            rowEnd,
            jobRole: "large_batch",
            sourceFormat: run.sourceFormat,
            sourceName: run.sourceName,
            mapping: {},
            chunkSize: LARGE_IMPORT_BATCH_SIZE,
            maxRetries: run.maxRetries,
            status: BulkImportJobStatus.queued,
            totalRows: rowEnd - rowStart + 1,
          },
        });
      }

      await tx.bulkImportRun.update({
        where: { id: runId },
        data: {
          status: BulkImportRunStatus.processing,
          estimatedBatchCount: batchCount,
        },
      });
    });

    // Enqueue jobs outside the transaction
    for (const { id: jobId, batchIndex } of jobIds) {
      await this.queueService.enqueue<LargeRunBatchPayload>(QUEUE_NAMES.BULK_IMPORT, {
        kind: "large_run_batch",
        runId,
        jobId,
        tenantKey,
        batchIndex,
      });
    }

    return this.getRun(runId, actor);
  }

  async listRunRows(runId: string, status?: string, pagination?: CursorPaginationQuery, actor?: PolicyActor) {
    const run = await this.getRun(runId, actor);

    const statusFilter = status ? this.parseRowStatus(status) : undefined;

    if (isCursorPagination(pagination)) {
      const limit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      if (pagination?.cursor && !token) {
        throw new BadRequestException("Invalid cursor.");
      }
      const cursorRowNumber = token ? Number(token.sort) : Number.NaN;

      const rows = await this.prisma.tenant().bulkImportRow.findMany({
        where: {
          runId,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(token && Number.isFinite(cursorRowNumber)
            ? { rowNumberGlobal: { gt: cursorRowNumber } }
            : {}),
        },
        orderBy: [{ rowNumberGlobal: "asc" }, { id: "asc" }],
        take: limit + 1,
      });

      const hasNext = rows.length > limit;
      const page = hasNext ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];

      return {
        items: page,
        limit,
        nextCursor:
          hasNext && last
            ? encodeCursorToken({
                sort: String(last.rowNumberGlobal ?? last.rowNumber),
                id: last.id,
              })
            : null,
      };
    }

    return this.prisma.tenant().bulkImportRow.findMany({
      where: {
        runId,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: [{ rowNumberGlobal: "asc" }, { rowNumber: "asc" }],
      take: 200,
    });
  }

  async buildRunErrorReportCsv(runId: string, actor?: PolicyActor): Promise<string> {
    const run = await this.getRun(runId, actor);

    const rows = await this.prisma.tenant().bulkImportRow.findMany({
      where: {
        runId,
        status: {
          in: [BulkImportRowStatus.failed, BulkImportRowStatus.dead_letter],
        },
      },
      orderBy: [{ rowNumberGlobal: "asc" }, { rowNumber: "asc" }],
    });

    const lines: string[] = [
      ["rowNumber", "rowNumberGlobal", "status", "retryCount", "errorMessage", "productId"].map(this.toCsvCell).join(","),
    ];

    for (const row of rows) {
      lines.push(
        [
          String(row.rowNumber),
          String(row.rowNumberGlobal ?? ""),
          String(row.status),
          String(row.retryCount),
          row.errorMessage ?? "",
          row.productId ?? "",
        ]
          .map(this.toCsvCell)
          .join(","),
      );
    }

    return lines.join("\r\n");
  }

  async processLargeRunBatch(payload: LargeRunBatchPayload): Promise<void> {
    const { runId, jobId, tenantKey, batchIndex } = payload;

    const job = await this.prisma.tenant().bulkImportJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      this.logger.warn(`Large batch job not found: ${jobId}`);
      return;
    }

    const run = await this.prisma.tenant().bulkImportRun.findUnique({
      where: { id: runId },
    });
    if (!run || !run.sourceFileKey) {
      this.logger.warn(`Large batch run not found or missing sourceFileKey: ${runId}`);
      return;
    }

    await this.prisma.tenant().bulkImportJob.update({
      where: { id: jobId },
      data: { status: BulkImportJobStatus.processing },
    });

    const rowStart = job.rowStart ?? (batchIndex * LARGE_IMPORT_BATCH_SIZE + 1);
    const rowEnd = job.rowEnd ?? ((batchIndex + 1) * LARGE_IMPORT_BATCH_SIZE);

    try {
      const stream = await this.storageService.readStagedCsvStream(run.sourceFileKey);

      const rl = createInterface({
        input: stream as unknown as NodeJS.ReadableStream,
        crlfDelay: Infinity,
      });

      let lineNumber = 0;
      let dataRowNumber = 0;
      let headers: string[] = [];
      let rowsProcessed = 0;

      for await (const line of rl) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (lineNumber === 0) {
          headers = this.parseCsvLine(trimmed);
          lineNumber++;
          continue;
        }

        dataRowNumber++;

        if (dataRowNumber < rowStart) {
          lineNumber++;
          continue;
        }
        if (dataRowNumber > rowEnd) {
          break;
        }

        const values = this.parseCsvLine(trimmed);
        const rawRow: Record<string, unknown> = {};
        headers.forEach((header, idx) => {
          rawRow[header] = values[idx] ?? "";
        });

        const rowNumberInBatch = dataRowNumber - rowStart + 1;
        const rowId = randomUUID();

        // Mark row as processing
        await this.prisma.tenant().bulkImportRow.create({
          data: {
            id: rowId,
            jobId,
            runId,
            rowNumber: rowNumberInBatch,
            rowNumberGlobal: dataRowNumber,
            rowNumberInBatch,
            payload: rawRow as Prisma.JsonObject,
            status: BulkImportRowStatus.processing,
            lastAttemptAt: new Date(),
          },
        });

        await this.processBatchRow(job, rowId, rawRow, dataRowNumber);
        rowsProcessed++;
        lineNumber++;
      }

      await this.refreshJobCounters(jobId);
      await this.refreshRunCounters(runId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Batch processing failed.";
      this.logger.error(`Large batch ${jobId} failed: ${message}`);

      await this.prisma.tenant().bulkImportJob.update({
        where: { id: jobId },
        data: { status: BulkImportJobStatus.failed },
      });
      await this.refreshRunCounters(runId);
    }
  }

  private async processBatchRow(
    job: { id: string; categoryId: string; maxRetries: number },
    rowId: string,
    rawRow: Record<string, unknown>,
    rowNumberGlobal: number,
  ) {
    try {
      const title = typeof rawRow.title === "string" ? rawRow.title.trim() : String(rawRow.title ?? "").trim();
      if (!title) {
        throw new BadRequestException("title is required");
      }

      const gstRateRaw = rawRow.gstRate !== undefined ? Number(rawRow.gstRate) : undefined;
      const gstRate = gstRateRaw !== undefined && Number.isFinite(gstRateRaw) ? gstRateRaw : null;
      const attributesRaw = rawRow.attributes;
      let attributes: Record<string, unknown> = {};
      if (attributesRaw && typeof attributesRaw === "object" && !Array.isArray(attributesRaw)) {
        attributes = attributesRaw as Record<string, unknown>;
      } else if (typeof attributesRaw === "string" && attributesRaw.trim()) {
        try {
          const parsed = JSON.parse(attributesRaw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            attributes = parsed as Record<string, unknown>;
          }
        } catch {
          // ignore parse errors, use empty attributes
        }
      }

      const product = await this.prisma.tenant().product.create({
        data: {
          title,
          description: typeof rawRow.description === "string" ? rawRow.description.trim() : "",
          brand: typeof rawRow.brand === "string" ? rawRow.brand.trim() : "",
          categoryId: job.categoryId,
          hsnCode: typeof rawRow.hsnCode === "string" && rawRow.hsnCode.trim() ? rawRow.hsnCode.trim() : null,
          gstRate,
          attributes: attributes as Prisma.JsonObject,
          status: RecordStatus.draft,
        },
      });

      await this.prisma.tenant().bulkImportRow.update({
        where: { id: rowId },
        data: {
          status: BulkImportRowStatus.success,
          errorMessage: null,
          productId: product.id,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Row processing failed.";
      const row = await this.prisma.tenant().bulkImportRow.findUnique({
        where: { id: rowId },
        select: { retryCount: true },
      });
      const retryCount = (row?.retryCount ?? 0) + 1;

      await this.prisma.tenant().bulkImportRow.update({
        where: { id: rowId },
        data: {
          status: retryCount >= job.maxRetries ? BulkImportRowStatus.dead_letter : BulkImportRowStatus.failed,
          retryCount,
          errorMessage: message,
        },
      });
    }
  }

  private async refreshJobCounters(jobId: string) {
    const rows = await this.prisma.tenant().bulkImportRow.findMany({
      where: { jobId },
      select: { status: true },
    });

    let success = 0;
    let failed = 0;
    let deadLetter = 0;
    let pending = 0;
    for (const row of rows) {
      if (row.status === BulkImportRowStatus.success) success++;
      else if (row.status === BulkImportRowStatus.failed) failed++;
      else if (row.status === BulkImportRowStatus.dead_letter) deadLetter++;
      else pending++;
    }

    const status =
      pending > 0
        ? BulkImportJobStatus.retrying
        : deadLetter > 0 || failed > 0
          ? BulkImportJobStatus.dead_letter
          : BulkImportJobStatus.completed;

    await this.prisma.tenant().bulkImportJob.update({
      where: { id: jobId },
      data: {
        status,
        processedRows: success + failed + deadLetter,
        successRows: success,
        failedRows: failed,
        deadLetterRows: deadLetter,
      },
    });
  }

  private async refreshRunCounters(runId: string) {
    const jobs = await this.prisma.tenant().bulkImportJob.findMany({
      where: { runId },
      select: { status: true, successRows: true, failedRows: true, deadLetterRows: true },
    });

    let totalSuccess = 0;
    let totalFailed = 0;
    let totalDead = 0;
    let pendingJobs = 0;

    for (const job of jobs) {
      totalSuccess += job.successRows;
      totalFailed += job.failedRows;
      totalDead += job.deadLetterRows;
      if (
        job.status !== BulkImportJobStatus.completed &&
        job.status !== BulkImportJobStatus.failed &&
        job.status !== BulkImportJobStatus.dead_letter
      ) {
        pendingJobs++;
      }
    }

    let runStatus: BulkImportRunStatus;
    if (pendingJobs > 0) {
      runStatus = BulkImportRunStatus.processing;
    } else if (totalDead > 0 || totalFailed > 0) {
      runStatus = BulkImportRunStatus.repair_required;
    } else {
      runStatus = BulkImportRunStatus.completed;
    }

    await this.prisma.tenant().bulkImportRun.update({
      where: { id: runId },
      data: {
        status: runStatus,
        acceptedRows: totalSuccess,
        failedRows: totalFailed,
        deadLetterRows: totalDead,
      },
    });
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.tenant().category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  private async filterRunsByScope<T extends { categoryId: string }>(runs: T[], actor: PolicyActor) {
    const results = await Promise.all(
      runs.map(async (run) => ({
        run,
        allowed: await this.isCategoryAllowed(actor, run.categoryId),
      })),
    );
    return results.filter((entry) => entry.allowed).map((entry) => entry.run);
  }

  private async isCategoryAllowed(actor: PolicyActor, categoryId: string) {
    try {
      await this.accessPolicy.assertCategoryAccess(actor, "import", categoryId, "BulkImportRun");
      return true;
    } catch {
      return false;
    }
  }

  private resolveTenantKey() {
    return normalizeTenantKey(getTenantKeyFromContext());
  }

  private parseRunStatus(value: string): BulkImportRunStatus {
    const normalized = value.trim().toLowerCase();
    if ((Object.values(BulkImportRunStatus) as string[]).includes(normalized)) {
      return normalized as BulkImportRunStatus;
    }
    throw new BadRequestException("Invalid bulk import run status filter.");
  }

  private parseRowStatus(value: string): BulkImportRowStatus {
    const normalized = value.trim().toLowerCase();
    if ((Object.values(BulkImportRowStatus) as string[]).includes(normalized)) {
      return normalized as BulkImportRowStatus;
    }
    throw new BadRequestException("Invalid bulk import row status filter.");
  }

  private parseCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = i < line.length - 1 ? line[i + 1] : "";

      if (char === '"' && inQuotes && next === '"') {
        current += '"';
        i += 1;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
        continue;
      }
      current += char;
    }
    values.push(current);
    return values.map((value) => value.trim());
  }

  private toCsvCell(value: string): string {
    const escaped = String(value ?? "").replace(/"/g, '""');
    return `"${escaped}"`;
  }
}
