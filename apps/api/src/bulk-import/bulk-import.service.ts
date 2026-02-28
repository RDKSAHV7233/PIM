import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { BulkImportJobStatus, BulkImportRowStatus, Prisma, RecordStatus } from "@prisma/client";
import * as XLSX from "xlsx";
import { ComplianceService } from "../compliance/compliance.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateBulkImportJobDto } from "./dto/create-bulk-import-job.dto";
import { RepairBulkImportRowDto } from "./dto/repair-bulk-import-row.dto";

type CanonicalRowPayload = {
  title?: string;
  description?: string;
  brand?: string;
  hsnCode?: string;
  gstRate?: number;
  status?: string;
  attributes?: Record<string, unknown>;
};

type MappingSuggestion = {
  mapping: Record<string, string>;
  confidence: Record<string, number>;
  unmappedFields: string[];
  unusedHeaders: string[];
};

const CANONICAL_FIELDS = [
  "title",
  "description",
  "brand",
  "hsnCode",
  "gstRate",
  "status",
  "attributes",
] as const;

const DEFAULT_MAPPING: Record<(typeof CANONICAL_FIELDS)[number], string> = {
  title: "title",
  description: "description",
  brand: "brand",
  hsnCode: "hsnCode",
  gstRate: "gstRate",
  status: "status",
  attributes: "attributes",
};

const FIELD_ALIASES: Record<(typeof CANONICAL_FIELDS)[number], string[]> = {
  title: ["name", "product_name", "item_name", "title"],
  description: ["description", "product_description", "details"],
  brand: ["brand", "brand_name", "maker"],
  hsnCode: ["hsn", "hsn_code", "hsncode", "tax_code"],
  gstRate: ["gst", "gst_rate", "tax_rate", "gstrate"],
  status: ["status", "state"],
  attributes: ["attributes", "attribute_json", "specs", "specifications"],
};

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const TERMINAL_ROW_STATUSES = [
  BulkImportRowStatus.success,
  BulkImportRowStatus.failed,
  BulkImportRowStatus.dead_letter,
] as const;

type BulkImportJobLike = {
  id: string;
  totalRows: number;
  processedRows: number;
  chunkSize: number;
};

type BulkImportJobMetrics = {
  checkpointRow: number;
  retryingRows: number;
  totalRetryAttempts: number;
  estimatedChunks: number;
  completedChunks: number;
};

