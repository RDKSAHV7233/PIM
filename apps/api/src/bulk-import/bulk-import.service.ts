import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { createInterface } from "node:readline";
import { BulkImportJobStatus, BulkImportRowStatus, BulkImportRunStatus, Prisma, RecordStatus, TaxCodeKey } from "@prisma/client";
import { AccessPolicyService, PolicyActor } from "../common/access-policy/access-policy.service";
import { getCorrelationContext } from "../common/logging/correlation-context";
import { LoggerService } from "../common/logging/logger.service";
import { ComplianceService } from "../compliance/compliance.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PlanUsageService } from "../billing/plan-usage.service";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { MetricsService } from "../metrics/metrics.service";
import { BulkImportStorageService } from "./bulk-import-storage.service";
import { CreateBulkImportJobDto } from "./dto/create-bulk-import-job.dto";
import { CreateBulkImportTemplateDto } from "./dto/create-bulk-import-template.dto";
import { RepairBulkImportRowDto } from "./dto/repair-bulk-import-row.dto";

export type BulkImportFailureClass = "source_data" | "mapping" | "policy" | "storage" | "platform" | "unknown";

export type BulkImportValidationIssue = {
  rowNumber: number;
  severity: "blocking" | "warning";
  code: string;
  message: string;
  fieldPath?: string | null;
  remediation?: string | null;
};

export type BulkImportPreparedSourceRows = {
  headers: string[];
  rows: Record<string, unknown>[];
};

export type BulkImportPreflightSummary = {
  sourceFormat: "csv" | "json";
  sourceName: string | null;
  categoryId: string;
  categoryPath: string;
  totalRows: number;
  blockingIssueCount: number;
  warningCount: number;
  acceptedRows: number;
  failedRows: number;
  deadLetterRows: number;
  canImport: boolean;
  mapping: Record<string, string>;
  unmappedFields: string[];
  unusedHeaders: string[];
  issues: BulkImportValidationIssue[];
  sampleIssues: BulkImportValidationIssue[];
  failureCode?: string;
  failureClass?: BulkImportFailureClass;
  failureMessage?: string;
  correlationId?: string;
  repairSummary: {
    acceptedRows: number;
    failedRows: number;
    deadLetterRows: number;
  };
};

export type BulkImportValidationFailureResponse = {
  message: string;
  issues: BulkImportValidationIssue[];
  sampleIssues: BulkImportValidationIssue[];
  canImport: false;
  failureCode?: string;
  failureClass?: BulkImportFailureClass;
  correlationId?: string;
};

type TaxCodeEntry = {
  regimeKey: string;
  key: string;
  value: string;
  rate?: number;
};

