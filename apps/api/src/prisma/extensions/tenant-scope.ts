import { Prisma } from "@prisma/client";
import { applyProductSoftDeleteScope } from "../../common/prisma-soft-delete.middleware";

const TENANT_FIELD = "tenantKey";

const TENANT_SCOPED_MODELS = new Set<string>([
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
  "OndcMapping",
  "PlanUsage",
  "UserNotification",
  "AccountConsentEvent",
  "AccountExportRequest",
  "AccountDeletionRequest",
  "ApprovalComment",
]);

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

          const baseArgs: JsonRecord = isRecord(args) ? { ...args } : {};
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
