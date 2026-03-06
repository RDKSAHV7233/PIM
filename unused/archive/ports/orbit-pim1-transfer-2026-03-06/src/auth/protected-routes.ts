import { Router } from "express";
import { randomUUID } from "crypto";
import { z } from "zod";
import {
  apiKeyAuth,
  internalAuth,
  jwtAuth,
  requireInternalScope,
  requireAnyPermission,
  requireMfa,
  requirePermission,
  requirePermissionWithPolicy,
  requirePlatformAdmin,
  requireTenantResource,
  tenantResolver,
  evaluateAccessWithPolicyCache,
} from "./middleware";
import { writeAuditLog } from "./audit";
import { getAuditRetentionStats, cleanupExpiredAuditLogs } from "./audit-retention";
import { createAndRouteAlert, listAlertRules, upsertAlertRule, deleteAlertRule, testAlertRoute } from "./alert-routing";
import { rotateSigningKeypair } from "./keypair-store";
import { listActiveSessions, revokeAllSessions, revokeSessionFamily } from "./session-management";
import {
  QueueSaturatedError,
  findExecution,
  getTenantLedgerSummary,
  ingestConnectorEvent,
  getDlqEntry,
  listDlqEntries,
  resolveDlqEntry,
  listTenantExecutions,
  replayDlqBatch,
  replayExecution,
} from "./execution-service";
import { getTenantControlConfig, updateTenantControlConfig } from "./control-plane";
import { appendControlCommandResult, issueControlCommand, listControlCommandResults, listControlCommands } from "./command-ledger";
import {
  forceCircuitBreakerState,
  getCircuitBreakerConfig,
  listCircuitBreakerEvents,
  getMaskedConnectorConfig,
  testConnectorConnection,
  updateCircuitBreakerConfig,
} from "./connector-security";
import { recordConnectorIngest, recordQueueSaturation } from "./metrics";
import {
  approveMfaResetRequest,
  changeUserRole,
  createConnectorApiKey,
  createMfaResetRequest,
  getConnectorApiKeyById,
  listConnectorApiKeys,
  lockUserAccount,
  revokeConnectorApiKey,
  rotateConnectorApiKey,
} from "./service";
import type { OrbitRequest } from "./types";
import { authDb } from "./db";
import { connectorRegistry } from "../connectors/runtime/registry";
import { resolveRuntimeBindableDefinitions } from "../connectors/runtime/loader";
import { sendApiError } from "./errors";
import { authConfig } from "./config";
import { decryptAuthPayload } from "./secret-encryption";
import { resolveRawBody, verifyWebhookSignature as verifyWebhookHmac } from "./webhook-signature";
import { getRedisHealthSnapshot } from "./redis-health";
import { grantAccessPolicy, listAccessPolicies, revokeAccessPolicy } from "./access-policy";
import { redactPayload } from "./payload-redaction";
import { PimAdapterNotConfiguredError, proxyPim1Request } from "./pim1-adapter";
import {
  archiveMappingVersion,
  createMappingDraft,
  evaluateMappingPreflight,
  listPublishedCategoryScopes,
  listMappingVersions,
  publishMappingVersion,
  resolveEffectiveMapping,
  validateMappingVersion,
} from "./connector-mapping";
import { searchConnectorTaxonomy, taxonomyForConnector } from "./pim1-taxonomy";
import {
  createMarketplaceListing,
  listMarketplaceListings,
  registerConnectorDefinition,
  listStoredConnectorDefinitions,
  syncBuiltInConnectorDefinitions,
} from "../connectors/runtime/catalog-store";
import { loadRuntimeConnectorDefinitions, seedRuntimeConnectorDefinitions } from "../connectors/runtime/definition-store";

const apiKeyCreateSchema = z.object({
  name: z.string().min(3).max(120),
  scopes: z.array(z.string().min(3)).min(1),
  connector_id: z.string().min(2).max(160).optional(),
  expires_at: z.string().datetime().optional(),
});

const apiKeyRotateSchema = z.object({
  scopes: z.array(z.string().min(3)).min(1).optional(),
  connector_id: z.string().min(2).max(160).optional(),
  expires_at: z.string().datetime().optional(),
  overlap_seconds: z.number().int().positive().optional(),
});

const commandIssueSchema = z.object({
  type: z.enum(["RETRY_EXECUTION", "CANCEL_EXECUTION"]),
  executionId: z.string().min(3),
  reason: z.string().min(10),
});

const mfaResetRequestSchema = z.object({
  reason: z.string().min(10).max(500).optional(),
});

const roleChangeSchema = z.object({
  new_role: z.string().min(2).max(100),
  reason: z.string().min(5).max(500),
});

const lockUserSchema = z.object({
  reason: z.string().min(5).max(500),
});

const keypairRotateSchema = z.object({
  type: z.enum(["user", "internal"]),
});

const connectorEventCanonicalSchema = z
  .object({
    connector_id: z.string().min(2).max(160),
    event_type: z.string().min(2).max(160),
    event_id: z.string().min(1).max(255),
    occurred_at: z.string().datetime(),
    payload: z.record(z.string(), z.unknown()).default({}),
    meta: z
      .object({
        source: z.string().min(1).max(160).optional(),
        trace_id: z.string().min(1).max(255).optional(),
        schema_version: z.string().min(1).max(32).optional(),
      })
      .passthrough()
      .optional(),
  })
  .strict();

const connectorEventLegacySchema = z
  .object({
    connectorId: z.string().min(2).max(160),
    eventType: z.string().min(2).max(160).optional(),
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

const circuitBreakerUpdateSchema = z.object({
  failure_threshold: z.number().int().positive().optional(),
  detection_window_seconds: z.number().int().positive().optional(),
  half_open_probe_interval_seconds: z.number().int().positive().optional(),
  recovery_timeout_seconds: z.number().int().positive().optional(),
});

const circuitBreakerForceSchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});
const circuitBreakerEventsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).default(20),
});

const connectorConfigUpdateSchema = z.object({
  mode: z.enum(["standard", "strict"]).optional(),
  sync_enabled: z.boolean().optional(),
  mfa_required_for_changes: z.boolean().optional(),
  max_concurrent_executions: z.number().int().positive().max(500).optional(),
  max_queue_depth: z.number().int().positive().max(200000).optional(),
  scheduler_weight: z.number().int().min(1).max(10).optional(),
});

const dlqQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const connectorDefinitionQuerySchema = z.object({
  include_inactive: z.coerce.boolean().default(false),
});

