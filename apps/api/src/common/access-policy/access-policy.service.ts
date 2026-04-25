import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../../audit/audit.service";
import { parseMarketplaceChannel, type MarketplaceChannel } from "../../marketplace/marketplace-channels";
import { PrismaService } from "../../prisma/prisma.service";
import { AppRole, APP_ROLES } from "../rbac/roles";

export type PolicyActor = {
  actorId?: string | null;
  actorRole?: AppRole | null;
  tenantId?: string | null;
};

export type ScopeAssignmentSubjectType = "user" | "role";
export type ScopeAssignmentType = "category" | "brand" | "channel" | "connector_account";
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

function normalizeSubjectType(value: string | null | undefined): ScopeAssignmentSubjectType {
  return String(value ?? "").trim().toLowerCase() === "role" ? "role" : "user";
}

function normalizeScopeType(value: string | null | undefined): ScopeAssignmentType {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "category" || normalized === "brand" || normalized === "channel" || normalized === "connector_account") {
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

  private isAdmin(actor: PolicyActor): boolean {
    return normalizeRole(actor.actorRole) === "admin";
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
}
