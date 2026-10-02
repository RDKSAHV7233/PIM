import { createHash, randomUUID } from "node:crypto";
import { UnrecoverableError } from "bullmq";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ExportJobStatus,
  MarketplaceBulkPublishItemStatus,
  MarketplaceBulkPublishRunStatus,
  Prisma,
  RuleSeverity,
  ValidationIssueStatus,
} from "@prisma/client";
import { ConnectorFrameworkService } from "../connector-framework/connector-framework.service";
import { ConnectorRegistry } from "../connector-framework/connector.registry";
import { parseCapabilities } from "../connector-framework/parse-capabilities";
import { PlanUsageService } from "../billing/plan-usage.service";
import { AuditService } from "../audit/audit.service";
import {
  CapabilityNotSupportedError,
  ConnectorNetworkError,
  CredentialExpiredError,
  InstallationNotFoundError,
} from "../connector-framework/connector.errors";
import {
  ConnectorContext,
  MarketPrice,
  ProductPayload,
  ProductTypeSchema,
  SubmissionRef,
} from "../connector-framework/connector.interface";
import { PriceResolutionService } from "./price-resolution.service";
import { MediaStorageService } from "../media/media-storage.service";
import { ShopifyConfigResult, ShopifyProductPreview, ShopifyPublishError } from "../connectors/shopify/shopify.connector";
import { buildShopifyChannelProjection } from "../connectors/shopify/shopify-channel-projection";
import { compareProjectionToSource } from "../connectors/shopify/shopify-shadow-comparator";
import {
  buildShopifyVnextMutationPayload,
  ShopifyProductSetIdentifierLike,
  ShopifyProductSetInputLike,
  ShopifyRollbackSnapshot,
} from "../connectors/shopify/shopify-vnext-mutation-adapter";
import { createVnextCorrelationId } from "../common/vnext-correlation";
import {
  getVnextMutationApprovedPayloadChecksum,
  getVnextMutationAllowedFieldClass,
  isApprovedRelease,
  isMutationAllowedFor,
  isVnextMutationEnabled,
} from "../common/vnext-mutation-env";
import type { ResolvedConnectorMapping } from "./mapping-resolution.service";
import { WooCommercePublishError } from "../connectors/woocommerce/woocommerce.connector";
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
import { ErrorCaptureService } from "../error-authority/error-capture.service";
import { isTerminalBullFailure } from "../error-authority/worker-error-classifier";
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

export type EffectiveMapping = MappingPack & {
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

const FEATURE_MARKETPLACE_BULK_PUBLISH_ASYNC_ENABLED = "FEATURE_MARKETPLACE_BULK_PUBLISH_ASYNC_ENABLED";
const BULK_PUBLISH_ASYNC_DISABLED_MESSAGE =
  "Bulk publish is temporarily disabled for this connector. Try again later or contact support.";

function isAsyncBulkPublishEnabled(): boolean {
  return (
    String(process.env[FEATURE_MARKETPLACE_BULK_PUBLISH_ASYNC_ENABLED] ?? "true")
      .trim()
      .toLowerCase() !== "false"
  );
}

// BUG-MKT-EXPORT-003: locked status contract (dashboard.service.ts's readiness
// buckets and marketplace.service.ts's own emitConnectorOutcomeMetrics already
// agree on this classification independently):
//   SUCCESS               -> success        -> ExportJob completed
//   PENDING                -> accepted_async -> ExportJob completed (status-sync
//                             owns the provider's eventual resolution; the
//                             export job row is never revisited by that loop)
//   REJECTED/ERROR/SUPPRESSED -> provider_failure -> ExportJob failed
// "recorded" covers submissions whose status was computed locally from
// simulation.exportReady rather than from a live connector round-trip (the
// non-PUBLISH / EXPORT_ONLY path, and the dead "PUBLISH but not exportReady"
// ternary branch alongside it) - that status carries no information beyond
// what simulation.exportReady already encodes, so it must never trigger the
// provider_failure short-circuit; processExportJob's existing
// exportReady-gated completion/retry logic remains authoritative for it.
type SubmissionOutcome =
  | { kind: "success"; installationId: string; submissionId: string }
  | { kind: "accepted_async"; installationId: string; submissionId: string }
  | { kind: "recorded"; installationId: string; submissionId: string }
  | {
      kind: "provider_failure";
      installationId: string;
      submissionId: string;
      // Widened beyond the three known failure statuses on purpose: the
      // fail-closed default in classifyPublishSubmissionStatus can also route
      // an unrecognized future connector status here, and this field must be
      // able to hold that value honestly rather than mis-typing it.
      status: string;
      reason: string;
    };

type ControlledMutationOutcome =
  | { outcome: "skipped"; reason: string; correlationId: string }
  | {
      outcome: "executed";
      result: SubmissionRef;
      correlationId: string;
      fieldClass: "image";
      mutationCount: number;
      releaseSha: string;
      liveReleaseSha: string;
      externalProductGid: string;
      audit: ShopifyControlledMutationAuditMetadata;
      readback: ShopifyControlledMutationReadback;
    };

type ShopifyControlledMutationReadback = {
  stableFieldsMatch: boolean;
  imageChanged: boolean;
  productGidUnchanged: boolean;
  expectedImagePresent: boolean;
  expectedImageCount: number;
  actualImageCount: number;
  beforeImageHash: string;
  afterImageHash: string;
};

type ShopifyControlledMutationAuditMetadata = {
  eventVersion: 1;
  correlationId: string;
  status: "started" | "executed" | "failed" | "readback_verified" | "readback_mismatch" | "blocked";
  rollbackModel: "strict_one_write_no_automatic_rollback";
  maxPrimaryProviderWrites: 1;
  automaticRollback: false;
  legacyFallbackAfterVnextStart: false;
  retryAfterAmbiguousProviderResult: false;
  tenantKey: string;
  connectorSlug: "shopify";
  installationId: string;
  productId: string;
  categoryId: string;
  fieldClass: "image";
  mutationCount: number;
  payloadChecksum: string;
  approvedPayloadChecksum: string;
  approvedReleaseSha: string;
  liveReleaseSha: string;
  externalProductGid?: string;
  submissionId?: string;
  failureCode?: string;
  failureReason?: string;
  readback?: ShopifyControlledMutationReadback;
};

class ShopifyControlledMutationError extends ShopifyPublishError {
  constructor(
    issues: ConstructorParameters<typeof ShopifyPublishError>[0],
    message: string,
    public readonly audit: ShopifyControlledMutationAuditMetadata,
  ) {
    super(issues, message);
    this.name = "ShopifyControlledMutationError";
  }
}

type ShopifyControlledMutationConnector = {
  fetchProductTypeSchema?: (
    ctx: ConnectorContext,
    productType?: string,
  ) => Promise<ProductTypeSchema>;
  applyControlledMutation: (
    ctx: ConnectorContext,
    input: ShopifyProductSetInputLike,
    identifier: ShopifyProductSetIdentifierLike,
    options?: { correlationId?: string },
  ) => Promise<SubmissionRef>;
  captureRollbackSnapshot: (
    ctx: ConnectorContext,
    shopifyGid: string,
    options?: { correlationId?: string },
  ) => Promise<ShopifyRollbackSnapshot>;
};

type ShopifyVnextPreflightCheck = { name: string; result: "PASS" | "FAIL"; detail?: string };

type ShopifyControlledMutationPreparedPlan = {
  ctx: ConnectorContext;
  applyControlledMutation: ShopifyControlledMutationConnector["applyControlledMutation"];
  captureRollbackSnapshot: ShopifyControlledMutationConnector["captureRollbackSnapshot"];
  projectionSku: string;
  schemaVersion: string;
  payloadInput: ShopifyProductSetInputLike;
  files: Record<string, unknown>[];
  controlledInput: ShopifyProductSetInputLike;
  identifier: ShopifyProductSetIdentifierLike;
  preSnapshot: ShopifyRollbackSnapshot;
  unauthorizedFieldDiffs: string[];
  outboundFieldKeys: string[];
  expectedImageAlts: string[];
  payloadChecksum: string;
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

// Bulk-Publish Goes Async, Story 4: queue payload for MARKETPLACE_BULK_PUBLISH — mirrors
// BulkEditApplyJobPayload's shape (bulk-edit.service.ts) deliberately, since the worker
// follows the same "find run, resume from unprocessed items, finalize" pattern.
type MarketplaceBulkPublishJobPayload = {
  runId: string;
  tenantKey: string;
  actor: PolicyActor;
};

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
      orderBy: [{ createdAt: "asc" }, { id: "asc" }];
      take: 1;
    };
  };
}>;

// tenantKey is REQUIRED on every variant — it is the trusted, server-derived
// routing identity the CONNECTOR_SUBMISSION worker restores via
// runWithTenantContext before touching any tenant-scoped data. It must only
// ever be set from ConnectorFrameworkService.requireCurrentTenantKey() — the
// strict variant that throws rather than silently defaulting when no request
// context exists — never from client/browser input, and never from the
// lenient getCurrentTenantKey() at a queue-payload-construction call site.
// See BUG-MKT-QUEUE-002.
type VnextExecutionMode = "normal" | "controlled_vnext_required";

type ConnectorWorkerPayload =
  | {
      mode?: "export-job";
      jobId: string;
      connectorSlug?: string;
      tenantKey: string;
      executionMode?: VnextExecutionMode;
    }
  | {
      mode: "status-sync";
      submissionId: string;
      connectorSlug?: string;
      attemptNumber?: number;
      tenantKey: string;
    }
  | {
      mode: "submission-retry";
      submissionId: string;
      connectorSlug?: string;
      tenantKey: string;
    };

const AUTO_STATUS_SYNC_DELAY_MS = 800;
const AUTO_STATUS_SYNC_MAX_ATTEMPTS = 3;

// CTO review follow-up (PR #719, 2026-09-05): an item claimed (pending -> queued) by
// processBulkPublishRun is reclaimable once its claim is older than this — otherwise a
// worker that crashes between claiming an item and finishing it strands that item at
// `queued` forever, since no other code path ever moves it back to `pending`.
const BULK_PUBLISH_ITEM_RECLAIM_THRESHOLD_MS = 10 * 60 * 1000;

