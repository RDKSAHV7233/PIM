import { Prisma } from "@prisma/client";
import { applyProductSoftDeleteScope } from "../../common/prisma-soft-delete.middleware";

const TENANT_FIELD = "tenantKey";

// Exported so tenant-scope.spec.ts can assert this set stays in sync with
// every `tenantKey` field declared in schema.prisma (see SEC-001 remediation).
export const TENANT_SCOPED_MODELS = new Set<string>([
  "AuthIdentity",
  "Category",
  "Product",
  "Variant",
  "AttributeDefinition",
  "ComplianceRule",
  "ValidationIssue",
  "ChannelMappingTemplate",
  "MarketplaceExportJob",
  "BulkImportJob",
  "BulkImportRow",
  "BulkEditOperation",
  "BulkEditOperationItem",
  "MarketplaceBulkPublishRun",
  "MarketplaceBulkPublishRunItem",
  "BulkImportTemplate",
  "AuditLog",
  "DashboardSnapshot",
  "KpiMetricEvent",
  "MediaAsset",
  "ConnectorInstallation",
  "ConnectorCredential",
  "ConnectorSubmission",
  "ConnectorMappingVersion",
  "ConnectorMappingEvent",
  "ConnectorWebhookEvent",
  "TenantPlanProfile",
  "ConnectorPermission",
  "AccessScopeAssignment",
  "PlanUsage",
  "UserNotification",
  "AccountConsentEvent",
  "AccountExportRequest",
  "AccountDeletionRequest",
  "ApprovalComment",
  // Sprint 2 additions — these models have no manual tenantKey injection
  // and rely entirely on this extension for tenant isolation.
  "ChangeRequest",      // requestChanges / listChangeRequests / resolveChangeRequest
  "ProductRelationship", // createRelationship / listRelationships / deleteRelationship (defense in depth)
  "WorkflowSla",        // upsertWorkflowSla / getWorkflowSla (defense in depth)
  // Missing from initial set — confirmed present in schema.prisma.
  "BulkImportRun",
  "AuthRecoveryToken",
  "UserMfaEnrollment",
  "ConnectorSyncSchedule",
  "ConnectorProductLink",
  "TenantCommercialRequest",
  // CTO review remediation (SEC-001) — these models were tenantKey-scoped in
  // schema.prisma but relied entirely on manual per-service filtering with no
  // extension-level safety net. See schema-drift.spec.ts for the CI guard
  // that keeps this set in sync with schema.prisma going forward.
  "ApiAccessKey",
  "OutboundWebhookEndpoint",
  "ProductPrice",
  "OidcConfig",
  "TenantAuthPolicy",
  // Found by the tenant-scope.spec.ts drift guard when it was first added —
  // these had a tenantKey column but were never in this set at all.
  "UserMfaBackupCode",
  "ConnectorProductSyncState",
  "OutboundWebhookDelivery",
  "Market",
  "Currency",
  "PriceList",
  "ProductTranslation",
  "CategoryTranslation",
  "ProductTaxCode",
  "AiExecution",
  "AiSuggestion",
  "AiTenantPolicy",
]);

/**
 * Models with a `tenantKey` column that are DELIBERATELY excluded from
 * TENANT_SCOPED_MODELS, with the reason each is excluded. The drift-guard
 * test (tenant-scope.spec.ts) treats these as satisfied rather than missing.
 *
 * Add a model here ONLY when you've confirmed every call site that needs
 * cross-tenant access already goes through prismaDirect (bypassing this
 * extension entirely) or an explicit non-default tenant() call — see
 * WorkspaceDirectory below for the incident that established this rule.
 */
