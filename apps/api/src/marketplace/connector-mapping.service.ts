import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RuleSeverity, ValidationIssueStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { MetricsService } from "../metrics/metrics.service";
import { PrismaService } from "../prisma/prisma.service";

export type MappingLevel =
  | "connector_default_template"
  | "tenant_connector_default"
  | "tenant_connector_category_mapping";

export type MappingLifecycle = "draft" | "validated" | "published" | "superseded" | "archived";
export type MappingCompatibility = "compatible" | "deprecated" | "remap_required" | "blocked";
export type MappingEventType =
  | "created"
  | "validated"
  | "published"
  | "superseded"
  | "archived"
  | "resolution_evaluated";

export interface ConnectorMappingHistoryEntry {
  actorId: string | null;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorMappingHistory {
  created?: ConnectorMappingHistoryEntry;
  validated?: ConnectorMappingHistoryEntry;
  published?: ConnectorMappingHistoryEntry;
  archived?: ConnectorMappingHistoryEntry;
  rollback?: ConnectorMappingHistoryEntry;
}

export interface ConnectorMappingVersion {
  id: string;
  tenantKey: string;
  connectorSlug: string;
  installationId: string | null;
  draftInstallationId: string | null;
  categoryScope: string;
  mappingLevel: MappingLevel;
  lifecycleState: MappingLifecycle;
  connectorDefinitionId: string;
  connectorDefinitionVersion: string;
  compatibilityState: MappingCompatibility;
  mappingRules: Record<string, unknown>;
  fallbackPolicy: Record<string, unknown>;
  fallbackAckRequired: boolean;
  publishedAt: string | null;
  supersededBy: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  history?: ConnectorMappingHistory;
}

export interface MappingPreflightResult {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  compatibilityState: MappingCompatibility;
  fallbackApplied: boolean;
  fallbackAckRequired: boolean;
  matchedVersionIds: string[];
}

const lifecycleTransitions: Record<MappingLifecycle, MappingLifecycle[]> = {
  draft: ["validated", "archived"],
  validated: ["published", "archived"],
  published: ["superseded", "archived"],
  superseded: ["archived"],
  archived: [],
};

const SYSTEM_CONNECTOR_DEFAULTS: Record<string, Record<string, string>> = {
  "amazon-in": {
    title: "item_name",
    brand: "brand_name",
    description: "product_description",
    hsnCode: "hsn_code",
    gstRate: "tax_rate",
    "attributes.color": "color_name",
    "attributes.material": "material_type",
    "attributes.size": "size_name",
  },
  amazon: {
    title: "item_name",
    brand: "brand_name",
    description: "product_description",
    hsnCode: "hsn_code",
    gstRate: "tax_rate",
    "attributes.color": "color_name",
    "attributes.material": "material_type",
    "attributes.size": "size_name",
  },
  flipkart: {
    title: "product_title",
    brand: "brand",
    description: "description",
    hsnCode: "hsn_code",
    gstRate: "gst_rate",
    "attributes.size": "size",
    "attributes.color": "color",
    "attributes.material": "material",
  },
  meesho: {
    title: "product_name",
    brand: "brand",
    hsnCode: "hsn",
    gstRate: "gst",
    "attributes.color": "color",
    "attributes.material": "fabric",
  },
  shopify: {
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
};

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeIso(value: unknown): string | null {
  if (!value) return null;
  return new Date(String(value)).toISOString();
}

function canTransition(from: MappingLifecycle, to: MappingLifecycle): boolean {
  return lifecycleTransitions[from]?.includes(to) ?? false;
}

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = output[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      output[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    output[key] = value;
  }
  return output;
}

function applyAttributeOverrides(mappingRules: Record<string, unknown>): Record<string, unknown> {
  const fieldMappings = parseObject(mappingRules.field_mappings);
  const overrides = parseObject(mappingRules.attribute_overrides);
  if (Object.keys(overrides).length === 0) {
    return mappingRules;
  }
  return {
    ...mappingRules,
    field_mappings: {
      ...fieldMappings,
      ...overrides,
    },
  };
}

function compatibilitySeverity(state: MappingCompatibility): number {
  if (state === "blocked") return 4;
  if (state === "remap_required") return 3;
  if (state === "deprecated") return 2;
  return 1;
}

function highestCompatibility(states: MappingCompatibility[]): MappingCompatibility {
  let selected: MappingCompatibility = "compatible";
  let currentWeight = 1;
  for (const state of states) {
    const stateWeight = compatibilitySeverity(state);
    if (stateWeight > currentWeight) {
      currentWeight = stateWeight;
      selected = state;
    }
  }
  return selected;
}

function firstDefined<T>(...values: T[]): T | undefined {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function toVersion(row: Record<string, unknown>): ConnectorMappingVersion {
  const id = firstDefined(row.id);
  const tenantKey = firstDefined(row.tenantKey, row.tenant_key);
  const connectorSlug = firstDefined(row.connectorSlug, row.connector_slug);
  const rawInstallationId = firstDefined(row.installationId, row.installation_id);
  const rawDraftInstallationId = firstDefined(row.draftInstallationId, row.draft_installation_id);
  const categoryScope = firstDefined(row.categoryScope, row.category_scope);
  const mappingLevel = firstDefined(row.mappingLevel, row.mapping_level);
  const lifecycleState = firstDefined(row.lifecycleState, row.lifecycle_state);
  const connectorDefinitionId = firstDefined(row.connectorDefinitionId, row.connector_definition_id);
  const connectorDefinitionVersion = firstDefined(row.connectorDefinitionVersion, row.connector_definition_version);
  const compatibilityState = firstDefined(row.compatibilityState, row.compatibility_state);
  const mappingRules = firstDefined(row.mappingRules, row.mapping_rules);
  const fallbackPolicy = firstDefined(row.fallbackPolicy, row.fallback_policy);
  const fallbackAckRequired = firstDefined(row.fallbackAckRequired, row.fallback_ack_required);
  const publishedAt = firstDefined(row.publishedAt, row.published_at);
  const supersededBy = firstDefined(row.supersededBy, row.superseded_by);
  const createdBy = firstDefined(row.createdBy, row.created_by);
  const createdAt = firstDefined(row.createdAt, row.created_at);
  const updatedAt = firstDefined(row.updatedAt, row.updated_at);
  const archivedAt = firstDefined(row.archivedAt, row.archived_at);
  return {
    id: String(id),
    tenantKey: String(tenantKey),
    connectorSlug: String(connectorSlug),
    installationId: rawInstallationId != null ? String(rawInstallationId) : null,
    draftInstallationId: rawDraftInstallationId != null ? String(rawDraftInstallationId) : null,
    categoryScope: String(categoryScope),
    mappingLevel: String(mappingLevel) as MappingLevel,
    lifecycleState: String(lifecycleState) as MappingLifecycle,
    connectorDefinitionId: String(connectorDefinitionId),
    connectorDefinitionVersion: String(connectorDefinitionVersion),
    compatibilityState: String(compatibilityState) as MappingCompatibility,
    mappingRules: parseObject(mappingRules),
    fallbackPolicy: parseObject(fallbackPolicy),
    fallbackAckRequired: Boolean(fallbackAckRequired),
    publishedAt: normalizeIso(publishedAt),
    supersededBy: supersededBy ? String(supersededBy) : null,
    createdBy: createdBy ? String(createdBy) : null,
    createdAt: new Date(String(createdAt)).toISOString(),
    updatedAt: new Date(String(updatedAt)).toISOString(),
    archivedAt: normalizeIso(archivedAt),
  };
}

function toHistoryEntry(row: Record<string, unknown>): ConnectorMappingHistoryEntry {
  const actorId = firstDefined(row.actorId, row.actor_id);
  const createdAt = firstDefined(row.createdAt, row.created_at);
  const metadata = firstDefined(row.metadata);
  return {
    actorId: actorId ? String(actorId) : null,
    createdAt: new Date(String(createdAt)).toISOString(),
    metadata: parseObject(metadata),
  };
}

function withHistory(
  version: ConnectorMappingVersion,
  history: ConnectorMappingHistory | undefined,
): ConnectorMappingVersion {
  if (!history) {
    return version;
  }
  return {
    ...version,
    history,
  };
}

// Five-level merge order (ascending weight = merged first = lowest precedence):
//   0 = slug-scoped tenant default
//   1 = slug-scoped category mapping
//   2 = installation-scoped tenant default
//   3 = installation-scoped category mapping
// Installation-scoped rows must always come AFTER slug-scoped rows at the same level so that
// the final deepMerge wins go to the most-specific mapping. Using only mappingLevel previously
// gave both slug-scoped and installation-scoped defaults the same weight, meaning a slug-default
// created after an install-default would silently override it via the createdAt tiebreaker.
function mappingResolutionWeight(version: ConnectorMappingVersion): number {
  const installOffset = version.installationId ? 2 : 0;
  const levelOffset = version.mappingLevel === "tenant_connector_category_mapping" ? 1 : 0;
  return installOffset + levelOffset;
}

function sortMappingsForResolution(items: ConnectorMappingVersion[]): ConnectorMappingVersion[] {
  return [...items].sort((left, right) => {
    const weightDiff = mappingResolutionWeight(left) - mappingResolutionWeight(right);
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return Date.parse(left.createdAt) - Date.parse(right.createdAt);
  });
}

@Injectable()
export class ConnectorMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metricsService: MetricsService,
  ) {}

  private getTenantKey(): string {
    return getTenantKeyFromContext();
  }

  private async appendEvent(input: {
    tenantKey: string;
    mappingVersionId: string;
    eventType: MappingEventType;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.tenant(input.tenantKey).connectorMappingEvent.create({
      data: {
        id: randomUUID(),
        mappingVersionId: input.mappingVersionId,
        eventType: input.eventType,
        actorId: input.actorId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  validateMappingRules(input: {
    mappingLevel: MappingLevel;
    categoryScope: string;
    mappingRules: Record<string, unknown>;
    fallbackAckRequired?: boolean;
    fallbackPolicy?: Record<string, unknown>;
  }): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const categoryScope = String(input.categoryScope ?? "").trim();
    if (!categoryScope) {
      errors.push("category_scope_required");
    }
    if (input.mappingLevel === "tenant_connector_default" && categoryScope !== "*") {
      errors.push("tenant_connector_default_requires_global_scope");
    }
    if (input.mappingLevel === "tenant_connector_category_mapping" && categoryScope === "*") {
      errors.push("tenant_connector_category_mapping_requires_specific_scope");
    }
    if (input.mappingLevel === "connector_default_template" && categoryScope !== "*") {
      errors.push("connector_default_template_requires_global_scope");
    }

    const mappingRules = parseObject(input.mappingRules);
    const fieldMappings = parseObject(mappingRules.field_mappings);
    if (input.mappingLevel !== "connector_default_template" && Object.keys(fieldMappings).length === 0) {
      errors.push("field_mappings_required");
    }
    if (input.mappingLevel === "tenant_connector_category_mapping") {
      const category = parseObject(mappingRules.category);
      const target = typeof category.target === "string" ? category.target.trim() : "";
      if (!target) {
        errors.push("target_category_required");
      }
    }

    const fallbackPolicy = parseObject(input.fallbackPolicy);
    if (input.fallbackAckRequired && Object.keys(fallbackPolicy).length === 0) {
      errors.push("fallback_policy_required_when_ack_is_enabled");
    }

    const fallbackDefaultCategory = typeof fallbackPolicy.default_category === "string"
      ? fallbackPolicy.default_category.trim()
      : "";
    const targetCategory = typeof parseObject(parseObject(input.mappingRules).category).target === "string"
      ? (parseObject(parseObject(input.mappingRules).category).target as string).trim()
      : "";
    if (fallbackDefaultCategory && targetCategory && fallbackDefaultCategory === targetCategory) {
      errors.push("fallback_category_cannot_match_target_category");
    }

    return { valid: errors.length === 0, errors };
  }

  async listVersions(input: {
    connectorSlug: string;
    categoryScope?: string;
    installationId?: string;
    includeArchived?: boolean;
  }): Promise<ConnectorMappingVersion[]> {
    const tenantKey = this.getTenantKey();
    const rows = await this.prisma.tenant(tenantKey).connectorMappingVersion.findMany({
      where: {
        connectorSlug: input.connectorSlug,
        ...(input.categoryScope ? { categoryScope: input.categoryScope } : {}),
        ...(input.installationId
          ? { OR: [{ installationId: input.installationId }, { installationId: null }] }
          : {}),
        ...(input.includeArchived ? {} : { lifecycleState: { not: "archived" } }),
      },
      orderBy: { createdAt: "desc" },
      take: 1_000, // defensive cap — mapping versions per connector/category scope
    });
    const versions = rows.map((row) => toVersion(row as unknown as Record<string, unknown>));
    if (versions.length === 0) {
      return versions;
    }

    const eventRows = await this.prisma.tenant(tenantKey).connectorMappingEvent.findMany({
      where: {
        mappingVersionId: { in: versions.map((version) => version.id) },
      },
      orderBy: { createdAt: "asc" },
      take: 10_000, // defensive cap — audit events across all versions above
    });
    const historyByVersion = new Map<string, ConnectorMappingHistory>();
    for (const eventRow of eventRows) {
      const mappingVersionId = String(eventRow.mappingVersionId);
      const history = historyByVersion.get(mappingVersionId) ?? {};
      const entry = toHistoryEntry(eventRow as unknown as Record<string, unknown>);
      const metadata = entry.metadata ?? {};
      const rollbackEvent = Boolean(metadata.rollback);

      if (eventRow.eventType === "created") {
        if (rollbackEvent) {
          history.rollback = entry;
        } else if (!history.created) {
          history.created = entry;
        }
      } else if (eventRow.eventType === "validated" && !history.validated) {
        history.validated = entry;
      } else if (eventRow.eventType === "published" && !history.published) {
        history.published = entry;
        if (rollbackEvent && !history.rollback) {
          history.rollback = entry;
        }
      } else if (eventRow.eventType === "archived" && !history.archived) {
        history.archived = entry;
      }

      historyByVersion.set(mappingVersionId, history);
    }

    return versions.map((version) => withHistory(version, historyByVersion.get(version.id)));
  }

  async createDraft(input: {
    connectorSlug: string;
    categoryScope: string;
    mappingLevel: Exclude<MappingLevel, "connector_default_template">;
    connectorDefinitionId: string;
    connectorDefinitionVersion: string;
    compatibilityState?: MappingCompatibility;
    mappingRules: Record<string, unknown>;
    fallbackPolicy?: Record<string, unknown>;
    fallbackAckRequired?: boolean;
    installationId?: string | null;
    actorId?: string | null;
  }): Promise<ConnectorMappingVersion> {
    const tenantKey = this.getTenantKey();
    const validation = this.validateMappingRules({
      mappingLevel: input.mappingLevel,
      categoryScope: input.categoryScope,
      mappingRules: input.mappingRules,
      fallbackAckRequired: input.fallbackAckRequired,
      fallbackPolicy: input.fallbackPolicy,
    });
    if (!validation.valid) {
      throw new BadRequestException({
        error: "invalid_mapping",
        details: validation.errors,
      });
    }

    const connectorDef = await this.prisma.tenant(tenantKey).connectorDefinition.findUnique({
      where: { slug: input.connectorSlug },
      select: { id: true, slug: true },
    });
    if (!connectorDef) {
      throw new NotFoundException("connector_not_found");
    }
    if (
      input.connectorDefinitionId &&
      input.connectorDefinitionId !== connectorDef.id &&
      input.connectorDefinitionId !== connectorDef.slug
    ) {
      throw new BadRequestException("connector_definition_id_mismatch");
    }

    if (input.installationId) {
      const installation = await this.prisma.tenant(tenantKey).connectorInstallation.findFirst({
        where: { id: input.installationId, connectorId: connectorDef.id },
        select: { id: true },
      });
      if (!installation) {
        throw new BadRequestException("installation_not_found_for_connector");
      }
    }

    const created = await this.prisma.tenant(tenantKey).connectorMappingVersion.create({
      data: {
        id: randomUUID(),
        connectorSlug: input.connectorSlug,
        categoryScope: input.categoryScope,
        mappingLevel: input.mappingLevel,
        lifecycleState: "draft",
        connectorDefinitionId: input.connectorDefinitionId,
        connectorDefinitionVersion: input.connectorDefinitionVersion,
        compatibilityState: input.compatibilityState ?? "compatible",
        mappingRules: (input.mappingRules ?? {}) as Prisma.InputJsonValue,
        fallbackPolicy: (input.fallbackPolicy ?? {}) as Prisma.InputJsonValue,
        fallbackAckRequired: Boolean(input.fallbackAckRequired),
        installationId: input.installationId ?? null,
        draftInstallationId: input.installationId ?? null,
        createdBy: input.actorId ?? null,
      },
    });
    const version = toVersion(created as unknown as Record<string, unknown>);
    await this.appendEvent({
      tenantKey,
      mappingVersionId: version.id,
      eventType: "created",
      actorId: input.actorId,
      metadata: {
        lifecycle_state: version.lifecycleState,
      },
    });
    return version;
  }

  async getVersionById(input: { connectorSlug: string; versionId: string }): Promise<ConnectorMappingVersion> {
    const tenantKey = this.getTenantKey();
    const row = await this.prisma.tenant(tenantKey).connectorMappingVersion.findFirst({
      where: {
        id: input.versionId,
        connectorSlug: input.connectorSlug,
      },
    });
    if (!row) {
      throw new NotFoundException("mapping_version_not_found");
    }
    return toVersion(row as unknown as Record<string, unknown>);
  }

  async validateVersion(input: {
    connectorSlug: string;
    versionId: string;
    actorId?: string | null;
  }): Promise<ConnectorMappingVersion> {
    const tenantKey = this.getTenantKey();
    const current = await this.getVersionById({
      connectorSlug: input.connectorSlug,
      versionId: input.versionId,
    });
    if (!canTransition(current.lifecycleState, "validated")) {
      throw new ConflictException("invalid_lifecycle_transition");
    }
    const rulesValidation = this.validateMappingRules({
      mappingLevel: current.mappingLevel,
      categoryScope: current.categoryScope,
      mappingRules: current.mappingRules,
      fallbackAckRequired: current.fallbackAckRequired,
      fallbackPolicy: current.fallbackPolicy,
    });
    if (!rulesValidation.valid) {
      throw new BadRequestException({
        error: "invalid_mapping",
        details: rulesValidation.errors,
      });
    }

    await this.prisma.tenant(tenantKey).connectorMappingVersion.updateMany({
      where: {
        id: input.versionId,
        connectorSlug: input.connectorSlug,
      },
      data: {
        lifecycleState: "validated",
      },
    });
    const version = await this.getVersionById({
      connectorSlug: input.connectorSlug,
      versionId: input.versionId,
    });
    await this.appendEvent({
      tenantKey,
      mappingVersionId: version.id,
      eventType: "validated",
      actorId: input.actorId,
      metadata: { lifecycle_state: version.lifecycleState },
    });
    return version;
  }

  async publishVersion(input: {
    connectorSlug: string;
    versionId: string;
    confirm: boolean;
    installationId?: string | null;
    actorId?: string | null;
  }): Promise<{ published: ConnectorMappingVersion; superseded: string[] }> {
    if (!input.confirm) {
      throw new BadRequestException("publish_confirmation_required");
    }
    const tenantKey = this.getTenantKey();
    const result = await this.prisma.tenant(tenantKey).$transaction(async (tx) => {
      const selectedRow = await tx.connectorMappingVersion.findFirst({
        where: {
          id: input.versionId,
          connectorSlug: input.connectorSlug,
        },
      });
      if (!selectedRow) {
        throw new NotFoundException("mapping_version_not_found");
      }
      const selected = toVersion(selectedRow as unknown as Record<string, unknown>);
      if (selected.lifecycleState !== "validated") {
        throw new ConflictException("must_validate_before_publish");
      }

      // Guard: if this draft was created for a specific account, the publish request must
      // name the same account. Prevents silent publishes that evaluated readiness under
      // a different installation than the one used to build the draft.
      // Both conditions throw:
      //   (a) publish names a different account — explicit mismatch
      //   (b) publish omits the account entirely — implicit bypass attempt
      // Exception: draftInstId null = old draft pre-migration; no guard (unknown original account).
      const draftInstId = selectedRow.draftInstallationId;
      if (draftInstId && (!input.installationId || draftInstId !== input.installationId)) {
        throw new ConflictException("account_mismatch_draft_vs_publish");
      }

      // Fetch all published rows at same slug+categoryScope, then post-filter by installationId.
      // Slug-scoped versions (installationId=null) must NOT supersede installation-scoped versions
      // and vice versa — each scope has its own independent "published" slot.
      const supersededCandidates = await tx.connectorMappingVersion.findMany({
        where: {
          connectorSlug: input.connectorSlug,
          categoryScope: selected.categoryScope,
          lifecycleState: "published",
          NOT: { id: selected.id },
        },
        select: { id: true, installationId: true },
      });
      const supersededRows = supersededCandidates.filter((row) => {
        return (row.installationId ?? null) === (selected.installationId ?? null);
      });
      const supersededIds = supersededRows.map((row) => row.id);
      if (supersededIds.length > 0) {
        await tx.connectorMappingVersion.updateMany({
          where: {
            id: { in: supersededIds },
          },
          data: {
            lifecycleState: "superseded",
            supersededBy: selected.id,
          },
        });
      }

      const publishUpdate = await tx.connectorMappingVersion.updateMany({
        where: {
          id: selected.id,
          connectorSlug: input.connectorSlug,
          lifecycleState: "validated",
        },
        data: {
          lifecycleState: "published",
          publishedAt: new Date(),
          supersededBy: null,
          ...(selected.draftInstallationId ? { installationId: selected.draftInstallationId } : {}),
        },
      });
      if (publishUpdate.count !== 1) {
        throw new ConflictException("must_validate_before_publish");
      }

      const publishedRow = await tx.connectorMappingVersion.findFirst({
        where: {
          id: selected.id,
          connectorSlug: input.connectorSlug,
        },
      });
      if (!publishedRow) {
        throw new NotFoundException("mapping_version_not_found");
      }
      const published = toVersion(publishedRow as unknown as Record<string, unknown>);
      for (const supersededId of supersededIds) {
        await tx.connectorMappingEvent.create({
          data: {
            id: randomUUID(),
            mappingVersionId: supersededId,
            eventType: "superseded",
            actorId: input.actorId ?? null,
            metadata: {
              superseded_by: published.id,
            } as Prisma.InputJsonValue,
          },
        });
      }
      await tx.connectorMappingEvent.create({
        data: {
          id: randomUUID(),
          mappingVersionId: published.id,
          eventType: "published",
          actorId: input.actorId ?? null,
          metadata: {
            superseded_count: supersededIds.length,
          } as Prisma.InputJsonValue,
        },
      });
      return { published, superseded: supersededIds };
    });
    await this.emitMappingCompletionMetric(tenantKey, input.connectorSlug);
    return result;
  }

  async rollbackVersion(input: {
    connectorSlug: string;
    versionId: string;
    confirm: boolean;
    reason: string;
    actorId?: string | null;
  }): Promise<{ published: ConnectorMappingVersion; superseded: string[]; rollbackSourceVersionId: string }> {
    if (!input.confirm) {
      throw new BadRequestException("rollback_confirmation_required");
    }
    const tenantKey = this.getTenantKey();
    const result = await this.prisma.tenant(tenantKey).$transaction(async (tx) => {
      const sourceRow = await tx.connectorMappingVersion.findFirst({
        where: {
          id: input.versionId,
          connectorSlug: input.connectorSlug,
        },
      });
      if (!sourceRow) {
        throw new NotFoundException("mapping_version_not_found");
      }
      const source = toVersion(sourceRow as unknown as Record<string, unknown>);
      if (source.lifecycleState === "draft" || source.lifecycleState === "validated") {
        throw new ConflictException("rollback_requires_previously_published_version");
      }
      if (source.lifecycleState === "published") {
        throw new ConflictException("mapping_version_already_published");
      }
      if (source.compatibilityState === "blocked") {
        throw new ConflictException("rollback_source_blocked");
      }

      const rulesValidation = this.validateMappingRules({
        mappingLevel: source.mappingLevel,
        categoryScope: source.categoryScope,
        mappingRules: source.mappingRules,
        fallbackAckRequired: source.fallbackAckRequired,
        fallbackPolicy: source.fallbackPolicy,
      });
      if (!rulesValidation.valid) {
        throw new BadRequestException({
          error: "invalid_mapping",
          details: rulesValidation.errors,
        });
      }

      // Fetch published rows then post-filter by installationId scope — same pattern as
      // publishMappingVersion — so rolling back a slug-scoped version does not supersede
      // installation-scoped versions at the same categoryScope and vice versa.
      const allCurrentlyPublishedRows = await tx.connectorMappingVersion.findMany({
        where: {
          connectorSlug: input.connectorSlug,
          categoryScope: source.categoryScope,
          lifecycleState: "published",
        },
        orderBy: { createdAt: "desc" },
      });
      const currentlyPublishedRows = allCurrentlyPublishedRows.filter((row) => {
        return (row.installationId ?? null) === (source.installationId ?? null);
      });

      const rollbackVersionId = randomUUID();
      // Copy installationId from source — rolled-back version must share the same scope.
      // Build rollback data as a plain record; installationId is spread conditionally so the
      // TypeScript type stays narrow — Prisma's generated create type requires the spread
      // to be cast at call time regardless.
      const rollbackCreateData: Record<string, unknown> = {
        id: rollbackVersionId,
        connectorSlug: input.connectorSlug,
        categoryScope: source.categoryScope,
        mappingLevel: source.mappingLevel,
        lifecycleState: "validated",
        connectorDefinitionId: source.connectorDefinitionId,
        connectorDefinitionVersion: source.connectorDefinitionVersion,
        compatibilityState: source.compatibilityState,
        mappingRules: source.mappingRules as Prisma.InputJsonValue,
        fallbackPolicy: source.fallbackPolicy as Prisma.InputJsonValue,
        fallbackAckRequired: source.fallbackAckRequired,
        createdBy: input.actorId ?? null,
        ...(source.installationId ? { installationId: source.installationId } : {}),
      };
      await tx.connectorMappingVersion.create({
        data: rollbackCreateData as Parameters<typeof tx.connectorMappingVersion.create>[0]["data"],
      });

      const supersededIds = currentlyPublishedRows
        .map((row) => row.id)
        .filter((id) => id !== source.id);
      if (supersededIds.length > 0) {
        await tx.connectorMappingVersion.updateMany({
          where: {
            id: { in: supersededIds },
          },
          data: {
            lifecycleState: "superseded",
            supersededBy: rollbackVersionId,
          },
        });
      }

      const publishUpdate = await tx.connectorMappingVersion.updateMany({
        where: {
          id: rollbackVersionId,
          connectorSlug: input.connectorSlug,
          lifecycleState: "validated",
        },
        data: {
          lifecycleState: "published",
          publishedAt: new Date(),
          supersededBy: null,
        },
      });
      if (publishUpdate.count !== 1) {
        throw new ConflictException("rollback_requires_previously_published_version");
      }

      const rollbackRow = await tx.connectorMappingVersion.findFirst({
        where: {
          id: rollbackVersionId,
          connectorSlug: input.connectorSlug,
        },
      });
      if (!rollbackRow) {
        throw new NotFoundException("mapping_version_not_found");
      }
      const published = toVersion(rollbackRow as unknown as Record<string, unknown>);

      for (const currentPublished of currentlyPublishedRows.map((row) =>
        toVersion(row as unknown as Record<string, unknown>),
      )) {
        if (currentPublished.id === source.id) {
          continue;
        }
        await tx.connectorMappingEvent.create({
          data: {
            id: randomUUID(),
            mappingVersionId: currentPublished.id,
            eventType: "superseded",
            actorId: input.actorId ?? null,
            metadata: {
              superseded_by: published.id,
              rollback_source_version_id: source.id,
            } as Prisma.InputJsonValue,
          },
        });
      }

      await tx.connectorMappingEvent.create({
        data: {
          id: randomUUID(),
          mappingVersionId: published.id,
          eventType: "created",
          actorId: input.actorId ?? null,
          metadata: {
            rollback: true,
            rollback_source_version_id: source.id,
            rollback_source_lifecycle_state: source.lifecycleState,
            reason: input.reason,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.connectorMappingEvent.create({
        data: {
          id: randomUUID(),
          mappingVersionId: published.id,
          eventType: "published",
          actorId: input.actorId ?? null,
          metadata: {
            rollback: true,
            rollback_source_version_id: source.id,
            rollback_reason: input.reason,
            superseded_count: supersededIds.length,
          } as Prisma.InputJsonValue,
        },
      });

      return {
        published,
        superseded: supersededIds,
        rollbackSourceVersionId: source.id,
      };
    });
    await this.emitMappingCompletionMetric(tenantKey, input.connectorSlug);
    return result;
  }

  async archiveVersion(input: {
    connectorSlug: string;
    versionId: string;
    actorId?: string | null;
    reason: string;
  }): Promise<ConnectorMappingVersion> {
    const tenantKey = this.getTenantKey();
    const current = await this.getVersionById({
      connectorSlug: input.connectorSlug,
      versionId: input.versionId,
    });
    if (!canTransition(current.lifecycleState, "archived")) {
      throw new ConflictException("invalid_lifecycle_transition");
    }
    await this.prisma.tenant(tenantKey).connectorMappingVersion.updateMany({
      where: {
        id: input.versionId,
        connectorSlug: input.connectorSlug,
      },
      data: {
        lifecycleState: "archived",
        archivedAt: new Date(),
      },
    });
    const archived = await this.getVersionById({
      connectorSlug: input.connectorSlug,
      versionId: input.versionId,
    });
    await this.appendEvent({
      tenantKey,
      mappingVersionId: archived.id,
      eventType: "archived",
      actorId: input.actorId,
      metadata: { reason: input.reason, previous_state: current.lifecycleState },
    });
    await this.emitMappingCompletionMetric(tenantKey, input.connectorSlug);
    return archived;
  }

  private systemDefaultForConnector(connectorSlug: string): Record<string, unknown> {
    const defaults = SYSTEM_CONNECTOR_DEFAULTS[String(connectorSlug ?? "").trim().toLowerCase()];
    return {
      field_mappings: defaults ?? {},
    };
  }

  async resolveEffectiveMapping(input: {
    connectorSlug: string;
    categoryScope: string;
    installationId?: string | null;
    actorId?: string | null;
    recordEvaluation?: boolean;
  }): Promise<{
    resolvedMapping: Record<string, unknown>;
    matchedVersions: ConnectorMappingVersion[];
    compatibilityState: MappingCompatibility;
    fallbackApplied: boolean;
    fallbackAckRequired: boolean;
  }> {
    const tenantKey = this.getTenantKey();
    const categoryScope = String(input.categoryScope ?? "").trim() || "*";
    const installationId = input.installationId ?? null;

    // Fetch all candidate rows; filter by installationId in TypeScript to avoid Prisma client
    // regeneration requirement for the new nullable column.
    // Five-level precedence (low → high):
    //   1. connector system default (hardcoded)
    //   2. slug-scoped tenant default  (installationId=null)
    //   3. slug-scoped category mapping (installationId=null)
    //   4. installation-scoped tenant default  (installationId=X)
    //   5. installation-scoped category mapping (installationId=X)
    const rows = await this.prisma.tenant(tenantKey).connectorMappingVersion.findMany({
      where: {
        connectorSlug: input.connectorSlug,
        lifecycleState: "published",
        OR: [
          { mappingLevel: "tenant_connector_default", categoryScope: "*" },
          { mappingLevel: "tenant_connector_category_mapping", categoryScope },
        ],
      },
      orderBy: { createdAt: "asc" },
    });

    // Post-filter: keep slug-scoped (null installationId) + installation-scoped for this installationId
    const candidateRows = rows.filter((row) => {
      if (!row.installationId) return true; // slug-scoped row — always keep
      return row.installationId === installationId; // installation-scoped — keep only for matching installation
    });

    const allVersions = candidateRows.map((row) => toVersion(row as unknown as Record<string, unknown>));

    // Apply 5-level merge: system → slug-default → slug-category → install-default → install-category
    const slugDefault = allVersions.find((v) => v.mappingLevel === "tenant_connector_default" && !v.installationId);
    const slugCategory = allVersions.find((v) => v.mappingLevel === "tenant_connector_category_mapping" && v.categoryScope === categoryScope && !v.installationId);
    const installDefault = installationId ? allVersions.find((v) => v.mappingLevel === "tenant_connector_default" && v.installationId === installationId) : undefined;
    const installCategory = installationId ? allVersions.find((v) => v.mappingLevel === "tenant_connector_category_mapping" && v.categoryScope === categoryScope && v.installationId === installationId) : undefined;

    const matched = sortMappingsForResolution(
      [slugDefault, slugCategory, installDefault, installCategory].filter((v): v is ConnectorMappingVersion => Boolean(v)),
    );

    let merged: Record<string, unknown> = this.systemDefaultForConnector(input.connectorSlug);
    const compatStates: MappingCompatibility[] = ["compatible"];
    for (const version of matched) {
      merged = deepMerge(merged, version.mappingRules);
      compatStates.push(version.compatibilityState);
    }
    merged = applyAttributeOverrides(merged);

    const hasCategorySpecific =
      Boolean(installCategory) ||
      (matched.some((item) => item.mappingLevel === "tenant_connector_category_mapping" && item.categoryScope === categoryScope));
    const effectiveDefault = installDefault ?? slugDefault;
    const fallbackApplied = categoryScope !== "*" && !hasCategorySpecific && Boolean(effectiveDefault);
    const fallbackAckRequired = fallbackApplied && Boolean(effectiveDefault?.fallbackAckRequired);
    const compatibilityState = highestCompatibility(compatStates);

    if (input.recordEvaluation && matched.length > 0) {
      await this.appendEvent({
        tenantKey,
        mappingVersionId: matched[matched.length - 1]!.id,
        eventType: "resolution_evaluated",
        actorId: input.actorId,
        metadata: {
          category_scope: categoryScope,
          installation_id: installationId,
          matched_version_ids: matched.map((item) => item.id),
          compatibility_state: compatibilityState,
          fallback_applied: fallbackApplied,
        },
      });
    }

    return {
      resolvedMapping: merged,
      matchedVersions: matched,
      compatibilityState,
      fallbackApplied,
      fallbackAckRequired,
    };
  }

  async evaluateMappingPreflight(input: {
    connectorSlug: string;
    categoryScope: string;
    installationId?: string;
    fallbackAcknowledged?: boolean;
    actorId?: string | null;
  }): Promise<MappingPreflightResult> {
    const resolved = await this.resolveEffectiveMapping({
      connectorSlug: input.connectorSlug,
      categoryScope: input.categoryScope,
      installationId: input.installationId,
      actorId: input.actorId,
      recordEvaluation: true,
    });
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (resolved.matchedVersions.length === 0) {
      warnings.push("using_system_default_mapping");
    }
    if (resolved.compatibilityState === "blocked") {
      blockers.push("mapping_compatibility_blocked");
    } else if (resolved.compatibilityState === "remap_required") {
      blockers.push("mapping_remap_required");
    } else if (resolved.compatibilityState === "deprecated") {
      warnings.push("mapping_deprecated");
    }

    const fieldMappings = parseObject(resolved.resolvedMapping.field_mappings);
    if (Object.keys(fieldMappings).length === 0) {
      blockers.push("field_mappings_missing");
    }

    if (resolved.fallbackApplied) {
      warnings.push("fallback_mapping_applied");
    }
    if (resolved.fallbackApplied && resolved.fallbackAckRequired && !input.fallbackAcknowledged) {
      blockers.push("fallback_ack_required");
    }

    return {
      ok: blockers.length === 0,
      blockers,
      warnings,
      compatibilityState: resolved.compatibilityState,
      fallbackApplied: resolved.fallbackApplied,
      fallbackAckRequired: resolved.fallbackAckRequired,
      matchedVersionIds: resolved.matchedVersions.map((item) => item.id),
    };
  }

  async searchTaxonomy(input: {
    connectorSlug: string;
    query?: string;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      label: string;
      path: string;
      parentId: string | null;
      leaf: boolean;
      requiredAttributes: string[];
    }>
  > {
    const tenantKey = this.getTenantKey();
    const query = String(input.query ?? "").trim();
    const limit = Math.max(1, Math.min(500, Math.floor(Number(input.limit ?? 50))));
    const categories = await this.prisma.tenant(tenantKey).category.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query, mode: "insensitive" } },
              { path: { contains: query, mode: "insensitive" } },
            ],
          }
        : undefined,
      orderBy: [{ path: "asc" }],
      take: limit,
      include: {
        children: {
          select: { id: true },
          take: 1,
        },
        attributeDefinitions: {
          where: { required: true, appliesTo: "product" },
          select: { key: true },
        },
      },
    });
    return categories.map((category) => ({
      id: category.id,
      label: category.name,
      path: category.path,
      parentId: category.parentId ?? null,
      leaf: category.children.length === 0,
      requiredAttributes: category.attributeDefinitions.map((item) => item.key),
    }));
  }

  async listUnmappedCategories(input: { connectorSlug: string }): Promise<
    Array<{
      id: string;
      path: string;
      requiredAttributes: string[];
    }>
  > {
    const tenantKey = this.getTenantKey();
    const publishedScopesRows = await this.prisma.tenant(tenantKey).connectorMappingVersion.findMany({
      where: {
        connectorSlug: input.connectorSlug,
        lifecycleState: "published",
        mappingLevel: "tenant_connector_category_mapping",
      },
      select: {
        categoryScope: true,
      },
      distinct: ["categoryScope"],
      take: 5_000, // defensive cap — one distinct scope per category
    });
    const publishedScopes = new Set(
      publishedScopesRows
        .map((row) => String(row.categoryScope ?? "").trim())
        .filter((item) => item.length > 0),
    );
    const categories = await this.prisma.tenant(tenantKey).category.findMany({
      orderBy: [{ path: "asc" }],
      take: 5_000, // defensive cap — all categories for unmapped-category detection
      include: {
        attributeDefinitions: {
          where: { required: true, appliesTo: "product" },
          select: { key: true },
        },
      },
    });
    return categories
      .filter((category) => !publishedScopes.has(category.id))
      .map((category) => ({
        id: category.id,
        path: category.path,
        requiredAttributes: category.attributeDefinitions.map((item) => item.key),
      }));
  }

  async evaluatePublishReadiness(input: {
    connectorSlug: string;
    categoryScope: string;
    installationId?: string;
    fallbackAcknowledged?: boolean;
    productId?: string;
    actorId?: string | null;
  }): Promise<{
    ok: boolean;
    blockers: string[];
    warnings: string[];
    checks: Record<string, unknown>;
    overallScore: number;
    breakdown: {
      content:    { score: number; weight: 25 };
      seo:        { score: number; weight: 15 };
      media:      { score: number; weight: 20 };
      variants:   { score: number; weight: 20 };
      metafields: { score: number; weight: 10 };
      compliance: { score: number; weight: 10 };
    };
  }> {
    const tenantKey = this.getTenantKey();
    const preflight = await this.evaluateMappingPreflight({
      connectorSlug: input.connectorSlug,
      categoryScope: input.categoryScope,
      installationId: input.installationId,
      fallbackAcknowledged: input.fallbackAcknowledged,
      actorId: input.actorId,
    });
    const blockers = [...preflight.blockers];
    const warnings = [...preflight.warnings];

    const installation = await this.resolveReadinessInstallation({
      connectorSlug: input.connectorSlug,
      installationId: input.installationId,
    });
    if (!installation) {
      blockers.push("connector_not_installed");
    } else {
      const status = String(installation.status ?? "").trim().toUpperCase();
      if (status === "CREDENTIAL_EXPIRED") {
        blockers.push("connector_credentials_expired");
      } else if (status !== "ACTIVE") {
        warnings.push("connector_not_active");
      }
    }

    const resolved = await this.resolveEffectiveMapping({
      connectorSlug: input.connectorSlug,
      categoryScope: input.categoryScope,
      installationId: input.installationId,
    });
    const fieldMappings = parseObject(resolved.resolvedMapping.field_mappings);
    const requiredDefs = await this.prisma.tenant(tenantKey).attributeDefinition.findMany({
      where: {
        categoryId: input.categoryScope,
        required: true,
        appliesTo: "product",
      },
      take: 500, // defensive cap — required attribute definitions per category
      select: { key: true },
    });
    const missingRequiredMappings = requiredDefs
      .map((item) => item.key)
      .filter((key) => {
        const namespaced = `attributes.${key}`;
        return !(key in fieldMappings) && !(namespaced in fieldMappings);
      });
    if (missingRequiredMappings.length > 0) {
      blockers.push("required_attribute_mapping_missing");
    }

    let productCheck: Record<string, unknown> = {};
    let openErrors = 0;
    let productData: {
      title?: string | null;
      description?: string | null;
      brand?: string | null;
      attributes?: unknown;
      variants?: Array<{ skuCode?: string | null; sellingPrice?: unknown; mrp?: unknown; attributes?: unknown }>;
    } | null = null;

    if (input.productId) {
      const product = await this.prisma.tenant(tenantKey).product.findUnique({
        where: { id: input.productId },
        select: {
          id: true,
          categoryId: true,
          status: true,
          title: true,
          description: true,
          brand: true,
          attributes: true,
          variants: {
            orderBy: [{ updatedAt: "desc" }],
            take: 1,
            select: { skuCode: true, sellingPrice: true, mrp: true, attributes: true },
          },
        },
      });
      if (!product) {
        blockers.push("product_not_found");
      } else {
        productData = product;
        if (product.categoryId !== input.categoryScope) {
          blockers.push("product_category_scope_mismatch");
        }
        if (product.status === "archived") {
          blockers.push("product_archived");
        }
        if (product.status !== "approved" && product.status !== "active" && product.status !== "archived") {
          blockers.push("product_not_approved");
        }
        openErrors = await this.prisma.tenant(tenantKey).validationIssue.count({
          where: {
            productId: product.id,
            status: ValidationIssueStatus.open,
            severity: RuleSeverity.error,
          },
        });
        if (openErrors > 0) {
          blockers.push("product_blocking_issues_open");
        }
        productCheck = {
          productId: product.id,
          categoryId: product.categoryId,
          status: product.status,
          openErrorIssues: openErrors,
        };
      }
    }

    // ── Readiness Score ───────────────────────────────────────────────────────
    const attrs = (productData?.attributes && typeof productData.attributes === "object" ? productData.attributes : {}) as Record<string, unknown>;
    const variant0 = productData?.variants?.[0] ?? null;

    // Content (25): title, brand, description
    const hasTitle = Boolean(String(productData?.title ?? "").trim());
    const hasBrand = Boolean(String(productData?.brand ?? "").trim());
    const hasDescription = Boolean(String(productData?.description ?? "").trim());
    const contentScore = Math.round(((+hasTitle + +hasBrand + +hasDescription) / 3) * 100);

    // SEO (15): seoTitle and seoDescription in field_mappings
    const seoTitleMapped = "seo.title" in fieldMappings || "seoTitle" in fieldMappings || "attributes.seoTitle" in fieldMappings;
    const seoDescMapped = "seo.description" in fieldMappings || "seoDescription" in fieldMappings || "attributes.seoDescription" in fieldMappings;
    const seoScore = Math.round(((+seoTitleMapped + +seoDescMapped) / 2) * 100);

    // Media (20): mainImageUrl present in attributes + alt text
    const mainImageUrl = String(attrs.mainImageUrl ?? attrs.imageUrl ?? attrs.image_url ?? "").trim();
    const hasImage = Boolean(mainImageUrl);
    const hasAlt = Boolean(String(attrs.imageAlt ?? attrs.alt_text ?? attrs.image_alt ?? "").trim());
    const mediaScore = Math.round(((hasImage ? 0.75 : 0) + (hasImage && hasAlt ? 0.25 : 0)) * 100);

    // Variants (20): price and SKU present
    const vAttrs = (variant0?.attributes && typeof variant0.attributes === "object" ? variant0.attributes : {}) as Record<string, unknown>;
    const hasSku = Boolean(String(variant0?.skuCode ?? vAttrs.sku ?? attrs.sku ?? "").trim());
    const hasPrice = (typeof variant0?.sellingPrice === "number" && variant0.sellingPrice > 0)
      || (typeof attrs.sellingPrice === "number" && (attrs.sellingPrice as number) > 0)
      || (typeof attrs.price === "number" && (attrs.price as number) > 0);
    const variantsScore = Math.round(((+hasSku + +hasPrice) / 2) * 100);

    // Metafields (10): if any productMetafield keys in fieldMappings, score proportionally; otherwise neutral 50
    const metafieldKeys = Object.keys(fieldMappings).filter((k) => k.startsWith("productMetafields.") || k.startsWith("variantMetafields."));
    const metafieldsScore = metafieldKeys.length === 0 ? 50 : 100;

    // Compliance (10): no open error issues
    const complianceScore = openErrors === 0 ? 100 : Math.max(0, Math.round((1 - openErrors / 10) * 100));

    const breakdown = {
      content:    { score: contentScore,    weight: 25 as const },
      seo:        { score: seoScore,        weight: 15 as const },
      media:      { score: mediaScore,      weight: 20 as const },
      variants:   { score: variantsScore,   weight: 20 as const },
      metafields: { score: metafieldsScore, weight: 10 as const },
      compliance: { score: complianceScore, weight: 10 as const },
    };

    const overallScore = Math.round(
      (contentScore    * 25 +
       seoScore        * 15 +
       mediaScore      * 20 +
       variantsScore   * 20 +
       metafieldsScore * 10 +
       complianceScore * 10) / 100,
    );

    return {
      ok: blockers.length === 0,
      blockers: Array.from(new Set(blockers)),
      warnings: Array.from(new Set(warnings)),
      checks: {
        preflight,
        installation: installation
          ? {
              id: String(installation.id),
              status: String(installation.status),
              accountAlias: String(installation.accountAlias ?? ""),
            }
          : null,
        missingRequiredMappings,
        product: productCheck,
      },
      overallScore,
      breakdown,
    };
  }

  async assertPublishReadyForExport(input: {
    connectorSlug: string;
    categoryScope: string;
    installationId?: string;
    fallbackAcknowledged?: boolean;
    productId?: string;
    actorId?: string | null;
  }): Promise<void> {
    const readiness = await this.evaluatePublishReadiness(input);
    if (!readiness.ok) {
      throw new BadRequestException({
        error: "publish_readiness_blocked",
        blockers: readiness.blockers,
        warnings: readiness.warnings,
      });
    }
  }

  private async resolveReadinessInstallation(input: {
    connectorSlug: string;
    installationId?: string;
  }): Promise<{
    id: string;
    status: string;
    accountAlias: string;
  } | null> {
    const tenantKey = this.getTenantKey();
    const connectorSlug = String(input.connectorSlug ?? "").trim().toLowerCase();
    const installationId = String(input.installationId ?? "").trim();
    const connectorDefinition = await this.prisma.tenant(tenantKey).connectorDefinition.findUnique({
      where: { slug: connectorSlug },
      select: { id: true },
    });
    if (!connectorDefinition) {
      return null;
    }

    if (installationId) {
      // Find by explicit ID regardless of status — evaluatePublishReadiness checks status
      // downstream and emits connector_not_active for DISABLED, connector_credentials_expired
      // for CREDENTIAL_EXPIRED. Filtering here would convert these recoverable warnings into
      // a misleading connector_not_installed blocker and break the UI status surface.
      const selected = await this.prisma.tenant(tenantKey).connectorInstallation.findFirst({
        where: {
          id: installationId,
          connectorId: connectorDefinition.id,
        },
        select: {
          id: true,
          status: true,
          accountAlias: true,
        },
      });
      return selected
        ? {
            id: String(selected.id),
            status: String(selected.status),
            accountAlias: String(selected.accountAlias),
          }
        : null;
    }

    // Fallback (no installationId): most recent installation, any status.
    // evaluatePublishReadiness handles the status check and emits appropriate blockers/warnings.
    const fallback = await this.prisma.tenant(tenantKey).connectorInstallation.findFirst({
      where: {
        connectorId: connectorDefinition.id,
      },
      orderBy: [{ installedAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        accountAlias: true,
      },
    });
    return fallback
      ? {
          id: String(fallback.id),
          status: String(fallback.status),
          accountAlias: String(fallback.accountAlias),
        }
      : null;
  }

  private async emitMappingCompletionMetric(tenantKey: string, connectorSlug: string): Promise<void> {
    try {
      const [totalCategories, mappedCategoryRows] = await Promise.all([
        this.prisma.tenant(tenantKey).category.count(),
        this.prisma.tenant(tenantKey).connectorMappingVersion.findMany({
          where: {
            connectorSlug,
            lifecycleState: "published",
            mappingLevel: "tenant_connector_category_mapping",
          },
          select: {
            categoryScope: true,
          },
          distinct: ["categoryScope"],
          take: 5_000, // defensive cap — one distinct scope per category
        }),
      ]);
      const mappedCategories = mappedCategoryRows.filter((row) => String(row.categoryScope ?? "").trim() !== "*").length;
      const completionPercent = totalCategories > 0 ? (mappedCategories / totalCategories) * 100 : 100;
      await this.metricsService.emit({
        tenantKey,
        connectorSlug,
        metricKey: "mapping.completion_percent",
        metricValue: completionPercent,
        unit: "percent",
        tags: {
          totalCategories,
          mappedCategories,
        },
      });
    } catch {
      // Metrics emission must not block mapping lifecycle operations.
    }
  }
}