// CTO review follow-up (PR #719, 2026-09-05): the native (e.g. Amazon) BULK_PUBLISH path
// in triggerBulkPublish is still fully synchronous in-request (one eligibility loop, one
// batch-feed call, all before the response returns) — this was the original ceiling
// before TriggerBulkPublishDto's shared @ArrayMaxSize was raised to 2000 for the
// now-async non-native path. Kept independent of that DTO field so raising the async
// ceiling further doesn't silently raise this one too.
const NATIVE_BULK_PUBLISH_CEILING = 200;

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
      // FIND-04: the outbound payload builder (compileWooCommerceMetaFromMapping /
      // WooCommerceConnector.normalizeCustomMeta) already supports arbitrary meta_data.* /
      // customMeta.* targets, but the mapping wizard's field catalogue (targetFieldOptions in
      // apps/web/src/lib/channel-mappings.ts) only ever offered rows for this static fieldMap's
      // entries — Shopify gets structured metafield targets from its imported shopifyMetafields
      // catalogue, WooCommerce had no equivalent, so no customMeta row ever appeared. This adds
      // one selectable customMeta slot using the same optional-row mechanism as images.0.src/sku.
      "attributes.customTag": "meta_data.custom_tag",
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
    @Optional() private readonly errorCaptureService?: ErrorCaptureService,
    @Optional() private readonly auditService?: AuditService,
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

  async createExportJob(
    productId: string,
    dto: CreateExportJobDto,
    actor?: PolicyActor,
    // Bulk publish (triggerBulkPublish -> bulkPublishViaQueuedExportJobs) already fetches
    // the product and evaluates readiness once per product in its eligibility loop, with
    // identical inputs (same connectorSlug/categoryScope/installationId/productId) to what
    // this method would otherwise re-fetch/re-evaluate a few lines below. Accepting them
    // here as optional pass-through avoids doing that DB work twice per product on every
    // bulk-publish call — see #554. Every other caller (single-product "Queue channel
    // export", retries, delta sync, ...) omits this and behaves exactly as before.
    precomputed?: {
      product: { id: string; status: string; categoryId: string; brand: string | null; version: number; updatedAt: Date };
      readiness: { ok: boolean; blockers: string[]; warnings: string[] };
    },
  ) {
    await this.accessPolicy.assertSensitivePayloadAccessAllowed(actor ?? {}, {
      action: "marketplace.export",
      resource: "MarketplaceExportJob",
      resourceId: productId,
    });
    // Bulk-Publish Goes Async, Story 4: #554 deduplicated this method's own product
    // fetch against the bulk eligibility loop's, but left a second one standing —
    // simulateProduct() (below) always did its own separate fetch regardless of
    // precomputed, ignoring it entirely. When precomputed isn't given (every caller
    // except the legacy bulkPublishViaQueuedExportJobs path), fetch once here with
    // the full shape buildSimulationFromProduct needs and reuse it directly instead
    // of letting simulateProduct() re-fetch. precomputed.product's narrower shape
    // (no attributes/validationIssues) can't serve double duty this way, so that
    // path is unchanged — it was never the common case this fixes.
    const fetchedProduct = precomputed?.product ?? await this.getProductForSimulation(productId);
    const product = fetchedProduct;
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

    // Still goes through the public simulateProduct() — not buildSimulationFromProduct()
    // directly — so callers/tests that spy on simulateProduct (mocking it out entirely
    // instead of its underlying Prisma calls) keep working unmodified. The fetch reuse
    // happens *inside* simulateProduct via its new precomputedProduct param (above);
    // this call site just supplies it when available. precomputed.product is narrower
    // than SimulationProduct (no attributes/validationIssues), so that path passes
    // nothing through and simulateProduct falls back to its own fetch — unchanged
    // behavior for that caller.
    const simulation = await this.simulateProduct(
      productId,
      dto.channel,
      dto.templateId,
      resolvedInstallationId,
      precomputed?.product ? undefined : (product as SimulationProduct),
    );
    if (precomputed?.readiness) {
      if (!precomputed.readiness.ok) {
        throw new BadRequestException({
          error: "publish_readiness_blocked",
          blockers: precomputed.readiness.blockers,
          warnings: precomputed.readiness.warnings,
        });
      }
    } else {
      await this.connectorMappingService.assertPublishReadyForExport({
        connectorSlug,
        categoryScope: product.categoryId,
        installationId: resolvedInstallationId,
        fallbackAcknowledged: dto.fallbackAcknowledged,
        productId,
      });
    }

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
      // PIM#655 — the export job still gets created and real validation runs later in
      // the async worker, so this isn't a silent total failure. But if the pre-flight
      // check itself is broken (not the thing it's checking), that breakage was
      // previously undiagnosable from Error Authority, only from log-diving. Captured
      // as a non-blocking warning-level record so a systemic pre-flight bug becomes
      // visible in aggregate without affecting this request.
      void this.errorCaptureService
        ?.captureUnexpected({
          runtime: "api",
          service: "vexa-pim-api",
          error,
          category: "internal",
          severity: "p3",
          routeTemplate: "marketplace:create-export-job:pre-flight-validation",
          installationId: resolvedInstallationId,
        })
        .catch(() => {});
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
    await this.enqueueExportJobForExecution(job.id, simulation.channel, job.retryCount, dto.executionMode === "controlled_vnext_required" ? "controlled_vnext_required" : "normal");
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
        tenantKey: this.connectorFramework.requireCurrentTenantKey(),
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

  async processExportJob(jobId: string, executionMode: VnextExecutionMode = "normal") {
    const startedAtMs = Date.now();
    const existing = await this.prisma.tenant().marketplaceExportJob.findUnique({ where: { id: jobId } });
    if (!existing) {
      throw new NotFoundException("Export job not found");
    }
    // Defense-in-depth for BUG-MKT-QUEUE-002: the tenant-scope Prisma extension already
    // injects tenantKey into the query above, so a genuine cross-tenant row can't be
    // returned here — this assertion exists to fail loudly if that guarantee is ever
    // broken (e.g. a future refactor swaps in unscoped raw SQL), not because it's
    // expected to trip under normal operation.
    const activeTenantKey = this.connectorFramework.getCurrentTenantKey();
    if (existing.tenantKey !== activeTenantKey) {
      throw new Error(`Tenant context mismatch for export job ${jobId}: expected active tenant, found a different one on the row.`);
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
        // PIM#661 — this item was already counted in the synchronous bulk-publish
        // queuedCount response before this async worker ever ran. Without a
        // submission record here, it silently vanishes from /channels/submissions
        // with no PENDING, ERROR, or SUCCESS row at all — queuedCount then no
        // longer equals the number of accounted-for outcomes. existing.installationId
        // is known (this is the `else` branch: an installationId was resolved at
        // job-creation time, it's just no longer usable now), so a real submission
        // row can be attributed to it even though requireInstallation/capability
        // just failed.
        const idempotencyKey = this.connectorFramework.buildIdempotencyKey(jobId, "PUBLISH");
        await this.prisma.tenant(tenantKey).connectorSubmission.upsert({
          where: {
            tenantKey_installationId_idempotencyKey: {
              tenantKey,
              installationId: existing.installationId!,
              idempotencyKey,
            },
          },
          create: {
            id: randomUUID(),
            installationId: existing.installationId!,
            productId: existing.productId,
            idempotencyKey,
            submissionType: "PUBLISH",
            source: "NOT_VALIDATED",
            attemptNumber: 1,
            status: "ERROR",
            payloadSnapshot: {},
            channelErrors: [{
              code: "DESTINATION_UNAVAILABLE",
              fieldPath: "",
              severity: "error",
              sellerMessage: "The connector installation for this product was unavailable or lost publish access before this job could run.",
            }],
            resolvedAt: new Date(),
            connectorSlug,
          },
          update: {
            attemptNumber: { increment: 1 },
            status: "ERROR",
            resolvedAt: new Date(),
          },
          select: { id: true },
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
      const submissionOutcome = await this.recordConnectorSubmission(
        { ...existing, installationId: effectiveInstallationId },
        simulation,
        executionMode,
      );
      effectiveInstallationId = effectiveInstallationId ?? submissionOutcome.installationId ?? null;

      // BUG-MKT-EXPORT-003: a submission the connector truthfully rejected
      // (REJECTED/ERROR/SUPPRESSED returned without throwing) must never be
      // reported as a completed export - previously this branch didn't exist
      // and completion was decided by simulation.exportReady alone, so a
      // provider-side rejection could be silently reported as success.
      if (submissionOutcome.kind === "provider_failure") {
        const updated = await this.prisma.tenant().marketplaceExportJob.update({
          where: { id: jobId },
          data: {
            status: ExportJobStatus.failed,
            failureReason: submissionOutcome.reason,
            dlqReason: null,
            exportPayload: Prisma.JsonNull,
          },
          include: { template: true },
        });
        await this.persistSyncStateForProduct(effectiveInstallationId, existing.productId, "ERROR");
        await this.notificationsService.emitPublishStatus(updated.id, "failed");
        await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
        return updated;
      }

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
      await this.enqueueExportJobForExecution(jobId, existing.channel, nextRetry);
      await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
      return updated;
    } catch (error) {
      if (error instanceof ConnectorNetworkError && error.retryable) {
        const nextRetry = existing.retryCount + 1;
        if (nextRetry >= existing.maxRetries) {
          const updated = await this.prisma.tenant().marketplaceExportJob.update({
            where: { id: jobId },
            data: {
              status: ExportJobStatus.dead_letter,
              retryCount: nextRetry,
              failureReason: error.message,
              dlqReason: `Network error exhausted retries: ${error.category} — ${error.detail}`,
              exportPayload: Prisma.JsonNull,
            },
            include: { template: true },
          });
          await this.notificationsService.emitPublishStatus(updated.id, "dead_letter");
          await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
          await this.persistSyncStateForProduct(effectiveInstallationId, existing.productId, "ERROR");
          return updated;
        }
        const updated = await this.prisma.tenant().marketplaceExportJob.update({
          where: { id: jobId },
          data: {
            status: ExportJobStatus.retrying,
            retryCount: nextRetry,
            failureReason: error.message,
            exportPayload: Prisma.JsonNull,
          },
          include: { template: true },
        });
        await this.enqueueExportJobForExecution(jobId, existing.channel, nextRetry);
        this.logger.warn("Retrying export job after transient network error", {
          jobId,
          channel: existing.channel,
          category: error.category,
          retryCount: nextRetry,
          maxRetries: existing.maxRetries,
        });
        await this.emitExportThroughputMetric(existing.channel, startedAtMs, updated.status);
        return updated;
      }

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
        const tenantKey = String((lanePayload as { tenantKey?: unknown }).tenantKey ?? "").trim();
        if (!tenantKey) {
          // Old-shape payload from before BUG-MKT-QUEUE-002 was fixed, or a malformed
          // producer. Never fall back to DEFAULT_TENANT_KEY here — that's exactly the
          // bug (ambient context silently resolving to "default" and looking up the
          // job/submission under the wrong tenant). Fail closed and skip retries: no
          // amount of retrying fixes a payload that was never given a tenant.
          this.logger.error("Connector-submission job has no tenantKey — refusing to process under a fallback tenant", {
            event: "QUEUE_TENANT_CONTEXT_MISSING",
            mode: (lanePayload as { mode?: string }).mode ?? "export-job",
          });
          throw new UnrecoverableError("QUEUE_TENANT_CONTEXT_MISSING");
        }

        await runWithTenantContext(tenantKey, async () => {
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
          const queueExecutionMode = (lanePayload as { executionMode?: unknown }).executionMode === "controlled_vnext_required"
            ? "controlled_vnext_required" as const
            : "normal" as const;
          try {
            await this.processExportJob(jobId, queueExecutionMode);
          } catch (error: unknown) {
            await this.markJobFailedFromWorker(jobId, error);
            throw error;
          }
        });
      },
    );

    // Bulk-Publish Goes Async, Story 4: one run per triggerBulkPublish call on
    // non-native connectors. Lane-by-tenant mirrors BulkEditService's own queue
    // registration (bulk-edit.service.ts) — the closest precedent for this exact
    // "one job kicks off a resumable multi-item background operation" shape.
    this.queueService.processWithBackpressure<MarketplaceBulkPublishJobPayload>(
      QUEUE_NAMES.MARKETPLACE_BULK_PUBLISH,
      { laneResolver: (payload) => payload.tenantKey },
      async (payload, attempt = { attemptsMade: 1, attemptsAllowed: 1 }) => {
        try {
          await runWithTenantContext(payload.tenantKey, () => this.processBulkPublishRun(payload));
        } catch (error) {
          this.logger.error("Bulk publish run failed unexpectedly", {
            runId: payload.runId,
            attemptsMade: attempt.attemptsMade,
            attemptsAllowed: attempt.attemptsAllowed,
            error: error instanceof Error ? error.message : String(error),
          });
          // CTO review follow-up (PR #719, 2026-09-05): only mark the run `failed` once
          // this was the last attempt the queue backend will make. Marking it failed on
          // the *first* exception (as this used to) raced BullMQ's own retry: the retry
          // would then redeliver a job whose run is already terminal, and
          // processBulkPublishRun's own status guard silently no-ops on it — orphaning
          // every item that hadn't reached a terminal status yet, with no DLQ signal
          // beyond this log line. Letting retries exhaust first gives a transient error
          // (a brief connector API blip, a dropped DB connection) a real chance to
          // succeed on redelivery instead of dooming the whole run on the first try.
          if (!isTerminalBullFailure(attempt.attemptsMade, attempt.attemptsAllowed)) {
            throw error;
          }
          await runWithTenantContext(payload.tenantKey, async () => {
            try {
              await this.prisma.tenant().marketplaceBulkPublishRun.update({
                where: { id: payload.runId },
                data: { status: MarketplaceBulkPublishRunStatus.failed },
              });
            } catch {
              this.logger.error("Failed to mark bulk publish run as failed", { runId: payload.runId });
            }
          });
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

    await this.enqueueExportJobForExecution(jobId, updated.channel, updated.retryCount);

    return updated;
  }

  async simulateProduct(
    productId: string,
    channelInput: string,
    templateId?: string,
    installationId?: string | null,
    // Bulk-Publish Goes Async, Story 4: createExportJob already fetches the product with
    // this exact shape (via getProductForSimulation) when it doesn't have a precomputed
    // one — passing it through here skips this method's own redundant re-fetch, closing
    // the gap #554 left (that fix deduplicated createExportJob's own fetch against the
    // caller's, but this method still did a second one regardless, ignoring it entirely).
    // Optional and additive: every other caller (single-product simulate, getBatchReadiness,
    // ...) omits it and behaves exactly as before.
    precomputedProduct?: SimulationProduct,
  ) {
    const product = precomputedProduct ?? await this.getProductForSimulation(productId);
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

  // Not private: exposed specifically for MappingResolutionService
  // (mapping-resolution.service.ts) to delegate to, so it can offer a narrow,
  // connector-oriented resolution boundary without duplicating this method's
  // 4-tier precedence (explicit template -> legacy default template ->
  // ConnectorMappingVersion bridge -> system pack). Behavior is unchanged;
  // only the access modifier moved so that real call site doesn't need a
  // private-bypass cast.
  //
  // MarketplaceService remains the current legacy authority during migration —
  // this method's own internal call sites are unaffected. New callers outside
  // this class should go through MappingResolutionService rather than calling
  // getEffectiveMapping() directly, so there is exactly one connector-facing
  // entry point to the mapping-resolution boundary, not two.
  async getEffectiveMapping(
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

  // BUG-MKT-EXPORT-003: this function's return value is the invariant boundary
  // between "a ConnectorSubmission definitely exists" and "no legitimate handoff
  // occurred." It must never let the caller believe a submission exists when it
  // doesn't (that was the bug: missing installation silently produced `null`,
  // and the caller marked the job completed anyway). The contract now is:
  //   - returns a SubmissionOutcome  -> a ConnectorSubmission row was recorded.
  //   - throws                      -> no submission was recorded at all.
  // A recorded submission that the provider truthfully rejected (REJECTED /
  // ERROR / SUPPRESSED, returned without the connector throwing) is still a
  // *return*, not a throw - the outcome's `kind: "provider_failure"` carries
  // that distinction so the caller can decide the export job's terminal status
  // instead of this function silently picking one.
  private classifyPublishSubmissionStatus(
    status: string,
  ): "success" | "accepted_async" | "provider_failure" {
    switch (status) {
      case "SUCCESS":
        return "success";
      case "PENDING":
        return "accepted_async";
      case "REJECTED":
      case "ERROR":
      case "SUPPRESSED":
        return "provider_failure";
      default:
        // Fail closed: an unrecognized future connector status must not be
        // silently treated as success. (BUG-MKT-EXPORT-003 Case 6.)
        return "provider_failure";
    }
  }

  private async recordConnectorSubmission(
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
    executionMode: VnextExecutionMode = "normal",
  ): Promise<SubmissionOutcome> {
    const connectorSlug = this.mapChannelToConnectorSlug(job.channel);
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    if (!job.installationId) {
      // No legitimate handoff can occur without a resolved installation - the
      // caller (processExportJob) always resolves installationId before this
      // call today, so this is defensive, not a live path. Throwing (rather
      // than silently no-op-ing, as this branch previously did) keeps that
      // guarantee explicit for any future caller.
      throw new InstallationNotFoundError(connectorSlug);
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
        // BUG-MKT-EXPORT-003: previously returned null here and the caller
        // proceeded to mark the export job completed with zero submission
        // ever recorded. Re-throwing lets processExportJob's existing outer
        // catch mark the job failed with a truthful, typed reason instead.
        throw error;
      }
      throw error;
    }

    const operation = installation.capabilities.includes("PUBLISH") ? "PUBLISH" : "EXPORT_ONLY";
    const source = simulation.validationSource === "amazon_sp_api" ? "LIVE_API" : "LOCAL_RULES";

    let submission;
    let outcome: SubmissionOutcome;
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

        // Story 4 (Shopify shadow-sprint restart): run the new vNext pipeline beside
        // the real publish/update call below, purely for observation. Staging-only,
        // fully isolated — see runShopifyShadowProjection's own guards. Awaited
        // (not fire-and-forget) so its own try/catch fully resolves before this
        // method continues; it never throws and never touches productPayload.
        if (connectorSlug === "shopify" && job.categoryId) {
          await this.runShopifyShadowProjection({
            productPayload,
            categoryId: job.categoryId,
            installation,
          });
        }

        const controlledMutation = connectorSlug === "shopify" && job.categoryId
          ? await this.attemptShopifyControlledMutation({
              tenantKey,
              productId: job.productId,
              productPayload,
              categoryId: job.categoryId,
              installation,
              existingGid,
              executionMode,
            })
          : { outcome: "skipped" as const, reason: "not_shopify_or_missing_category" };

        if (executionMode === "controlled_vnext_required" && controlledMutation.outcome !== "executed") {
          const skipReason = (controlledMutation as { reason?: string }).reason ?? "unknown_skip";
          throw this.buildShopifyControlledMutationError(
            "SHOPIFY_VNEXT_MUTATION_BLOCKED",
            `Controlled vNext mutation was not executed (${skipReason}). Job cannot proceed to legacy path.`,
            {
              eventVersion: 1,
              correlationId: `ctrl-skip-${Date.now()}`,
              status: "blocked",
              rollbackModel: "strict_one_write_no_automatic_rollback",
              maxPrimaryProviderWrites: 1,
              automaticRollback: false,
              legacyFallbackAfterVnextStart: false,
              retryAfterAmbiguousProviderResult: false,
              tenantKey,
              connectorSlug: "shopify",
              installationId: job.installationId ?? "",
              productId: job.productId,
              categoryId: job.categoryId ?? "",
              fieldClass: "image",
              mutationCount: 0,
              payloadChecksum: "",
              approvedPayloadChecksum: getVnextMutationApprovedPayloadChecksum() ?? "",
              approvedReleaseSha: String(process.env.VNEXT_MUTATION_APPROVED_RELEASE_SHA ?? ""),
              liveReleaseSha: String(process.env.RAILWAY_GIT_COMMIT_SHA ?? ""),
              failureCode: "SHOPIFY_VNEXT_MUTATION_BLOCKED",
              failureReason: `skipped_in_controlled_mode:${skipReason}`,
            },
          );
        }

        const publishResult = controlledMutation.outcome === "executed"
          ? controlledMutation.result
          : existingGid
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

        const submissionPayloadSnapshot = controlledMutation.outcome === "executed"
          ? this.attachShopifyVnextAuditMetadata(payloadSnapshot, {
              ...controlledMutation.audit,
              status: "readback_verified",
              externalProductGid: controlledMutation.externalProductGid,
              readback: controlledMutation.readback,
            })
          : payloadSnapshot;

        submission = await this.connectorFramework.recordSubmissionAttempt({
          installation,
          productId: job.productId,
          jobId: job.id,
          operation,
          source: "LIVE_API",
          status: publishResult.status,
          externalRef: publishResult.externalRef,
          payloadSnapshot: submissionPayloadSnapshot,
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
        if (controlledMutation.outcome === "executed") {
          this.logger.info("shopify_vnext_mutation_readback_verified", {
            correlationId: controlledMutation.correlationId,
            installationId: installation.id,
            productId: job.productId,
            submissionId: submission.id,
            externalProductGid: controlledMutation.externalProductGid,
            releaseSha: controlledMutation.releaseSha,
            liveReleaseSha: controlledMutation.liveReleaseSha,
            fieldClass: controlledMutation.fieldClass,
            mutationCount: controlledMutation.mutationCount,
            expectedImageCount: controlledMutation.readback.expectedImageCount,
            actualImageCount: controlledMutation.readback.actualImageCount,
            beforeImageHash: controlledMutation.readback.beforeImageHash,
            afterImageHash: controlledMutation.readback.afterImageHash,
          });
          await this.recordShopifyVnextMutationAudit({
            ...controlledMutation.audit,
            status: "readback_verified",
            submissionId: submission.id,
            externalProductGid: controlledMutation.externalProductGid,
            readback: controlledMutation.readback,
          });
        }
        if (
          publishResult.status === "PENDING" &&
          publishResult.isAsync &&
          installation.capabilities.includes("STATUS_SYNC")
        ) {
          await this.queueSubmissionStatusSync(submission.id, connectorSlug, 1);
        }
        const publishClassification = this.classifyPublishSubmissionStatus(submission.status);
        outcome =
          publishClassification === "provider_failure"
            ? {
                kind: "provider_failure",
                installationId: installation.id,
                submissionId: submission.id,
                status: submission.status,
                reason: `Connector ${connectorSlug} reported ${submission.status} for this submission.`,
              }
            : { kind: publishClassification, installationId: installation.id, submissionId: submission.id };
      } catch (error) {
        // ShopifyPublishError/WooCommercePublishError carry parsed ConnectorIssue[]
        // with real fieldPaths. Generic errors fall back to a single
        // CONNECTOR_PUBLISH_FAILED issue.
        const channelErrors =
          (error instanceof ShopifyPublishError || error instanceof WooCommercePublishError) && error.issues.length > 0
            ? error.issues.map((issue) => ({
                code: issue.code,
                fieldPath: issue.fieldPath,
                severity: issue.severity,
                sellerMessage: issue.sellerMessage,
              }))
            : error instanceof ConnectorNetworkError
              ? [
                  {
                    code: `CONNECTOR_NETWORK_${error.category}`,
                    fieldPath: "",
                    severity: "error" as const,
                    sellerMessage: error.message,
                  },
                ]
              : [
                  {
                    code: "CONNECTOR_PUBLISH_FAILED",
                    fieldPath: "",
                    severity: "error" as const,
                    sellerMessage: this.toFailureReason(error),
                  },
                ];
        const failureAudit = error instanceof ShopifyControlledMutationError ? error.audit : undefined;
        submission = await this.connectorFramework.recordSubmissionAttempt({
          installation,
          productId: job.productId,
          jobId: job.id,
          operation,
          source: "LIVE_API",
          status: "ERROR",
          payloadSnapshot: failureAudit
            ? this.attachShopifyVnextAuditMetadata(payloadSnapshot, failureAudit)
            : payloadSnapshot,
          channelErrors,
        });
        if (failureAudit) {
          await this.recordShopifyVnextMutationAudit({
            ...failureAudit,
            submissionId: submission.id,
          });
        }
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
      // `status` here is always derived from simulation.exportReady, never from
      // a live connector round-trip - it carries no information the caller's
      // existing exportReady-gated logic doesn't already have, so this must
      // never classify as provider_failure (that would bypass the legitimate
      // retry/dead_letter path for EXPORT_ONLY connectors and any PUBLISH
      // connector that simply isn't ready yet - BUG-MKT-EXPORT-003 Case 5).
      outcome = { kind: "recorded", installationId: installation.id, submissionId: submission.id };
    }

    await this.emitConnectorOutcomeMetrics({
      tenantKey,
      connectorSlug,
      submissionStatus: submission.status,
      attemptNumber: submission.attemptNumber,
    });
    return outcome;
  }

  async getShopifyVnextConfigPreflight(
    tenantKey: string,
    connectorSlug: string,
    installationId: string,
    productId: string,
  ): Promise<{
    checks: ShopifyVnextPreflightCheck[];
    result: "READY" | "BLOCKED";
    reason?: string;
    providerWrites: 0;
    legacyWrites: 0;
    exportJobCreated: 0;
    evidence?: {
      productGid: string;
      sku: string;
      schemaVersion: string;
      fieldScope: "image_only";
      mutationCount: number;
      controlledInput: ShopifyProductSetInputLike;
      payloadChecksum: string;
      approvedPayloadChecksum: string;
      beforeState: {
        capturedAt: string;
        imageCount: number;
        imageIds: string[];
        imageUrls: string[];
        imageAltTexts: string[];
      };
    };
  }> {
    const approvedReleaseSha = String(process.env.VNEXT_MUTATION_APPROVED_RELEASE_SHA ?? "").trim();
    const liveReleaseSha = String(process.env.RAILWAY_GIT_COMMIT_SHA ?? "").trim();
    const approvedPayloadChecksum = getVnextMutationApprovedPayloadChecksum() ?? "";
    const enabled = isVnextMutationEnabled();
    const releaseApproved = isApprovedRelease();
    const allowedFieldClass = getVnextMutationAllowedFieldClass();
    const tupleAllowed = enabled && isMutationAllowedFor(tenantKey, connectorSlug, installationId, productId);

    const checks: ShopifyVnextPreflightCheck[] = [
      {
        name: "deployed_sha",
        result: releaseApproved ? "PASS" : "FAIL",
        detail: releaseApproved
          ? liveReleaseSha
          : `live=${liveReleaseSha || "(unset)"} approved=${approvedReleaseSha || "(unset)"}`,
      },
      {
        name: "vnext_gate_enabled",
        result: enabled ? "PASS" : "FAIL",
        detail: enabled ? "VNEXT_MUTATION_ENABLED=true" : "VNEXT_MUTATION_ENABLED not true",
      },
      {
        name: "field_class",
        result: allowedFieldClass === "image" ? "PASS" : "FAIL",
        detail: allowedFieldClass ?? "(unset)",
      },
      {
        name: "product_tuple_allowed",
        result: tupleAllowed ? "PASS" : "FAIL",
        detail: tupleAllowed
          ? `${tenantKey}/${connectorSlug}/${installationId}/${productId}`
          : "not in allowlist or gate disabled",
      },
      {
        name: "controlled_mode_available",
        result: "PASS",
        detail: "executionMode=controlled_vnext_required implemented",
      },
      {
        name: "legacy_fallback_blocked",
        result: "PASS",
        detail: "controlled mode enforces failClosed on all gate misses",
      },
      {
        name: "approved_payload_sha",
        result: approvedPayloadChecksum ? "PASS" : "FAIL",
        detail: approvedPayloadChecksum || "(unset)",
      },
    ];

    const baseBlocked = checks.some((c) => c.result === "FAIL");
    const firstFail = checks.find((c) => c.result === "FAIL");
    const baseResponse = {
      checks,
      providerWrites: 0 as const,
      legacyWrites: 0 as const,
      exportJobCreated: 0 as const,
    };
    if (baseBlocked) {
      return {
        ...baseResponse,
        result: "BLOCKED",
        reason: !enabled ? "vnext_disabled" : firstFail?.name ?? "configuration_incomplete",
      };
    }

    try {
      const db = this.prisma.tenant(tenantKey);
      const [installation, product, priorSubmission] = await Promise.all([
        db.connectorInstallation.findFirst({
          where: { id: installationId },
          select: { id: true, connectorId: true, tenantKey: true, metadata: true },
        }),
        db.product.findUnique({
          where: { id: productId },
          select: { id: true, categoryId: true },
        }),
        db.connectorSubmission.findFirst({
          where: {
            productId,
            installationId,
            status: "SUCCESS",
            externalRef: { not: null },
          },
          orderBy: { submittedAt: "desc" },
          select: { externalRef: true },
        }),
      ]);
      if (!installation) {
        checks.push({ name: "installation_exists", result: "FAIL", detail: installationId });
        return { ...baseResponse, result: "BLOCKED", reason: "installation_not_found" };
      }
      if (!product?.categoryId) {
        checks.push({ name: "product_category", result: "FAIL", detail: product ? "missing categoryId" : "product not found" });
        return { ...baseResponse, result: "BLOCKED", reason: product ? "missing_category" : "product_not_found" };
      }
      const productGid = String(priorSubmission?.externalRef ?? "").trim();
      if (!/^gid:\/\/shopify\/Product\//.test(productGid)) {
        checks.push({ name: "existing_product_gid", result: "FAIL", detail: productGid || "(missing)" });
        return { ...baseResponse, result: "BLOCKED", reason: "missing_existing_product_gid" };
      }
      checks.push(
        { name: "installation_exists", result: "PASS", detail: installation.id },
        { name: "product_category", result: "PASS", detail: product.categoryId },
        { name: "existing_product_gid", result: "PASS", detail: productGid },
      );

      const plan = await runWithTenantContext(tenantKey, () => this.prepareShopifyControlledMutationPlan({
        tenantKey,
        productId,
        productPayload: undefined,
        categoryId: product.categoryId!,
        installation,
        productGid,
        correlationId: createVnextCorrelationId(),
      }));

      const fieldScopeImageOnly = plan.outboundFieldKeys.length === 1 && plan.outboundFieldKeys[0] === "files";
      const checksumMatches = plan.payloadChecksum === approvedPayloadChecksum;
      checks.push(
        {
          name: "field_scope",
          result: fieldScopeImageOnly && plan.unauthorizedFieldDiffs.length === 0 ? "PASS" : "FAIL",
          detail: plan.unauthorizedFieldDiffs.length > 0
            ? `unauthorized=${plan.unauthorizedFieldDiffs.join(",")}`
            : plan.outboundFieldKeys.join(",") || "(none)",
        },
        {
          name: "runtime_payload_checksum",
          result: checksumMatches ? "PASS" : "FAIL",
          detail: `actual=${plan.payloadChecksum} approved=${approvedPayloadChecksum}`,
        },
        {
          name: "runtime_checksum_gate",
          result: checksumMatches ? "PASS" : "FAIL",
          detail: checksumMatches ? "actual controlledInput checksum matches approved checksum" : "would hard-fail before provider write",
        },
        {
          name: "audit_persistence_ready",
          result: "PASS",
          detail: "payloadSnapshot.__vnextMutationAudit stores actual and approved checksums after execution",
        },
      );

      const blocked = checks.some((c) => c.result === "FAIL");
      return {
        ...baseResponse,
        result: blocked ? "BLOCKED" : "READY",
        ...(blocked ? { reason: checksumMatches ? "field_scope_not_image_only" : "payload_checksum_mismatch" } : {}),
        evidence: {
          productGid,
          sku: plan.projectionSku,
          schemaVersion: plan.schemaVersion,
          fieldScope: "image_only",
          mutationCount: plan.files.length,
          controlledInput: plan.controlledInput,
          payloadChecksum: plan.payloadChecksum,
          approvedPayloadChecksum,
          beforeState: {
            capturedAt: plan.preSnapshot.capturedAt,
            imageCount: plan.preSnapshot.product.images.length,
            imageIds: plan.preSnapshot.product.images.map((image) => String(image.id ?? "")).filter(Boolean),
            imageUrls: plan.preSnapshot.product.images.map((image) => String(image.src ?? "")).filter(Boolean),
            imageAltTexts: plan.preSnapshot.product.images.map((image) => String(image.altText ?? "")).filter(Boolean),
          },
        },
      };
    } catch (error) {
      checks.push({
        name: "runtime_payload_evidence",
        result: "FAIL",
        detail: error instanceof Error ? error.message : String(error),
      });
      return { ...baseResponse, result: "BLOCKED", reason: "runtime_payload_evidence_failed" };
    }
  }

  private async prepareShopifyControlledMutationPlan(input: {
    tenantKey: string;
    productId: string;
    productPayload?: ProductPayload;
    categoryId: string;
    installation: { id: string; connectorId: string; tenantKey?: string; metadata?: unknown };
    productGid: string;
    correlationId: string;
  }): Promise<ShopifyControlledMutationPreparedPlan> {
    const { tenantKey, productId, categoryId, installation, productGid, correlationId } = input;
    const connector = this.connectorRegistry.getConnector("shopify") as unknown as ShopifyControlledMutationConnector;
    if (
      !connector.fetchProductTypeSchema ||
      typeof connector.applyControlledMutation !== "function" ||
      typeof connector.captureRollbackSnapshot !== "function"
    ) {
      throw new Error("connector_missing_controlled_mutation");
    }
    const fetchProductTypeSchema = connector.fetchProductTypeSchema.bind(connector);
    const applyControlledMutation = connector.applyControlledMutation.bind(connector);
    const captureRollbackSnapshot = connector.captureRollbackSnapshot.bind(connector);
    const productPayload = input.productPayload ?? await this.buildConnectorProductPayload(productId, {
      channel: "shopify",
      installationId: installation.id,
    });
    const ctx = this.connectorFramework.buildContextForInstallation({
      ...installation,
      tenantKey,
      slug: "shopify",
      metadata: (installation.metadata ?? {}) as Record<string, unknown>,
    });
    const targetSchema = await fetchProductTypeSchema(ctx, productPayload.productType);
    const effective = await this.getEffectiveMapping("shopify", categoryId, undefined, installation.id);
    const resolvedMapping: ResolvedConnectorMapping = {
      connectorSlug: "shopify",
      requiredFields: effective.requiredFields,
      fieldMap: effective.fieldMap,
      rawFieldMap: effective.rawFieldMap,
      source: effective.source,
    };
    const projection = buildShopifyChannelProjection(productPayload, categoryId, resolvedMapping, targetSchema);
    const payload = buildShopifyVnextMutationPayload(projection, correlationId, productGid);
    const files = Array.isArray(payload.input.files)
      ? payload.input.files as Record<string, unknown>[]
      : [];
    if (files.length === 0) {
      throw new Error("missing_authorized_image_payload");
    }
    const controlledInput: ShopifyProductSetInputLike = { files };
    const identifier: ShopifyProductSetIdentifierLike = { id: productGid };
    const preSnapshot = await captureRollbackSnapshot(ctx, productGid, { correlationId });
    const unauthorizedFieldDiffs = this.detectUnauthorizedShopifyVnextFieldDiffs(preSnapshot, payload.input);
    const outboundFieldKeys = Object.keys(controlledInput);
    const expectedImageAlts = files
      .map((file) => String((file as Record<string, unknown>).alt ?? "").trim())
      .filter(Boolean);
    const payloadChecksum = this.hashStableJson(controlledInput);
    return {
      ctx,
      applyControlledMutation,
      captureRollbackSnapshot,
      projectionSku: projection.identity.sku,
      schemaVersion: projection.readiness.schemaVersion,
      payloadInput: payload.input,
      files,
      controlledInput,
      identifier,
      preSnapshot,
      unauthorizedFieldDiffs,
      outboundFieldKeys,
      expectedImageAlts,
      payloadChecksum,
    };
  }

  private async attemptShopifyControlledMutation(input: {
    tenantKey: string;
    productId: string;
    productPayload: ProductPayload;
    categoryId: string;
    installation: { id: string; connectorId: string };
    existingGid: string | null;
    executionMode?: VnextExecutionMode;
  }): Promise<ControlledMutationOutcome> {
    const { tenantKey, productId, productPayload, categoryId, installation, existingGid, executionMode = "normal" } = input;
    const correlationId = createVnextCorrelationId();
    const approvedReleaseSha = String(process.env.VNEXT_MUTATION_APPROVED_RELEASE_SHA ?? "").trim();
    const liveReleaseSha = String(process.env.RAILWAY_GIT_COMMIT_SHA ?? "").trim();
    const approvedPayloadChecksum = getVnextMutationApprovedPayloadChecksum() ?? "";
    const enabled = isVnextMutationEnabled();
    const tupleAllowed = enabled && isMutationAllowedFor(tenantKey, "shopify", installation.id, productId);
    const releaseApproved = enabled && isApprovedRelease();
    const allowedFieldClass = enabled ? getVnextMutationAllowedFieldClass() : undefined;
    const fieldClassAllowed = allowedFieldClass === "image";
    const makeAudit = (
      overrides: Partial<ShopifyControlledMutationAuditMetadata>,
    ): ShopifyControlledMutationAuditMetadata => ({
      eventVersion: 1,
      correlationId,
      status: "blocked",
      rollbackModel: "strict_one_write_no_automatic_rollback",
      maxPrimaryProviderWrites: 1,
      automaticRollback: false,
      legacyFallbackAfterVnextStart: false,
      retryAfterAmbiguousProviderResult: false,
      tenantKey,
      connectorSlug: "shopify",
      installationId: installation.id,
      productId,
      categoryId,
      fieldClass: "image",
      mutationCount: 0,
      payloadChecksum: "",
      approvedPayloadChecksum,
      approvedReleaseSha,
      liveReleaseSha,
      ...overrides,
    });
    const blockedReason = !enabled
      ? "disabled"
      : !tupleAllowed
        ? "allowlist_miss"
        : !releaseApproved
          ? "release_not_approved"
          : !fieldClassAllowed
            ? "field_class_not_allowed"
            : undefined;

    this.logger.info("shopify_vnext_mutation_authorization_checked", {
      correlationId,
      installationId: installation.id,
      categoryId,
      productId,
      tenantKey,
      connectorSlug: "shopify",
      enabled,
      tupleAllowed,
      releaseApproved,
      allowed: !blockedReason,
      blockedReason,
      fieldClass: allowedFieldClass ?? null,
      approvedReleaseSha: approvedReleaseSha || null,
      liveReleaseSha: liveReleaseSha || null,
      approvedPayloadChecksum: approvedPayloadChecksum || null,
    });

    const skip = (reason: string, log = true): ControlledMutationOutcome => {
      if (log) {
        this.logger.info("shopify_vnext_mutation_blocked", {
          correlationId,
          installationId: installation.id,
          categoryId,
          productId,
          reason,
        });
      }
      return { outcome: "skipped", reason, correlationId };
    };
    const failClosedWithAudit = (
      reason: string,
      auditOverrides: Partial<ShopifyControlledMutationAuditMetadata>,
    ): never => {
      this.logger.warn("shopify_vnext_mutation_blocked", {
        correlationId,
        installationId: installation.id,
        categoryId,
        productId,
        reason,
        fieldClass: allowedFieldClass ?? null,
        approvedReleaseSha: approvedReleaseSha || null,
        liveReleaseSha: liveReleaseSha || null,
        approvedPayloadChecksum: approvedPayloadChecksum || null,
        payloadChecksum: auditOverrides.payloadChecksum || null,
      });
      throw this.buildShopifyControlledMutationError(
        "SHOPIFY_VNEXT_MUTATION_BLOCKED",
        `Shopify controlled vNext mutation blocked: ${reason}.`,
        makeAudit({
          status: "blocked",
          failureCode: "SHOPIFY_VNEXT_MUTATION_BLOCKED",
          failureReason: reason,
          ...auditOverrides,
        }),
      );
    };
    const failClosed = (reason: string): never => {
      return failClosedWithAudit(reason, {});
    };

    if (!enabled) {
      if (executionMode === "controlled_vnext_required") return failClosed("disabled_in_controlled_mode");
      return skip("disabled");
    }
    if (!tupleAllowed) {
      if (executionMode === "controlled_vnext_required") return failClosed("allowlist_miss_in_controlled_mode");
      return skip("allowlist_miss");
    }
    if (!releaseApproved) {
      if (executionMode === "controlled_vnext_required") return failClosed("release_not_approved_in_controlled_mode");
      return skip("release_not_approved");
    }
    if (!fieldClassAllowed) {
      if (executionMode === "controlled_vnext_required") return failClosed("field_class_not_allowed_in_controlled_mode");
      return skip("field_class_not_allowed");
    }

    let startedAudit: ShopifyControlledMutationAuditMetadata | undefined;
    try {
      if (!existingGid) {
        failClosed("missing_existing_product_gid");
      }
      const productGid = existingGid!;
      const plan = await this.prepareShopifyControlledMutationPlan({
        tenantKey,
        productId,
        productPayload,
        categoryId,
        installation,
        productGid,
        correlationId,
      });
      if (plan.unauthorizedFieldDiffs.length > 0) {
        failClosed(`unauthorized_field_scope:${plan.unauthorizedFieldDiffs.join(",")}`);
      }
      // Explicit pre-write gate: assert the outbound mutation payload is image-only.
      // controlledInput is constructed as { files } above; this assertion makes the
      // field-scope boundary explicit and catches any future accidental broadening.
      if (plan.outboundFieldKeys.length !== 1 || plan.outboundFieldKeys[0] !== "files") {
        failClosed("outbound_payload_not_image_only");
      }
      const controlledInputKeys = Object.keys(plan.controlledInput).sort();
      if (controlledInputKeys.length !== 1 || controlledInputKeys[0] !== "files") {
        failClosed("unauthorized_outbound_field_scope");
      }
      if (!approvedPayloadChecksum) {
        failClosedWithAudit("payload_checksum_not_approved", { payloadChecksum: plan.payloadChecksum });
      }
      if (plan.payloadChecksum !== approvedPayloadChecksum) {
        failClosedWithAudit("payload_checksum_mismatch", { payloadChecksum: plan.payloadChecksum });
      }
      startedAudit = makeAudit({
        status: "started",
        mutationCount: plan.files.length,
        payloadChecksum: plan.payloadChecksum,
        externalProductGid: productGid,
      });

      this.logger.info("shopify_vnext_mutation_started", {
        correlationId,
        installationId: installation.id,
        categoryId,
        productId,
        externalProductGid: productGid,
        sku: plan.projectionSku,
        schemaVersion: plan.schemaVersion,
        fieldClass: "image",
        mutationCount: plan.files.length,
        payloadChecksum: plan.payloadChecksum,
        approvedPayloadChecksum,
        approvedReleaseSha,
        liveReleaseSha,
      });
      const result = await plan.applyControlledMutation(plan.ctx, plan.controlledInput, plan.identifier, { correlationId });
      this.logger.info("shopify_vnext_controlled_mutation_executed", {
        correlationId,
        installationId: installation.id,
        categoryId,
        productId,
        externalProductGid: result.externalRef,
        sku: plan.projectionSku,
        schemaVersion: plan.schemaVersion,
        fieldClass: "image",
        mutationCount: plan.files.length,
        payloadChecksum: plan.payloadChecksum,
        approvedPayloadChecksum,
        status: result.status,
        approvedReleaseSha,
        liveReleaseSha,
      });
      const postSnapshot = await plan.captureRollbackSnapshot(plan.ctx, result.externalRef, { correlationId });
      const readback = this.verifyShopifyImageOnlyReadback(plan.preSnapshot, postSnapshot, {
        expectedImageCount: plan.files.length,
        expectedImageAlts: plan.expectedImageAlts,
        expectedProductGid: result.externalRef,
      });
      if (
        !readback.stableFieldsMatch ||
        !readback.imageChanged ||
        !readback.productGidUnchanged ||
        !readback.expectedImagePresent ||
        readback.actualImageCount !== readback.expectedImageCount
      ) {
        const mismatchAudit = {
          ...startedAudit,
          status: "readback_mismatch" as const,
          externalProductGid: result.externalRef,
          failureCode: "SHOPIFY_VNEXT_READBACK_MISMATCH",
          failureReason: "readback_mismatch",
          readback,
        };
        this.logger.warn("shopify_vnext_mutation_readback_mismatch", {
          correlationId,
          installationId: installation.id,
          categoryId,
          productId,
          externalProductGid: result.externalRef,
          fieldClass: "image",
          mutationCount: plan.files.length,
          stableFieldsMatch: readback.stableFieldsMatch,
          imageChanged: readback.imageChanged,
          productGidUnchanged: readback.productGidUnchanged,
          expectedImagePresent: readback.expectedImagePresent,
          expectedImageCount: readback.expectedImageCount,
          actualImageCount: readback.actualImageCount,
          beforeImageHash: readback.beforeImageHash,
          afterImageHash: readback.afterImageHash,
        });
        throw this.buildShopifyControlledMutationError(
          "SHOPIFY_VNEXT_READBACK_MISMATCH",
          "Shopify controlled vNext mutation readback did not match the authorized image-only change.",
          mismatchAudit,
        );
      }
      const executedAudit = {
        ...startedAudit,
        status: "executed" as const,
        externalProductGid: result.externalRef,
        readback,
      };
      return {
        outcome: "executed",
        result,
        correlationId,
        fieldClass: "image",
        mutationCount: plan.files.length,
        releaseSha: approvedReleaseSha,
        liveReleaseSha,
        externalProductGid: result.externalRef,
        audit: executedAudit,
        readback,
      };
    } catch (error) {
      const failureAudit = error instanceof ShopifyControlledMutationError
        ? error.audit
        : {
            ...(startedAudit ?? makeAudit({ status: "failed" })),
            status: "failed" as const,
            failureCode: "SHOPIFY_VNEXT_MUTATION_FAILED",
            failureReason: error instanceof Error ? error.name : typeof error,
          };
      this.logger.warn("shopify_vnext_mutation_failed", {
        correlationId,
        installationId: installation.id,
        categoryId,
        productId,
        fieldClass: allowedFieldClass ?? null,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      if (error instanceof ShopifyPublishError || error instanceof ShopifyControlledMutationError) {
        throw error;
      }
      const causeMsg = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
      throw this.buildShopifyControlledMutationError(
        "SHOPIFY_VNEXT_MUTATION_FAILED",
        `Shopify controlled vNext mutation failed before readback could be verified. Cause: ${causeMsg}`,
        failureAudit,
      );
    }
  }

  private buildShopifyControlledMutationError(
    code: string,
    sellerMessage: string,
    audit: ShopifyControlledMutationAuditMetadata,
  ): ShopifyControlledMutationError {
    return new ShopifyControlledMutationError(
      [{ code, fieldPath: "", severity: "error", sellerMessage }],
      sellerMessage,
      audit,
    );
  }

  private verifyShopifyImageOnlyReadback(
    before: ShopifyRollbackSnapshot,
    after: ShopifyRollbackSnapshot,
    expected: {
      expectedImageCount: number;
      expectedImageAlts: string[];
      expectedProductGid: string;
    },
  ): ShopifyControlledMutationReadback {
    const beforeImageHash = this.hashShopifyRollbackImagesForAudit(before.product.images);
    const afterImageHash = this.hashShopifyRollbackImagesForAudit(after.product.images);
    const afterAltSet = new Set(after.product.images.map((image) => this.normalizeComparableString(image.altText)));
    const expectedImagePresent = expected.expectedImageAlts.length === 0 ||
      expected.expectedImageAlts.every((alt) => afterAltSet.has(this.normalizeComparableString(alt)));
    return {
      stableFieldsMatch: this.hashShopifyRollbackStableProduct(before) === this.hashShopifyRollbackStableProduct(after),
      imageChanged: beforeImageHash !== afterImageHash,
      productGidUnchanged: before.product.id === after.product.id && after.product.id === expected.expectedProductGid,
      expectedImagePresent,
      expectedImageCount: expected.expectedImageCount,
      actualImageCount: after.product.images.length,
      beforeImageHash,
      afterImageHash,
    };
  }

  private hashShopifyRollbackStableProduct(snapshot: ShopifyRollbackSnapshot): string {
    const { images: _images, ...stableProduct } = snapshot.product;
    return createHash("sha256")
      .update(JSON.stringify(stableProduct))
      .digest("hex");
  }

  private hashShopifyRollbackImagesForAudit(images: ShopifyRollbackSnapshot["product"]["images"]): string {
    return this.hashStableJson(images.map((image) => ({
      id: this.normalizeComparableString(image.id),
      altText: this.normalizeComparableString(image.altText),
    })));
  }

  private detectUnauthorizedShopifyVnextFieldDiffs(
    snapshot: ShopifyRollbackSnapshot,
    candidateInput: ShopifyProductSetInputLike,
  ): string[] {
    const product = snapshot.product;
    const candidate = candidateInput as Record<string, unknown>;
    const diffs: string[] = [];
    const compare = (field: string, current: unknown, next: unknown) => {
      if (this.hashStableJson(current) !== this.hashStableJson(next)) {
        diffs.push(field);
      }
    };

    compare("title", this.normalizeComparableString(product.title), this.normalizeComparableString(candidate.title));
    compare("handle", this.normalizeComparableString(product.handle), this.normalizeComparableString(candidate.handle));
    compare("descriptionHtml", this.normalizeComparableString(product.descriptionHtml), this.normalizeComparableString(candidate.descriptionHtml));
    compare("status", this.normalizeComparableString(product.status), this.normalizeComparableString(candidate.status));
    compare("vendor", this.normalizeComparableString(product.vendor), this.normalizeComparableString(candidate.vendor));
    compare("productType", this.normalizeComparableString(product.productType), this.normalizeComparableString(candidate.productType));
    compare("tags", this.normalizeComparableStringArray(product.tags).sort(), this.normalizeComparableStringArray(candidate.tags).sort());
    compare("seo", this.normalizeComparableObject(product.seo), this.normalizeComparableObject(candidate.seo));
    compare("productOptions", this.normalizeShopifyProductOptionsComparable(product.options), this.normalizeShopifyProductOptionsComparable(candidate.productOptions));
    compare("variants", this.normalizeShopifyVariantComparable(product.variants), this.normalizeShopifyVariantInputComparable(candidate.variants));

    return diffs;
  }

  private normalizeShopifyVariantComparable(variants: ShopifyRollbackSnapshot["product"]["variants"]): unknown[] {
    return variants.map((variant) => ({
      sku: this.normalizeComparableString(variant.inventoryItem?.sku ?? variant.sku),
      price: this.normalizeComparableString(variant.price),
      compareAtPrice: this.normalizeComparableString(variant.compareAtPrice),
      barcode: this.normalizeComparableString(variant.barcode),
      inventoryPolicy: this.normalizeComparableString(variant.inventoryPolicy),
      taxable: typeof variant.taxable === "boolean" ? variant.taxable : null,
      tracked: typeof variant.inventoryItem?.tracked === "boolean" ? variant.inventoryItem.tracked : null,
      optionValues: variant.selectedOptions.map((option) => ({
        optionName: this.normalizeComparableString(option.name),
        name: this.normalizeComparableString(option.value),
      })),
    }));
  }

  private normalizeShopifyProductOptionsComparable(options: unknown): unknown[] {
    if (!Array.isArray(options)) {
      return [];
    }
    return options.map((rawOption, index) => {
      const option = rawOption && typeof rawOption === "object" ? rawOption as Record<string, unknown> : {};
      const rawValues = Array.isArray(option.values) ? option.values : [];
      return {
        name: this.normalizeComparableString(option.name),
        position: typeof option.position === "number" ? option.position : index + 1,
        values: rawValues
          .map((value) => {
            if (value && typeof value === "object" && !Array.isArray(value)) {
              return this.normalizeComparableString((value as Record<string, unknown>).name);
            }
            return this.normalizeComparableString(value);
          })
          .filter((value): value is string => Boolean(value)),
      };
    });
  }

  private normalizeShopifyVariantInputComparable(inputVariants: unknown): unknown[] {
    if (!Array.isArray(inputVariants)) {
      return [];
    }
    return inputVariants.map((rawVariant) => {
      const variant = rawVariant && typeof rawVariant === "object" ? rawVariant as Record<string, unknown> : {};
      const inventoryItem = variant.inventoryItem && typeof variant.inventoryItem === "object"
        ? variant.inventoryItem as Record<string, unknown>
        : {};
      return {
        sku: this.normalizeComparableString(inventoryItem.sku),
        price: this.normalizeComparableString(variant.price),
        compareAtPrice: this.normalizeComparableString(variant.compareAtPrice),
        barcode: this.normalizeComparableString(variant.barcode),
        inventoryPolicy: this.normalizeComparableString(variant.inventoryPolicy),
        taxable: typeof variant.taxable === "boolean" ? variant.taxable : null,
        tracked: typeof inventoryItem.tracked === "boolean" ? inventoryItem.tracked : null,
        optionValues: this.normalizeComparableObject(variant.optionValues),
      };
    });
  }

  private normalizeComparableString(value: unknown): string | null {
    const normalized = String(value ?? "").trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeComparableStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.normalizeComparableString(item))
      .filter((item): item is string => Boolean(item));
  }

  private normalizeComparableObject(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.normalizeComparableObject(item));
    }
    if (!value || typeof value !== "object") {
      return this.normalizeComparableString(value);
    }
    const entries = Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, this.normalizeComparableObject(item)])
        .sort(([a], [b]) => String(a).localeCompare(String(b))) as Array<[string, unknown]>;
    return Object.fromEntries(entries);
  }

  private hashStableJson(value: unknown): string {
    return createHash("sha256")
      .update(JSON.stringify(this.normalizeComparableObject(value)))
      .digest("hex");
  }

  private attachShopifyVnextAuditMetadata(
    payloadSnapshot: Record<string, unknown>,
    audit: ShopifyControlledMutationAuditMetadata,
  ): Record<string, unknown> {
    return {
      ...payloadSnapshot,
      __vnextMutationAudit: audit,
    };
  }

  private async recordShopifyVnextMutationAudit(audit: ShopifyControlledMutationAuditMetadata): Promise<void> {
    await this.auditService?.record({
      actorId: "system",
      actorRole: "system",
      action: "SHOPIFY_VNEXT_CONTROLLED_MUTATION_AUDIT",
      resource: "ConnectorSubmission",
      resourceId: audit.submissionId ?? null,
      tenantKey: audit.tenantKey,
      metadata: audit as unknown as Record<string, unknown>,
    });
  }

  /**
   * Story 4 of the Shopify shadow-sprint restart: runs the new vNext pipeline
   * — Story 1 fetchProductTypeSchema, Story 2 mapping resolution, Story 3
   * ChannelProjection — beside the real Shopify publish/update call in
   * recordConnectorSubmission, purely for observation. Never mutates
   * productPayload, never calls Shopify's API or uses real credentials
   * (the ConnectorContext built here has no fetch() implementation at all —
   * if the shadow path ever tried to make a real API call, it would fail
   * loudly rather than silently succeed), and never affects the real
   * publish/update outcome: every failure here is caught and logged, never
   * rethrown.
   *
   * Gated on APP_ENV === "staging" — the exact-match convention the CTO
   * required for the error-authority runtime-proof gate (#988) — plus an
   * explicit opt-in flag, so this can be disabled instantly without a
   * deploy if it ever misbehaves.
   *
   * Calls this.getEffectiveMapping() directly rather than injecting
   * MappingResolutionService: MappingResolutionService depends on
   * MarketplaceService (Story 2), so the reverse dependency here would be
   * circular. This reuses the exact same resolution authority
   * MappingResolutionService itself delegates to — not a second, divergent
   * mapping-resolution path.
   */
  private async runShopifyShadowProjection(input: {
    productPayload: ProductPayload;
    categoryId: string;
    installation: { id: string; connectorId: string };
  }): Promise<void> {
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
    if (appEnv !== "staging") {
      return;
    }
    if (String(process.env.SHOPIFY_SHADOW_PROJECTION_ENABLED ?? "").trim().toLowerCase() !== "true") {
      return;
    }

    const { productPayload, categoryId, installation } = input;
    try {
      const connector = this.connectorRegistry.getConnector("shopify");
      if (!connector.fetchProductTypeSchema) {
        return;
      }
      const shadowCtx = {
        tenantId: this.connectorFramework.getCurrentTenantKey(),
        installationId: installation.id,
        connectorId: installation.connectorId,
        getAccessToken: async () => "",
      };
      const targetSchema = await connector.fetchProductTypeSchema(shadowCtx, productPayload.productType);
      const effective = await this.getEffectiveMapping("shopify", categoryId, undefined, installation.id);
      const resolvedMapping: ResolvedConnectorMapping = {
        connectorSlug: "shopify",
        requiredFields: effective.requiredFields,
        fieldMap: effective.fieldMap,
        rawFieldMap: effective.rawFieldMap,
        source: effective.source,
      };
      const projection = buildShopifyChannelProjection(productPayload, categoryId, resolvedMapping, targetSchema);

      // Story 5: verify the projection stays faithful to its own source data —
      // the actual verification step this shadow sprint exists to produce.
      // Comparison-only: never affects productPayload, never affects the real
      // publish/update call regardless of the result.
      const comparison = compareProjectionToSource(projection, productPayload);

      this.logger.info("shopify_shadow_projection_computed", {
        installationId: installation.id,
        categoryId,
        sku: projection.identity.sku,
        schemaVersion: projection.readiness.schemaVersion,
        missingRequiredFields: projection.readiness.missingRequiredFields,
        mappingSource: resolvedMapping.source,
        comparisonMatches: comparison.matches,
      });
      if (!comparison.matches) {
        this.logger.warn("shopify_shadow_comparison_mismatch", {
          installationId: installation.id,
          categoryId,
          sku: projection.identity.sku,
          mismatches: comparison.mismatches,
        });
      }
    } catch (error) {
      this.logger.warn("shopify_shadow_projection_failed", {
        installationId: installation.id,
        categoryId,
        err: error instanceof Error ? error.message : String(error),
      });
    }
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
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
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
      where: { productId, metadata: { path: ["governance", "isMain"], equals: true } },
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
        tenantKey: this.connectorFramework.requireCurrentTenantKey(),
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
        // Canonical handoff (see enqueueExportJobForExecution) — this loop previously
        // duplicated the raw enqueue call with none of the ambiguous-failure handling
        // or tenant-context payload that path now provides.
        await this.enqueueExportJobForExecution(job.id, connectorSlug, job.retryCount);
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
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const installation = await this.resolveInstallationWithSlug(installationId, db, tenantKey);
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
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const installation = await this.resolveInstallationWithSlug(installationId, db, tenantKey);
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

  /**
   * Canonical create→enqueue handoff for MarketplaceExportJob. A `status: queued` row
   * must mean "handed to the connector-submission worker", never just "DB row exists" —
   * queueDeltaSync previously created rows without this call, so scheduled/manual delta
   * sync jobs sat at `queued` forever with no worker ever invoking processExportJob.
   * On enqueue failure, isJobPresent distinguishes a truly-dropped add() from one that
   * landed despite the client throwing (e.g. a post-add timeout), and only marks the row
   * `failed` in the confirmed-absent case. If the presence check itself fails (e.g. Redis
   * also unreachable), that is a THIRD outcome — "unknown", not "confirmed absent" — and
   * must not be treated as proof of failure: doing so risks marking a job `failed` in the
   * DB while a worker is actually about to process it. The row is left at `queued` for
   * operator/reconciliation visibility instead of asserting a certainty we don't have.
   * (A `queued` row with no matching queue entry is a known residual gap this patch does
   * not close — see TECH-QUEUE-RECON-001 for the reconciliation follow-up. That follow-up
   * MUST re-enqueue using this same `${jobId}_${retryCount}` id for the attempt it is
   * reconciling, never a freshly minted id — inventing a new id when presence was merely
   * unverified (as opposed to confirmed absent) would defeat BullMQ's jobId dedup and
   * risk a duplicate submission if the original add() had actually landed.)
   *
   * BUG-MKT-QUEUE-002: the payload also carries `tenantKey`, read here via
   * requireCurrentTenantKey() (throws if no context, never falls back to
   * DEFAULT_TENANT_KEY the way getCurrentTenantKey() does) — never from client
   * input. The CONNECTOR_SUBMISSION worker has no HTTP request to inherit
   * AsyncLocalStorage context from, so without this the worker's own
   * `this.prisma.tenant()` calls would have silently fallen back to
   * DEFAULT_TENANT_KEY and every tenant-scoped lookup in processExportJob (and
   * its siblings) would have missed the real row entirely.
   */
  private async enqueueExportJobForExecution(
    jobId: string,
    connectorSlug: string,
    retryCount: number,
    executionMode: VnextExecutionMode = "normal",
  ): Promise<void> {
    const tenantKey = this.connectorFramework.requireCurrentTenantKey();
    const queueJobId = `${jobId}_${retryCount}`;
    const payload: ConnectorWorkerPayload = executionMode === "controlled_vnext_required"
      ? { jobId, connectorSlug, tenantKey, executionMode }
      : { jobId, connectorSlug, tenantKey };
    try {
      await this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, payload, { jobId: queueJobId });
    } catch (enqueueError) {
      let delivered: boolean;
      try {
        delivered = await this.queueService.isJobPresent(QUEUE_NAMES.CONNECTOR_SUBMISSION, queueJobId);
      } catch (presenceCheckError) {
        // Coarse error codes only — never the raw message/stack. Redis/BullMQ client
        // errors can embed connection details (host, port, sometimes credentials in a
        // malformed REDIS_URL) in .message; .code (e.g. ECONNREFUSED) and .name are the
        // standard, non-sensitive classification surface for this kind of failure.
        this.logger.error(
          "Cannot verify connector-submission queue presence after an enqueue failure — leaving job queued rather than asserting failure",
          {
            event: "QUEUE_HANDOFF_UNVERIFIED",
            jobId,
            connectorSlug,
            retryCount,
            queueJobId,
            enqueueErrorCode: this.toSafeQueueErrorCode(enqueueError),
            presenceCheckErrorCode: this.toSafeQueueErrorCode(presenceCheckError),
          },
        );
        throw enqueueError;
      }
      if (!delivered) {
        await this.prisma.tenant().marketplaceExportJob.updateMany({
          where: { id: jobId, status: ExportJobStatus.queued },
          data: { status: ExportJobStatus.failed, failureReason: "Queue enqueue failed" },
        });
        throw enqueueError;
      }
    }
  }

  /**
   * Standardized, non-sensitive error code for queue-layer diagnostics. Deliberately
   * never touches `.message` or `.stack` — Redis/BullMQ client errors can carry
   * connection details (host, port, occasionally credentials from a malformed
   * REDIS_URL) in free-text message content, which must not reach logs.
   */
  private toSafeQueueErrorCode(error: unknown): string {
    if (error && typeof error === "object") {
      const code = (error as { code?: unknown }).code;
      if (typeof code === "string" && code.trim()) {
        return code.trim();
      }
    }
    if (error instanceof Error && error.name.trim()) {
      return error.name.trim();
    }
    return "UNKNOWN_ERROR";
  }

  async queueDeltaSync(
    installationId: string,
    actor?: PolicyActor,
  ): Promise<{ queued: number; skipped: number }> {
    const tenantKey = this.connectorFramework.getCurrentTenantKey();
    const db = this.prisma.tenant(tenantKey);
    const installation = await this.resolveInstallationWithSlug(installationId, db, tenantKey);
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
            const created = await db.marketplaceExportJob.create({
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
            // Without this, the row above sits at `queued` forever — no worker is ever
            // told about it. See enqueueExportJobForExecution for why a plain DB row is
            // not sufficient on its own.
            await this.enqueueExportJobForExecution(created.id, channel, 0);
            return created;
          } catch (err: unknown) {
            if (
              err instanceof Prisma.PrismaClientKnownRequestError &&
              err.code === "P2002"
            ) {
              return { id: "concurrent-active", _conflicted: true as const };
            }
            throw err;
          }
        }),
      );

      for (const r of results) {
        if (r.status === "fulfilled" && !(r.value as { _conflicted?: boolean })._conflicted) queued++;
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
    actor?: PolicyActor,
  ): Promise<
    | {
        feedId: string;
        feedDocumentId: string;
        productCount: number;
        submissionIds: string[];
        excluded: Array<{ productId: string; reason: string }>;
      }
    | {
        async: true;
        runId: string;
        status: "queued";
        requestedCount: number;
        excludedCount: number;
        excluded: Array<{ productId: string; reason: string }>;
      }
  > {
    if (!productIds.length) {
      throw new BadRequestException("productIds must contain at least one product.");
    }

    const db = this.prisma.tenant();
    const tenantKey = this.connectorFramework.getCurrentTenantKey();

    const installationRow = await this.resolveInstallationWithSlug(installationId, db, tenantKey);
    if (!installationRow) {
      throw new NotFoundException("Connector installation not found.");
    }

    const installation = await this.connectorFramework.requireInstallation(
      tenantKey,
      installationRow.connectorSlug,
      installationId,
    );
    const hasNativeBulkPublish = installation.capabilities.includes("BULK_PUBLISH");

    // Bulk-Publish Goes Async (Story 3/8): connectors without a native batch-feed API used
    // to fall through to a synchronous per-product loop here — the thing that caused
    // BUG-BULK-PUBLISH-TIMEOUT-001 and the 50-product ceiling this replaces. That entire
    // synchronous path (eligibility loop, submission-limit check, per-product export-job
    // creation) is gone for this branch — createBulkPublishRun below does only cheap,
    // batch-cost-independent work (one status query, one plan-limit check using that
    // count, one run+items insert) before returning, and a worker does everything else.
    // Native BULK_PUBLISH connectors (Amazon) are NOT unaffected: the DTO's own
    // @ArrayMaxSize is now 2000 (raised for this async path), and the native branch below
    // is still fully synchronous in-request — see NATIVE_BULK_PUBLISH_CEILING below, which
    // re-establishes the native path's own bound now that the shared DTO ceiling no longer
    // does.
    if (!hasNativeBulkPublish) {
      // CTO review follow-up (PR #719, 2026-09-05): kill switch for the async path,
      // consistent with this codebase's existing FEATURE_*_ENABLED / QUEUE_WORKER_ENABLED
      // idiom. Defaults to enabled (this is already the only path for non-native
      // connectors — there is no synchronous fallback left to revert to, see the comment
      // above), but lets ops disable it without a code revert if a production issue
      // surfaces, rather than leaving every non-native bulk-publish request with no way
      // to be turned off short of a redeploy.
      if (!isAsyncBulkPublishEnabled()) {
        throw new ServiceUnavailableException(BULK_PUBLISH_ASYNC_DISABLED_MESSAGE);
      }
      const channel = this.mapConnectorSlugToChannel(installationRow.connectorSlug);
      return this.createBulkPublishRun(installationRow.connectorSlug, installationId, channel, productIds, tenantKey, actor);
    }

    // CTO review follow-up (PR #719, 2026-09-05): the DTO's shared @ArrayMaxSize was raised
    // 200->2000 for the async (non-native) path above, but this native branch is still
    // fully synchronous in-request — a request with 2000 productIds now reaches here and
    // reintroduces the original BUG-BULK-PUBLISH-TIMEOUT-001 timeout, just at a higher
    // threshold. Re-establish the native path's own bound here, independent of the async
    // ceiling, rather than relying on the shared DTO field.
    if (productIds.length > NATIVE_BULK_PUBLISH_CEILING) {
      throw new BadRequestException(
        `This connector publishes as a single synchronous batch feed and accepts at most ${NATIVE_BULK_PUBLISH_CEILING} products per request (received ${productIds.length}). Split into smaller batches and retry.`,
      );
    }

    // TC-06: this loop was previously sequential (one await chain per product), which made
    // the whole request scale linearly with batch size against a DB path that isn't privately
    // networked (see #531 item 4). Evaluate concurrently instead, same runWithConcurrency
    // pattern already used for the per-product export-job queuing a few lines below. Amazon's
    // batch is bounded by NATIVE_BULK_PUBLISH_CEILING just above, so this stays synchronous.
    type EligibleProduct = {
      productId: string;
      product: { id: string; status: string; categoryId: string; brand: string | null; version: number; updatedAt: Date };
      readiness: { ok: boolean; blockers: string[]; warnings: string[] };
    };
    const eligibilityResults = await this.runWithConcurrency(
      productIds.map((productId) => async (): Promise<
        ({ eligible: true } & EligibleProduct) | { productId: string; eligible: false; reason: string }
      > => {
        // Select every field createExportJob's own product.findUnique would otherwise
        // re-fetch a few lines later in the same request (see #554) — carrying this
        // object through skips that second full-row fetch for eligible products.
        const product = await db.product.findUnique({
          where: { id: productId },
          select: { id: true, status: true, categoryId: true, brand: true, version: true, updatedAt: true },
        });
        if (!product) {
          return { productId, eligible: false, reason: "Product not found." };
        }
        if (product.status !== "approved" && product.status !== "active") {
          return {
            productId,
            eligible: false,
            reason: `Product must be approved before publishing. Current status: ${product.status}.`,
          };
        }
        const readiness = await this.connectorMappingService.evaluatePublishReadiness({
          connectorSlug: installationRow.connectorSlug,
          categoryScope: product.categoryId,
          installationId,
          productId,
        });
        if (!readiness.ok) {
          return { productId, eligible: false, reason: readiness.blockers.join("; ") || "Not ready for this destination." };
        }
        return { productId, eligible: true, product, readiness };
      }),
      5,
    );

    const excluded: Array<{ productId: string; reason: string }> = [];
    const eligibleProducts: EligibleProduct[] = [];
    for (const result of eligibilityResults) {
      if (result.eligible) {
        eligibleProducts.push({ productId: result.productId, product: result.product, readiness: result.readiness });
      } else {
        excluded.push({ productId: result.productId, reason: result.reason });
      }
    }
    const eligibleProductIds = eligibleProducts.map((item) => item.productId);

    if (!eligibleProductIds.length) {
      throw new BadRequestException({
        error: "no_eligible_products",
        message: "No products in this batch are approved and publish-ready.",
        excluded,
      });
    }

    // The single-product path (createExportJob, above) enforces the plan's monthly
    // submissions limit via PlanGuard at the controller layer — but that's an HTTP
    // decorator, and this bulk-publish endpoint is a separate route that never passes
    // through it. This branch (Amazon's native feed) creates a ConnectorSubmission per
    // eligible product, so without this check a tenant could repeatedly call this
    // endpoint to blow past their monthly cap. Same enforcement, same error shape as
    // PlanGuard, applied here as a preflight. (The non-native branch above has its own
    // equivalent check, using an approval-status-only count — see createBulkPublishRun.)
    const submissionLimitCheck = await this.planUsageService.checkLimit(
      "submissions",
      eligibleProductIds.length,
      tenantKey,
    );
    if (!submissionLimitCheck.allowed) {
      const contactUrl = String(process.env.PIM_COMMERCIAL_CONTACT_URL ?? "").trim() || null;
      throw new HttpException(
        {
          error: "PLAN_LIMIT_EXCEEDED",
          resource: submissionLimitCheck.resource,
          limit: submissionLimitCheck.limit,
          current: submissionLimitCheck.current,
          upgrade_url: "/admin/plan",
          contact_url: contactUrl,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
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
   * Bulk-Publish Goes Async, Stories 3+4: entry point for connectors without a native
   * async batch/feed API (Shopify, WooCommerce, ...). These publish synchronously per
   * product — there is no single feed submission to poll the way Amazon's Feeds API
   * works — so the old synchronous fallback (bulkPublishViaQueuedExportJobs, removed)
   * ran the full per-product createExportJob loop inline in the HTTP request, which is
   * exactly what caused BUG-BULK-PUBLISH-TIMEOUT-001/#545/TC-06 once a batch got large.
   *
   * This replacement does only batch-cost-independent work before returning: one
   * status-only query, the plan-limit check against that count, and one run+items
   * insert. Everything per-product — the readiness re-check and the actual
   * createExportJob call — moves into processBulkPublishRun, run by the
   * MARKETPLACE_BULK_PUBLISH queue consumer registered in registerConnectorWorker().
   */
  private async createBulkPublishRun(
    connectorSlug: string,
    installationId: string,
    channel: MarketplaceChannel,
    productIdsInput: string[],
    tenantKey: string,
    actor?: PolicyActor,
  ): Promise<{
    async: true;
    runId: string;
    status: "queued";
    requestedCount: number;
    excludedCount: number;
    excluded: Array<{ productId: string; reason: string }>;
  }> {
    const productIds = this.uniqueStrings(productIdsInput);
    const db = this.prisma.tenant();

    // Cheap approval-status-only check — the full readiness re-evaluation
    // (evaluatePublishReadiness) happens per item in the worker instead, since it's
    // not needed to decide whether this run is worth creating at all, and running it
    // here for every product would reintroduce the exact synchronous cost this story
    // removes.
    const rows = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, status: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const excluded: Array<{ productId: string; reason: string }> = [];
    const eligibleProductIds: string[] = [];
    for (const productId of productIds) {
      const row = byId.get(productId);
      if (!row) {
        excluded.push({ productId, reason: "Product not found." });
      } else if (row.status !== "approved" && row.status !== "active") {
        excluded.push({
          productId,
          reason: `Product must be approved before publishing. Current status: ${row.status}.`,
        });
      } else {
        eligibleProductIds.push(productId);
      }
    }

    if (!eligibleProductIds.length) {
      throw new BadRequestException({
        error: "no_eligible_products",
        message: "No products in this batch are approved and publish-ready.",
        excluded,
      });
    }

    // Same PlanGuard-equivalent preflight as the native-connector branch above — this
    // route never passes through the HTTP-decorator PlanGuard, so it's enforced here.
    // Uses the cheap approval-status count rather than the full readiness result;
    // items the worker later excludes on readiness grounds still counted toward this
    // request's limit check, matching how the old synchronous path counted them too
    // (readiness-excluded items were already past the limit check by the time they
    // were excluded there).
    const submissionLimitCheck = await this.planUsageService.checkLimit(
      "submissions",
      eligibleProductIds.length,
      tenantKey,
    );
    if (!submissionLimitCheck.allowed) {
      const contactUrl = String(process.env.PIM_COMMERCIAL_CONTACT_URL ?? "").trim() || null;
      throw new HttpException(
        {
          error: "PLAN_LIMIT_EXCEEDED",
          resource: submissionLimitCheck.resource,
          limit: submissionLimitCheck.limit,
          current: submissionLimitCheck.current,
          upgrade_url: "/admin/plan",
          contact_url: contactUrl,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const run = await db.marketplaceBulkPublishRun.create({
      data: {
        tenantKey,
        installationId,
        connectorSlug,
        channel,
        requestedCount: eligibleProductIds.length,
        excludedCount: excluded.length,
        status: MarketplaceBulkPublishRunStatus.queued,
        createdBy: actor?.actorId ?? null,
        items: {
          create: eligibleProductIds.map((productId) => ({
            tenantKey,
            productId,
            idempotencyKey: `${channel}:${installationId}:${productId}`,
            status: MarketplaceBulkPublishItemStatus.pending,
          })),
        },
      },
    });

    await this.queueService.enqueue<MarketplaceBulkPublishJobPayload>(QUEUE_NAMES.MARKETPLACE_BULK_PUBLISH, {
      runId: run.id,
      tenantKey,
      actor: actor ?? {},
    });

    this.logger.info("Bulk publish run queued (connector has no native batch API)", {
      runId: run.id,
      installationId,
      connectorSlug,
      requestedCount: eligibleProductIds.length,
      excludedCount: excluded.length,
    });

    return {
      async: true,
      runId: run.id,
      status: "queued",
      requestedCount: eligibleProductIds.length,
      excludedCount: excluded.length,
      excluded,
    };
  }

  /**
   * Queue handler for a single bulk-publish run. Idempotent and resumable — same shape
   * as BulkEditService.processApplyJob (bulk-edit.service.ts): on redelivery it skips
   * items already resolved to a terminal status and continues from there, rather than
   * re-publishing or double-counting. Each item goes through the exact same
   * createExportJob() pipeline as the single-product "Queue channel export" action —
   * no precomputed product/readiness is passed, since a fresh re-check after an async
   * delay is the correct behavior here (the product may have changed since the run was
   * requested), unlike the synchronous native-connector path above where staleness
   * within the same request isn't a concern.
   */
  private async processBulkPublishRun(payload: MarketplaceBulkPublishJobPayload): Promise<void> {
    const db = this.prisma.tenant();
    const run = await db.marketplaceBulkPublishRun.findUnique({ where: { id: payload.runId } });
    if (!run) {
      this.logger.warn("Bulk publish run not found — skipping.", { runId: payload.runId });
      return;
    }
    if (
      run.status !== MarketplaceBulkPublishRunStatus.queued &&
      run.status !== MarketplaceBulkPublishRunStatus.processing
    ) {
      // Already terminal — redelivery no-op.
      return;
    }

    if (!isAsyncBulkPublishEnabled()) {
      this.logger.warn("Bulk publish run paused by feature flag.", {
        runId: run.id,
        tenantKey: payload.tenantKey,
      });
      return;
    }

    if (run.status === MarketplaceBulkPublishRunStatus.queued) {
      await db.marketplaceBulkPublishRun.update({
        where: { id: run.id },
        data: { status: MarketplaceBulkPublishRunStatus.processing },
      });
    }

    // Pick up never-claimed items (`pending`) as well as items claimed by a worker that
    // never finished them — a crash between the claim below and the item reaching a
    // terminal status would otherwise strand it at `queued` forever, since nothing else
    // ever moves it back to `pending`.
    const reclaimCutoff = new Date(Date.now() - BULK_PUBLISH_ITEM_RECLAIM_THRESHOLD_MS);
    const pendingItems = await db.marketplaceBulkPublishRunItem.findMany({
      where: {
        runId: run.id,
        OR: [
          { status: MarketplaceBulkPublishItemStatus.pending },
          {
            status: MarketplaceBulkPublishItemStatus.queued,
            claimedAt: { lt: reclaimCutoff },
          },
        ],
      },
      select: { id: true, productId: true },
    });

    await this.runWithConcurrency(
      pendingItems.map((item) => async () => {
        // Claim the item (queued + claimedAt = now) so a concurrent redelivery of this
        // same job — or another lane still genuinely mid-flight on this item — can't
        // double-process it: the WHERE clause below only matches the same two states
        // the SELECT above did, so a freshly-claimed item (claimedAt within the
        // threshold) won't match and this update is a no-op for it.
        const claimed = await db.marketplaceBulkPublishRunItem.updateMany({
          where: {
            id: item.id,
            OR: [
              { status: MarketplaceBulkPublishItemStatus.pending },
              {
                status: MarketplaceBulkPublishItemStatus.queued,
                claimedAt: { lt: reclaimCutoff },
              },
            ],
          },
          data: { status: MarketplaceBulkPublishItemStatus.queued, claimedAt: new Date() },
        });
        if (claimed.count === 0) {
          return;
        }
        try {
          const job = await this.createExportJob(
            item.productId,
            // run.channel is stored as a plain string (see MarketplaceBulkPublishRun in
            // schema.prisma) but was itself produced by mapConnectorSlugToChannel when
            // this run was created — already a valid MarketplaceChannel.
            { channel: run.channel as MarketplaceChannel, installationId: run.installationId },
            payload.actor,
          );
          await db.marketplaceBulkPublishRunItem.update({
            where: { id: item.id },
            data: {
              status: MarketplaceBulkPublishItemStatus.succeeded,
              exportJobId: job.id as string,
              attemptCount: { increment: 1 },
            },
          });
        } catch (error: unknown) {
          // Same distinction the old synchronous eligibility loop made between an
          // ineligible product (excluded from the batch, not retried) and an
          // operational failure (retryable): BadRequestException (status/validation),
          // NotFoundException (product deleted mid-run) and ForbiddenException (the
          // actor/access-policy gate — see access-policy.service.ts's deny()) all mean
          // createExportJob's own gates rejected the product for a reason retrying
          // won't change. Anything else (network, transient DB, connector error) is
          // left retry-eligible for a future requeue.
          const reason = error instanceof Error ? error.message : String(error);
          const isIneligible =
            error instanceof BadRequestException ||
            error instanceof NotFoundException ||
            error instanceof ForbiddenException;
          await db.marketplaceBulkPublishRunItem.update({
            where: { id: item.id },
            data: {
              status: isIneligible
                ? MarketplaceBulkPublishItemStatus.excluded
                : MarketplaceBulkPublishItemStatus.failed,
              reason,
              retryEligible: !isIneligible,
              attemptCount: { increment: 1 },
            },
          });
        }
      }),
      5,
    );

    await this.finalizeBulkPublishRun(run.id);
  }

  /**
   * Recomputes succeeded/failed/excluded counts from MarketplaceBulkPublishRunItem via
   * groupBy — same pattern as BulkEditService.finalizeOperation (bulk-edit.service.ts)
   * — rather than accumulating in-memory counters, so this stays correct across
   * resumed/redelivered runs where a prior partial attempt already wrote some items.
   */
  private async finalizeBulkPublishRun(runId: string): Promise<void> {
    const db = this.prisma.tenant();
    const statusGroups = await db.marketplaceBulkPublishRunItem.groupBy({
      by: ["status"],
      where: { runId },
      _count: { status: true },
    });

    let succeededCount = 0;
    let failedCount = 0;
    let excludedCount = 0;
    let pendingOrQueuedCount = 0;
    for (const group of statusGroups) {
      if (group.status === MarketplaceBulkPublishItemStatus.succeeded) {
        succeededCount = group._count.status;
      } else if (group.status === MarketplaceBulkPublishItemStatus.failed) {
        failedCount = group._count.status;
      } else if (group.status === MarketplaceBulkPublishItemStatus.excluded) {
        excludedCount = group._count.status;
      } else {
        pendingOrQueuedCount += group._count.status;
      }
    }

    if (pendingOrQueuedCount > 0) {
      // Items are still mid-flight (e.g. a concurrent redelivery claimed some after
      // this run's own batch already returned) — leave the run in processing rather
      // than finalizing early; the redelivery's own finalize call will complete it.
      return;
    }

    const status =
      failedCount > 0 && succeededCount === 0
        ? MarketplaceBulkPublishRunStatus.failed
        : failedCount > 0
          ? MarketplaceBulkPublishRunStatus.completed_with_errors
          : MarketplaceBulkPublishRunStatus.completed;

    await db.marketplaceBulkPublishRun.update({
      where: { id: runId },
      data: { status, succeededCount, failedCount, excludedCount: { increment: excludedCount } },
    });
  }

  /**
   * Bulk-Publish Goes Async, Story 7: list recent runs for the Jobs workspace's bulk-
   * publish panel — mirrors listDeadLetterSubmissions' cursor-pagination shape above
   * (same tenant-scoped findMany + updatedAt/id cursor pattern) so the Jobs page can
   * page through history the same way it already does for dead-letter jobs.
   */
  async listBulkPublishRuns(pagination?: CursorPaginationQuery, installationId?: string) {
    const db = this.prisma.tenant();
    const installationFilter = installationId ? { installationId } : {};
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

      const runs = await db.marketplaceBulkPublishRun.findMany({
        where: {
          ...installationFilter,
          ...(token && cursorDate
            ? {
                OR: [
                  { updatedAt: { lt: cursorDate } },
                  { updatedAt: cursorDate, id: { lt: token.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });

      const hasNext = runs.length > limit;
      const items = hasNext ? runs.slice(0, limit) : runs;
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

    return db.marketplaceBulkPublishRun.findMany({
      where: installationFilter,
      orderBy: [{ updatedAt: "desc" }],
      take: resolveCollectionLimit(pagination?.limit),
    });
  }

  /**
   * Bulk-Publish Goes Async, Story 5: status polling for a run created by
   * createBulkPublishRun. Mirrors BulkEditService.listOperations' per-operation shape
   * (items included, capped) rather than requiring a second round trip for item detail.
   */
  async getBulkPublishRun(runId: string) {
    const run = await this.prisma.tenant().marketplaceBulkPublishRun.findUnique({
      where: { id: runId },
      include: {
        items: {
          take: 500,
          orderBy: [{ createdAt: "asc" }],
        },
      },
    });
    if (!run) {
      throw new NotFoundException("Bulk publish run not found.");
    }
    return run;
  }

  /**
   * CTO review follow-up (PR #719, 2026-09-05): the review flagged that a failed item's
   * `retryEligible: true` flag was set but nothing ever read it — there was no operator
   * action to actually retry a failed run. Mirrors requeueExportJob's shape (atomic
   * updateMany claim, re-enqueue) rather than inventing new item/run states: retried
   * items go back to `pending` — the exact state processBulkPublishRun's own claim query
   * already knows how to pick up — instead of a bespoke "retrying" status.
   */
  async retryFailedBulkPublishRun(runId: string, actor?: PolicyActor) {
    const db = this.prisma.tenant();
    const run = await db.marketplaceBulkPublishRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException("Bulk publish run not found.");
    }

    if (!isAsyncBulkPublishEnabled()) {
      throw new ServiceUnavailableException(BULK_PUBLISH_ASYNC_DISABLED_MESSAGE);
    }

    // Only failed, retry-eligible items — never touches succeeded items or items
    // excluded for being ineligible (those are never retryable, by construction: see
    // processBulkPublishRun's isIneligible branch, which sets retryEligible: false).
    const failedItems = await db.marketplaceBulkPublishRunItem.findMany({
      where: { runId, status: MarketplaceBulkPublishItemStatus.failed, retryEligible: true },
      select: { id: true },
    });
    if (failedItems.length === 0) {
      return { runId, retriedCount: 0, status: run.status };
    }

    const submissionLimitCheck = await this.planUsageService.checkLimit(
      "submissions",
      failedItems.length,
      run.tenantKey,
    );
    if (!submissionLimitCheck.allowed) {
      const contactUrl = String(process.env.PIM_COMMERCIAL_CONTACT_URL ?? "").trim() || null;
      throw new HttpException(
        {
          error: "PLAN_LIMIT_EXCEEDED",
          resource: submissionLimitCheck.resource,
          limit: submissionLimitCheck.limit,
          current: submissionLimitCheck.current,
          upgrade_url: "/admin/plan",
          contact_url: contactUrl,
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const itemIds = failedItems.map((item) => item.id);
    await db.marketplaceBulkPublishRunItem.updateMany({
      where: { id: { in: itemIds }, status: MarketplaceBulkPublishItemStatus.failed, retryEligible: true },
      data: { status: MarketplaceBulkPublishItemStatus.pending, reason: null, claimedAt: null },
    });

    // Only force the run itself back to `queued` from a terminal state (failed /
    // completed_with_errors). If it's still `queued`/`processing` (some items already
    // failed while others are still mid-flight), leave the run's own status alone —
    // processBulkPublishRun's claim mechanism picks up the newly-pending items on its
    // own next pass regardless, and forcing a still-active run's status here would race
    // whatever is currently processing it.
    const RETRYABLE_RUN_STATUSES: MarketplaceBulkPublishRunStatus[] = [
      MarketplaceBulkPublishRunStatus.failed,
      MarketplaceBulkPublishRunStatus.completed_with_errors,
    ];
    if (RETRYABLE_RUN_STATUSES.includes(run.status)) {
      await db.marketplaceBulkPublishRun.update({
        where: { id: runId },
        data: { status: MarketplaceBulkPublishRunStatus.queued },
      });
    }

    await this.queueService.enqueue<MarketplaceBulkPublishJobPayload>(QUEUE_NAMES.MARKETPLACE_BULK_PUBLISH, {
      runId,
      tenantKey: run.tenantKey,
      actor: actor ?? {},
    });

    this.logger.info("Bulk publish run retry queued", {
      runId,
      retriedCount: itemIds.length,
      actorId: actor?.actorId ?? null,
    });

    return { runId, retriedCount: itemIds.length, status: MarketplaceBulkPublishRunStatus.queued };
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

    const installationRow = await this.resolveInstallationWithSlug(installationId, db, tenantKey);
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
   * untyped FK in the schema), so we use queryRaw for a proper LEFT JOIN.
   * This collapses the repeated findFirst(installation) → findUnique(definition)
   * pattern that appears across several methods into one round-trip.
   *
   * Returns null when the installation does not exist.
   */
  private async resolveInstallationWithSlug(
    installationId: string,
    db: ReturnType<typeof this.prisma.tenant>,
    tenantKey: string,
  ): Promise<{
    id: string;
    connectorId: string;
    tenantKey: string;
    connectorSlug: string;
    capabilities: string[];
  } | null> {
    // RLS-BYPASS: manual tenant filter — WHERE ci.tenant_key = ${tenantKey} below.
    // Found during the 2026-09-20 raw-SQL coverage sweep (VBPIM/PIM#886 follow-up):
    // this query originally had no tenant_key filter at all, so an installationId
    // belonging to a DIFFERENT tenant would resolve successfully instead of
    // returning null — and importShopifyConfig()/getShopifyConfig() then acted on
    // the WRONG tenant's installation (installation.tenantKey flows straight into
    // the connector ctx), since the only gate on these endpoints is @Roles(),
    // not tenant ownership of the installationId path param.
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
        AND ci.tenant_key = ${tenantKey}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;

    // Prisma's queryRaw may return a PostgreSQL text[] as a JS array or as
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