@Injectable()
export class BulkImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceService: ComplianceService,
  ) {}

  suggestMapping(headers: string[]) {
    return this.suggestMappingFromHeaders(headers);
  }

  async createJob(dto: CreateBulkImportJobDto) {
    await this.requireCategory(dto.categoryId);

    const sourceRows = (() => {
      if (dto.sourceFormat === "csv") {
        if (dto.fileContentBase64) {
          return this.parseDelimitedBase64(dto.fileContentBase64, "csv");
        }
        return this.parseCsv(dto.csvContent ?? "");
      }
      if (dto.sourceFormat === "xlsx" || dto.sourceFormat === "xls") {
        if (!dto.fileContentBase64) {
          throw new BadRequestException(
            "fileContentBase64 is required for xlsx/xls source format.",
          );
        }
        return this.parseSpreadsheetBase64(dto.fileContentBase64);
      }
      return { headers: this.inferHeadersFromRows(dto.rows ?? []), rows: dto.rows ?? [] };
    })();

    const suggestion = this.suggestMappingFromHeaders(sourceRows.headers, dto.mapping);
    const normalizedRows = sourceRows.rows.map((row) =>
      this.normalizeCanonicalPayload(row, suggestion.mapping),
    );
    const sourceBytes = this.estimateSourceBytes(dto, normalizedRows);
    this.assertSourceSize(sourceBytes);

    if (normalizedRows.length === 0) {
      throw new BadRequestException("No import rows detected.");
    }
    if (normalizedRows.length > 10000) {
      throw new BadRequestException("Maximum 10,000 rows per job.");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const job = await tx.bulkImportJob.create({
        data: {
          categoryId: dto.categoryId,
          sourceFormat: dto.sourceFormat,
          sourceName: dto.sourceName?.trim() || null,
          mapping: suggestion.mapping as unknown as Prisma.JsonObject,
          chunkSize: dto.chunkSize ?? 100,
          maxRetries: dto.maxRetries ?? 3,
          status: BulkImportJobStatus.queued,
          totalRows: normalizedRows.length,
        },
      });

      await tx.bulkImportRow.createMany({
        data: normalizedRows.map((row, index) => ({
          jobId: job.id,
          rowNumber: index + 1,
          payload: row as Prisma.JsonObject,
          status: BulkImportRowStatus.queued,
        })),
      });
      return job;
    });

    return this.getJob(created.id);
  }

  async listJobs(status?: string) {
    const where = status
      ? {
          status: this.parseJobStatus(status),
        }
      : undefined;
    const jobs = await this.prisma.bulkImportJob.findMany({
      where,
      include: {
        category: { select: { id: true, path: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 50,
    });
    return this.attachMetrics(jobs);
  }

  async getJob(jobId: string) {
    const job = await this.prisma.bulkImportJob.findUnique({
      where: { id: jobId },
      include: {
        category: { select: { id: true, path: true } },
        rows: {
          orderBy: [{ rowNumber: "asc" }],
          take: 200,
        },
      },
    });
    if (!job) {
      throw new NotFoundException("Bulk import job not found");
    }
    return (await this.attachMetrics([job]))[0];
  }

  async listJobRows(jobId: string, status?: string, limit = 100) {
    await this.requireJob(jobId);
    const boundedLimit = Math.max(1, Math.min(5000, Number(limit) || 100));
    return this.prisma.bulkImportRow.findMany({
      where: {
        jobId,
        status: status ? this.parseRowStatus(status) : undefined,
      },
      orderBy: [{ rowNumber: "asc" }],
      take: boundedLimit,
    });
  }

  async processJob(jobId: string, chunkSize?: number) {
    const job = await this.requireJob(jobId);
    if (job.status === BulkImportJobStatus.completed) {
      return this.getJob(job.id);
    }

    const effectiveChunk = Math.max(1, Math.min(500, chunkSize ?? job.chunkSize));
    await this.prisma.bulkImportJob.update({
      where: { id: job.id },
      data: {
        status: BulkImportJobStatus.processing,
      },
    });

    const rows = await this.prisma.bulkImportRow.findMany({
      where: {
        jobId: job.id,
        status: {
          in: [BulkImportRowStatus.queued, BulkImportRowStatus.retrying],
        },
      },
      orderBy: [{ rowNumber: "asc" }],
      take: effectiveChunk,
    });

    for (const row of rows) {
      await this.processRow(job, row);
    }

    await this.refreshJobCounters(job.id);
    return this.getJob(job.id);
  }

  async processRowById(jobId: string, rowId: string) {
    const job = await this.requireJob(jobId);
    const row = await this.requireRow(jobId, rowId);
    if (row.status === BulkImportRowStatus.success) {
      return row;
    }

    await this.processRow(job, row);
    await this.refreshJobCounters(jobId);
    return this.requireRow(jobId, rowId);
  }

  async repairRow(jobId: string, rowId: string, dto: RepairBulkImportRowDto) {
    await this.requireJob(jobId);
    const row = await this.requireRow(jobId, rowId);
    const existingPayload = this.asRowPayload(row.payload);
    const payload = dto.payload ? { ...existingPayload, ...dto.payload } : existingPayload;
    const requeue = dto.requeue ?? true;

    await this.prisma.bulkImportRow.update({
      where: { id: row.id },
      data: {
        payload: payload as Prisma.JsonObject,
        errorMessage: null,
        productId: requeue ? null : row.productId,
        retryCount: requeue ? 0 : row.retryCount,
        status: requeue ? BulkImportRowStatus.queued : BulkImportRowStatus.retrying,
      },
    });

    await this.refreshJobCounters(jobId);
    return this.requireRow(jobId, rowId);
  }

  async requeueDlq(jobId: string, limit = 100) {
    await this.requireJob(jobId);
    const boundedLimit = Math.max(1, Math.min(5000, Number(limit) || 100));
    const rows = await this.prisma.bulkImportRow.findMany({
      where: {
        jobId,
        status: BulkImportRowStatus.dead_letter,
      },
      orderBy: [{ rowNumber: "asc" }],
      take: boundedLimit,
      select: { id: true },
    });

    if (rows.length > 0) {
      await this.prisma.bulkImportRow.updateMany({
        where: {
          id: {
            in: rows.map((row) => row.id),
          },
        },
        data: {
          status: BulkImportRowStatus.queued,
          retryCount: 0,
          errorMessage: null,
        },
      });
    }

    await this.refreshJobCounters(jobId);
    return this.getJob(jobId);
  }

  async buildErrorReportCsv(jobId: string) {
    await this.requireJob(jobId);
    const rows = await this.prisma.bulkImportRow.findMany({
      where: {
        jobId,
        status: {
          in: [
            BulkImportRowStatus.retrying,
            BulkImportRowStatus.failed,
            BulkImportRowStatus.dead_letter,
          ],
        },
      },
      orderBy: [{ rowNumber: "asc" }],
      select: {
        rowNumber: true,
        status: true,
        retryCount: true,
        errorMessage: true,
        payload: true,
      },
    });

    const header = ["row_number", "status", "retry_count", "error_message", "payload_json"];
    const lines = [header.map((value) => this.toCsvCell(value)).join(",")];
    for (const row of rows) {
      lines.push(
        [
          String(row.rowNumber),
          row.status,
          String(row.retryCount),
          row.errorMessage ?? "",
          JSON.stringify(this.asRowPayload(row.payload)),
        ]
          .map((value) => this.toCsvCell(value))
          .join(","),
      );
    }
    return lines.join("\n");
  }

  private async processRow(
    job: {
      id: string;
      categoryId: string;
      maxRetries: number;
    },
    row: {
      id: string;
      payload: Prisma.JsonValue;
      retryCount: number;
      productId: string | null;
    },
  ) {
    await this.prisma.bulkImportRow.update({
      where: { id: row.id },
      data: {
        status: BulkImportRowStatus.processing,
        lastAttemptAt: new Date(),
      },
    });

    try {
      const payload = this.asRowPayload(row.payload);
      const title = (payload.title ?? "").trim();
      if (!title) {
        throw new BadRequestException("title is required");
      }

      const product = await this.prisma.product.create({
        data: {
          title,
          description: (payload.description ?? "").trim(),
          brand: (payload.brand ?? "").trim(),
          categoryId: job.categoryId,
          hsnCode: payload.hsnCode ? payload.hsnCode.trim() : null,
          gstRate: payload.gstRate ?? null,
          attributes: (payload.attributes ?? {}) as Prisma.JsonObject,
          status: this.normalizeRecordStatus(payload.status),
        },
      });
      await this.complianceService.validateAndPersistProduct(product.id);

      await this.prisma.bulkImportRow.update({
        where: { id: row.id },
        data: {
          status: BulkImportRowStatus.success,
          retryCount: row.retryCount,
          errorMessage: null,
          productId: product.id,
        },
      });
    } catch (error: unknown) {
      const nextRetry = row.retryCount + 1;
      const message = this.extractErrorMessage(error);

      await this.prisma.bulkImportRow.update({
        where: { id: row.id },
        data: {
          retryCount: nextRetry,
          errorMessage: message,
          status:
            nextRetry >= job.maxRetries ? BulkImportRowStatus.dead_letter : BulkImportRowStatus.retrying,
        },
      });
    }
  }

  private async refreshJobCounters(jobId: string) {
    const rows = await this.prisma.bulkImportRow.findMany({
      where: { jobId },
      select: { status: true },
    });

    const counters = {
      success: 0,
      failed: 0,
      deadLetter: 0,
      pending: 0,
    };
    for (const row of rows) {
      if (row.status === BulkImportRowStatus.success) {
        counters.success += 1;
      } else if (row.status === BulkImportRowStatus.failed) {
        counters.failed += 1;
      } else if (row.status === BulkImportRowStatus.dead_letter) {
        counters.deadLetter += 1;
      } else {
        counters.pending += 1;
      }
    }

    let status: BulkImportJobStatus;
    if (counters.pending > 0) {
      status = BulkImportJobStatus.retrying;
    } else if (counters.deadLetter > 0 || counters.failed > 0) {
      status = BulkImportJobStatus.dead_letter;
    } else {
      status = BulkImportJobStatus.completed;
    }

    await this.prisma.bulkImportJob.update({
      where: { id: jobId },
      data: {
        status,
        processedRows: counters.success + counters.failed + counters.deadLetter,
        successRows: counters.success,
        failedRows: counters.failed,
        deadLetterRows: counters.deadLetter,
      },
    });
  }

  private suggestMappingFromHeaders(headersInput: string[], provided?: Record<string, string>) {
    const headers = [...new Set(headersInput.map((header) => header.trim()).filter((header) => header.length > 0))];
    const providedMapping: Record<string, string> = {};
    for (const [key, value] of Object.entries(provided ?? {})) {
      const canonical = key as (typeof CANONICAL_FIELDS)[number];
      if (!CANONICAL_FIELDS.includes(canonical)) {
        continue;
      }
      const trimmed = String(value ?? "").trim();
      if (trimmed.length > 0) {
        providedMapping[canonical] = this.findHeaderCase(headers, trimmed) ?? trimmed;
      }
    }

    const confidence: Record<string, number> = {};
    const mapping: Record<string, string> = {};

    for (const field of CANONICAL_FIELDS) {
      if (providedMapping[field]) {
        mapping[field] = providedMapping[field];
        confidence[field] = 1;
        continue;
      }

      let bestHeader = "";
      let bestScore = 0;
      for (const header of headers) {
        const score = this.scoreHeader(field, header);
        if (score > bestScore) {
          bestScore = score;
          bestHeader = header;
        }
      }

      if (bestHeader && bestScore >= 0.45) {
        mapping[field] = bestHeader;
      } else {
        mapping[field] = DEFAULT_MAPPING[field];
      }
      confidence[field] = bestScore;
    }

    const usedHeaders = new Set(Object.values(mapping).map((header) => header.toLowerCase()));
    const unmappedFields = CANONICAL_FIELDS.filter((field) => confidence[field] < 0.45);
    const unusedHeaders = headers.filter((header) => !usedHeaders.has(header.toLowerCase()));

    return {
      mapping,
      confidence,
      unmappedFields,
      unusedHeaders,
    } satisfies MappingSuggestion;
  }

  private parseCsv(content: string) {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length < 2) {
      throw new BadRequestException("CSV must include header and at least one data row.");
    }

    const headers = this.parseCsvLine(lines[0]).map((header) => header.trim());
    if (headers.some((header) => !header)) {
      throw new BadRequestException("CSV header contains empty column names.");
    }

    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i < lines.length; i += 1) {
      const values = this.parseCsvLine(lines[i]);
      const row: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? "";
      });
      rows.push(row);
    }
    return {
      headers,
      rows,
    };
  }

  private parseDelimitedBase64(contentBase64: string, format: "csv") {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(contentBase64, "base64");
    } catch {
      throw new BadRequestException(`Invalid ${format} fileContentBase64 payload.`);
    }
    this.assertSourceSize(buffer.length);
    const raw = buffer.toString("utf8");
    return this.parseCsv(raw);
  }

  private parseSpreadsheetBase64(contentBase64: string) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(contentBase64, "base64");
    } catch {
      throw new BadRequestException("Invalid spreadsheet payload.");
    }
    this.assertSourceSize(buffer.length);

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: "buffer" });
    } catch {
      throw new BadRequestException("Invalid spreadsheet payload.");
    }

    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      throw new BadRequestException("Spreadsheet contains no sheets.");
    }
    const sheet = workbook.Sheets[firstSheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });
    if (matrix.length < 2) {
      throw new BadRequestException(
        "Spreadsheet must include header and at least one data row.",
      );
    }

    const headers = matrix[0].map((value) => String(value ?? "").trim());
    if (headers.some((header) => header.length === 0)) {
      throw new BadRequestException("Spreadsheet header contains empty column names.");
    }

    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i < matrix.length; i += 1) {
      const rowArray = matrix[i];
      const row: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        row[header] = rowArray[index] ?? "";
      });
      rows.push(row);
    }
    return { headers, rows };
  }

  private inferHeadersFromRows(rows: Record<string, unknown>[]) {
    const headerSet = new Set<string>();
    for (const row of rows) {
      Object.keys(row).forEach((key) => headerSet.add(key));
    }
    return [...headerSet];
  }

  private normalizeCanonicalPayload(
    input: Record<string, unknown>,
    mapping: Record<string, string>,
  ): CanonicalRowPayload {
    const title = this.pickMappedValue(input, mapping.title);
    const description = this.pickMappedValue(input, mapping.description);
    const brand = this.pickMappedValue(input, mapping.brand);
    const hsnCode = this.pickMappedValue(input, mapping.hsnCode);
    const gstRateRaw = this.pickMappedValue(input, mapping.gstRate);
    const status = this.pickMappedValue(input, mapping.status);
    const attributesRaw = this.pickMappedValue(input, mapping.attributes);

    return {
      title: this.asTrimmedString(title),
      description: this.asTrimmedString(description),
      brand: this.asTrimmedString(brand),
      hsnCode: this.asTrimmedString(hsnCode),
      gstRate: this.asOptionalNumber(gstRateRaw),
      status: this.asTrimmedString(status),
      attributes: this.parseAttributes(attributesRaw),
    };
  }

  private parseCsvLine(line: string) {
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

  private pickMappedValue(row: Record<string, unknown>, key: string) {
    if (key in row) {
      return row[key];
    }
    const found = Object.entries(row).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    return found ? found[1] : undefined;
  }

  private parseAttributes(input: unknown) {
    if (!input) {
      return {};
    }
    if (typeof input === "object" && !Array.isArray(input)) {
      return input as Record<string, unknown>;
    }
    const text = String(input).trim();
    if (!text) {
      return {};
    }
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  private normalizeRecordStatus(value?: string) {
    const normalized = (value ?? "").trim().toLowerCase();
    if (normalized === "active") {
      return RecordStatus.active;
    }
    if (normalized === "archived") {
      return RecordStatus.archived;
    }
    return RecordStatus.draft;
  }

  private asRowPayload(value: Prisma.JsonValue): CanonicalRowPayload {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as CanonicalRowPayload;
    }
    return {};
  }

  private asTrimmedString(value: unknown) {
    if (value === null || value === undefined) {
      return undefined;
    }
    const text = String(value).trim();
    return text || undefined;
  }

  private asOptionalNumber(value: unknown) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private parseJobStatus(value: string) {
    const normalized = value.trim().toLowerCase();
    if ((Object.values(BulkImportJobStatus) as string[]).includes(normalized)) {
      return normalized as BulkImportJobStatus;
    }
    throw new BadRequestException("Invalid bulk import job status filter.");
  }

  private parseRowStatus(value: string) {
    const normalized = value.trim().toLowerCase();
    if ((Object.values(BulkImportRowStatus) as string[]).includes(normalized)) {
      return normalized as BulkImportRowStatus;
    }
    throw new BadRequestException("Invalid bulk import row status filter.");
  }

  private extractErrorMessage(error: unknown) {
    if (error instanceof BadRequestException) {
      return String(error.message);
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Bulk import row processing failed.";
  }

  private toCsvCell(value: string) {
    const escaped = String(value ?? "").replace(/"/g, '""');
    return `"${escaped}"`;
  }

  private scoreHeader(field: (typeof CANONICAL_FIELDS)[number], header: string) {
    const normalizedHeader = this.normalizeToken(header);
    const normalizedField = this.normalizeToken(field);
    if (!normalizedHeader) {
      return 0;
    }
    if (normalizedHeader === normalizedField) {
      return 1;
    }

    const aliases = FIELD_ALIASES[field].map((alias) => this.normalizeToken(alias));
    if (aliases.includes(normalizedHeader)) {
      return 0.95;
    }
    if (normalizedHeader.includes(normalizedField) || normalizedField.includes(normalizedHeader)) {
      return 0.8;
    }

    const headerTokens = this.tokenize(header);
    const aliasTokens = new Set(aliases.flatMap((alias) => alias.split("_")));
    const overlap = headerTokens.filter((token) => aliasTokens.has(token)).length;
    if (headerTokens.length > 0) {
      return overlap / headerTokens.length;
    }
    return 0;
  }

  private normalizeToken(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private tokenize(value: string) {
    return this.normalizeToken(value)
      .split("_")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  private findHeaderCase(headers: string[], candidate: string) {
    const normalized = candidate.trim().toLowerCase();
    const found = headers.find((header) => header.toLowerCase() === normalized);
    return found ?? null;
  }

  private assertSourceSize(bytes: number) {
    if (bytes > MAX_SOURCE_BYTES) {
      throw new BadRequestException(
        `Source payload exceeds ${Math.floor(MAX_SOURCE_BYTES / (1024 * 1024))}MB limit.`,
      );
    }
  }

  private estimateSourceBytes(dto: CreateBulkImportJobDto, rows: CanonicalRowPayload[]) {
    if (dto.fileContentBase64) {
      return this.estimateBase64Bytes(dto.fileContentBase64);
    }
    if (dto.sourceFormat === "csv") {
      return Buffer.byteLength(dto.csvContent ?? "", "utf8");
    }
    return Buffer.byteLength(JSON.stringify(rows), "utf8");
  }

  private estimateBase64Bytes(contentBase64: string) {
    const normalized = contentBase64.replace(/\s+/g, "");
    const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((normalized.length * 3) / 4) - padding);
  }

  private async attachMetrics<T extends BulkImportJobLike>(jobs: T[]) {
    if (jobs.length === 0) {
      return jobs as Array<T & { metrics: BulkImportJobMetrics }>;
    }
    const jobIds = jobs.map((job) => job.id);
    const [statusGroups, retryGroups, checkpointGroups] = await Promise.all([
      this.prisma.bulkImportRow.groupBy({
        by: ["jobId", "status"],
        where: {
          jobId: {
            in: jobIds,
          },
        },
        _count: {
          _all: true,
        },
      }),
      this.prisma.bulkImportRow.groupBy({
        by: ["jobId"],
        where: {
          jobId: {
            in: jobIds,
          },
        },
        _sum: {
          retryCount: true,
        },
      }),
      this.prisma.bulkImportRow.groupBy({
        by: ["jobId"],
        where: {
          jobId: {
            in: jobIds,
          },
          status: {
            in: [...TERMINAL_ROW_STATUSES],
          },
        },
        _max: {
          rowNumber: true,
        },
      }),
    ]);

    const retryingRowsByJob = new Map<string, number>();
    for (const group of statusGroups) {
      if (group.status === BulkImportRowStatus.retrying) {
        retryingRowsByJob.set(group.jobId, group._count._all);
      }
    }

    const retryAttemptsByJob = new Map<string, number>();
    for (const group of retryGroups) {
      retryAttemptsByJob.set(group.jobId, group._sum.retryCount ?? 0);
    }

    const checkpointByJob = new Map<string, number>();
    for (const group of checkpointGroups) {
      checkpointByJob.set(group.jobId, group._max.rowNumber ?? 0);
    }

    return jobs.map((job) => {
      const estimatedChunks = job.totalRows > 0 ? Math.ceil(job.totalRows / job.chunkSize) : 0;
      const completedChunks =
        estimatedChunks > 0
          ? Math.min(estimatedChunks, Math.ceil(job.processedRows / job.chunkSize))
          : 0;
      return {
        ...job,
        metrics: {
          checkpointRow: checkpointByJob.get(job.id) ?? 0,
          retryingRows: retryingRowsByJob.get(job.id) ?? 0,
          totalRetryAttempts: retryAttemptsByJob.get(job.id) ?? 0,
          estimatedChunks,
          completedChunks,
        } satisfies BulkImportJobMetrics,
      };
    });
  }

  private async requireJob(jobId: string) {
    const job = await this.prisma.bulkImportJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException("Bulk import job not found");
    }
    return job;
  }

  private async requireRow(jobId: string, rowId: string) {
    const row = await this.prisma.bulkImportRow.findFirst({
      where: {
        id: rowId,
        jobId,
      },
    });
    if (!row) {
      throw new NotFoundException("Bulk import row not found for this job");
    }
    return row;
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }
}
