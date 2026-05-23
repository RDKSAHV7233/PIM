import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import {
  ExportJobStatus,
  Prisma,
  RuleSeverity,
  ValidationIssueStatus,
} from "@prisma/client";
import { ConnectorFrameworkService } from "../connector-framework/connector-framework.service";
import { ConnectorRegistry } from "../connector-framework/connector.registry";
import { PlanUsageService } from "../billing/plan-usage.service";
import {
  CapabilityNotSupportedError,
  CredentialExpiredError,
  InstallationNotFoundError,
} from "../connector-framework/connector.errors";
import { ProductPayload } from "../connector-framework/connector.interface";
import { ShopifyConfigResult, ShopifyProductPreview, ShopifyPublishError } from "../connectors/shopify/shopify.connector";
import { AccessPolicyService, PolicyActor } from "../common/access-policy/access-policy.service";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { LoggerService } from "../common/logging/logger.service";
import { MetricsService } from "../metrics/metrics.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { runWithTenantContext } from "../common/tenant/tenant-context";
import { tenantExecRaw, tenantRaw } from "../common/tenant/tenant-raw";
import { QueueService } from "../queue/queue.service";
import { CloneMappingTemplateDto } from "./dto/clone-mapping-template.dto";
import { CreateExportJobDto } from "./dto/create-export-job.dto";
import { ConnectorMappingService } from "./connector-mapping.service";
import { CreateMappingTemplateDto } from "./dto/create-mapping-template.dto";
import { UpdateMappingTemplateDto } from "./dto/update-mapping-template.dto";
import { buildAmazonFallbackIssues, runAmazonAuthoritativeValidation } from "../connectors/amazon/amazon-validation";
import {
  MARKETPLACE_CHANNELS,
  mapConnectorSlugToMarketplaceChannel,
  mapMarketplaceChannelToConnectorSlug,
  parseMarketplaceChannel,
  type MarketplaceChannel,
} from "./marketplace-channels";

type MappingPack = {
  channel: MarketplaceChannel;
  displayName: string;
  requiredFields: string[];
  fieldMap: Record<string, string>;
};

type EffectiveMapping = MappingPack & {
  templateId: string | null;
  templateName: string | null;
  /** How the effective mapping was resolved.
   *  "system_pack"               — hardcoded MAPPING_PACKS default (no tenant mapping found)
   *  "saved_template"            — legacy channelMappingTemplate record
   *  "connector_mapping_version" — ConnectorMappingVersion record (Sprint 11+, 5-level precedence)
   */
  source: "system_pack" | "saved_template" | "connector_mapping_version";
};

type AuthoritativeChannelIssue = {
  severity: "error" | "warning";
  code: string;
  fieldPath: string;
  sellerMessage: string;
  message: string;
};

function resolveCollectionLimit(limit?: number, fallback = 50, max = 500): number {
  if (!Number.isFinite(limit)) {
    return fallback;
  }
  const parsed = Math.floor(Number(limit));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(max, parsed));
}

