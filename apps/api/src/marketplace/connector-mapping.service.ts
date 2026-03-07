import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { RuleSeverity, ValidationIssueStatus } from "@prisma/client";
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

export interface ConnectorMappingVersion {
  id: string;
  tenantKey: string;
  connectorSlug: string;
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

function toVersion(row: Record<string, unknown>): ConnectorMappingVersion {
  return {
    id: String(row.id),
    tenantKey: String(row.tenant_key),
    connectorSlug: String(row.connector_slug),
    categoryScope: String(row.category_scope),
    mappingLevel: String(row.mapping_level) as MappingLevel,
    lifecycleState: String(row.lifecycle_state) as MappingLifecycle,
    connectorDefinitionId: String(row.connector_definition_id),
    connectorDefinitionVersion: String(row.connector_definition_version),
    compatibilityState: String(row.compatibility_state) as MappingCompatibility,
    mappingRules: parseObject(row.mapping_rules),
    fallbackPolicy: parseObject(row.fallback_policy),
    fallbackAckRequired: Boolean(row.fallback_ack_required),
    publishedAt: normalizeIso(row.published_at),
    supersededBy: row.superseded_by ? String(row.superseded_by) : null,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    archivedAt: normalizeIso(row.archived_at),
  };
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
    await this.prisma.tenant(input.tenantKey).$executeRawUnsafe(
      `
      INSERT INTO connector_mapping_events (
        id, tenant_key, mapping_version_id, event_type, actor_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      randomUUID(),
      input.tenantKey,
      input.mappingVersionId,
      input.eventType,
      input.actorId ?? null,
      JSON.stringify(input.metadata ?? {}),
    );
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

    return { valid: errors.length === 0, errors };
  }

  async listVersions(input: {
    connectorSlug: string;
    categoryScope?: string;
    includeArchived?: boolean;
  }): Promise<ConnectorMappingVersion[]> {
    const tenantKey = this.getTenantKey();
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT *
      FROM connector_mapping_versions
      WHERE tenant_key = $1
        AND connector_slug = $2
        AND ($3::text IS NULL OR category_scope = $3::text)
        AND ($4::boolean = TRUE OR lifecycle_state <> 'archived')
      ORDER BY created_at DESC
      `,
      tenantKey,
      input.connectorSlug,
      input.categoryScope ?? null,
      Boolean(input.includeArchived),
    );
    return rows.map(toVersion);
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

    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      INSERT INTO connector_mapping_versions (
        id,
        tenant_key,
        connector_slug,
        category_scope,
        mapping_level,
        lifecycle_state,
        connector_definition_id,
        connector_definition_version,
        compatibility_state,
        mapping_rules,
        fallback_policy,
        fallback_ack_required,
        created_by
      ) VALUES (
        $1, $2, $3, $4, $5, 'draft', $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12
      )
      RETURNING *
      `,
      randomUUID(),
      tenantKey,
      input.connectorSlug,
      input.categoryScope,
      input.mappingLevel,
      input.connectorDefinitionId,
      input.connectorDefinitionVersion,
      input.compatibilityState ?? "compatible",
      JSON.stringify(input.mappingRules ?? {}),
      JSON.stringify(input.fallbackPolicy ?? {}),
      Boolean(input.fallbackAckRequired),
      input.actorId ?? null,
    );
    const version = toVersion(rows[0]!);
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
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT *
      FROM connector_mapping_versions
      WHERE tenant_key = $1
        AND connector_slug = $2
        AND id = $3
      LIMIT 1
      `,
      tenantKey,
      input.connectorSlug,
      input.versionId,
    );
    if (!rows[0]) {
      throw new NotFoundException("mapping_version_not_found");
    }
    return toVersion(rows[0]);
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

    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      UPDATE connector_mapping_versions
      SET lifecycle_state = 'validated',
          updated_at = NOW()
      WHERE tenant_key = $1
        AND connector_slug = $2
        AND id = $3
      RETURNING *
      `,
      tenantKey,
      input.connectorSlug,
      input.versionId,
    );
    const version = toVersion(rows[0]!);
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
    actorId?: string | null;
  }): Promise<{ published: ConnectorMappingVersion; superseded: string[] }> {
    if (!input.confirm) {
      throw new BadRequestException("publish_confirmation_required");
    }
    const tenantKey = this.getTenantKey();
    const result = await this.prisma.tenant(tenantKey).$transaction(async (tx) => {
      const selectedRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `
        SELECT *
        FROM connector_mapping_versions
        WHERE tenant_key = $1
          AND connector_slug = $2
          AND id = $3
        FOR UPDATE
        `,
        tenantKey,
        input.connectorSlug,
        input.versionId,
      );
      if (!selectedRows[0]) {
        throw new NotFoundException("mapping_version_not_found");
      }
      const selected = toVersion(selectedRows[0]);
      if (selected.lifecycleState !== "validated") {
        throw new ConflictException("must_validate_before_publish");
      }

      const supersededRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `
        UPDATE connector_mapping_versions
        SET lifecycle_state = 'superseded',
            superseded_by = $1,
            updated_at = NOW()
        WHERE tenant_key = $2
          AND connector_slug = $3
          AND category_scope = $4
          AND lifecycle_state = 'published'
          AND id <> $1
        RETURNING id::text AS id
        `,
        selected.id,
        tenantKey,
        input.connectorSlug,
        selected.categoryScope,
      );

      const publishedRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `
        UPDATE connector_mapping_versions
        SET lifecycle_state = 'published',
            published_at = NOW(),
            updated_at = NOW()
        WHERE tenant_key = $1
          AND connector_slug = $2
          AND id = $3
        RETURNING *
        `,
        tenantKey,
        input.connectorSlug,
        selected.id,
      );

      const published = toVersion(publishedRows[0]!);
      const supersededIds = supersededRows.map((row) => String(row.id));
      for (const supersededId of supersededIds) {
        await tx.$executeRawUnsafe(
          `
          INSERT INTO connector_mapping_events (
            id, tenant_key, mapping_version_id, event_type, actor_id, metadata
          ) VALUES ($1, $2, $3, 'superseded', $4, $5::jsonb)
          `,
          randomUUID(),
          tenantKey,
          supersededId,
          input.actorId ?? null,
          JSON.stringify({ superseded_by: published.id }),
        );
      }
      await tx.$executeRawUnsafe(
        `
        INSERT INTO connector_mapping_events (
          id, tenant_key, mapping_version_id, event_type, actor_id, metadata
        ) VALUES ($1, $2, $3, 'published', $4, $5::jsonb)
        `,
        randomUUID(),
        tenantKey,
        published.id,
        input.actorId ?? null,
        JSON.stringify({ superseded_count: supersededIds.length }),
      );
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
      const sourceRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `
        SELECT *
        FROM connector_mapping_versions
        WHERE tenant_key = $1
          AND connector_slug = $2
          AND id = $3
        FOR UPDATE
        `,
        tenantKey,
        input.connectorSlug,
        input.versionId,
      );
      if (!sourceRows[0]) {
        throw new NotFoundException("mapping_version_not_found");
      }
      const source = toVersion(sourceRows[0]);
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

      const currentlyPublishedRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `
        SELECT *
        FROM connector_mapping_versions
        WHERE tenant_key = $1
          AND connector_slug = $2
          AND category_scope = $3
          AND lifecycle_state = 'published'
        FOR UPDATE
        `,
        tenantKey,
        input.connectorSlug,
        source.categoryScope,
      );

      const rollbackVersionId = randomUUID();
      await tx.$queryRawUnsafe(
        `
        INSERT INTO connector_mapping_versions (
          id,
          tenant_key,
          connector_slug,
          category_scope,
          mapping_level,
          lifecycle_state,
          connector_definition_id,
          connector_definition_version,
          compatibility_state,
          mapping_rules,
          fallback_policy,
          fallback_ack_required,
          created_by
        ) VALUES (
          $1, $2, $3, $4, $5, 'validated', $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12
        )
        `,
        rollbackVersionId,
        tenantKey,
        input.connectorSlug,
        source.categoryScope,
        source.mappingLevel,
        source.connectorDefinitionId,
        source.connectorDefinitionVersion,
        source.compatibilityState,
        JSON.stringify(source.mappingRules),
        JSON.stringify(source.fallbackPolicy),
        source.fallbackAckRequired,
        input.actorId ?? null,
      );

      const supersededRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `
        UPDATE connector_mapping_versions
        SET lifecycle_state = 'superseded',
            superseded_by = $1,
            updated_at = NOW()
        WHERE tenant_key = $2
          AND connector_slug = $3
          AND category_scope = $4
          AND lifecycle_state = 'published'
          AND id <> $5
        RETURNING id::text AS id
        `,
        rollbackVersionId,
        tenantKey,
        input.connectorSlug,
        source.categoryScope,
        source.id,
      );

      const rollbackRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `
        UPDATE connector_mapping_versions
        SET lifecycle_state = 'published',
            published_at = NOW(),
            updated_at = NOW()
        WHERE tenant_key = $1
          AND connector_slug = $2
          AND id = $3
        RETURNING *
        `,
        tenantKey,
        input.connectorSlug,
        rollbackVersionId,
      );
      const published = toVersion(rollbackRows[0]!);
      const supersededIds = supersededRows.map((row) => String(row.id));

      for (const currentPublished of currentlyPublishedRows.map(toVersion)) {
        if (currentPublished.id === source.id) {
          continue;
        }
        await tx.$executeRawUnsafe(
          `
          INSERT INTO connector_mapping_events (
            id, tenant_key, mapping_version_id, event_type, actor_id, metadata
          ) VALUES ($1, $2, $3, 'superseded', $4, $5::jsonb)
          `,
          randomUUID(),
          tenantKey,
          currentPublished.id,
          input.actorId ?? null,
          JSON.stringify({
            superseded_by: published.id,
            rollback_source_version_id: source.id,
          }),
        );
      }

      await tx.$executeRawUnsafe(
        `
        INSERT INTO connector_mapping_events (
          id, tenant_key, mapping_version_id, event_type, actor_id, metadata
        ) VALUES ($1, $2, $3, 'created', $4, $5::jsonb)
        `,
        randomUUID(),
        tenantKey,
        published.id,
        input.actorId ?? null,
        JSON.stringify({
          rollback: true,
          rollback_source_version_id: source.id,
          rollback_source_lifecycle_state: source.lifecycleState,
          reason: input.reason,
        }),
      );
      await tx.$executeRawUnsafe(
        `
        INSERT INTO connector_mapping_events (
          id, tenant_key, mapping_version_id, event_type, actor_id, metadata
        ) VALUES ($1, $2, $3, 'published', $4, $5::jsonb)
        `,
        randomUUID(),
        tenantKey,
        published.id,
        input.actorId ?? null,
        JSON.stringify({
          rollback: true,
          rollback_source_version_id: source.id,
          rollback_reason: input.reason,
          superseded_count: supersededIds.length,
        }),
      );

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
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      UPDATE connector_mapping_versions
      SET lifecycle_state = 'archived',
          archived_at = NOW(),
          updated_at = NOW()
      WHERE tenant_key = $1
        AND connector_slug = $2
        AND id = $3
      RETURNING *
      `,
      tenantKey,
      input.connectorSlug,
      input.versionId,
    );
    const archived = toVersion(rows[0]!);
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
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT *
      FROM connector_mapping_versions
      WHERE tenant_key = $1
        AND connector_slug = $2
        AND lifecycle_state = 'published'
        AND (
          (mapping_level = 'tenant_connector_default' AND category_scope = '*')
          OR (mapping_level = 'tenant_connector_category_mapping' AND category_scope = $3)
        )
      ORDER BY CASE mapping_level
        WHEN 'tenant_connector_default' THEN 1
        ELSE 2
      END ASC, created_at ASC
      `,
      tenantKey,
      input.connectorSlug,
      categoryScope,
    );

    const matched = rows.map(toVersion);
    let merged: Record<string, unknown> = this.systemDefaultForConnector(input.connectorSlug);
    const compatStates: MappingCompatibility[] = ["compatible"];
    for (const version of matched) {
      merged = deepMerge(merged, version.mappingRules);
      compatStates.push(version.compatibilityState);
    }
    merged = applyAttributeOverrides(merged);

    const hasCategorySpecific = matched.some(
      (item) => item.mappingLevel === "tenant_connector_category_mapping" && item.categoryScope === categoryScope,
    );
    const tenantDefault = matched.find((item) => item.mappingLevel === "tenant_connector_default");
    const fallbackApplied = categoryScope !== "*" && !hasCategorySpecific && Boolean(tenantDefault);
    const fallbackAckRequired = fallbackApplied && Boolean(tenantDefault?.fallbackAckRequired);
    const compatibilityState = highestCompatibility(compatStates);

    if (input.recordEvaluation && matched.length > 0) {
      await this.appendEvent({
        tenantKey,
        mappingVersionId: matched[matched.length - 1]!.id,
        eventType: "resolution_evaluated",
        actorId: input.actorId,
        metadata: {
          category_scope: categoryScope,
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
    fallbackAcknowledged?: boolean;
    actorId?: string | null;
  }): Promise<MappingPreflightResult> {
    const resolved = await this.resolveEffectiveMapping({
      connectorSlug: input.connectorSlug,
      categoryScope: input.categoryScope,
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
    const publishedScopesRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<{ category_scope: string }>>(
      `
      SELECT DISTINCT category_scope
      FROM connector_mapping_versions
      WHERE tenant_key = $1
        AND connector_slug = $2
        AND lifecycle_state = 'published'
        AND mapping_level = 'tenant_connector_category_mapping'
      `,
      tenantKey,
      input.connectorSlug,
    );
    const publishedScopes = new Set(
      publishedScopesRows
        .map((row) => String(row.category_scope ?? "").trim())
        .filter((item) => item.length > 0),
    );
    const categories = await this.prisma.tenant(tenantKey).category.findMany({
      orderBy: [{ path: "asc" }],
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
    fallbackAcknowledged?: boolean;
    productId?: string;
    actorId?: string | null;
  }): Promise<{
    ok: boolean;
    blockers: string[];
    warnings: string[];
    checks: Record<string, unknown>;
  }> {
    const tenantKey = this.getTenantKey();
    const preflight = await this.evaluateMappingPreflight({
      connectorSlug: input.connectorSlug,
      categoryScope: input.categoryScope,
      fallbackAcknowledged: input.fallbackAcknowledged,
      actorId: input.actorId,
    });
    const blockers = [...preflight.blockers];
    const warnings = [...preflight.warnings];

    const installationRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        ci.id,
        ci.status
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.tenant_key = $1
        AND cd.slug = $2
      ORDER BY ci.installed_at DESC
      LIMIT 1
      `,
      tenantKey,
      input.connectorSlug,
    );
    const installation = installationRows[0];
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
    });
    const fieldMappings = parseObject(resolved.resolvedMapping.field_mappings);
    const requiredDefs = await this.prisma.tenant(tenantKey).attributeDefinition.findMany({
      where: {
        categoryId: input.categoryScope,
        required: true,
        appliesTo: "product",
      },
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
    if (input.productId) {
      const product = await this.prisma.tenant(tenantKey).product.findUnique({
        where: { id: input.productId },
        select: { id: true, categoryId: true, status: true },
      });
      if (!product) {
        blockers.push("product_not_found");
      } else {
        if (product.categoryId !== input.categoryScope) {
          blockers.push("product_category_scope_mismatch");
        }
        if (product.status === "archived") {
          blockers.push("product_archived");
        }
        const openErrors = await this.prisma.tenant(tenantKey).validationIssue.count({
          where: {
            productId: product.id,
            status: ValidationIssueStatus.open,
            severity: RuleSeverity.error,
          },
        });
        if (openErrors > 0) {
          warnings.push("product_blocking_issues_open");
        }
        productCheck = {
          productId: product.id,
          categoryId: product.categoryId,
          status: product.status,
          openErrorIssues: openErrors,
        };
      }
    }

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
            }
          : null,
        missingRequiredMappings,
        product: productCheck,
      },
    };
  }

  async assertPublishReadyForExport(input: {
    connectorSlug: string;
    categoryScope: string;
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

  private async emitMappingCompletionMetric(tenantKey: string, connectorSlug: string): Promise<void> {
    try {
      const [totalCategories, mappedCategoryRows] = await Promise.all([
        this.prisma.tenant(tenantKey).category.count(),
        this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<{ category_scope: string }>>(
          `
          SELECT DISTINCT category_scope
          FROM connector_mapping_versions
          WHERE tenant_key = $1
            AND connector_slug = $2
            AND lifecycle_state = 'published'
            AND mapping_level = 'tenant_connector_category_mapping'
          `,
          tenantKey,
          connectorSlug,
        ),
      ]);
      const mappedCategories = mappedCategoryRows.filter((row) => String(row.category_scope ?? "").trim() !== "*").length;
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