export const INTENTIONALLY_UNSCOPED_MODELS: Record<string, string> = {
  // WorkspaceDirectory maps workspaceSlug -> tenantKey and must be queryable
  // BEFORE a tenant is known (that's the whole point of a directory table).
  // TenantDirectoryService.resolveWorkspaceSlug()/resolveTenantAlias() query
  // it via `prisma.tenant(DEFAULT_TENANT_KEY).workspaceDirectory...` — adding
  // this model to TENANT_SCOPED_MODELS made the extension silently restamp
  // every lookup to tenantKey="default", breaking login for every non-default
  // tenant (surfaced as WORKSPACE_NOT_FOUND in CI). Writes to this table
  // (TenantDirectoryService.provisionWorkspace) already bypass the extension
  // via PrismaDirectService for the same cross-tenant reason.
  WorkspaceDirectory:
    "cross-tenant directory table, queried via prisma.tenant(DEFAULT_TENANT_KEY) by design — see TenantDirectoryService",
  // Platform-level Stripe webhook dedup ledger. StripeService never goes through
  // the Prisma Client model API for this table (no prisma.stripeWebhookEvent.*
  // call exists) — every access is queryRaw/executeRaw against
  // stripe_webhook_events directly, so this extension never intercepts it
  // either way. tenant_key itself is nullable and populated only after the
  // tenant is resolved (dedup must happen per Stripe event id across the whole
  // platform, before that). Listing it here (rather than in
  // TENANT_SCOPED_MODELS) reflects that reality instead of implying a
  // protection this extension doesn't actually provide. See the matching
  // exemption in scripts/verify-tenant-rls.cjs.
  StripeWebhookEvent:
    "platform-level Stripe dedup ledger, accessed only via raw SQL in StripeService — never through this extension's model API",
};

const FILTER_WHERE_OPERATIONS = new Set<string>([
  "count",
  "aggregate",
  "groupBy",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "updateMany",
  "deleteMany",
]);

const UNIQUE_WHERE_OPERATIONS = new Set<string>([
  "findUnique",
  "findUniqueOrThrow",
  "update",
  "delete",
  "upsert",
]);

const OPERATIONS_WITH_DATA = new Set<string>(["create", "createMany", "createManyAndReturn", "update", "updateMany"]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeWhereWithTenant(where: unknown, tenantKey: string): JsonRecord {
  if (isRecord(where)) {
    return {
      AND: [
        where,
        {
          [TENANT_FIELD]: tenantKey,
        },
      ],
    };
  }
  return {
    [TENANT_FIELD]: tenantKey,
  };
}

function mergeUniqueWhereWithTenant(where: unknown, tenantKey: string): JsonRecord {
  if (isRecord(where)) {
    return {
      ...where,
      [TENANT_FIELD]: tenantKey,
    };
  }
  return {
    [TENANT_FIELD]: tenantKey,
  };
}

function applyTenantToData(data: unknown, tenantKey: string): unknown {
  if (Array.isArray(data)) {
    return data.map((item) =>
      isRecord(item)
        ? {
            ...item,
            [TENANT_FIELD]: tenantKey,
          }
        : item,
    );
  }
  if (isRecord(data)) {
    return {
      ...data,
      [TENANT_FIELD]: tenantKey,
    };
  }
  return data;
}

export function createTenantScopeExtension(tenantKey: string) {
  return Prisma.defineExtension({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }

          // Cast through `unknown` to avoid TS2590 ("union type too complex") when
          // the Prisma schema grows — $allOperations args is a large discriminated union.
          const rawArgs: unknown = args;
          const baseArgs: JsonRecord = isRecord(rawArgs) ? { ...rawArgs } : {};
          const nextArgs = applyProductSoftDeleteScope(model, operation, baseArgs);

          if (FILTER_WHERE_OPERATIONS.has(operation)) {
            nextArgs.where = mergeWhereWithTenant(nextArgs.where, tenantKey);
          }

          if (UNIQUE_WHERE_OPERATIONS.has(operation)) {
            nextArgs.where = mergeUniqueWhereWithTenant(nextArgs.where, tenantKey);
          }

          if (OPERATIONS_WITH_DATA.has(operation)) {
            nextArgs.data = applyTenantToData(nextArgs.data, tenantKey);
          }

          if (operation === "upsert") {
            nextArgs.create = applyTenantToData(nextArgs.create, tenantKey);
            nextArgs.update = applyTenantToData(nextArgs.update, tenantKey);
          }

          return query(nextArgs);
        },
      },
    },
  });
}
