import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../../audit/audit.service";
import { parseMarketplaceChannel, type MarketplaceChannel } from "../../marketplace/marketplace-channels";
import { PrismaService } from "../../prisma/prisma.service";
import {
  type AuthenticatedReadClassification,
  READ_ACCESS_POLICY_REASON_CODES,
  type ReadAccessPolicyId,
  readAccessPolicyReasonCode,
} from "../rbac/read-access-policy.decorator";
import {
  normalizeApiClientScopes,
  type ApiClientRoutePolicy,
  type ApiClientScope,
} from "../rbac/api-client-policy.decorator";
import { AppRole, APP_ROLES } from "../rbac/roles";

export type PolicyActor = {
  actorId?: string | null;
  actorRole?: AppRole | null;
  tenantId?: string | null;
  actorType?: PolicyActorType | null;
  apiScopes?: string[] | null;
};

export type PolicyActorType = "human" | "api_client" | "system";
export type ScopeAssignmentSubjectType = "user" | "role";
export type ScopeAssignmentType =
  | "category"
  | "brand"
  | "channel"
  | "connector_account"
  | "vendor"
  | "owner"
  | "supplier"
  | "locale"
  | "market"
  | "catalog"
  | "team"
  | "assignee";
export type ScopeAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "archive"
  | "approve"
  | "reject"
  | "publish"
  | "unpublish"
  | "import"
  | "export"
  | "bulk_edit"
  | "preview_connector_payload"
  | "manage_connector"
  | "manage_users"
  | "manage_settings"
  | "view_audit_logs";

type DenyInput = {
  actor: PolicyActor;
  reasonCode: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  fields?: string[];
  metadata?: Record<string, unknown>;
};

export type PolicyDecision = {
  allowed: boolean;
  reasonCode: string;
  actorType: PolicyActorType;
  action: string;
  resource: string;
  resourceId?: string | null;
  tenantId?: string | null;
  context?: Record<string, unknown>;
};

export type AccessPolicyDecisionContext = {
  method?: string | null;
  path?: string | null;
  requiredRoles?: readonly AppRole[] | null;
  defaultReadAllowed?: boolean;
  defaultWriteRoles?: readonly AppRole[] | null;
  disallowApiClient?: boolean;
  readAccessPolicy?: ReadAccessPolicyId | null;
  readClassification?: AuthenticatedReadClassification | null;
  apiClientPolicy?: ApiClientRoutePolicy | null;
  requiredApiClientScopes?: readonly ApiClientScope[] | null;
  metadata?: Record<string, unknown>;
};

type ScopeAssignmentRecord = {
  id: string;
  tenantKey: string;
  subjectType: ScopeAssignmentSubjectType;
  subjectId: string;
  scopeType: ScopeAssignmentType;
  categoryId: string | null;
  connectorInstallationId: string | null;
  scopeValue: string | null;
  actions: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  categoryPath?: string | null;
  connectorAccountAlias?: string | null;
  connectorSlug?: string | null;
};

type CreateScopeAssignmentInput = {
  subjectType: ScopeAssignmentSubjectType;
  subjectId: string;
  scopeType: ScopeAssignmentType;
  categoryId?: string | null;
  connectorInstallationId?: string | null;
  scopeValue?: string | null;
  actions?: ScopeAction[] | string[] | null;
};

type ProductScopeCandidate = {
  categoryId?: string | null;
  brand?: string | null;
};

type ConnectorScopeCandidate = {
  installationId?: string | null;
  channel?: string | null;
  connectorSlug?: string | null;
  accountAlias?: string | null;
};

type DashboardHealthSnapshotPayload = {
  capturedAt: string;
  totalSkus: number;
  completeSkus: number;
  incompleteSkus: number;
  publishReadyByConnector: Record<string, number>;
  blockedByConnector: Record<string, number>;
  rejectionRiskHigh: number;
  openIssuesBlocking: number;
  openIssuesWarning: number;
};

type DashboardHealthPayload = {
  snapshot: DashboardHealthSnapshotPayload;
  trend: DashboardHealthSnapshotPayload[];
  asOf: string;
  pendingApprovals: number;
  publishReadyTotal?: number;
  blockedTotal?: number;
  redactedSections?: string[];
};

type CatalogStatsPayload = {
  categories: number;
  products: number;
  variants: number;
  pendingApprovals: number;
  redactedSections?: string[];
};

const RESTRICTED_VARIANT_FIELDS = ["sku", "mrp", "sellingPrice", "inventoryQty", "status"] as const;
const RESTRICTED_PRODUCT_ATTRIBUTE_FIELDS = [
  "pricing.mrp",
  "pricing.sellingPrice",
  "mrp",
  "sellingPrice",
  "selling_price",
  "price",
  "cost",
  "sku",
  "inventoryQty",
] as const;
const RESTRICTED_PRODUCT_READ_ATTRIBUTE_FIELDS = [
  "pricing.mrp",
  "pricing.sellingPrice",
  "pricing.cost",
  "pricing.margin",
  "pricing.inventoryQty",
  "mrp",
  "sellingPrice",
  "selling_price",
  "price",
  "cost",
  "margin",
  "inventoryQty",
] as const;
const RESTRICTED_BULK_EDIT_FIELDS = ["status"] as const;
const RESTRICTED_IMPORT_FIELDS = ["status"] as const;
const SCOPE_ACTIONS: readonly ScopeAction[] = [
  "view",
  "create",
  "edit",
  "delete",
  "archive",
  "approve",
  "reject",
  "publish",
  "unpublish",
  "import",
  "export",
  "bulk_edit",
  "preview_connector_payload",
  "manage_connector",
  "manage_users",
  "manage_settings",
  "view_audit_logs",
] as const;
const SUPPORTED_SCOPE_ASSIGNMENT_TYPES: readonly ScopeAssignmentType[] = ["category", "brand", "channel", "connector_account"] as const;
const FOUNDATION_SCOPE_ASSIGNMENT_TYPES: readonly ScopeAssignmentType[] = [
  "vendor",
  "owner",
  "supplier",
  "locale",
  "market",
  "catalog",
  "team",
  "assignee",
] as const;
const NOTIFICATION_METADATA_ALLOWLIST = new Set([
  "productId",
  "bulkJobId",
  "exportJobId",
  "channel",
  "status",
  "failedRows",
  "deadLetterRows",
  "totalRows",
]);