type CanonicalRowPayload = {
  title?: string;
  description?: string;
  brand?: string;
  hsnCode?: string;
  gstRate?: number;
  status?: string;
  attributes?: Record<string, unknown>;
  /** Structured international tax codes; collected from flat CSV columns (gb_commodity_code etc.) or JSON taxCodes array. */
  taxCodes?: TaxCodeEntry[];
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
const LARGE_IMPORT_ROW_CEILING = 30_000;
const TEMPLATE_SOURCE_FORMATS = new Set(["csv", "json"]);
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

type CategoryAttributeSnapshot = {
  key: string;
  dataType: string;
  required: boolean;
  appliesTo: string;
};

type TemplateSchemaSnapshot = {
  capturedAt: string;
  attributes: CategoryAttributeSnapshot[];
};

type TemplateCompatibility = {
  compatible: boolean;
  warnings: string[];
};

type BulkImportTemplateLike = {
  id: string;
  categoryId: string;
  schemaSnapshot: Prisma.JsonValue | null;
};

type BulkImportTemplateRow = BulkImportTemplateLike & {
  tenantKey: string;
  name: string;
  version: number;
  sourceFormat: string;
  mapping: Prisma.JsonValue;
  chunkSize: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
  categoryPath: string;
};

/** Single source of truth for the WORKFLOW_ENTRY_INVALID error code. */
const WORKFLOW_ENTRY_INVALID_CODE = "WORKFLOW_ENTRY_INVALID" as const;

const SOURCE_DATA_FAILURE_CODES = new Set([
  "NO_ROWS",
  "ROW_LIMIT_EXCEEDED",
  "TITLE_REQUIRED",
  "GST_RATE_INVALID",
  "HSN_CODE_RECOMMENDED",
  "BRAND_RECOMMENDED",
  "ATTRIBUTES_INVALID",
  "WORKFLOW_ENTRY_INVALID",
  "INVALID_JSON_SOURCE",
  "INVALID_CSV_SOURCE",
  "SKU_DUPLICATE_IN_JOB",
  "SKU_ALREADY_EXISTS",
  "RUN_VALIDATION_INVALID",
  "DIRECT_VALIDATION_INVALID",
]);
const MAPPING_FAILURE_CODES = new Set(["UNMAPPED_FIELDS", "MAPPING_COVERAGE_INSUFFICIENT", "FIELD_ALIGNMENT_FAILED"]);
const POLICY_FAILURE_CODES = new Set([
  "ACCESS_POLICY_DENIED",
  "CATEGORY_SCOPE_DENIED",
  "FIELD_WRITE_RESTRICTED",
  "RUN_VALIDATION_FORBIDDEN",
  "DIRECT_VALIDATION_FORBIDDEN",
]);
const STORAGE_FAILURE_CODES = new Set([
  "STAGED_SOURCE_UNAVAILABLE",
  "STAGED_SOURCE_READ_FAILED",
  "RUN_VALIDATION_STORAGE_FAILED",
]);
const PLATFORM_FAILURE_CODES = new Set([
  "RUN_VALIDATION_FAILED",
  "DIRECT_VALIDATION_FAILED",
  "SERVICE_UNAVAILABLE",
]);

export function resolveBulkImportIssueRemediation(code: string, fieldPath?: string | null): string | null {
  switch (String(code ?? "").trim().toUpperCase()) {
    case "NO_ROWS":
      return "Add at least one import row to the source file and validate again.";
    case "ROW_LIMIT_EXCEEDED":
      return "Split the file into smaller batches within the tenant row limit, then re-run validation.";
    case "UNMAPPED_FIELDS":
      return "Rename the source columns to the canonical field names or update the mapping before import.";
    case "TITLE_REQUIRED":
      return "Populate the title field for every affected row before importing.";
    case "BRAND_RECOMMENDED":
      return "Add a brand value to improve marketplace readiness for the affected rows.";
    case "GST_RATE_INVALID":
      return "Use a non-negative numeric GST rate for the affected rows.";
    case "HSN_CODE_RECOMMENDED":
      return "Provide an HSN code so downstream tax and marketplace exports stay complete.";
    case "WORKFLOW_ENTRY_INVALID":
      return "Set status to draft or leave it blank so imported rows enter the workflow correctly.";
    case "ATTRIBUTES_INVALID":
      return "Convert attributes into a JSON object with key/value pairs before importing.";
    case "INVALID_JSON_SOURCE":
      return "Upload valid JSON containing an array of row objects and validate again.";
    case "INVALID_CSV_SOURCE":
      return "Upload a CSV file with a header row and at least one data row, then validate again.";
    case "SKU_DUPLICATE_IN_JOB":
      return "Deduplicate skuCode values inside the file before importing.";
    case "SKU_ALREADY_EXISTS":
      return "Change the skuCode or update the existing catalog record instead of importing a duplicate.";
    case "ACCESS_POLICY_DENIED":
    case "CATEGORY_SCOPE_DENIED":
    case "FIELD_WRITE_RESTRICTED":
      return "Use an account with the required import scope or request access to the target category and fields.";
    case "RUN_VALIDATION_STORAGE_FAILED":
    case "STAGED_SOURCE_READ_FAILED":
    case "STAGED_SOURCE_UNAVAILABLE":
      return "Re-upload the source file. If the problem persists, check staged-file storage health.";
    case "RUN_VALIDATION_FAILED":
    case "DIRECT_VALIDATION_FAILED":
      return "Retry validation. If the same error repeats, share the correlation ID with support.";
    default:
      return fieldPath ? `Review ${fieldPath} and correct the source data before retrying.` : null;
  }
}

export function enrichBulkImportValidationIssue(issue: BulkImportValidationIssue): BulkImportValidationIssue {
  return {
    ...issue,
    fieldPath: issue.fieldPath ?? null,
    remediation: issue.remediation ?? resolveBulkImportIssueRemediation(issue.code, issue.fieldPath ?? null),
  };
}

export function inferBulkImportFailureClass(input: {
  code?: string | null;
  message?: string | null;
  issues?: BulkImportValidationIssue[] | null;
}): BulkImportFailureClass {
  const code = String(input.code ?? "").trim().toUpperCase();
  const message = String(input.message ?? "").trim();

  if (POLICY_FAILURE_CODES.has(code) || /access[_ ]policy|scope denied|forbidden/i.test(message)) {
    return "policy";
  }
  if (
    STORAGE_FAILURE_CODES.has(code) ||
    /staged import file|staged source|read from storage|storage is not configured|s3\/r2/i.test(message)
  ) {
    return "storage";
  }
  if (SOURCE_DATA_FAILURE_CODES.has(code)) {
    return "source_data";
  }
  if (MAPPING_FAILURE_CODES.has(code)) {
    return "mapping";
  }
  if (PLATFORM_FAILURE_CODES.has(code) || /unexpected error|internal server error|service unavailable|runtime/i.test(message)) {
    return "platform";
  }

  const issues = Array.isArray(input.issues) ? input.issues.map(enrichBulkImportValidationIssue) : [];
  const issueCodes = issues.map((issue) => String(issue.code ?? "").trim().toUpperCase());
  if (issueCodes.some((issueCode) => MAPPING_FAILURE_CODES.has(issueCode))) {
    return "mapping";
  }
  if (issueCodes.some((issueCode) => SOURCE_DATA_FAILURE_CODES.has(issueCode))) {
    return "source_data";
  }
  if (issueCodes.some((issueCode) => POLICY_FAILURE_CODES.has(issueCode))) {
    return "policy";
  }
  return "unknown";
}

type BulkImportValidationFailureDetails = {
  code?: string;
  message: string;
  issues: BulkImportValidationIssue[];
  failureClass: BulkImportFailureClass;
  correlationId?: string;
};

@Injectable()
export class BulkImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceService: ComplianceService,
    private readonly notificationsService: NotificationsService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly planUsageService: PlanUsageService,
    private readonly metricsService: MetricsService,
    private readonly logger: LoggerService,
    private readonly storageService: BulkImportStorageService,
  ) {}

  suggestMapping(headers: string[]) {
    return this.suggestMappingFromHeaders(headers);
  }

  parseCsvLineForImport(line: string) {
    return this.parseCsvLine(line);
  }

  parseCsvForImport(content: string): BulkImportPreparedSourceRows {
    return this.parseCsv(content);
  }

  normalizeCanonicalPayloadForImport(
    input: Record<string, unknown>,
    mapping: Record<string, string>,
  ): CanonicalRowPayload {
    return this.normalizeCanonicalPayload(input, mapping);
  }

  inferHeadersForImportRows(rows: Record<string, unknown>[]) {
    return this.inferHeadersFromRows(rows);
  }

  validateCanonicalRowForImport(row: CanonicalRowPayload): BulkImportValidationIssue[] {
    return this.validateCanonicalRow(row);
  }

  buildPreflightSummaryFromSourceRows(input: {
    sourceFormat: "csv" | "json";
    sourceName?: string | null;
    categoryId: string;
    categoryPath: string;
    sourceRows: BulkImportPreparedSourceRows;
    mapping?: Record<string, string>;
    importRowLimit: number;
  }): BulkImportPreflightSummary {
    const suggestion = this.suggestMappingFromHeaders(input.sourceRows.headers, input.mapping);
    const normalizedRows = input.sourceRows.rows.map((row) => this.normalizeCanonicalPayload(row, suggestion.mapping));

    const issues: BulkImportValidationIssue[] = [];
    let blockingIssueCount = 0;
    let warningCount = 0;
    let acceptedRows = 0;
    let failedRows = 0;

    if (normalizedRows.length === 0) {
      issues.push({
        rowNumber: 0,
        severity: "blocking",
        code: "NO_ROWS",
        message: "No import rows detected.",
        fieldPath: null,
      });
      blockingIssueCount += 1;
    }

    if (normalizedRows.length > input.importRowLimit) {
      issues.push({
        rowNumber: 0,
        severity: "blocking",
        code: "ROW_LIMIT_EXCEEDED",
        message: `Maximum ${input.importRowLimit.toLocaleString("en-US")} rows per job.`,
        fieldPath: null,
      });
      blockingIssueCount += 1;
    }

    if (suggestion.unmappedFields.length > 0) {
      warningCount += suggestion.unmappedFields.length;
      issues.push({
        rowNumber: 0,
        severity: "warning",
        code: "UNMAPPED_FIELDS",
        message: `Unmapped source fields detected: ${suggestion.unmappedFields.join(", ")}`,
        fieldPath: null,
      });
    }

    for (const [index, row] of normalizedRows.entries()) {
      const rowIssues = this.validateCanonicalRow(row);
      const hasBlocking = rowIssues.some((issue) => issue.severity === "blocking");
      if (hasBlocking) {
        failedRows += 1;
      } else {
        acceptedRows += 1;
      }
      for (const issue of rowIssues) {
        if (issue.severity === "blocking") {
          blockingIssueCount += 1;
        } else {
          warningCount += 1;
        }
        if (issues.length < 12) {
          issues.push({
            rowNumber: index + 1,
            severity: issue.severity,
            code: issue.code,
            message: issue.message,
            fieldPath: issue.fieldPath ?? null,
          });
        }
      }
    }

    const normalizedIssues = issues.map((issue) => enrichBulkImportValidationIssue(issue));
    const correlationId = this.getCorrelationId();

    return {
      sourceFormat: input.sourceFormat,
      sourceName: input.sourceName?.trim() || null,
      categoryId: input.categoryId,
      categoryPath: input.categoryPath,
      totalRows: normalizedRows.length,
      blockingIssueCount,
      warningCount,
      acceptedRows,
      failedRows,
      deadLetterRows: 0,
      canImport: blockingIssueCount === 0 && normalizedRows.length > 0,
      mapping: suggestion.mapping,
      unmappedFields: suggestion.unmappedFields,
      unusedHeaders: suggestion.unusedHeaders,
      issues: normalizedIssues,
      sampleIssues: normalizedIssues,
      failureClass: blockingIssueCount > 0 ? inferBulkImportFailureClass({ issues: normalizedIssues }) : undefined,
      correlationId,
      repairSummary: {
        acceptedRows,
        failedRows,
        deadLetterRows: 0,
      },
    };
  }

  async processSystemManagedRow(jobId: string, rowId: string) {
    const job = await this.requireJob(jobId);
    const row = await this.requireRow(jobId, rowId);
    if (row.status === BulkImportRowStatus.success) {
      return row;
    }
    await this.processRow(job, row);
    return this.requireRow(jobId, rowId);
  }

  async createTemplate(dto: CreateBulkImportTemplateDto, actor?: PolicyActor) {
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", dto.categoryId, "BulkImportTemplate");
    const category = await this.requireCategory(dto.categoryId);
    const tenantKey = this.resolveRequestTenantKey(dto.tenantKey);
    const sourceFormat = this.parseTemplateSourceFormat(dto.sourceFormat);
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException("Template name is required.");
    }

    const mapping = this.normalizeTemplateMapping(dto.mapping);
    const snapshot = await this.buildTemplateSchemaSnapshot(dto.categoryId);
    const now = new Date();

    const [versionRow] = await this.prisma.tenant().$queryRaw<Array<{ nextVersion: number }>>(
      Prisma.sql`
        SELECT COALESCE(MAX("version"), 0) + 1 AS "nextVersion"
        FROM "BulkImportTemplate"
        WHERE "tenantKey" = ${tenantKey}
          AND "categoryId" = ${dto.categoryId}
          AND "name" = ${name}
      `,
    );
    const nextVersion = Number(versionRow?.nextVersion ?? 1);

    const templateId = randomUUID();
    await this.prisma.tenant().$executeRaw(
      Prisma.sql`
        INSERT INTO "BulkImportTemplate"
          ("id", "tenantKey", "categoryId", "name", "version", "sourceFormat", "mapping", "schemaSnapshot", "chunkSize", "maxRetries", "createdAt", "updatedAt")
        VALUES
          (${templateId}, ${tenantKey}, ${dto.categoryId}, ${name}, ${nextVersion}, ${sourceFormat}, ${mapping as unknown as Prisma.JsonObject}, ${snapshot as unknown as Prisma.JsonObject}, ${dto.chunkSize ?? 100}, ${dto.maxRetries ?? 3}, ${now}, ${now})
      `,
    );

    const created: BulkImportTemplateRow = {
      id: templateId,
      tenantKey,
      categoryId: dto.categoryId,
      name,
      version: nextVersion,
      sourceFormat,
      mapping: mapping as unknown as Prisma.JsonObject,
      schemaSnapshot: snapshot as unknown as Prisma.JsonObject,
      chunkSize: dto.chunkSize ?? 100,
      maxRetries: dto.maxRetries ?? 3,
      createdAt: now,
      updatedAt: now,
      categoryPath: category.path,
    };

    return this.mapTemplateResponse((await this.attachTemplateCompatibility([created]))[0]);
  }

  async listTemplates(tenantKey?: string, categoryId?: string, pagination?: CursorPaginationQuery, actor?: PolicyActor) {
    const normalizedTenant = this.resolveRequestTenantKey(tenantKey);
    const categoryFilter = categoryId?.trim() || null;
    if (categoryFilter) {
      await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", categoryFilter, "BulkImportTemplate");
    }
    if (isCursorPagination(pagination)) {
      const limit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      if (pagination?.cursor && !token) {
        throw new BadRequestException("Invalid cursor.");
      }
      const cursorDate = token ? new Date(token.sort) : null;
      if (token && (!cursorDate || Number.isNaN(cursorDate.getTime()))) {
        throw new BadRequestException("Invalid cursor.");
      }
      const templates = await this.prisma.tenant().bulkImportTemplate.findMany({
        where: {
          tenantKey: normalizedTenant,
          ...(categoryFilter ? { categoryId: categoryFilter } : {}),
          ...(token && cursorDate
            ? {
                OR: [
                  { updatedAt: { lt: cursorDate } },
                  {
                    updatedAt: cursorDate,
                    id: { lt: token.id },
                  },
                ],
              }
            : {}),
        },
        include: {
          category: {
            select: {
              path: true,
            },
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const hasNext = templates.length > limit;
      const page = hasNext ? templates.slice(0, limit) : templates;
      const rows: BulkImportTemplateRow[] = page.map((template) => ({
        id: template.id,
        tenantKey: template.tenantKey,
        categoryId: template.categoryId,
        name: template.name,
        version: template.version,
        sourceFormat: template.sourceFormat,
        mapping: template.mapping,
        schemaSnapshot: template.schemaSnapshot,
        chunkSize: template.chunkSize,
        maxRetries: template.maxRetries,
        createdAt: template.createdAt,
        updatedAt: template.updatedAt,
        categoryPath: template.category.path,
      }));
      const enriched = await this.attachTemplateCompatibility(rows);
      const items = enriched.map((template) => this.mapTemplateResponse(template));
      const last = page[page.length - 1];
      return {
        items,
        limit,
        nextCursor: hasNext && last
          ? encodeCursorToken({
              sort: last.updatedAt.toISOString(),
              id: last.id,
            })
          : null,
      };
    }
    const templates = await this.prisma.tenant().$queryRaw<BulkImportTemplateRow[]>(
      Prisma.sql`
        SELECT
          t."id",
          t."tenantKey",
          t."categoryId",
          t."name",
          COALESCE(t."version", 1) AS "version",
          t."sourceFormat",
          t."mapping",
          t."schemaSnapshot",
          t."chunkSize",
          t."maxRetries",
          t."createdAt",
          t."updatedAt",
          c."path" AS "categoryPath"
        FROM "BulkImportTemplate" t
        INNER JOIN "Category" c ON c."id" = t."categoryId"
        WHERE t."tenantKey" = ${normalizedTenant}
          AND (${categoryFilter}::text IS NULL OR t."categoryId" = ${categoryFilter}::text)
        ORDER BY t."name" ASC, COALESCE(t."version", 1) DESC, t."updatedAt" DESC
        LIMIT 200
      `,
    );
    const enriched = await this.attachTemplateCompatibility(templates);
    const filtered = categoryFilter
      ? enriched
      : actor && actor.actorRole !== "admin"
        ? await this.filterTemplatesByScope(enriched, actor)
        : enriched;
    return filtered.map((template) => this.mapTemplateResponse(template));
  }

  async getTemplate(templateId: string, tenantKey?: string, actor?: PolicyActor) {
    const normalizedTenant = this.resolveRequestTenantKey(tenantKey);
    const templates = await this.prisma.tenant().$queryRaw<BulkImportTemplateRow[]>(
      Prisma.sql`
        SELECT
          t."id",
          t."tenantKey",
          t."categoryId",
          t."name",
          COALESCE(t."version", 1) AS "version",
          t."sourceFormat",
          t."mapping",
          t."schemaSnapshot",
          t."chunkSize",
          t."maxRetries",
          t."createdAt",
          t."updatedAt",
          c."path" AS "categoryPath"
        FROM "BulkImportTemplate" t
        INNER JOIN "Category" c ON c."id" = t."categoryId"
        WHERE t."id" = ${templateId}
          AND t."tenantKey" = ${normalizedTenant}
        LIMIT 1
      `,
    );
    if (templates.length === 0) {
      throw new NotFoundException("Bulk import template not found");
    }
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", templates[0].categoryId, "BulkImportTemplate", templateId);
    const enriched = (await this.attachTemplateCompatibility(templates))[0];
    return this.mapTemplateResponse(enriched);
  }

  async validateJobInput(dto: CreateBulkImportJobDto, actor?: PolicyActor) {
    const correlationId = this.getCorrelationId();
    const tenantKey = this.resolveRequestTenantKey(actor?.tenantId ?? undefined);

    try {
      await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", dto.categoryId, "BulkImportJob");
      const category = await this.requireCategory(dto.categoryId);
      const importRowLimit = await this.resolveImportRowLimit(actor);

      const sourceRows = this.resolveImportSourceRows(dto);
      const suggestion = this.suggestMappingFromHeaders(sourceRows.headers, dto.mapping);
      const normalizedRows = sourceRows.rows.map((row) => this.normalizeCanonicalPayload(row, suggestion.mapping));
      const sourceBytes = this.estimateSourceBytes(dto, normalizedRows);
      this.assertSourceSize(sourceBytes);

      const summary = this.buildPreflightSummaryFromSourceRows({
        sourceFormat: dto.sourceFormat,
        sourceName: dto.sourceName,
        categoryId: dto.categoryId,
        categoryPath: category.path,
        sourceRows,
        mapping: dto.mapping,
        importRowLimit,
      });

      await this.emitValidationMetrics({
        tenantKey,
        path: "direct",
        sourceFormat: summary.sourceFormat,
        blocked: !summary.canImport,
        failureCode: summary.failureCode,
        failureClass: summary.failureClass,
      });

      return {
        ...summary,
        correlationId,
      };
    } catch (error: unknown) {
      const failure = this.describeValidationFailure(error, correlationId);
      const isBlocked =
        error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException;

      await this.emitValidationMetrics({
        tenantKey,
        path: "direct",
        sourceFormat: dto.sourceFormat,
        blocked: isBlocked,
        failed: !isBlocked,
        failureCode: failure.code,
        failureClass: failure.failureClass,
      });

      if (!isBlocked) {
        this.logger.error("Bulk import direct validation failed unexpectedly.", {
          correlationId,
          failureCode: failure.code,
          failureClass: failure.failureClass,
          sourceFormat: dto.sourceFormat,
        });
      }

      this.throwValidationFailure(error, failure);
    }
  }

  async createJob(dto: CreateBulkImportJobDto, actor?: PolicyActor) {
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", dto.categoryId, "BulkImportJob");
    await this.requireCategory(dto.categoryId);
    const importRowLimit = await this.resolveImportRowLimit(actor);
    const linkedRunId = String(dto.runId ?? "").trim() || null;
    if (linkedRunId) {
      await this.assertLinkedStandardRun(linkedRunId, dto.categoryId, actor);
    }

    let sourceRows: BulkImportPreparedSourceRows;
    if (linkedRunId && !this.hasInlineSourceData(dto)) {
      const run = await this.prisma.tenant().bulkImportRun.findUniqueOrThrow({
        where: { id: linkedRunId },
        select: { sourceFileKey: true, sourceExpiresAt: true },
      });
      if (!run.sourceFileKey) {
        throw new BadRequestException("Staged run has no stored file. Re-upload the import file.");
      }
      if (run.sourceExpiresAt && run.sourceExpiresAt < new Date()) {
        throw new BadRequestException("Staged import file has expired. Please re-upload the file.");
      }
      sourceRows = await this.readRowsFromStagedCsv(run.sourceFileKey);
    } else {
      sourceRows = this.resolveImportSourceRows(dto);
    }

    const suggestion = this.suggestMappingFromHeaders(sourceRows.headers, dto.mapping);
    const normalizedRows = sourceRows.rows.map((row) =>
      this.normalizeCanonicalPayload(row, suggestion.mapping),
    );
    for (const row of normalizedRows) {
      await this.accessPolicy.assertRequestedProductScopeAllowed(actor ?? {}, "import", {
        resource: "BulkImportJob",
        categoryId: dto.categoryId,
        brand: typeof row.brand === "string" ? row.brand : null,
      });
    }
    await this.accessPolicy.assertBulkImportAllowed(actor ?? {}, {
      fields: normalizedRows.some((row) => row.status !== undefined) ? ["status"] : [],
    });
    const sourceBytes = this.estimateSourceBytes(dto, normalizedRows);
    this.assertSourceSize(sourceBytes);

    if (normalizedRows.length === 0) {
      throw new BadRequestException("No import rows detected.");
    }
    if (normalizedRows.length > importRowLimit) {
      throw new BadRequestException(`Maximum ${importRowLimit.toLocaleString("en-US")} rows per job.`);
    }

    const created = await this.prisma.tenant().$transaction(async (tx) => {
      const job = await tx.bulkImportJob.create({
        data: {
          categoryId: dto.categoryId,
          runId: linkedRunId,
          jobRole: "standard",
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
          runId: linkedRunId,
          rowNumber: index + 1,
          rowNumberGlobal: linkedRunId ? index + 1 : null,
          rowNumberInBatch: linkedRunId ? index + 1 : null,
          payload: row as Prisma.JsonObject,
          status: BulkImportRowStatus.queued,
        })),
      });
      return job;
    });

    return this.getJob(created.id, actor);
  }

  async listJobs(status?: string, pagination?: CursorPaginationQuery, actor?: PolicyActor) {
    const where = status
      ? {
          runId: null,
          status: this.parseJobStatus(status),
        }
      : { runId: null as null };
    if (isCursorPagination(pagination)) {
      const limit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      if (pagination?.cursor && !token) {
        throw new BadRequestException("Invalid cursor.");
      }
      const cursorDate = token ? new Date(token.sort) : null;
      if (token && (!cursorDate || Number.isNaN(cursorDate.getTime()))) {
        throw new BadRequestException("Invalid cursor.");
      }
      const jobs = await this.prisma.tenant().bulkImportJob.findMany({
        where: {
          ...(where ?? {}),
          ...(token && cursorDate
            ? {
                OR: [
                  { updatedAt: { lt: cursorDate } },
                  {
                    updatedAt: cursorDate,
                    id: { lt: token.id },
                  },
                ],
              }
            : {}),
        },
        include: {
          category: { select: { id: true, path: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const hasNext = jobs.length > limit;
      const page = hasNext ? jobs.slice(0, limit) : jobs;
      const allowedPage = actor && actor.actorRole !== "admin" ? await this.filterJobsByScope(page, actor) : page;
      const items = await this.attachMetrics(allowedPage);
      const last = page[page.length - 1];
      return {
        items,
        limit,
        nextCursor: hasNext && last
          ? encodeCursorToken({
              sort: last.updatedAt.toISOString(),
              id: last.id,
            })
          : null,
      };
    }
    const jobs = await this.prisma.tenant().bulkImportJob.findMany({
      where,
      include: {
        category: { select: { id: true, path: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 50,
    });
    const filtered = actor && actor.actorRole !== "admin" ? await this.filterJobsByScope(jobs, actor) : jobs;
    return this.attachMetrics(filtered);
  }

  async getJob(jobId: string, actor?: PolicyActor) {
    const job = await this.prisma.tenant().bulkImportJob.findUnique({
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
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", job.categoryId, "BulkImportJob", jobId);
    return this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, (await this.attachMetrics([job]))[0]);
  }

  async listJobRows(jobId: string, status?: string, limit = 100, pagination?: CursorPaginationQuery, actor?: PolicyActor) {
    const job = await this.requireJob(jobId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", job.categoryId, "BulkImportJob", jobId);
    if (isCursorPagination(pagination)) {
      const safeLimit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      if (pagination?.cursor && !token) {
        throw new BadRequestException("Invalid cursor.");
      }
      const cursorRowNumber = token ? Number(token.sort) : Number.NaN;
      if (token && (!Number.isFinite(cursorRowNumber) || cursorRowNumber < 0)) {
        throw new BadRequestException("Invalid cursor.");
      }
      const rows = await this.prisma.tenant().bulkImportRow.findMany({
        where: {
          jobId,
          status: status ? this.parseRowStatus(status) : undefined,
          ...(token
            ? {
                OR: [
                  { rowNumber: { gt: cursorRowNumber } },
                  {
                    rowNumber: cursorRowNumber,
                    id: { gt: token.id },
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
        take: safeLimit + 1,
      });
      const hasNext = rows.length > safeLimit;
      const items = hasNext ? rows.slice(0, safeLimit) : rows;
      const last = items[items.length - 1];
      return this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, {
        items,
        limit: safeLimit,
        nextCursor: hasNext && last
          ? encodeCursorToken({
              sort: String(last.rowNumber),
              id: last.id,
            })
          : null,
      });
    }
    const boundedLimit = Math.max(1, Math.min(5000, Number(limit) || 100));
    return this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, await this.prisma.tenant().bulkImportRow.findMany({
      where: {
        jobId,
        status: status ? this.parseRowStatus(status) : undefined,
      },
      orderBy: [{ rowNumber: "asc" }],
      take: boundedLimit,
    }));
  }

  async processJob(jobId: string, chunkSize?: number, actor?: PolicyActor) {
    const job = await this.requireJob(jobId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", job.categoryId, "BulkImportJob", jobId);
    const terminalStatuses: string[] = [
      BulkImportJobStatus.completed,
      BulkImportJobStatus.failed,
      BulkImportJobStatus.dead_letter,
    ];
    if (terminalStatuses.includes(job.status)) {
      return this.getJob(job.id);
    }

    const effectiveChunk = Math.max(1, Math.min(500, chunkSize ?? job.chunkSize));
    await this.prisma.tenant().bulkImportJob.update({
      where: { id: job.id },
      data: {
        status: BulkImportJobStatus.processing,
      },
    });

    // Process all remaining rows in chunks until none are left.
    // Each iteration fetches the next batch of queued/retrying rows,
    // processes them in parallel, then checks for more.
    let processed = true;
    while (processed) {
      const rows = await this.prisma.tenant().bulkImportRow.findMany({
        where: {
          jobId: job.id,
          status: {
            in: [BulkImportRowStatus.queued, BulkImportRowStatus.retrying],
          },
        },
        orderBy: [{ rowNumber: "asc" }],
        take: effectiveChunk,
      });

      if (rows.length === 0) {
        processed = false;
        break;
      }

      await Promise.allSettled(rows.map((row) => this.processRow(job, row)));
    }

    await this.refreshJobCounters(job.id);
    return this.getJob(job.id, actor);
  }

  async processRowById(jobId: string, rowId: string, actor?: PolicyActor) {
    const job = await this.requireJob(jobId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", job.categoryId, "BulkImportJob", jobId);
    const row = await this.requireRow(jobId, rowId);
    if (row.status === BulkImportRowStatus.success) {
      return this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, row);
    }

    await this.processRow(job, row);
    await this.refreshJobCounters(jobId);
    return this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, await this.requireRow(jobId, rowId));
  }

  async repairRow(jobId: string, rowId: string, dto: RepairBulkImportRowDto, actor?: PolicyActor) {
    const job = await this.requireJob(jobId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", job.categoryId, "BulkImportJob", jobId);
    const row = await this.requireRow(jobId, rowId);
    const existingPayload = this.asRowPayload(row.payload);
    const payload = dto.payload ? { ...existingPayload, ...dto.payload } : existingPayload;
    const requeue = dto.requeue ?? true;

    await this.prisma.tenant().bulkImportRow.update({
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
    return this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, await this.requireRow(jobId, rowId));
  }

  async requeueDlq(jobId: string, limit = 100, actor?: PolicyActor) {
    const job = await this.requireJob(jobId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", job.categoryId, "BulkImportJob", jobId);
    const boundedLimit = Math.max(1, Math.min(5000, Number(limit) || 100));
    const rows = await this.prisma.tenant().bulkImportRow.findMany({
      where: {
        jobId,
        status: BulkImportRowStatus.dead_letter,
      },
      orderBy: [{ rowNumber: "asc" }],
      take: boundedLimit,
      select: { id: true },
    });

    if (rows.length > 0) {
      await this.prisma.tenant().bulkImportRow.updateMany({
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
    return this.getJob(jobId, actor);
  }

  async buildErrorReportCsv(jobId: string, actor?: PolicyActor) {
    const job = await this.requireJob(jobId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", job.categoryId, "BulkImportJob", jobId);
    const rows = await this.prisma.tenant().bulkImportRow.findMany({
      where: {
        jobId,
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
      orderBy: [{ rowNumber: "asc" }],
      take: 10_000, // defensive cap — error-report CSV is bounded by job size
      select: {
        jobId: true,
        runId: true,
        rowNumber: true,
        status: true,
        retryCount: true,
        errorMessage: true,
        payload: true,
      },
    });

    const header = ["runId", "jobId", "rowNumber", "skuCode", "status", "errorCode", "errorMessage", "attemptCount", "originalData"];
    const lines = [header.map((value) => this.toCsvCell(value)).join(",")];
    for (const row of rows) {
      const visibleRow = this.accessPolicy.applyBulkImportRowVisibility(actor ?? {}, row) as typeof row;
      const originalData = this.asRowPayload(visibleRow.payload);
      lines.push(
        [
          visibleRow.runId ?? "",
          visibleRow.jobId,
          String(visibleRow.rowNumber),
          this.extractSkuCode(originalData),
          visibleRow.status,
          this.extractErrorCode(visibleRow.errorMessage),
          visibleRow.errorMessage ?? "",
          String(visibleRow.retryCount),
          JSON.stringify(originalData),
        ]
          .map((value) => this.toCsvCell(value))
          .join(","),
      );
    }
    return lines.join("\n");
  }

  async preflightValidateJob(jobId: string, actor?: PolicyActor) {
    const job = await this.prisma.tenant().bulkImportJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException("Bulk import job not found");
    }
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", job.categoryId, "BulkImportJob", jobId);

    const rows = await this.prisma.tenant().bulkImportRow.findMany({
      where: { jobId },
      orderBy: [{ rowNumber: "asc" }],
      take: 10_000, // defensive cap — preflight scans entire job; bounded by import size
    });

    const skuSeen = new Map<string, number[]>();
    const allMissingFields = new Set<string>();
    const mappingGaps: number[] = [];
    const rowBlockingErrors: Array<{ rowNumber: number; errors: string[] }> = [];

    for (const row of rows) {
      const rawPayload = typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)
        ? (row.payload as Record<string, unknown>)
        : {};
      const data = this.asRowPayload(row.payload);
      const rowErrors: string[] = [];

      const isMappingGap =
        !row.payload ||
        (typeof row.payload === "object" &&
          !Array.isArray(row.payload) &&
          Object.keys(row.payload).length === 0);
      if (isMappingGap) {
        mappingGaps.push(row.rowNumber);
        rowErrors.push("No mapped data for row");
      }

      const title = typeof data.title === "string" ? data.title.trim() : "";
      if (!title) {
        allMissingFields.add("title");
        rowErrors.push("Missing required field: title");
      }

      const skuCode = typeof rawPayload.skuCode === "string" ? rawPayload.skuCode.trim() : "";
      if (!skuCode) {
        allMissingFields.add("skuCode");
        rowErrors.push("Missing required field: skuCode");
      } else {
        const existing = skuSeen.get(skuCode) ?? [];
        existing.push(row.rowNumber);
        skuSeen.set(skuCode, existing);
      }

      if (rowErrors.length > 0) {
        rowBlockingErrors.push({ rowNumber: row.rowNumber, errors: rowErrors });
      }
    }

    const duplicateSkuIssues = Array.from(skuSeen.entries())
      .filter(([, rowNumbers]) => rowNumbers.length > 1)
      .map(([skuCode, rowNumbers]) => ({ skuCode, rowNumbers }));

    for (const { rowNumbers } of duplicateSkuIssues) {
      for (const rowNumber of rowNumbers) {
        const existing = rowBlockingErrors.find((entry) => entry.rowNumber === rowNumber);
        if (existing) {
          existing.errors.push("Duplicate skuCode within job");
        } else {
          rowBlockingErrors.push({ rowNumber, errors: ["Duplicate skuCode within job"] });
        }
      }
    }

    const blockingErrorRowNumbers = new Set(rowBlockingErrors.map((entry) => entry.rowNumber));
    const acceptedRows = rows.filter((row) => !blockingErrorRowNumbers.has(row.rowNumber)).length;

    const sampleRowErrors = rowBlockingErrors.slice(0, 5).map((entry) => ({
      rowNumber: entry.rowNumber,
      errors: entry.errors,
    }));

    const blockingErrors: string[] = [];
    if (allMissingFields.has("title")) {
      blockingErrors.push("One or more rows are missing required field: title");
    }
    if (allMissingFields.has("skuCode")) {
      blockingErrors.push("One or more rows are missing required field: skuCode");
    }
    if (mappingGaps.length > 0) {
      blockingErrors.push(`${mappingGaps.length} row(s) have no mapped data`);
    }
    if (duplicateSkuIssues.length > 0) {
      blockingErrors.push(`${duplicateSkuIssues.length} duplicate skuCode(s) detected within the job`);
    }

    return {
      jobId,
      totalRows: rows.length,
      acceptedRows,
      blockingErrors,
      warnings: [],
      duplicateSkuIssues,
      missingRequiredFields: Array.from(allMissingFields),
      mappingGaps,
      sampleRowErrors,
    };
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
    // Optimistic claim: only take the row if it's still in a processable state.
    // If another worker already claimed it, updateMany returns count=0 and we skip.
    const claimed = await this.prisma.tenant().bulkImportRow.updateMany({
      where: {
        id: row.id,
        status: { in: [BulkImportRowStatus.queued, BulkImportRowStatus.retrying] },
      },
      data: {
        status: BulkImportRowStatus.processing,
        lastAttemptAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      return;
    }

    try {
      const payload = this.asRowPayload(row.payload);
      const title = (payload.title ?? "").trim();
      if (!title) {
        throw new BadRequestException("title is required");
      }
      const rowStatus = this.normalizeRecordStatus(payload.status);
      this.assertDraftWorkflowEntry(rowStatus);

      // Idempotency: reuse the product from a prior attempt if it still exists.
      const existingProduct = row.productId
        ? await this.prisma.tenant().product.findUnique({ where: { id: row.productId }, select: { id: true } })
        : null;
      const product = existingProduct ?? await this.prisma.tenant().product.create({
        data: {
          title,
          description: (payload.description ?? "").trim(),
          brand: (payload.brand ?? "").trim(),
          categoryId: job.categoryId,
          hsnCode: payload.hsnCode ? payload.hsnCode.trim() : null,
          gstRate: payload.gstRate ?? null,
          attributes: (payload.attributes ?? {}) as Prisma.JsonObject,
          status: RecordStatus.draft,
        },
      });

      // Persist productId immediately so a crash after this point won't orphan the product.
      // On retry the idempotency check above will find it.
      if (!existingProduct) {
        await this.prisma.tenant().bulkImportRow.update({
          where: { id: row.id },
          data: { productId: product.id },
        });
      }

      // Write international tax codes if the row included any.
      // Uses a single TaxRegime lookup per row — regimes are a tiny seeded table (5 rows).
      // Silently skips any entry whose regimeKey is not in the DB (e.g. seed not yet run).
      if (payload.taxCodes && payload.taxCodes.length > 0) {
        const tenantKey = this.resolveRequestTenantKey();
        const regimeKeys = [...new Set(payload.taxCodes.map((tc) => tc.regimeKey))];
        const regimes = await this.prisma.tenant().taxRegime.findMany({
          where: { marketCode: { in: regimeKeys } },
          select: { id: true, marketCode: true },
        });
        const regimeMap = new Map(regimes.map((r) => [r.marketCode, r]));
        const validEntries = payload.taxCodes.filter((tc) => regimeMap.has(tc.regimeKey));
        if (validEntries.length > 0) {
          await this.prisma.tenant().productTaxCode.createMany({
            data: validEntries.map((tc) => ({
              tenantKey,
              productId: product.id,
              regimeId: regimeMap.get(tc.regimeKey)!.id,
              marketCode: tc.regimeKey,
              key: tc.key as TaxCodeKey,
              value: tc.value.trim(),
              rate: tc.rate ?? null,
            })),
          });
        }
      }

      await this.complianceService.validateAndPersistProduct(product.id);

      await this.prisma.tenant().bulkImportRow.update({
        where: { id: row.id },
        data: {
          status: BulkImportRowStatus.success,
          retryCount: row.retryCount,
          errorMessage: null,
          productId: product.id,
        },
      });
    } catch (error: unknown) {
      const isWorkflowEntryInvalid = this.isWorkflowEntryInvalidError(error);
      const nextRetry = isWorkflowEntryInvalid ? row.retryCount : row.retryCount + 1;
      const message = this.extractErrorMessage(error);

      await this.prisma.tenant().bulkImportRow.update({
        where: { id: row.id },
        data: {
          retryCount: nextRetry,
          errorMessage: message,
          status: isWorkflowEntryInvalid
            ? BulkImportRowStatus.failed
            : nextRetry >= job.maxRetries
              ? BulkImportRowStatus.dead_letter
              : BulkImportRowStatus.retrying,
        },
      });
    }
  }

  private async refreshJobCounters(jobId: string) {
    // Run the job status lookup and the counter aggregation in parallel —
    // they are completely independent queries on different tables.
    // groupBy replaces the old findMany + in-memory loop: instead of shipping
    // every row across the wire (potentially tens of thousands in a large import),
    // the DB does the aggregation and returns at most one row per distinct status.
    const [current, statusGroups] = await Promise.all([
      this.prisma.tenant().bulkImportJob.findUnique({
        where: { id: jobId },
        select: { status: true },
      }),
      this.prisma.tenant().bulkImportRow.groupBy({
        by: ["status"],
        where: { jobId },
        _count: { status: true },
      }),
    ]);

    const counters = {
      success: 0,
      failed: 0,
      deadLetter: 0,
      pending: 0,
    };
    for (const group of statusGroups) {
      const count = group._count.status;
      if (group.status === BulkImportRowStatus.success) {
        counters.success = count;
      } else if (group.status === BulkImportRowStatus.failed) {
        counters.failed = count;
      } else if (group.status === BulkImportRowStatus.dead_letter) {
        counters.deadLetter = count;
      } else {
        // queued / processing / retrying all count as "pending"
        counters.pending += count;
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

    const updated = await this.prisma.tenant().bulkImportJob.update({
      where: { id: jobId },
      data: {
        status,
        processedRows: counters.success + counters.failed + counters.deadLetter,
        successRows: counters.success,
        failedRows: counters.failed,
        deadLetterRows: counters.deadLetter,
      },
    });

    if (current?.status !== updated.status) {
      if (updated.status === BulkImportJobStatus.completed) {
        await this.notificationsService.emitImportStatus(jobId, "completed");
      } else if (updated.status === BulkImportJobStatus.dead_letter || updated.status === BulkImportJobStatus.failed) {
        await this.notificationsService.emitImportStatus(jobId, "dead_letter");
      }
    }

    if (updated.runId) {
      await this.syncLinkedRunFromStandardJob(updated);
    }
  }

  private async assertLinkedStandardRun(runId: string, categoryId: string, actor?: PolicyActor) {
    const run = await this.prisma.tenant().bulkImportRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        categoryId: true,
        status: true,
        effectiveMode: true,
      },
    });
    if (!run) {
      throw new NotFoundException("Bulk import run not found");
    }
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "import", run.categoryId, "BulkImportRun", runId);
    if (run.categoryId !== categoryId) {
      throw new BadRequestException("Bulk import run category does not match the requested job category.");
    }
    if (run.effectiveMode && run.effectiveMode !== "standard") {
      throw new BadRequestException("Only standard-mode bulk import runs can be linked to standard jobs.");
    }
    if (run.status !== BulkImportRunStatus.preflight_ready) {
      throw new BadRequestException("Bulk import run must complete preflight before creating a standard job.");
    }
  }

  private async syncLinkedRunFromStandardJob(job: {
    runId: string | null;
    totalRows: number;
    processedRows: number;
    successRows: number;
    failedRows: number;
    deadLetterRows: number;
    status: BulkImportJobStatus;
  }) {
    if (!job.runId) {
      return;
    }
    let runStatus: BulkImportRunStatus;
    if (job.status === BulkImportJobStatus.failed) {
      runStatus = BulkImportRunStatus.failed;
    } else if (job.status === BulkImportJobStatus.completed) {
      runStatus =
        job.failedRows > 0 || job.deadLetterRows > 0
          ? BulkImportRunStatus.repair_required
          : BulkImportRunStatus.completed;
    } else if (job.status === BulkImportJobStatus.dead_letter) {
      runStatus = BulkImportRunStatus.repair_required;
    } else {
      runStatus = BulkImportRunStatus.processing;
    }

    await this.prisma.tenant().bulkImportRun.update({
      where: { id: job.runId },
      data: {
        effectiveMode: "standard",
        estimatedBatchCount: 1,
        totalRows: job.totalRows,
        acceptedRows: job.successRows,
        failedRows: job.failedRows,
        deadLetterRows: job.deadLetterRows,
        status: runStatus,
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
      throw new BadRequestException({
        code: "INVALID_CSV_SOURCE",
        message: "CSV must include header and at least one data row.",
        issues: [this.buildBlockingIssue("CSV must include header and at least one data row.", "INVALID_CSV_SOURCE")],
      });
    }

    const headers = this.parseCsvLine(lines[0]).map((header) => header.trim());
    if (headers.some((header) => !header)) {
      throw new BadRequestException({
        code: "INVALID_CSV_SOURCE",
        message: "CSV header contains empty column names.",
        issues: [this.buildBlockingIssue("CSV header contains empty column names.", "INVALID_CSV_SOURCE")],
      });
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
      throw new BadRequestException({
        code: "INVALID_CSV_SOURCE",
        message: `Invalid ${format} fileContentBase64 payload.`,
        issues: [this.buildBlockingIssue(`Invalid ${format} fileContentBase64 payload.`, "INVALID_CSV_SOURCE")],
      });
    }
    this.assertSourceSize(buffer.length);
    const raw = buffer.toString("utf8");
    return this.parseCsv(raw);
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
    const taxCodes = this.collectTaxCodes(input);

    return {
      title: this.asTrimmedString(title),
      description: this.asTrimmedString(description),
      brand: this.asTrimmedString(brand),
      hsnCode: this.asTrimmedString(hsnCode),
      gstRate: this.asOptionalNumber(gstRateRaw),
      status: this.asTrimmedString(status),
      attributes: this.parseAttributes(attributesRaw),
      ...(taxCodes !== undefined ? { taxCodes } : {}),
    };
  }

  /**
   * Flat CSV column descriptors for international tax codes.
   * Each entry maps one or more CSV column name aliases to a (regimeKey, key) pair.
   * Rate columns are optional and market-specific.
   */
  private static readonly INTL_TAX_COLUMNS = [
    {
      regimeKey: "GB", key: "COMMODITY_CODE",
      aliases: ["gb_commodity_code", "uk_commodity_code", "commodity_code_gb", "commodity_code_uk"],
      rateAliases: ["gb_tax_rate", "uk_tax_rate", "vat_rate_gb"],
    },
    {
      regimeKey: "AE", key: "HS_CODE",
      aliases: ["ae_hs_code", "uae_hs_code", "hs_code_ae", "hs_code_uae"],
      rateAliases: ["ae_tax_rate", "uae_tax_rate"],
    },
    {
      regimeKey: "US", key: "TAX_CATEGORY",
      aliases: ["us_tax_category", "us_tax_cat", "tax_category_us", "us_sales_tax"],
      rateAliases: [],
    },
    {
      regimeKey: "AU", key: "COMMODITY_CODE",
      aliases: ["au_commodity_code", "australia_commodity_code", "commodity_code_au"],
      rateAliases: ["au_tax_rate", "australia_tax_rate"],
    },
  ] as const;

  /**
   * Collect structured international tax codes from a single import row.
   *
   * Supports two formats:
   * 1. **JSON array** — `taxCodes` field is a JSON array of `{ regimeKey, key, value, rate? }` objects.
   * 2. **Flat CSV columns** — recognises per-market column name aliases such as
   *    `gb_commodity_code`, `ae_hs_code`, `us_tax_category`, `au_commodity_code`.
   *
   * Returns `undefined` when no tax code input is detected at all (leaving any
   * existing tax codes on the product untouched in an update context).
   * Returns an empty array when input was detected but all values were blank.
   */
  private collectTaxCodes(input: Record<string, unknown>): TaxCodeEntry[] | undefined {
    // --- JSON array format ---
    const rawTaxCodes =
      this.pickMappedValue(input, "taxCodes") ??
      this.pickMappedValue(input, "tax_codes") ??
      this.pickMappedValue(input, "taxcode_list");

    if (Array.isArray(rawTaxCodes)) {
      const entries: TaxCodeEntry[] = [];
      for (const tc of rawTaxCodes) {
        if (!tc || typeof tc !== "object" || Array.isArray(tc)) continue;
        const entry = tc as Record<string, unknown>;
        const regimeKey = String(entry["regimeKey"] ?? entry["regime_key"] ?? "").trim().toUpperCase();
        const key = String(entry["key"] ?? "").trim().toUpperCase();
        const value = String(entry["value"] ?? "").trim();
        if (!regimeKey || !key || !value) continue;
        const rateRaw = entry["rate"];
        const rate = this.asOptionalNumber(rateRaw);
        entries.push({ regimeKey, key, value, ...(rate !== undefined ? { rate } : {}) });
      }
      return entries;
    }

    // --- Flat CSV column format ---
    const entries: TaxCodeEntry[] = [];
    let hasAnyFlatColumn = false;

    for (const col of BulkImportService.INTL_TAX_COLUMNS) {
      const rawValue = this.findFirstAlias(input, col.aliases);
      if (rawValue !== undefined) {
        hasAnyFlatColumn = true;
        const value = this.asTrimmedString(rawValue);
        if (!value) continue;
        const rateRaw = col.rateAliases.length > 0 ? this.findFirstAlias(input, col.rateAliases) : undefined;
        const rate = this.asOptionalNumber(rateRaw);
        entries.push({ regimeKey: col.regimeKey, key: col.key, value, ...(rate !== undefined ? { rate } : {}) });
      }
    }

    return hasAnyFlatColumn ? entries : undefined;
  }

  /** Return the first non-undefined value matched by any alias in the input row. */
  private findFirstAlias(input: Record<string, unknown>, aliases: readonly string[]): unknown {
    for (const alias of aliases) {
      const val = this.pickMappedValue(input, alias);
      if (val !== undefined) return val;
    }
    return undefined;
  }

  private resolveImportSourceRows(dto: CreateBulkImportJobDto) {
    if (dto.sourceFormat === "csv") {
      if (dto.fileContentBase64) {
        return this.parseDelimitedBase64(dto.fileContentBase64, "csv");
      }
      return this.parseCsv(dto.csvContent ?? "");
    }
    return { headers: this.inferHeadersFromRows(dto.rows ?? []), rows: dto.rows ?? [] };
  }

  private hasInlineSourceData(dto: CreateBulkImportJobDto): boolean {
    if (dto.sourceFormat === "csv") {
      return Boolean(dto.fileContentBase64 || (dto.csvContent && dto.csvContent.trim()));
    }
    return Boolean(dto.rows && dto.rows.length > 0);
  }

  private async readRowsFromStagedCsv(sourceFileKey: string): Promise<BulkImportPreparedSourceRows> {
    const stream = await this.storageService.readStagedCsvStream(sourceFileKey);
    const rl = createInterface({ input: stream as unknown as NodeJS.ReadableStream, crlfDelay: Infinity });
    let headers: string[] = [];
    const rows: Record<string, unknown>[] = [];
    let isHeader = true;
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isHeader) {
        headers = this.parseCsvLine(trimmed);
        isHeader = false;
        continue;
      }
      const values = this.parseCsvLine(trimmed);
      const row: Record<string, unknown> = {};
      headers.forEach((h, i) => { row[h] = values[i] ?? ""; });
      rows.push(row);
    }
    return { headers, rows };
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
    if (normalized === "in_review") {
      return RecordStatus.in_review;
    }
    if (normalized === "approved") {
      return RecordStatus.approved;
    }
    if (normalized === "rejected") {
      return RecordStatus.rejected;
    }
    if (normalized === "active") {
      return RecordStatus.active;
    }
    if (normalized === "archived") {
      return RecordStatus.archived;
    }
    return RecordStatus.draft;
  }

  private validateCanonicalRow(row: CanonicalRowPayload): BulkImportValidationIssue[] {
    const issues: BulkImportValidationIssue[] = [];
    if (!this.asTrimmedString(row.title)) {
      issues.push({
        rowNumber: 0,
        severity: "blocking",
        code: "TITLE_REQUIRED",
        message: "Title is required.",
        fieldPath: "title",
      });
    }
    if (!this.asTrimmedString(row.brand)) {
      issues.push({
        rowNumber: 0,
        severity: "warning",
        code: "BRAND_RECOMMENDED",
        message: "Brand is recommended for marketplace readiness.",
        fieldPath: "brand",
      });
    }
    if (row.gstRate !== undefined && (!Number.isFinite(row.gstRate) || row.gstRate < 0)) {
      issues.push({
        rowNumber: 0,
        severity: "blocking",
        code: "GST_RATE_INVALID",
        message: "GST rate must be a non-negative number.",
        fieldPath: "gstRate",
      });
    }
    if (row.hsnCode !== undefined && String(row.hsnCode).trim().length === 0) {
      issues.push({
        rowNumber: 0,
        severity: "warning",
        code: "HSN_CODE_RECOMMENDED",
        message: "HSN code is recommended for downstream exports.",
        fieldPath: "hsnCode",
      });
    }
    if (row.status !== undefined) {
      const normalizedStatus = this.normalizeRecordStatus(row.status);
      if (normalizedStatus !== RecordStatus.draft) {
        issues.push({
          rowNumber: 0,
          severity: "blocking",
          code: WORKFLOW_ENTRY_INVALID_CODE,
          message: "Imported rows must enter workflow in draft status.",
          fieldPath: "status",
        });
      }
    }
    if (row.attributes !== undefined && (Array.isArray(row.attributes) || typeof row.attributes !== "object")) {
      issues.push({
        rowNumber: 0,
        severity: "blocking",
        code: "ATTRIBUTES_INVALID",
        message: "Attributes must be a JSON object.",
        fieldPath: "attributes",
      });
    }
    return issues;
  }

  private getCorrelationId() {
    return getCorrelationContext()?.correlationId ?? undefined;
  }

  private describeValidationFailure(
    error: unknown,
    correlationId?: string,
  ): BulkImportValidationFailureDetails {
    const fallbackMessage = "The import file could not be validated.";

    if (error instanceof BadRequestException || error instanceof ForbiddenException || error instanceof NotFoundException) {
      const response = error.getResponse();
      const parsed = this.parseValidationFailureResponse(response, fallbackMessage);
      const code = parsed.code ?? this.defaultValidationFailureCode(error);
      const issues =
        parsed.issues.length > 0
          ? parsed.issues.map((issue) => enrichBulkImportValidationIssue(issue))
          : [this.buildBlockingIssue(parsed.message, code)];
      return {
        code,
        message: parsed.message,
        issues,
        failureClass: inferBulkImportFailureClass({ code, message: parsed.message, issues }),
        correlationId,
      };
    }

    if (error instanceof Error) {
      const message = this.sanitizeUnexpectedValidationMessage(error.message);
      const code = "DIRECT_VALIDATION_FAILED";
      const issues = [this.buildBlockingIssue(message, code)];
      return {
        code,
        message,
        issues,
        failureClass: inferBulkImportFailureClass({ code, message, issues }),
        correlationId,
      };
    }

    const code = "DIRECT_VALIDATION_FAILED";
    const issues = [this.buildBlockingIssue(fallbackMessage, code)];
    return {
      code,
      message: fallbackMessage,
      issues,
      failureClass: inferBulkImportFailureClass({ code, message: fallbackMessage, issues }),
      correlationId,
    };
  }

  private parseValidationFailureResponse(response: string | object, fallbackMessage: string) {
    if (typeof response === "string") {
      return {
        code: undefined,
        message: response || fallbackMessage,
        issues: response ? [this.buildBlockingIssue(response)] : [],
      };
    }

    if (!response || typeof response !== "object") {
      return { code: undefined, message: fallbackMessage, issues: [] as BulkImportValidationIssue[] };
    }

    const record = response as Record<string, unknown>;
    const messageValue = record.message;
    const issuesValue = record.issues;
    const code =
      typeof record.code === "string" && record.code.trim().length > 0
        ? record.code.trim()
        : typeof record.error === "string" && record.error.trim().length > 0
          ? record.error.trim()
          : undefined;
    const issues = this.normalizeValidationFailureIssues(issuesValue);

    if (typeof messageValue === "string" && messageValue.trim()) {
      return { code, message: messageValue.trim(), issues };
    }

    if (Array.isArray(messageValue)) {
      const messages = messageValue
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((item) => item.trim());
      return {
        code,
        message: messages[0] ?? fallbackMessage,
        issues: issues.length > 0 ? issues : messages.map((message) => this.buildBlockingIssue(message, code)),
      };
    }

    const reason = typeof record.reason === "string" && record.reason.trim().length > 0 ? record.reason.trim() : "";
    if (reason) {
      return {
        code,
        message: reason,
        issues: issues.length > 0 ? issues : [this.buildBlockingIssue(reason, code)],
      };
    }

    return {
      code,
      message: fallbackMessage,
      issues,
    };
  }

  private normalizeValidationFailureIssues(value: unknown): BulkImportValidationIssue[] {
    if (!Array.isArray(value)) {
      return [];
    }
    const issues: BulkImportValidationIssue[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const message = typeof record.message === "string" ? record.message.trim() : "";
      if (!message) {
        continue;
      }
      issues.push(
        enrichBulkImportValidationIssue({
          rowNumber: typeof record.rowNumber === "number" && Number.isFinite(record.rowNumber) ? record.rowNumber : 0,
          severity: record.severity === "warning" ? "warning" : "blocking",
          code:
            typeof record.code === "string" && record.code.trim().length > 0
              ? record.code.trim()
              : "DIRECT_VALIDATION_FAILED",
          message,
          fieldPath: typeof record.fieldPath === "string" && record.fieldPath.trim().length > 0 ? record.fieldPath.trim() : null,
          remediation:
            typeof record.remediation === "string" && record.remediation.trim().length > 0
              ? record.remediation.trim()
              : null,
        }),
      );
    }
    return issues;
  }

  private defaultValidationFailureCode(error: BadRequestException | ForbiddenException | NotFoundException) {
    if (error instanceof ForbiddenException) {
      return "DIRECT_VALIDATION_FORBIDDEN";
    }
    if (error instanceof NotFoundException) {
      return "DIRECT_VALIDATION_NOT_FOUND";
    }
    return "DIRECT_VALIDATION_INVALID";
  }

  private sanitizeUnexpectedValidationMessage(message: string) {
    const normalized = String(message ?? "").trim();
    if (!normalized || /^internal server error$/i.test(normalized)) {
      return "The import file could not be validated because the server returned an unexpected error.";
    }
    if (/ENOENT|no such file or directory/i.test(normalized)) {
      return "The import file is no longer available. Upload the source file again and retry validation.";
    }
    return normalized;
  }

  private buildBlockingIssue(message: string, code = "DIRECT_VALIDATION_FAILED"): BulkImportValidationIssue {
    return enrichBulkImportValidationIssue({
      rowNumber: 0,
      severity: "blocking",
      code,
      message,
      fieldPath: null,
    });
  }

  private throwValidationFailure(error: unknown, failure: BulkImportValidationFailureDetails): never {
    const payload: BulkImportValidationFailureResponse = {
      message: failure.message,
      issues: failure.issues,
      sampleIssues: failure.issues,
      canImport: false,
      failureCode: failure.code,
      failureClass: failure.failureClass,
      correlationId: failure.correlationId,
    };

    if (error instanceof BadRequestException) {
      throw new BadRequestException(payload);
    }
    if (error instanceof ForbiddenException) {
      throw new ForbiddenException(payload);
    }
    if (error instanceof NotFoundException) {
      throw new NotFoundException(payload);
    }
    throw new InternalServerErrorException(payload);
  }

  private async emitValidationMetrics(input: {
    tenantKey: string;
    path: "direct" | "staged";
    sourceFormat: "csv" | "json";
    blocked?: boolean;
    failed?: boolean;
    failureCode?: string;
    failureClass?: BulkImportFailureClass;
  }) {
    const tags = {
      path: input.path,
      sourceFormat: input.sourceFormat,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
      ...(input.failureClass ? { failureClass: input.failureClass } : {}),
    };

    await this.metricsService.emit({
      tenantKey: input.tenantKey,
      metricKey: "bulk_import.validation.total",
      metricValue: 1,
      unit: "count",
      tags,
    });

    if (input.blocked) {
      await this.metricsService.emit({
        tenantKey: input.tenantKey,
        metricKey: "bulk_import.validation.blocked",
        metricValue: 1,
        unit: "count",
        tags,
      });
    }

    if (input.failed) {
      await this.metricsService.emit({
        tenantKey: input.tenantKey,
        metricKey: "bulk_import.validation.failed",
        metricValue: 1,
        unit: "count",
        tags,
      });
    }
  }

  private assertDraftWorkflowEntry(status: RecordStatus) {
    if (status === RecordStatus.draft) {
      return;
    }
    throw new BadRequestException({
      code: "WORKFLOW_ENTRY_INVALID",
      message: "Imported rows must enter workflow in draft status.",
      allowedStatus: RecordStatus.draft,
      receivedStatus: status,
    });
  }

  private asRowPayload(value: Prisma.JsonValue): CanonicalRowPayload {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as CanonicalRowPayload;
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
      const value = this.asTrimmedString(candidate);
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
      const response = error.getResponse();
      if (typeof response === "string") {
        return response;
      }
      if (response && typeof response === "object" && !Array.isArray(response)) {
        const responseRecord = response as { code?: unknown; message?: unknown };
        const code = typeof responseRecord.code === "string" ? responseRecord.code.trim() : "";
        const messageValue = responseRecord.message;
        const message = Array.isArray(messageValue)
          ? messageValue.map((value) => String(value)).join(", ")
          : typeof messageValue === "string"
            ? messageValue
            : "Bulk import row processing failed.";
        return code ? `${code}: ${message}` : message;
      }
      return String(error.message);
    }
    if (error instanceof Error) {
      return error.message;
    }
    return "Bulk import row processing failed.";
  }

  private isWorkflowEntryInvalidError(error: unknown) {
    if (!(error instanceof BadRequestException)) {
      return false;
    }
    const response = error.getResponse();
    if (response && typeof response === "object" && !Array.isArray(response)) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === "string" && code.trim().toUpperCase() === WORKFLOW_ENTRY_INVALID_CODE) {
        return true;
      }
    }
    return String(error.message).toUpperCase().includes(WORKFLOW_ENTRY_INVALID_CODE);
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

  private mapTemplateResponse(
    template: BulkImportTemplateRow & { compatibility: TemplateCompatibility },
  ) {
    return {
      id: template.id,
      tenantKey: template.tenantKey,
      categoryId: template.categoryId,
      name: template.name,
      version: template.version,
      sourceFormat: template.sourceFormat,
      mapping: template.mapping,
      schemaSnapshot: template.schemaSnapshot,
      chunkSize: template.chunkSize,
      maxRetries: template.maxRetries,
      compatibility: template.compatibility,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      category: {
        id: template.categoryId,
        path: template.categoryPath,
      },
    };
  }

  private resolveRequestTenantKey(requestedTenantKey?: string) {
    const contextTenantKey = normalizeTenantKey(getTenantKeyFromContext());
    if (typeof requestedTenantKey !== "string" || requestedTenantKey.trim().length === 0) {
      return contextTenantKey;
    }
    const normalizedRequested = normalizeTenantKey(requestedTenantKey);
    if (normalizedRequested !== contextTenantKey) {
      throw new BadRequestException("tenantKey mismatch with authenticated tenant context.");
    }
    return contextTenantKey;
  }

  private async resolveImportRowLimit(actor?: PolicyActor) {
    const tenantKey = this.resolveRequestTenantKey(actor?.tenantId ?? undefined);
    const planRowLimit = await this.planUsageService.getImportRowLimit(tenantKey);
    return Math.min(planRowLimit, LARGE_IMPORT_ROW_CEILING);
  }

  private parseTemplateSourceFormat(value: string) {
    const normalized = value.trim().toLowerCase();
    if (TEMPLATE_SOURCE_FORMATS.has(normalized)) {
      return normalized;
    }
    throw new BadRequestException("Invalid template source format.");
  }

  private normalizeTemplateMapping(value?: Record<string, string>) {
    const mapping: Record<string, string> = {};
    for (const [key, mapped] of Object.entries(value ?? {})) {
      const normalizedKey = String(key ?? "").trim();
      const normalizedValue = String(mapped ?? "").trim();
      if (!normalizedKey || !normalizedValue) {
        continue;
      }
      mapping[normalizedKey] = normalizedValue;
    }

    if (Object.keys(mapping).length === 0) {
      return { ...DEFAULT_MAPPING };
    }
    return mapping;
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
      this.prisma.tenant().bulkImportRow.groupBy({
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
      this.prisma.tenant().bulkImportRow.groupBy({
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
      this.prisma.tenant().bulkImportRow.groupBy({
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

  private async attachTemplateCompatibility<T extends BulkImportTemplateLike>(
    templates: T[],
  ) {
    if (templates.length === 0) {
      return templates as Array<T & { compatibility: TemplateCompatibility }>;
    }

    const categoryIds = [...new Set(templates.map((template) => template.categoryId))];
    const currentAttributes = await this.prisma.tenant().attributeDefinition.findMany({
      where: {
        categoryId: {
          in: categoryIds,
        },
      },
      take: 5_000, // defensive cap — attributes across all categories in these templates
      select: {
        categoryId: true,
        key: true,
        dataType: true,
        required: true,
        appliesTo: true,
      },
    });

    const attributesByCategory = new Map<string, CategoryAttributeSnapshot[]>();
    for (const attribute of currentAttributes) {
      const list = attributesByCategory.get(attribute.categoryId) ?? [];
      list.push({
        key: attribute.key,
        dataType: attribute.dataType,
        required: attribute.required,
        appliesTo: attribute.appliesTo,
      });
      attributesByCategory.set(attribute.categoryId, list);
    }

    return templates.map((template) => ({
      ...template,
      compatibility: this.evaluateTemplateCompatibility(
        this.parseTemplateSchemaSnapshot(template.schemaSnapshot),
        attributesByCategory.get(template.categoryId) ?? [],
      ),
    }));
  }

  private async buildTemplateSchemaSnapshot(categoryId: string): Promise<TemplateSchemaSnapshot> {
    const attributes = await this.prisma.tenant().attributeDefinition.findMany({
      where: { categoryId },
      take: 500, // defensive cap — attribute definitions per category
      select: {
        key: true,
        dataType: true,
        required: true,
        appliesTo: true,
      },
      orderBy: [{ key: "asc" }],
    });
    return {
      capturedAt: new Date().toISOString(),
      attributes: attributes.map((attribute) => ({
        key: attribute.key,
        dataType: attribute.dataType,
        required: attribute.required,
        appliesTo: attribute.appliesTo,
      })),
    };
  }

  private parseTemplateSchemaSnapshot(snapshot: Prisma.JsonValue | null) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return null;
    }
    const value = snapshot as {
      capturedAt?: unknown;
      attributes?: unknown;
    };
    if (!Array.isArray(value.attributes)) {
      return null;
    }

    const attributes: CategoryAttributeSnapshot[] = [];
    for (const item of value.attributes) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const candidate = item as Record<string, unknown>;
      const key = String(candidate.key ?? "").trim();
      const dataType = String(candidate.dataType ?? "").trim();
      const appliesTo = String(candidate.appliesTo ?? "").trim();
      if (!key || !dataType || !appliesTo) {
        continue;
      }
      attributes.push({
        key,
        dataType,
        required: Boolean(candidate.required),
        appliesTo,
      });
    }

    return {
      capturedAt: String(value.capturedAt ?? ""),
      attributes,
    } satisfies TemplateSchemaSnapshot;
  }

  private evaluateTemplateCompatibility(
    snapshot: TemplateSchemaSnapshot | null,
    currentAttributes: CategoryAttributeSnapshot[],
  ): TemplateCompatibility {
    if (!snapshot) {
      return {
        compatible: false,
        warnings: ["Template has no schema snapshot. Re-save template to capture latest schema."],
      };
    }

    const warnings: string[] = [];
    const snapshotMap = new Map(snapshot.attributes.map((attribute) => [attribute.key, attribute]));
    const currentMap = new Map(currentAttributes.map((attribute) => [attribute.key, attribute]));

    for (const [key, previous] of snapshotMap.entries()) {
      const current = currentMap.get(key);
      if (!current) {
        warnings.push(`Attribute '${key}' no longer exists in category schema.`);
        continue;
      }
      if (previous.dataType !== current.dataType) {
        warnings.push(
          `Attribute '${key}' type changed (${previous.dataType} -> ${current.dataType}).`,
        );
      }
      if (previous.appliesTo !== current.appliesTo) {
        warnings.push(
          `Attribute '${key}' scope changed (${previous.appliesTo} -> ${current.appliesTo}).`,
        );
      }
      if (previous.required !== current.required && current.required) {
        warnings.push(`Attribute '${key}' is now required.`);
      }
    }

    for (const current of currentAttributes) {
      if (current.required && !snapshotMap.has(current.key)) {
        warnings.push(
          `New required attribute '${current.key}' was added after template version ${snapshot.capturedAt || "snapshot"}.`,
        );
      }
    }

    return {
      compatible: warnings.length === 0,
      warnings,
    };
  }

  private async requireJob(jobId: string) {
    const job = await this.prisma.tenant().bulkImportJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException("Bulk import job not found");
    }
    return job;
  }

  private async requireRow(jobId: string, rowId: string) {
    const row = await this.prisma.tenant().bulkImportRow.findFirst({
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
    const category = await this.prisma.tenant().category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  private async filterTemplatesByScope<T extends { categoryId: string }>(templates: T[], actor: PolicyActor) {
    const results = await Promise.all(
      templates.map(async (template) => ({
        template,
        allowed: await this.isCategoryAllowed(actor, template.categoryId),
      })),
    );
    return results.filter((entry) => entry.allowed).map((entry) => entry.template);
  }

  private async filterJobsByScope<T extends { categoryId: string }>(jobs: T[], actor: PolicyActor) {
    const results = await Promise.all(
      jobs.map(async (job) => ({
        job,
        allowed: await this.isCategoryAllowed(actor, job.categoryId),
      })),
    );
    return results.filter((entry) => entry.allowed).map((entry) => entry.job);
  }

  private async isCategoryAllowed(actor: PolicyActor, categoryId: string) {
    try {
      await this.accessPolicy.assertCategoryAccess(actor, "import", categoryId, "BulkImportJob");
      return true;
    } catch {
      return false;
    }
  }

  async validateImport(input: {
    categoryId?: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }) {
    const ALLOWED_MIME_TYPES = new Set([
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]);
    const ALLOWED_EXTENSIONS = new Set(["csv", "xlsx"]);
    const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
    const ESTIMATED_BYTES_PER_ROW = 120;

    const formatValid = ALLOWED_MIME_TYPES.has(input.mimeType) ||
      ALLOWED_EXTENSIONS.has((input.fileName.split(".").pop() ?? "").toLowerCase());

    const schemaIssues: string[] = [];
    const categoryIssues: string[] = [];

    if (!formatValid) {
      return {
        valid: false,
        formatValid: false,
        schemaIssues,
        categoryIssues: [],
        rowCount: null,
        blockingCount: 1,
        warningCount: 0,
        sampleErrors: [],
        fieldMappingSummary: [],
      };
    }

    if (input.fileSize > MAX_FILE_SIZE_BYTES) {
      schemaIssues.push("File exceeds maximum allowed size of 8 MB.");
    }

    if (input.categoryId) {
      const category = await this.prisma.tenant().category.findUnique({
        where: { id: input.categoryId },
        select: { id: true, name: true },
      });
      if (!category) {
        categoryIssues.push(`Category '${input.categoryId}' not found in this workspace.`);
      }
    } else {
      categoryIssues.push("No category specified — import will use the default category assignment.");
    }

    const estimatedRowCount = Math.floor(input.fileSize / ESTIMATED_BYTES_PER_ROW);
    const blockingCount = schemaIssues.length;
    const warningCount = categoryIssues.length;

    const fieldMappingSummary = [
      { sourceField: "title", mappedTo: "title" },
      { sourceField: "description", mappedTo: "description" },
      { sourceField: "brand", mappedTo: "brand" },
      { sourceField: "hsnCode", mappedTo: "hsnCode" },
      { sourceField: "gstRate", mappedTo: "gstRate" },
      { sourceField: "status", mappedTo: "status" },
      { sourceField: "attributes", mappedTo: "attributes" },
      // International tax code flat columns (optional; also accepted as JSON taxCodes array)
      { sourceField: "gb_commodity_code", mappedTo: "taxCodes[GB.COMMODITY_CODE]" },
      { sourceField: "ae_hs_code", mappedTo: "taxCodes[AE.HS_CODE]" },
      { sourceField: "us_tax_category", mappedTo: "taxCodes[US.TAX_CATEGORY]" },
      { sourceField: "au_commodity_code", mappedTo: "taxCodes[AU.COMMODITY_CODE]" },
    ];

    return {
      valid: blockingCount === 0,
      formatValid: true,
      schemaIssues,
      categoryIssues,
      rowCount: estimatedRowCount > 0 ? estimatedRowCount : null,
      blockingCount,
      warningCount,
      sampleErrors: [] as Array<{ row: number; field: string; message: string }>,
      fieldMappingSummary,
    };
  }
}
