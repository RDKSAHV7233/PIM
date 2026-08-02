import { createHash, randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import {
  ExportJobStatus,
  Prisma,
  RuleSeverity,
  ValidationIssueStatus,
} from "@prisma/client";
import { ConnectorFrameworkService } from "../connector-framework/connector-framework.service";
import { ConnectorRegistry } from "../connector-framework/connector.registry";
import { parseCapabilities } from "../connector-framework/parse-capabilities";
import { PlanUsageService } from "../billing/plan-usage.service";
import {
  CapabilityNotSupportedError,
  CredentialExpiredError,
  InstallationNotFoundError,
} from "../connector-framework/connector.errors";
import { MarketPrice, ProductPayload } from "../connector-framework/connector.interface";
import { PriceResolutionService } from "./price-resolution.service";
import { MediaStorageService } from "../media/media-storage.service";
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
  fieldMap: Record<string, string | string[]>;
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
  rawFieldMap?: Record<string, unknown>;
};

type ConnectorProductPayloadOptions = {
  channel?: string;
  connectorSlug?: string;
  installationId?: string | null;
  templateId?: string;
};

type AuthoritativeChannelIssue = {
  severity: "error" | "warning";
  code: string;
  fieldPath: string;
  sellerMessage: string;
  message: string;
};

function normalizeFieldMapTargets(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return Array.from(
    new Set(
      raw
        .map((item) => describeFieldMapTarget(item))
        .filter((item) => item.length > 0),
    ),
  );
}