function normalizeSubjectType(value: string | null | undefined): ScopeAssignmentSubjectType {
  return String(value ?? "").trim().toLowerCase() === "role" ? "role" : "user";
}

function normalizeScopeType(value: string | null | undefined): ScopeAssignmentType {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "category" ||
    normalized === "brand" ||
    normalized === "channel" ||
    normalized === "connector_account" ||
    normalized === "vendor" ||
    normalized === "owner" ||
    normalized === "supplier" ||
    normalized === "locale" ||
    normalized === "market" ||
    normalized === "catalog" ||
    normalized === "team" ||
    normalized === "assignee"
  ) {
    return normalized;
  }
  throw new NotFoundException("Unsupported scope type.");
}

function normalizeScopeActions(actions: ScopeAction[] | string[] | null | undefined): ScopeAction[] {
  const normalized = Array.from(
    new Set(
      (Array.isArray(actions) ? actions : [])
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  );
  for (const action of normalized) {
    if (!SCOPE_ACTIONS.includes(action as ScopeAction)) {
      throw new ForbiddenException({
        error: "ACCESS_SCOPE_ACTION_INVALID",
        action,
      });
    }
  }
  return normalized as ScopeAction[];
}

function normalizeUserId(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeRole(value: string | null | undefined): AppRole {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (APP_ROLES.includes(normalized as AppRole)) {
    return normalized as AppRole;
  }
  return "viewer";
}

function normalizeActorType(value: PolicyActorType | string | null | undefined): PolicyActorType {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "api_client" || normalized === "system") {
    return normalized;
  }
  return "human";
}

function normalizeBrand(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeChannel(value: string | null | undefined): MarketplaceChannel {
  return parseMarketplaceChannel(String(value ?? "").trim());
}

function channelFromConnectorSlug(slug: string | null | undefined): MarketplaceChannel | null {
  const normalized = String(slug ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  try {
    return normalizeChannel(normalized);
  } catch {
    return null;
  }
}

function mergeWhere<T extends Record<string, unknown>>(left: T | undefined, right: T | undefined): T | undefined {
  if (left && right) {
    return { AND: [left, right] } as unknown as T;
  }
  return left ?? right;
}

@Injectable()
export class AccessPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  can(
    actor: PolicyActor,
    action: string,
    resource: string,
    context: AccessPolicyDecisionContext = {},
  ): PolicyDecision {
    const actorRole = normalizeRole(actor.actorRole);
    const actorType = normalizeActorType(actor.actorType);
    const requiredRoles = Array.isArray(context.requiredRoles) ? context.requiredRoles : [];
    const method = String(context.method ?? "").trim().toUpperCase();
    const defaultReadAllowed = context.defaultReadAllowed === true;
    const defaultWriteRoles = Array.isArray(context.defaultWriteRoles) ? context.defaultWriteRoles : [];
    const readAccessPolicy = this.normalizeReadAccessPolicy(context.readAccessPolicy);
    const readClassification = context.readClassification ?? null;
    const apiClientPolicy = context.apiClientPolicy ?? null;
    const requiredApiClientScopes = Array.isArray(context.requiredApiClientScopes)
      ? normalizeApiClientScopes(context.requiredApiClientScopes)
      : [];
    const grantedApiClientScopes = normalizeApiClientScopes(actor.apiScopes ?? []);

    if (actorType === "api_client") {
      if (apiClientPolicy === "allowed_with_api_scope") {
        if (requiredApiClientScopes.length === 0) {
          return this.buildDecision(false, "API_CLIENT_SCOPE_REQUIRED", actor, actorType, action, resource, context);
        }
        const allowed = requiredApiClientScopes.some((scope) => grantedApiClientScopes.includes(scope));
        if (!allowed) {
          return this.buildDecision(false, "API_CLIENT_SCOPE_FORBIDDEN", actor, actorType, action, resource, context);
        }
      } else if (apiClientPolicy === "allowed_service_internal") {
        return this.buildDecision(false, "API_CLIENT_SERVICE_INTERNAL_ONLY", actor, actorType, action, resource, context);
      } else if (apiClientPolicy === "not_applicable") {
        return this.buildDecision(false, "API_CLIENT_NOT_APPLICABLE", actor, actorType, action, resource, context);
      } else if (requiredApiClientScopes.length > 0) {
        return this.buildDecision(false, "API_CLIENT_SCOPE_NOT_APPLICABLE", actor, actorType, action, resource, context);
      } else if (context.disallowApiClient || apiClientPolicy === "denied_human_only" || apiClientPolicy === null) {
        return this.buildDecision(false, "API_CLIENT_FORBIDDEN", actor, actorType, action, resource, context);
      }
    }

    if (requiredRoles.length > 0) {
      return this.buildDecision(
        requiredRoles.includes(actorRole),
        requiredRoles.includes(actorRole) ? "ROLE_ALLOWED" : "ROLE_FORBIDDEN",
        actor,
        actorType,
        action,
        resource,
        context,
      );
    }

    if (readAccessPolicy && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
      return this.buildDecision(
        true,
        readAccessPolicyReasonCode(readAccessPolicy),
        actor,
        actorType,
        action,
        resource,
        context,
      );
    }

    if (readClassification && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
      return this.buildDecision(
        true,
        `READ_CLASSIFIED_${String(readClassification).toUpperCase()}`,
        actor,
        actorType,
        action,
        resource,
        context,
      );
    }

    if (defaultReadAllowed && (method === "GET" || method === "HEAD" || method === "OPTIONS")) {
      return this.buildDecision(true, "DEFAULT_READ_ALLOWED", actor, actorType, action, resource, context);
    }

    if (defaultWriteRoles.length > 0) {
      return this.buildDecision(
        defaultWriteRoles.includes(actorRole),
        defaultWriteRoles.includes(actorRole) ? "DEFAULT_WRITE_ALLOWED" : "WRITE_ROLE_REQUIRED",
        actor,
        actorType,
        action,
        resource,
        context,
      );
    }

    return this.buildDecision(false, "NO_POLICY_MATCH", actor, actorType, action, resource, context);
  }

  async recordShadowMismatch(input: {
    actor: PolicyActor;
    legacyDecision: PolicyDecision;
    policyDecision: PolicyDecision;
  }): Promise<void> {
    await this.auditService.record({
      actorId: input.actor.actorId ?? "unknown",
      actorRole: input.actor.actorRole ?? "viewer",
      action: "POLICY_SHADOW_MISMATCH",
      resource: input.policyDecision.resource,
      resourceId: input.policyDecision.resourceId ?? undefined,
      tenantKey: input.actor.tenantId ?? undefined,
      metadata: {
        result: "shadow_mismatch",
        tenantId: input.actor.tenantId ?? null,
        action: input.policyDecision.action,
        resource: input.policyDecision.resource,
        path: input.policyDecision.context?.path ?? null,
        method: input.policyDecision.context?.method ?? null,
        legacyAllowed: input.legacyDecision.allowed,
        legacyReasonCode: input.legacyDecision.reasonCode,
        policyAllowed: input.policyDecision.allowed,
        policyReasonCode: input.policyDecision.reasonCode,
        actorType: input.policyDecision.actorType,
      },
    });
  }

  async listScopeAssignments(
    tenantId: string,
    filters?: {
      subjectType?: ScopeAssignmentSubjectType;
      subjectId?: string;
    },
  ): Promise<ScopeAssignmentRecord[]> {
    const rows = await this.prisma.tenant(tenantId).accessScopeAssignment.findMany({
      where: {
        ...(filters?.subjectType ? { subjectType: normalizeSubjectType(filters.subjectType) } : {}),
        ...(filters?.subjectId
          ? {
              subjectId:
                filters.subjectType === "role"
                  ? normalizeRole(filters.subjectId)
                  : normalizeUserId(filters.subjectId),
            }
          : {}),
      },
      include: {
        category: {
          select: {
            path: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    const connectorIds = rows
      .map((row) => row.connectorInstallationId)
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    const connectors = connectorIds.length > 0
      ? await this.prisma.tenant(tenantId).connectorInstallation.findMany({
          where: { id: { in: connectorIds } },
          select: {
            id: true,
            accountAlias: true,
            connectorId: true,
          },
        })
      : [];
    const connectorDefinitions = connectors.length > 0
      ? await this.prisma.tenant(tenantId).connectorDefinition.findMany({
          where: {
            id: {
              in: connectors.map((connector) => connector.connectorId),
            },
          },
          select: {
            id: true,
            slug: true,
          },
        })
      : [];
    const connectorById = new Map(connectors.map((row) => [row.id, row]));
    const definitionById = new Map(connectorDefinitions.map((row) => [row.id, row.slug]));

    return rows.map((row) => {
      const connector = row.connectorInstallationId ? connectorById.get(row.connectorInstallationId) : null;
      return {
        id: row.id,
        tenantKey: row.tenantKey,
        subjectType: row.subjectType as ScopeAssignmentSubjectType,
        subjectId: row.subjectId,
        scopeType: row.scopeType as ScopeAssignmentType,
        categoryId: row.categoryId,
        connectorInstallationId: row.connectorInstallationId,
        scopeValue: row.scopeValue,
        actions: row.actions,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        categoryPath: row.category?.path ?? null,
        connectorAccountAlias: connector?.accountAlias ?? null,
        connectorSlug: connector ? definitionById.get(connector.connectorId) ?? null : null,
      };
    });
  }

  async createScopeAssignment(
    tenantId: string,
    actor: PolicyActor,
    input: CreateScopeAssignmentInput,
  ): Promise<ScopeAssignmentRecord> {
    const normalizedTenantId = String(tenantId ?? "").trim();
    const subjectType = normalizeSubjectType(input.subjectType);
    const subjectId = subjectType === "role" ? normalizeRole(input.subjectId) : normalizeUserId(input.subjectId);
    const scopeType = normalizeScopeType(input.scopeType);
    const actions = normalizeScopeActions(input.actions);

    if (!subjectId) {
      throw new ForbiddenException({ error: "ACCESS_SCOPE_SUBJECT_REQUIRED" });
    }

    if (subjectType === "user") {
      const user = await this.prisma.tenant(normalizedTenantId).authIdentity.findFirst({
        where: {
          tenantKey: normalizedTenantId,
          userId: subjectId,
        },
        select: { id: true },
      });
      if (!user) {
        throw new NotFoundException("Workspace user not found for scope assignment.");
      }
    }

    let categoryId: string | null = null;
    let connectorInstallationId: string | null = null;
    let scopeValue: string | null = null;

    if (FOUNDATION_SCOPE_ASSIGNMENT_TYPES.includes(scopeType)) {
      throw new ForbiddenException({
        error: "ACCESS_SCOPE_DIMENSION_REQUIRES_ENFORCEMENT",
        scopeType,
        supportedForStorage: true,
        supportedForEnforcement: false,
      });
    }

    if (scopeType === "category") {
      categoryId = String(input.categoryId ?? "").trim();
      if (!categoryId) {
        throw new ForbiddenException({ error: "ACCESS_SCOPE_CATEGORY_REQUIRED" });
      }
      const category = await this.prisma.tenant(normalizedTenantId).category.findUnique({
        where: { id: categoryId },
        select: { id: true },
      });
      if (!category) {
        throw new NotFoundException("Category not found for scope assignment.");
      }
    } else if (scopeType === "brand") {
      scopeValue = normalizeBrand(input.scopeValue);
      if (!scopeValue) {
        throw new ForbiddenException({ error: "ACCESS_SCOPE_BRAND_REQUIRED" });
      }
    } else if (scopeType === "channel") {
      scopeValue = normalizeChannel(input.scopeValue);
    } else if (scopeType === "connector_account") {
      connectorInstallationId = String(input.connectorInstallationId ?? "").trim();
      if (!connectorInstallationId) {
        throw new ForbiddenException({ error: "ACCESS_SCOPE_CONNECTOR_ACCOUNT_REQUIRED" });
      }
      const installation = await this.prisma.tenant(normalizedTenantId).connectorInstallation.findUnique({
        where: { id: connectorInstallationId },
        select: {
          id: true,
          accountAlias: true,
        },
      });
      if (!installation) {
        throw new NotFoundException("Connector account not found for scope assignment.");
      }
      scopeValue = installation.accountAlias;
    }

    const created = await this.prisma.tenant(normalizedTenantId).accessScopeAssignment.create({
      data: {
        tenantKey: normalizedTenantId,
        subjectType,
        subjectId,
        scopeType,
        categoryId,
        connectorInstallationId,
        scopeValue,
        actions,
        createdBy: actor.actorId?.trim() ? actor.actorId.trim() : null,
      },
    });

    await this.auditService.record({
      actorId: actor.actorId ?? "unknown",
      actorRole: actor.actorRole ?? "viewer",
      action: "access_scope_assignment.created",
      resource: "AccessScopeAssignment",
      resourceId: created.id,
      metadata: {
        subjectType,
        subjectId,
        scopeType,
        categoryId,
        connectorInstallationId,
        scopeValue,
        actions,
        tenantId: actor.tenantId ?? normalizedTenantId,
      },
    });

    const [assignment] = await this.listScopeAssignments(normalizedTenantId, {
      subjectType,
      subjectId,
    }).then((rows) => rows.filter((row) => row.id === created.id));
    return assignment ?? {
      id: created.id,
      tenantKey: created.tenantKey,
      subjectType,
      subjectId,
      scopeType,
      categoryId: created.categoryId,
      connectorInstallationId: created.connectorInstallationId,
      scopeValue: created.scopeValue,
      actions: created.actions,
      createdBy: created.createdBy,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async deleteScopeAssignment(tenantId: string, assignmentId: string, actor: PolicyActor) {
    const existing = await this.prisma.tenant(tenantId).accessScopeAssignment.findUnique({
      where: { id: assignmentId },
    });
    if (!existing) {
      throw new NotFoundException("Access scope assignment not found.");
    }
    await this.prisma.tenant(tenantId).accessScopeAssignment.delete({
      where: { id: assignmentId },
    });
    await this.auditService.record({
      actorId: actor.actorId ?? "unknown",
      actorRole: actor.actorRole ?? "viewer",
      action: "access_scope_assignment.deleted",
      resource: "AccessScopeAssignment",
      resourceId: assignmentId,
      metadata: {
        subjectType: existing.subjectType,
        subjectId: existing.subjectId,
        scopeType: existing.scopeType,
        categoryId: existing.categoryId,
        connectorInstallationId: existing.connectorInstallationId,
        scopeValue: existing.scopeValue,
        actions: existing.actions,
        tenantId: actor.tenantId ?? tenantId,
      },
    });
    return { id: assignmentId, deleted: true as const };
  }

  async buildProductScopeWhere(
    actor: PolicyActor,
    action: ScopeAction,
  ): Promise<Prisma.ProductWhereInput | undefined> {
    if (this.isAdmin(actor)) {
      return undefined;
    }
    const activeScopeTypes = await this.getActiveScopeTypes(actor, ["category", "brand"]);
    if (activeScopeTypes.length === 0) {
      return undefined;
    }
    const assignments = await this.getAssignmentsForActor(actor, action, activeScopeTypes);
    const and: Prisma.ProductWhereInput[] = [];

    if (activeScopeTypes.includes("category")) {
      const categoryIds = Array.from(
        new Set(
          assignments
            .filter((assignment) => assignment.scopeType === "category" && assignment.categoryId)
            .map((assignment) => assignment.categoryId as string),
        ),
      );
      if (categoryIds.length === 0) {
        return { id: { in: [] } };
      }
      and.push({ categoryId: { in: categoryIds } });
    }

    if (activeScopeTypes.includes("brand")) {
      const brands = Array.from(
        new Set(
          assignments
            .filter((assignment) => assignment.scopeType === "brand" && assignment.scopeValue)
            .map((assignment) => assignment.scopeValue as string),
        ),
      );
      if (brands.length === 0) {
        return { id: { in: [] } };
      }
      and.push(this.buildBrandScopeWhere(brands));
    }

    if (and.length === 0) {
      return { id: { in: [] } };
    }
    return and.length === 1 ? and[0] : { AND: and };
  }

  async buildMediaScopeWhere(
    actor: PolicyActor,
    action: ScopeAction,
  ): Promise<Prisma.MediaAssetWhereInput | undefined> {
    if (this.isAdmin(actor)) {
      return undefined;
    }
    if (!(await this.isScopeEnforced(actor, ["category", "brand"]))) {
      return undefined;
    }
    const productWhere = await this.buildProductScopeWhere(actor, action);
    if (!productWhere) {
      return undefined;
    }
    return {
      OR: [
        { product: productWhere },
        { variant: { product: productWhere } },
      ],
    };
  }

  async assertProductAccess(
    actor: PolicyActor,
    action: ScopeAction,
    product: ProductScopeCandidate & { id?: string | null },
    resource = "Product",
  ): Promise<void> {
    if (this.isAdmin(actor)) {
      return;
    }
    const activeScopeTypes = await this.getActiveScopeTypes(actor, ["category", "brand"]);
    if (activeScopeTypes.length === 0) {
      return;
    }
    const allowed = await this.isProductScopeAllowed(actor, action, product, activeScopeTypes);
    if (allowed) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "OBJECT_SCOPE_DENIED",
      action,
      resource,
      resourceId: product.id ?? null,
      metadata: {
        scopeType: "product",
        categoryId: product.categoryId ?? null,
        brand: product.brand ?? null,
      },
    });
  }

  async assertRequestedProductScopeAllowed(
    actor: PolicyActor,
    action: ScopeAction,
    input: ProductScopeCandidate & { resourceId?: string | null; resource?: string },
  ): Promise<void> {
    if (this.isAdmin(actor)) {
      return;
    }
    const activeScopeTypes = await this.getActiveScopeTypes(actor, ["category", "brand"]);
    if (activeScopeTypes.length === 0) {
      return;
    }
    const allowed = await this.isProductScopeAllowed(actor, action, input, activeScopeTypes);
    if (allowed) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "OBJECT_SCOPE_DENIED",
      action,
      resource: input.resource ?? "Product",
      resourceId: input.resourceId ?? null,
      metadata: {
        scopeType: "product_request",
        categoryId: input.categoryId ?? null,
        brand: input.brand ?? null,
      },
    });
  }

  async assertCategoryAccess(
    actor: PolicyActor,
    action: ScopeAction,
    categoryId: string,
    resource = "Category",
    resourceId?: string | null,
  ): Promise<void> {
    if (this.isAdmin(actor)) {
      return;
    }
    if (!(await this.isScopeEnforced(actor, ["category"]))) {
      return;
    }
    const assignments = await this.getAssignmentsForActor(actor, action, ["category"]);
    const allowed = assignments.some((assignment) => assignment.categoryId === categoryId);
    if (allowed) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "CATEGORY_SCOPE_DENIED",
      action,
      resource,
      resourceId: resourceId ?? categoryId,
      metadata: {
        scopeType: "category",
        categoryId,
      },
    });
  }

  async assertChannelAccess(
    actor: PolicyActor,
    action: ScopeAction,
    channelInput: string,
    resource = "Marketplace",
    resourceId?: string | null,
  ): Promise<void> {
    if (this.isAdmin(actor)) {
      return;
    }
    if (!(await this.isScopeEnforced(actor, ["channel"]))) {
      return;
    }
    const channel = normalizeChannel(channelInput);
    const assignments = await this.getAssignmentsForActor(actor, action, ["channel"]);
    const allowed = assignments.some((assignment) => assignment.scopeValue === channel);
    if (allowed) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "CHANNEL_SCOPE_DENIED",
      action,
      resource,
      resourceId: resourceId ?? null,
      metadata: {
        scopeType: "channel",
        channel,
      },
    });
  }

  async assertConnectorInstallationAccess(
    actor: PolicyActor,
    action: ScopeAction,
    connector: ConnectorScopeCandidate & { resource?: string; resourceId?: string | null },
  ): Promise<void> {
    if (this.isAdmin(actor)) {
      return;
    }
    const activeScopeTypes = await this.getActiveScopeTypes(actor, ["connector_account", "channel"]);
    if (activeScopeTypes.length === 0) {
      return;
    }
    const allowed = await this.isConnectorScopeAllowed(actor, action, connector, activeScopeTypes);
    if (allowed) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "CONNECTOR_ACCOUNT_SCOPE_DENIED",
      action,
      resource: connector.resource ?? "ConnectorInstallation",
      resourceId: connector.resourceId ?? connector.installationId ?? null,
      metadata: {
        scopeType: "connector_account",
        connectorInstallationId: connector.installationId ?? null,
        channel: connector.channel ?? channelFromConnectorSlug(connector.connectorSlug),
        accountAlias: connector.accountAlias ?? null,
      },
    });
  }

  async filterConnectorInstallations<T extends { id: string; slug?: string | null; accountAlias?: string | null }>(
    actor: PolicyActor,
    items: T[],
    action: ScopeAction,
  ): Promise<T[]> {
    if (this.isAdmin(actor)) {
      return items;
    }
    const activeScopeTypes = await this.getActiveScopeTypes(actor, ["connector_account", "channel"]);
    if (activeScopeTypes.length === 0) {
      return items;
    }
    const results = await Promise.all(
      items.map(async (item) => ({
        item,
        allowed: await this.isConnectorScopeAllowed(
          actor,
          action,
          {
            installationId: item.id,
            connectorSlug: item.slug ?? null,
            accountAlias: item.accountAlias ?? null,
          },
          activeScopeTypes,
        ),
      })),
    );
    return results.filter((entry) => entry.allowed).map((entry) => entry.item);
  }

  async assertProductAttributeWriteAllowed(
    actor: PolicyActor,
    options: {
      resourceId?: string | null;
      changedAttributePaths: string[];
    },
  ): Promise<void> {
    const restricted = options.changedAttributePaths.filter((field) =>
      RESTRICTED_PRODUCT_ATTRIBUTE_FIELDS.includes(field as (typeof RESTRICTED_PRODUCT_ATTRIBUTE_FIELDS)[number]),
    );
    if (restricted.length === 0 || this.isAdmin(actor)) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "FIELD_WRITE_RESTRICTED",
      action: "product.update",
      resource: "Product",
      resourceId: options.resourceId,
      fields: restricted,
    });
  }

  async assertVariantWriteAllowed(
    actor: PolicyActor,
    options: {
      resourceId?: string | null;
      changedFields: string[];
    },
  ): Promise<void> {
    const restricted = options.changedFields.filter((field) =>
      RESTRICTED_VARIANT_FIELDS.includes(field as (typeof RESTRICTED_VARIANT_FIELDS)[number]),
    );
    if (restricted.length === 0 || this.isAdmin(actor)) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "FIELD_WRITE_RESTRICTED",
      action: "variant.write",
      resource: "Variant",
      resourceId: options.resourceId,
      fields: restricted,
    });
  }

  async assertBulkEditAllowed(
    actor: PolicyActor,
    options: {
      fields: string[];
    },
  ): Promise<void> {
    const restricted = options.fields.filter((field) =>
      RESTRICTED_BULK_EDIT_FIELDS.includes(field as (typeof RESTRICTED_BULK_EDIT_FIELDS)[number]),
    );
    if (restricted.length === 0 || this.isAdmin(actor)) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "FIELD_WRITE_RESTRICTED",
      action: "bulk_edit.apply",
      resource: "BulkEditOperation",
      fields: restricted,
    });
  }

  async assertBulkImportAllowed(
    actor: PolicyActor,
    options: {
      fields: string[];
      resourceId?: string | null;
    },
  ): Promise<void> {
    const restricted = options.fields.filter((field) =>
      RESTRICTED_IMPORT_FIELDS.includes(field as (typeof RESTRICTED_IMPORT_FIELDS)[number]),
    );
    if (restricted.length === 0 || this.isAdmin(actor)) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "FIELD_WRITE_RESTRICTED",
      action: "bulk_import.create",
      resource: "BulkImportJob",
      resourceId: options.resourceId,
      fields: restricted,
    });
  }

  async assertSensitivePayloadAccessAllowed(
    actor: PolicyActor,
    options: {
      action: "connector.preview" | "marketplace.export";
      resource: string;
      resourceId?: string | null;
      fields?: string[];
    },
  ): Promise<void> {
    if (options.action === "marketplace.export" && this.isAdmin(actor)) {
      return;
    }
    if (options.action === "connector.preview" && this.isAdmin(actor)) {
      return;
    }
    await this.deny({
      actor,
      reasonCode: "SENSITIVE_PAYLOAD_RESTRICTED",
      action: options.action,
      resource: options.resource,
      resourceId: options.resourceId,
      fields: options.fields ?? ["sku", "mrp", "sellingPrice", "inventoryQty", "status"],
    });
  }

  redactProductReadPayload<T extends Record<string, unknown>>(actor: PolicyActor, product: T): T {
    if (this.canReadSensitiveProductFields(actor)) {
      return product;
    }
    const redacted = { ...product } as Record<string, unknown>;
    if ("attributes" in redacted) {
      redacted.attributes = this.redactSensitiveAttributeFields(redacted.attributes);
    }
    if (Array.isArray(redacted.variants)) {
      redacted.variants = redacted.variants.map((variant) =>
        this.redactVariantReadPayload(actor, this.asRecord(variant)),
      );
    }
    return redacted as T;
  }

  redactVariantReadPayload<T extends Record<string, unknown>>(actor: PolicyActor, variant: T): T {
    if (this.canReadSensitiveProductFields(actor)) {
      return variant;
    }
    const redacted = { ...variant } as Record<string, unknown>;
    delete redacted.mrp;
    delete redacted.sellingPrice;
    delete redacted.inventoryQty;
    if ("attributes" in redacted) {
      redacted.attributes = this.redactSensitiveAttributeFields(redacted.attributes);
    }
    return redacted as T;
  }

  redactDashboardHealthResponse<T extends DashboardHealthPayload>(actor: PolicyActor, health: T): T {
    const publishReadyTotal = this.sumNumberRecord(health.snapshot.publishReadyByConnector);
    const blockedTotal = this.sumNumberRecord(health.snapshot.blockedByConnector);
    const redactedSections = new Set(Array.isArray(health.redactedSections) ? health.redactedSections : []);
    const redacted: DashboardHealthPayload = {
      ...health,
      publishReadyTotal,
      blockedTotal,
      snapshot: { ...health.snapshot },
      trend: Array.isArray(health.trend) ? health.trend.map((entry) => ({ ...entry })) : [],
      redactedSections: [],
    };

    if (!this.canReadConnectorBreakdown(actor)) {
      redacted.snapshot.publishReadyByConnector = {};
      redacted.snapshot.blockedByConnector = {};
      redacted.trend = redacted.trend.map((entry) => ({
        ...entry,
        publishReadyByConnector: {},
        blockedByConnector: {},
      }));
      redactedSections.add("connector_breakdown");
    }

    if (!this.canReadApprovalQueue(actor)) {
      redacted.pendingApprovals = 0;
      redactedSections.add("approval_queue");
    }

    redacted.redactedSections = Array.from(redactedSections);
    return redacted as T;
  }

  redactCatalogStatsResponse<T extends CatalogStatsPayload>(actor: PolicyActor, stats: T): T {
    const redactedSections = new Set(Array.isArray(stats.redactedSections) ? stats.redactedSections : []);
    const redacted: CatalogStatsPayload = {
      ...stats,
      redactedSections: [],
    };

    if (!this.canReadApprovalQueue(actor)) {
      redacted.pendingApprovals = 0;
      redactedSections.add("approval_queue");
    }

    redacted.redactedSections = Array.from(redactedSections);
    return redacted as T;
  }

  redactCatalogSearchResults<
    T extends {
      matchedSku?: string | null;
    },
  >(actor: PolicyActor, results: T[]): T[] {
    if (this.canReadSensitiveProductFields(actor)) {
      return results;
    }
    return results.map((result) => {
      const redacted = { ...result };
      delete redacted.matchedSku;
      return redacted;
    });
  }

  redactNotificationResponse<T extends { items?: unknown[]; metadata?: unknown }>(actor: PolicyActor, payload: T): T {
    if (this.canReadSensitiveProductFields(actor)) {
      return payload;
    }
    const record = this.asRecord(payload);
    if (Array.isArray(record.items)) {
      return {
        ...(record as Record<string, unknown>),
        items: record.items.map((item) => this.redactNotificationItem(item)),
      } as T;
    }
    return this.redactNotificationItem(payload) as T;
  }

  applyReadResponsePolicy<T>(actor: PolicyActor, policy: ReadAccessPolicyId, payload: T): T {
    switch (policy) {
      case "catalog_stats_redacted":
        return this.redactCatalogStatsResponse(actor, payload as CatalogStatsPayload) as T;
      case "catalog_products_redacted": {
        if (Array.isArray(payload)) {
          return payload.map((item) => this.redactProductReadPayload(actor, this.asRecord(item))) as T;
        }
        const asRecord = this.asRecord(payload);
        if (Array.isArray(asRecord.items)) {
          return {
            ...(asRecord as Record<string, unknown>),
            items: asRecord.items.map((item) => this.redactProductReadPayload(actor, this.asRecord(item))),
          } as T;
        }
        return payload;
      }
      case "catalog_product_detail_redacted":
        return this.redactProductReadPayload(actor, this.asRecord(payload)) as T;
      case "catalog_search_redacted":
        return this.redactCatalogSearchResults(actor, Array.isArray(payload) ? payload : []) as T;
      case "catalog_variants_redacted": {
        if (Array.isArray(payload)) {
          return payload.map((item) => this.redactVariantReadPayload(actor, this.asRecord(item))) as T;
        }
        const asRecord = this.asRecord(payload);
        if (Array.isArray(asRecord.items)) {
          return {
            ...(asRecord as Record<string, unknown>),
            items: asRecord.items.map((item) => this.redactVariantReadPayload(actor, this.asRecord(item))),
          } as T;
        }
        return payload;
      }
      case "dashboard_health_redacted":
        return this.redactDashboardHealthResponse(actor, payload as DashboardHealthPayload) as T;
      case "notification_self_service":
        return this.redactNotificationResponse(actor, payload as { items?: unknown[]; metadata?: unknown }) as T;
      default:
        return payload;
    }
  }

  private isAdmin(actor: PolicyActor): boolean {
    return normalizeRole(actor.actorRole) === "admin";
  }

  private canReadSensitiveProductFields(actor: PolicyActor): boolean {
    const role = normalizeRole(actor.actorRole);
    return role === "admin" || role === "editor";
  }

  private canReadConnectorBreakdown(actor: PolicyActor): boolean {
    const role = normalizeRole(actor.actorRole);
    return role === "admin" || role === "editor";
  }

  private canReadApprovalQueue(actor: PolicyActor): boolean {
    const role = normalizeRole(actor.actorRole);
    return role === "admin" || role === "editor" || role === "reviewer";
  }

  private redactSensitiveAttributeFields(input: unknown): Record<string, unknown> {
    const attributes = this.asRecord(input);
    const redacted = { ...attributes };
    for (const field of RESTRICTED_PRODUCT_READ_ATTRIBUTE_FIELDS) {
      if (!field.includes(".")) {
        delete redacted[field];
      }
    }
    const pricing = this.asRecord(redacted.pricing);
    if (Object.keys(pricing).length > 0) {
      const nextPricing = { ...pricing };
      delete nextPricing.mrp;
      delete nextPricing.sellingPrice;
      delete nextPricing.cost;
      delete nextPricing.margin;
      delete nextPricing.inventoryQty;
      if (Object.keys(nextPricing).length > 0) {
        redacted.pricing = nextPricing;
      } else {
        delete redacted.pricing;
      }
    }
    return redacted;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private sumNumberRecord(value: Record<string, number> | null | undefined): number {
    return Object.values(this.asNumberRecord(value)).reduce((sum, count) => sum + count, 0);
  }

  private asNumberRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const record = value as Record<string, unknown>;
    const normalized: Record<string, number> = {};
    for (const [key, entry] of Object.entries(record)) {
      const next = Number(entry ?? 0);
      if (Number.isFinite(next)) {
        normalized[key] = next;
      }
    }
    return normalized;
  }

  private buildBrandScopeWhere(brands: string[]): Prisma.ProductWhereInput {
    const brandClauses = brands.map((brand) => ({
      brand: {
        equals: brand,
        mode: "insensitive" as const,
      },
    }));
    return brandClauses.length === 1 ? brandClauses[0] : { OR: brandClauses };
  }

  private async isProductScopeAllowed(
    actor: PolicyActor,
    action: ScopeAction,
    product: ProductScopeCandidate,
    activeScopeTypes?: ScopeAssignmentType[],
  ): Promise<boolean> {
    const resolvedActiveScopeTypes = activeScopeTypes ?? (await this.getActiveScopeTypes(actor, ["category", "brand"]));
    if (resolvedActiveScopeTypes.length === 0) {
      return true;
    }
    const assignments = await this.getAssignmentsForActor(actor, action, resolvedActiveScopeTypes);
    const normalizedBrand = normalizeBrand(product.brand);
    if (resolvedActiveScopeTypes.includes("category")) {
      const categoryIds = new Set(
        assignments
          .filter((assignment) => assignment.scopeType === "category" && assignment.categoryId)
          .map((assignment) => assignment.categoryId as string),
      );
      if (categoryIds.size === 0 || !categoryIds.has(String(product.categoryId ?? ""))) {
        return false;
      }
    }
    if (resolvedActiveScopeTypes.includes("brand")) {
      const brands = new Set(
        assignments
          .filter((assignment) => assignment.scopeType === "brand" && assignment.scopeValue)
          .map((assignment) => assignment.scopeValue as string),
      );
      if (brands.size === 0 || !brands.has(normalizedBrand)) {
        return false;
      }
    }
    return true;
  }

  private async isConnectorScopeAllowed(
    actor: PolicyActor,
    action: ScopeAction,
    connector: ConnectorScopeCandidate,
    activeScopeTypes?: ScopeAssignmentType[],
  ): Promise<boolean> {
    const resolvedActiveScopeTypes =
      activeScopeTypes ?? (await this.getActiveScopeTypes(actor, ["connector_account", "channel"]));
    if (resolvedActiveScopeTypes.length === 0) {
      return true;
    }
    const assignments = await this.getAssignmentsForActor(actor, action, resolvedActiveScopeTypes);
    const resolvedChannel = connector.channel
      ? normalizeChannel(connector.channel)
      : channelFromConnectorSlug(connector.connectorSlug);
    if (resolvedActiveScopeTypes.includes("connector_account")) {
      const installationIds = new Set(
        assignments
          .filter((assignment) => assignment.scopeType === "connector_account" && assignment.connectorInstallationId)
          .map((assignment) => assignment.connectorInstallationId as string),
      );
      if (installationIds.size === 0 || !installationIds.has(String(connector.installationId ?? ""))) {
        return false;
      }
    }
    if (resolvedActiveScopeTypes.includes("channel")) {
      const channels = new Set(
        assignments
          .filter((assignment) => assignment.scopeType === "channel" && assignment.scopeValue)
          .map((assignment) => assignment.scopeValue as string),
      );
      if (channels.size === 0 || !resolvedChannel || !channels.has(resolvedChannel)) {
        return false;
      }
    }
    return true;
  }

  private async getAssignmentsForActor(
    actor: PolicyActor,
    action: ScopeAction,
    scopeTypes?: ScopeAssignmentType[],
  ) {
    const tenantId = String(actor.tenantId ?? "").trim();
    const actorId = normalizeUserId(actor.actorId);
    const actorRole = normalizeRole(actor.actorRole);
    if (!tenantId || !actorId) {
      return [];
    }

    const assignments = await this.prisma.tenant(tenantId).accessScopeAssignment.findMany({
      where: {
        tenantKey: tenantId,
        ...(scopeTypes?.length ? { scopeType: { in: scopeTypes } } : {}),
        OR: [
          {
            subjectType: "user",
            subjectId: actorId,
          },
          {
            subjectType: "role",
            subjectId: actorRole,
          },
        ],
      },
    });

    return assignments.filter((assignment) => this.assignmentAllowsAction(assignment.actions, action));
  }

  private async isScopeEnforced(actor: PolicyActor, scopeTypes: ScopeAssignmentType[]) {
    return (await this.getActiveScopeTypes(actor, scopeTypes)).length > 0;
  }

  private async getActiveScopeTypes(actor: PolicyActor, scopeTypes: ScopeAssignmentType[]) {
    const tenantId = String(actor.tenantId ?? "").trim();
    if (!tenantId) {
      return [];
    }
    const rows = await this.prisma.tenant(tenantId).accessScopeAssignment.findMany({
      where: {
        tenantKey: tenantId,
        scopeType: {
          in: scopeTypes,
        },
      },
      select: {
        scopeType: true,
      },
      distinct: ["scopeType"],
    });
    return rows.map((row) => row.scopeType as ScopeAssignmentType);
  }

  private assignmentAllowsAction(actions: string[], action: ScopeAction): boolean {
    if (!Array.isArray(actions) || actions.length === 0) {
      return true;
    }
    return actions.includes(action) || actions.includes("*");
  }

  private async deny(input: DenyInput): Promise<never> {
    await this.auditService.record({
      actorId: input.actor.actorId ?? "unknown",
      actorRole: input.actor.actorRole ?? "viewer",
      action: "AUTHORIZATION_DENIED",
      resource: input.resource,
      resourceId: input.resourceId ?? undefined,
      metadata: {
        result: "denied",
        reasonCode: input.reasonCode,
        action: input.action,
        tenantId: input.actor.tenantId ?? null,
        fields: input.fields ?? [],
        ...(input.metadata ?? {}),
      },
    });

    throw new ForbiddenException({
      error: "ACCESS_POLICY_DENIED",
      reason: input.reasonCode,
      action: input.action,
      resource: input.resource,
      resourceId: input.resourceId ?? null,
      fields: input.fields ?? [],
    });
  }

  private buildDecision(
    allowed: boolean,
    reasonCode: string,
    actor: PolicyActor,
    actorType: PolicyActorType,
    action: string,
    resource: string,
    context: AccessPolicyDecisionContext,
  ): PolicyDecision {
    return {
      allowed,
      reasonCode,
      actorType,
      action,
      resource,
      resourceId: typeof context.metadata?.resourceId === "string" ? context.metadata.resourceId : null,
      tenantId: actor.tenantId ?? null,
      context: {
        method: context.method ?? null,
        path: context.path ?? null,
        requiredRoles: Array.isArray(context.requiredRoles) ? [...context.requiredRoles] : [],
        defaultReadAllowed: context.defaultReadAllowed === true,
        defaultWriteRoles: Array.isArray(context.defaultWriteRoles) ? [...context.defaultWriteRoles] : [],
        readAccessPolicy: this.normalizeReadAccessPolicy(context.readAccessPolicy),
        readClassification: context.readClassification ?? null,
        apiClientPolicy: context.apiClientPolicy ?? null,
        ...(context.metadata ?? {}),
      },
    };
  }

  private normalizeReadAccessPolicy(value: ReadAccessPolicyId | string | null | undefined): ReadAccessPolicyId | null {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return null;
    }
    return Object.prototype.hasOwnProperty.call(READ_ACCESS_POLICY_REASON_CODES, normalized)
      ? (normalized as ReadAccessPolicyId)
      : null;
  }

  private redactNotificationItem<T>(value: T): T {
    const item = this.asRecord(value);
    const metadata = this.asRecord(item.metadata);
    const nextMetadata: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(metadata)) {
      if (NOTIFICATION_METADATA_ALLOWLIST.has(key)) {
        nextMetadata[key] = entry;
      }
    }
    return {
      ...(item as Record<string, unknown>),
      metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : null,
    } as T;
  }
}
