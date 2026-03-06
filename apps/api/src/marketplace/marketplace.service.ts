import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import {
  ExportJobStatus,
  MarketplaceChannel as MarketplaceChannelDb,
  Prisma,
  RuleSeverity,
  ValidationIssueStatus,
} from "@prisma/client";
import { ConnectorFrameworkService } from "../connector-framework/connector-framework.service";
import {
  CapabilityNotSupportedError,
  CredentialExpiredError,
  InstallationNotFoundError,
} from "../connector-framework/connector.errors";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { PrismaService } from "../prisma/prisma.service";
import { LoggerService } from "../common/logging/logger.service";
import { MetricsService } from "../metrics/metrics.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { QueueService } from "../queue/queue.service";
import { CloneMappingTemplateDto } from "./dto/clone-mapping-template.dto";
import { CreateExportJobDto } from "./dto/create-export-job.dto";
import { ConnectorMappingService } from "./connector-mapping.service";
import { CreateMappingTemplateDto } from "./dto/create-mapping-template.dto";
import { MARKETPLACE_CHANNELS } from "./dto/simulate-marketplace.dto";
import { UpdateMappingTemplateDto } from "./dto/update-mapping-template.dto";

type MarketplaceChannel = (typeof MARKETPLACE_CHANNELS)[number];

type MappingPack = {
  channel: MarketplaceChannel;
  displayName: string;
  requiredFields: string[];
  fieldMap: Record<string, string>;
};

type EffectiveMapping = MappingPack & {
  templateId: string | null;
  templateName: string | null;
  source: "system_pack" | "saved_template";
};

type AuthoritativeChannelIssue = {
  severity: "error" | "warning";
  code: string;
  fieldPath: string;
  sellerMessage: string;
  message: string;
};

type AmazonValidationResult = {
  authoritative: boolean;
  missingFields: string[];
  channelIssues: AuthoritativeChannelIssue[];
  warnings: string[];
};

type SubmissionFilters = {
  productId?: string;
  connectorSlug?: string;
  status?: string;
  minAttempt?: number;
};

type SubmissionIssue = {
  code: string;
  fieldPath: string | null;
  severity: "error" | "warning";
  sellerMessage: string;
};

const MAPPING_PACKS: Record<MarketplaceChannel, MappingPack> = {
  amazon: {
    channel: "amazon",
    displayName: "Amazon",
    requiredFields: [
      "title",
      "brand",
      "description",
      "hsnCode",
      "gstRate",
      "attributes.color",
      "attributes.material",
    ],
    fieldMap: {
      title: "item_name",
      brand: "brand_name",
      description: "product_description",
      hsnCode: "hsn_code",
      gstRate: "tax_rate",
      "attributes.color": "color_name",
      "attributes.material": "material_type",
      "attributes.size": "size_name",
    },
  },
  flipkart: {
    channel: "flipkart",
    displayName: "Flipkart",
    requiredFields: [
      "title",
      "brand",
      "description",
      "hsnCode",
      "gstRate",
      "attributes.size",
      "attributes.color",
    ],
    fieldMap: {
      title: "product_title",
      brand: "brand",
      description: "description",
      hsnCode: "hsn_code",
      gstRate: "gst_rate",
      "attributes.size": "size",
      "attributes.color": "color",
      "attributes.material": "material",
    },
  },
  meesho: {
    channel: "meesho",
    displayName: "Meesho",
    requiredFields: ["title", "brand", "hsnCode", "gstRate", "attributes.color"],
    fieldMap: {
      title: "product_name",
      brand: "brand",
      hsnCode: "hsn",
      gstRate: "gst",
      "attributes.color": "color",
      "attributes.material": "fabric",
    },
  },
};

@Injectable()
export class MarketplaceService implements OnModuleInit {
  private workerRegistered = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorFramework: ConnectorFrameworkService,
    private readonly queueService: QueueService,
    private readonly metricsService: MetricsService,
    private readonly connectorMappingService: ConnectorMappingService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit() {
    this.registerConnectorWorker();
  }

  listChannels() {
    return MARKETPLACE_CHANNELS.map((channel) => {
      const pack = MAPPING_PACKS[channel];
      return {
        channel,
        displayName: pack.displayName,
        requiredFields: pack.requiredFields,
      };
    });
  }

  async getChannelMapping(channelInput: string, categoryId?: string, templateId?: string) {
    const mapping = await this.getEffectiveMapping(channelInput, categoryId, templateId);
    return {
      channel: mapping.channel,
      displayName: mapping.displayName,
      requiredFields: mapping.requiredFields,
      fieldMap: mapping.fieldMap,
      source: mapping.source,
      templateId: mapping.templateId,
      templateName: mapping.templateName,
    };
  }