const connectorDefinitionCreateSchema = z.object({
  definition: z.object({
    id: z.string().min(2).max(120),
    name: z.string().min(2).max(160),
    version: z.string().min(1).max(64),
    role: z.enum(["source", "sink"]),
    sourceType: z.enum(["poll", "webhook", "push"]),
    authMethod: z.enum(["api_key", "oauth2", "basic", "none"]),
    description: z.string().max(2000).default(""),
    eventSchemaVersion: z.string().min(1).max(64),
    capabilities: z.array(z.string().min(2).max(120)).min(1).max(64),
  }),
  sdk_contract_version: z.string().min(1).max(32).default("1.0"),
  metadata: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

const FIRST_PARTY_CONNECTORS = new Set(["flipkart", "whatsapp", "tally"]);

function isFirstPartyConnector(connectorId: string): boolean {
  return FIRST_PARTY_CONNECTORS.has(connectorId.trim().toLowerCase());
}

const marketplaceQuerySchema = z.object({
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
});

const marketplaceCreateSchema = z.object({
  connector_id: z.string().min(2),
  connector_version: z.string().min(1),
  listing_slug: z.string().min(3).max(120).regex(/^[a-z0-9-]+$/),
  publisher_name: z.string().min(2).max(120),
  trust_tier: z.enum(["community", "verified", "enterprise"]).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  support_contact: z.string().max(255).optional(),
  docs_url: z.string().url().max(500).optional(),
  pricing_model: z.string().min(2).max(64).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const accessPolicyListQuerySchema = z.object({
  action: z.string().min(3).optional(),
  domain: z.string().min(3).optional(),
  principal_type: z.enum(["user", "role", "service"]).optional(),
  principal_id: z.string().min(1).optional(),
  include_revoked: z.coerce.boolean().default(false),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const accessPolicyGrantSchema = z.object({
  principal_type: z.enum(["user", "role", "service"]),
  principal_id: z.string().min(1).max(255),
  action: z.string().min(3).max(255),
  domain: z.string().min(3).max(255),
  effect: z.enum(["allow", "deny"]).default("allow"),
  reason: z.string().min(3).max(500).optional(),
  expires_at: z.string().datetime().optional(),
});

const accessPolicyRevokeSchema = z.object({
  policy_id: z.string().min(8).max(255),
  reason: z.string().min(3).max(500).optional(),
});

const accessEffectiveCheckSchema = z.object({
  action: z.string().min(3).max(255),
  domain: z.string().min(3).max(255),
  subject: z
    .object({
      sub: z.string().min(1).max(255),
      role: z.string().min(1).max(255),
      tenant_id: z.string().min(1).max(255),
      scope: z.array(z.string().min(1).max(255)).default([]),
    })
    .optional(),
});

const compatSubmissionQuerySchema = z.object({
  connectorSlug: z.string().min(2).max(160).optional(),
  status: z.enum(["queued", "running", "succeeded", "failed", "dead"]).optional(),
  minAttempt: z.coerce.number().int().min(0).max(100).optional(),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const compatSubmissionStatsQuerySchema = z.object({
  installationId: z.string().min(1).max(255).optional(),
  days: z.coerce.number().int().positive().max(365).default(30),
});

const compatConnectorInstallSchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().positive().max(65535).optional(),
  auth_type: z.string().min(2).max(64).optional(),
  auth_payload: z.record(z.string(), z.unknown()).optional(),
  min_required_resource: z.string().min(1).max(255).optional(),
});

const mappingListQuerySchema = z.object({
  categoryScope: z.string().min(1).max(255).optional(),
  includeArchived: z.coerce.boolean().default(false),
});

const mappingCreateSchema = z.object({
  category_scope: z.string().min(1).max(255),
  mapping_level: z.enum(["tenant_connector_default", "tenant_connector_category_mapping"]),
  connector_definition_id: z.string().min(1).max(255),
  connector_definition_version: z.string().min(1).max(64),
  compatibility_state: z.enum(["compatible", "deprecated", "remap_required", "blocked"]).optional(),
  mapping_rules: z.record(z.string(), z.unknown()),
  fallback_policy: z.record(z.string(), z.unknown()).optional(),
  fallback_ack_required: z.boolean().optional(),
});

const mappingConfirmSchema = z.object({
  confirm: z.boolean().default(false),
});

const mappingArchiveSchema = z.object({
  reason: z.string().min(3).max(500),
});

const mappingResolveQuerySchema = z.object({
  categoryScope: z.string().min(1).max(255),
});

const mappingPreflightSchema = z.object({
  category_scope: z.string().min(1).max(255),
  fallback_acknowledged: z.boolean().optional(),
});

const taxonomySearchQuerySchema = z.object({
  q: z.string().max(255).optional(),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

const publishReadinessSchema = z.object({
  category_scope: z.string().min(1).max(255),
  fallback_acknowledged: z.boolean().optional(),
});

function toActorType(authType: "user_jwt" | "api_key" | "internal_jwt" | "mtls"): "user" | "api_key" | "system" {
  if (authType === "api_key") return "api_key";
  if (authType === "internal_jwt" || authType === "mtls") return "system";
  return "user";
}

function bodyKeys(input: unknown): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  return Object.keys(input as Record<string, unknown>).slice(0, 20);
}

type NormalizedConnectorEventIngest = {
  connectorId: string;
  eventType: string | null;
  eventId: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  meta: Record<string, unknown>;
  idempotencyKey: string;
  schema: "v1" | "legacy";
};

function normalizeConnectorEventIngest(
  body: unknown,
  idempotencyKeyFromHeader: string | null
): { ok: true; data: NormalizedConnectorEventIngest } | { ok: false; status: number; error: string; details?: Record<string, unknown> } {
  const canonical = connectorEventCanonicalSchema.safeParse(body ?? {});
  if (canonical.success) {
    const normalizedEventId = canonical.data.event_id.trim();
    const idempotencyKey = (idempotencyKeyFromHeader ?? normalizedEventId).trim();
    if (!idempotencyKey) {
      return { ok: false, status: 400, error: "idempotency_key_required" };
    }
    return {
      ok: true,
      data: {
        connectorId: canonical.data.connector_id.trim(),
        eventType: canonical.data.event_type.trim(),
        eventId: normalizedEventId,
        occurredAt: canonical.data.occurred_at,
        payload: canonical.data.payload ?? {},
        meta: (canonical.data.meta as Record<string, unknown> | undefined) ?? {},
        idempotencyKey,
        schema: "v1",
      },
    };
  }

  const legacy = connectorEventLegacySchema.safeParse(body ?? {});
  if (!legacy.success) {
    return {
      ok: false,
      status: 400,
      error: "invalid_request",
      details: { issues: canonical.error.issues.map((issue) => issue.message).slice(0, 5) },
    };
  }

  if (!authConfig.allowLegacyConnectorEventEnvelope) {
    return { ok: false, status: 400, error: "legacy_envelope_disabled" };
  }

  const payloadIdempotency =
    typeof (legacy.data.payload as { idempotencyKey?: unknown } | undefined)?.idempotencyKey === "string"
      ? String((legacy.data.payload as { idempotencyKey?: string }).idempotencyKey)
      : "";
  const idempotencyKey = (idempotencyKeyFromHeader ?? payloadIdempotency).trim();
  if (!idempotencyKey) {
    return { ok: false, status: 400, error: "idempotency_key_required" };
  }

  return {
    ok: true,
    data: {
      connectorId: legacy.data.connectorId.trim(),
      eventType: legacy.data.eventType?.trim() || null,
      eventId: idempotencyKey,
      occurredAt: new Date().toISOString(),
      payload: legacy.data.payload ?? {},
      meta: {},
      idempotencyKey,
      schema: "legacy",
    },
  };
}

function readHeader(req: OrbitRequest, name: string): string | null {
  const value = req.headers[String(name).toLowerCase()];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

function defaultSignatureHeader(connectorId: string): string {
  const normalized = connectorId.trim().toLowerCase();
  if (normalized === "razorpay") return "x-razorpay-signature";
  if (normalized === "tally") return "x-tally-signature";
  if (normalized === "whatsapp") return "x-whatsapp-signature";
  return "x-orbit-signature";
}

async function getWebhookSignaturePolicy(
  tenantId: string,
  connectorId: string
): Promise<{ headerName: string; secret: string | null; required: boolean }> {
  const { rows } = await authDb.query(
    `
      SELECT id, auth_payload, auth_type
      FROM connector_configs
      WHERE tenant_id=$1 AND connector_slug=$2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [tenantId, connectorId]
  );
  const row = rows[0] as { id?: string; auth_payload?: Record<string, unknown>; auth_type?: string } | undefined;
  const defaultHeader = defaultSignatureHeader(connectorId);
  const requiresByConnector = connectorRequiresWebhookSignature(connectorId);
  if (!row) {
    return {
      headerName: defaultHeader,
      secret: null,
      required: requiresByConnector,
    };
  }
  const decrypted = decryptAuthPayload((row.auth_payload ?? {}) as Record<string, unknown>, {
    tenantId,
    recordId: String(row.id ?? connectorId),
  });
  const authType = String(row.auth_type ?? "").trim().toLowerCase();
  const requiresByAuthType = authType === "hmac" || authType === "webhook_hmac" || authType === "signature";
  const required = requiresByAuthType || requiresByConnector;
  const secret =
    typeof decrypted.webhook_hmac_secret === "string"
      ? decrypted.webhook_hmac_secret
      : typeof decrypted.hmac_secret === "string"
        ? decrypted.hmac_secret
        : typeof decrypted.webhook_secret === "string"
          ? decrypted.webhook_secret
          : typeof decrypted.signature_secret === "string"
            ? decrypted.signature_secret
            : "";
  const configuredHeader =
    typeof decrypted.webhook_signature_header === "string" ? decrypted.webhook_signature_header.trim().toLowerCase() : "";
  const normalizedSecret = secret.trim();
  return {
    headerName: configuredHeader || defaultHeader,
    secret: normalizedSecret || null,
    required,
  };
}

function connectorRequiresWebhookSignature(connectorId: string): boolean {
  const normalized = connectorId.trim().toLowerCase();
  return normalized === "razorpay" || normalized === "tally" || normalized === "whatsapp";
}

function extractConnectorIdHint(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const canonical = typeof record.connector_id === "string" ? record.connector_id.trim() : "";
  if (canonical) return canonical;
  const legacy = typeof record.connectorId === "string" ? record.connectorId.trim() : "";
  if (legacy) return legacy;
  return null;
}

async function auditFromRequest(
  req: OrbitRequest,
  action: string,
  status: "success" | "failure",
  metadata?: Record<string, unknown>
) {
  if (!req.principal) return;
  try {
    await writeAuditLog({
      tenantId: req.tenantId ?? req.principal.tenant_id ?? null,
      userId: req.principal.auth_type === "user_jwt" ? req.principal.sub : null,
      actorType: toActorType(req.principal.auth_type),
      actorId: req.principal.sub,
      action,
      status,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
      metadata,
    });
  } catch (error) {
    // Audit logging must never break primary request flow.
    console.warn("audit_log_failed", action, error instanceof Error ? error.message : String(error));
  }
}

type AlertSeverity = "critical" | "warning" | "info";

interface TenantAlertRow {
  id: string;
  severity: AlertSeverity;
  message: string;
  created_at: string;
}

function buildDashboardAlerts(
  summary: Awaited<ReturnType<typeof getTenantLedgerSummary>>,
  connectorHealth: Array<{ id: string; name: string; status: string; errorRate: number }>
): TenantAlertRow[] {
  const nowIso = new Date().toISOString();
  const rows: TenantAlertRow[] = [];
  const dlqDepth = Number(summary.dlqCount ?? 0);
  const queuedDepth = Number(summary.queueStatusCounts.queued ?? 0);
  const runningCount = Number(summary.executionStatusCounts.running ?? 0);

  if (dlqDepth > 0) {
    rows.push({
      id: `dlq-${dlqDepth}`,
      severity: "critical",
      message: `DLQ depth is ${dlqDepth}. Replay or resolve failed executions.`,
      created_at: nowIso,
    });
  }

  if (queuedDepth > 0 && runningCount === 0) {
    rows.push({
      id: `queue-${queuedDepth}`,
      severity: "warning",
      message: `Queue backlog detected (${queuedDepth}) while no executions are running.`,
      created_at: nowIso,
    });
  }

  for (const item of connectorHealth) {
    if (item.status === "down") {
      rows.push({
        id: `connector-down-${item.id}`,
        severity: "critical",
        message: `${item.name} is down and needs operator intervention.`,
        created_at: nowIso,
      });
      continue;
    }
    if (item.status === "degraded") {
      rows.push({
        id: `connector-degraded-${item.id}`,
        severity: "warning",
        message: `${item.name} is degraded (error rate ${(item.errorRate * 100).toFixed(1)}%).`,
        created_at: nowIso,
      });
    }
  }

  if (rows.length === 0) {
    rows.push({
      id: "alerts-clear",
      severity: "info",
      message: "No active alerts for this tenant.",
      created_at: nowIso,
    });
  }

  return rows;
}

function toLegacyExecutionStatus(status: string): string {
  switch (status) {
    case "running":
      return "RUNNING";
    case "succeeded":
      return "COMPLETED";
    case "failed":
      return "FAILED";
    case "dead":
      return "FAILED";
    case "queued":
      return "RUNNING";
    default:
      return status.toUpperCase();
  }
}

function toLegacyEventType(eventType: string): string {
  switch (eventType) {
    case "execution.queued":
      return "EXECUTION_CREATED";
    case "execution.running":
      return "EXECUTION_CREATED";
    case "execution.succeeded":
      return "COMMAND_APPLIED";
    case "execution.failed":
      return "ATTEMPT_FAILED";
    case "execution.dead":
      return "DLQ_EMITTED";
    case "execution.replayed":
      return "COMMAND_APPLIED";
    default:
      return eventType.toUpperCase().replace(/\./g, "_");
  }
}

function normalizeConnectorSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

function toSubmissionStatus(status: string): "queued" | "running" | "succeeded" | "failed" | "dead" {
  if (status === "queued" || status === "running" || status === "succeeded" || status === "failed" || status === "dead") {
    return status;
  }
  return "failed";
}

async function listInstalledConnectorsForTenant(tenantId: string): Promise<
  Array<{
    installationId: string;
    connectorSlug: string;
    authType: string;
    createdAt: string;
    updatedAt: string;
  }>
> {
  const { rows } = await authDb.query(
    `
      SELECT id::text AS installation_id, connector_slug, auth_type, created_at, updated_at
      FROM connector_configs
      WHERE tenant_id=$1
      ORDER BY created_at DESC
    `,
    [tenantId]
  );
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    installationId: String(row.installation_id),
    connectorSlug: String(row.connector_slug),
    authType: String(row.auth_type ?? "basic"),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }));
}

async function installConnectorForTenant(input: {
  tenantId: string;
  connectorSlug: string;
  host?: string;
  port?: number;
  authType?: string;
  authPayload?: Record<string, unknown>;
  minRequiredResource?: string;
}): Promise<{
  installationId: string;
  connectorSlug: string;
  authType: string;
  createdAt: string;
  updatedAt: string;
}> {
  const slug = normalizeConnectorSlug(input.connectorSlug);
  const { rows } = await authDb.query(
    `
      INSERT INTO connector_configs (
        tenant_id, connector_slug, host, port, auth_type, auth_payload, min_required_resource
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
      ON CONFLICT (tenant_id, connector_slug)
      DO UPDATE SET
        host = COALESCE(EXCLUDED.host, connector_configs.host),
        port = COALESCE(EXCLUDED.port, connector_configs.port),
        auth_type = COALESCE(EXCLUDED.auth_type, connector_configs.auth_type),
        auth_payload = COALESCE(EXCLUDED.auth_payload, connector_configs.auth_payload),
        min_required_resource = COALESCE(EXCLUDED.min_required_resource, connector_configs.min_required_resource),
        updated_at = NOW()
      RETURNING id::text AS installation_id, connector_slug, auth_type, created_at, updated_at
    `,
    [
      input.tenantId,
      slug,
      input.host ?? null,
      input.port ?? null,
      input.authType ?? "basic",
      JSON.stringify(input.authPayload ?? {}),
      input.minRequiredResource ?? null,
    ]
  );
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("install_failed");
  return {
    installationId: String(row.installation_id),
    connectorSlug: String(row.connector_slug),
    authType: String(row.auth_type ?? "basic"),
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

async function uninstallConnectorForTenant(input: {
  tenantId: string;
  connectorSlug: string;
  installationId: string;
}): Promise<boolean> {
  const slug = normalizeConnectorSlug(input.connectorSlug);
  const result = await authDb.query(
    `
      DELETE FROM connector_configs
      WHERE tenant_id=$1 AND connector_slug=$2 AND id::text=$3
    `,
    [input.tenantId, slug, input.installationId]
  );
  return Number(result.rowCount ?? 0) > 0;
}

async function resolveConnectorSlugForInstallation(tenantId: string, installationId: string): Promise<string | null> {
  const { rows } = await authDb.query(
    `
      SELECT connector_slug
      FROM connector_configs
      WHERE tenant_id=$1 AND id::text=$2
      LIMIT 1
    `,
    [tenantId, installationId]
  );
  const row = rows[0] as { connector_slug?: string } | undefined;
  if (!row?.connector_slug) return null;
  return normalizeConnectorSlug(row.connector_slug);
}

async function listCompatibilitySubmissions(input: {
  tenantId: string;
  connectorSlug?: string;
  status?: "queued" | "running" | "succeeded" | "failed" | "dead";
  minAttempt?: number;
  limit: number;
}): Promise<Array<Record<string, unknown>>> {
  const { rows } = await authDb.query(
    `
      SELECT
        id::text AS submission_id,
        connector_id AS connector_slug,
        status,
        retry_count,
        max_retries,
        created_at,
        payload
      FROM executions
      WHERE tenant_id=$1
        AND ($2::text IS NULL OR connector_id=$2::text)
        AND ($3::text IS NULL OR status=$3::text)
        AND ($4::int IS NULL OR retry_count >= $4::int)
      ORDER BY created_at DESC
      LIMIT $5
    `,
    [input.tenantId, input.connectorSlug ?? null, input.status ?? null, input.minAttempt ?? null, input.limit]
  );
  return (rows as Array<Record<string, unknown>>).map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      id: String(row.submission_id),
      connectorSlug: String(row.connector_slug),
      status: toSubmissionStatus(String(row.status)),
      attempt: Number(row.retry_count ?? 0),
      maxAttempts: Number(row.max_retries ?? 0),
      submittedAt: new Date(String(row.created_at)).toISOString(),
      productId: typeof payload.product_id === "string" ? payload.product_id : null,
      executionId: String(row.submission_id),
    };
  });
}

async function compatibilitySubmissionStats(input: {
  tenantId: string;
  connectorSlug?: string;
  days: number;
}): Promise<{ total: number; succeeded: number; failed: number; running: number; queued: number; dead: number }> {
  const { rows } = await authDb.query(
    `
      SELECT status, COUNT(*)::int AS count
      FROM executions
      WHERE tenant_id=$1
        AND created_at >= NOW() - (($2::int || ' days')::interval)
        AND ($3::text IS NULL OR connector_id=$3::text)
      GROUP BY status
    `,
    [input.tenantId, input.days, input.connectorSlug ?? null]
  );
  const counts: { queued: number; running: number; succeeded: number; failed: number; dead: number } = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
  };
  for (const row of rows as Array<{ status: string; count: number }>) {
    counts[toSubmissionStatus(String(row.status))] = Number(row.count ?? 0);
  }
  return {
    total: counts.queued + counts.running + counts.succeeded + counts.failed + counts.dead,
    succeeded: counts.succeeded,
    failed: counts.failed,
    running: counts.running,
    queued: counts.queued,
    dead: counts.dead,
  };
}

async function getConnectorInstallationState(input: {
  tenantId: string;
  connectorSlug: string;
}): Promise<{
  installed: boolean;
  installationId: string | null;
  credentialsConfigured: boolean;
}> {
  const { rows } = await authDb.query(
    `
      SELECT id::text AS installation_id, auth_payload, encrypted_fields
      FROM connector_configs
      WHERE tenant_id=$1 AND connector_slug=$2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [input.tenantId, input.connectorSlug]
  );
  const row = rows[0] as
    | {
        installation_id?: string;
        auth_payload?: Record<string, unknown>;
        encrypted_fields?: Record<string, unknown>;
      }
    | undefined;
  if (!row) {
    return {
      installed: false,
      installationId: null,
      credentialsConfigured: false,
    };
  }
  const authPayload =
    row.auth_payload && typeof row.auth_payload === "object" && !Array.isArray(row.auth_payload)
      ? (row.auth_payload as Record<string, unknown>)
      : {};
  const encryptedFields =
    row.encrypted_fields && typeof row.encrypted_fields === "object" && !Array.isArray(row.encrypted_fields)
      ? (row.encrypted_fields as Record<string, unknown>)
      : {};
  const credentialsConfigured = Object.keys(authPayload).length > 0 || Object.keys(encryptedFields).length > 0;
  return {
    installed: true,
    installationId: String(row.installation_id ?? ""),
    credentialsConfigured,
  };
}

const requireExecutionDomain = requireTenantResource("execution", "executionId");
const requireApiKeyDomain = requireTenantResource("api_key", "id");
const requireUserDomain = requireTenantResource("user", "userId");
const requireConnectorDomain = requireTenantResource("connector", "id");
const tenantDomain = (req: OrbitRequest) => `tenant:${req.tenantId}`;
const connectorDomain = (req: OrbitRequest) => `connector:${req.tenantId}:${String(req.params.id ?? "")}`;
const executionDomainFromParams = (req: OrbitRequest) => `tenant:${req.tenantId}`;
const executionDomainFromBody = (req: OrbitRequest) => `tenant:${req.tenantId}`;
const apiKeyDomain = (req: OrbitRequest) => `tenant:${req.tenantId}`;
const identityDomain = (req: OrbitRequest) => `identity:${req.tenantId}:${String(req.params.userId ?? "")}`;
const platformDomain = () => "platform";

export function protectedRouter() {
  const router = Router();

  router.get(
    "/internal/executions",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("executions:read", tenantDomain),
    async (req: OrbitRequest, res) => {
    const rows = await listTenantExecutions(req.tenantId!);
    const payload = rows.map((row) => ({
      execution: {
        executionId: row.id,
        status: toLegacyExecutionStatus(row.status),
        createdAt: row.createdAt,
        terminalFailureReason: row.lastError ?? undefined,
      },
    }));
    await auditFromRequest(req, "internal.executions.list", "success");
    return res.json(payload);
    }
  );

  router.get(
    "/executions",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("executions:read", tenantDomain),
    async (req: OrbitRequest, res) => {
    const rows = await listTenantExecutions(req.tenantId!);
    await auditFromRequest(req, "executions.list", "success");
    return res.json(
      rows.map((row) => {
        const redacted = redactPayload(row.payload);
        return {
          id: row.id,
          tenantId: row.tenantId,
          status: row.status,
          connectorId: row.connectorId,
          payload: redacted.payload,
          payload_redacted: redacted.payloadRedacted,
          createdAt: row.createdAt,
        };
      })
    );
    }
  );

  router.get(
    "/internal/executions/:executionId",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("executions:read", executionDomainFromParams),
    requireExecutionDomain,
    async (req: OrbitRequest, res) => {
      const executionId = String(req.params.executionId ?? "");
      if (!executionId) return res.status(400).json({ error: "invalid_request" });
      const row = await findExecution(executionId, req.tenantId!);
      if (!row) return res.status(404).json({ error: "not_found" });
      const redactedPayload = redactPayload(row.execution.payload);
      await auditFromRequest(req, "internal.executions.read", "success", { execution_id: executionId });
      return res.json({
        executionId: row.execution.id,
        status: toLegacyExecutionStatus(row.execution.status),
        createdAt: row.execution.createdAt,
        payload: redactedPayload.payload,
        payload_redacted: redactedPayload.payloadRedacted,
        events: row.events.map((event) => ({
          type: toLegacyEventType(event.eventType),
          timestamp: event.createdAt,
          message: event.payload?.message ? String(event.payload.message) : undefined,
        })),
      });
    }
  );

  router.post(
    "/internal/control/commands",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("commands:write", executionDomainFromBody),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = commandIssueSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

      const target = await findExecution(parsed.data.executionId, req.tenantId!);
      if (!target) return res.status(404).json({ error: "execution_not_found" });

      const commandId = randomUUID();
      const issuedAt = new Date().toISOString();
      const actor = req.userId ?? req.principal?.sub ?? "operator";
      await issueControlCommand({
        tenantId: req.tenantId!,
        commandId,
        type: parsed.data.type,
        targetExecutionId: parsed.data.executionId,
        issuedBy: actor,
        issuedAt,
      });

      const applyAt = new Date(Date.now() + 100).toISOString();
      if (parsed.data.type === "CANCEL_EXECUTION" && target.execution.status === "succeeded") {
        await appendControlCommandResult({
          tenantId: req.tenantId!,
          commandId,
          status: "REJECTED",
          at: applyAt,
          reason: "Execution already completed",
        });
      } else {
        if (parsed.data.type === "RETRY_EXECUTION") {
          await ingestConnectorEvent({
            tenantId: req.tenantId!,
            connectorId: target.execution.connectorId,
            idempotencyKey: `command-retry:${commandId}`,
            payload: target.execution.payload,
          });
        }
        if (parsed.data.type === "CANCEL_EXECUTION") {
          await auditFromRequest(req, "execution.cancel.requested", "success", {
            execution_id: parsed.data.executionId,
          });
        }
        await appendControlCommandResult({
          tenantId: req.tenantId!,
          commandId,
          status: "APPLIED",
          at: applyAt,
        });
      }

      await auditFromRequest(req, "internal.commands.issue", "success", { body_keys: bodyKeys(req.body) });
      return res.status(202).json({ commandId, status: "ACCEPTED" });
    }
  );

  router.get(
    "/internal/control/commands",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("ledger:read", tenantDomain),
    async (req: OrbitRequest, res) => {
    const rows = await listControlCommands(req.tenantId!);
    await auditFromRequest(req, "internal.commands.list", "success");
    return res.json(rows);
    }
  );

  router.get(
    "/internal/control/command-results",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("ledger:read", tenantDomain),
    async (req: OrbitRequest, res) => {
      const rows = await listControlCommandResults(req.tenantId!);
      await auditFromRequest(req, "internal.command_results.list", "success");
      return res.json(rows);
    }
  );

  router.get(
    "/internal/control/ledger",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("ledger:read", tenantDomain),
    async (req: OrbitRequest, res) => {
    const summary = await getTenantLedgerSummary(req.tenantId!);
    await auditFromRequest(req, "internal.ledger.read", "success");
    return res.json({
      ok: true,
      tenant_id: req.tenantId,
      executions: summary.executionStatusCounts,
      queue: summary.queueStatusCounts,
      dlq_count: summary.dlqCount,
      recent_events: summary.recentEvents,
    });
    }
  );

  router.get(
    "/alerts",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("ledger:read", tenantDomain),
    async (req: OrbitRequest, res) => {
      const summary = await getTenantLedgerSummary(req.tenantId!);
      const connectorHealth = connectorRegistry.health();
      const alerts = buildDashboardAlerts(summary, connectorHealth);
      await auditFromRequest(req, "internal.alerts.read", "success", { count: alerts.length });
      return res.status(200).json({ alerts });
    }
  );

  // PIM1 compatibility endpoints expected by connector-facing UI packages.
  router.get(
    "/connectors/installed",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const items = await listInstalledConnectorsForTenant(req.tenantId!);
      await auditFromRequest(req, "compat.connectors.installed.list", "success", { count: items.length });
      return res.status(200).json({ items });
    }
  );

  router.post(
    "/connectors/:slug/install",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const slug = normalizeConnectorSlug(String(req.params.slug ?? ""));
      if (!slug) return res.status(400).json({ error: "invalid_request" });
      const parsed = compatConnectorInstallSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

      const available = await loadRuntimeConnectorDefinitions(true);
      const exists = available.some((item) => normalizeConnectorSlug(item.id) === slug);
      if (!exists) return res.status(404).json({ error: "connector_not_found" });

      const installed = await installConnectorForTenant({
        tenantId: req.tenantId!,
        connectorSlug: slug,
        host: parsed.data.host,
        port: parsed.data.port,
        authType: parsed.data.auth_type,
        authPayload: parsed.data.auth_payload,
        minRequiredResource: parsed.data.min_required_resource,
      });
      await auditFromRequest(req, "compat.connectors.install", "success", {
        connector_slug: slug,
        installation_id: installed.installationId,
      });
      return res.status(201).json({ ok: true, installation: installed });
    }
  );

  router.delete(
    "/connectors/:slug/install/:id",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const slug = normalizeConnectorSlug(String(req.params.slug ?? ""));
      const installationId = String(req.params.id ?? "").trim();
      if (!slug || !installationId) return res.status(400).json({ error: "invalid_request" });
      const removed = await uninstallConnectorForTenant({
        tenantId: req.tenantId!,
        connectorSlug: slug,
        installationId,
      });
      if (!removed) return res.status(404).json({ error: "not_found" });
      await auditFromRequest(req, "compat.connectors.uninstall", "success", {
        connector_slug: slug,
        installation_id: installationId,
      });
      return res.status(200).json({ ok: true, installation_id: installationId });
    }
  );

  router.get(
    "/submissions",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("executions:read", tenantDomain),
    async (req: OrbitRequest, res) => {
      const parsed = compatSubmissionQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const rows = await listCompatibilitySubmissions({
        tenantId: req.tenantId!,
        connectorSlug: parsed.data.connectorSlug ? normalizeConnectorSlug(parsed.data.connectorSlug) : undefined,
        status: parsed.data.status,
        minAttempt: parsed.data.minAttempt,
        limit: parsed.data.limit,
      });
      await auditFromRequest(req, "compat.submissions.list", "success", {
        count: rows.length,
      });
      return res.status(200).json({ items: rows });
    }
  );

  router.get(
    "/submissions/stats",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("executions:read", tenantDomain),
    async (req: OrbitRequest, res) => {
      const parsed = compatSubmissionStatsQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      let connectorSlug: string | undefined;
      if (parsed.data.installationId) {
        const installationId = String(parsed.data.installationId).trim();
        const resolved = await resolveConnectorSlugForInstallation(req.tenantId!, installationId);
        if (!resolved) return res.status(404).json({ error: "installation_not_found" });
        connectorSlug = resolved;
      }
      const stats = await compatibilitySubmissionStats({
        tenantId: req.tenantId!,
        connectorSlug,
        days: parsed.data.days,
      });
      await auditFromRequest(req, "compat.submissions.stats", "success", {
        days: parsed.data.days,
        connector_slug: connectorSlug ?? null,
      });
      return res.status(200).json({ stats });
    }
  );

  router.get(
    "/mappings/:connectorSlug/versions",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      if (!connectorSlug) return res.status(400).json({ error: "invalid_request" });
      const parsed = mappingListQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const items = await listMappingVersions({
        tenantId: req.tenantId!,
        connectorSlug,
        categoryScope: parsed.data.categoryScope,
        includeArchived: parsed.data.includeArchived,
      });
      await auditFromRequest(req, "mappings.versions.list", "success", {
        connector_slug: connectorSlug,
        category_scope: parsed.data.categoryScope ?? null,
        count: items.length,
      });
      return res.status(200).json({ items });
    }
  );

  router.post(
    "/mappings/:connectorSlug/versions",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      if (!connectorSlug) return res.status(400).json({ error: "invalid_request" });
      const parsed = mappingCreateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const created = await createMappingDraft({
          tenantId: req.tenantId!,
          actorId: req.userId ?? null,
          connectorSlug,
          categoryScope: parsed.data.category_scope,
          mappingLevel: parsed.data.mapping_level,
          connectorDefinitionId: parsed.data.connector_definition_id,
          connectorDefinitionVersion: parsed.data.connector_definition_version,
          compatibilityState: parsed.data.compatibility_state,
          mappingRules: parsed.data.mapping_rules,
          fallbackPolicy: parsed.data.fallback_policy,
          fallbackAckRequired: parsed.data.fallback_ack_required,
        });
        await auditFromRequest(req, "mappings.version.create", "success", {
          connector_slug: connectorSlug,
          mapping_version_id: created.id,
          category_scope: created.categoryScope,
          mapping_level: created.mappingLevel,
        });
        return res.status(201).json(created);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "mappings.version.create", "failure", {
          connector_slug: connectorSlug,
          error: message,
        });
        if (message.startsWith("invalid_mapping:")) {
          return res.status(400).json({ error: "invalid_mapping", reason: message.replace("invalid_mapping:", "") });
        }
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/mappings/:connectorSlug/versions/:id/validate",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      const versionId = String(req.params.id ?? "").trim();
      if (!connectorSlug || !versionId) return res.status(400).json({ error: "invalid_request" });
      try {
        const validated = await validateMappingVersion({
          tenantId: req.tenantId!,
          connectorSlug,
          versionId,
          actorId: req.userId ?? null,
        });
        await auditFromRequest(req, "mappings.version.validate", "success", {
          connector_slug: connectorSlug,
          mapping_version_id: validated.id,
        });
        return res.status(200).json(validated);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "mappings.version.validate", "failure", {
          connector_slug: connectorSlug,
          mapping_version_id: versionId,
          error: message,
        });
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        if (message === "invalid_transition") return res.status(409).json({ error: "invalid_transition" });
        if (message.startsWith("invalid_mapping:")) {
          return res.status(400).json({ error: "invalid_mapping", reason: message.replace("invalid_mapping:", "") });
        }
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/mappings/:connectorSlug/versions/:id/publish",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      const versionId = String(req.params.id ?? "").trim();
      if (!connectorSlug || !versionId) return res.status(400).json({ error: "invalid_request" });
      const parsed = mappingConfirmSchema.safeParse(req.body ?? {});
      if (!parsed.success || parsed.data.confirm !== true) {
        return res.status(400).json({ error: "confirmation_required" });
      }
      try {
        const published = await publishMappingVersion({
          tenantId: req.tenantId!,
          connectorSlug,
          versionId,
          actorId: req.userId ?? null,
        });
        await auditFromRequest(req, "mappings.version.publish", "success", {
          connector_slug: connectorSlug,
          mapping_version_id: published.published.id,
          superseded_count: published.superseded.length,
        });
        return res.status(200).json(published);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "mappings.version.publish", "failure", {
          connector_slug: connectorSlug,
          mapping_version_id: versionId,
          error: message,
        });
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        if (message === "must_validate_before_publish") return res.status(409).json({ error: "must_validate_before_publish" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/mappings/:connectorSlug/versions/:id/archive",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      const versionId = String(req.params.id ?? "").trim();
      if (!connectorSlug || !versionId) return res.status(400).json({ error: "invalid_request" });
      const parsed = mappingArchiveSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const archived = await archiveMappingVersion({
          tenantId: req.tenantId!,
          connectorSlug,
          versionId,
          actorId: req.userId ?? null,
        });
        await auditFromRequest(req, "mappings.version.archive", "success", {
          connector_slug: connectorSlug,
          mapping_version_id: archived.id,
          reason: parsed.data.reason,
        });
        return res.status(200).json(archived);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "mappings.version.archive", "failure", {
          connector_slug: connectorSlug,
          mapping_version_id: versionId,
          reason: parsed.data.reason,
          error: message,
        });
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        if (message === "invalid_transition") return res.status(409).json({ error: "invalid_transition" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.get(
    "/mappings/:connectorSlug/resolve",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("config:read", tenantDomain),
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      if (!connectorSlug) return res.status(400).json({ error: "invalid_request" });
      const parsed = mappingResolveQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const resolution = await resolveEffectiveMapping({
        tenantId: req.tenantId!,
        connectorSlug,
        categoryScope: parsed.data.categoryScope,
        actorId: req.userId ?? null,
        recordEvaluation: true,
      });
      await auditFromRequest(req, "mappings.resolve", "success", {
        connector_slug: connectorSlug,
        category_scope: parsed.data.categoryScope,
        matched_versions: resolution.matchedVersions.length,
        compatibility_state: resolution.compatibilityState,
      });
      return res.status(200).json({
        resolved: resolution.resolvedMapping,
        compatibility_state: resolution.compatibilityState,
        fallback_applied: resolution.fallbackApplied,
        fallback_ack_required: resolution.fallbackAckRequired,
        matched_versions: resolution.matchedVersions,
      });
    }
  );

  router.post(
    "/mappings/:connectorSlug/preflight",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      if (!connectorSlug) return res.status(400).json({ error: "invalid_request" });
      const parsed = mappingPreflightSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const result = await evaluateMappingPreflight({
        tenantId: req.tenantId!,
        connectorSlug,
        categoryScope: parsed.data.category_scope,
        fallbackAcknowledged: parsed.data.fallback_acknowledged,
        actorId: req.userId ?? null,
      });
      await auditFromRequest(req, "mappings.preflight", "success", {
        connector_slug: connectorSlug,
        category_scope: parsed.data.category_scope,
        ok: result.ok,
        blocker_count: result.blockers.length,
      });
      return res.status(result.ok ? 200 : 409).json(result);
    }
  );

  router.get(
    "/taxonomy/:connectorSlug/search",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("config:read", tenantDomain),
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      if (!connectorSlug) return res.status(400).json({ error: "invalid_request" });
      const parsed = taxonomySearchQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const items = searchConnectorTaxonomy({
        connectorSlug,
        query: parsed.data.q,
        limit: parsed.data.limit,
      });
      await auditFromRequest(req, "taxonomy.search", "success", {
        connector_slug: connectorSlug,
        query: parsed.data.q ?? "",
        count: items.length,
      });
      return res.status(200).json({ items });
    }
  );

  router.get(
    "/taxonomy/:connectorSlug/unmapped",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      if (!connectorSlug) return res.status(400).json({ error: "invalid_request" });
      const parsed = taxonomySearchQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const taxonomy = searchConnectorTaxonomy({
        connectorSlug,
        query: parsed.data.q,
        limit: parsed.data.limit,
      }).filter((node) => node.leaf);
      const mappedScopes = new Set(
        await listPublishedCategoryScopes({
          tenantId: req.tenantId!,
          connectorSlug,
        })
      );
      const unmapped = taxonomy.filter((node) => !mappedScopes.has(node.id));
      await auditFromRequest(req, "taxonomy.unmapped", "success", {
        connector_slug: connectorSlug,
        count: unmapped.length,
      });
      return res.status(200).json({
        total_leaf_categories: taxonomy.length,
        mapped_leaf_categories: taxonomy.length - unmapped.length,
        unmapped_leaf_categories: unmapped.length,
        items: unmapped,
      });
    }
  );

  router.post(
    "/publish-readiness/:connectorSlug",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const connectorSlug = normalizeConnectorSlug(String(req.params.connectorSlug ?? ""));
      if (!connectorSlug) return res.status(400).json({ error: "invalid_request" });
      const parsed = publishReadinessSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

      const blockers: string[] = [];
      const warnings: string[] = [];

      const install = await getConnectorInstallationState({
        tenantId: req.tenantId!,
        connectorSlug,
      });
      if (!install.installed) blockers.push("connector_not_installed");
      if (install.installed && !install.credentialsConfigured) blockers.push("connector_credentials_missing");

      const preflight = await evaluateMappingPreflight({
        tenantId: req.tenantId!,
        connectorSlug,
        categoryScope: parsed.data.category_scope,
        fallbackAcknowledged: parsed.data.fallback_acknowledged,
        actorId: req.userId ?? null,
      });
      blockers.push(...preflight.blockers);
      warnings.push(...preflight.warnings);

      try {
        const breaker = await getCircuitBreakerConfig({
          tenantId: req.tenantId!,
          connectorId: connectorSlug,
        });
        if (breaker.forced_state === "open") blockers.push("connector_circuit_forced_open");
      } catch {
        warnings.push("connector_circuit_config_unavailable");
      }

      const connectorHealth = connectorRegistry.health().find((entry) => entry.id === connectorSlug);
      if (connectorHealth?.status === "degraded") warnings.push("connector_degraded");
      if (connectorHealth?.status === "down") blockers.push("connector_down");

      const taxonomy = taxonomyForConnector(connectorSlug);
      const categoryNode = taxonomy.find((node) => node.id === parsed.data.category_scope) ?? null;
      if (categoryNode && categoryNode.required_attributes.length > 0) {
        const resolved = await resolveEffectiveMapping({
          tenantId: req.tenantId!,
          connectorSlug,
          categoryScope: parsed.data.category_scope,
        });
        const fields =
          resolved.resolvedMapping &&
          typeof resolved.resolvedMapping === "object" &&
          !Array.isArray(resolved.resolvedMapping) &&
          resolved.resolvedMapping.field_mappings &&
          typeof resolved.resolvedMapping.field_mappings === "object" &&
          !Array.isArray(resolved.resolvedMapping.field_mappings)
            ? (resolved.resolvedMapping.field_mappings as Record<string, unknown>)
            : {};
        const missingRequired = categoryNode.required_attributes.filter((key) => typeof fields[key] !== "string");
        if (missingRequired.length > 0) blockers.push(`required_attributes_missing:${missingRequired.join(",")}`);
      }

      const uniqueBlockers = Array.from(new Set(blockers));
      const uniqueWarnings = Array.from(new Set(warnings));
      const ok = uniqueBlockers.length === 0;

      await auditFromRequest(req, "publish.readiness", "success", {
        connector_slug: connectorSlug,
        category_scope: parsed.data.category_scope,
        ok,
        blocker_count: uniqueBlockers.length,
      });

      return res.status(ok ? 200 : 409).json({
        ok,
        connector_slug: connectorSlug,
        category_scope: parsed.data.category_scope,
        blockers: uniqueBlockers,
        warnings: uniqueWarnings,
        sections: {
          installation: install,
          mapping_preflight: preflight,
          connector_health: connectorHealth ?? null,
        },
      });
    }
  );

  router.get(
    "/products",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("config:read", tenantDomain),
    async (req: OrbitRequest, res) => {
      try {
        const proxied = await proxyPim1Request({
          req,
          method: "GET",
          path: "/api/v1/products",
          query: req.query,
        });
        return res.status(proxied.status).json(proxied.body);
      } catch (error) {
        if (error instanceof PimAdapterNotConfiguredError) {
          return sendApiError(res, 501, "pim_adapter_not_configured", {
            message: "Configure PIM1_ADAPTER_BASE_URL or implement local product APIs.",
          });
        }
        return sendApiError(res, 502, "pim_adapter_upstream_unreachable", {
          retryable: true,
          message: error instanceof Error ? error.message : "upstream_error",
        });
      }
    }
  );

  router.get(
    "/media/:id",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("config:read", tenantDomain),
    async (req: OrbitRequest, res) => {
      const mediaId = String(req.params.id ?? "").trim();
      if (!mediaId) return res.status(400).json({ error: "invalid_request" });
      try {
        const proxied = await proxyPim1Request({
          req,
          method: "GET",
          path: `/api/v1/media/${encodeURIComponent(mediaId)}`,
        });
        return res.status(proxied.status).json(proxied.body);
      } catch (error) {
        if (error instanceof PimAdapterNotConfiguredError) {
          return sendApiError(res, 501, "pim_adapter_not_configured", {
            message: "Configure PIM1_ADAPTER_BASE_URL or implement local media APIs.",
          });
        }
        return sendApiError(res, 502, "pim_adapter_upstream_unreachable", {
          retryable: true,
          message: error instanceof Error ? error.message : "upstream_error",
        });
      }
    }
  );

  router.get(
    "/internal/connectors/catalog",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      let items = connectorRegistry.catalog();
      if (items.length === 0) {
        await seedRuntimeConnectorDefinitions();
        const definitions = await loadRuntimeConnectorDefinitions(true);
        const resolved = resolveRuntimeBindableDefinitions(definitions);
        connectorRegistry.setCatalog(resolved.runnable);
        items = resolved.runnable;
      }
      await auditFromRequest(req, "internal.connectors.catalog.read", "success", { count: items.length });
      return res.status(200).json({ items });
    }
  );

  router.get(
    "/internal/connectors/health",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:health", tenantDomain),
    async (req: OrbitRequest, res) => {
      const items = connectorRegistry.health();
      await auditFromRequest(req, "internal.connectors.health.read", "success", { count: items.length });
      return res.status(200).json({ items });
    }
  );

  router.get(
    "/internal/connectors/definitions",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const parsed = connectorDefinitionQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const items = await listStoredConnectorDefinitions(parsed.data.include_inactive);
      await auditFromRequest(req, "internal.connectors.definitions.read", "success", {
        include_inactive: parsed.data.include_inactive,
        count: items.length,
      });
      return res.status(200).json({ items });
    }
  );

  router.post(
    "/internal/connectors/definitions",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = connectorDefinitionCreateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const definitionId = parsed.data.definition.id;
      const firstParty = isFirstPartyConnector(definitionId);
      if (!firstParty && !authConfig.connectorSandboxEnabled) {
        await auditFromRequest(req, "internal.connectors.definitions.register", "failure", {
          connector_id: definitionId,
          error: "sandbox_required_for_third_party",
        });
        return res.status(503).json({ error: "connector_sandbox_required" });
      }
      try {
        const item = await registerConnectorDefinition({
          definition: parsed.data.definition,
          sdkContractVersion: parsed.data.sdk_contract_version,
          metadata: parsed.data.metadata,
          isActive: parsed.data.is_active,
          actorUserId: req.userId ?? null,
        });
        await auditFromRequest(req, "internal.connectors.definitions.register", "success", {
          connector_id: item.id,
          version: item.version,
          sdk_contract_version: item.sdkContractVersion,
        });
        return res.status(201).json(item);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "internal.connectors.definitions.register", "failure", { error: message });
        if (message.includes("invalid_") || message.includes("missing_capabilities")) {
          return res.status(400).json({ error: "invalid_connector_definition" });
        }
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/internal/connectors/definitions/sync",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const count = await syncBuiltInConnectorDefinitions(req.userId ?? null);
      await auditFromRequest(req, "internal.connectors.definitions.sync", "success", { synced: count });
      return res.status(200).json({ ok: true, synced: count });
    }
  );

  router.get(
    "/internal/connectors/marketplace",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    async (req: OrbitRequest, res) => {
      const parsed = marketplaceQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const items = await listMarketplaceListings(parsed.data.visibility);
      await auditFromRequest(req, "internal.connectors.marketplace.read", "success", {
        visibility: parsed.data.visibility ?? null,
        count: items.length,
      });
      return res.status(200).json({ items });
    }
  );

  router.post(
    "/internal/connectors/marketplace",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = marketplaceCreateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const created = await createMarketplaceListing({
          connectorId: parsed.data.connector_id,
          connectorVersion: parsed.data.connector_version,
          listingSlug: parsed.data.listing_slug,
          publisherName: parsed.data.publisher_name,
          trustTier: parsed.data.trust_tier,
          visibility: parsed.data.visibility,
          supportContact: parsed.data.support_contact,
          docsUrl: parsed.data.docs_url,
          pricingModel: parsed.data.pricing_model,
          metadata: parsed.data.metadata,
        });
        await auditFromRequest(req, "internal.connectors.marketplace.create", "success", {
          connector_id: created.connectorId,
          listing_slug: created.listingSlug,
        });
        return res.status(201).json(created);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "internal.connectors.marketplace.create", "failure", { error: message });
        if (message.includes("foreign key")) return res.status(404).json({ error: "connector_definition_not_found" });
        if (message.includes("duplicate key")) return res.status(409).json({ error: "listing_slug_conflict" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.get(
    "/internal/connectors/config",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("config:read", tenantDomain),
    async (req: OrbitRequest, res) => {
      const config = await getTenantControlConfig(req.tenantId!);
      await auditFromRequest(req, "internal.connectors.config.read", "success");
      return res.json({
        tenant_id: req.tenantId!,
        config: {
          mode: config.mode,
          sync_enabled: config.syncEnabled,
          mfa_required_for_changes: config.mfaRequiredForChanges,
          max_concurrent_executions: config.maxConcurrentExecutions,
          max_queue_depth: config.maxQueueDepth,
          scheduler_weight: config.schedulerWeight,
          updated_at: config.updatedAt,
        },
      });
    }
  );

  router.put(
    "/internal/connectors/config",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("config:write", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = connectorConfigUpdateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const config = await updateTenantControlConfig(req.tenantId!, {
        mode: parsed.data.mode,
        syncEnabled: parsed.data.sync_enabled,
        mfaRequiredForChanges: parsed.data.mfa_required_for_changes,
        maxConcurrentExecutions: parsed.data.max_concurrent_executions,
        maxQueueDepth: parsed.data.max_queue_depth,
        schedulerWeight: parsed.data.scheduler_weight,
      });
      await auditFromRequest(req, "internal.connectors.config.write", "success", { body_keys: bodyKeys(req.body) });
      return res.json({
        ok: true,
        tenant_id: req.tenantId,
        config: {
          mode: config.mode,
          sync_enabled: config.syncEnabled,
          mfa_required_for_changes: config.mfaRequiredForChanges,
          max_concurrent_executions: config.maxConcurrentExecutions,
          max_queue_depth: config.maxQueueDepth,
          scheduler_weight: config.schedulerWeight,
          updated_at: config.updatedAt,
        },
      });
    }
  );

  router.get(
    "/internal/access/policies",
    jwtAuth,
    tenantResolver,
    requireAnyPermission(["access:read", "users:manage"]),
    async (req: OrbitRequest, res) => {
      const parsed = accessPolicyListQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const items = await listAccessPolicies({
          context: {
            actorUserId: req.userId ?? null,
            actorTenantId: req.tenantId!,
            actorRole: req.principal?.role ?? "",
          },
          action: parsed.data.action,
          domain: parsed.data.domain,
          principalType: parsed.data.principal_type,
          principalId: parsed.data.principal_id,
          includeRevoked: parsed.data.include_revoked,
          limit: parsed.data.limit,
        });
        await auditFromRequest(req, "internal.access.policies.list", "success", { count: items.length });
        return res.status(200).json({ items });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "internal.access.policies.list", "failure", { error: message });
        if (message === "invalid_domain") return res.status(400).json({ error: "invalid_domain" });
        if (message === "forbidden_domain_scope") return res.status(403).json({ error: "forbidden" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/internal/access/policies/grant",
    jwtAuth,
    tenantResolver,
    requireAnyPermission(["access:grant", "users:manage"]),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = accessPolicyGrantSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const policy = await grantAccessPolicy({
          context: {
            actorUserId: req.userId ?? null,
            actorTenantId: req.tenantId!,
            actorRole: req.principal?.role ?? "",
          },
          principalType: parsed.data.principal_type,
          principalId: parsed.data.principal_id,
          action: parsed.data.action,
          domain: parsed.data.domain,
          effect: parsed.data.effect,
          reason: parsed.data.reason,
          expiresAt: parsed.data.expires_at,
        });
        await auditFromRequest(req, "internal.access.policies.grant", "success", {
          policy_id: policy.id,
          principal_type: policy.principalType,
          principal_id: policy.principalId,
          action: policy.action,
          domain: policy.domain,
          effect: policy.effect,
        });
        return res.status(201).json(policy);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "internal.access.policies.grant", "failure", { error: message });
        if (message === "invalid_domain" || message === "invalid_action" || message === "invalid_principal") {
          return res.status(400).json({ error: message });
        }
        if (message === "forbidden_domain_scope") return res.status(403).json({ error: "forbidden" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/internal/access/policies/revoke",
    jwtAuth,
    tenantResolver,
    requireAnyPermission(["access:revoke", "users:manage"]),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = accessPolicyRevokeSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const policy = await revokeAccessPolicy({
          context: {
            actorUserId: req.userId ?? null,
            actorTenantId: req.tenantId!,
            actorRole: req.principal?.role ?? "",
          },
          policyId: parsed.data.policy_id,
          reason: parsed.data.reason,
        });
        await auditFromRequest(req, "internal.access.policies.revoke", "success", {
          policy_id: policy.id,
          action: policy.action,
          domain: policy.domain,
        });
        return res.status(200).json(policy);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "internal.access.policies.revoke", "failure", { error: message });
        if (message === "invalid_domain") return res.status(400).json({ error: message });
        if (message === "forbidden_domain_scope") return res.status(403).json({ error: "forbidden" });
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/internal/access/effective",
    jwtAuth,
    tenantResolver,
    requireAnyPermission(["access:review", "users:manage"]),
    async (req: OrbitRequest, res) => {
      const parsed = accessEffectiveCheckSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const requestedSubject = parsed.data.subject;
      const actorRole = String(req.principal?.role ?? "")
        .trim()
        .toLowerCase();
      const canSimulate = actorRole === "super_admin";
      if (requestedSubject && !canSimulate) {
        return res.status(403).json({ error: "forbidden" });
      }
      const subject = requestedSubject ?? {
        sub: req.principal?.sub ?? "",
        role: req.principal?.role ?? "",
        tenant_id: req.principal?.tenant_id ?? "",
        scope: req.principal?.scope ?? [],
      };
      try {
        const result = await evaluateAccessWithPolicyCache({
          context: {
            actorUserId: req.userId ?? null,
            actorTenantId: req.tenantId!,
            actorRole: req.principal?.role ?? "",
          },
          action: parsed.data.action,
          domain: parsed.data.domain,
          subject: {
            sub: subject.sub,
            role: subject.role,
            tenantId: subject.tenant_id,
            scope: subject.scope,
          },
          neutralOnError: false,
        });
        if (!result) {
          return res.status(500).json({ error: "internal_error" });
        }
        await auditFromRequest(req, "internal.access.effective", "success", {
          action: parsed.data.action,
          domain: parsed.data.domain,
          allowed: result.allowed,
          source: result.source,
        });
        return res.status(200).json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "internal.access.effective", "failure", { error: message });
        if (message === "invalid_domain" || message === "invalid_action") return res.status(400).json({ error: message });
        if (message === "forbidden_domain_scope" || message === "forbidden_subject_scope") {
          return res.status(403).json({ error: "forbidden" });
        }
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.get(
    "/internal/access/api-keys/:id",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("api_keys:manage", apiKeyDomain),
    requireMfa,
    requireApiKeyDomain,
    async (req: OrbitRequest, res) => {
      const keyId = String(req.params.id ?? "");
      if (!keyId) return res.status(400).json({ error: "invalid_request" });
      try {
        const item = await getConnectorApiKeyById({ tenantId: req.tenantId!, keyId });
        await auditFromRequest(req, "internal.api_keys.read", "success", { key_id: keyId });
        return res.status(200).json(item);
      } catch {
        await auditFromRequest(req, "internal.api_keys.read", "failure", { key_id: keyId });
        return res.status(404).json({ error: "not_found" });
      }
    }
  );

  router.get(
    "/internal/access/api-keys",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("api_keys:manage", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const rows = await listConnectorApiKeys(req.tenantId!);
      await auditFromRequest(req, "internal.api_keys.list", "success");
      return res.json({ items: rows });
    }
  );

  router.post(
    "/internal/access/api-keys",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("api_keys:manage", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = apiKeyCreateSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const result = await createConnectorApiKey({
          tenantId: req.tenantId!,
          name: parsed.data.name,
          scopes: parsed.data.scopes,
          connectorId: parsed.data.connector_id,
          expiresAt: parsed.data.expires_at,
          createdBy: req.userId!,
        });
        await auditFromRequest(req, "internal.api_keys.create", "success", { key_id: result.id });
        return res.status(201).json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "internal.api_keys.create", "failure", { error: message });
        if (
          message === "connector_id_required" ||
          message === "connector_id_scope_ambiguous" ||
          message === "connector_id_scope_mismatch"
        ) {
          return res.status(400).json({ error: "invalid_request", reason: message });
        }
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/internal/access/api-keys/:id/rotate",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("api_keys:manage", apiKeyDomain),
    requireMfa,
    requireApiKeyDomain,
    async (req: OrbitRequest, res) => {
      const keyId = String(req.params.id ?? "");
      if (!keyId) return res.status(400).json({ error: "invalid_request" });
      const parsed = apiKeyRotateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

      try {
        const result = await rotateConnectorApiKey({
          tenantId: req.tenantId!,
          keyId,
          rotatedBy: req.userId!,
          scopes: parsed.data.scopes,
          connectorId: parsed.data.connector_id,
          expiresAt: parsed.data.expires_at,
          overlapSeconds: parsed.data.overlap_seconds,
        });
        await auditFromRequest(req, "internal.api_keys.rotate", "success", { key_id: keyId });
        return res.status(200).json(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        await auditFromRequest(req, "internal.api_keys.rotate", "failure", { key_id: keyId, error: message });
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        if (message === "owner_email_required") return res.status(409).json({ error: "OWNER_EMAIL_REQUIRED" });
        if (
          message === "connector_id_required" ||
          message === "connector_id_scope_ambiguous" ||
          message === "connector_id_scope_mismatch"
        ) {
          return res.status(400).json({ error: "invalid_request", reason: message });
        }
        if (message === "rotation_email_delivery_failed") {
          return res.status(502).json({ error: "ROTATION_EMAIL_DELIVERY_FAILED" });
        }
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/admin/executions/:executionId/replay",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("commands:write", executionDomainFromParams),
    requireMfa,
    requireExecutionDomain,
    async (req: OrbitRequest, res) => {
      const executionId = String(req.params.executionId ?? "");
      if (!executionId) return res.status(400).json({ error: "invalid_request" });
      try {
        const replayed = await replayExecution(executionId, req.tenantId!);
        await auditFromRequest(req, "admin.executions.replay", "success", {
          execution_id: executionId,
          replayed_as: replayed.id,
        });
        return res.status(200).json({ ok: true, replayedAs: replayed.id, retryOf: executionId });
      } catch (error) {
        await auditFromRequest(req, "admin.executions.replay", "failure", {
          execution_id: executionId,
          error: error instanceof Error ? error.message : "unknown",
        });
        return res.status(404).json({ error: "not_found" });
      }
    }
  );

  router.get(
    "/admin/executions/dlq",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("commands:write", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = dlqQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const entries = await listDlqEntries(req.tenantId!, parsed.data.limit);
      await auditFromRequest(req, "admin.executions.dlq.list", "success", { count: entries.length });
      return res.status(200).json({
        items: entries.map((entry) => {
          const redacted = redactPayload(entry.payload);
          return {
            ...entry,
            payload: redacted.payload,
            payload_redacted: redacted.payloadRedacted,
          };
        }),
      });
    }
  );

  router.post(
    "/admin/executions/dlq/:executionId/replay",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("commands:write", executionDomainFromParams),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const executionId = String(req.params.executionId ?? "");
      if (!executionId) return res.status(400).json({ error: "invalid_request" });
      try {
        const replayed = await replayExecution(executionId, req.tenantId!);
        await auditFromRequest(req, "admin.executions.dlq.replay", "success", {
          execution_id: executionId,
          replayed_as: replayed.id,
        });
        return res.status(200).json({ ok: true, replayedAs: replayed.id, retryOf: executionId });
      } catch {
        await auditFromRequest(req, "admin.executions.dlq.replay", "failure", { execution_id: executionId });
        return res.status(404).json({ error: "not_found" });
      }
    }
  );

  router.get(
    "/admin/executions/dlq/:executionId",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("commands:write", executionDomainFromParams),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const executionId = String(req.params.executionId ?? "");
      if (!executionId) return res.status(400).json({ error: "invalid_request" });
      const entry = await getDlqEntry(executionId, req.tenantId!);
      if (!entry) return res.status(404).json({ error: "not_found" });
      await auditFromRequest(req, "admin.executions.dlq.read", "success", { execution_id: executionId });
      const redacted = redactPayload(entry.payload);
      return res.status(200).json({
        ...entry,
        payload: redacted.payload,
        payload_redacted: redacted.payloadRedacted,
      });
    }
  );

  router.post(
    "/admin/executions/dlq/replay-all",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("commands:write", tenantDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = dlqQuerySchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const replayedIds = await replayDlqBatch(req.tenantId!, parsed.data.limit);
      await auditFromRequest(req, "admin.executions.dlq.replay_all", "success", { replayed_count: replayedIds.length });
      return res.status(200).json({ ok: true, replayed_count: replayedIds.length, execution_ids: replayedIds });
    }
  );

  router.post(
    "/dlq/:executionId/resolve",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("commands:write", executionDomainFromParams),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const executionId = String(req.params.executionId ?? "");
      if (!executionId) return res.status(400).json({ error: "invalid_request" });
      const parsed = z.object({ reason: z.string().min(3).max(500).optional() }).safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      const resolved = await resolveDlqEntry(executionId, req.tenantId!);
      if (!resolved) {
        await auditFromRequest(req, "admin.executions.dlq.resolve", "failure", { execution_id: executionId, reason: "not_found" });
        return res.status(404).json({ error: "not_found" });
      }
      await auditFromRequest(req, "admin.executions.dlq.resolve", "success", {
        execution_id: executionId,
        reason: parsed.data.reason ?? "resolved_from_ui",
      });
      return res.status(200).json({ ok: true, execution_id: executionId });
    }
  );

  router.post(
    "/internal/access/api-keys/:id/revoke",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("api_keys:manage", apiKeyDomain),
    requireMfa,
    requireApiKeyDomain,
    async (req: OrbitRequest, res) => {
      const keyId = String(req.params.id ?? "");
      if (!keyId) return res.status(400).json({ error: "invalid_request" });
      try {
        await revokeConnectorApiKey({ tenantId: req.tenantId!, keyId, revokedBy: req.userId! });
        await auditFromRequest(req, "internal.api_keys.revoke", "success", { key_id: keyId });
        return res.status(200).json({ ok: true });
      } catch {
        await auditFromRequest(req, "internal.api_keys.revoke", "failure", { key_id: keyId });
        return res.status(404).json({ error: "not_found" });
      }
    }
  );

  router.post(
    "/internal/access/users/:userId/mfa-reset-requests",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("users:manage", identityDomain),
    requireMfa,
    requireUserDomain,
    async (req: OrbitRequest, res) => {
      const userId = String(req.params.userId ?? "");
      if (!userId) return res.status(400).json({ error: "invalid_request" });
      const parsed = mfaResetRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const result = await createMfaResetRequest({
          tenantId: req.tenantId!,
          targetUserId: userId,
          actorId: req.userId!,
          reason: parsed.data.reason,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });
        await auditFromRequest(req, "internal.users.mfa_reset.request", "success", { target_user_id: userId });
        return res.status(201).json(result);
      } catch {
        await auditFromRequest(req, "internal.users.mfa_reset.request", "failure", { target_user_id: userId });
        return res.status(404).json({ error: "not_found" });
      }
    }
  );

  router.post(
    "/internal/access/users/:userId/mfa-reset-requests/:requestId/approve",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("users:manage", identityDomain),
    requireMfa,
    requireUserDomain,
    async (req: OrbitRequest, res) => {
      const userId = String(req.params.userId ?? "");
      const requestId = String(req.params.requestId ?? "");
      if (!userId || !requestId) return res.status(400).json({ error: "invalid_request" });
      try {
        await approveMfaResetRequest({
          tenantId: req.tenantId!,
          targetUserId: userId,
          requestId,
          actorId: req.userId!,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });
        await auditFromRequest(req, "internal.users.mfa_reset.approve", "success", {
          target_user_id: userId,
          request_id: requestId,
        });
        return res.status(200).json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "invalid_request";
        await auditFromRequest(req, "internal.users.mfa_reset.approve", "failure", {
          target_user_id: userId,
          request_id: requestId,
          error: message,
        });
        if (message === "second_approval_required") {
          return res.status(409).json({ error: "SECOND_APPROVAL_REQUIRED" });
        }
        if (message === "request_expired") {
          return res.status(410).json({ error: "REQUEST_EXPIRED" });
        }
        if (message === "invalid_state") {
          return res.status(409).json({ error: "INVALID_STATE" });
        }
        return res.status(404).json({ error: "not_found" });
      }
    }
  );

  router.post(
    "/admin/users/:userId/role",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("users:manage", identityDomain),
    requireMfa,
    requireUserDomain,
    async (req: OrbitRequest, res) => {
      const userId = String(req.params.userId ?? "");
      if (!userId) return res.status(400).json({ error: "invalid_request" });
      const parsed = roleChangeSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        await changeUserRole({
          tenantId: req.tenantId!,
          actorId: req.userId!,
          targetUserId: userId,
          newRole: parsed.data.new_role,
          reason: parsed.data.reason,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });
        return res.status(200).json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "role_not_found") return res.status(404).json({ error: "role_not_found" });
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/admin/users/:userId/lock",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("users:manage", identityDomain),
    requireMfa,
    requireUserDomain,
    async (req: OrbitRequest, res) => {
      const userId = String(req.params.userId ?? "");
      if (!userId) return res.status(400).json({ error: "invalid_request" });
      const parsed = lockUserSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        await lockUserAccount({
          tenantId: req.tenantId!,
          actorId: req.userId!,
          targetUserId: userId,
          reason: parsed.data.reason,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
        });
        return res.status(200).json({ ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post("/connectors/events", apiKeyAuth, tenantResolver, requirePermission("connectors:health"), async (req: OrbitRequest, res) => {
    const idempotencyHeader = req.headers["x-idempotency-key"];
    const idempotencyKeyFromHeader =
      typeof idempotencyHeader === "string" ? idempotencyHeader : Array.isArray(idempotencyHeader) ? (idempotencyHeader[0] ?? null) : null;
    const connectorIdHint = extractConnectorIdHint(req.body ?? {});
    if (req.principal?.auth_type === "api_key" && connectorIdHint) {
      if (req.principal.connector_id && req.principal.connector_id !== connectorIdHint) {
        await auditFromRequest(req, "connectors.events.ingest", "failure", {
          reason: "connector_binding_mismatch",
          key_connector_id: req.principal.connector_id,
          connector_id: connectorIdHint,
        });
        return sendApiError(res, 403, "connector_scope_required", { retryable: false });
      }
      const scopes = req.principal.scope ?? [];
      const connectorScope = `connector:${connectorIdHint}`;
      const connectorEventScope = `connector:${connectorIdHint}:events`;
      const allowed =
        scopes.includes(connectorScope) ||
        scopes.includes(connectorEventScope) ||
        scopes.includes("connector:all") ||
        scopes.includes("connector:*") ||
        (authConfig.allowLegacyConnectorKeys && scopes.includes("connectors:health"));
      if (!allowed) {
        await auditFromRequest(req, "connectors.events.ingest", "failure", {
          reason: "connector_scope_required",
          connector_id: connectorIdHint,
        });
        return sendApiError(res, 403, "connector_scope_required", { retryable: false });
      }
    }
    try {
      if (connectorIdHint) {
        const signaturePolicy = await getWebhookSignaturePolicy(req.tenantId!, connectorIdHint);
        if (signaturePolicy.required && !signaturePolicy.secret) {
          await auditFromRequest(req, "connectors.events.ingest", "failure", {
            reason: "signature_policy_misconfigured",
            connector_id: connectorIdHint,
          });
          return sendApiError(res, 500, "signature_policy_misconfigured", { retryable: false });
        }
        if (signaturePolicy.secret) {
          const rawBody = resolveRawBody(req);
          if (!rawBody) {
            await auditFromRequest(req, "connectors.events.ingest", "failure", {
              reason: "raw_body_unavailable",
              connector_id: connectorIdHint,
            });
            return sendApiError(res, 500, "raw_body_unavailable", { retryable: false });
          }
          const provided = readHeader(req, signaturePolicy.headerName);
          if (!provided) {
            await auditFromRequest(req, "connectors.events.ingest", "failure", {
              reason: "missing_signature",
              signature_header: signaturePolicy.headerName,
              connector_id: connectorIdHint,
            });
            return sendApiError(res, 401, "missing_signature", {
              retryable: false,
              details: { header: signaturePolicy.headerName },
            });
          }
          const valid = verifyWebhookHmac(rawBody, signaturePolicy.secret, provided);
          if (!valid) {
            await auditFromRequest(req, "connectors.events.ingest", "failure", {
              reason: "invalid_signature",
              signature_header: signaturePolicy.headerName,
              connector_id: connectorIdHint,
            });
            return sendApiError(res, 401, "invalid_signature", { retryable: false });
          }
        }
      }
    } catch (error) {
      await auditFromRequest(req, "connectors.events.ingest", "failure", {
        reason: "signature_check_failed",
        connector_id: extractConnectorIdHint(req.body ?? undefined),
        error: error instanceof Error ? error.message : "unknown",
      });
      return sendApiError(res, 500, "signature_check_failed", { retryable: false });
    }

    const normalized = normalizeConnectorEventIngest(req.body ?? {}, idempotencyKeyFromHeader);
    if (!normalized.ok) {
      return sendApiError(res, normalized.status, normalized.error, {
        retryable: false,
        details: normalized.details,
      });
    }
    const ingest = normalized.data;
    if (req.principal?.auth_type === "api_key") {
      if (req.principal.connector_id && req.principal.connector_id !== ingest.connectorId) {
        await auditFromRequest(req, "connectors.events.ingest", "failure", {
          reason: "connector_binding_mismatch",
          key_connector_id: req.principal.connector_id,
          connector_id: ingest.connectorId,
          event_id: ingest.eventId,
        });
        return sendApiError(res, 403, "connector_scope_required", { retryable: false });
      }
      const connectorId = ingest.connectorId;
      const scopes = req.principal.scope ?? [];
      const connectorScope = `connector:${connectorId}`;
      const connectorEventScope = `connector:${connectorId}:events`;
      const allowed =
        scopes.includes(connectorScope) ||
        scopes.includes(connectorEventScope) ||
        scopes.includes("connector:all") ||
        scopes.includes("connector:*") ||
        (authConfig.allowLegacyConnectorKeys && scopes.includes("connectors:health"));
      if (!allowed) {
        await auditFromRequest(req, "connectors.events.ingest", "failure", {
          reason: "connector_scope_required",
          connector_id: connectorId,
        });
        return sendApiError(res, 403, "connector_scope_required", { retryable: false });
      }
    }
    try {
      const result = await ingestConnectorEvent({
        tenantId: req.tenantId!,
        connectorId: ingest.connectorId,
        idempotencyKey: ingest.idempotencyKey,
        payload: {
          ...(ingest.payload ?? {}),
          eventType: ingest.eventType,
          event_id: ingest.eventId,
          occurred_at: ingest.occurredAt,
          meta: ingest.meta,
          ingest_schema: ingest.schema,
        },
      });
      await auditFromRequest(req, "connectors.events.ingest", "success", {
        execution_id: result.execution.id,
        deduplicated: result.deduplicated,
        connector_id: ingest.connectorId,
        event_id: ingest.eventId,
        schema: ingest.schema,
      });
      recordConnectorIngest(ingest.connectorId, result.deduplicated ? "deduplicated" : "accepted");
      return res.status(202).json({
        ok: true,
        execution_id: result.execution.id,
        status: result.execution.status,
        deduplicated: result.deduplicated,
        tenant_id: req.tenantId,
        connector_id: ingest.connectorId,
        event_id: ingest.eventId,
        event_type: ingest.eventType,
        occurred_at: ingest.occurredAt,
      });
    } catch (error) {
      if (error instanceof QueueSaturatedError) {
        res.setHeader("Retry-After", String(error.retryAfterSec));
        recordConnectorIngest(ingest.connectorId, "queue_saturated");
        recordQueueSaturation(req.tenantId!);
        await auditFromRequest(req, "connectors.events.ingest", "failure", {
          reason: "queue_saturated",
          connector_id: ingest.connectorId,
          event_id: ingest.eventId,
          current_depth: error.currentDepth,
          max_depth: error.maxDepth,
        });
        return sendApiError(res, 503, "queue_saturated", {
          retryable: true,
          details: {
            retry_after_sec: error.retryAfterSec,
            current_depth: error.currentDepth,
            max_depth: error.maxDepth,
          },
        });
      }
      await auditFromRequest(req, "connectors.events.ingest", "failure", {
        reason: error instanceof Error ? error.message : "unknown",
        connector_id: ingest.connectorId,
        event_id: ingest.eventId,
      });
      recordConnectorIngest(ingest.connectorId, "error");
      return sendApiError(res, 500, "internal_error", { retryable: true });
    }
  });

  router.post(
    "/admin/connectors/:id/test-connection",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", connectorDomain),
    requireMfa,
    requireConnectorDomain,
    async (req: OrbitRequest, res) => {
      const connectorId = String(req.params.id ?? "");
      if (!connectorId) return res.status(400).json({ error: "invalid_request" });
      try {
        const result = await testConnectorConnection({
          tenantId: req.tenantId!,
          connectorId,
          actorId: req.userId!,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
        if (!result.ok) {
          return res.status(result.httpStatus).json({
            error: "connector_test_failed",
            failed_at: result.failedAt,
            detail: result.error,
          });
        }
        return res.status(200).json({
          ok: true,
          latency_p50_ms: result.latencyP50,
          latency_p95_ms: result.latencyP95,
          latency_p99_ms: result.latencyP99,
          warning: result.warning ?? null,
          latency_trend: result.latencyTrend,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.get(
    "/admin/connectors/:id/config",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", connectorDomain),
    requireMfa,
    requireConnectorDomain,
    async (req: OrbitRequest, res) => {
      const connectorId = String(req.params.id ?? "");
      if (!connectorId) return res.status(400).json({ error: "invalid_request" });
      try {
        const config = await getMaskedConnectorConfig({
          tenantId: req.tenantId!,
          connectorId,
        });
        return res.status(200).json(config);
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.get(
    "/admin/connectors/:id/circuit-breaker",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", connectorDomain),
    requireMfa,
    requireConnectorDomain,
    async (req: OrbitRequest, res) => {
      const connectorId = String(req.params.id ?? "");
      if (!connectorId) return res.status(400).json({ error: "invalid_request" });
      try {
        const breaker = await getCircuitBreakerConfig({ tenantId: req.tenantId!, connectorId });
        return res.status(200).json({ circuit_breaker: breaker });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.get(
    "/admin/connectors/:id/circuit-breaker/events",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", connectorDomain),
    requireMfa,
    requireConnectorDomain,
    async (req: OrbitRequest, res) => {
      const connectorId = String(req.params.id ?? "");
      if (!connectorId) return res.status(400).json({ error: "invalid_request" });
      const parsed = circuitBreakerEventsQuerySchema.safeParse(req.query ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const items = await listCircuitBreakerEvents({
          tenantId: req.tenantId!,
          connectorId,
          limit: parsed.data.limit,
        });
        return res.status(200).json({ items });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.put(
    "/admin/connectors/:id/circuit-breaker",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", connectorDomain),
    requireMfa,
    requireConnectorDomain,
    async (req: OrbitRequest, res) => {
      const connectorId = String(req.params.id ?? "");
      if (!connectorId) return res.status(400).json({ error: "invalid_request" });
      const parsed = circuitBreakerUpdateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const circuit_breaker = await updateCircuitBreakerConfig({
          tenantId: req.tenantId!,
          connectorId,
          actorId: req.userId!,
          updates: parsed.data,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
        return res.status(200).json({ ok: true, circuit_breaker });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/admin/connectors/:id/circuit-breaker/force-open",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", connectorDomain),
    requireMfa,
    requireConnectorDomain,
    async (req: OrbitRequest, res) => {
      const connectorId = String(req.params.id ?? "");
      if (!connectorId) return res.status(400).json({ error: "invalid_request" });
      const parsed = circuitBreakerForceSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const circuit_breaker = await forceCircuitBreakerState({
          tenantId: req.tenantId!,
          connectorId,
          actorId: req.userId!,
          forcedState: "open",
          reason: parsed.data.reason,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
        return res.status(200).json({ ok: true, circuit_breaker });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/admin/connectors/:id/circuit-breaker/force-close",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("connectors:manage", connectorDomain),
    requireMfa,
    requireConnectorDomain,
    async (req: OrbitRequest, res) => {
      const connectorId = String(req.params.id ?? "");
      if (!connectorId) return res.status(400).json({ error: "invalid_request" });
      const parsed = circuitBreakerForceSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });
      try {
        const circuit_breaker = await forceCircuitBreakerState({
          tenantId: req.tenantId!,
          connectorId,
          actorId: req.userId!,
          forcedState: "closed",
          reason: parsed.data.reason,
          ipAddress: req.ip,
          userAgent: req.headers["user-agent"],
        });
        return res.status(200).json({ ok: true, circuit_breaker });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.post(
    "/admin/keypairs/rotate",
    jwtAuth,
    requirePlatformAdmin,
    requirePermissionWithPolicy("access:review", platformDomain),
    requireMfa,
    async (req: OrbitRequest, res) => {
      const parsed = keypairRotateSchema.safeParse(req.body ?? {});
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

      const maxTokenTtlSec = 15 * 60;
      const result = await rotateSigningKeypair({
        type: parsed.data.type,
        retireAfterSec: maxTokenTtlSec,
        actorId: req.userId ?? null,
      });

      await writeAuditLog({
        tenantId: req.tenantId ?? null,
        userId: req.userId ?? null,
        actorType: "user",
        actorId: req.userId ?? "unknown",
        action: "keypair.rotated",
        status: "success",
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: {
          kid_old: result.oldKid,
          kid_new: result.newKid,
          type: parsed.data.type,
        },
      });

      return res.status(200).json({
        ok: true,
        kid_old: result.oldKid,
        kid_new: result.newKid,
        old_key_removal_after: new Date(Date.now() + maxTokenTtlSec * 1000).toISOString(),
      });
    }
  );

  router.get(
    "/admin/users/:userId/sessions",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("users:manage", identityDomain),
    requireMfa,
    requireUserDomain,
    async (req: OrbitRequest, res) => {
      const userId = String(req.params.userId ?? "");
      if (!userId) return res.status(400).json({ error: "invalid_request" });
      try {
        const sessions = await listActiveSessions({
          tenantId: req.tenantId!,
          userId,
        });
        return res.status(200).json({ items: sessions });
      } catch (error) {
        const message = error instanceof Error ? error.message : "internal_error";
        if (message === "not_found") return res.status(404).json({ error: "not_found" });
        return res.status(500).json({ error: "internal_error" });
      }
    }
  );

  router.delete(
    "/admin/users/:userId/sessions/:family",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("users:manage", identityDomain),
    requireMfa,
    requireUserDomain,
    async (req: OrbitRequest, res) => {
      const userId = String(req.params.userId ?? "");
      const family = String(req.params.family ?? "");
      if (!userId || !family) return res.status(400).json({ error: "invalid_request" });
      const revoked = await revokeSessionFamily({
        tenantId: req.tenantId!,
        userId,
        family,
        actorId: req.userId!,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      if (!revoked) return res.status(404).json({ error: "not_found" });
      return res.status(200).json({ ok: true, revoked });
    }
  );

  router.delete(
    "/admin/users/:userId/sessions",
    jwtAuth,
    tenantResolver,
    requirePermissionWithPolicy("users:manage", identityDomain),
    requireMfa,
    requireUserDomain,
    async (req: OrbitRequest, res) => {
      const userId = String(req.params.userId ?? "");
      if (!userId) return res.status(400).json({ error: "invalid_request" });
      const revoked = await revokeAllSessions({
        tenantId: req.tenantId!,
        userId,
        actorId: req.userId!,
        ipAddress: req.ip,
        userAgent: req.headers["user-agent"],
      });
      return res.status(200).json({ ok: true, revoked });
    }
  );

  router.get("/internal/system/healthz", internalAuth, requireInternalScope("internal:health"), async (req: OrbitRequest, res) => {
    await auditFromRequest(req, "internal.system.healthz", "success");
    return res.json({ ok: true, resource: "internal:healthz" });
  });

  router.get("/internal/redis/health", internalAuth, requireInternalScope("internal:health"), async (req: OrbitRequest, res) => {
    const snapshot = getRedisHealthSnapshot();
    await auditFromRequest(req, "internal.redis.health.read", "success", {
      healthy: snapshot.healthy,
      mode: snapshot.topology.mode,
      candidate_count: snapshot.topology.candidate_count,
    });
    return res.status(snapshot.healthy ? 200 : 503).json({ ok: snapshot.healthy, redis: snapshot });
  });

  // Audit Retention Policy endpoints (internal/admin only)
  router.get(
    "/internal/audit/retention/stats",
    internalAuth,
    requireInternalScope("internal:audit"),
    async (req: OrbitRequest, res) => {
      try {
        const stats = await getAuditRetentionStats();
        await auditFromRequest(req, "audit.retention.stats_viewed", "success");
        return res.status(200).json({ stats });
      } catch (error) {
        await auditFromRequest(req, "audit.retention.stats_viewed", "failure", { error: String(error) });
        return sendApiError(res, 500, "retention_stats_failed", { message: String(error) });
      }
    }
  );

  router.post(
    "/internal/audit/retention/cleanup",
    internalAuth,
    requireInternalScope("internal:audit"),
    async (req: OrbitRequest, res) => {
      try {
        const result = await cleanupExpiredAuditLogs();
        await auditFromRequest(req, "audit.retention.cleanup_triggered", "success", result as unknown as Record<string, unknown>);
        return res.status(200).json({ ok: true, result });
      } catch (error) {
        await auditFromRequest(req, "audit.retention.cleanup_triggered", "failure", { error: String(error) });
        return sendApiError(res, 500, "retention_cleanup_failed", { message: String(error) });
      }
    }
  );

  // Alert Routing endpoints (internal only)
  router.get(
    "/internal/alerts/rules",
    internalAuth,
    requireInternalScope("internal:alerts"),
    async (req: OrbitRequest, res) => {
      try {
        const rules = await listAlertRules(req.tenantId);
        await auditFromRequest(req, "alerts.rules_listed", "success");
        return res.status(200).json({ rules });
      } catch (error) {
        await auditFromRequest(req, "alerts.rules_listed", "failure", { error: String(error) });
        return sendApiError(res, 500, "alerts_list_failed", { message: String(error) });
      }
    }
  );

  router.post(
    "/internal/alerts/rules",
    internalAuth,
    requireInternalScope("internal:alerts"),
    async (req: OrbitRequest, res) => {
      const schema = z.object({
        alert_type: z.string().min(1),
        channel: z.enum(["webhook", "email", "slack", "pagerduty"]),
        endpoint: z.string().url(),
        severity_min: z.enum(["P0", "P1", "P2"]).optional(),
        enabled: z.boolean().optional(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

      try {
        const ruleId = await upsertAlertRule({
          tenantId: req.tenantId,
          alertType: parsed.data.alert_type,
          channel: parsed.data.channel,
          endpoint: parsed.data.endpoint,
          severity_min: parsed.data.severity_min,
          enabled: parsed.data.enabled,
        });
        await auditFromRequest(req, "alerts.rule_created", "success", { rule_id: ruleId });
        return res.status(201).json({ ok: true, rule_id: ruleId });
      } catch (error) {
        await auditFromRequest(req, "alerts.rule_created", "failure", { error: String(error) });
        return sendApiError(res, 500, "alerts_rule_create_failed", { message: String(error) });
      }
    }
  );

  router.delete(
    "/internal/alerts/rules/:ruleId",
    internalAuth,
    requireInternalScope("internal:alerts"),
    async (req: OrbitRequest, res) => {
      const ruleId = String(req.params.ruleId ?? "");
      if (!ruleId) return res.status(400).json({ error: "invalid_request" });

      try {
        const deleted = await deleteAlertRule(ruleId);
        if (!deleted) return res.status(404).json({ error: "not_found" });

        await auditFromRequest(req, "alerts.rule_deleted", "success", { rule_id: ruleId });
        return res.status(200).json({ ok: true });
      } catch (error) {
        await auditFromRequest(req, "alerts.rule_deleted", "failure", { error: String(error) });
        return sendApiError(res, 500, "alerts_rule_delete_failed", { message: String(error) });
      }
    }
  );

  router.post(
    "/internal/alerts/test",
    internalAuth,
    requireInternalScope("internal:alerts"),
    async (req: OrbitRequest, res) => {
      const schema = z.object({
        channel: z.enum(["webhook", "email", "slack", "pagerduty"]),
        endpoint: z.string().url(),
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "invalid_request" });

      try {
        const success = await testAlertRoute(parsed.data.channel, parsed.data.endpoint);
        if (!success) {
          await auditFromRequest(req, "alerts.test_failed", "failure");
          return res.status(400).json({ ok: false, error: "test_failed" });
        }

        await auditFromRequest(req, "alerts.test_succeeded", "success");
        return res.status(200).json({ ok: true, message: "Test alert sent successfully" });
      } catch (error) {
        await auditFromRequest(req, "alerts.test_failed", "failure", { error: String(error) });
        return sendApiError(res, 500, "alerts_test_failed", { message: String(error) });
      }
    }
  );

  return router;
}