function resolveStubConnectorSlugs(): Set<string> {
  return new Set(
    String(process.env.CONNECTOR_STUB_SLUGS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
}

function resolveStubMarketplaceChannels(): Set<MarketplaceChannel> {
  const stubSlugs = resolveStubConnectorSlugs();
  const channels = new Set<MarketplaceChannel>();
  for (const slug of stubSlugs) {
    const channel = mapConnectorSlugToMarketplaceChannel(slug);
    if (channel) {
      channels.add(channel);
    }
  }
  return channels;
}

type SimulationProduct = Prisma.ProductGetPayload<{
  include: {
    validationIssues: true;
  };
}>;

type MarketplaceReadinessStatus = "ready" | "warnings" | "errors" | "unknown";

type MarketplaceReadinessSummary = {
  channel: MarketplaceChannel;
  status: MarketplaceReadinessStatus;
  errorCount: number;
  warningCount: number;
};

type SubmissionFilters = {
  productId?: string;
  connectorSlug?: string;
  installationId?: string;
  status?: string;
  minAttempt?: number;
};

type SubmissionIssue = {
  code: string;
  fieldPath: string | null;
  severity: "error" | "warning";
  sellerMessage: string;
};

type ConnectorProductSource = Prisma.ProductGetPayload<{
  include: {
    category: {
      select: {
        id: true;
        name: true;
        path: true;
      };
    };
    variants: {
      orderBy: [{ updatedAt: "desc" }];
      take: 1;
    };
  };
}>;

type ConnectorWorkerPayload =
  | {
      mode?: "export-job";
      jobId: string;
      connectorSlug?: string;
    }
  | {
      mode: "status-sync";
      submissionId: string;
      connectorSlug?: string;
      attemptNumber?: number;
    }
  | {
      mode: "submission-retry";
      submissionId: string;
      connectorSlug?: string;
    };

const AUTO_STATUS_SYNC_DELAY_MS = 800;
const AUTO_STATUS_SYNC_MAX_ATTEMPTS = 3;

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
  shopify: {
    channel: "shopify",
    displayName: "Shopify",
    requiredFields: ["title", "description", "attributes.mainImageUrl"],
    fieldMap: {
      title: "title",
      description: "descriptionHtml",
      brand: "vendor",
      "attributes.productType": "productType",
      "attributes.mainImageUrl": "images.0.src",
      "attributes.sku": "variants.0.sku",
      "attributes.inventoryQty": "variants.0.inventoryQuantity",
      "attributes.color": "options.color",
      "attributes.size": "options.size",
    },
  },
};

@Injectable()
export class MarketplaceService implements OnModuleInit {
  private workerRegistered = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorFramework: ConnectorFrameworkService,
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly planUsageService: PlanUsageService,
    private readonly queueService: QueueService,
    private readonly metricsService: MetricsService,
    private readonly connectorMappingService: ConnectorMappingService,
    private readonly notificationsService: NotificationsService,
    private readonly logger: LoggerService,
    private readonly accessPolicy: AccessPolicyService,
  ) {}

  onModuleInit() {
    this.registerConnectorWorker();
  }

  listChannels() {
    const stubChannels = resolveStubMarketplaceChannels();
    return MARKETPLACE_CHANNELS.filter((channel) => !stubChannels.has(channel)).map((channel) => {
      const pack = MAPPING_PACKS[channel];
      return {
        channel,
        displayName: pack.displayName,
        requiredFields: pack.requiredFields,
      };
    });
  }

  async getChannelMapping(channelInput: string, categoryId?: string, templateId?: string, actor?: PolicyActor) {
    await this.accessPolicy.assertChannelAccess(actor ?? {}, "view", channelInput, "ChannelMappingTemplate");
    if (categoryId) {
      await this.accessPolicy.assertCategoryAccess(actor ?? {}, "view", categoryId, "ChannelMappingTemplate");
    }
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

  async listTemplates(categoryId: string, channelInput?: string, actor?: PolicyActor) {
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "view", categoryId, "ChannelMappingTemplate");
    if (channelInput) {
      await this.accessPolicy.assertChannelAccess(actor ?? {}, "view", channelInput, "ChannelMappingTemplate");
    }
    await this.requireCategory(categoryId);
    const channel = channelInput ? this.parseChannel(channelInput) : undefined;
    const ownerWhere = await this.accessPolicy.buildOwnerScopeWhere(actor ?? {}, "view", {
      resource: "ChannelMappingTemplate",
      supportedScopeTypes: ["category", "channel", "owner"],
      metadata: {
        categoryId,
        channel: channel ?? null,
      },
    });
    return this.prisma.tenant().channelMappingTemplate.findMany({
      where: {
        categoryId,
        channel,
        ...(ownerWhere ?? {}),
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
      take: 200,
    });
  }

  async createTemplate(categoryId: string, dto: CreateMappingTemplateDto, actor?: PolicyActor) {
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "edit", categoryId, "ChannelMappingTemplate");
    await this.accessPolicy.assertChannelAccess(actor ?? {}, "edit", dto.channel, "ChannelMappingTemplate");
    await this.requireCategory(categoryId);
    const channel = this.parseChannel(dto.channel);
    const requiredFields = this.normalizeRequiredFields(dto.requiredFields);
    const fieldMap = this.normalizeFieldMap(dto.fieldMap);
    const ownerWhere = await this.accessPolicy.buildOwnerScopeWhere(actor ?? {}, "create", {
      resource: "ChannelMappingTemplate",
      supportedScopeTypes: ["category", "channel", "owner"],
      metadata: {
        categoryId,
        channel,
      },
    });

    if (dto.isDefault) {
      await this.prisma.tenant().channelMappingTemplate.updateMany({
        where: { categoryId, channel, ...(ownerWhere ?? {}) },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.tenant().channelMappingTemplate.create({
        data: {
          categoryId,
          name: dto.name.trim(),
          channel,
          requiredFields: requiredFields as unknown as Prisma.JsonArray,
          fieldMap: fieldMap as unknown as Prisma.JsonObject,
          isDefault: dto.isDefault ?? false,
          createdBy: actor?.actorId?.trim() ? actor.actorId.trim() : null,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Template name already exists for this category and channel.");
      }
      throw error;
    }
  }

  async getTemplate(templateId: string, actor?: PolicyActor) {
    const template = await this.requireTemplate(templateId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "view", template.categoryId, "ChannelMappingTemplate", templateId);
    await this.accessPolicy.assertChannelAccess(actor ?? {}, "view", template.channel, "ChannelMappingTemplate", templateId);
    await this.accessPolicy.assertOwnerResourceAccess(actor ?? {}, "view", {
      resource: "ChannelMappingTemplate",
      resourceId: templateId,
      createdBy: template.createdBy,
      supportedScopeTypes: ["category", "channel", "owner"],
      metadata: {
        categoryId: template.categoryId,
        channel: template.channel,
      },
    });
    return template;
  }

  async updateTemplate(templateId: string, dto: UpdateMappingTemplateDto, actor?: PolicyActor) {
    const existing = await this.requireTemplate(templateId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "edit", existing.categoryId, "ChannelMappingTemplate", templateId);
    await this.accessPolicy.assertChannelAccess(actor ?? {}, "edit", dto.channel ?? existing.channel, "ChannelMappingTemplate", templateId);
    await this.accessPolicy.assertOwnerResourceAccess(actor ?? {}, "edit", {
      resource: "ChannelMappingTemplate",
      resourceId: templateId,
      createdBy: existing.createdBy,
      supportedScopeTypes: ["category", "channel", "owner"],
      metadata: {
        categoryId: existing.categoryId,
        channel: existing.channel,
      },
    });
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
      ? this.parseChannel(dto.channel)
      : existing.channel;
    const updatedRequiredFields = dto.requiredFields
      ? this.normalizeRequiredFields(dto.requiredFields)
      : this.asStringArray(existing.requiredFields);
    const updatedFieldMap = dto.fieldMap
      ? this.normalizeFieldMap(dto.fieldMap)
      : this.asStringMap(existing.fieldMap);
    const updatedDefault = dto.isDefault ?? existing.isDefault;
    const ownerWhere = await this.accessPolicy.buildOwnerScopeWhere(actor ?? {}, "edit", {
      resource: "ChannelMappingTemplate",
      resourceId: templateId,
      supportedScopeTypes: ["category", "channel", "owner"],
      metadata: {
        categoryId: existing.categoryId,
        channel: updatedChannel,
      },
    });

    if (updatedDefault) {
      await this.prisma.tenant().channelMappingTemplate.updateMany({
        where: {
          categoryId: existing.categoryId,
          channel: updatedChannel,
          id: { not: existing.id },
          ...(ownerWhere ?? {}),
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

  async deleteTemplate(templateId: string, actor?: PolicyActor) {
    const template = await this.requireTemplate(templateId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "delete", template.categoryId, "ChannelMappingTemplate", templateId);
    await this.accessPolicy.assertChannelAccess(actor ?? {}, "delete", template.channel, "ChannelMappingTemplate", templateId);
    await this.accessPolicy.assertOwnerResourceAccess(actor ?? {}, "delete", {
      resource: "ChannelMappingTemplate",
      resourceId: templateId,
      createdBy: template.createdBy,
      supportedScopeTypes: ["category", "channel", "owner"],
      metadata: {
        categoryId: template.categoryId,
        channel: template.channel,
      },
    });
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

  async cloneTemplate(templateId: string, dto: CloneMappingTemplateDto, actor?: PolicyActor) {
    const source = await this.requireTemplate(templateId);
    await this.accessPolicy.assertCategoryAccess(actor ?? {}, "create", source.categoryId, "ChannelMappingTemplate", templateId);
    await this.accessPolicy.assertChannelAccess(actor ?? {}, "create", source.channel, "ChannelMappingTemplate", templateId);
    await this.accessPolicy.assertOwnerResourceAccess(actor ?? {}, "create", {
      resource: "ChannelMappingTemplate",
      resourceId: templateId,
      createdBy: source.createdBy,
      supportedScopeTypes: ["category", "channel", "owner"],
      metadata: {
        categoryId: source.categoryId,
        channel: source.channel,
      },
    });
    const sourceChannel = this.parseChannel(source.channel);
    const cloneNameInput = dto.name ? dto.name.trim() : "";
    const cloneName =
      cloneNameInput.length > 0
        ? cloneNameInput
        : await this.generateCloneTemplateName(source.categoryId, sourceChannel, source.name);
    const cloneIsDefault = dto.isDefault ?? false;
    const ownerWhere = await this.accessPolicy.buildOwnerScopeWhere(actor ?? {}, "create", {
      resource: "ChannelMappingTemplate",
      resourceId: templateId,
      supportedScopeTypes: ["category", "channel", "owner"],
      metadata: {
        categoryId: source.categoryId,
        channel: sourceChannel,
      },
    });
    if (cloneIsDefault) {
      await this.prisma.tenant().channelMappingTemplate.updateMany({
        where: {
          categoryId: source.categoryId,
          channel: sourceChannel,
          ...(ownerWhere ?? {}),
        },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.tenant().channelMappingTemplate.create({
        data: {
          categoryId: source.categoryId,
          name: cloneName,
          channel: sourceChannel,
          requiredFields: source.requiredFields as Prisma.InputJsonValue,
          fieldMap: source.fieldMap as Prisma.InputJsonValue,
          isDefault: cloneIsDefault,
          isSystemPack: false,
          parentTemplateId: source.id,
          version: source.version + 1,
          createdBy: actor?.actorId?.trim() ? actor.actorId.trim() : null,
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
    const installation = await this.resolveInstallationConnectorSummary(installationId);

    const channel = channelOverride
      ? this.parseChannel(channelOverride)
      : this.mapConnectorSlugToChannel(installation.connectorSlug);
    const simulation = await this.simulateProduct(productId, channel, templateId, installationId);
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

  async createExportJob(productId: string, dto: CreateExportJobDto, actor?: PolicyActor) {
    await this.accessPolicy.assertSensitivePayloadAccessAllowed(actor ?? {}, {
      action: "marketplace.export",
      resource: "MarketplaceExportJob",
      resourceId: productId,
    });
    const product = await this.prisma.tenant().product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    if (product.status !== "approved" && product.status !== "active") {
      throw new BadRequestException(
        `Product must be approved before publishing. Current status: ${product.status}`,
      );
    }
    await this.accessPolicy.assertProductAccess(actor ?? {}, "export", {
      id: product.id,
      categoryId: product.categoryId,
      brand: product.brand,
    });

    const channel = this.parseChannel(dto.channel);
    await this.accessPolicy.assertChannelAccess(actor ?? {}, "export", channel, "MarketplaceExportJob", productId);
    const connectorSlug = this.mapChannelToConnectorSlug(channel);
    try {
      const tenantKey = this.connectorFramework.getCurrentTenantKey();
      const installation = await this.connectorFramework.requireInstallation(tenantKey, connectorSlug, dto.installationId);
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

    const simulation = await this.simulateProduct(productId, dto.channel, dto.templateId, dto.installationId ?? undefined);
    await this.connectorMappingService.assertPublishReadyForExport({
      connectorSlug,
      categoryScope: product.categoryId,
      installationId: dto.installationId ?? undefined,
      fallbackAcknowledged: dto.fallbackAcknowledged,
      productId,
    });
    const job = await this.prisma.tenant().marketplaceExportJob.create({
      data: {
        createdBy: actor?.actorId?.trim() ? actor.actorId.trim() : null,
        productId,
        categoryId: product.categoryId,
        channel: simulation.channel,
        templateId: simulation.templateId ?? null,
        installationId: dto.installationId ?? null,
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
    await this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
      jobId: job.id,
      connectorSlug: simulation.channel,
    });
    return job;
  }

  async listExportJobs(
    productId?: string,
    pagination?: CursorPaginationQuery,
    options?: {
      templateSummary?: boolean;
    },
  ) {
    const templateInclude = options?.templateSummary
      ? {
          select: {
            id: true,
            name: true,
            channel: true,
          },
        }
      : true;
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
          template: templateInclude,
          product: { select: { id: true, title: true } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const hasNext = jobs.length > limit;
      const items = hasNext ? jobs.slice(0, limit) : jobs;
      const last = items[items.length - 1];
      return {
        items: options?.templateSummary
          ? items.map((job) => ({
              ...job,
              template: job.template
                ? {
                    id: job.template.id,
                    name: job.template.name,
                    channelId: job.template.channel,
                  }
                : null,
            }))
          : items,
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
        template: templateInclude,
        product: { select: { id: true, title: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 50,
    }).then((jobs) =>
      options?.templateSummary
        ? jobs.map((job) => ({
            ...job,
            template: job.template
              ? {
                  id: job.template.id,
                  name: job.template.name,
                  channelId: job.template.channel,
                }
              : null,
          }))
        : jobs,
    );
  }

  async listSubmissions(filters?: SubmissionFilters, pagination?: CursorPaginationQuery) {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const productId = filters?.productId ? String(filters.productId).trim() : "";
    const connectorSlug = filters?.connectorSlug ? String(filters.connectorSlug).trim().toLowerCase() : "";
    const installationId = filters?.installationId ? String(filters.installationId).trim() : "";
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
    if (installationId) {
      params.push(installationId);
      clauses.push(`cs.installation_id = $${params.length}`);
    } else if (connectorSlug) {
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
      const rows = await tenantRaw<Array<Record<string, unknown>>>(
        this.prisma.tenant(tenantKey),
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
        params,
      );

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

    const limit = resolveCollectionLimit(pagination?.limit);
    params.push(limit);
    const limitParam = params.length;
    const rows = await tenantRaw<Array<Record<string, unknown>>>(
      this.prisma.tenant(tenantKey),
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
      params,
    );
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
      take: resolveCollectionLimit(pagination?.limit),
    });
  }

  async getSubmission(submissionId: string) {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const rows = await tenantRaw<Array<Record<string, unknown>>>(
      this.prisma.tenant(tenantKey),
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
      [tenantKey, submissionId],
    );
    if (rows.length === 0) {
      throw new NotFoundException("Submission not found");
    }
    return this.normalizeSubmissionRow(rows[0], true);
  }

  async getSubmissionIssues(submissionId: string) {
    const submission = await this.getSubmission(submissionId) as { channelErrors?: unknown };
    return this.normalizeSubmissionIssues(submission.channelErrors);
  }

  async syncSubmissionStatus(submissionId: string) {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const rows = await tenantRaw<Array<{
      id: string;
      productId: string;
      installationId: string;
      externalRef: string | null;
      connectorSlug: string;
    }>>(
      this.prisma.tenant(tenantKey),
      `
      SELECT
        cs.id,
        cs.product_id AS "productId",
        cs.installation_id AS "installationId",
        cs.external_ref AS "externalRef",
        cd.slug AS "connectorSlug"
      FROM connector_submissions cs
      JOIN connector_installations ci ON ci.id = cs.installation_id
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE cs.tenant_key = $1
        AND cs.id = $2
      LIMIT 1
      `,
      [tenantKey, submissionId],
    );

    const submission = rows[0];
    if (!submission) {
      throw new NotFoundException("Submission not found");
    }
    if (!submission.externalRef) {
      throw new BadRequestException("Submission cannot be synced because no external reference is stored.");
    }

    const installation = await this.connectorFramework.requireInstallation(tenantKey, submission.connectorSlug);
    const statusLookupRef = await this.buildSubmissionStatusLookupRef(
      submission.productId,
      submission.externalRef,
    );
    const update = await this.connectorFramework.syncStatus(installation, statusLookupRef);
    const normalizedErrors = update.channelErrors.map((issue) => ({
      code: issue.code,
      fieldPath: issue.fieldPath,
      severity: issue.severity,
      sellerMessage: issue.sellerMessage,
    }));

    await tenantExecRaw(
      this.prisma.tenant(tenantKey),
      `
      UPDATE connector_submissions
      SET
        status = $3,
        channel_errors = $4::jsonb,
        resolved_at = $5
      WHERE tenant_key = $1
        AND id = $2
      `,
      [tenantKey, submissionId, update.status, JSON.stringify(normalizedErrors), update.resolvedAt ?? null],
    );

    return this.getSubmission(submissionId);
  }

  private async autoSyncSubmissionStatus(submissionId: string, attemptNumber: number) {
    const submission = (await this.getSubmission(submissionId)) as {
      id: string;
      connectorSlug: string;
      status: string;
    };
    if (String(submission.status).toUpperCase() !== "PENDING") {
      return submission;
    }

    const synced = (await this.syncSubmissionStatus(submissionId)) as {
      id: string;
      connectorSlug: string;
      status: string;
    };

    if (
      String(synced.status).toUpperCase() === "PENDING" &&
      attemptNumber < AUTO_STATUS_SYNC_MAX_ATTEMPTS
    ) {
      await this.queueSubmissionStatusSync(
        submissionId,
        String(synced.connectorSlug ?? "").toLowerCase(),
        attemptNumber + 1,
      );
    }

    return synced;
  }

  async retrySubmission(submissionId: string) {
    const submission = await this.getSubmission(submissionId) as {
      idempotencyKey: string;
      connectorSlug: string;
      externalRef?: string | null;
      source?: string | null;
    };

    if (this.shouldRetryThroughLiveUpdate(submission)) {
      await this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
        mode: "submission-retry",
        submissionId,
        connectorSlug: String(submission.connectorSlug ?? "").toLowerCase(),
      } satisfies ConnectorWorkerPayload);
      return {
        queued: true,
        submissionId,
        mode: "live_update",
      };
    }

    const idempotencyKey = String(submission.idempotencyKey ?? "").trim();
    const delimiter = idempotencyKey.indexOf(":");
    if (delimiter <= 0) {
      throw new BadRequestException("Submission cannot be retried: invalid idempotency key format.");
    }
    const jobId = idempotencyKey.slice(0, delimiter);
    const requeuedJob = await this.requeueExportJob(jobId);
    await this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
      jobId,
      connectorSlug: String(submission.connectorSlug ?? "").toLowerCase(),
    });
    return {
      queued: true,
      submissionId,
      exportJob: requeuedJob,
    };
  }

  private shouldRetryThroughLiveUpdate(submission: {
    connectorSlug?: string | null;
    externalRef?: string | null;
    source?: string | null;
  }): boolean {
    const connectorSlug = String(submission.connectorSlug ?? "").trim().toLowerCase();
    if (connectorSlug !== "flipkart") {
      return false;
    }
    const externalRef = String(submission.externalRef ?? "").trim();
    if (!externalRef) {
      return false;
    }
    return String(submission.source ?? "").trim().toUpperCase() === "LIVE_API";
  }

  private async processLiveSubmissionRetry(submissionId: string) {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const submission = await this.getSubmission(submissionId) as {
      idempotencyKey: string;
      connectorSlug: string;
      installationId: string;
      productId: string;
      externalRef: string | null;
    };

    if (!this.shouldRetryThroughLiveUpdate(submission)) {
      throw new BadRequestException("Submission cannot be retried through the live connector update path.");
    }

    const idempotencyKey = String(submission.idempotencyKey ?? "").trim();
    const delimiter = idempotencyKey.indexOf(":");
    if (delimiter <= 0) {
      throw new BadRequestException("Submission cannot be retried: invalid idempotency key format.");
    }
    const jobId = idempotencyKey.slice(0, delimiter);

    const installation = await this.connectorFramework.requireInstallation(
      tenantKey,
      String(submission.connectorSlug ?? "").toLowerCase(),
      String(submission.installationId ?? "").trim() || undefined,   // P3-5: route to the correct store
    );
    const productPayload = await this.buildConnectorProductPayload(String(submission.productId));
    const payloadSnapshot = JSON.parse(JSON.stringify(productPayload)) as Record<string, unknown>;

    let recordedAttempt;
    try {
      const updateResult = await this.connectorFramework.update(
        installation,
        productPayload,
        String(submission.externalRef ?? ""),
      );
      recordedAttempt = await this.connectorFramework.recordSubmissionAttempt({
        installation,
        productId: String(submission.productId),
        jobId,
        operation: "PUBLISH",
        source: "LIVE_API",
        status: updateResult.status,
        externalRef: updateResult.externalRef,
        payloadSnapshot,
        channelErrors: [],
      });

      if (
        updateResult.status === "PENDING" &&
        updateResult.isAsync &&
        installation.capabilities.includes("STATUS_SYNC")
      ) {
        await this.queueSubmissionStatusSync(recordedAttempt.id, installation.slug, 1);
      }
    } catch (error) {
      recordedAttempt = await this.connectorFramework.recordSubmissionAttempt({
        installation,
        productId: String(submission.productId),
        jobId,
        operation: "PUBLISH",
        source: "LIVE_API",
        status: "ERROR",
        payloadSnapshot,
        channelErrors: [
          {
            code: "CONNECTOR_UPDATE_FAILED",
            fieldPath: "",
            severity: "error",
            sellerMessage: this.toFailureReason(error),
          },
        ],
      });
      await this.emitConnectorOutcomeMetrics({
        tenantKey,
        connectorSlug: installation.slug,
        submissionStatus: recordedAttempt.status,
        attemptNumber: recordedAttempt.attemptNumber,
      });
      throw error;
    }

    await this.emitConnectorOutcomeMetrics({
      tenantKey,
      connectorSlug: installation.slug,
      submissionStatus: recordedAttempt.status,
      attemptNumber: recordedAttempt.attemptNumber,
    });

    return this.getSubmission(recordedAttempt.id);
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

    const commercialProfile = await this.planUsageService.getTenantPlanProfile(existing.tenantKey);
    if (commercialProfile.accessStatus === "suspended") {
      const updated = await this.prisma.tenant().marketplaceExportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.skipped,
          failureReason: "tenant_suspended",
          dlqReason: null,
          exportPayload: Prisma.JsonNull,
        },
        include: { template: true },
      });
      await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
      return updated;
    }

    await this.prisma.tenant().marketplaceExportJob.update({
      where: { id: jobId },
      data: { status: ExportJobStatus.processing },
    });

    // P3-4: declare before try so the catch path can also write sync state for legacy jobs
    let effectiveInstallationId: string | null = existing.installationId ?? null;

    try {
      const simulation = await this.simulateProduct(
        existing.productId,
        existing.channel,
        existing.templateId ?? undefined,
        existing.installationId ?? undefined,  // bridge: ConnectorMappingVersion 5-level lookup
      );
      // P3-4: update with resolved installationId in case job.installationId was null
      const resolvedInstallationId = await this.recordConnectorSubmissionIfInstalled(existing, simulation);
      effectiveInstallationId = existing.installationId ?? resolvedInstallationId ?? null;

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
        // Update per-installation sync state so delta sync doesn't re-queue this product
        await this.persistSyncStateForProduct(effectiveInstallationId, existing.productId, "SUCCESS");
        await this.notificationsService.emitPublishStatus(updated.id, "completed");
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
        await this.notificationsService.emitPublishStatus(updated.id, "dead_letter");
        await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
        // P0-1 + P3-4: record ERROR sync state so delta sync doesn't re-queue this product on every run
        await this.persistSyncStateForProduct(effectiveInstallationId, existing.productId, "ERROR");
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
      await this.notificationsService.emitPublishStatus(updated.id, "failed");
      await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
      // P0-1 + P3-4: record ERROR sync state so delta sync doesn't re-queue on every subsequent run
      await this.persistSyncStateForProduct(effectiveInstallationId, existing.productId, "ERROR");
      return updated;
    }
  }

  private registerConnectorWorker() {
    if (this.workerRegistered) {
      return;
    }
    this.workerRegistered = true;

    this.queueService.processScheduledSync(async (payload: unknown) => {
      const p = payload as { tenantKey?: string; installationId?: string };
      const tenantKey = String(p?.tenantKey ?? "").trim();
      const installationId = String(p?.installationId ?? "").trim();
      if (!tenantKey || !installationId) return;
      await runWithTenantContext(tenantKey, async () => {
        await this.queueDeltaSync(installationId).catch((err: unknown) => {
          this.logger.warn("Scheduled delta sync failed", { installationId, error: String(err) });
        });
      });
    });

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
          // Amazon SP-API throttles aggressively; keep it strictly single-flight.
          amazon: {
            concurrency: 1,
            minIntervalMs: 1_100,
          },
          // Flipkart tolerates a small amount of parallel publish work without saturating tenant lanes.
          flipkart: {
            concurrency: 2,
            minIntervalMs: 300,
          },
          // Meesho is the least restrictive current connector; allow up to three concurrent jobs per lane.
          meesho: {
            concurrency: 3,
            minIntervalMs: 300,
          },
        },
        onCircuitOpen: (event) => {
          this.logger.warn("Connector worker circuit opened", { ...event });
        },
      },
      async (payload: unknown) => {
        const lanePayload = payload as ConnectorWorkerPayload;
        if (lanePayload.mode === "status-sync") {
          const submissionId = String(lanePayload.submissionId ?? "").trim();
          if (!submissionId) {
            return;
          }
          await this.autoSyncSubmissionStatus(
            submissionId,
            Math.max(1, Number(lanePayload.attemptNumber ?? 1)),
          );
          return;
        }

        if (lanePayload.mode === "submission-retry") {
          const submissionId = String(lanePayload.submissionId ?? "").trim();
          if (!submissionId) {
            return;
          }
          await this.processLiveSubmissionRetry(submissionId);
          return;
        }

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

  async simulateProduct(productId: string, channelInput: string, templateId?: string, installationId?: string | null) {
    const product = await this.getProductForSimulation(productId);
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return this.buildSimulationFromProduct(product, channelInput, templateId, undefined, installationId);
  }

  async getBatchReadiness(productIdsInput: string[], channelsInput?: string[]) {
    const productIds = this.uniqueStrings(productIdsInput).slice(0, 250);
    if (productIds.length === 0) {
      throw new BadRequestException("At least one productId is required.");
    }

    const channels = this.resolveBatchChannels(channelsInput);
    const products = await this.getProductsForSimulation(productIds);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const mappingCache = new Map<string, EffectiveMapping>();
    const categoryChannelPairs = this.collectBatchReadinessPairs(products, channels);
    const maxConcurrentTasks = 12;
    const channelTaskConcurrency = 3;
    const tasks: Array<() => Promise<{ productId: string; readiness: MarketplaceReadinessSummary[] }>> = [];

    await this.runWithConcurrency(
      categoryChannelPairs.map((pair) => async () => {
        await this.getEffectiveMappingCached(pair.channel, pair.categoryId, undefined, mappingCache);
      }),
      channelTaskConcurrency,
    );

    for (const productId of productIds) {
      tasks.push(async () => {
        const product = productsById.get(productId);
        if (!product) {
          return {
            productId,
            readiness: channels.map((channel) => ({
              channel,
              status: "unknown" as const,
              errorCount: 0,
              warningCount: 0,
            })),
          };
        }

        const readiness = await this.runWithConcurrency(
          channels.map((channel) => async () => {
            try {
              const simulation = await this.buildSimulationFromProduct(
                product,
                channel,
                undefined,
                mappingCache,
              );
              return this.summarizeReadiness(channel, simulation);
            } catch {
              return {
                channel,
                status: "unknown" as const,
                errorCount: 0,
                warningCount: 0,
                };
              }
          }),
          channelTaskConcurrency,
        );

        return { productId, readiness };
      });
    }

    const items = await this.runWithConcurrency(tasks, maxConcurrentTasks);
    return { items };
  }

  private collectBatchReadinessPairs(
    products: SimulationProduct[],
    channels: MarketplaceChannel[],
  ): Array<{ categoryId: string; channel: MarketplaceChannel }> {
    const pairs = new Map<string, { categoryId: string; channel: MarketplaceChannel }>();
    for (const product of products) {
      for (const channel of channels) {
        const key = `${product.categoryId}::${channel}`;
        if (!pairs.has(key)) {
          pairs.set(key, { categoryId: product.categoryId, channel });
        }
      }
    }
    return Array.from(pairs.values());
  }

  private async getProductForSimulation(productId: string) {
    return this.prisma.tenant().product.findUnique({
      where: { id: productId },
      include: {
        validationIssues: {
          where: { status: ValidationIssueStatus.open },
          orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
          take: 100,
        },
      },
    });
  }

  private async getProductsForSimulation(productIds: string[]) {
    return this.prisma.tenant().product.findMany({
      where: { id: { in: productIds } },
      include: {
        validationIssues: {
          where: { status: ValidationIssueStatus.open },
          orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
          take: 100,
        },
      },
    });
  }

  private resolveBatchChannels(channelsInput?: string[]): MarketplaceChannel[] {
    const requested = Array.isArray(channelsInput) ? channelsInput : [];
    const stubChannels = resolveStubMarketplaceChannels();
    const allowedChannels = MARKETPLACE_CHANNELS.filter((channel) => !stubChannels.has(channel));
    if (requested.length === 0) {
      return [...allowedChannels];
    }

    const normalized = this.uniqueStrings(requested)
      .map((channelInput) => this.parseChannel(channelInput))
      .filter((channel) => !stubChannels.has(channel));
    return normalized.length > 0 ? normalized : [...allowedChannels];
  }

  private summarizeReadiness(
    channel: MarketplaceChannel,
    simulation: Awaited<ReturnType<MarketplaceService["buildSimulationFromProduct"]>>,
  ): MarketplaceReadinessSummary {
    const channelErrorCount = simulation.channelIssues.filter((issue) => issue.severity === "error").length;
    const channelWarningCount = simulation.channelIssues.filter((issue) => issue.severity === "warning").length;
    const errorCount =
      simulation.missingFields.length + simulation.complianceSummary.errorCount + channelErrorCount;
    const warningCount = simulation.complianceSummary.warningCount + channelWarningCount;
    const status: MarketplaceReadinessStatus =
      errorCount > 0 ? "errors" : warningCount > 0 ? "warnings" : "ready";

    return {
      channel,
      status,
      errorCount,
      warningCount,
    };
  }

  private async buildSimulationFromProduct(
    product: SimulationProduct,
    channelInput: string,
    templateId?: string,
    mappingCache?: Map<string, EffectiveMapping>,
    installationId?: string | null,
  ) {
    const mapping = await this.getEffectiveMappingCached(
      channelInput,
      product.categoryId,
      templateId,
      mappingCache,
      installationId,
    );
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
      const amazonValidation = await runAmazonAuthoritativeValidation({
        productId: product.id,
        displayName: mapping.displayName,
        requiredFields: mapping.requiredFields,
        fallbackMissingFields: localMissingFields,
        fallbackIssues: buildAmazonFallbackIssues(mapping.displayName, localMissingFields),
        mappedPayload,
      });
      if (amazonValidation) {
        validationWarnings = amazonValidation.warningMessages;
        missingFields = amazonValidation.missingFields;
        channelIssues = amazonValidation.issues.map((issue) => ({
          ...issue,
          message: issue.sellerMessage,
        }));
        if (amazonValidation.source === "LIVE_API") {
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
      productId: product.id,
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

  private async getEffectiveMapping(
    channelInput: string,
    categoryId?: string,
    templateId?: string,
    installationId?: string | null,
  ): Promise<EffectiveMapping> {
    const channel = this.parseChannel(channelInput);
    const basePack = MAPPING_PACKS[channel];

    // Explicit templateId always wins — legacy template pinning.
    if (templateId) {
      const template = await this.prisma.tenant().channelMappingTemplate.findUnique({
        where: { id: templateId },
      });
      if (!template) {
        throw new NotFoundException("Mapping template not found");
      }
      if (template.channel !== channel) {
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

    // Legacy channelMappingTemplate default (category-scoped) — checked next.
    if (categoryId) {
      const defaultTemplate = await this.prisma.tenant().channelMappingTemplate.findFirst({
        where: {
          categoryId,
          channel,
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

    // ── Bridge: ConnectorMappingVersion fallback (Sprint 11+) ────────────────
    // Tenants that manage mappings through ConnectorMappingVersion (5-level precedence)
    // have no channelMappingTemplate records. Without this fallback, their simulation
    // always returns source:"system_pack", exportReady:false inside the job worker, even
    // though evaluateMappingPreflight/evaluatePublishReadiness correctly resolved
    // ConnectorMappingVersion. This fallback bridges the two systems so a single mapping
    // system is sufficient.
    //
    // Priority order within this fallback: same 5-level precedence as resolveEffectiveMapping.
    // Required fields are taken from the system pack baseline (ConnectorMappingVersion does
    // not separately track required fields; channel-specific requirements live in basePack).
    if (categoryId) {
      try {
        const connectorSlug = mapMarketplaceChannelToConnectorSlug(channel);
        if (connectorSlug) {
          const resolved = await this.connectorMappingService.resolveEffectiveMapping({
            connectorSlug,
            categoryScope: categoryId,
            installationId: installationId ?? null,
          });
          const rawFieldMappings = resolved.resolvedMapping?.field_mappings;
          if (
            rawFieldMappings &&
            typeof rawFieldMappings === "object" &&
            !Array.isArray(rawFieldMappings) &&
            Object.keys(rawFieldMappings).length > 0
          ) {
            return {
              channel,
              displayName: basePack.displayName,
              requiredFields: [...basePack.requiredFields],
              fieldMap: rawFieldMappings as Record<string, string>,
              templateId: null,
              templateName: null,
              source: "connector_mapping_version",
            };
          }
        }
      } catch {
        // ConnectorMappingVersion lookup failed — fall through to system pack.
        // Never let a bridge failure block an existing channelMappingTemplate user.
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

  private async getEffectiveMappingCached(
    channelInput: string,
    categoryId?: string,
    templateId?: string,
    cache?: Map<string, EffectiveMapping>,
    installationId?: string | null,
  ): Promise<EffectiveMapping> {
    if (!cache) {
      return this.getEffectiveMapping(channelInput, categoryId, templateId, installationId);
    }

    // installationId is part of the cache key so installation-scoped mappings don't
    // bleed into slug-scoped lookups within the same batch request.
    const key = `${String(channelInput ?? "").trim().toLowerCase()}::${categoryId ?? ""}::${templateId ?? ""}::${installationId ?? ""}`;
    const cached = cache.get(key);
    if (cached) {
      return {
        ...cached,
        requiredFields: [...cached.requiredFields],
        fieldMap: { ...cached.fieldMap },
      };
    }

    const resolved = await this.getEffectiveMapping(channelInput, categoryId, templateId, installationId);
    cache.set(key, resolved);
    return {
      ...resolved,
      requiredFields: [...resolved.requiredFields],
      fieldMap: { ...resolved.fieldMap },
    };
  }

  private async runWithConcurrency<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
    const results = new Array<T>(tasks.length);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < tasks.length) {
        const current = nextIndex;
        nextIndex += 1;
        results[current] = await tasks[current]();
      }
    };

    const workerCount = Math.min(Math.max(concurrency, 1), tasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return results;
  }

  private parseChannel(channelInput: string): MarketplaceChannel {
    return parseMarketplaceChannel(channelInput);
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
    channel: MarketplaceChannel,
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

  private mapChannelToConnectorSlug(channel: string): string {
    return mapMarketplaceChannelToConnectorSlug(channel);
  }

  private mapConnectorSlugToChannel(slugInput: string): MarketplaceChannel {
    const channel = mapConnectorSlugToMarketplaceChannel(slugInput);
    if (channel) {
      return channel;
    }
    const slug = String(slugInput ?? "").trim().toLowerCase();
    throw new BadRequestException(`Unsupported connector slug '${slug}' for payload preview.`);
  }

  private async resolveInstallationConnectorSummary(installationId: string): Promise<{
    id: string;
    connectorSlug: string;
    connectorDisplayName: string;
  }> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const rows = await tenantRaw<Array<{
      id: string;
      connectorSlug: string;
      connectorDisplayName: string;
    }>>(
      this.prisma.tenant(tenantKey),
      `
      SELECT
        ci.id,
        cd.slug AS "connectorSlug",
        cd.display_name AS "connectorDisplayName"
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.id = $1
        AND ci.tenant_key = $2
      LIMIT 1
      `,
      [installationId, tenantKey],
    );

    const installation = rows[0];
    if (!installation) {
      throw new NotFoundException("Connector installation not found.");
    }
    return {
      id: installation.id,
      connectorSlug: installation.connectorSlug,
      connectorDisplayName: installation.connectorDisplayName,
    };
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

  private parseLocaleTranslations(raw: unknown): Array<{
    locale: string;
    fieldMappings: { title?: string; descriptionHtml?: string; seoTitle?: string; seoDescription?: string };
  }> {
    const parsed = this.parseJsonValue(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
      .map((item) => {
        const locale = String(item.locale ?? "").trim();
        const fm = (item.fieldMappings && typeof item.fieldMappings === "object" && !Array.isArray(item.fieldMappings))
          ? item.fieldMappings as Record<string, unknown>
          : {};
        return {
          locale,
          fieldMappings: {
            title: typeof fm.title === "string" ? fm.title : undefined,
            descriptionHtml: typeof fm.descriptionHtml === "string" ? fm.descriptionHtml : undefined,
            seoTitle: typeof fm.seoTitle === "string" ? fm.seoTitle : undefined,
            seoDescription: typeof fm.seoDescription === "string" ? fm.seoDescription : undefined,
          },
        };
      })
      .filter((item) => Boolean(item.locale));
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

  // Returns the resolved installationId so the caller can write sync state even when
  // job.installationId is null (legacy jobs created before the column was added). (P3-4)
  private async recordConnectorSubmissionIfInstalled(
    job: {
      id: string;
      productId: string;
      channel: string;
      installationId?: string | null;
      categoryId?: string | null;
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
  ): Promise<string | null> {
    const connectorSlug = this.mapChannelToConnectorSlug(job.channel);
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    let installation;
    try {
      installation = await this.connectorFramework.requireInstallation(
        tenantKey,
        connectorSlug,
        job.installationId ?? undefined,
      );
    } catch (error) {
      if (error instanceof InstallationNotFoundError) {
        return null;
      }
      throw error;
    }

    const operation = installation.capabilities.includes("PUBLISH") ? "PUBLISH" : "EXPORT_ONLY";
    const source = simulation.validationSource === "amazon_sp_api" ? "LIVE_API" : "LOCAL_RULES";

    let submission;
    if (operation === "PUBLISH" && simulation.exportReady) {
      try {
        const productPayload = await this.buildConnectorProductPayload(job.productId);
        const publishResult = await this.connectorFramework.publish(installation, productPayload);

        // ─── Sprint 14: locale translations (best-effort, warnings only) ─────────
        const localeWarnings: { code: string; fieldPath: string; severity: "warning"; sellerMessage: string }[] = [];
        if (connectorSlug === "shopify" && publishResult.externalRef && job.categoryId) {
          try {
            const resolvedLocale = await this.connectorMappingService.resolveEffectiveMapping({
              connectorSlug: "shopify",
              categoryScope: job.categoryId,
              installationId: installation.id,
            });
            const localeTranslations = this.parseLocaleTranslations(resolvedLocale.resolvedMapping.localeTranslations);
            if (localeTranslations.length > 0) {
              const connector = this.connectorRegistry.getConnector("shopify") as unknown as {
                registerTranslations: (
                  ctx: unknown,
                  productGid: string,
                  localeTranslations: unknown[],
                  product: { title: string; description: string; seoTitle?: string; seoDescription?: string },
                ) => Promise<string[]>;
              };
              const ctx = {
                tenantId: tenantKey,
                installationId: installation.id,
                connectorId: installation.connectorId,
                getAccessToken: async () => "",
              };
              const warnings = await connector.registerTranslations(
                ctx,
                publishResult.externalRef,
                localeTranslations,
                {
                  title: productPayload.title,
                  description: productPayload.description,
                  seoTitle: productPayload.seoTitle,
                  seoDescription: productPayload.seoDescription,
                },
              );
              for (const warning of warnings) {
                localeWarnings.push({ code: "LOCALE_TRANSLATION_FAILED", fieldPath: "", severity: "warning", sellerMessage: warning });
              }
            }
          } catch {
            // Translation errors never block the submission — base publish is committed.
          }
        }
        // ─── Sprint 14 end ───────────────────────────────────────────────────────

        submission = await this.connectorFramework.recordSubmissionAttempt({
          installation,
          productId: job.productId,
          jobId: job.id,
          operation,
          source: "LIVE_API",
          status: publishResult.status,
          externalRef: publishResult.externalRef,
          payloadSnapshot: simulation.mappedPayload,
          channelErrors: [
            ...simulation.channelIssues.map((issue) => ({
              code: issue.code,
              fieldPath: issue.fieldPath,
              severity: issue.severity,
              sellerMessage: issue.sellerMessage,
            })),
            ...localeWarnings,
          ],
        });
        if (
          publishResult.status === "PENDING" &&
          publishResult.isAsync &&
          installation.capabilities.includes("STATUS_SYNC")
        ) {
          await this.queueSubmissionStatusSync(submission.id, connectorSlug, 1);
        }
      } catch (error) {
        // ShopifyPublishError carries parsed ConnectorIssue[] with real fieldPaths.
        // Generic errors fall back to a single CONNECTOR_PUBLISH_FAILED issue.
        const channelErrors =
          error instanceof ShopifyPublishError && error.issues.length > 0
            ? error.issues.map((issue) => ({
                code: issue.code,
                fieldPath: issue.fieldPath,
                severity: issue.severity,
                sellerMessage: issue.sellerMessage,
              }))
            : [
                {
                  code: "CONNECTOR_PUBLISH_FAILED",
                  fieldPath: "",
                  severity: "error" as const,
                  sellerMessage: this.toFailureReason(error),
                },
              ];
        submission = await this.connectorFramework.recordSubmissionAttempt({
          installation,
          productId: job.productId,
          jobId: job.id,
          operation,
          source: "LIVE_API",
          status: "ERROR",
          payloadSnapshot: simulation.mappedPayload,
          channelErrors,
        });
        await this.emitConnectorOutcomeMetrics({
          tenantKey,
          connectorSlug,
          submissionStatus: submission.status,
          attemptNumber: submission.attemptNumber,
        });
        throw error;
      }
    } else {
      const status =
        operation === "PUBLISH"
          ? simulation.exportReady
            ? "PENDING"
            : "ERROR"
          : simulation.exportReady
            ? "SUCCESS"
            : "ERROR";
      submission = await this.connectorFramework.recordSubmissionAttempt({
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
    }

    await this.emitConnectorOutcomeMetrics({
      tenantKey,
      connectorSlug,
      submissionStatus: submission.status,
      attemptNumber: submission.attemptNumber,
    });
    return installation.id;
  }

  private async buildConnectorProductPayload(productId: string): Promise<ProductPayload> {
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            path: true,
          },
        },
        variants: {
          orderBy: [{ updatedAt: "desc" }],
        },
      },
    });
    if (!product) {
      throw new NotFoundException("Product not found for connector submission.");
    }

    const attributes = this.asRecord(product.attributes);
    const pricing = this.asRecord(attributes.pricing);
    const primaryVariant = product.variants[0] ?? null;
    const primaryVariantAttributes = this.asRecord(primaryVariant?.attributes);
    const sku = this.firstNonEmptyString(
      primaryVariant?.skuCode,
      attributes.sku,
      product.id,
    );
    const mrp = this.firstNumber(
      primaryVariant?.mrp,
      pricing.mrp,
      attributes.mrp,
      attributes.price,
    );
    const sellingPrice = this.firstNumber(
      primaryVariant?.sellingPrice,
      pricing.sellingPrice,
      attributes.sellingPrice,
      attributes.selling_price,
      mrp,
    );
    const mainImageUrl = await this.resolveConnectorImageUrl(product.id, attributes);
    const productType = this.firstNonEmptyString(
      attributes.productType,
      attributes.flipkartProductType,
      product.category.path,
      product.category.name,
      "general",
    );

    const rawVariants = product.variants.map((v) => {
      const va = this.asRecord(v.attributes);
      const vMrp = this.firstNumber(v.mrp, pricing.mrp, attributes.mrp, attributes.price);
      const vPrice = this.firstNumber(v.sellingPrice, pricing.sellingPrice, attributes.sellingPrice, vMrp);
      return {
        sku: String(v.skuCode ?? "").trim() || String(attributes.sku ?? "").trim() || productId,
        sellingPrice: vPrice,
        mrp: vMrp,
        barcode: this.firstNonEmptyString(va.barcode, va.ean, va.upc) || undefined,
        weight: this.firstPositiveNumber(va.weight, attributes.weight) || undefined,
        weightUnit: (this.firstNonEmptyString(va.weightUnit, attributes.weightUnit) as "KILOGRAMS" | "GRAMS" | "POUNDS" | "OUNCES" | undefined) || "KILOGRAMS",
        taxable: typeof va.taxable === "boolean" ? va.taxable : true,
        inventoryPolicy: (this.firstNonEmptyString(va.inventoryPolicy, attributes.inventoryPolicy) as "CONTINUE" | "DENY" | undefined) || "CONTINUE",
        attributes: va,
      };
    });

    // Detect which attribute keys differ across variants — those become Shopify option dimensions.
    // Convention: attribute key = option name, attribute value = option value (e.g. color → Red).
    const allAttrKeys = new Set(rawVariants.flatMap((v) => Object.keys(v.attributes)));
    const optionKeys = [...allAttrKeys].filter((key) => {
      const values = new Set(rawVariants.map((v) => String(v.attributes[key] ?? "")));
      return values.size > 1;
    });

    const variants: import("../connector-framework/connector.interface").ProductVariantPayload[] = rawVariants.map((v) => ({
      ...v,
      options: optionKeys.length > 0
        ? optionKeys.map((key) => ({ optionName: key, name: String(v.attributes[key] ?? "").trim() || "Default" }))
        : undefined,
    }));

    const seoTitle = this.firstNonEmptyString(attributes.seoTitle, attributes.seo_title) || undefined;
    const seoDescription = this.firstNonEmptyString(attributes.seoDescription, attributes.seo_description) || undefined;
    const rawTags = attributes.tags;
    const tags = Array.isArray(rawTags)
      ? (rawTags as unknown[]).map((t) => String(t ?? "").trim()).filter(Boolean)
      : typeof rawTags === "string" && rawTags.trim()
        ? rawTags.split(",").map((t) => t.trim()).filter(Boolean)
        : undefined;
    const statusRaw = this.firstNonEmptyString(attributes.status);
    const status = statusRaw === "DRAFT" ? ("DRAFT" as const) : ("ACTIVE" as const);

    const bulletPoints = Array.isArray(attributes.bulletPoints)
      ? (attributes.bulletPoints as unknown[]).map((b) => String(b ?? "").trim()).filter(Boolean)
      : undefined;

    const additionalImageUrls = Array.isArray(attributes.additionalImageUrls)
      ? (attributes.additionalImageUrls as unknown[]).map((u) => String(u ?? "").trim()).filter(Boolean)
      : undefined;

    const asin = this.firstNonEmptyString(attributes.asin) || undefined;

    const rawCondition = this.firstNonEmptyString(attributes.condition);
    const condition =
      rawCondition === "used" || rawCondition === "refurbished"
        ? (rawCondition as "used" | "refurbished")
        : rawCondition === "new"
          ? ("new" as const)
          : undefined;

    const countryOfOrigin = this.firstNonEmptyString(attributes.countryOfOrigin, attributes.country_of_origin) || undefined;
    const parentSku = this.firstNonEmptyString(attributes.parentSku, attributes.parent_sku) || undefined;
    const variationTheme = this.firstNonEmptyString(attributes.variationTheme, attributes.variation_theme) || undefined;

    return {
      sku,
      title: this.firstNonEmptyString(product.title),
      description: this.firstNonEmptyString(product.description),
      brand: this.firstNonEmptyString(product.brand),
      hsnCode: this.firstNonEmptyString(product.hsnCode),
      gstRate: this.firstNumber(product.gstRate),
      mrp,
      sellingPrice,
      mainImageUrl,
      ...(bulletPoints && bulletPoints.length > 0 ? { bulletPoints } : {}),
      ...(additionalImageUrls && additionalImageUrls.length > 0 ? { additionalImageUrls } : {}),
      ...(asin ? { asin } : {}),
      ...(condition ? { condition } : {}),
      ...(countryOfOrigin ? { countryOfOrigin } : {}),
      ...(parentSku ? { parentSku } : {}),
      ...(variationTheme ? { variationTheme } : {}),
      attributes: {
        ...attributes,
        ...primaryVariantAttributes,
        ...(primaryVariant ? { inventoryQty: primaryVariant.inventoryQty } : {}),
      },
      productType,
      variants: variants.length > 0 ? variants : undefined,
      seoTitle,
      seoDescription,
      tags: tags && tags.length > 0 ? tags : undefined,
      status,
    };
  }

  private async buildSubmissionStatusLookupRef(productId: string, externalRef: string): Promise<string> {
    const sku = await this.resolveProductSku(productId);
    return sku ? `${externalRef}::${sku}` : externalRef;
  }

  private async resolveProductSku(productId: string): Promise<string> {
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      include: {
        variants: {
          orderBy: [{ updatedAt: "desc" }],
          take: 1,
        },
      },
    });
    if (!product) {
      return "";
    }
    const attributes = this.asRecord(product.attributes);
    return this.firstNonEmptyString(product.variants[0]?.skuCode, attributes.sku, product.id);
  }

  private async resolveConnectorImageUrl(
    productId: string,
    attributes: Record<string, unknown>,
  ): Promise<string> {
    const attributeUrl = this.firstNonEmptyString(
      attributes.mainImageUrl,
      attributes.primaryImageUrl,
      attributes.imageUrl,
      attributes.image_url,
    );
    if (attributeUrl.startsWith("https://")) {
      return attributeUrl;
    }

    const asset = await this.prisma.tenant().mediaAsset.findFirst({
      where: { productId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { storagePath: true },
    });
    const storagePath = String(asset?.storagePath ?? "").trim();
    const publicBase = String(process.env.R2_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
    if (!storagePath) {
      return "";
    }
    if (!publicBase) {
      this.logger.warn("R2_PUBLIC_URL is not configured; media asset image URL cannot be resolved for connector payload.", {
        productId,
      });
      return "";
    }
    return `${publicBase}/${storagePath.replace(/^\/+/, "").replace(/\\/g, "/")}`;
  }

  private firstNonEmptyString(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return "";
  }

  private firstNumber(...values: unknown[]): number {
    for (const value of values) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return 0;
  }

  private firstPositiveNumber(...values: unknown[]): number {
    const n = this.firstNumber(...values);
    return n > 0 ? n : 0;
  }

  private async emitExportThroughputMetric(
    channel: string,
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

  private async queueSubmissionStatusSync(
    submissionId: string,
    connectorSlug: string,
    attemptNumber: number,
  ) {
    await this.queueService.enqueue(
      QUEUE_NAMES.CONNECTOR_SUBMISSION,
      {
        mode: "status-sync",
        submissionId,
        connectorSlug,
        attemptNumber,
      } satisfies ConnectorWorkerPayload,
      { delayMs: AUTO_STATUS_SYNC_DELAY_MS },
    );
  }

  async getRecoveryGroups(installationId: string) {
    const submissions = await this.prisma.tenant().connectorSubmission.findMany({
      where: { installationId, status: "FAILED" },
      select: {
        productId: true,
        channelErrors: true,
        submittedAt: true,
      },
      orderBy: { submittedAt: "desc" },
      take: 1_000,
    });

    const groupMap = new Map<string, { affectedCount: number; exampleMessage: string; productIds: string[] }>();
    for (const sub of submissions) {
      const errors = Array.isArray(sub.channelErrors) ? sub.channelErrors : [];
      const firstError = errors[0] as Record<string, unknown> | undefined;
      const family = String(firstError?.code ?? "UNKNOWN_ERROR").trim() || "UNKNOWN_ERROR";
      const message = String(firstError?.sellerMessage ?? firstError?.message ?? "Unknown error").trim();
      const existing = groupMap.get(family);
      if (existing) {
        if (!existing.productIds.includes(sub.productId)) {
          existing.productIds.push(sub.productId);
          existing.affectedCount = existing.productIds.length;
        }
      } else {
        groupMap.set(family, { affectedCount: 1, exampleMessage: message, productIds: [sub.productId] });
      }
    }

    return Array.from(groupMap.entries()).map(([errorFamily, data]) => ({
      errorFamily,
      affectedCount: data.affectedCount,
      exampleMessage: data.exampleMessage,
      productIds: data.productIds,
    }));
  }

  async retryRecoveryGroup(installationId: string, errorFamily: string, actor?: PolicyActor) {
    if (String(errorFamily).length > 100) {
      throw new BadRequestException("errorFamily must not exceed 100 characters.");
    }
    const db = this.prisma.tenant();
    const installation = await db.connectorInstallation.findFirst({
      where: { id: installationId },
      select: { id: true, connectorId: true, tenantKey: true },
    });
    if (!installation) {
      throw new NotFoundException("Connector installation not found.");
    }

    const connectorDef = await db.connectorDefinition.findUnique({
      where: { id: installation.connectorId },
      select: { slug: true },
    });
    const connectorSlug = connectorDef?.slug ?? "shopify";
    const channel = this.mapConnectorSlugToChannel(connectorSlug);

    const failed = await db.connectorSubmission.findMany({
      where: { installationId, status: "FAILED" },
      select: { productId: true, channelErrors: true },
      take: 500,
    });

    const eligible = failed.filter((sub) => {
      const errors = Array.isArray(sub.channelErrors) ? sub.channelErrors : [];
      const firstError = errors[0] as Record<string, unknown> | undefined;
      const family = String(firstError?.code ?? "UNKNOWN_ERROR").trim() || "UNKNOWN_ERROR";
      return family === errorFamily;
    });

    const uniqueProductIds = [...new Set(eligible.map((s) => s.productId))];

    // Batch-fetch categoryIds to avoid one findUnique per product in the loop below.
    const productRows = await db.product.findMany({
      where: { id: { in: uniqueProductIds } },
      select: { id: true, categoryId: true },
      take: 500, // uniqueProductIds is at most 500 (bounded by the failed submission take above)
    });
    const categoryById = new Map(productRows.map((p) => [p.id, p.categoryId]));

    let queued = 0;
    for (const productId of uniqueProductIds) {
      try {
        const categoryId = categoryById.get(productId);
        if (!categoryId) continue;
        const job = await db.marketplaceExportJob.create({
          data: {
            createdBy: actor?.actorId?.trim() ? actor.actorId.trim() : null,
            productId,
            categoryId,
            channel,
            status: ExportJobStatus.queued,
            retryCount: 0,
            maxRetries: 3,
            payload: {} as Prisma.JsonObject,
          },
        });
        await this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
          jobId: job.id,
          connectorSlug,
        } satisfies ConnectorWorkerPayload);
        queued++;
      } catch {
        // Skip individual product failures; best-effort bulk retry
      }
    }

    return { queued };
  }

  async previewProductChanges(installationId: string, productId: string): Promise<ShopifyProductPreview> {
    const db = this.prisma.tenant();
    const installation = await db.connectorInstallation.findFirst({
      where: { id: installationId },
      select: { id: true, connectorId: true, tenantKey: true, externalAccountRef: true, metadata: true },
    });
    if (!installation) {
      throw new NotFoundException("Connector installation not found.");
    }

    const latestSubmission = await db.connectorSubmission.findFirst({
      where: { installationId, productId, status: "SUCCESS" },
      orderBy: { submittedAt: "desc" },
      select: { externalRef: true },
    });

    let shopifyGid: string | null = null;
    const ref = latestSubmission?.externalRef ?? null;
    if (ref && /^gid:\/\/shopify\/Product\//.test(ref)) {
      shopifyGid = ref;
    }

    if (!shopifyGid) {
      return { hasExistingProduct: false, noChanges: false, changes: [] };
    }

    const connectorDef = await db.connectorDefinition.findUnique({
      where: { id: installation.connectorId },
      select: { slug: true },
    });
    const connectorSlug = connectorDef?.slug ?? "shopify";

    const payload = await this.buildConnectorProductPayload(productId);

    const connector = this.connectorRegistry.getConnector(connectorSlug) as unknown as {
      previewChanges: (ctx: unknown, product: ProductPayload, gid: string) => Promise<ShopifyProductPreview>;
    };

    const ctx = {
      tenantId: installation.tenantKey,
      installationId: installation.id,
      connectorId: installation.connectorId,
      getAccessToken: async () => "",
    };

    return connector.previewChanges(ctx, payload, shopifyGid);
  }

  // ─── Sprint 2: Shopify config import ──────────────────────────────────────

  async importShopifyConfig(installationId: string): Promise<ShopifyConfigResult> {
    const db = this.prisma.tenant();
    const installation = await db.connectorInstallation.findFirst({
      where: { id: installationId },
      select: { id: true, connectorId: true, tenantKey: true },
    });
    if (!installation) {
      throw new NotFoundException("Connector installation not found.");
    }

    const connectorDef = await db.connectorDefinition.findUnique({
      where: { id: installation.connectorId },
      select: { slug: true },
    });
    const connectorSlug = connectorDef?.slug ?? "shopify";

    const connector = this.connectorRegistry.getConnector(connectorSlug) as unknown as {
      importShopifyConfig: (ctx: unknown) => Promise<ShopifyConfigResult>;
    };

    const ctx = {
      tenantId: installation.tenantKey,
      installationId: installation.id,
      connectorId: installation.connectorId,
      getAccessToken: async () => "",
    };

    return connector.importShopifyConfig(ctx);
  }

  async getShopifyConfig(installationId: string): Promise<ShopifyConfigResult | null> {
    const db = this.prisma.tenant();
    const installation = await db.connectorInstallation.findFirst({
      where: { id: installationId },
      select: { id: true, connectorId: true, tenantKey: true },
    });
    if (!installation) {
      throw new NotFoundException("Connector installation not found.");
    }

    const connectorDef = await db.connectorDefinition.findUnique({
      where: { id: installation.connectorId },
      select: { slug: true },
    });
    const connectorSlug = connectorDef?.slug ?? "shopify";

    const connector = this.connectorRegistry.getConnector(connectorSlug) as unknown as {
      getShopifyConfig: (ctx: unknown) => Promise<ShopifyConfigResult | null>;
    };

    const ctx = {
      tenantId: installation.tenantKey,
      installationId: installation.id,
      connectorId: installation.connectorId,
      getAccessToken: async () => "",
    };

    return connector.getShopifyConfig(ctx);
  }

  // ─── Sprint 8: Delta sync ──────────────────────────────────────────────────

  async getDeltaSyncCandidates(installationId: string): Promise<{ productId: string; version: number }[]> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const db = this.prisma.tenant(tenantKey);

    // Products that have been modified (by version) since last sync for this installation
    const products = await db.product.findMany({
      where: { status: "approved" },
      select: { id: true, version: true },
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
    });

    if (products.length === 0) return [];

    // Fetch sync states for this installation (raw to avoid Prisma type error on new model)
    const syncStates = await tenantRaw<Array<{
      product_id: string;
      last_synced_version: number | null;
    }>>(
      this.prisma.tenant(tenantKey),
      `SELECT product_id, last_synced_version FROM connector_product_sync_states
       WHERE tenant_key = $1 AND installation_id = $2`,
      [tenantKey, installationId],
    );

    const syncMap = new Map(syncStates.map((s) => [s.product_id, s.last_synced_version ?? -1]));

    return products
      .filter((p) => (p.version ?? 0) > (syncMap.get(p.id) ?? -1))
      .map((p) => ({ productId: p.id, version: p.version ?? 0 }));
  }

  async queueDeltaSync(
    installationId: string,
    actor?: PolicyActor,
  ): Promise<{ queued: number; skipped: number }> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const db = this.prisma.tenant(tenantKey);
    const installation = await db.connectorInstallation.findFirst({
      where: { id: installationId },
      select: { id: true, connectorId: true },
    });
    if (!installation) throw new NotFoundException("Installation not found.");

    const connectorDef = await db.connectorDefinition.findUnique({
      where: { id: installation.connectorId },
      select: { slug: true, capabilities: true },
    });
    const capabilities = Array.isArray(connectorDef?.capabilities) ? connectorDef.capabilities : [];
    if (!capabilities.includes("PUBLISH")) {
      throw new BadRequestException("This connector does not support publish — delta sync not available.");
    }

    const candidates = await this.getDeltaSyncCandidates(installationId);
    let queued = 0;
    let skipped = 0;

    // Batch-fetch categoryIds to avoid one findUnique per candidate in the loop below.
    const candidateIds = candidates.map((c) => c.productId);
    const productRows = await db.product.findMany({
      where: { id: { in: candidateIds } },
      select: { id: true, categoryId: true },
      take: 500, // getDeltaSyncCandidates caps products at 500
    });
    const categoryById = new Map(productRows.map((p) => [p.id, p.categoryId]));

    for (const { productId } of candidates) {
      try {
        const categoryId = categoryById.get(productId);
        if (!categoryId) { skipped++; continue; }

        await db.marketplaceExportJob.create({
          data: {
            productId,
            categoryId,
            channel: connectorDef?.slug ?? "shopify",
            status: ExportJobStatus.queued,
            maxRetries: 3,
            retryCount: 0,
            createdBy: actor?.actorId?.trim() ? actor.actorId.trim() : "delta_sync",
          },
        });
        queued++;
      } catch {
        skipped++;
      }
    }

    return { queued, skipped };
  }

  private async persistSyncStateForProduct(
    installationId: string | null,
    productId: string,
    outcome: "SUCCESS" | "ERROR",
  ): Promise<void> {
    if (!installationId) return;
    const syncProduct = await this.prisma.tenant().product
      .findUnique({ where: { id: productId }, select: { version: true } })
      .catch(() => null);
    if (!syncProduct) return;
    await this.upsertSyncState(installationId, productId, syncProduct.version ?? 1, outcome)
      .catch(() => { /* non-critical — delta sync will re-process next cycle */ });
  }

  async upsertSyncState(installationId: string, productId: string, version: number, status: string): Promise<void> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const id = `${tenantKey}_${installationId}_${productId}`.replace(/[^a-z0-9_]/gi, "_").slice(0, 24) + "_" + Date.now().toString(36);
    await tenantExecRaw(
      this.prisma.tenant(tenantKey),
      `INSERT INTO connector_product_sync_states (id, tenant_key, installation_id, product_id, last_synced_at, last_synced_version, last_synced_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6, NOW(), NOW())
       ON CONFLICT (tenant_key, installation_id, product_id)
       DO UPDATE SET last_synced_at = NOW(), last_synced_version = $5, last_synced_status = $6, updated_at = NOW()`,
      [id, tenantKey, installationId, productId, version, status],
    );
  }

  async getSyncStates(installationId: string): Promise<Array<{
    productId: string;
    lastSyncedAt: Date | null;
    lastSyncedVersion: number | null;
    lastSyncedStatus: string | null;
  }>> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const rows = await tenantRaw<Array<{
      product_id: string;
      last_synced_at: Date | null;
      last_synced_version: number | null;
      last_synced_status: string | null;
    }>>(
      this.prisma.tenant(tenantKey),
      `SELECT product_id, last_synced_at, last_synced_version, last_synced_status
       FROM connector_product_sync_states
       WHERE tenant_key = $1 AND installation_id = $2
       ORDER BY last_synced_at DESC NULLS LAST
       LIMIT 200`,
      [tenantKey, installationId],
    );
    return rows.map((r) => ({
      productId: r.product_id,
      lastSyncedAt: r.last_synced_at,
      lastSyncedVersion: r.last_synced_version,
      lastSyncedStatus: r.last_synced_status,
    }));
  }

  // ─── Sprint 9: Scheduled sync ─────────────────────────────────────────────

  async getSchedule(installationId: string): Promise<{
    id: string;
    cronExpression: string;
    scope: string;
    status: string;
    lastRunAt: Date | null;
    nextRunAt: Date | null;
    lastRunOutcome: string | null;
  } | null> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const rows = await tenantRaw<Array<{
      id: string;
      cron_expression: string;
      scope: string;
      status: string;
      last_run_at: Date | null;
      next_run_at: Date | null;
      last_run_outcome: string | null;
    }>>(
      this.prisma.tenant(tenantKey),
      `SELECT id, cron_expression, scope, status, last_run_at, next_run_at, last_run_outcome
       FROM connector_sync_schedules
       WHERE tenant_key = $1 AND installation_id = $2
       LIMIT 1`,
      [tenantKey, installationId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      cronExpression: row.cron_expression,
      scope: row.scope,
      status: row.status,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      lastRunOutcome: row.last_run_outcome,
    };
  }

  async upsertSchedule(
    installationId: string,
    data: { cronExpression: string; scope: string; status: string },
    actor?: PolicyActor,
  ): Promise<{ id: string }> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const { cronExpression, scope, status } = data;

    if (String(cronExpression).length > 100) {
      throw new BadRequestException("cronExpression must not exceed 100 characters.");
    }
    if (String(scope).length > 50) {
      throw new BadRequestException("scope must not exceed 50 characters.");
    }
    if (String(status).length > 50) {
      throw new BadRequestException("status must not exceed 50 characters.");
    }

    // Validate cron expression — basic 5-field check
    const fields = cronExpression.trim().split(/\s+/);
    if (fields.length < 5 || fields.length > 6) {
      throw new BadRequestException("cronExpression must be a valid 5 or 6-field cron expression.");
    }

    const rows = await tenantRaw<Array<{ id: string }>>(
      this.prisma.tenant(tenantKey),
      `SELECT id FROM connector_sync_schedules WHERE tenant_key = $1 AND installation_id = $2 LIMIT 1`,
      [tenantKey, installationId],
    );

    if (rows[0]) {
      await tenantExecRaw(
        this.prisma.tenant(tenantKey),
        `UPDATE connector_sync_schedules
         SET cron_expression = $1, scope = $2, status = $3, updated_at = NOW()
         WHERE tenant_key = $4 AND installation_id = $5`,
        [cronExpression, scope, status, tenantKey, installationId],
      );
      await this.queueService
        .registerRepeatableSync(`sync:${installationId}`, { tenantKey, installationId, scope }, cronExpression, status === "active")
        .catch((err: unknown) => { this.logger.warn("Failed to register repeatable sync", { installationId, error: String(err) }); });
      return { id: rows[0].id };
    }

    const id = `sched_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    await tenantExecRaw(
      this.prisma.tenant(tenantKey),
      `INSERT INTO connector_sync_schedules (id, tenant_key, installation_id, cron_expression, scope, status, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [id, tenantKey, installationId, cronExpression, scope, status, actor?.actorId ?? null],
    );
    await this.queueService
      .registerRepeatableSync(`sync:${installationId}`, { tenantKey, installationId, scope }, cronExpression, status === "active")
      .catch((err: unknown) => { this.logger.warn("Failed to register repeatable sync", { installationId, error: String(err) }); });
    return { id };
  }

  async deleteSchedule(installationId: string): Promise<void> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    await tenantExecRaw(
      this.prisma.tenant(tenantKey),
      `DELETE FROM connector_sync_schedules WHERE tenant_key = $1 AND installation_id = $2`,
      [tenantKey, installationId],
    );
    await this.queueService
      .registerRepeatableSync(`sync:${installationId}`, {}, "", false)
      .catch((err: unknown) => { this.logger.warn("Failed to remove repeatable sync", { installationId, error: String(err) }); });
  }

  // ─── Sprint 10: Catalog linking ───────────────────────────────────────────

  async scanCatalogLinks(installationId: string): Promise<{
    matched: Array<{ productId: string; productTitle: string; shopifyGid: string; shopifySku: string; matchedBy: string; confidence: string }>;
    unmatched: Array<{ productId: string; productTitle: string; sku: string }>;
    ambiguous: Array<{ productId: string; productTitle: string; matches: Array<{ shopifyGid: string; matchedBy: string }> }>;
  }> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const db = this.prisma.tenant(tenantKey);
    const installation = await db.connectorInstallation.findFirst({
      where: { id: installationId },
      select: { id: true },
    });
    if (!installation) throw new NotFoundException("Installation not found.");

    const submissions = await db.connectorSubmission.findMany({
      where: { installationId, status: "SUCCESS", externalRef: { not: null } },
      select: { productId: true, externalRef: true },
      orderBy: [{ submittedAt: "desc" }],
      distinct: ["productId"],
      take: 10_000,
    });

    const products = await db.product.findMany({
      where: { status: "approved" },
      select: { id: true, title: true, variants: { take: 1, select: { skuCode: true } } },
      take: 500,
    });

    const submissionMap = new Map(submissions.map((s) => [s.productId, s.externalRef!]));

    const matched: Array<{ productId: string; productTitle: string; shopifyGid: string; shopifySku: string; matchedBy: string; confidence: string }> = [];
    const unmatched: Array<{ productId: string; productTitle: string; sku: string }> = [];

    for (const p of products) {
      const gid = submissionMap.get(p.id);
      const sku = p.variants[0]?.skuCode ?? "";
      if (gid) {
        matched.push({ productId: p.id, productTitle: p.title ?? "", shopifyGid: gid, shopifySku: sku, matchedBy: "submission_ref", confidence: "high" });
      } else {
        unmatched.push({ productId: p.id, productTitle: p.title ?? "", sku });
      }
    }

    return { matched, unmatched, ambiguous: [] };
  }

  async confirmCatalogLinks(
    installationId: string,
    links: Array<{ productId: string; shopifyGid: string; matchedBy: string }>,
    actor?: PolicyActor,
  ): Promise<{ confirmed: number }> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    // Cap at 500 to prevent unbounded batch inserts.
    const safeLinks = links.slice(0, 500);
    if (safeLinks.length === 0) return { confirmed: 0 };

    // Build one multi-row INSERT … ON CONFLICT upsert instead of N sequential writes.
    // (The merge conflict left both the old for-loop and the orphaned batch code;
    //  this restores the correct single-statement batch approach.)
    const params: unknown[] = [];
    const valueClauses: string[] = [];
    const confirmedBy = actor?.actorId ?? null;

    for (const link of safeLinks) {
      const base = params.length;
      const id = randomUUID();
      params.push(id, tenantKey, installationId, link.productId, link.shopifyGid, link.matchedBy, confirmedBy);
      valueClauses.push(
        `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, NOW(), $${base + 7}, NOW(), NOW())`,
      );
    }

    await tenantExecRaw(
      this.prisma.tenant(tenantKey),
      `INSERT INTO connector_product_links (id, tenant_key, installation_id, product_id, shopify_gid, matched_by, confirmed_at, confirmed_by, created_at, updated_at)
       VALUES ${valueClauses.join(", ")}
       ON CONFLICT (tenant_key, installation_id, product_id)
       DO UPDATE SET
         shopify_gid   = EXCLUDED.shopify_gid,
         matched_by    = EXCLUDED.matched_by,
         confirmed_at  = NOW(),
         confirmed_by  = EXCLUDED.confirmed_by,
         updated_at    = NOW()`,
      params,
    );

    return { confirmed: safeLinks.length };
  }

  async getProductLinks(installationId: string): Promise<Array<{
    productId: string;
    shopifyGid: string;
    matchedBy: string;
    confirmedAt: Date | null;
  }>> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const rows = await tenantRaw<Array<{
      product_id: string;
      shopify_gid: string;
      matched_by: string;
      confirmed_at: Date | null;
    }>>(
      this.prisma.tenant(tenantKey),
      `SELECT product_id, shopify_gid, matched_by, confirmed_at
       FROM connector_product_links
       WHERE tenant_key = $1 AND installation_id = $2
       ORDER BY confirmed_at DESC NULLS LAST`,
      [tenantKey, installationId],
    );
    return rows.map((r) => ({
      productId: r.product_id,
      shopifyGid: r.shopify_gid,
      matchedBy: r.matched_by,
      confirmedAt: r.confirmed_at,
    }));
  }

  // ─── Sprint F: Amazon Feeds API bulk publish ──────────────────────────────

  async triggerBulkPublish(
    installationId: string,
    productIds: string[],
  ): Promise<{ feedId: string; feedDocumentId: string; productCount: number; submissionIds: string[] }> {
    if (!productIds.length) {
      throw new BadRequestException("productIds must contain at least one product.");
    }
    if (productIds.length > 200) {
      throw new BadRequestException("productIds must contain at most 200 products per request.");
    }

    const db = this.prisma.tenant();
    const tenantKey = this.connectorFramework.getCurrentTenantKey();

    const installationRow = await db.connectorInstallation.findFirst({
      where: { id: installationId },
      select: { id: true, connectorId: true, tenantKey: true },
    });
    if (!installationRow) {
      throw new NotFoundException("Connector installation not found.");
    }

    const connectorDef = await db.connectorDefinition.findUnique({
      where: { id: installationRow.connectorId },
      select: { slug: true },
    });
    const connectorSlug = connectorDef?.slug ?? "";

    const installation = await this.connectorFramework.requireInstallation(
      tenantKey,
      connectorSlug,
      installationId,
    );

    const products = await Promise.all(productIds.map((id) => this.buildConnectorProductPayload(id)));

    const bulkRef = await this.connectorFramework.publishBulk(installation, products);

    const submissionIds: string[] = [];
    for (let i = 0; i < bulkRef.skus.length; i++) {
      const sku = bulkRef.skus[i];
      const productId = productIds[i] ?? productIds[0];
      const externalRef = `feed::${bulkRef.feedId}::${i + 1}::${sku}`;
      const idempotencyKey = `bulk:${bulkRef.feedId}:${i + 1}`;

      const row = await db.connectorSubmission.upsert({
        where: {
          tenantKey_installationId_idempotencyKey: {
            tenantKey,
            installationId,
            idempotencyKey,
          },
        },
        create: {
          id: randomUUID(),
          installationId,
          productId,
          idempotencyKey,
          submissionType: "PUBLISH",
          source: "NOT_VALIDATED",
          attemptNumber: 1,
          status: "PENDING",
          externalRef,
          payloadSnapshot: {},
          channelErrors: [],
        },
        update: {
          attemptNumber: { increment: 1 },
          status: "PENDING",
          externalRef,
        },
        select: { id: true },
      });
      submissionIds.push(row.id);
    }

    this.logger.warn("Amazon bulk feed submitted", {
      installationId,
      feedId: bulkRef.feedId,
      productCount: bulkRef.productCount,
    });

    return {
      feedId: bulkRef.feedId,
      feedDocumentId: bulkRef.feedDocumentId,
      productCount: bulkRef.productCount,
      submissionIds,
    };
  }
}
