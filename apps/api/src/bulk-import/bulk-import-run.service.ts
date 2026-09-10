import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { BulkImportRunStatus, BulkImportRunMode, BulkImportRowStatus, BulkImportJobStatus, Prisma } from "@prisma/client";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { PlanUsageService } from "../billing/plan-usage.service";
import { PrismaService } from "../prisma/prisma.service";
import { AccessPolicyService, PolicyActor } from "../common/access-policy/access-policy.service";
import { QueueService } from "../queue/queue.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { BulkImportStorageService } from "./bulk-import-storage.service";
import { BulkImportService } from "./bulk-import.service";
import { getTenantKeyFromContext, runWithTenantContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { CreateBulkImportRunDto } from "./dto/create-bulk-import-run.dto";
import { CreateBulkImportRunJsonDto } from "./dto/create-bulk-import-run-json.dto";
import { safeCsvCell } from "./csv-safe";

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

type BulkImportJobPayload = {
  kind: "bulk_import_job";
  jobId: string;
  chunkSize: number | undefined;
  actorId: string | undefined;
  actorRole: string | undefined;
  tenantKey: string;
};

// NOTE: hand-duplicated from BulkImportService's private CanonicalRowPayload type
// (bulk-import.service.ts) — both must be kept in sync when a canonical field is
// added. normalizeCanonicalPayloadForImport() below delegates to the same shared
// mapping logic, so this is a typing-only duplication, not a second implementation.
type CanonicalRowPayload = {
  title?: string;
  description?: string;
  brand?: string;
  hsnCode?: string;
  gstRate?: number;
  status?: string;
  attributes?: Record<string, unknown>;
  /** Structured international tax codes — collected by BulkImportService.normalizeCanonicalPayloadForImport(). */
  taxCodes?: Array<{ regimeKey: string; key: string; value: string; rate?: number }>;
  /** Variant fields — see bulk-import.service.ts's CanonicalRowPayload for details. */
  skuCode?: string;
  mrp?: number;
  sellingPrice?: number;
  inventoryQty?: number;
};

type StagedSourceFormat = "csv" | "json";

type StagedSourceRows = {
  headers: string[];
  rows: Record<string, unknown>[];
};

type BulkImportPreflightIssueGroup = {
  code: string;
  severity: "blocking" | "warning";
  field: string | null;
  message: string;
  affectedRowCount: number;
  sampleRowNumbers: number[];
};

type BulkImportPreflightIssueGroupInput = {
  rowNumbers: number[];
  severity: "blocking" | "warning";
  code: string;
  fieldPath?: string | null;
  message: string;
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
    private readonly planUsageService: PlanUsageService,
  ) {}

  private addPreflightIssueGroup(
    groups: Map<string, BulkImportPreflightIssueGroup>,
    input: BulkImportPreflightIssueGroupInput,
  ) {
    const rowNumbers = input.rowNumbers.filter((rowNumber) => Number.isFinite(rowNumber) && rowNumber >= 0);
    const field = input.fieldPath?.trim() ? input.fieldPath.trim() : null;
    const code = input.code.trim() || "VALIDATION_ISSUE";
    const message = input.message.trim() || "Validation issue found.";
    const key = `${input.severity}:${code}:${field ?? ""}:${message}`;
    const existing = groups.get(key);
    if (existing) {
      existing.affectedRowCount += rowNumbers.length;
      for (const rowNumber of rowNumbers) {
        if (existing.sampleRowNumbers.length >= 10) {
          break;
        }
        if (!existing.sampleRowNumbers.includes(rowNumber)) {
          existing.sampleRowNumbers.push(rowNumber);
        }
      }
      return;
    }
    groups.set(key, {
      code,
      severity: input.severity,
      field,
      message,
      affectedRowCount: rowNumbers.length,
      sampleRowNumbers: rowNumbers.slice(0, 10),
    });
  }

  private sortPreflightIssueGroups(
    groups: Map<string, BulkImportPreflightIssueGroup>,
  ): BulkImportPreflightIssueGroup[] {
    return Array.from(groups.values()).sort((left, right) => {
      if (left.severity !== right.severity) {
        return left.severity === "blocking" ? -1 : 1;
      }
      const codeComparison = left.code.localeCompare(right.code);
      if (codeComparison !== 0) {
        return codeComparison;
      }
      return String(left.field ?? "").localeCompare(String(right.field ?? ""));
    });
  }

  onModuleInit() {
    this.queueService.processWithBackpressure<LargeRunBatchPayload | BulkImportJobPayload>(
      QUEUE_NAMES.BULK_IMPORT,
      {
        laneResolver: (p) => p.tenantKey,
      },
      async (payload) => {
        if (payload.kind === "bulk_import_job") {
          await runWithTenantContext(payload.tenantKey, () =>
            this.bulkImportService.processJob(payload.jobId, payload.chunkSize, {
              actorId: payload.actorId,
              actorRole: payload.actorRole as never,
              tenantId: payload.tenantKey,
            }),
          );
          return;
        }
        if (payload.kind !== "large_run_batch") {
          return;
        }
        await this.processLargeRunBatch(payload);
      },
    );
  }

  /**
   * Non-blocking alternative to `BulkImportService.processJob`.
   * Validates the job exists and the actor has access, enqueues the processing
   * work to the BULK_IMPORT BullMQ lane, then returns the current job state
   * immediately — the HTTP worker is never blocked by row-processing time.
   */
  async enqueueProcessJob(
    jobId: string,
    chunkSize: number | undefined,
    actor: PolicyActor,
  ) {
    // Validates existence + access + returns current job state in one call.
    const job = await this.bulkImportService.getJob(jobId, actor);

    const skipStatuses: string[] = [
      BulkImportJobStatus.completed,
      BulkImportJobStatus.failed,
      BulkImportJobStatus.dead_letter,
      BulkImportJobStatus.processing,
    ];
    if (skipStatuses.includes(job.status)) {
      return job;
    }

    const tenantKey = this.resolveTenantKey();

    await this.queueService.enqueue<BulkImportJobPayload>(QUEUE_NAMES.BULK_IMPORT, {
      kind: "bulk_import_job",
      jobId,
      chunkSize,
      actorId: actor.actorId ?? undefined,
      actorRole: actor.actorRole ?? undefined,
      tenantKey,
    });

    return job;
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
    const sourceFormat = this.resolveSourceFormat(dto.sourceFormat ?? originalName);

    let storageKey: string;
    try {
      ({ storageKey } = await this.storageService.storeStagedSource({
        tenantKey,
        runId,
        content: fileBuffer,
        sourceFormat,
      }));
    } catch (error) {
      this.logger.error(
        `Failed to store staged CSV for run ${runId}: ${error instanceof Error ? error.message : error}`,
      );
      throw new BadRequestException(
        "Failed to stage import file for processing. Check storage configuration.",
      );
    }

    const sourceExpiresAt = new Date();
    sourceExpiresAt.setDate(sourceExpiresAt.getDate() + STAGED_FILE_EXPIRY_DAYS);

    const run = await this.prisma.tenant().bulkImportRun.create({
      data: {
        id: runId,
        categoryId: dto.categoryId,
        status: BulkImportRunStatus.uploaded,
        sourceFileKey: storageKey,
        sourceName: dto.sourceName?.trim() || originalName || null,
        sourceFormat,
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

  async createRunFromJson(dto: CreateBulkImportRunJsonDto, actor?: PolicyActor) {
    let fileBuffer: Buffer;
    let originalName = dto.sourceName?.trim() || "import";

    if (dto.fileContentBase64) {
      fileBuffer = Buffer.from(dto.fileContentBase64, "base64");
      if (!originalName.includes(".")) {
        originalName += dto.sourceFormat === "json" ? ".json" : ".csv";
      }
    } else if (dto.csvContent) {
      fileBuffer = Buffer.from(dto.csvContent, "utf-8");
      if (!originalName.includes(".")) {
        originalName += ".csv";
      }
    } else if (dto.rows && Array.isArray(dto.rows)) {
      if (dto.sourceFormat === "json") {
        fileBuffer = Buffer.from(JSON.stringify(dto.rows), "utf-8");
        if (!originalName.includes(".")) {
          originalName += ".json";
        }
      } else {
        const headers = this.extractCsvHeaders(dto.rows);
        const lines = [headers.join(",")];
        for (const row of dto.rows) {
          lines.push(headers.map((h) => this.toCsvCell(String(row[h] ?? ""))).join(","));
        }
        fileBuffer = Buffer.from(lines.join("\r\n"), "utf-8");
        if (!originalName.includes(".")) {
          originalName += ".csv";
        }
      }
    } else {
      throw new BadRequestException(
        "One of fileContentBase64, csvContent, or rows is required.",
      );
    }

    return this.uploadRun(
      { categoryId: dto.categoryId, sourceName: dto.sourceName, maxRetries: dto.maxRetries },
      fileBuffer,
      originalName,
      fileBuffer.length,
      actor,
    );
  }

  private extractCsvHeaders(rows: Record<string, unknown>[]): string[] {
    const headerSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        headerSet.add(key);
      }
    }
    return [...headerSet];
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
      const sourceFormat = this.resolveSourceFormat(run.sourceFormat);
      const sourceRows = await this.readStagedSourceRows(run.sourceFileKey ?? "", sourceFormat);
      const mappingSuggestion =
        sourceRows.headers.length > 0
          ? this.bulkImportService.suggestMapping(sourceRows.headers)
          : { mapping: {}, unmappedFields: [], unusedHeaders: [] };
      const totalRows = sourceRows.rows.length;
      let blockingIssueCount = 0;
      let warningCount = 0;
      const sampleIssues: Array<{
        rowNumber: number;
        severity: "blocking" | "warning";
        code: string;
        message: string;
        fieldPath?: string | null;
      }> = [];
      const issueGroupAccumulator = new Map<string, BulkImportPreflightIssueGroup>();
      const blockedRowNumbers = new Set<number>();
      const skuCodesSeen = new Map<string, number[]>();
      const brandsSeen = new Set<string>();
      let containsWorkflowStatus = false;

      for (const [index, row] of sourceRows.rows.entries()) {
        const rowNumber = index + 1;
        const normalizedRow = this.bulkImportService.normalizeCanonicalPayloadForImport(row, mappingSuggestion.mapping);

        const rowIssues = this.bulkImportService.validateCanonicalRowForImport(normalizedRow);
        const hasBlockingIssue = rowIssues.some((issue) => issue.severity === "blocking");
        if (hasBlockingIssue) blockedRowNumbers.add(rowNumber);
        for (const issue of rowIssues) {
          if (issue.severity === "blocking") {
            blockingIssueCount++;
          } else {
            warningCount++;
          }
          if (sampleIssues.length < 10) {
            sampleIssues.push({
              rowNumber,
              severity: issue.severity,
              code: issue.code,
              message: issue.message,
              fieldPath: issue.fieldPath ?? null,
            });
          }
          this.addPreflightIssueGroup(issueGroupAccumulator, {
            rowNumbers: [rowNumber],
            severity: issue.severity,
            code: issue.code,
            fieldPath: issue.fieldPath ?? null,
            message: issue.message,
          });
        }

        const skuCode = typeof normalizedRow.skuCode === "string" ? normalizedRow.skuCode.trim() : "";
        if (skuCode) {
          const existing = skuCodesSeen.get(skuCode) ?? [];
          existing.push(rowNumber);
          skuCodesSeen.set(skuCode, existing);
        }

        const brand = typeof normalizedRow.brand === "string" ? normalizedRow.brand.trim() : "";
        if (brand) {
          brandsSeen.add(brand);
        }
        if (typeof normalizedRow.status === "string" && normalizedRow.status.trim()) {
          containsWorkflowStatus = true;
        }
      }

      // Detect duplicate skuCodes
      let duplicateCount = 0;
      for (const rowNumbers of skuCodesSeen.values()) {
        if (rowNumbers.length > 1) {
          duplicateCount++;
          blockingIssueCount += rowNumbers.length - 1;
          rowNumbers.forEach((rowNumber) => blockedRowNumbers.add(rowNumber));
          if (sampleIssues.length < 10) {
            sampleIssues.push({
              rowNumber: rowNumbers[0],
              code: "SKU_DUPLICATE_IN_JOB",
              message: `Duplicate skuCode across ${rowNumbers.length} rows`,
              severity: "blocking",
              fieldPath: "skuCode",
            });
          }
          this.addPreflightIssueGroup(issueGroupAccumulator, {
            rowNumbers,
            code: "SKU_DUPLICATE_IN_JOB",
            message: "Duplicate skuCode values exist in this file.",
            severity: "blocking",
            fieldPath: "skuCode",
          });
        }
      }

      let collisionCount = 0;
      const skuCodeValues = [...skuCodesSeen.keys()];
      // Build chunks first, then run all DB lookups in parallel.
      // Each chunk is independent (distinct skuCode slice), so Promise.all
      // is safe and reduces wall-time from N×RTT to 1×RTT for large imports.
      const chunks: string[][] = [];
      for (let i = 0; i < skuCodeValues.length; i += 1000) {
        const chunk = skuCodeValues.slice(i, i + 1000);
        if (chunk.length > 0) chunks.push(chunk);
      }
      const chunkResults = await Promise.all(
        chunks.map((chunk) =>
          this.prisma.tenant().variant.findMany({
            where: { skuCode: { in: chunk } },
            select: { skuCode: true },
          }),
        ),
      );
      for (const existingVariants of chunkResults) {
        for (const variant of existingVariants) {
          const rowNumbers = skuCodesSeen.get(variant.skuCode) ?? [];
          if (rowNumbers.length === 0) {
            continue;
          }
          collisionCount += rowNumbers.length;
          blockingIssueCount += rowNumbers.length;
          rowNumbers.forEach((rowNumber) => blockedRowNumbers.add(rowNumber));
          if (sampleIssues.length < 10) {
            sampleIssues.push({
              rowNumber: rowNumbers[0],
              code: "SKU_ALREADY_EXISTS",
              message: `skuCode already exists in catalog: ${variant.skuCode}`,
              severity: "blocking",
              fieldPath: "skuCode",
            });
          }
          this.addPreflightIssueGroup(issueGroupAccumulator, {
            rowNumbers,
            code: "SKU_ALREADY_EXISTS",
            message: "skuCode already exists in the catalog.",
            severity: "blocking",
            fieldPath: "skuCode",
          });
        }
      }

      // Check row ceiling — per-plan limit capped by the absolute system ceiling
      const planRowLimit = await this.planUsageService.getImportRowLimit(this.resolveTenantKey());
      const effectiveRowLimit = Math.min(planRowLimit, LARGE_IMPORT_ROW_CEILING);
      let mvpCeilingExceeded = false;
      if (totalRows > effectiveRowLimit) {
        mvpCeilingExceeded = true;
        blockingIssueCount++;
        if (sampleIssues.length < 10) {
          sampleIssues.push({
            rowNumber: effectiveRowLimit + 1,
            code: "ROW_LIMIT_EXCEEDED",
            message: `Your plan supports at most ${effectiveRowLimit} rows per import job.`,
            severity: "blocking",
            fieldPath: null,
          });
        }
        this.addPreflightIssueGroup(issueGroupAccumulator, {
          rowNumbers: [effectiveRowLimit + 1],
          code: "ROW_LIMIT_EXCEEDED",
          message: `Your plan supports at most ${effectiveRowLimit} rows per import job.`,
          severity: "blocking",
          fieldPath: null,
        });
      }

      // NOTE: bulk import deliberately does NOT check the cumulative plan SKU limit here.
      // Every row this job creates lands as RecordStatus.draft (see bulk-import.service.ts's
      // product.create/variant.create) — draft, parent-only, archived, and deleted records
      // don't count toward SKU usage (Plan & Usage's own copy states this, and
      // PlanUsageService's SELLABLE_VARIANT_WHERE enforces it on the read side). A SKU-limit
      // check here would block a tenant from staging drafts for review even at zero approved
      // usage. The limit is enforced instead where a variant actually becomes sellable — see
      // catalog.service.ts's enforceSkuLimitForApproval — which a bulk-imported draft still
      // has to pass through individually to be approved. (A prior revision of this file added
      // a checkLimit("skus", ...) call at draft-creation time; removed — it contradicted the
      // documented policy above.) If Vexa wants to bound draft catalog size independently of
      // SKU entitlement, that's the existing maxImportRowsPerJob ceiling's job, or a new,
      // separate limit — not a hidden reservation against SKU capacity.

      if (sourceRows.headers.length === 0 || totalRows === 0) {
        blockingIssueCount++;
        if (sampleIssues.length < 10) {
          sampleIssues.push({
            rowNumber: 0,
            code: sourceFormat === "json" ? "NO_ROWS" : "INVALID_CSV_SOURCE",
            message: sourceFormat === "json"
              ? "JSON import file must contain at least one row object."
              : "CSV must include a header row and at least one data row.",
            severity: "blocking",
            fieldPath: null,
          });
        }
        this.addPreflightIssueGroup(issueGroupAccumulator, {
          rowNumbers: [0],
          code: sourceFormat === "json" ? "NO_ROWS" : "INVALID_CSV_SOURCE",
          message: sourceFormat === "json"
            ? "JSON import file must contain at least one row object."
            : "CSV must include a header row and at least one data row.",
          severity: "blocking",
          fieldPath: null,
        });
      }

      if (containsWorkflowStatus) {
        await this.accessPolicy.assertBulkImportAllowed(actor ?? {}, {
          fields: ["status"],
          resourceId: runId,
        });
      }
      for (const brand of brandsSeen) {
        await this.accessPolicy.assertRequestedProductScopeAllowed(actor ?? {}, "import", {
          resource: "BulkImportRun",
          resourceId: runId,
          categoryId: run.categoryId,
          brand,
        });
      }

      // Determine effective mode
      let effectiveMode: BulkImportRunMode | null;
      let newStatus: BulkImportRunStatus;
      let estimatedBatchCount = 0;

      if (mvpCeilingExceeded) {
        effectiveMode = null;
        newStatus = BulkImportRunStatus.preflight_blocked;
      } else if (blockingIssueCount > 0) {
        effectiveMode = totalRows > LARGE_IMPORT_MODE_THRESHOLD ? BulkImportRunMode.large : BulkImportRunMode.standard;
        newStatus = BulkImportRunStatus.preflight_blocked;
      } else {
        effectiveMode = totalRows > LARGE_IMPORT_MODE_THRESHOLD ? BulkImportRunMode.large : BulkImportRunMode.standard;
        newStatus = BulkImportRunStatus.preflight_ready;
      }

      if (effectiveMode === BulkImportRunMode.large && !mvpCeilingExceeded) {
        estimatedBatchCount = Math.ceil(totalRows / LARGE_IMPORT_BATCH_SIZE);
      }

      const acceptedRows = Math.max(0, totalRows - blockedRowNumbers.size);
      const failedRows = blockedRowNumbers.size;

      const preflightSummary = {
        mapping: mappingSuggestion.mapping,
        unmappedFields: mappingSuggestion.unmappedFields,
        unusedHeaders: mappingSuggestion.unusedHeaders,
        issueGroups: this.sortPreflightIssueGroups(issueGroupAccumulator),
        sampleIssues,
        canImport: blockingIssueCount === 0 && totalRows > 0,
        skuCodeSummary: duplicateCount > 0 || collisionCount > 0 ? { duplicateCount, collisionCount } : null,
        mvpCeilingExceeded,
      };

      const updated = await this.prisma.tenant().bulkImportRun.update({
        where: { id: runId },
        data: {
          status: newStatus,
          totalRows,
          acceptedRows,
          failedRows,
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
        data: {
          status:
            error instanceof BadRequestException || error instanceof ForbiddenException
              ? BulkImportRunStatus.preflight_blocked
              : BulkImportRunStatus.failed,
        },
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
      if (run.status === BulkImportRunStatus.processing || run.status === BulkImportRunStatus.completed) {
        return this.getRun(runId, actor);
      }
      throw new BadRequestException(
        `Run must be in 'preflight_ready' status to start. Current status: ${run.status}`,
      );
    }

    const totalRows = run.totalRows ?? 0;
    const batchCount = Math.ceil(totalRows / LARGE_IMPORT_BATCH_SIZE);
    const tenantKey = this.resolveTenantKey();

    const jobIds: Array<{ id: string; batchIndex: number }> = [];

    await this.prisma.tenant().$transaction(async (tx) => {
      // Atomically claim the run — only the first concurrent request transitions
      // from preflight_ready. The `where` clause acts as an optimistic lock: if
      // another request already moved the status, updateMany returns count=0.
      const claimed = await tx.bulkImportRun.updateMany({
        where: { id: runId, status: BulkImportRunStatus.preflight_ready },
        data: {
          status: BulkImportRunStatus.processing,
          estimatedBatchCount: batchCount,
        },
      });
      if (claimed.count === 0) {
        return;
      }

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
    });

    if (jobIds.length > 0) {
      for (const { id: jobId, batchIndex } of jobIds) {
        await this.queueService.enqueue<LargeRunBatchPayload>(QUEUE_NAMES.BULK_IMPORT, {
          kind: "large_run_batch",
          runId,
          jobId,
          tenantKey,
          batchIndex,
        });
      }
    }

    return this.getRun(runId, actor);
  }

  async retryStuckRows(runId: string, actor?: PolicyActor) {
    const run = await this.getRun(runId, actor);

    const stuckJobs = await this.prisma.tenant().bulkImportJob.findMany({
      where: {
        runId,
        status: {
          in: [BulkImportJobStatus.retrying, BulkImportJobStatus.queued, BulkImportJobStatus.processing],
        },
      },
      select: { id: true, chunkSize: true },
    });

    if (stuckJobs.length === 0) {
      const jobsWithPendingRows = await this.prisma.tenant().bulkImportJob.findMany({
        where: { runId },
        select: { id: true, chunkSize: true },
      });
      for (const job of jobsWithPendingRows) {
        const pendingCount = await this.prisma.tenant().bulkImportRow.count({
          where: {
            jobId: job.id,
            status: { in: [BulkImportRowStatus.queued, BulkImportRowStatus.retrying] },
          },
        });
        if (pendingCount > 0) {
          stuckJobs.push(job);
        }
      }
    }

    if (stuckJobs.length === 0) {
      return this.getRun(runId, actor);
    }

    for (const job of stuckJobs) {
      await this.bulkImportService.processJob(job.id, job.chunkSize, actor);
    }

    await this.refreshRunCounters(runId);
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

      return this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, {
        items: page,
        limit,
        nextCursor:
          hasNext && last
            ? encodeCursorToken({
                sort: String(last.rowNumberGlobal ?? last.rowNumber),
                id: last.id,
              })
            : null,
      });
    }

    return this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, await this.prisma.tenant().bulkImportRow.findMany({
      where: {
        runId,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      orderBy: [{ rowNumberGlobal: "asc" }, { rowNumber: "asc" }],
      take: 200,
    }));
  }

  async buildRunErrorReportCsv(runId: string, actor?: PolicyActor): Promise<string> {
    const run = await this.getRun(runId, actor);

    const rows = await this.prisma.tenant().bulkImportRow.findMany({
      where: {
        runId,
        OR: [
          {
            status: {
              in: [
                BulkImportRowStatus.retrying,
                BulkImportRowStatus.failed,
                BulkImportRowStatus.dead_letter,
              ],
            },
          },
          { errorMessage: { not: null } },
        ],
      },
      orderBy: [{ rowNumberGlobal: "asc" }, { rowNumber: "asc" }],
      take: 10_000,
    });

    const lines: string[] = [
      ["runId", "jobId", "rowNumber", "skuCode", "status", "errorCode", "errorMessage", "attemptCount", "originalData"]
        .map((value) => this.toCsvCell(value))
        .join(","),
    ];

    for (const row of rows) {
      const visibleRow = this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, row) as typeof row;
      const originalData = this.asRowPayload(visibleRow.payload);
      lines.push(
        [
          visibleRow.runId ?? "",
          visibleRow.jobId,
          String(visibleRow.rowNumberGlobal ?? visibleRow.rowNumber),
          this.extractSkuCode(originalData),
          String(visibleRow.status),
          this.extractErrorCode(visibleRow.errorMessage),
          visibleRow.errorMessage ?? "",
          String(visibleRow.retryCount),
          JSON.stringify(originalData),
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
    const runPreflight = run.preflightSummary && typeof run.preflightSummary === "object"
      ? (run.preflightSummary as Record<string, unknown>)
      : {};
    const runMapping =
      runPreflight.mapping && typeof runPreflight.mapping === "object" && !Array.isArray(runPreflight.mapping)
        ? (runPreflight.mapping as Record<string, string>)
        : {};

    try {
      const sourceRows = await this.readStagedSourceRows(
        run.sourceFileKey,
        this.resolveSourceFormat(run.sourceFormat),
      );

      for (let index = 0; index < sourceRows.rows.length; index += 1) {
        const dataRowNumber = index + 1;

        if (dataRowNumber < rowStart) {
          continue;
        }
        if (dataRowNumber > rowEnd) {
          break;
        }

        const rawRow = sourceRows.rows[index];
        const normalizedRow = this.bulkImportService.normalizeCanonicalPayloadForImport(rawRow, runMapping);

        const rowNumberInBatch = dataRowNumber - rowStart + 1;
        const rowId = randomUUID();

        await this.prisma.tenant().bulkImportRow.create({
          data: {
            id: rowId,
            jobId,
            runId,
            rowNumber: rowNumberInBatch,
            rowNumberGlobal: dataRowNumber,
            rowNumberInBatch,
            payload: normalizedRow as Prisma.JsonObject,
            status: BulkImportRowStatus.queued,
          },
        });

        await this.bulkImportService.processSystemManagedRow(jobId, rowId);
      }

      await this.refreshLargeJobCounters(jobId);
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

  /**
   * Refreshes job status counters for large-run batch processing.
   *
   * Intentionally named `refreshLargeJobCounters` (not `refreshJobCounters`) to
   * distinguish it from BulkImportService.refreshJobCounters, which additionally
   * emits notifications and syncs linked run state. The two methods diverge by
   * design — do not consolidate them without accounting for those side effects.
   */
  private async refreshLargeJobCounters(jobId: string) {
    // groupBy replaces the prior findMany + in-memory loop: the DB aggregates
    // by status and returns at most one row per distinct status value instead of
    // shipping every row across the wire (potentially thousands per large batch job).
    const statusGroups = await this.prisma.tenant().bulkImportRow.groupBy({
      by: ["status"],
      where: { jobId },
      _count: { status: true },
    });

    let success = 0;
    let failed = 0;
    let deadLetter = 0;
    let pending = 0;
    for (const group of statusGroups) {
      const count = group._count.status;
      if (group.status === BulkImportRowStatus.success) success = count;
      else if (group.status === BulkImportRowStatus.failed) failed = count;
      else if (group.status === BulkImportRowStatus.dead_letter) deadLetter = count;
      else pending += count; // queued / processing / retrying
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
    let failedJobs = 0;

    for (const job of jobs) {
      totalSuccess += job.successRows;
      totalFailed += job.failedRows;
      totalDead += job.deadLetterRows;
      if (job.status === BulkImportJobStatus.failed) {
        failedJobs++;
      } else if (
        job.status !== BulkImportJobStatus.completed &&
        job.status !== BulkImportJobStatus.dead_letter
      ) {
        pendingJobs++;
      }
    }

    let runStatus: BulkImportRunStatus;
    if (failedJobs > 0) {
      runStatus = BulkImportRunStatus.failed;
    } else if (pendingJobs > 0) {
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

  private resolveSourceFormat(value: string | null | undefined): StagedSourceFormat {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "json" || normalized.endsWith(".json")) {
      return "json";
    }
    return "csv";
  }

  private async readStagedSourceRows(storageKey: string, sourceFormat: StagedSourceFormat): Promise<StagedSourceRows> {
    const stream = await this.storageService.readStagedSourceStream(storageKey);
    const raw = await this.readStreamToString(stream);
    if (sourceFormat === "json") {
      return this.parseJsonSourceRows(raw);
    }
    const rl = createInterface({
      input: Readable.from(raw),
      crlfDelay: Infinity,
    });
    let headers: string[] = [];
    const rows: Record<string, unknown>[] = [];
    let isHeader = true;
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isHeader) {
        headers = this.bulkImportService.parseCsvLineForImport(trimmed);
        isHeader = false;
        continue;
      }
      const values = this.bulkImportService.parseCsvLineForImport(trimmed);
      const row: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? "";
      });
      rows.push(row);
    }
    return { headers, rows };
  }

  private parseJsonSourceRows(content: string): StagedSourceRows {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new BadRequestException({
        code: "INVALID_JSON_SOURCE",
        message: "JSON import file must contain a valid array of row objects.",
        issues: [{
          rowNumber: 0,
          severity: "blocking",
          code: "INVALID_JSON_SOURCE",
          message: "JSON import file must contain a valid array of row objects.",
          fieldPath: null,
        }],
      });
    }
    if (!Array.isArray(parsed) || parsed.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
      throw new BadRequestException({
        code: "INVALID_JSON_SOURCE",
        message: "JSON import file must contain an array of row objects.",
        issues: [{
          rowNumber: 0,
          severity: "blocking",
          code: "INVALID_JSON_SOURCE",
          message: "JSON import file must contain an array of row objects.",
          fieldPath: null,
        }],
      });
    }
    const rows = parsed as Record<string, unknown>[];
    return {
      headers: this.bulkImportService.inferHeadersForImportRows(rows),
      rows,
    };
  }

  private async readStreamToString(stream: NodeJS.ReadableStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8"));
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  private asRowPayload(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private extractSkuCode(payload: Record<string, unknown>) {
    const candidates = [
      payload.skuCode,
      payload.sku,
      payload.sku_code,
      payload.SKU,
      payload.productSku,
      payload.product_sku,
      payload.attributes && typeof payload.attributes === "object" && !Array.isArray(payload.attributes)
        ? (payload.attributes as Record<string, unknown>).sku
        : undefined,
    ];
    for (const candidate of candidates) {
      if (candidate === null || candidate === undefined) {
        continue;
      }
      const value = String(candidate).trim();
      if (value) {
        return value;
      }
    }
    return "";
  }

  private extractErrorCode(message: string | null | undefined) {
    const match = String(message ?? "").match(/^([A-Z][A-Z0-9_]+):/);
    return match?.[1] ?? "";
  }

  private toCsvCell(value: string): string {
    return safeCsvCell(value);
  }
}
