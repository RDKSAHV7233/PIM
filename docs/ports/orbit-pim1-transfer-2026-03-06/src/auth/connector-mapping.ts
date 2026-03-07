import { authDb } from "./db";

export type MappingLevel =
  | "connector_default_template"
  | "tenant_connector_default"
  | "tenant_connector_category_mapping";

export type MappingLifecycle = "draft" | "validated" | "published" | "superseded" | "archived";
export type MappingCompatibility = "compatible" | "deprecated" | "remap_required" | "blocked";
export type MappingEventType = "created" | "validated" | "published" | "superseded" | "archived" | "resolution_evaluated";

interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>;
}

export interface ConnectorMappingVersion {
  id: string;
  tenantId: string | null;
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

export interface MappingValidationResult {
  valid: boolean;
  errors: string[];
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

function parseObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeIso(value: unknown): string | null {
  if (!value) return null;
  return new Date(String(value)).toISOString();
}

function toVersion(row: Record<string, unknown>): ConnectorMappingVersion {
  return {
    id: String(row.id),
    tenantId: row.tenant_id ? String(row.tenant_id) : null,
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

function canTransition(from: MappingLifecycle, to: MappingLifecycle): boolean {
  return lifecycleTransitions[from]?.includes(to) ?? false;
}

function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = output[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
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
  if (Object.keys(overrides).length === 0) return mappingRules;
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
  let chosen: MappingCompatibility = "compatible";
  let weight = 1;
  for (const state of states) {
    const current = compatibilitySeverity(state);
    if (current > weight) {
      chosen = state;
      weight = current;
    }
  }
  return chosen;
}

async function appendMappingEvent(
  client: Queryable,
  input: {
    tenantId: string | null;
    mappingVersionId: string;
    eventType: MappingEventType;
    actorId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `
      INSERT INTO connector_mapping_events (
        tenant_id, mapping_version_id, event_type, actor_id, metadata
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [
      input.tenantId,
      input.mappingVersionId,
      input.eventType,
      input.actorId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );
}

export function validateMappingRules(input: {
  mappingLevel: MappingLevel;
  categoryScope: string;
  mappingRules: Record<string, unknown>;
  fallbackAckRequired?: boolean;
  fallbackPolicy?: Record<string, unknown>;
}): MappingValidationResult {
  const errors: string[] = [];
  const categoryScope = String(input.categoryScope || "").trim();
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
    if (!target) errors.push("target_category_required");
  }

  const fallbackPolicy = parseObject(input.fallbackPolicy);
  if (input.fallbackAckRequired && Object.keys(fallbackPolicy).length === 0) {
    errors.push("fallback_policy_required_when_ack_is_enabled");
  }

  return { valid: errors.length === 0, errors };
}

export async function createMappingDraft(input: {
  tenantId: string;
  actorId?: string | null;
  connectorSlug: string;
  categoryScope: string;
  mappingLevel: Exclude<MappingLevel, "connector_default_template">;
  connectorDefinitionId: string;
  connectorDefinitionVersion: string;
  compatibilityState?: MappingCompatibility;
  mappingRules: Record<string, unknown>;
  fallbackPolicy?: Record<string, unknown>;
  fallbackAckRequired?: boolean;
}): Promise<ConnectorMappingVersion> {
  const validation = validateMappingRules({
    mappingLevel: input.mappingLevel,
    categoryScope: input.categoryScope,
    mappingRules: input.mappingRules,
    fallbackAckRequired: input.fallbackAckRequired,
    fallbackPolicy: input.fallbackPolicy,
  });
  if (!validation.valid) {
    throw new Error(`invalid_mapping:${validation.errors.join(",")}`);
  }

  const { rows } = await authDb.query(
    `
      INSERT INTO connector_mapping_versions (
        tenant_id,
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
      )
      VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
      RETURNING *
    `,
    [
      input.tenantId,
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
    ]
  );
  const version = toVersion(rows[0] as Record<string, unknown>);
  await appendMappingEvent(authDb, {
    tenantId: input.tenantId,
    mappingVersionId: version.id,
    eventType: "created",
    actorId: input.actorId,
    metadata: { lifecycle_state: version.lifecycleState },
  });
  return version;
}

export async function listMappingVersions(input: {
  tenantId: string;
  connectorSlug: string;
  categoryScope?: string;
  includeArchived?: boolean;
}): Promise<ConnectorMappingVersion[]> {
  const { rows } = await authDb.query(
    `
      SELECT *
      FROM connector_mapping_versions
      WHERE tenant_id=$1
        AND connector_slug=$2
        AND ($3::text IS NULL OR category_scope=$3::text)
        AND ($4::boolean = true OR lifecycle_state <> 'archived')
      ORDER BY created_at DESC
    `,
    [input.tenantId, input.connectorSlug, input.categoryScope ?? null, Boolean(input.includeArchived)]
  );
  return (rows as Record<string, unknown>[]).map(toVersion);
}

export async function getMappingVersionById(input: {
  tenantId: string;
  connectorSlug: string;
  versionId: string;
}): Promise<ConnectorMappingVersion | null> {
  const { rows } = await authDb.query(
    `
      SELECT *
      FROM connector_mapping_versions
      WHERE tenant_id=$1 AND connector_slug=$2 AND id=$3
      LIMIT 1
    `,
    [input.tenantId, input.connectorSlug, input.versionId]
  );
  if (!rows[0]) return null;
  return toVersion(rows[0] as Record<string, unknown>);
}

export async function validateMappingVersion(input: {
  tenantId: string;
  connectorSlug: string;
  versionId: string;
  actorId?: string | null;
}): Promise<ConnectorMappingVersion> {
  const version = await getMappingVersionById(input);
  if (!version) throw new Error("not_found");
  if (!canTransition(version.lifecycleState, "validated")) throw new Error("invalid_transition");

  const validation = validateMappingRules({
    mappingLevel: version.mappingLevel,
    categoryScope: version.categoryScope,
    mappingRules: version.mappingRules,
    fallbackAckRequired: version.fallbackAckRequired,
    fallbackPolicy: version.fallbackPolicy,
  });
  if (!validation.valid) throw new Error(`invalid_mapping:${validation.errors.join(",")}`);

  const { rows } = await authDb.query(
    `
      UPDATE connector_mapping_versions
      SET lifecycle_state='validated', updated_at=NOW()
      WHERE tenant_id=$1 AND connector_slug=$2 AND id=$3
      RETURNING *
    `,
    [input.tenantId, input.connectorSlug, input.versionId]
  );
  const updated = toVersion(rows[0] as Record<string, unknown>);
  await appendMappingEvent(authDb, {
    tenantId: input.tenantId,
    mappingVersionId: updated.id,
    eventType: "validated",
    actorId: input.actorId,
    metadata: { lifecycle_state: updated.lifecycleState },
  });
  return updated;
}

export async function publishMappingVersion(input: {
  tenantId: string;
  connectorSlug: string;
  versionId: string;
  actorId?: string | null;
}): Promise<{ published: ConnectorMappingVersion; superseded: string[] }> {
  const client = await authDb.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query(
      `
        SELECT *
        FROM connector_mapping_versions
        WHERE tenant_id=$1 AND connector_slug=$2 AND id=$3
        FOR UPDATE
      `,
      [input.tenantId, input.connectorSlug, input.versionId]
    );
    if (!selected.rows[0]) throw new Error("not_found");
    const target = toVersion(selected.rows[0] as Record<string, unknown>);
    if (target.lifecycleState !== "validated") throw new Error("must_validate_before_publish");

    const supersededRows = await client.query(
      `
        UPDATE connector_mapping_versions
        SET lifecycle_state='superseded', superseded_by=$1, updated_at=NOW()
        WHERE tenant_id=$2
          AND connector_slug=$3
          AND category_scope=$4
          AND lifecycle_state='published'
          AND id<>$1
        RETURNING id::text AS id
      `,
      [target.id, input.tenantId, input.connectorSlug, target.categoryScope]
    );
    const supersededIds = (supersededRows.rows as Array<{ id: string }>).map((row) => String(row.id));
    for (const supersededId of supersededIds) {
      await appendMappingEvent(client, {
        tenantId: input.tenantId,
        mappingVersionId: supersededId,
        eventType: "superseded",
        actorId: input.actorId,
        metadata: { superseded_by: target.id },
      });
    }

    const published = await client.query(
      `
        UPDATE connector_mapping_versions
        SET lifecycle_state='published', published_at=NOW(), updated_at=NOW()
        WHERE tenant_id=$1 AND connector_slug=$2 AND id=$3
        RETURNING *
      `,
      [input.tenantId, input.connectorSlug, target.id]
    );
    const row = toVersion(published.rows[0] as Record<string, unknown>);
    await appendMappingEvent(client, {
      tenantId: input.tenantId,
      mappingVersionId: row.id,
      eventType: "published",
      actorId: input.actorId,
      metadata: { superseded_count: supersededIds.length },
    });
    await client.query("COMMIT");
    return { published: row, superseded: supersededIds };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveMappingVersion(input: {
  tenantId: string;
  connectorSlug: string;
  versionId: string;
  actorId?: string | null;
}): Promise<ConnectorMappingVersion> {
  const version = await getMappingVersionById(input);
  if (!version) throw new Error("not_found");
  if (!canTransition(version.lifecycleState, "archived")) throw new Error("invalid_transition");

  const { rows } = await authDb.query(
    `
      UPDATE connector_mapping_versions
      SET lifecycle_state='archived', archived_at=NOW(), updated_at=NOW()
      WHERE tenant_id=$1 AND connector_slug=$2 AND id=$3
      RETURNING *
    `,
    [input.tenantId, input.connectorSlug, input.versionId]
  );
  const archived = toVersion(rows[0] as Record<string, unknown>);
  await appendMappingEvent(authDb, {
    tenantId: input.tenantId,
    mappingVersionId: archived.id,
    eventType: "archived",
    actorId: input.actorId,
    metadata: { previous_state: version.lifecycleState },
  });
  return archived;
}

export async function resolveEffectiveMapping(input: {
  tenantId: string;
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
  const categoryScope = input.categoryScope.trim() || "*";
  const { rows } = await authDb.query(
    `
      SELECT *
      FROM connector_mapping_versions
      WHERE lifecycle_state='published'
        AND connector_slug=$2
        AND (
          (tenant_id IS NULL AND mapping_level='connector_default_template' AND category_scope='*')
          OR (tenant_id=$1 AND mapping_level='tenant_connector_default' AND category_scope='*')
          OR (tenant_id=$1 AND mapping_level='tenant_connector_category_mapping' AND category_scope=$3)
        )
      ORDER BY CASE mapping_level
        WHEN 'connector_default_template' THEN 1
        WHEN 'tenant_connector_default' THEN 2
        ELSE 3
      END ASC, created_at ASC
    `,
    [input.tenantId, input.connectorSlug, categoryScope]
  );

  const matched = (rows as Record<string, unknown>[]).map(toVersion);
  let merged: Record<string, unknown> = {};
  const compatStates: MappingCompatibility[] = [];
  for (const version of matched) {
    merged = deepMerge(merged, version.mappingRules);
    compatStates.push(version.compatibilityState);
  }

  merged = applyAttributeOverrides(merged);

  const hasCategorySpecific = matched.some(
    (item) => item.mappingLevel === "tenant_connector_category_mapping" && item.categoryScope === categoryScope
  );
  const tenantDefault = matched.find((item) => item.mappingLevel === "tenant_connector_default");
  const fallbackApplied = categoryScope !== "*" && !hasCategorySpecific && Boolean(tenantDefault);
  const fallbackAckRequired = fallbackApplied && Boolean(tenantDefault?.fallbackAckRequired);
  const compatibilityState = highestCompatibility(compatStates);

  if (input.recordEvaluation && matched.length > 0) {
    await appendMappingEvent(authDb, {
      tenantId: input.tenantId,
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

export async function evaluateMappingPreflight(input: {
  tenantId: string;
  connectorSlug: string;
  categoryScope: string;
  fallbackAcknowledged?: boolean;
  actorId?: string | null;
}): Promise<MappingPreflightResult> {
  const resolved = await resolveEffectiveMapping({
    tenantId: input.tenantId,
    connectorSlug: input.connectorSlug,
    categoryScope: input.categoryScope,
    actorId: input.actorId,
    recordEvaluation: true,
  });
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (resolved.matchedVersions.length === 0) {
    blockers.push("mapping_not_published");
  }

  if (resolved.compatibilityState === "blocked") blockers.push("mapping_compatibility_blocked");
  if (resolved.compatibilityState === "remap_required") blockers.push("mapping_remap_required");
  if (resolved.compatibilityState === "deprecated") warnings.push("mapping_deprecated");

  const fieldMappings = parseObject(resolved.resolvedMapping.field_mappings);
  if (Object.keys(fieldMappings).length === 0) blockers.push("field_mappings_missing");

  if (resolved.fallbackApplied) warnings.push("fallback_mapping_applied");
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

export async function listPublishedCategoryScopes(input: {
  tenantId: string;
  connectorSlug: string;
}): Promise<string[]> {
  const { rows } = await authDb.query(
    `
      SELECT DISTINCT category_scope
      FROM connector_mapping_versions
      WHERE tenant_id=$1
        AND connector_slug=$2
        AND lifecycle_state='published'
        AND mapping_level='tenant_connector_category_mapping'
      ORDER BY category_scope ASC
    `,
    [input.tenantId, input.connectorSlug]
  );
  return (rows as Array<{ category_scope?: string }>).map((row) => String(row.category_scope ?? "")).filter(Boolean);
}