  async listTemplates(categoryId: string, channelInput?: string) {
    await this.requireCategory(categoryId);
    const channel = channelInput ? this.parseChannel(channelInput) : undefined;
    return this.prisma.tenant().channelMappingTemplate.findMany({
      where: {
        categoryId,
        channel: channel ? (channel as MarketplaceChannelDb) : undefined,
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
  }

  async createTemplate(categoryId: string, dto: CreateMappingTemplateDto) {
    await this.requireCategory(categoryId);
    const channel = this.parseChannel(dto.channel);
    const requiredFields = this.normalizeRequiredFields(dto.requiredFields);
    const fieldMap = this.normalizeFieldMap(dto.fieldMap);

    if (dto.isDefault) {
      await this.prisma.tenant().channelMappingTemplate.updateMany({
        where: { categoryId, channel: channel as MarketplaceChannelDb },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.tenant().channelMappingTemplate.create({
        data: {
          categoryId,
          name: dto.name.trim(),
          channel: channel as MarketplaceChannelDb,
          requiredFields: requiredFields as unknown as Prisma.JsonArray,
          fieldMap: fieldMap as unknown as Prisma.JsonObject,
          isDefault: dto.isDefault ?? false,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Template name already exists for this category and channel.");
      }
      throw error;
    }
  }

  async getTemplate(templateId: string) {
    return this.requireTemplate(templateId);
  }

  async updateTemplate(templateId: string, dto: UpdateMappingTemplateDto) {
    const existing = await this.requireTemplate(templateId);
    if (existing.isSystemPack) {
      throw new BadRequestException("System mapping packs are read-only.");
    }
    if (
      typeof dto.version === "number" &&
      Number.isFinite(dto.version) &&
      Math.floor(dto.version) !== existing.version
    ) {
      throw new ConflictException(`Version conflict. Expected ${existing.version}.`);
    }

    const updatedName = dto.name ? dto.name.trim() : existing.name;
    const updatedChannel = dto.channel
      ? (this.parseChannel(dto.channel) as MarketplaceChannelDb)
      : existing.channel;
    const updatedRequiredFields = dto.requiredFields
      ? this.normalizeRequiredFields(dto.requiredFields)
      : this.asStringArray(existing.requiredFields);
    const updatedFieldMap = dto.fieldMap
      ? this.normalizeFieldMap(dto.fieldMap)
      : this.asStringMap(existing.fieldMap);
    const updatedDefault = dto.isDefault ?? existing.isDefault;

    if (updatedDefault) {
      await this.prisma.tenant().channelMappingTemplate.updateMany({
        where: {
          categoryId: existing.categoryId,
          channel: updatedChannel,
          id: { not: existing.id },
        },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.tenant().channelMappingTemplate.update({
        where: { id: existing.id },
        data: {
          name: updatedName,
          channel: updatedChannel,
          requiredFields: updatedRequiredFields as unknown as Prisma.JsonArray,
          fieldMap: updatedFieldMap as unknown as Prisma.JsonObject,
          isDefault: updatedDefault,
          version: existing.version + 1,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Template name already exists for this category and channel.");
      }
      throw error;
    }
  }

  async deleteTemplate(templateId: string) {
    const template = await this.requireTemplate(templateId);
    if (template.isSystemPack) {
      throw new BadRequestException("System mapping packs cannot be deleted.");
    }
    await this.prisma.tenant().channelMappingTemplate.delete({
      where: { id: template.id },
    });
    return {
      id: template.id,
      status: "deleted" as const,
    };
  }

  async cloneTemplate(templateId: string, dto: CloneMappingTemplateDto) {
    const source = await this.requireTemplate(templateId);
    const cloneNameInput = dto.name ? dto.name.trim() : "";
    const cloneName =
      cloneNameInput.length > 0
        ? cloneNameInput
        : await this.generateCloneTemplateName(source.categoryId, source.channel, source.name);
    const cloneIsDefault = dto.isDefault ?? false;
    if (cloneIsDefault) {
      await this.prisma.tenant().channelMappingTemplate.updateMany({
        where: {
          categoryId: source.categoryId,
          channel: source.channel,
        },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.tenant().channelMappingTemplate.create({
        data: {
          categoryId: source.categoryId,
          name: cloneName,
          channel: source.channel,
          requiredFields: source.requiredFields as Prisma.InputJsonValue,
          fieldMap: source.fieldMap as Prisma.InputJsonValue,
          isDefault: cloneIsDefault,
          isSystemPack: false,
          parentTemplateId: source.id,
          version: source.version + 1,
          createdBy: source.createdBy,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Template name already exists for this category and channel.");
      }
      throw error;
    }
  }

  async previewPayloadForInstallation(
    installationId: string,
    productId: string,
    templateId?: string,
    channelOverride?: string,
  ) {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    // RLS-BYPASS: manual tenant filter
    const rows = (await this.prisma.tenant().$queryRawUnsafe(
      `
      SELECT
        ci.id,
        cd.slug AS "connectorSlug"
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.id = $1
        AND ci.tenant_key = $2
      LIMIT 1
      `,
      installationId,
      tenantKey,
    )) as Array<{ id: string; connectorSlug: string }>;

    const installation = rows[0];
    if (!installation) {
      throw new NotFoundException("Connector installation not found.");
    }

    const channel = channelOverride
      ? this.parseChannel(channelOverride)
      : this.mapConnectorSlugToChannel(installation.connectorSlug);
    const simulation = await this.simulateProduct(productId, channel, templateId);
    return {
      installationId: installation.id,
      connectorSlug: installation.connectorSlug,
      channel: simulation.channel,
      templateId: simulation.templateId,
      templateName: simulation.templateName,
      mappingSource: simulation.mappingSource,
      exportReady: simulation.exportReady,
      validationSource: simulation.validationSource ?? "local_rules",
      missingFields: simulation.missingFields,
      channelIssues: simulation.channelIssues,
      mappedPayload: simulation.mappedPayload,
    };
  }

  async createExportJob(productId: string, dto: CreateExportJobDto) {
    const product = await this.prisma.tenant().product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const channel = this.parseChannel(dto.channel);
    const connectorSlug = this.mapChannelToConnectorSlug(channel as MarketplaceChannelDb);
    try {
      const tenantKey = this.connectorFramework.getCurrentTenantKey();
      const installation = await this.connectorFramework.requireInstallation(tenantKey, connectorSlug);
      if (!installation.capabilities.includes("PUBLISH")) {
        throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
      }
    } catch (error: unknown) {
      if (
        error instanceof InstallationNotFoundError ||
        error instanceof CredentialExpiredError ||
        error instanceof CapabilityNotSupportedError
      ) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    const simulation = await this.simulateProduct(productId, dto.channel, dto.templateId);
    await this.connectorMappingService.assertPublishReadyForExport({
      connectorSlug,
      categoryScope: product.categoryId,
      fallbackAcknowledged: dto.fallbackAcknowledged,
      productId,
    });
    const job = await this.prisma.tenant().marketplaceExportJob.create({
      data: {
        productId,
        categoryId: product.categoryId,
        channel: simulation.channel as MarketplaceChannelDb,
        templateId: simulation.templateId ?? null,
        status: ExportJobStatus.queued,
        retryCount: 0,
        maxRetries: dto.maxRetries ?? 3,
        payload: {
          mappingSource: simulation.mappingSource,
          missingFields: simulation.missingFields,
          complianceSummary: simulation.complianceSummary,
          mappedPayload: simulation.mappedPayload,
        } as Prisma.JsonObject,
      },
      include: { template: true },
    });
    this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
      jobId: job.id,
      connectorSlug: simulation.channel,
    });
    return job;
  }

  async listExportJobs(productId?: string, pagination?: CursorPaginationQuery) {
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
      const jobs = await this.prisma.tenant().marketplaceExportJob.findMany({
        where: {
          ...(productId ? { productId } : {}),
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
          template: true,
          product: { select: { id: true, title: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const hasNext = jobs.length > limit;
      const items = hasNext ? jobs.slice(0, limit) : jobs;
      const last = items[items.length - 1];
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
    return this.prisma.tenant().marketplaceExportJob.findMany({
      where: productId ? { productId } : undefined,
      include: {
        template: true,
        product: { select: { id: true, title: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 50,
    });
  }

  async listSubmissions(filters?: SubmissionFilters, pagination?: CursorPaginationQuery) {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const productId = filters?.productId ? String(filters.productId).trim() : "";
    const connectorSlug = filters?.connectorSlug ? String(filters.connectorSlug).trim().toLowerCase() : "";
    const status = filters?.status ? String(filters.status).trim().toUpperCase() : "";
    const minAttempt = Number.isFinite(filters?.minAttempt)
      ? Math.max(1, Math.floor(filters?.minAttempt ?? 1))
      : null;

    const params: Array<string | number | Date> = [tenantKey];
    const clauses: string[] = ["cs.tenant_key = $1"];

    if (productId) {
      params.push(productId);
      clauses.push(`cs.product_id = $${params.length}`);
    }
    if (connectorSlug) {
      params.push(connectorSlug);
      clauses.push(`LOWER(cd.slug) = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`UPPER(cs.status) = $${params.length}`);
    }
    if (minAttempt !== null) {
      params.push(minAttempt);
      clauses.push(`cs.attempt_number >= $${params.length}`);
    }

    const whereSql = `WHERE ${clauses.join(" AND ")}`;

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
      if (token && cursorDate) {
        params.push(cursorDate);
        const dateParam = params.length;
        params.push(token.id);
        const idParam = params.length;
        clauses.push(`(cs.submitted_at < $${dateParam} OR (cs.submitted_at = $${dateParam} AND cs.id < $${idParam}))`);
      }

      const pagedWhereSql = `WHERE ${clauses.join(" AND ")}`;
      params.push(limit + 1);
      const limitParam = params.length;
      // RLS-BYPASS: manual tenant filter
      const rows = (await this.prisma.tenant().$queryRawUnsafe(
        `
        SELECT
          cs.id,
          cs.product_id AS "productId",
          cs.variant_id AS "variantId",
          cs.installation_id AS "installationId",
          cd.slug AS "connectorSlug",
          cd.display_name AS "connectorDisplayName",
          cs.idempotency_key AS "idempotencyKey",
          cs.submission_type AS "submissionType",
          cs.source,
          cs.attempt_number AS "attemptNumber",
          cs.status,
          cs.external_ref AS "externalRef",
          cs.payload_snapshot_url AS "payloadSnapshotUrl",
          cs.submitted_at AS "submittedAt",
          cs.resolved_at AS "resolvedAt",
          cs.channel_errors AS "channelErrors"
        FROM connector_submissions cs
        JOIN connector_installations ci ON ci.id = cs.installation_id
        JOIN connector_definitions cd ON cd.id = ci.connector_id
        ${pagedWhereSql}
        ORDER BY cs.submitted_at DESC, cs.id DESC
        LIMIT $${limitParam}
        `,
        ...params,
      )) as Array<Record<string, unknown>>;

      const hasNext = rows.length > limit;
      const items = hasNext ? rows.slice(0, limit) : rows;
      const last = items[items.length - 1] as { id?: unknown; submittedAt?: unknown } | undefined;
      const submittedAt = last?.submittedAt instanceof Date
        ? last.submittedAt
        : typeof last?.submittedAt === "string"
          ? new Date(last.submittedAt)
          : null;

      return {
        items: items.map((item) => this.normalizeSubmissionRow(item)),
        limit,
        nextCursor:
          hasNext &&
          submittedAt &&
          !Number.isNaN(submittedAt.getTime()) &&
          typeof last?.id === "string"
            ? encodeCursorToken({
                sort: submittedAt.toISOString(),
                id: last.id,
              })
            : null,
      };
    }

    params.push(50);
    const limitParam = params.length;
    // RLS-BYPASS: manual tenant filter
    const rows = (await this.prisma.tenant().$queryRawUnsafe(
      `
      SELECT
        cs.id,
        cs.product_id AS "productId",
        cs.variant_id AS "variantId",
        cs.installation_id AS "installationId",
        cd.slug AS "connectorSlug",
        cd.display_name AS "connectorDisplayName",
        cs.idempotency_key AS "idempotencyKey",
        cs.submission_type AS "submissionType",
        cs.source,
        cs.attempt_number AS "attemptNumber",
        cs.status,
        cs.external_ref AS "externalRef",
        cs.payload_snapshot_url AS "payloadSnapshotUrl",
        cs.submitted_at AS "submittedAt",
        cs.resolved_at AS "resolvedAt",
        cs.channel_errors AS "channelErrors"
      FROM connector_submissions cs
      JOIN connector_installations ci ON ci.id = cs.installation_id
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      ${whereSql}
      ORDER BY cs.submitted_at DESC, cs.id DESC
      LIMIT $${limitParam}
      `,
      ...params,
    )) as Array<Record<string, unknown>>;
    return rows.map((row) => this.normalizeSubmissionRow(row));
  }

  async listDeadLetterSubmissions(pagination?: CursorPaginationQuery) {
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

      const jobs = await this.prisma.tenant().marketplaceExportJob.findMany({
        where: {
          status: ExportJobStatus.dead_letter,
          ...(token && cursorDate
            ? {
                OR: [
                  { updatedAt: { lt: cursorDate } },
                  { updatedAt: cursorDate, id: { lt: token.id } },
                ],
              }
            : {}),
        },
        include: {
          product: { select: { id: true, title: true } },
          template: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });

      const hasNext = jobs.length > limit;
      const items = hasNext ? jobs.slice(0, limit) : jobs;
      const last = items[items.length - 1];
      return {
        items,
        limit,
        nextCursor:
          hasNext && last
            ? encodeCursorToken({
                sort: last.updatedAt.toISOString(),
                id: last.id,
              })
            : null,
      };
    }

    return this.prisma.tenant().marketplaceExportJob.findMany({
      where: { status: ExportJobStatus.dead_letter },
      include: {
        product: { select: { id: true, title: true } },
        template: true,
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 50,
    });
  }

  async getSubmission(submissionId: string) {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    // RLS-BYPASS: manual tenant filter
    const rows = (await this.prisma.tenant().$queryRawUnsafe(
      `
      SELECT
        cs.id,
        cs.product_id AS "productId",
        cs.variant_id AS "variantId",
        cs.installation_id AS "installationId",
        cd.slug AS "connectorSlug",
        cd.display_name AS "connectorDisplayName",
        cs.idempotency_key AS "idempotencyKey",
        cs.submission_type AS "submissionType",
        cs.source,
        cs.attempt_number AS "attemptNumber",
        cs.status,
        cs.external_ref AS "externalRef",
        cs.payload_snapshot AS "payloadSnapshot",
        cs.payload_snapshot_url AS "payloadSnapshotUrl",
        cs.channel_errors AS "channelErrors",
        cs.submitted_at AS "submittedAt",
        cs.resolved_at AS "resolvedAt"
      FROM connector_submissions cs
      JOIN connector_installations ci ON ci.id = cs.installation_id
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE cs.tenant_key = $1
        AND cs.id = $2
      LIMIT 1
      `,
      tenantKey,
      submissionId,
    )) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      throw new NotFoundException("Submission not found");
    }
    return this.normalizeSubmissionRow(rows[0], true);
  }

  async getSubmissionIssues(submissionId: string) {
    const submission = await this.getSubmission(submissionId) as { channelErrors?: unknown };
    return this.normalizeSubmissionIssues(submission.channelErrors);
  }

  async retrySubmission(submissionId: string) {
    const submission = await this.getSubmission(submissionId) as { idempotencyKey: string; connectorSlug: string };
    const idempotencyKey = String(submission.idempotencyKey ?? "").trim();
    const delimiter = idempotencyKey.indexOf(":");
    if (delimiter <= 0) {
      throw new BadRequestException("Submission cannot be retried: invalid idempotency key format.");
    }
    const jobId = idempotencyKey.slice(0, delimiter);
    const requeuedJob = await this.requeueExportJob(jobId);
    this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
      jobId,
      connectorSlug: String(submission.connectorSlug ?? "").toLowerCase(),
    });
    return {
      queued: true,
      submissionId,
      exportJob: requeuedJob,
    };
  }

  async getExportJob(jobId: string) {
    const job = await this.prisma.tenant().marketplaceExportJob.findUnique({
      where: { id: jobId },
      include: { template: true, product: { select: { id: true, title: true } } },
    });
    if (!job) {
      throw new NotFoundException("Export job not found");
    }
    return job;
  }

  async processExportJob(jobId: string) {
    const startedAtMs = Date.now();
    const existing = await this.prisma.tenant().marketplaceExportJob.findUnique({ where: { id: jobId } });
    if (!existing) {
      throw new NotFoundException("Export job not found");
    }
    if (existing.status === ExportJobStatus.completed) {
      return existing;
    }
    if (existing.status === ExportJobStatus.dead_letter) {
      throw new BadRequestException("Job is in DLQ. Requeue before processing.");
    }

    await this.prisma.tenant().marketplaceExportJob.update({
      where: { id: jobId },
      data: { status: ExportJobStatus.processing },
    });

    try {
      const simulation = await this.simulateProduct(
        existing.productId,
        existing.channel,
        existing.templateId ?? undefined,
      );
      await this.recordConnectorSubmissionIfInstalled(existing, simulation);

      if (simulation.exportReady) {
        const updated = await this.prisma.tenant().marketplaceExportJob.update({
          where: { id: jobId },
          data: {
            status: ExportJobStatus.completed,
            failureReason: null,
            dlqReason: null,
            exportPayload: simulation.mappedPayload as Prisma.JsonObject,
          },
          include: { template: true },
        });
        await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
        return updated;
      }

      const nextRetry = existing.retryCount + 1;
      const failureReason = this.buildFailureReason(simulation.missingFields, simulation.complianceSummary.errorCount);
      if (nextRetry >= existing.maxRetries) {
        const updated = await this.prisma.tenant().marketplaceExportJob.update({
          where: { id: jobId },
          data: {
            status: ExportJobStatus.dead_letter,
            retryCount: nextRetry,
            failureReason,
            dlqReason: "Max retries exceeded",
            exportPayload: Prisma.JsonNull,
          },
          include: { template: true },
        });
        await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
        return updated;
      }

      const updated = await this.prisma.tenant().marketplaceExportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.retrying,
          retryCount: nextRetry,
          failureReason,
          exportPayload: Prisma.JsonNull,
        },
        include: { template: true },
      });
      await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
      return updated;
    } catch (error) {
      const failureReason = this.toFailureReason(error);
      this.logger.error("Marketplace export job failed during processing", {
        jobId,
        channel: existing.channel,
        error: failureReason,
      });

      const updated = await this.prisma.tenant().marketplaceExportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.failed,
          failureReason,
          dlqReason: null,
          exportPayload: Prisma.JsonNull,
        },
        include: { template: true },
      });
      await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
      return updated;
    }
  }

  private registerConnectorWorker() {
    if (this.workerRegistered) {
      return;
    }
    this.workerRegistered = true;
    this.queueService.processWithBackpressure(
      QUEUE_NAMES.CONNECTOR_SUBMISSION,
      {
        laneResolver: (payload: unknown) => {
          const lanePayload = payload as { connectorSlug?: string };
          return String(lanePayload.connectorSlug ?? "unknown").toLowerCase();
        },
        defaultLanePolicy: {
          concurrency: 1,
          minIntervalMs: 400,
          rateLimitFailureThreshold: 5,
          pauseDurationMs: 60_000,
        },
        lanePolicies: {
          amazon: {
            concurrency: 1,
            minIntervalMs: 1_100,
          },
          flipkart: {
            concurrency: 1,
            minIntervalMs: 300,
          },
          meesho: {
            concurrency: 1,
            minIntervalMs: 300,
          },
        },
        onCircuitOpen: (event) => {
          this.logger.warn("Connector worker circuit opened", { ...event });
        },
      },
      async (payload: unknown) => {
        const lanePayload = payload as { jobId?: string };
        const jobId = String(lanePayload.jobId ?? "").trim();
        if (!jobId) {
          return;
        }
        try {
          await this.processExportJob(jobId);
        } catch (error: unknown) {
          await this.markJobFailedFromWorker(jobId, error);
          throw error;
        }
      },
    );
  }

  async requeueExportJob(jobId: string) {
    const existing = await this.prisma.tenant().marketplaceExportJob.findUnique({ where: { id: jobId } });
    if (!existing) {
      throw new NotFoundException("Export job not found");
    }
    if (
      existing.status !== ExportJobStatus.dead_letter &&
      existing.status !== ExportJobStatus.retrying &&
      existing.status !== ExportJobStatus.failed
    ) {
      throw new BadRequestException("Only retrying/failed/DLQ jobs can be requeued.");
    }
    return this.prisma.tenant().marketplaceExportJob.update({
      where: { id: jobId },
      data: {
        status: ExportJobStatus.queued,
        failureReason: null,
        dlqReason: null,
      },
      include: { template: true },
    });
  }

  async simulateProduct(productId: string, channelInput: string, templateId?: string) {
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      include: {
        validationIssues: {
          where: { status: ValidationIssueStatus.open },
          orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const mapping = await this.getEffectiveMapping(channelInput, product.categoryId, templateId);
    const attributes = this.asRecord(product.attributes);
    const mappedPayload: Record<string, unknown> = {};
    for (const [sourceField, targetField] of Object.entries(mapping.fieldMap)) {
      const value = this.getFieldValue(sourceField, product, attributes);
      if (!this.isEmpty(value)) {
        mappedPayload[targetField] = value;
      }
    }

    const localMissingFields = mapping.requiredFields.filter((fieldPath) =>
      this.isEmpty(this.getFieldValue(fieldPath, product, attributes)),
    );
    const localChannelIssues: AuthoritativeChannelIssue[] = localMissingFields.map((fieldPath) => ({
      severity: "error",
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath,
      sellerMessage: `${fieldPath} is required for ${mapping.displayName}.`,
      message: `${fieldPath} is required for ${mapping.displayName}.`,
    }));

    let missingFields = localMissingFields;
    let channelIssues = localChannelIssues;
    let validationSource: "local_rules" | "amazon_sp_api" = "local_rules";
    let validationWarnings: string[] = [];

    if (mapping.channel === "amazon") {
      const amazonValidation = await this.runAmazonValidation({
        productId,
        displayName: mapping.displayName,
        requiredFields: mapping.requiredFields,
        localMissingFields,
        localChannelIssues,
        mappedPayload,
      });
      if (amazonValidation) {
        validationWarnings = amazonValidation.warnings;
        missingFields = amazonValidation.missingFields;
        channelIssues = amazonValidation.channelIssues;
        if (amazonValidation.authoritative) {
          validationSource = "amazon_sp_api";
        }
      }
    }

    const complianceErrors = product.validationIssues.filter(
      (issue) => issue.severity === RuleSeverity.error,
    ).length;
    const complianceWarnings = product.validationIssues.filter(
      (issue) => issue.severity === RuleSeverity.warning,
    ).length;

    const riskScore = Math.min(
      100,
      missingFields.length * 18 + complianceErrors * 25 + complianceWarnings * 8,
    );
    const riskBand = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";

    return {
      productId,
      channel: mapping.channel,
      displayName: mapping.displayName,
      exportReady: channelIssues.length === 0 && complianceErrors === 0,
      riskScore,
      riskBand,
      requiredFields: mapping.requiredFields,
      missingFields,
      channelIssues,
      complianceSummary: {
        errorCount: complianceErrors,
        warningCount: complianceWarnings,
      },
      validationSource,
      validationWarnings,
      mappingSource: mapping.source,
      templateId: mapping.templateId,
      templateName: mapping.templateName,
      mappedPayload,
      suggestions: missingFields.map((fieldPath) => ({
        fieldPath,
        fix: `Provide ${fieldPath} before publishing to ${mapping.displayName}.`,
      })),
    };
  }

  private async runAmazonValidation(input: {
    productId: string;
    displayName: string;
    requiredFields: string[];
    localMissingFields: string[];
    localChannelIssues: AuthoritativeChannelIssue[];
    mappedPayload: Record<string, unknown>;
  }): Promise<AmazonValidationResult | null> {
    const featureEnabled =
      String(process.env.FEATURE_REAL_SPAPI_VALIDATION ?? "false")
        .trim()
        .toLowerCase() === "true";
    if (!featureEnabled) {
      return null;
    }

    const endpoint = String(process.env.PIM_AMAZON_VALIDATION_ENDPOINT ?? "").trim();
    if (!endpoint) {
      return {
        authoritative: false,
        missingFields: input.localMissingFields,
        channelIssues: input.localChannelIssues,
        warnings: [
          "Amazon authoritative validation is enabled, but PIM_AMAZON_VALIDATION_ENDPOINT is not configured. Falling back to local rules.",
        ],
      };
    }

    const token = String(process.env.PIM_AMAZON_VALIDATION_TOKEN ?? "").trim();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          productId: input.productId,
          requirements: "LISTING",
          requiredFields: input.requiredFields,
          mappedPayload: input.mappedPayload,
        }),
      });
      if (!response.ok) {
        return {
          authoritative: false,
          missingFields: input.localMissingFields,
          channelIssues: input.localChannelIssues,
          warnings: [`Amazon validation endpoint returned ${response.status}. Falling back to local rules.`],
        };
      }

      const payload = (await response.json()) as {
        missingFields?: unknown;
        issues?: Array<{
          severity?: unknown;
          code?: unknown;
          fieldPath?: unknown;
          message?: unknown;
        }>;
        warnings?: unknown;
      };
      const missingFields = this.normalizeFieldList(payload.missingFields);
      const issues = Array.isArray(payload.issues) ? payload.issues : [];
      const channelIssues = issues
        .map((issue) => {
          const severity = issue.severity === "warning" ? "warning" : "error";
          const fieldPath = typeof issue.fieldPath === "string" ? issue.fieldPath.trim() : "";
          const code = typeof issue.code === "string" ? issue.code.trim() : "AMAZON_VALIDATION_ISSUE";
          const message =
            typeof issue.message === "string" && issue.message.trim().length > 0
              ? issue.message.trim()
              : `${fieldPath || "field"} failed Amazon validation.`;
          if (!fieldPath) {
            return null;
          }
          return {
            severity,
            code,
            fieldPath,
            sellerMessage: message,
            message,
          } satisfies AuthoritativeChannelIssue;
        })
        .filter((value): value is AuthoritativeChannelIssue => value !== null);

      const warnings = Array.isArray(payload.warnings)
        ? payload.warnings
            .filter((warning): warning is string => typeof warning === "string")
            .map((warning) => warning.trim())
            .filter((warning) => warning.length > 0)
        : [];

      const resolvedMissingFields =
        missingFields.length > 0
          ? missingFields
          : channelIssues
              .filter((issue) => issue.code.includes("REQUIRED") || issue.message.toLowerCase().includes("required"))
              .map((issue) => issue.fieldPath);

      const fallbackIssues =
        channelIssues.length > 0
          ? channelIssues
          : resolvedMissingFields.map((fieldPath) => ({
              severity: "error" as const,
              code: "CHANNEL_REQUIRED_FIELD",
              fieldPath,
              sellerMessage: `${fieldPath} is required for ${input.displayName}.`,
              message: `${fieldPath} is required for ${input.displayName}.`,
            }));

      return {
        authoritative: true,
        missingFields: this.uniqueStrings(resolvedMissingFields),
        channelIssues: fallbackIssues,
        warnings,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown validation error";
      return {
        authoritative: false,
        missingFields: input.localMissingFields,
        channelIssues: input.localChannelIssues,
        warnings: [`Amazon validation endpoint unavailable (${errorMessage}). Falling back to local rules.`],
      };
    }
  }

  private async getEffectiveMapping(
    channelInput: string,
    categoryId?: string,
    templateId?: string,
  ): Promise<EffectiveMapping> {
    const channel = this.parseChannel(channelInput);
    const basePack = MAPPING_PACKS[channel];

    if (templateId) {
      const template = await this.prisma.tenant().channelMappingTemplate.findUnique({
        where: { id: templateId },
      });
      if (!template) {
        throw new NotFoundException("Mapping template not found");
      }
      if (template.channel !== (channel as MarketplaceChannelDb)) {
        throw new BadRequestException("Template channel mismatch.");
      }
      if (categoryId && template.categoryId !== categoryId) {
        throw new BadRequestException("Template category mismatch.");
      }
      return {
        channel,
        displayName: basePack.displayName,
        requiredFields: this.asStringArray(template.requiredFields),
        fieldMap: this.asStringMap(template.fieldMap),
        templateId: template.id,
        templateName: template.name,
        source: "saved_template",
      };
    }

    if (categoryId) {
      const defaultTemplate = await this.prisma.tenant().channelMappingTemplate.findFirst({
        where: {
          categoryId,
          channel: channel as MarketplaceChannelDb,
          isDefault: true,
        },
        orderBy: [{ updatedAt: "desc" }],
      });
      if (defaultTemplate) {
        return {
          channel,
          displayName: basePack.displayName,
          requiredFields: this.asStringArray(defaultTemplate.requiredFields),
          fieldMap: this.asStringMap(defaultTemplate.fieldMap),
          templateId: defaultTemplate.id,
          templateName: defaultTemplate.name,
          source: "saved_template",
        };
      }
    }

    return {
      ...basePack,
      requiredFields: [...basePack.requiredFields],
      fieldMap: { ...basePack.fieldMap },
      templateId: null,
      templateName: null,
      source: "system_pack",
    };
  }

  private parseChannel(channelInput: string): MarketplaceChannel {
    const normalized = String(channelInput ?? "")
      .trim()
      .toLowerCase();
    if ((MARKETPLACE_CHANNELS as readonly string[]).includes(normalized)) {
      return normalized as MarketplaceChannel;
    }
    throw new BadRequestException(
      `Unsupported channel. Allowed values: ${MARKETPLACE_CHANNELS.join(", ")}`,
    );
  }

  private async requireTemplate(templateId: string) {
    const template = await this.prisma.tenant().channelMappingTemplate.findUnique({
      where: { id: templateId },
    });
    if (!template) {
      throw new NotFoundException("Mapping template not found");
    }
    return template;
  }

  private async generateCloneTemplateName(
    categoryId: string,
    channel: MarketplaceChannelDb,
    baseName: string,
  ): Promise<string> {
    const normalizedBase = `${baseName.trim()} Copy`.trim();
    let candidate = normalizedBase;
    let suffix = 2;
    while (true) {
      const existing = await this.prisma.tenant().channelMappingTemplate.findFirst({
        where: {
          categoryId,
          channel,
          name: candidate,
        },
        select: { id: true },
      });
      if (!existing) {
        return candidate;
      }
      candidate = `${normalizedBase} ${suffix}`;
      suffix += 1;
    }
  }

  private normalizeRequiredFields(fields: string[]) {
    const normalized = fields
      .map((field) => String(field ?? "").trim())
      .filter((field) => field.length > 0);
    if (normalized.length === 0) {
      throw new BadRequestException("requiredFields cannot be empty.");
    }
    return [...new Set(normalized)];
  }

  private normalizeFieldMap(input: Record<string, string>) {
    const normalized: Record<string, string> = {};
    for (const [source, target] of Object.entries(input ?? {})) {
      const sourceKey = source.trim();
      const targetKey = String(target ?? "").trim();
      if (!sourceKey || !targetKey) {
        continue;
      }
      normalized[sourceKey] = targetKey;
    }
    if (Object.keys(normalized).length === 0) {
      throw new BadRequestException("fieldMap cannot be empty.");
    }
    return normalized;
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  private asStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val === "string") {
        const source = key.trim();
        const target = val.trim();
        if (source && target) {
          out[source] = target;
        }
      }
    }
    return out;
  }

  private normalizeFieldList(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }
    return this.uniqueStrings(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );
  }

  private buildFailureReason(missingFields: string[], complianceErrorCount: number) {
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(`Missing required fields: ${missingFields.join(", ")}`);
    }
    if (complianceErrorCount > 0) {
      parts.push(`Compliance errors: ${complianceErrorCount}`);
    }
    return parts.join(" | ") || "Export validation failed";
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.tenant().category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private uniqueStrings(values: string[]) {
    return Array.from(new Set(values));
  }

  private getFieldValue(
    fieldPath: string,
    product: {
      title: string;
      description: string;
      brand: string;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: unknown;
    },
    attributes: Record<string, unknown>,
  ) {
    if (fieldPath.startsWith("attributes.")) {
      const key = fieldPath.replace("attributes.", "");
      return attributes[key];
    }
    const direct = product as unknown as Record<string, unknown>;
    return direct[fieldPath];
  }

  private isEmpty(value: unknown) {
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  }

  private mapChannelToConnectorSlug(channel: MarketplaceChannelDb): string {
    if (channel === "amazon") {
      return "amazon-in";
    }
    return channel;
  }

  private mapConnectorSlugToChannel(slugInput: string): MarketplaceChannel {
    const slug = String(slugInput ?? "").trim().toLowerCase();
    if (slug === "amazon-in") {
      return "amazon";
    }
    if (slug === "flipkart") {
      return "flipkart";
    }
    if (slug === "meesho") {
      return "meesho";
    }
    throw new BadRequestException(`Unsupported connector slug '${slug}' for payload preview.`);
  }

  private normalizeSubmissionRow(
    row: Record<string, unknown>,
    includePayload = false,
  ): Record<string, unknown> {
    const normalized: Record<string, unknown> = {
      id: row.id,
      productId: row.productId,
      variantId: row.variantId ?? null,
      installationId: row.installationId,
      connectorSlug: row.connectorSlug,
      connectorDisplayName: row.connectorDisplayName,
      idempotencyKey: row.idempotencyKey,
      submissionType: row.submissionType,
      source: row.source,
      attemptNumber: Number(row.attemptNumber ?? 0),
      status: row.status,
      externalRef: row.externalRef ?? null,
      payloadSnapshotUrl: row.payloadSnapshotUrl ?? null,
      channelErrors: this.normalizeSubmissionIssues(row.channelErrors),
      submittedAt: row.submittedAt,
      resolvedAt: row.resolvedAt ?? null,
    };
    if (includePayload) {
      normalized.payloadSnapshot = row.payloadSnapshot ?? null;
    }
    return normalized;
  }

  private normalizeSubmissionIssues(raw: unknown): SubmissionIssue[] {
    const parsed = this.parseJsonValue(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((issue) => {
        if (!issue || typeof issue !== "object" || Array.isArray(issue)) {
          return null;
        }
        const candidate = issue as Record<string, unknown>;
        const code = String(candidate.code ?? "").trim() || "UNKNOWN_ISSUE";
        const fieldPathRaw = String(candidate.fieldPath ?? "").trim();
        const severity = String(candidate.severity ?? "error").trim().toLowerCase() === "warning"
          ? "warning"
          : "error";
        const sellerMessage = String(candidate.sellerMessage ?? candidate.message ?? "").trim();
        return {
          code,
          fieldPath: fieldPathRaw.length > 0 ? fieldPathRaw : null,
          severity,
          sellerMessage: sellerMessage.length > 0 ? sellerMessage : "Validation issue detected.",
        } satisfies SubmissionIssue;
      })
      .filter((item): item is SubmissionIssue => item !== null);
  }

  private parseJsonValue(raw: unknown): unknown {
    if (raw === null || raw === undefined) {
      return null;
    }
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (!trimmed) {
        return null;
      }
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    return raw;
  }

  private toFailureReason(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error ?? "Unknown processing error");
    const normalized = raw.trim();
    if (!normalized) {
      return "Marketplace export processing failed.";
    }
    return normalized.length > 400 ? `${normalized.slice(0, 397)}...` : normalized;
  }

  private async markJobFailedFromWorker(jobId: string, error: unknown): Promise<void> {
    const failureReason = this.toFailureReason(error);
    try {
      await this.prisma.tenant().marketplaceExportJob.updateMany({
        where: {
          id: jobId,
          status: {
            in: [ExportJobStatus.queued, ExportJobStatus.processing, ExportJobStatus.retrying],
          },
        },
        data: {
          status: ExportJobStatus.failed,
          failureReason,
          dlqReason: null,
          exportPayload: Prisma.JsonNull,
        },
      });
    } catch {
      // Never mask the original worker exception.
    }
  }

  private async recordConnectorSubmissionIfInstalled(
    job: {
      id: string;
      productId: string;
      channel: MarketplaceChannelDb;
    },
    simulation: {
      exportReady: boolean;
      mappedPayload: Record<string, unknown>;
      channelIssues: Array<{
        severity: "error" | "warning";
        code: string;
        fieldPath: string;
        sellerMessage: string;
        message: string;
      }>;
      validationSource: "local_rules" | "amazon_sp_api";
    },
  ) {
    const connectorSlug = this.mapChannelToConnectorSlug(job.channel);
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    let installation;
    try {
      installation = await this.connectorFramework.requireInstallation(tenantKey, connectorSlug);
    } catch (error) {
      if (error instanceof InstallationNotFoundError) {
        return;
      }
      throw error;
    }

    const operation = installation.capabilities.includes("PUBLISH") ? "PUBLISH" : "EXPORT_ONLY";
    const status =
      operation === "PUBLISH"
        ? simulation.exportReady
          ? "PENDING"
          : "ERROR"
        : simulation.exportReady
          ? "SUCCESS"
          : "ERROR";
    const source = simulation.validationSource === "amazon_sp_api" ? "LIVE_API" : "LOCAL_RULES";

    const submission = await this.connectorFramework.recordSubmissionAttempt({
      installation,
      productId: job.productId,
      jobId: job.id,
      operation,
      source,
      status,
      payloadSnapshot: simulation.mappedPayload,
      channelErrors: simulation.channelIssues.map((issue) => ({
        code: issue.code,
        fieldPath: issue.fieldPath,
        severity: issue.severity,
        sellerMessage: issue.sellerMessage,
      })),
    });

    await this.emitConnectorOutcomeMetrics({
      tenantKey,
      connectorSlug,
      submissionStatus: submission.status,
      attemptNumber: submission.attemptNumber,
    });
  }

  private async emitExportThroughputMetric(
    channel: MarketplaceChannelDb,
    startedAtMs: number,
    jobStatus: ExportJobStatus,
  ): Promise<void> {
    const elapsedSeconds = Math.max(0.001, (Date.now() - startedAtMs) / 1000);
    const connectorSlug = this.mapChannelToConnectorSlug(channel);
    try {
      await this.metricsService.emit({
        tenantKey: this.connectorFramework.getCurrentTenantKey(),
        connectorSlug,
        metricKey: "throughput.export_jobs_per_second",
        metricValue: Number((1 / elapsedSeconds).toFixed(4)),
        unit: "jobs_per_second",
        tags: {
          jobStatus,
          elapsedMs: Math.round(elapsedSeconds * 1000),
        },
      });
    } catch {
      // Metrics emission must not block workflow completion.
    }
  }

  private async emitConnectorOutcomeMetrics(input: {
    tenantKey: string;
    connectorSlug: string;
    submissionStatus: string;
    attemptNumber: number;
  }): Promise<void> {
    const submissionStatus = String(input.submissionStatus ?? "").toUpperCase();
    const isRejected = submissionStatus === "ERROR" || submissionStatus === "REJECTED" || submissionStatus === "SUPPRESSED";
    try {
      await this.metricsService.emit({
        tenantKey: input.tenantKey,
        connectorSlug: input.connectorSlug,
        metricKey: "submission.total",
        metricValue: 1,
        unit: "count",
        tags: {
          status: submissionStatus,
          attemptNumber: input.attemptNumber,
        },
      });
      if (isRejected) {
        await this.metricsService.emit({
          tenantKey: input.tenantKey,
          connectorSlug: input.connectorSlug,
          metricKey: "submission.rejected",
          metricValue: 1,
          unit: "count",
          tags: {
            status: submissionStatus,
            attemptNumber: input.attemptNumber,
          },
        });
      }
      await this.metricsService.emit({
        tenantKey: input.tenantKey,
        connectorSlug: input.connectorSlug,
        metricKey: "reliability.attempt_total",
        metricValue: 1,
        unit: "count",
        tags: {
          attemptNumber: input.attemptNumber,
        },
      });
      if (input.attemptNumber > 1) {
        await this.metricsService.emit({
          tenantKey: input.tenantKey,
          connectorSlug: input.connectorSlug,
          metricKey: "reliability.duplicate_prevented",
          metricValue: 1,
          unit: "count",
          tags: {
            attemptNumber: input.attemptNumber,
          },
        });
      }
    } catch {
      // Metrics emission must not block submission tracking.
    }
  }
}