function describeFieldMapTarget(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return String(value ?? "").trim();
  }
  const raw = value as Record<string, unknown>;
  const explicit = raw.fieldPath ?? raw.path ?? raw.target;
  if (typeof explicit === "string" && explicit.trim()) {
    return explicit.trim();
  }
  const namespace = String(raw.namespace ?? "").trim();
  const key = String(raw.key ?? "").trim();
  const connector = String(raw.connector ?? raw.channel ?? "shopify").trim().toLowerCase();
  const kind = String(raw.kind ?? raw.targetType ?? raw.type ?? "").trim().toLowerCase();
  if (namespace && key && connector === "shopify" && (kind.includes("metafield") || namespace || key)) {
    return `productMetafields.${namespace}.${key}`;
  }
  return "";
}

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
  evalFailed?: true;
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
  myntra: {
    channel: "myntra",
    displayName: "Myntra",
    requiredFields: [
      "title",
      "brand",
      "description",
      "hsnCode",
      "gstRate",
      "attributes.color",
      "attributes.size",
    ],
    fieldMap: {
      title: "product_name",
      brand: "brand",
      description: "product_description",
      hsnCode: "hsn_code",
      gstRate: "gst_rate",
      "attributes.color": "color",
      "attributes.size": "size",
      "attributes.material": "fabric_composition",
      "attributes.mainImageUrl": "images.0",
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
  // In development — see IN_DEVELOPMENT_CHANNELS in apps/web/src/lib/marketplace-channels.ts.
  // Mapped meta_data execution exists, but no real store has been verified end-to-end.
  woocommerce: {
    channel: "woocommerce",
    displayName: "WooCommerce",
    requiredFields: ["title", "description", "attributes.mainImageUrl"],
    fieldMap: {
      title: "name",
      description: "description",
      "attributes.sku": "sku",
      "attributes.mainImageUrl": "images.0.src",
      "attributes.productType": "categories.0.name",
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
    private readonly priceResolution: PriceResolutionService,
    private readonly mediaStorage: MediaStorageService,
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

  async getChannelMapping(
    channelInput: string,
    categoryId?: string,
    templateId?: string,
    actor?: PolicyActor,
    installationId?: string,
  ) {
    await this.accessPolicy.assertChannelAccess(actor ?? {}, "view", channelInput, "ChannelMappingTemplate");
    if (categoryId) {
      await this.accessPolicy.assertCategoryAccess(actor ?? {}, "view", categoryId, "ChannelMappingTemplate");
    }
    // installationId threads into the ConnectorMappingVersion bridge below (Sprint 11+)
    // so an operator viewing an account-scoped mapping sees that account's override,
    // not just the slug-scoped tenant default. Legacy channelMappingTemplate lookups
    // above are unaffected — they were never installation-aware.
    const mapping = await this.getEffectiveMapping(channelInput, categoryId, templateId, installationId ?? null);
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
    let resolvedInstallationId: string;
    try {
      resolvedInstallationId = await this.resolvePublishingDestination(connectorSlug, dto.installationId);
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

    const simulation = await this.simulateProduct(productId, dto.channel, dto.templateId, resolvedInstallationId);
    await this.connectorMappingService.assertPublishReadyForExport({
      connectorSlug,
      categoryScope: product.categoryId,
      installationId: resolvedInstallationId,
      fallbackAcknowledged: dto.fallbackAcknowledged,
      productId,
    });

    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    try {
      const installation = await this.connectorFramework.requireInstallation(tenantKey, connectorSlug, resolvedInstallationId);
      const productPayload = await this.buildConnectorProductPayload(productId, {
        channel: dto.channel,
        installationId: resolvedInstallationId,
        templateId: dto.templateId,
      });
      const validationResult = await this.connectorFramework.validate(installation, productPayload);
      if (!validationResult.isValid) {
        this.logger.warn("pre-flight connector validation failed — job will proceed to async processing", {
          productId,
          connectorSlug,
          errors: validationResult.errors.map((e) => e.sellerMessage),
        });
      }
    } catch (error) {
      this.logger.warn("pre-flight connector validation skipped", {
        productId,
        connectorSlug,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const requestIdentity = this.buildPublishRequestIdentity(
      product.version,
      product.updatedAt,
      resolvedInstallationId,
      simulation.mappedPayload,
    );

    const activeStatuses: ExportJobStatus[] = [ExportJobStatus.queued, ExportJobStatus.processing, ExportJobStatus.retrying];
    const activeJob = await this.prisma.tenant().marketplaceExportJob.findFirst({
      where: {
        productId,
        installationId: resolvedInstallationId,
        status: { in: activeStatuses },
      },
      include: { template: true },
    });
    if (activeJob) {
      const existingIdentity = (activeJob.payload as Record<string, unknown>)?.publishRequestIdentity as
        | { productRevision: string; installationId: string; payloadHash: string }
        | undefined;
      if (!existingIdentity) {
        throw new ConflictException(
          "PUBLISH_ALREADY_IN_PROGRESS: an active job exists without request identity; wait for it to complete or fail before re-publishing",
        );
      }
      if (
        existingIdentity.productRevision !== requestIdentity.productRevision ||
        existingIdentity.payloadHash !== requestIdentity.payloadHash
      ) {
        throw new ConflictException(
          "ACTIVE_JOB_IDENTITY_MISMATCH: product data changed since the active job was queued; wait for it to complete or fail before re-publishing",
        );
      }
      return activeJob;
    }

    let job;
    try {
      job = await this.prisma.tenant().marketplaceExportJob.create({
        data: {
          createdBy: actor?.actorId?.trim() ? actor.actorId.trim() : null,
          productId,
          categoryId: product.categoryId,
          channel: simulation.channel,
          templateId: simulation.templateId ?? null,
          installationId: resolvedInstallationId,
          status: ExportJobStatus.queued,
          retryCount: 0,
          maxRetries: dto.maxRetries ?? 3,
          payload: {
            mappingSource: simulation.mappingSource,
            missingFields: simulation.missingFields,
            complianceSummary: simulation.complianceSummary,
            mappedPayload: simulation.mappedPayload,
            publishRequestIdentity: requestIdentity,
          } as Prisma.JsonObject,
        },
        include: { template: true },
      });
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const meta = error.meta ?? {};
        const target = meta.target;
        const constraintName = typeof meta.constraint === "string" ? meta.constraint : null;
        const EXPECTED_PRISMA_FIELDS = ["tenantKey", "productId", "installationId"];
        const EXPECTED_DB_COLUMNS = ["tenantKey", "productId", "installation_id"];
        const exactFieldMatch = (arr: string[], expected: string[]) =>
          arr.length === expected.length && expected.every((f) => arr.includes(f));
        const isExportJobConflict =
          constraintName === "uq_export_job_product_installation" ||
          (Array.isArray(target) && exactFieldMatch(target as string[], EXPECTED_PRISMA_FIELDS)) ||
          (Array.isArray(target) && exactFieldMatch(target as string[], EXPECTED_DB_COLUMNS));
        if (isExportJobConflict) {
          const concurrentJob = await this.prisma.tenant().marketplaceExportJob.findFirst({
            where: { productId, installationId: resolvedInstallationId, status: { in: activeStatuses } },
            include: { template: true },
          });
          if (concurrentJob) {
            const concurrentIdentity = (concurrentJob.payload as Record<string, unknown>)?.publishRequestIdentity as
              | { productRevision: string; installationId: string; payloadHash: string }
              | undefined;
            if (!concurrentIdentity) {
              throw new ConflictException(
                "PUBLISH_ALREADY_IN_PROGRESS: an active job exists without request identity; wait for it to complete or fail before re-publishing",
              );
            }
            if (
              concurrentIdentity.productRevision !== requestIdentity.productRevision ||
              concurrentIdentity.payloadHash !== requestIdentity.payloadHash
            ) {
              throw new ConflictException(
                "ACTIVE_JOB_IDENTITY_MISMATCH: product data changed since the active job was queued; wait for it to complete or fail before re-publishing",
              );
            }
            return concurrentJob;
          }
        }
      }
      throw error;
    }
    // Queue dedup: retryCount is monotonically increasing (incremented only on
    // processing failure, never decremented), so `${id}:${retryCount}` is unique
    // per attempt.  A dedicated processingAttempt column is cleaner semantically
    // but adds a schema migration; retryCount satisfies the uniqueness invariant.
    await this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
      jobId: job.id,
      connectorSlug: simulation.channel,
    }, { jobId: `${job.id}_${job.retryCount}` });
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

  async countSubmissions(filters?: SubmissionFilters) {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const productId = filters?.productId ? String(filters.productId).trim() : "";
    const connectorSlug = filters?.connectorSlug ? String(filters.connectorSlug).trim().toLowerCase() : "";
    const installationId = filters?.installationId ? String(filters.installationId).trim() : "";
    const status = filters?.status ? String(filters.status).trim().toUpperCase() : "";
    const minAttempt = Number.isFinite(filters?.minAttempt)
      ? Math.max(1, Math.floor(filters?.minAttempt ?? 1))
      : null;

    const params: Array<string | number> = [tenantKey];
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

    const rows = await tenantRaw<Array<{ count?: number | string | bigint }>>(
      this.prisma.tenant(tenantKey),
      `
      SELECT COUNT(*)::int AS count
      FROM connector_submissions cs
      JOIN connector_installations ci ON ci.id = cs.installation_id
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ${clauses.join(" AND ")}
      `,
      params,
    );
    const count = rows[0]?.count;
    return { count: Number(count ?? 0) };
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

    const installation = await this.connectorFramework.requireInstallation(tenantKey, submission.connectorSlug, submission.installationId);
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
      installationId?: string | null;
      externalRef?: string | null;
      source?: string | null;
    };

    if (this.shouldRetryThroughLiveUpdate(submission)) {
      await this.assertRetryPrerequisites(submission, null);
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
    await this.assertRetryPrerequisites(submission, jobId);
    const requeuedJob = await this.requeueExportJob(jobId);
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

  private async assertRetryPrerequisites(
    submission: {
      connectorSlug?: string | null;
      installationId?: string | null;
    },
    jobId: string | null,
  ): Promise<void> {
    const connectorSlug = String(submission.connectorSlug ?? "").trim().toLowerCase();
    if (connectorSlug !== "shopify") {
      return;
    }
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    let installationId = String(submission.installationId ?? "").trim();
    if (!installationId && jobId) {
      const job = await this.prisma.tenant().marketplaceExportJob.findUnique({
        where: { id: jobId },
        select: { installationId: true },
      });
      installationId = String(job?.installationId ?? "").trim();
    }
    if (!installationId) {
      throw new BadRequestException({
        code: "SHOPIFY_PUBLICATION_TARGETS_MISSING",
        message: "Select Shopify publication targets before retrying this submission.",
      });
    }
    let installation;
    try {
      installation = await this.connectorFramework.requireInstallation(tenantKey, connectorSlug, installationId);
    } catch (error: unknown) {
      if (error instanceof CredentialExpiredError) {
        throw new BadRequestException({
          code: "SHOPIFY_CREDENTIAL_EXPIRED",
          installationId,
          message: "Reconnect this Shopify account before retrying — its credentials have expired.",
        });
      }
      if (error instanceof InstallationNotFoundError) {
        throw new BadRequestException({
          code: "SHOPIFY_INSTALLATION_NOT_FOUND",
          installationId,
          message: "The Shopify installation for this submission no longer exists.",
        });
      }
      throw error;
    }
    if (!this.hasShopifyPublicationTargets(installation.metadata)) {
      throw new BadRequestException({
        code: "SHOPIFY_PUBLICATION_TARGETS_MISSING",
        installationId,
        message: "Select Shopify publication targets before retrying this submission.",
      });
    }
  }

  private hasShopifyPublicationTargets(metadata: Record<string, unknown> | null | undefined): boolean {
    const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
    const selectedIds = source.publicationTargetIds;
    if (Array.isArray(selectedIds) && selectedIds.some((id) => String(id ?? "").trim())) {
      return true;
    }
    const publicationTargets = source.publicationTargets;
    return Array.isArray(publicationTargets) && publicationTargets.some((target) => {
      if (!target || typeof target !== "object" || Array.isArray(target)) {
        return false;
      }
      const item = target as Record<string, unknown>;
      return item.selected !== false && Boolean(String(item.id ?? "").trim());
    });
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

    const submissionInstallationId = String(submission.installationId ?? "").trim();
    if (!submissionInstallationId) {
      throw new BadRequestException("Submission cannot be retried: no installation ID on record.");
    }
    let installation;
    try {
      installation = await this.connectorFramework.requireInstallation(
        tenantKey,
        String(submission.connectorSlug ?? "").toLowerCase(),
        submissionInstallationId,
      );
    } catch (error: unknown) {
      if (error instanceof CredentialExpiredError || error instanceof InstallationNotFoundError) {
        await this.prisma.tenant(tenantKey).connectorSubmission.updateMany({
          where: { id: submissionId },
          data: {
            status: "ERROR",
            channelErrors: [{
              code: error instanceof CredentialExpiredError ? "CONNECTOR_CREDENTIAL_EXPIRED" : "CONNECTOR_INSTALLATION_NOT_FOUND",
              fieldPath: "",
              severity: "error",
              sellerMessage: error.message,
            }] as Prisma.InputJsonValue,
            resolvedAt: new Date(),
          },
        });
        await this.notificationsService.emitPublishStatus(jobId, "failed");
        return;
      }
      throw error;
    }
    const productPayload = await this.buildConnectorProductPayload(String(submission.productId), {
      connectorSlug: String(submission.connectorSlug ?? "").toLowerCase(),
      installationId: submissionInstallationId,
    });
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

    const processableStatuses: ExportJobStatus[] = [ExportJobStatus.queued, ExportJobStatus.retrying];
    const claimed = await this.prisma.tenant().marketplaceExportJob.updateMany({
      where: { id: jobId, status: { in: processableStatuses } },
      data: { status: ExportJobStatus.processing },
    });
    if (claimed.count === 0) {
      const current = await this.prisma.tenant().marketplaceExportJob.findUnique({ where: { id: jobId }, include: { template: true } });
      return current ?? existing;
    }

    let effectiveInstallationId: string | null = existing.installationId ?? null;
    const connectorSlug = this.mapChannelToConnectorSlug(existing.channel);
    const tenantKey = this.connectorFramework.getCurrentTenantKey();

    if (!existing.installationId) {
      try {
        effectiveInstallationId = await this.resolvePublishingDestination(connectorSlug, null);
        const persisted = await this.prisma.tenant().marketplaceExportJob.updateMany({
          where: {
            id: jobId,
            installationId: null,
            status: ExportJobStatus.processing,
          },
          data: { installationId: effectiveInstallationId },
        });
        if (persisted.count === 0) {
          const reloaded = await this.prisma.tenant().marketplaceExportJob.findUnique({
            where: { id: jobId },
            include: { template: true },
          });
          if (reloaded?.installationId) {
            effectiveInstallationId = reloaded.installationId;
          } else {
            await this.emitExportThroughputMetric(existing.channel, startedAtMs, "failed");
            throw new ConflictException("Concurrent destination write detected");
          }
        }
      } catch (resolveError) {
        if (resolveError instanceof ConflictException) throw resolveError;
        const updated = await this.prisma.tenant().marketplaceExportJob.update({
          where: { id: jobId },
          data: {
            status: ExportJobStatus.dead_letter,
            failureReason: "DESTINATION_AMBIGUOUS",
            dlqReason: "Historical job has no installationId and cannot auto-resolve destination",
          },
          include: { template: true },
        });
        await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
        return updated;
      }
    } else {
      try {
        const installation = await this.connectorFramework.requireInstallation(
          tenantKey, connectorSlug, existing.installationId,
        );
        if (!installation.capabilities.includes("PUBLISH")) {
          throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
        }
      } catch {
        const updated = await this.prisma.tenant().marketplaceExportJob.update({
          where: { id: jobId },
          data: {
            status: ExportJobStatus.failed,
            failureReason: "DESTINATION_UNAVAILABLE",
          },
          include: { template: true },
        });
        await this.notificationsService.emitPublishStatus(updated.id, "failed");
        await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
        return updated;
      }
    }

    try {
      const simulation = await this.simulateProduct(
        existing.productId,
        existing.channel,
        existing.templateId ?? undefined,
        effectiveInstallationId ?? undefined,
      );
      const resolvedInstallationId = await this.recordConnectorSubmissionIfInstalled(
        { ...existing, installationId: effectiveInstallationId },
        simulation,
      );
      effectiveInstallationId = effectiveInstallationId ?? resolvedInstallationId ?? null;

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
          // WooCommerce has no published rate-limit contract; 2 concurrent writes at 400ms minimum
          // is conservative and matches the default policy used for new connectors.
          woocommerce: {
            concurrency: 2,
            minIntervalMs: 400,
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
    const requeueableStatuses: ExportJobStatus[] = [ExportJobStatus.failed, ExportJobStatus.dead_letter, ExportJobStatus.retrying];

    const claimed = await this.prisma.tenant().marketplaceExportJob.updateMany({
      where: { id: jobId, status: { in: requeueableStatuses } },
      data: {
        status: ExportJobStatus.queued,
        failureReason: null,
        dlqReason: null,
      },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.tenant().marketplaceExportJob.findUnique({ where: { id: jobId } });
      if (!existing) {
        throw new NotFoundException("Export job not found");
      }
      throw new BadRequestException("Only retrying/failed/DLQ jobs can be requeued.");
    }

    const updated = await this.prisma.tenant().marketplaceExportJob.findUnique({
      where: { id: jobId },
      include: { template: true },
    });
    if (!updated) {
      throw new NotFoundException("Export job not found after status claim");
    }

    try {
      await this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
        jobId,
        connectorSlug: updated.channel,
      }, { jobId: `${jobId}_${updated.retryCount}` });
    } catch (enqueueError) {
      const queueJobId = `${jobId}_${updated.retryCount}`;
      const delivered = await this.queueService.isJobPresent(QUEUE_NAMES.CONNECTOR_SUBMISSION, queueJobId).catch(() => false);
      if (!delivered) {
        await this.prisma.tenant().marketplaceExportJob.updateMany({
          where: { id: jobId, status: ExportJobStatus.queued },
          data: { status: ExportJobStatus.failed, failureReason: "Queue enqueue failed" },
        });
        throw enqueueError;
      }
    }

    return updated;
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
    const publishCapableChannels = await this.getPublishCapableChannels();
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
              return this.summarizeReadiness(channel, simulation, publishCapableChannels.has(channel));
            } catch (err) {
              this.logger.warn("Channel readiness evaluation failed", {
                productId: product.id,
                channel,
                err: err instanceof Error ? err.message : String(err),
              });
              return {
                channel,
                status: "unknown" as const,
                errorCount: 0,
                warningCount: 0,
                evalFailed: true as const,
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
    hasPublishCapableConnector: boolean,
  ): MarketplaceReadinessSummary {
    const missingFieldKeys = new Set(
      simulation.missingFields.map((fieldPath) => String(fieldPath ?? "").trim().toLowerCase()),
    );
    const channelErrorCount = simulation.channelIssues.filter((issue) => {
      if (issue.severity !== "error") {
        return false;
      }
      const fieldPath = String(issue.fieldPath ?? "").trim().toLowerCase();
      return !(issue.code === "CHANNEL_REQUIRED_FIELD" && missingFieldKeys.has(fieldPath));
    }).length;
    const channelWarningCount = simulation.channelIssues.filter((issue) => issue.severity === "warning").length;
    // Content/mapping validity alone isn't publishable: without an installed, active
    // connector that supports PUBLISH for this channel there is nowhere to send the
    // export, so this must not report "ready" — that previously disagreed with the
    // product detail page's own "Connector readiness: Missing" card for the same channel.
    const connectorErrorCount = hasPublishCapableConnector ? 0 : 1;
    const errorCount =
      simulation.missingFields.length + simulation.complianceSummary.errorCount + channelErrorCount + connectorErrorCount;
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

  /**
   * Channels with at least one ACTIVE, PUBLISH-capable connector installation for the
   * current tenant. Computed once per batch call (tenant-wide, not per-product) and used
   * to keep readiness/batch in agreement with the connector-installation check that the
   * product detail page runs separately.
   */
  private async getPublishCapableChannels(): Promise<Set<MarketplaceChannel>> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const rows = await tenantRaw<Array<{ slug: string; capabilities: unknown; metadata: unknown; credentialsValidated: boolean }>>(
      this.prisma.tenant(tenantKey),
      `
      SELECT cd.slug, cd.capabilities, ci.metadata,
        EXISTS (
          SELECT 1 FROM connector_credentials cc
          WHERE cc.installation_id = ci.id
            AND cc.tenant_key = ci.tenant_key
            AND cc.last_validated_at IS NOT NULL
            AND cc.failure_reason IS NULL
        ) AS "credentialsValidated"
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.tenant_key = $1 AND ci.status = 'ACTIVE'
      `,
      [tenantKey],
    );

    const channels = new Set<MarketplaceChannel>();
    for (const row of rows) {
      if (!parseCapabilities(row.capabilities).includes("PUBLISH")) {
        continue;
      }
      const slug = String(row.slug);
      // VEXA-202: Shopify's managed-install path inserts the installation row as
      // 'ACTIVE' before the OAuth handshake completes (connector-installer.service.ts).
      // metadata.shopId is only written once fetchShopIdentity succeeds post-OAuth —
      // reuse that same signal the connector-detail page already uses for its own
      // "awaiting OAuth authorization" messaging, so this check doesn't disagree with it.
      // Other connectors don't use this two-phase pattern, so this is a no-op for them.
      if (slug === "shopify" && !this.hasCompletedShopifyAuth(row.metadata)) {
        continue;
      }
      // VEXA-301-SPIKE: Flipkart/Amazon silently skip validateCredentials() when every
      // credential field is left blank at install (captureAndValidateFlipkartCredentials /
      // captureAndValidateAmazonCredentials), leaving the row 'ACTIVE' with nothing ever
      // confirmed real. Require at least one credential row that actually passed validation.
      if ((slug === "flipkart" || slug === "amazon-in") && !row.credentialsValidated) {
        continue;
      }
      const channel = mapConnectorSlugToMarketplaceChannel(slug);
      if (channel) {
        channels.add(channel);
      }
    }
    return channels;
  }

  /** Mirrors the `Boolean(metadataShopDomain && metadataShopId)` check the connector-detail
   *  page already uses (apps/web/.../channels/connectors/[installationId]/page.tsx). */
  private hasCompletedShopifyAuth(metadata: unknown): boolean {
    if (!metadata || typeof metadata !== "object") {
      return false;
    }
    const shopId = (metadata as Record<string, unknown>).shopId;
    return typeof shopId === "string" && shopId.trim().length > 0;
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
    const rawAttributes = this.asRecord(product.attributes);
    // `asRecord` returns the same object reference (not a copy) — never mutate it directly here,
    // it may be a shared/cached product object reused across other calls.
    let attributes = rawAttributes;
    if (this.isEmpty(rawAttributes.mainImageUrl)) {
      const resolvedImageUrl = await this.resolveConnectorImageUrl(product.id, rawAttributes);
      if (resolvedImageUrl) {
        attributes = { ...rawAttributes, mainImageUrl: resolvedImageUrl };
      }
    }
    const mappedPayload: Record<string, unknown> = {};
    for (const [sourceField, rawTargetField] of Object.entries(mapping.rawFieldMap ?? mapping.fieldMap)) {
      const value = this.getFieldValue(sourceField, product, attributes);
      if (!this.isEmpty(value)) {
        for (const targetField of normalizeFieldMapTargets(rawTargetField)) {
          mappedPayload[targetField] = value;
        }
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
        rawFieldMap: this.asRecord(template.fieldMap),
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
          rawFieldMap: this.asRecord(defaultTemplate.fieldMap),
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
            const fieldMap = this.asStringMap(rawFieldMappings);
            return {
              channel,
              displayName: basePack.displayName,
              requiredFields: [...basePack.requiredFields],
              fieldMap,
              rawFieldMap: this.asRecord(rawFieldMappings),
              templateId: null,
              templateName: null,
              source: "connector_mapping_version",
            };
          }
        }
      } catch (err) {
        // ConnectorMappingVersion lookup failed — fall through to system pack.
        // Never let a bridge failure block an existing channelMappingTemplate user.
        this.logger.warn("ConnectorMappingVersion bridge lookup failed — falling back to system pack", {
          channel,
          categoryId,
          installationId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      ...basePack,
      requiredFields: [...basePack.requiredFields],
      fieldMap: { ...basePack.fieldMap },
      rawFieldMap: { ...basePack.fieldMap },
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
        rawFieldMap: cached.rawFieldMap ? { ...cached.rawFieldMap } : undefined,
      };
    }

    const resolved = await this.getEffectiveMapping(channelInput, categoryId, templateId, installationId);
    cache.set(key, resolved);
    return {
      ...resolved,
      requiredFields: [...resolved.requiredFields],
      fieldMap: { ...resolved.fieldMap },
      rawFieldMap: resolved.rawFieldMap ? { ...resolved.rawFieldMap } : undefined,
    };
  }

  private async findPublishingInstallations(
    connectorSlug: string,
  ): Promise<Array<{
    installationId: string;
    displayLabel: string;
    eligible: boolean;
    unavailableReason: string | null;
  }>> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const connectorDef = await this.prisma.tenant().connectorDefinition.findFirst({
      where: { slug: connectorSlug },
      select: { id: true },
    });
    if (!connectorDef) return [];

    const installations = await this.prisma.tenant().connectorInstallation.findMany({
      where: { connectorId: connectorDef.id },
      select: { id: true, status: true, accountAlias: true },
      orderBy: [{ installedAt: "desc" }],
    });

    const results: Array<{
      installationId: string;
      displayLabel: string;
      eligible: boolean;
      unavailableReason: string | null;
    }> = [];

    for (const inst of installations) {
      if (inst.status !== "ACTIVE") {
        results.push({
          installationId: inst.id,
          displayLabel: inst.accountAlias || inst.id,
          eligible: false,
          unavailableReason: `Installation status: ${inst.status}`,
        });
        continue;
      }

      try {
        const resolved = await this.connectorFramework.requireInstallation(tenantKey, connectorSlug, inst.id);
        if (!resolved.capabilities.includes("PUBLISH")) {
          results.push({
            installationId: inst.id,
            displayLabel: inst.accountAlias || inst.id,
            eligible: false,
            unavailableReason: "PUBLISH capability not available",
          });
          continue;
        }
        results.push({
          installationId: inst.id,
          displayLabel: inst.accountAlias || inst.id,
          eligible: true,
          unavailableReason: null,
        });
      } catch {
        results.push({
          installationId: inst.id,
          displayLabel: inst.accountAlias || inst.id,
          eligible: false,
          unavailableReason: "Credential validation failed",
        });
      }
    }

    return results;
  }

  async resolvePublishingDestination(
    connectorSlug: string,
    installationId?: string | null,
  ): Promise<string> {
    if (installationId?.trim()) {
      const tenantKey = this.connectorFramework.getCurrentTenantKey();
      const installation = await this.connectorFramework.requireInstallation(tenantKey, connectorSlug, installationId);
      if (!installation.capabilities.includes("PUBLISH")) {
        throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
      }
      return installation.id;
    }

    const candidates = await this.findPublishingInstallations(connectorSlug);
    const eligible = candidates.filter(c => c.eligible);

    if (eligible.length === 0) {
      throw new BadRequestException("DESTINATION_NOT_FOUND");
    }
    if (eligible.length > 1) {
      throw new BadRequestException("DESTINATION_INSTALLATION_REQUIRED");
    }

    return eligible[0].installationId;
  }

  async listPublishingDestinations(
    channel: string,
  ): Promise<Array<{
    installationId: string;
    connectorSlug: string;
    channel: string;
    displayLabel: string;
    status: "eligible" | "unavailable";
    unavailableReason?: string | null;
  }>> {
    const connectorSlug = this.mapChannelToConnectorSlug(channel);
    const candidates = await this.findPublishingInstallations(connectorSlug);

    return candidates.map(c => ({
      installationId: c.installationId,
      connectorSlug,
      channel,
      displayLabel: c.displayLabel,
      status: c.eligible ? "eligible" as const : "unavailable" as const,
      unavailableReason: c.unavailableReason,
    }));
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

  private buildPublishRequestIdentity(
    productVersion: number,
    productUpdatedAt: Date,
    installationId: string | null,
    mappedPayload: unknown,
  ): { productRevision: string; installationId: string; payloadHash: string } {
    const payloadHash = createHash("sha256")
      .update(this.canonicalJsonSerialize(mappedPayload ?? {}))
      .digest("hex")
      .slice(0, 16);
    return {
      productRevision: `v${productVersion}:${productUpdatedAt.toISOString()}`,
      installationId: installationId ?? "",
      payloadHash,
    };
  }

  private canonicalJsonSerialize(value: unknown): string {
    if (value === null || value === undefined) return "null";
    if (typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) {
      return "[" + value.map((v) => this.canonicalJsonSerialize(v)).join(",") + "]";
    }
    const sorted = Object.keys(value as Record<string, unknown>).sort();
    return "{" + sorted.map((k) => JSON.stringify(k) + ":" + this.canonicalJsonSerialize((value as Record<string, unknown>)[k])).join(",") + "}";
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

  private normalizeFieldMap(input: Record<string, string | string[]>) {
    const normalized: Record<string, string | string[]> = {};
    for (const [source, target] of Object.entries(input ?? {})) {
      const sourceKey = source.trim();
      const targetKeys = normalizeFieldMapTargets(target);
      if (!sourceKey || targetKeys.length === 0) {
        continue;
      }
      normalized[sourceKey] = targetKeys.length === 1 ? targetKeys[0] : targetKeys;
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

  private asStringMap(value: unknown): Record<string, string | string[]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const out: Record<string, string | string[]> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const source = key.trim();
      const targets = normalizeFieldMapTargets(val);
      if (source && targets.length > 0) {
        out[source] = targets.length === 1 ? targets[0] : targets;
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
    if (!job.installationId) {
      return null;
    }
    let installation;
    try {
      installation = await this.connectorFramework.requireInstallation(
        tenantKey,
        connectorSlug,
        job.installationId,
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
      // Defaults to the mapping preview so a submission is still recorded with useful
      // context if buildConnectorProductPayload itself throws before any payload exists.
      // Overwritten below with the real payload as soon as it's built, so the stored
      // evidence reflects what was actually sent, not just what the mapping predicted.
      let payloadSnapshot: Record<string, unknown> = simulation.mappedPayload;
      try {
        const productPayload = await this.buildConnectorProductPayload(job.productId, {
          channel: job.channel,
          installationId: job.installationId,
        });
        payloadSnapshot = JSON.parse(JSON.stringify(productPayload)) as Record<string, unknown>;

        // Only look up prior external refs for connectors that support update-in-place.
        // The installationId filter already prevents cross-connector leakage, but gating
        // on slug makes the contract explicit: only Shopify uses GID-based productSet updates.
        let existingGid: string | null = null;
        if (connectorSlug === "shopify") {
          const priorSubmission = await this.prisma.tenant().connectorSubmission.findFirst({
            where: {
              productId: job.productId,
              installationId: installation.id,
              status: "SUCCESS",
              externalRef: { not: null },
            },
            orderBy: { submittedAt: "desc" },
            select: { externalRef: true },
          });
          existingGid = priorSubmission?.externalRef ?? null;
        }

        const publishResult = existingGid
          ? await this.connectorFramework.update(installation, productPayload, existingGid)
          : await this.connectorFramework.publish(installation, productPayload);

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
          payloadSnapshot,
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
          payloadSnapshot,
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

  private async buildConnectorProductPayload(
    productId: string,
    options: ConnectorProductPayloadOptions = {},
  ): Promise<ProductPayload> {
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
          include: {
            prices: {
              where: { priceList: { status: "active" } },
              include: {
                priceList: {
                  select: {
                    isDefault: true,
                    market: { select: { code: true } },
                    currency: { select: { code: true } },
                  },
                },
              },
            },
          },
        },
        taxCodes: {
          include: { regime: { select: { marketCode: true } } },
          orderBy: { marketCode: "asc" },
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

    // ── Multi-currency price resolution ──────────────────────────────────────
    // Resolve prices for the primary variant (if any) from active PriceLists.
    // Falls back gracefully: when no PriceLists are configured the flat variant
    // fields (mrp / sellingPrice) and INR defaults are used unchanged.
    // Sort: default price list first so marketPrices[0] is the primary price.
    const primaryPrices: MarketPrice[] = primaryVariant
      ? this.priceResolution.fromRows(
          [...primaryVariant.prices].sort((a, b) =>
            (b.priceList.isDefault ? 1 : 0) - (a.priceList.isDefault ? 1 : 0),
          ),
        )
      : [];
    const defaultPrice = this.priceResolution.findDefault(primaryPrices);
    const currencyCode = defaultPrice?.currencyCode ?? "INR";

    const sku = this.firstNonEmptyString(
      primaryVariant?.skuCode,
      attributes.sku,
      product.id,
    );
    // Prefer the default PriceList price; fall back to flat variant / attributes fields.
    const mrp = this.firstNumber(
      defaultPrice?.mrp,
      primaryVariant?.mrp,
      pricing.mrp,
      attributes.mrp,
      attributes.price,
    );
    const sellingPrice = this.firstNumber(
      defaultPrice?.sellingPrice,
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

    const payload: ProductPayload = {
      sku,
      title: this.firstNonEmptyString(product.title),
      description: this.firstNonEmptyString(product.description),
      brand: this.firstNonEmptyString(product.brand),
      hsnCode: this.firstNonEmptyString(product.hsnCode),
      gstRate: this.firstNumber(product.gstRate),
      taxCodes: product.taxCodes.length > 0
        ? product.taxCodes.map((tc) => ({
            regimeKey: tc.marketCode,   // denormalized — no extra join
            key: String(tc.key),
            value: tc.value,
            rate: tc.rate ?? undefined,
          }))
        : undefined,
      currencyCode,
      marketPrices: primaryPrices.length > 0 ? primaryPrices : undefined,
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
    return this.applyMappedConnectorTargets(payload, {
      ...options,
      categoryId: product.category.id,
    });
  }

  private async applyMappedConnectorTargets(
    payload: ProductPayload,
    options: ConnectorProductPayloadOptions & { categoryId: string },
  ): Promise<ProductPayload> {
    const connectorSlug = String(
      options.connectorSlug ?? (options.channel ? this.mapChannelToConnectorSlug(options.channel) : ""),
    ).trim().toLowerCase();
    if (connectorSlug !== "shopify") {
      if (connectorSlug !== "woocommerce") {
        return payload;
      }
      if (!this.woocommerceMappedMetaEnabled()) {
        return payload;
      }
      const resolved = await this.connectorMappingService.resolveEffectiveMapping({
        connectorSlug,
        categoryScope: options.categoryId,
        installationId: options.installationId,
      });
      const fieldMap = this.asRecord(resolved.resolvedMapping?.field_mappings);
      const mappedMeta = this.compileWooCommerceMetaFromMapping(payload, fieldMap);
      if (mappedMeta.length === 0) {
        return payload;
      }
      return {
        ...payload,
        customMeta: [...(payload.customMeta ?? []), ...mappedMeta],
      };
    }
    if (!this.shopifyMappedMetafieldsEnabled()) {
      return payload;
    }

    const channel = options.channel ?? this.mapConnectorSlugToChannel(connectorSlug);
    const mapping = await this.getEffectiveMapping(
      channel,
      options.categoryId,
      options.templateId,
      options.installationId,
    );
    const mappedMetafields = this.compileShopifyMetafieldsFromMapping(payload, mapping.rawFieldMap ?? mapping.fieldMap);
    if (mappedMetafields.length === 0) {
      return payload;
    }
    return {
      ...payload,
      metafields: [...(payload.metafields ?? []), ...mappedMetafields],
    };
  }

  private compileShopifyMetafieldsFromMapping(
    payload: ProductPayload,
    fieldMap: Record<string, unknown>,
  ): NonNullable<ProductPayload["metafields"]> {
    const metafields: NonNullable<ProductPayload["metafields"]> = [];
    const seen = new Set<string>();
    const attributes = this.asRecord(payload.attributes);

    for (const [sourceField, rawTargetField] of Object.entries(fieldMap)) {
      const rawValue = this.getFieldValue(sourceField, payload, attributes);
      for (const target of this.normalizeShopifyMetafieldTargets(rawTargetField)) {
        const value = this.applyFieldTransform(rawValue, target.transform, payload, attributes);
        if (this.isEmpty(value)) {
          continue;
        }
        const identity = `${target.namespace}.${target.key}`;
        if (seen.has(identity)) {
          continue;
        }
        seen.add(identity);
        metafields.push({
          namespace: target.namespace,
          key: target.key,
          type: target.type,
          value,
        });
      }
    }

    return metafields;
  }

  private compileWooCommerceMetaFromMapping(
    payload: ProductPayload,
    fieldMap: Record<string, unknown>,
  ): NonNullable<ProductPayload["customMeta"]> {
    const customMeta: NonNullable<ProductPayload["customMeta"]> = [];
    const seen = new Set<string>();
    const attributes = this.asRecord(payload.attributes);

    for (const [sourceField, rawTargetField] of Object.entries(fieldMap)) {
      const rawValue = this.getFieldValue(sourceField, payload, attributes);
      for (const target of this.normalizeWooCommerceMetaTargets(rawTargetField)) {
        const value = this.applyFieldTransform(rawValue, target.transform, payload, attributes);
        if (this.isEmpty(value)) {
          continue;
        }
        if (seen.has(target.key)) {
          continue;
        }
        seen.add(target.key);
        customMeta.push({ key: target.key, value });
      }
    }

    return customMeta;
  }

  /**
   * Applies an optional mapping transform to a resolved source value. Transforms are carried on
   * structured targets (see parseStructured*Target) as a `transform` object; legacy string
   * targets never carry a transform and pass the raw value through unchanged.
   *
   * `concat` is the one case that ignores `rawValue` entirely — it resolves its own set of
   * source paths, since concatenation is inherently a multi-source operation and the field_mappings
   * shape only naturally hands the compiler one resolved source value per target.
   */
  private applyFieldTransform(
    rawValue: unknown,
    transform: Record<string, unknown> | undefined,
    payload: ProductPayload,
    attributes: Record<string, unknown>,
  ): unknown {
    if (!transform) {
      return rawValue;
    }
    const type = String(transform.type ?? "").trim().toLowerCase();
    switch (type) {
      case "default":
        return this.isEmpty(rawValue) ? transform.value : rawValue;

      case "concat": {
        const sources = Array.isArray(transform.sources) ? transform.sources : [];
        const separator = typeof transform.separator === "string" ? transform.separator : " ";
        const parts = sources
          .map((source) => this.getFieldValue(String(source ?? "").trim(), payload, attributes))
          .filter((part) => !this.isEmpty(part))
          .map((part) => String(part));
        return parts.length > 0 ? parts.join(separator) : undefined;
      }

      case "format": {
        if (this.isEmpty(rawValue)) {
          return rawValue;
        }
        const template = typeof transform.template === "string" && transform.template.includes("{value}")
          ? transform.template
          : "{value}";
        return template.replace(/\{value\}/g, String(rawValue));
      }

      case "units": {
        const numeric = typeof rawValue === "number" ? rawValue : Number.parseFloat(String(rawValue ?? ""));
        if (!Number.isFinite(numeric)) {
          return rawValue;
        }
        const factor = typeof transform.factor === "number"
          ? transform.factor
          : this.resolveUnitConversionFactor(String(transform.from ?? ""), String(transform.to ?? ""));
        if (factor === undefined) {
          return rawValue;
        }
        return Math.round(numeric * factor * 1000) / 1000;
      }

      case "list": {
        const mode = String(transform.mode ?? "join").trim().toLowerCase();
        if (mode === "wrap") {
          if (Array.isArray(rawValue)) {
            return rawValue;
          }
          return this.isEmpty(rawValue) ? [] : [rawValue];
        }
        // mode === "join" (default): array -> delimited string; scalars pass through unchanged.
        if (Array.isArray(rawValue)) {
          const separator = typeof transform.separator === "string" ? transform.separator : ", ";
          return rawValue.map((item) => String(item ?? "").trim()).filter(Boolean).join(separator);
        }
        return rawValue;
      }

      case "lookup": {
        const table = transform.table && typeof transform.table === "object" && !Array.isArray(transform.table)
          ? (transform.table as Record<string, unknown>)
          : {};
        const lookupKey = String(rawValue ?? "");
        if (Object.prototype.hasOwnProperty.call(table, lookupKey)) {
          return table[lookupKey];
        }
        return Object.prototype.hasOwnProperty.call(transform, "fallback") ? transform.fallback : rawValue;
      }

      case "locale": {
        const locale = String(transform.locale ?? "").trim();
        const values = transform.values && typeof transform.values === "object" && !Array.isArray(transform.values)
          ? (transform.values as Record<string, unknown>)
          : {};
        if (locale && Object.prototype.hasOwnProperty.call(values, locale)) {
          return values[locale];
        }
        return Object.prototype.hasOwnProperty.call(transform, "fallback") ? transform.fallback : rawValue;
      }

      default:
        return rawValue;
    }
  }

  private resolveUnitConversionFactor(from: string, to: string): number | undefined {
    const UNIT_CONVERSION_FACTORS: Record<string, number> = {
      "kg->g": 1000,
      "g->kg": 0.001,
      "lb->kg": 0.453592,
      "kg->lb": 2.20462,
      "cm->in": 0.393701,
      "in->cm": 2.54,
      "m->cm": 100,
      "cm->m": 0.01,
      "mm->cm": 0.1,
      "cm->mm": 10,
    };
    return UNIT_CONVERSION_FACTORS[`${from.trim().toLowerCase()}->${to.trim().toLowerCase()}`];
  }

  private extractTransformSpec(raw: Record<string, unknown>): Record<string, unknown> | undefined {
    return raw.transform && typeof raw.transform === "object" && !Array.isArray(raw.transform)
      ? (raw.transform as Record<string, unknown>)
      : undefined;
  }

  private normalizeWooCommerceMetaTargets(
    rawTargetField: unknown,
  ): Array<{ key: string; transform?: Record<string, unknown> }> {
    const rawTargets = Array.isArray(rawTargetField) ? rawTargetField : [rawTargetField];
    const targets: Array<{ key: string; transform?: Record<string, unknown> }> = [];
    for (const rawTarget of rawTargets) {
      const structured = this.parseStructuredWooCommerceMetaTarget(rawTarget);
      if (structured) {
        targets.push(structured);
        continue;
      }
      const stringTarget = this.parseWooCommerceMetaTarget(String(rawTarget ?? ""));
      if (stringTarget) {
        targets.push(stringTarget);
      }
    }
    return targets;
  }

  private parseStructuredWooCommerceMetaTarget(
    target: unknown,
  ): { key: string; transform?: Record<string, unknown> } | null {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      return null;
    }
    const raw = target as Record<string, unknown>;
    const connector = String(raw.connector ?? raw.channel ?? "woocommerce").trim().toLowerCase();
    const kind = String(raw.kind ?? raw.targetType ?? raw.type ?? "").trim().toLowerCase();
    const key = this.normalizeWooCommerceMetaKey(String(raw.metaKey ?? raw.key ?? ""));
    const isMetaTarget =
      connector === "woocommerce" &&
      (kind.includes("meta") || Boolean(raw.metaKey) || Boolean(raw.key));
    if (!isMetaTarget || !key) {
      return null;
    }
    return { key, transform: this.extractTransformSpec(raw) };
  }

  private parseWooCommerceMetaTarget(targetField: string): { key: string } | null {
    const target = String(targetField ?? "").trim();
    const prefixes = ["meta_data.", "metadata.", "customMeta.", "woocommerceMeta.", "productMeta."];
    const prefix = prefixes.find((item) => target.startsWith(item));
    if (!prefix) {
      return null;
    }
    const key = this.normalizeWooCommerceMetaKey(target.slice(prefix.length));
    return key ? { key } : null;
  }

  private normalizeWooCommerceMetaKey(value: string): string {
    return String(value ?? "")
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 255);
  }

  private normalizeShopifyMetafieldTargets(
    rawTargetField: unknown,
  ): Array<{ namespace: string; key: string; type: string; transform?: Record<string, unknown> }> {
    const rawTargets = Array.isArray(rawTargetField) ? rawTargetField : [rawTargetField];
    const targets: Array<{ namespace: string; key: string; type: string; transform?: Record<string, unknown> }> = [];
    for (const rawTarget of rawTargets) {
      const structured = this.parseStructuredShopifyMetafieldTarget(rawTarget);
      if (structured) {
        targets.push(structured);
        continue;
      }
      const stringTarget = this.parseShopifyMetafieldTarget(String(rawTarget ?? ""));
      if (stringTarget) {
        targets.push(stringTarget);
      }
    }
    return targets;
  }

  private parseStructuredShopifyMetafieldTarget(
    target: unknown,
  ): { namespace: string; key: string; type: string; transform?: Record<string, unknown> } | null {
    if (!target || typeof target !== "object" || Array.isArray(target)) {
      return null;
    }
    const raw = target as Record<string, unknown>;
    const connector = String(raw.connector ?? raw.channel ?? "shopify").trim().toLowerCase();
    const kind = String(raw.kind ?? raw.targetType ?? raw.type ?? "").trim().toLowerCase();
    const namespace = this.normalizeShopifyMetafieldIdentifier(String(raw.namespace ?? ""));
    const key = this.normalizeShopifyMetafieldIdentifier(String(raw.key ?? ""));
    const metafieldType = String(raw.metafieldType ?? raw.valueType ?? raw.fieldType ?? raw.type ?? "single_line_text_field").trim();
    const isMetafieldTarget =
      connector === "shopify" &&
      (kind.includes("metafield") || (Boolean(namespace) && Boolean(key)));
    if (!isMetafieldTarget || !namespace || !key) {
      return null;
    }
    return {
      namespace,
      key,
      type: metafieldType || "single_line_text_field",
      transform: this.extractTransformSpec(raw),
    };
  }

  private parseShopifyMetafieldTarget(targetField: string): { namespace: string; key: string; type: string } | null {
    const target = String(targetField ?? "").trim();
    const prefixes = ["metafields.", "productMetafields."];
    const prefix = prefixes.find((item) => target.startsWith(item));
    if (!prefix) {
      return null;
    }
    const remainder = target.slice(prefix.length).trim();
    if (!remainder) {
      return null;
    }
    const parts = remainder.split(".").map((part) => this.normalizeShopifyMetafieldIdentifier(part)).filter(Boolean);
    const namespace = parts.length >= 2 ? parts[0] : "pim_connector";
    const key = parts.length >= 2 ? parts.slice(1).join("_") : parts[0];
    if (!namespace || !key) {
      return null;
    }
    return { namespace, key, type: "single_line_text_field" };
  }

  private normalizeShopifyMetafieldIdentifier(value: string): string {
    return String(value ?? "")
      .trim()
      .replace(/[^A-Za-z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 64);
  }

  private shopifyMappedMetafieldsEnabled(): boolean {
    return String(process.env.PIM_SHOPIFY_MAPPED_METAFIELDS_ENABLED ?? "true").trim().toLowerCase() !== "false";
  }

  private woocommerceMappedMetaEnabled(): boolean {
    return String(process.env.PIM_WOOCOMMERCE_MAPPED_META_ENABLED ?? "true").trim().toLowerCase() !== "false";
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

    const mainAsset = await this.prisma.tenant().mediaAsset.findFirst({
      where: { productId, metadata: { path: ["isMain"], equals: true } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, storagePath: true },
    });
    const asset =
      mainAsset ??
      (await this.prisma.tenant().mediaAsset.findFirst({
        where: { productId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true, storagePath: true },
      }));
    const storagePath = String(asset?.storagePath ?? "").trim();
    if (!asset || !storagePath) {
      return "";
    }

    if (this.mediaStorage.isLocalMode()) {
      const apiBase = String(process.env.PIM_API_BASE_URL ?? "").trim().replace(/\/+$/, "");
      if (!apiBase) {
        this.logger.warn("PIM_API_BASE_URL is not configured; local media asset cannot be resolved for connector payload.", {
          productId,
        });
        return "";
      }
      return `${apiBase}/media/assets/${asset.id}/file`;
    }

    const publicBase = String(process.env.R2_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
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
      take: 10_000, // defensive cap — large installations can have many failed submissions
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
    const db = this.prisma.tenant();
    const installation = await db.connectorInstallation.findFirst({
      where: { id: installationId },
      select: { id: true, connectorId: true, tenantKey: true },
    });
    if (!installation) {
      throw new NotFoundException("Connector installation not found.");
    }

    const [connectorDef, failed] = await Promise.all([
      db.connectorDefinition.findUnique({
        where: { id: installation.connectorId },
        select: { slug: true },
      }),
      db.connectorSubmission.findMany({
        where: { installationId, status: "FAILED" },
        take: 10_000, // defensive cap — large installations can have many failed submissions
        select: { productId: true, channelErrors: true },
      }),
    ]);
    const connectorSlug = connectorDef?.slug ?? "shopify";
    const channel = this.mapConnectorSlugToChannel(connectorSlug);

    const eligible = failed.filter((sub) => {
      const errors = Array.isArray(sub.channelErrors) ? sub.channelErrors : [];
      const firstError = errors[0] as Record<string, unknown> | undefined;
      const family = String(firstError?.code ?? "UNKNOWN_ERROR").trim() || "UNKNOWN_ERROR";
      return family === errorFamily;
    });

    const uniqueProductIds = [...new Set(eligible.map((s) => s.productId))];

    // Batch-fetch categoryId for all eligible products — avoids N+1 findUnique inside the loop.
    const productRows = await db.product.findMany({
      where: { id: { in: uniqueProductIds } },
      select: { id: true, categoryId: true },
      take: uniqueProductIds.length,
    });
    const categoryIdByProduct = new Map(productRows.map((p) => [p.id, p.categoryId]));

    const createdBy = actor?.actorId?.trim() ? actor.actorId.trim() : null;

    // Parallel job creation + enqueue — each product is independent.
    // Promise.allSettled so a single failure doesn't abort the rest.
    const results = await Promise.allSettled(
      uniqueProductIds.map(async (productId) => {
        const categoryId = categoryIdByProduct.get(productId);
        if (!categoryId) throw new Error("missing_category");
        const job = await db.marketplaceExportJob.create({
          data: {
            createdBy,
            productId,
            categoryId,
            channel,
            installationId,
            status: ExportJobStatus.queued,
            retryCount: 0,
            maxRetries: 3,
            payload: {} as Prisma.JsonObject,
          },
        });
        await this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
          jobId: job.id,
          connectorSlug,
        } satisfies ConnectorWorkerPayload, { jobId: `${job.id}_${job.retryCount}` });
      }),
    );

    const queued = results.filter((r) => r.status === "fulfilled").length;
    return { queued };
  }

  async previewProductChanges(
    installationId: string,
    productId: string,
  ): Promise<ShopifyProductPreview & { resolvedInstallationId: string }> {
    const db = this.prisma.tenant();

    const connectorDef = await db.connectorInstallation.findFirst({
      where: { id: installationId },
      select: { id: true, connectorId: true, tenantKey: true, externalAccountRef: true, metadata: true },
    });
    if (!connectorDef) {
      throw new NotFoundException("Connector installation not found.");
    }

    const defRow = await db.connectorDefinition.findUnique({
      where: { id: connectorDef.connectorId },
      select: { slug: true },
    });
    const connectorSlug = defRow?.slug ?? "shopify";

    const resolvedInstallationId = await this.resolvePublishingDestination(connectorSlug, installationId);

    const latestSubmission = await db.connectorSubmission.findFirst({
      where: { installationId: resolvedInstallationId, productId, status: "SUCCESS" },
      orderBy: { submittedAt: "desc" },
      select: { externalRef: true },
    });

    let shopifyGid: string | null = null;
    const ref = latestSubmission?.externalRef ?? null;
    if (ref && /^gid:\/\/shopify\/Product\//.test(ref)) {
      shopifyGid = ref;
    }

    if (!shopifyGid) {
      return { hasExistingProduct: false, noChanges: false, changes: [], resolvedInstallationId };
    }

    const payload = await this.buildConnectorProductPayload(productId, {
      connectorSlug,
      installationId: resolvedInstallationId,
    });

    const connector = this.connectorRegistry.getConnector(connectorSlug) as unknown as {
      previewChanges: (ctx: unknown, product: ProductPayload, gid: string) => Promise<ShopifyProductPreview>;
    };

    const ctx = this.connectorFramework.buildContextForInstallation({
      id: resolvedInstallationId,
      tenantKey: connectorDef.tenantKey,
      connectorId: connectorDef.connectorId,
      slug: connectorSlug,
      metadata: (connectorDef.metadata ?? {}) as Record<string, unknown>,
    });

    const preview = await connector.previewChanges(ctx, payload, shopifyGid);
    return { ...preview, resolvedInstallationId };
  }

  // ─── Sprint 2: Shopify config import ──────────────────────────────────────

  async importShopifyConfig(installationId: string): Promise<ShopifyConfigResult> {
    const db = this.prisma.tenant();
    const installation = await this.resolveInstallationWithSlug(installationId, db);
    if (!installation) {
      throw new NotFoundException("Connector installation not found.");
    }
    const connectorSlug = installation.connectorSlug;

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
    const installation = await this.resolveInstallationWithSlug(installationId, db);
    if (!installation) {
      throw new NotFoundException("Connector installation not found.");
    }
    const connectorSlug = installation.connectorSlug;

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

  /**
   * Single-query delta candidate scan using a DB-side LEFT JOIN.
   *
   * Replaces the old two-step approach (load N products → load sync states →
   * filter in-memory) with one query that returns ONLY products genuinely out
   * of sync with the given installation:
   *   • No sync state row exists yet  (new installation, first-time sync), OR
   *   • Product version > last_synced_version  (product changed since last push).
   *
   * Supports keyset cursor pagination (ORDER BY p.id ASC; cursor = last id seen)
   * so that queueDeltaSync can page through catalogs of up to 99 999 SKUs
   * (ENTERPRISE plan limit) without loading the full table into memory.
   */
  private async fetchDeltaCandidatesPage(
    installationId: string,
    tenantKey: string,
    cursor: string | null,
    take: number,
  ): Promise<Array<{ product_id: string; version: number; category_id: string }>> {
    return tenantRaw<Array<{ product_id: string; version: number; category_id: string }>>(
      this.prisma.tenant(tenantKey),
      `SELECT p.id                   AS product_id,
              COALESCE(p.version, 0) AS version,
              p."categoryId"         AS category_id
       FROM   "Product" p
       LEFT JOIN connector_product_sync_states s
              ON  s.product_id     = p.id
              AND s.installation_id = $1
              AND s.tenant_key     = $2
       WHERE  p."tenantKey"  = $2
         AND  p.status       = 'approved'
         AND  p."deletedAt" IS NULL
         AND  (s.product_id IS NULL
               OR COALESCE(p.version, 0) > COALESCE(s.last_synced_version, -1))
         AND  ($3::text IS NULL OR p.id > $3)
       ORDER BY p.id ASC
       LIMIT $4`,
      [installationId, tenantKey, cursor, take],
    );
  }

  /**
   * Operational monitoring endpoint — returns a live breakdown of export-job
   * statuses for a given installation so that operators can track progress of a
   * running delta sync without needing an async SyncRun record.
   *
   * All counts are scoped to jobs where installationId = the requested value.
   * A `pendingRatio` field (queued+processing+retrying / total) lets the caller
   * render a progress bar without doing arithmetic.
   */
  async getDeltaSyncStatus(installationId: string): Promise<{
    installationId: string;
    total: number;
    queued: number;
    processing: number;
    retrying: number;
    skipped: number;
    completed: number;
    failed: number;
    dead_letter: number;
    pendingRatio: number;
    lastUpdatedAt: string | null;
  }> {
    const db = this.prisma.tenant();

    const [statusCounts, lastJob] = await Promise.all([
      db.marketplaceExportJob.groupBy({
        by: ["status"],
        where: { installationId },
        _count: { _all: true },
      }),
      db.marketplaceExportJob.findFirst({
        where: { installationId },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
    ]);

    const counts: Record<string, number> = Object.fromEntries(
      statusCounts.map((r) => [r.status as string, r._count._all]),
    );

    const total = statusCounts.reduce((acc, r) => acc + r._count._all, 0);
    const inFlight =
      (counts["queued"] ?? 0) +
      (counts["processing"] ?? 0) +
      (counts["retrying"] ?? 0);

    return {
      installationId,
      total,
      queued: counts["queued"] ?? 0,
      processing: counts["processing"] ?? 0,
      retrying: counts["retrying"] ?? 0,
      skipped: counts["skipped"] ?? 0,
      completed: counts["completed"] ?? 0,
      failed: counts["failed"] ?? 0,
      dead_letter: counts["dead_letter"] ?? 0,
      pendingRatio: total > 0 ? inFlight / total : 0,
      lastUpdatedAt: lastJob?.updatedAt.toISOString() ?? null,
    };
  }

  /**
   * Returns up to 5 000 delta-sync candidates for the UI preview endpoint.
   * The actual job-queuing path (queueDeltaSync) uses fetchDeltaCandidatesPage
   * with full cursor pagination and processes the entire catalog.
   */
  async getDeltaSyncCandidates(installationId: string): Promise<{ productId: string; version: number }[]> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const rows = await this.fetchDeltaCandidatesPage(installationId, tenantKey, null, 5_000);
    return rows.map((r) => ({ productId: r.product_id, version: r.version }));
  }

  async queueDeltaSync(
    installationId: string,
    actor?: PolicyActor,
  ): Promise<{ queued: number; skipped: number }> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const db = this.prisma.tenant(tenantKey);
    const installation = await this.resolveInstallationWithSlug(installationId, db);
    if (!installation) throw new NotFoundException("Installation not found.");

    if (!installation.capabilities.includes("PUBLISH")) {
      throw new BadRequestException("This connector does not support publish — delta sync not available.");
    }

    const channel = installation.connectorSlug;
    const createdBy = actor?.actorId?.trim() ? actor.actorId.trim() : "delta_sync";
    let queued = 0;
    let skipped = 0;
    let cursor: string | null = null;
    const PAGE_SIZE = 200;

    // Cursor-paginated loop — processes the full catalog in 200-row pages so that
    // ENTERPRISE tenants with up to 99 999 approved products are handled correctly.
    do {
      const page = await this.fetchDeltaCandidatesPage(installationId, tenantKey, cursor, PAGE_SIZE);
      if (page.length === 0) break;

      // Parallel job creation — Promise.allSettled so one conflict/error doesn't
      // abort the whole batch; each rejection is counted as skipped.
      // The partial unique index (active states only) prevents duplicate active jobs;
      // terminal jobs are never mutated — a new row is created instead.
      const results = await Promise.allSettled(
        page.map(async ({ product_id: productId, category_id: categoryId }) => {
          if (!categoryId) return Promise.reject(new Error("missing_category"));
          try {
            return await db.marketplaceExportJob.create({
              data: {
                tenantKey,
                productId,
                categoryId,
                channel,
                installationId,
                status: ExportJobStatus.queued,
                maxRetries: 3,
                retryCount: 0,
                createdBy,
              },
              select: { id: true },
            });
          } catch (err: unknown) {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === "P2002"
            ) {
              // Active job already exists for this product+installation — skip
              return { id: "concurrent-active" };
            }
            throw err;
          }
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled") queued++;
        else skipped++;
      }

      if (page.length < PAGE_SIZE) break; // partial page → catalog exhausted
      cursor = page[page.length - 1]!.product_id;
    } while (true); // eslint-disable-line no-constant-condition

    return { queued, skipped };
  }

  /**
   * Convenience wrapper used by processExportJob: fetches the product version and
   * upserts sync state in a single non-fatal call. All errors are silenced so that
   * failure here never disrupts the export result returned to the job worker.
   */
  private async persistSyncStateForProduct(
    installationId: string | null | undefined,
    productId: string,
    outcome: "SUCCESS" | "ERROR",
  ): Promise<void> {
    if (!installationId) return;
    const syncProduct = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      select: { version: true },
    }).catch(() => null);
    if (!syncProduct) return;
    await this.upsertSyncState(
      installationId,
      productId,
      syncProduct.version ?? 1,
      outcome,
    ).catch(() => { /* non-critical — delta sync will re-process next cycle */ });
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

    const CRON_FIELD_RANGES: Array<[number, number]> = [[0,59],[0,23],[1,31],[1,12],[0,7]];
    const cronFields = cronExpression.trim().split(/\s+/);
    const checkFields = cronFields.length === 6 ? cronFields.slice(1) : cronFields;
    if (cronFields.length < 5 || cronFields.length > 6 || !checkFields.every((f, i) => {
      if (f === "*") return true;
      for (const part of f.split(",")) {
        const sm = part.match(/^(.+)\/(\d+)$/);
        const base = sm ? sm[1] : part;
        if (sm && (!Number.isInteger(Number(sm[2])) || Number(sm[2]) < 1)) return false;
        if (base === "*") continue;
        const rm = base.match(/^(\d+)-(\d+)$/);
        if (rm) { const [lo,hi] = [Number(rm[1]),Number(rm[2])]; if (lo < CRON_FIELD_RANGES[i][0] || hi > CRON_FIELD_RANGES[i][1] || lo > hi) return false; continue; }
        const n = Number(base);
        if (!Number.isInteger(n) || n < CRON_FIELD_RANGES[i][0] || n > CRON_FIELD_RANGES[i][1]) return false;
      }
      return true;
    })) {
      throw new BadRequestException("cronExpression must be a valid 5 or 6-field cron expression with values in range.");
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
      take: 10_000, // defensive cap — one SUCCESS submission per submitted product
    });

    const products = await db.product.findMany({
      where: { status: "approved" },
      select: { id: true, title: true, variants: { take: 1, select: { skuCode: true } } },
      take: 10_000, // raised from 500 — covers ENTERPRISE plan (up to 99 999 SKUs)
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
    const confirmedBy = actor?.actorId ?? null;

    const results = await Promise.allSettled(
      links.map((link) =>
        tenantExecRaw(
          this.prisma.tenant(tenantKey),
          `INSERT INTO connector_product_links (id, tenant_key, installation_id, product_id, shopify_gid, matched_by, confirmed_at, confirmed_by, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, NOW(), NOW())
           ON CONFLICT (tenant_key, installation_id, product_id)
           DO UPDATE SET shopify_gid = $5, matched_by = $6, confirmed_at = NOW(), confirmed_by = $7, updated_at = NOW()`,
          [randomUUID(), tenantKey, installationId, link.productId, link.shopifyGid, link.matchedBy, confirmedBy],
        ),
      ),
    );

    return { confirmed: results.filter((r) => r.status === "fulfilled").length };
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
  ): Promise<{
    feedId: string;
    feedDocumentId: string;
    productCount: number;
    submissionIds: string[];
    excluded: Array<{ productId: string; reason: string }>;
  }> {
    if (!productIds.length) {
      throw new BadRequestException("productIds must contain at least one product.");
    }

    const db = this.prisma.tenant();
    const tenantKey = this.connectorFramework.getCurrentTenantKey();

    const installationRow = await this.resolveInstallationWithSlug(installationId, db);
    if (!installationRow) {
      throw new NotFoundException("Connector installation not found.");
    }

    // Bulk-publish previously skipped both the internal-approval-status check and the
    // destination-readiness check that the single-product path (createExportJob, above)
    // enforces — a product could reach a live marketplace feed without ever being
    // approved or without a valid mapping/credentials. Gate each product independently
    // here rather than failing the whole batch for one ineligible product.
    const excluded: Array<{ productId: string; reason: string }> = [];
    const eligibleProductIds: string[] = [];
    for (const productId of productIds) {
      const product = await db.product.findUnique({
        where: { id: productId },
        select: { id: true, status: true, categoryId: true },
      });
      if (!product) {
        excluded.push({ productId, reason: "Product not found." });
        continue;
      }
      if (product.status !== "approved" && product.status !== "active") {
        excluded.push({
          productId,
          reason: `Product must be approved before publishing. Current status: ${product.status}.`,
        });
        continue;
      }
      const readiness = await this.connectorMappingService.evaluatePublishReadiness({
        connectorSlug: installationRow.connectorSlug,
        categoryScope: product.categoryId,
        installationId,
        productId,
      });
      if (!readiness.ok) {
        excluded.push({ productId, reason: readiness.blockers.join("; ") || "Not ready for this destination." });
        continue;
      }
      eligibleProductIds.push(productId);
    }

    if (!eligibleProductIds.length) {
      throw new BadRequestException({
        error: "no_eligible_products",
        message: "No products in this batch are approved and publish-ready.",
        excluded,
      });
    }

    const installation = await this.connectorFramework.requireInstallation(
      tenantKey,
      installationRow.connectorSlug,
      installationId,
    );

    // Connectors without a native async feed API (Shopify, WooCommerce, ...) can't produce
    // a single BulkSubmissionRef the way Amazon's Feeds API does — each product publishes
    // synchronously via its own GraphQL/REST call. For those, fall back to queuing one
    // MarketplaceExportJob per eligible product through the same connector-agnostic pipeline
    // createExportJob already uses for the single-product "Queue channel export" action —
    // proven to work for Shopify — instead of forcing them through the Amazon-shaped path.
    if (!installation.capabilities.includes("BULK_PUBLISH")) {
      return this.bulkPublishViaQueuedExportJobs(installationRow.connectorSlug, installationId, eligibleProductIds, excluded);
    }

    const products = await Promise.all(
      eligibleProductIds.map((id) =>
        this.buildConnectorProductPayload(id, {
          connectorSlug: installationRow.connectorSlug,
          installationId,
        }),
      ),
    );

    const bulkRef = await this.connectorFramework.publishBulk(installation, products);

    const submissionIds: string[] = [];
    for (let i = 0; i < bulkRef.skus.length; i++) {
      const sku = bulkRef.skus[i];
      const productId = eligibleProductIds[i] ?? eligibleProductIds[0];
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
      excludedCount: excluded.length,
    });

    return {
      feedId: bulkRef.feedId,
      feedDocumentId: bulkRef.feedDocumentId,
      productCount: bulkRef.productCount,
      submissionIds,
      excluded,
    };
  }

  /**
   * Fallback bulk-publish path for connectors without a native async batch/feed API
   * (Shopify, WooCommerce, ...). These publish synchronously per product — there is no
   * single feed submission to poll for status the way Amazon's Feeds API works, so they
   * can't produce a real BulkSubmissionRef. Instead, queue one MarketplaceExportJob per
   * eligible product through the exact same connector-agnostic pipeline createExportJob
   * already uses for the single-product "Queue channel export" action (queued job →
   * CONNECTOR_SUBMISSION queue → connector.publishProduct), reusing its idempotency,
   * readiness re-check, and retry handling as-is rather than duplicating any of it here.
   * One product failing is added to `excluded`, not a batch-wide failure.
   *
   * `feedId`/`feedDocumentId` are synthesized (prefixed `queued-batch:`) to keep the
   * response shape identical to the Amazon path for existing callers — they are not real
   * external feed identifiers, only a label for this batch in logs.
   */
  private async bulkPublishViaQueuedExportJobs(
    connectorSlug: string,
    installationId: string,
    eligibleProductIds: string[],
    excluded: Array<{ productId: string; reason: string }>,
  ): Promise<{
    feedId: string;
    feedDocumentId: string;
    productCount: number;
    submissionIds: string[];
    excluded: Array<{ productId: string; reason: string }>;
  }> {
    const channel = this.mapConnectorSlugToChannel(connectorSlug);

    const outcomes = await this.runWithConcurrency(
      eligibleProductIds.map((productId) => async () => {
        try {
          const job = await this.createExportJob(productId, { channel, installationId }, undefined);
          return { productId, jobId: job.id as string };
        } catch (error: unknown) {
          const reason = error instanceof Error ? error.message : String(error);
          return { productId, error: reason };
        }
      }),
      5,
    );

    const submissionIds: string[] = [];
    const allExcluded = [...excluded];
    for (const outcome of outcomes) {
      if (outcome.jobId) {
        submissionIds.push(outcome.jobId);
      } else {
        allExcluded.push({ productId: outcome.productId, reason: outcome.error ?? "Failed to queue export job." });
      }
    }

    const batchId = `queued-batch:${randomUUID()}`;
    this.logger.warn("Bulk publish queued via per-product export jobs (connector has no native batch API)", {
      installationId,
      connectorSlug,
      batchId,
      productCount: submissionIds.length,
      excludedCount: allExcluded.length,
    });

    return {
      feedId: batchId,
      feedDocumentId: batchId,
      productCount: submissionIds.length,
      submissionIds,
      excluded: allExcluded,
    };
  }

  // ─── Meesho Excel export ─────────────────────────────────────────────────

  async triggerConnectorExport(
    installationId: string,
    productIds: string[],
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    if (!productIds || productIds.length === 0) {
      throw new BadRequestException("productIds must contain at least one product ID.");
    }

    const db = this.prisma.tenant();
    const tenantKey = this.connectorFramework.getCurrentTenantKey();

    const installationRow = await this.resolveInstallationWithSlug(installationId, db);
    if (!installationRow) {
      throw new NotFoundException("Connector installation not found.");
    }

    const [installation, products] = await Promise.all([
      this.connectorFramework.requireInstallation(tenantKey, installationRow.connectorSlug, installationId),
      Promise.all(
        productIds.map((id) =>
          this.buildConnectorProductPayload(id, {
            connectorSlug: installationRow.connectorSlug,
            installationId,
          }),
        ),
      ),
    ]);

    const exportFile = await this.connectorFramework.exportProducts(installation, products);

    return exportFile;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Single-query JOIN: ConnectorInstallation + ConnectorDefinition.
   *
   * Prisma has no @relation between these two models (connector_id is an
   * untyped FK in the schema), so we use $queryRaw for a proper LEFT JOIN.
   * This collapses the repeated findFirst(installation) → findUnique(definition)
   * pattern that appears across several methods into one round-trip.
   *
   * Returns null when the installation does not exist.
   */
  private async resolveInstallationWithSlug(
    installationId: string,
    db: ReturnType<typeof this.prisma.tenant>,
  ): Promise<{
    id: string;
    connectorId: string;
    tenantKey: string;
    connectorSlug: string;
    capabilities: string[];
  } | null> {
    const rows = await db.$queryRaw<
      Array<{
        id: string;
        connectorId: string;
        tenantKey: string;
        connectorSlug: string | null;
        capabilities: unknown;
      }>
    >(Prisma.sql`
      SELECT
        ci.id           AS "id",
        ci.connector_id AS "connectorId",
        ci.tenant_key   AS "tenantKey",
        cd.slug         AS "connectorSlug",
        cd.capabilities AS "capabilities"
      FROM connector_installations ci
      LEFT JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.id = ${installationId}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;

    // Prisma's $queryRaw may return a PostgreSQL text[] as a JS array or as
    // the "{val1,val2}" string literal — handle both forms defensively.
    let capabilities: string[] = [];
    if (Array.isArray(row.capabilities)) {
      capabilities = (row.capabilities as unknown[]).map(String);
    } else {
      const raw = String(row.capabilities ?? "").trim();
      if (raw.startsWith("{") && raw.endsWith("}")) {
        capabilities = raw.slice(1, -1).split(",").filter(Boolean);
      }
    }

    if (!row.connectorSlug) {
      // ConnectorInstallation.connectorId has no DB-level FK constraint (plain String,
      // no @relation). If the definition row is missing/deleted, silently defaulting to
      // "shopify" would route the request to the wrong connector.  Fail fast instead.
      throw new NotFoundException(
        `Connector definition not found for installation ${installationId}. ` +
        "The connector may have been removed. Re-install the connector to continue.",
      );
    }

    return {
      id: row.id,
      connectorId: row.connectorId,
      tenantKey: row.tenantKey,
      connectorSlug: row.connectorSlug,
      capabilities,
    };
  }
}
