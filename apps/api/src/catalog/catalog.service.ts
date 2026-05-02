import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AppliesTo, Prisma, RecordStatus, RuleSeverity, ValidationIssueStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import { AccessPolicyService } from "../common/access-policy/access-policy.service";
import { ComplianceService } from "../compliance/compliance.service";
import { withSoftDeleteBypass } from "../common/prisma-soft-delete.middleware";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { NotificationsService } from "../notifications/notifications.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";

type ActorContext = {
  id: string;
  role: "admin" | "editor" | "reviewer" | "viewer";
  tenantId?: string;
  effectiveRoles?: string[];
};

type WorkflowStatus = "draft" | "in_review" | "approved" | "rejected" | "archived";

const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["approved", "rejected", "draft", "archived"],
  approved: ["archived"],
  rejected: ["draft", "in_review", "archived"],
  archived: ["draft", "in_review"],
};

function mergeWhere<T extends Record<string, unknown>>(left: T | undefined, right: T | undefined): T | undefined {
  if (left && right) {
    return { AND: [left, right] } as unknown as T;
  }
  return left ?? right;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceService: ComplianceService,
    private readonly planUsageService: PlanUsageService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly accessPolicy: AccessPolicyService,
  ) {}

  async stats(actor?: ActorContext) {
    const [categories, products, variants, pendingApprovals] = await Promise.all([
      this.prisma.tenant().category.count(),
      this.prisma.tenant().product.count(),
      this.prisma.tenant().variant.count(),
      this.prisma.tenant().product.count({ where: { status: RecordStatus.in_review } }),
    ]);

    return this.accessPolicy.applyReadResponsePolicy(
      this.toPolicyActor(actor),
      "catalog_stats_redacted",
      { categories, products, variants, pendingApprovals },
    );
  }

  async listProducts(
    pagination?: CursorPaginationQuery,
    options?: {
      slim?: boolean;
    },
    actor?: ActorContext,
  ) {
    if (options?.slim) {
      return this.listProductsSlim(pagination, actor);
    }

    const policyActor = this.toPolicyActor(actor);
    const scopeWhere = await this.accessPolicy.buildProductScopeWhere(policyActor, "view");

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
      const products = await this.prisma.tenant().product.findMany({
        where: mergeWhere(
          token && cursorDate
            ? {
                OR: [
                  { updatedAt: { lt: cursorDate } },
                  {
                    updatedAt: cursorDate,
                    id: { lt: token.id },
                  },
                ],
              }
            : undefined,
          scopeWhere,
        ),
        include: {
          category: true,
          variants: true,
          validationIssues: { where: { status: "open" } },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const hasNext = products.length > limit;
      const page = hasNext ? products.slice(0, limit) : products;
      const scored = await this.attachCompletenessScores(page);
      const redacted = this.accessPolicy.applyReadResponsePolicy(
        policyActor,
        "catalog_products_redacted",
        scored,
      );
      const last = redacted[redacted.length - 1];
      return {
        items: redacted,
        limit,
        nextCursor: hasNext && last
          ? encodeCursorToken({
              sort: last.updatedAt.toISOString(),
              id: last.id,
            })
          : null,
      };
    }

    const products = await this.prisma.tenant().product.findMany({
      where: scopeWhere,
      include: {
        category: true,
        variants: true,
        validationIssues: { where: { status: "open" } },
      },
      orderBy: [{ updatedAt: "desc" }],
    });
    const scored = await this.attachCompletenessScores(products);
    return this.accessPolicy.applyReadResponsePolicy(policyActor, "catalog_products_redacted", scored);
  }

  private async listProductsSlim(pagination?: CursorPaginationQuery, actor?: ActorContext) {
    const scopeWhere = await this.accessPolicy.buildProductScopeWhere(this.toPolicyActor(actor), "view");
    const limit = resolveCursorLimit(pagination?.limit ?? 50);
    const token = decodeCursorToken(pagination?.cursor);
    if (pagination?.cursor && !token) {
      throw new BadRequestException("Invalid cursor.");
    }
    const cursorDate = token ? new Date(token.sort) : null;
    if (token && (!cursorDate || Number.isNaN(cursorDate.getTime()))) {
      throw new BadRequestException("Invalid cursor.");
    }

    const products = await this.prisma.tenant().product.findMany({
      where: mergeWhere(
        token && cursorDate
          ? {
              OR: [
                { updatedAt: { lt: cursorDate } },
                {
                  updatedAt: cursorDate,
                  id: { lt: token.id },
                },
              ],
            }
          : undefined,
        scopeWhere,
      ),
      select: {
        id: true,
        title: true,
        brand: true,
        description: true,
        categoryId: true,
        hsnCode: true,
        gstRate: true,
        attributes: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        category: {
          select: {
            name: true,
            path: true,
          },
        },
        variants: {
          select: {
            skuCode: true,
          },
        },
        _count: {
          select: {
            variants: true,
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });
    const hasNext = products.length > limit;
    const page = hasNext ? products.slice(0, limit) : products;
    if (page.length === 0) {
      return {
        items: [],
        limit,
        nextCursor: null,
      };
    }

    const [scored, issueCounts] = await Promise.all([
      this.attachCompletenessScores(page),
      this.prisma.tenant().validationIssue.groupBy({
        by: ["productId", "severity"],
        where: {
          productId: {
            in: page.map((product) => product.id),
          },
          status: ValidationIssueStatus.open,
        },
        _count: {
          _all: true,
        },
      }),
    ]);

    const issueSummaryByProduct = new Map<string, { errorCount: number; warningCount: number }>();
    for (const issueCount of issueCounts) {
      const current = issueSummaryByProduct.get(issueCount.productId) ?? {
        errorCount: 0,
        warningCount: 0,
      };
      if (issueCount.severity === RuleSeverity.error) {
        current.errorCount = issueCount._count._all;
      } else {
        current.warningCount = issueCount._count._all;
      }
      issueSummaryByProduct.set(issueCount.productId, current);
    }

    const items = scored.map((product) => {
      const issueSummary = issueSummaryByProduct.get(product.id) ?? {
        errorCount: 0,
        warningCount: 0,
      };
      return {
        id: product.id,
        title: product.title,
        brand: product.brand,
        categoryId: product.categoryId,
        categoryName: product.category?.name ?? undefined,
        categoryPath: product.category?.path ?? undefined,
        status: product.status,
        completenessScore: product.completenessScore,
        variantCount: product._count.variants,
        skuCodes: product.variants.map((variant) => variant.skuCode),
        openValidationErrorCount: issueSummary.errorCount,
        openValidationWarningCount: issueSummary.warningCount,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
      };
    });
    const last = page[page.length - 1];
    return {
      items,
      limit,
      nextCursor: hasNext && last
        ? encodeCursorToken({
            sort: last.updatedAt.toISOString(),
            id: last.id,
          })
        : null,
    };
  }

  async searchProducts(query: string | undefined, limit?: number, actor?: ActorContext) {
    const normalizedQuery = String(query ?? "").trim();
    if (!normalizedQuery) {
      return [];
    }

    const scopeWhere = await this.accessPolicy.buildProductScopeWhere(this.toPolicyActor(actor), "view");

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.trunc(limit as number))) : 8;
    const loweredQuery = normalizedQuery.toLowerCase();
    const fetchWindow = safeLimit + 5;
    const resultSelect = {
      id: true,
      title: true,
      status: true,
      updatedAt: true,
      category: {
        select: {
          name: true,
        },
      },
      variants: {
        where: {
          skuCode: {
            contains: normalizedQuery,
            mode: "insensitive",
          },
        },
        select: {
          skuCode: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: 5,
      },
    } satisfies Prisma.ProductSelect;

    const [titleMatches, skuMatches] = await Promise.all([
      this.prisma.tenant().product.findMany({
        where: mergeWhere(
          {
            title: {
              contains: normalizedQuery,
              mode: "insensitive",
            },
          },
          scopeWhere,
        ),
        select: resultSelect,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: fetchWindow,
      }),
      this.prisma.tenant().product.findMany({
        where: mergeWhere(
          {
            variants: {
              some: {
                skuCode: {
                  contains: normalizedQuery,
                  mode: "insensitive",
                },
              },
            },
          },
          scopeWhere,
        ),
        select: resultSelect,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: fetchWindow,
      }),
    ]);

    const productsById = new Map<
      string,
      Prisma.ProductGetPayload<{ select: typeof resultSelect }>
    >();
    for (const product of [...titleMatches, ...skuMatches]) {
      const existing = productsById.get(product.id);
      if (!existing) {
        productsById.set(product.id, product);
        continue;
      }
      if (existing.variants.length === 0 && product.variants.length > 0) {
        productsById.set(product.id, product);
      }
    }

    const results = Array.from(productsById.values())
      .map((product) => {
        const matchingSku = product.variants.find((variant) =>
          String(variant.skuCode ?? "")
            .trim()
            .toLowerCase()
            .includes(loweredQuery),
        )?.skuCode ?? null;
        const title = String(product.title ?? "").trim();
        const loweredTitle = title.toLowerCase();
        const loweredSku = String(matchingSku ?? "").trim().toLowerCase();
        let score = 0;

        if (loweredTitle === loweredQuery) {
          score += 120;
        } else if (loweredTitle.startsWith(loweredQuery)) {
          score += 90;
        } else if (loweredTitle.includes(loweredQuery)) {
          score += 60;
        }

        if (loweredSku === loweredQuery) {
          score += 100;
        } else if (loweredSku.startsWith(loweredQuery)) {
          score += 80;
        } else if (loweredSku.includes(loweredQuery)) {
          score += 50;
        }

        return {
          id: product.id,
          title,
          status: product.status,
          updatedAt: product.updatedAt,
          categoryName: product.category?.name ?? null,
          matchedSku: matchingSku,
          score,
        };
      })
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      })
      .slice(0, safeLimit)
      .map(({ score: _score, ...product }) => product);
    return this.accessPolicy.applyReadResponsePolicy(
      this.toPolicyActor(actor),
      "catalog_search_redacted",
      results,
    );
  }

  async getProduct(productId: string, actor?: ActorContext) {
    const policyActor = this.toPolicyActor(actor);
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      include: {
        category: true,
        variants: { orderBy: [{ updatedAt: "desc" }] },
        validationIssues: { where: { status: "open" }, orderBy: [{ createdAt: "desc" }] },
      },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    await this.accessPolicy.assertProductAccess(policyActor, "view", {
      id: product.id,
      categoryId: product.categoryId,
      brand: product.brand,
      vendorScopeKey: product.vendorScopeKey,
    });
    const [withScore] = await this.attachCompletenessScores([product]);
    return this.accessPolicy.applyReadResponsePolicy(policyActor, "catalog_product_detail_redacted", withScore);
  }

  async createProduct(dto: CreateProductDto, actor?: ActorContext) {
    await this.requireCategory(dto.categoryId);
    await this.accessPolicy.assertRequestedProductScopeAllowed(this.toPolicyActor(actor), "create", {
        categoryId: dto.categoryId,
        brand: dto.brand,
        vendorScopeKey: this.normalizeVendorScopeKey(dto.vendorScopeKey),
        resource: "Product",
      });
    const requestedStatus = (dto.status ?? RecordStatus.draft) as RecordStatus;
    this.assertDraftWorkflowEntry(requestedStatus, "create_product");
    const attributes = this.normalizeProductAttributes(dto.attributes ?? {});
    const product = await this.prisma.tenant().product.create({
      data: {
        title: dto.title.trim(),
        description: dto.description.trim(),
        brand: dto.brand.trim(),
        categoryId: dto.categoryId,
        vendorScopeKey: this.normalizeVendorScopeKey(dto.vendorScopeKey),
        hsnCode: dto.hsnCode?.trim() || null,
        gstRate: dto.gstRate ?? null,
        attributes: attributes as Prisma.JsonObject,
        status: RecordStatus.draft,
      },
      include: { category: true, variants: true },
    });
    await this.complianceService.validateAndPersistProduct(product.id);
    await this.planUsageService.touchUsageForCurrentTenant();
    return product;
  }

  async updateProduct(productId: string, dto: UpdateProductDto, actor?: ActorContext) {
    const current = await this.requireProduct(productId);
    const requestedVendorScopeKey =
      dto.vendorScopeKey === undefined
        ? this.normalizeVendorScopeKey(current.vendorScopeKey)
        : this.normalizeVendorScopeKey(dto.vendorScopeKey);
    await this.accessPolicy.assertProductAccess(this.toPolicyActor(actor), "edit", {
        id: current.id,
        categoryId: current.categoryId,
        brand: current.brand,
        vendorScopeKey: current.vendorScopeKey,
      });
    if (dto.expectedVersion !== current.version) {
      this.throwVersionConflict(dto.expectedVersion, current.version);
    }
    await this.requireCategory(dto.categoryId);
    await this.accessPolicy.assertRequestedProductScopeAllowed(this.toPolicyActor(actor), "edit", {
        resource: "Product",
        resourceId: productId,
        categoryId: dto.categoryId,
        brand: dto.brand,
        vendorScopeKey: requestedVendorScopeKey,
      });
    const nextStatus = dto.status as RecordStatus;
    if (!this.isValidWorkflowTransition(current.status, nextStatus)) {
      throw new BadRequestException(`Invalid workflow transition from ${current.status} to ${nextStatus}.`);
    }
    this.assertProductContentMutationAllowed(current, dto);
    await this.accessPolicy.assertProductAttributeWriteAllowed(this.toPolicyActor(actor), {
        resourceId: productId,
        changedAttributePaths: this.collectChangedRestrictedProductAttributeFields(current.attributes, dto.attributes ?? {}),
      });
    const attributes = this.normalizeProductAttributes(dto.attributes ?? {});
    const updateResult = await this.prisma.tenant().product.updateMany({
      where: {
        id: productId,
        version: dto.expectedVersion,
      },
      data: {
        title: dto.title.trim(),
        description: dto.description.trim(),
        brand: dto.brand.trim(),
        categoryId: dto.categoryId,
        vendorScopeKey: requestedVendorScopeKey,
        hsnCode: dto.hsnCode?.trim() || null,
        gstRate: dto.gstRate ?? null,
        attributes: attributes as Prisma.JsonObject,
        status: nextStatus,
        version: { increment: 1 },
      },
    });
    if (updateResult.count === 0) {
      const latest = await this.requireProduct(productId);
      this.throwVersionConflict(dto.expectedVersion, latest.version);
    }
    const product = await this.prisma.tenant().product.findUniqueOrThrow({
      where: { id: productId },
      include: { category: true, variants: true },
    });
    await this.complianceService.validateAndPersistProduct(product.id);
    if (current.status !== nextStatus) {
      await this.auditService.record({
        actorId: actor?.id ?? "system",
        actorRole: actor?.role ?? "admin",
        action: "STATUS_TRANSITION",
        resource: "/api/v1/catalog/products/:id",
        resourceId: product.id,
        metadata: {
          model: "Product",
          fromStatus: current.status,
          toStatus: nextStatus,
        },
      });
    }
    return product;
  }

  async decideProductReview(
    productId: string,
    dto: { status: "approved" | "rejected"; note?: string },
    actor: ActorContext,
  ) {
    const current = await this.requireProduct(productId);
    await this.accessPolicy.assertProductAccess(
      this.toPolicyActor(actor),
      dto.status === "approved" ? "approve" : "reject",
      {
        id: current.id,
        categoryId: current.categoryId,
        brand: current.brand,
        vendorScopeKey: current.vendorScopeKey,
      },
    );
    if (current.status !== RecordStatus.in_review) {
      throw new BadRequestException(`Review decision requires product to be in_review. Current status is ${current.status}.`);
    }

    const nextStatus = dto.status === "approved" ? RecordStatus.approved : RecordStatus.rejected;
    if (nextStatus === RecordStatus.approved) {
      await this.complianceService.validateAndPersistProduct(productId);
      const blockingIssues = await this.prisma.tenant().validationIssue.count({
        where: {
          productId,
          status: ValidationIssueStatus.open,
          severity: RuleSeverity.error,
        },
      });
      if (blockingIssues > 0) {
        throw new BadRequestException({
          code: "APPROVAL_BLOCKED",
          message: "Product still has blocking issues and cannot be approved.",
          blockingIssues,
        });
      }
    }

    const product = await this.prisma.tenant().product.update({
      where: { id: productId },
      data: {
        status: nextStatus,
        version: { increment: 1 },
      },
      include: { category: true, variants: true },
    });

    await this.auditService.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: "STATUS_TRANSITION",
      resource: "/api/v1/catalog/products/:id/review-decision",
      resourceId: product.id,
      metadata: {
        model: "Product",
        fromStatus: current.status,
        toStatus: nextStatus,
        decisionNote: dto.note?.trim() || null,
      },
    });

    await this.notificationsService.emitApprovalDecision(product.id, dto.status);

    return product;
  }

  async deleteProduct(productId: string, actor?: ActorContext) {
    const product = await this.requireProduct(productId);
    await this.accessPolicy.assertProductAccess(this.toPolicyActor(actor), "delete", {
        id: product.id,
        categoryId: product.categoryId,
        brand: product.brand,
        vendorScopeKey: product.vendorScopeKey,
      });
    await this.prisma.tenant().product.update({
      where: { id: productId },
      data: {
        deletedAt: new Date(),
        purgedById: null,
      },
    });
  }

  async purgeProduct(productId: string, actor: ActorContext) {
    const product = await this.requireProductIncludingDeleted(productId);
    await this.accessPolicy.assertProductAccess(this.toPolicyActor(actor), "delete", {
        id: product.id,
        categoryId: product.categoryId,
        brand: product.brand,
        vendorScopeKey: product.vendorScopeKey,
      });
    if (!product.deletedAt) {
      throw new BadRequestException("Product must be soft-deleted before purge.");
    }

    await this.prisma.tenant().product.delete({ where: { id: productId } });
    await this.auditService.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: "PURGE",
      resource: "/api/v1/catalog/products/:id/purge",
      resourceId: productId,
      metadata: {
        model: "Product",
      },
    });
    return {
      id: productId,
      status: "purged" as const,
    };
  }

  async listVariants(
    productId: string,
    pagination?: CursorPaginationQuery,
    actor?: ActorContext,
  ) {
    const policyActor = this.toPolicyActor(actor);
    const product = await this.requireProduct(productId);
    await this.accessPolicy.assertProductAccess(policyActor, "view", {
      id: product.id,
      categoryId: product.categoryId,
      brand: product.brand,
      vendorScopeKey: product.vendorScopeKey,
    });
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
      const variants = await this.prisma.tenant().variant.findMany({
        where: {
          productId,
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
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const hasNext = variants.length > limit;
      const items = hasNext ? variants.slice(0, limit) : variants;
      const redactedItems = this.accessPolicy.applyReadResponsePolicy(
        policyActor,
        "catalog_variants_redacted",
        items,
      );
      const last = items[items.length - 1];
      return {
        items: redactedItems,
        limit,
        nextCursor: hasNext && last
          ? encodeCursorToken({
              sort: last.updatedAt.toISOString(),
              id: last.id,
            })
          : null,
      };
    }
    const variants = await this.prisma.tenant().variant.findMany({
      where: { productId },
      orderBy: [{ updatedAt: "desc" }],
    });
    return this.accessPolicy.applyReadResponsePolicy(policyActor, "catalog_variants_redacted", variants);
  }

  async createVariant(productId: string, dto: CreateVariantDto, actor?: ActorContext) {
    const product = await this.requireProduct(productId);
    await this.accessPolicy.assertProductAccess(this.toPolicyActor(actor), "edit", {
        id: product.id,
        categoryId: product.categoryId,
        brand: product.brand,
        vendorScopeKey: product.vendorScopeKey,
      });
    this.assertWorkflowStateAllowsContentMutation(product.status, "create_variant");
    await this.accessPolicy.assertVariantWriteAllowed(this.toPolicyActor(actor), {
        changedFields: ["sku", "mrp", "sellingPrice", "inventoryQty", "status"],
      });
    this.validatePricing(dto.mrp, dto.sellingPrice);
    try {
      return await this.prisma.tenant().variant.create({
        data: {
          productId,
          skuCode: dto.skuCode.trim(),
          attributes: dto.attributes as Prisma.JsonObject,
          mrp: dto.mrp ?? null,
          sellingPrice: dto.sellingPrice ?? null,
          inventoryQty: dto.inventoryQty,
          status: dto.status as RecordStatus,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("SKU code already exists");
      }
      throw error;
    }
  }

  async updateVariant(variantId: string, dto: UpdateVariantDto, actor?: ActorContext) {
    const variant = await this.requireVariant(variantId);
    const product = await this.requireProduct(variant.productId);
    await this.accessPolicy.assertProductAccess(this.toPolicyActor(actor), "edit", {
        id: product.id,
        categoryId: product.categoryId,
        brand: product.brand,
        vendorScopeKey: product.vendorScopeKey,
      });
    this.assertWorkflowStateAllowsContentMutation(product.status, "update_variant");
    await this.accessPolicy.assertVariantWriteAllowed(this.toPolicyActor(actor), {
        resourceId: variantId,
        changedFields: this.collectChangedVariantFields(variant, dto),
      });
    this.validatePricing(dto.mrp, dto.sellingPrice);
    try {
      return await this.prisma.tenant().variant.update({
        where: { id: variantId },
        data: {
          skuCode: dto.skuCode.trim(),
          attributes: dto.attributes as Prisma.JsonObject,
          mrp: dto.mrp ?? null,
          sellingPrice: dto.sellingPrice ?? null,
          inventoryQty: dto.inventoryQty,
          status: dto.status as RecordStatus,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("SKU code already exists");
      }
      throw error;
    }
  }

  async deleteVariant(variantId: string, actor?: ActorContext) {
    const variant = await this.requireVariant(variantId);
    const product = await this.requireProduct(variant.productId);
    await this.accessPolicy.assertProductAccess(this.toPolicyActor(actor), "delete", {
        id: product.id,
        categoryId: product.categoryId,
        brand: product.brand,
        vendorScopeKey: product.vendorScopeKey,
      });
    this.assertWorkflowStateAllowsContentMutation(product.status, "delete_variant");
    await this.accessPolicy.assertVariantWriteAllowed(this.toPolicyActor(actor), {
        resourceId: variantId,
        changedFields: ["sku", "mrp", "sellingPrice", "inventoryQty", "status"],
      });
    await this.prisma.tenant().variant.delete({ where: { id: variantId } });
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.tenant().category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  private async requireProduct(productId: string) {
    const product = await this.prisma.tenant().product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return product;
  }

  private async requireProductIncludingDeleted(productId: string) {
    const product = await this.prisma.tenant().product.findUnique(
      withSoftDeleteBypass<Prisma.ProductFindUniqueArgs>({
        where: { id: productId },
      }),
    );
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return product;
  }

  private async requireVariant(variantId: string) {
    const variant = await this.prisma.tenant().variant.findUnique({ where: { id: variantId } });
    if (!variant) {
      throw new NotFoundException("Variant not found");
    }
    return variant;
  }

  private validatePricing(mrp?: number, sellingPrice?: number) {
    if (mrp !== undefined && sellingPrice !== undefined && sellingPrice > mrp) {
      throw new BadRequestException("Selling price cannot exceed MRP");
    }
  }

  private normalizeProductAttributes(attributes: Record<string, unknown>) {
    const normalized = { ...this.asRecord(attributes) };
    const pricing = this.asRecord(normalized.pricing);

    const pricingMrp = this.readNonNegativeNumber(pricing.mrp, "pricing.mrp");
    const pricingSellingPrice = this.readNonNegativeNumber(pricing.sellingPrice, "pricing.sellingPrice");
    const rootMrp = this.readNonNegativeNumber(normalized.mrp, "mrp");
    const rootSellingPrice =
      this.readNonNegativeNumber(normalized.sellingPrice, "sellingPrice") ??
      this.readNonNegativeNumber(normalized.selling_price, "selling_price");

    const resolvedMrp = pricingMrp ?? rootMrp;
    const resolvedSellingPrice = pricingSellingPrice ?? rootSellingPrice;
    if (resolvedMrp !== undefined && resolvedSellingPrice !== undefined && resolvedSellingPrice > resolvedMrp) {
      throw new BadRequestException("Selling price cannot exceed MRP");
    }

    delete normalized.mrp;
    delete normalized.sellingPrice;
    delete normalized.selling_price;

    if (resolvedMrp !== undefined || resolvedSellingPrice !== undefined || Object.keys(pricing).length > 0) {
      const nextPricing = { ...pricing };
      if (resolvedMrp !== undefined) {
        nextPricing.mrp = resolvedMrp;
      } else {
        delete nextPricing.mrp;
      }
      if (resolvedSellingPrice !== undefined) {
        nextPricing.sellingPrice = resolvedSellingPrice;
      } else {
        delete nextPricing.sellingPrice;
      }
      normalized.pricing = nextPricing;
    }

    return normalized;
  }

  private readNonNegativeNumber(value: unknown, fieldName: string): number | undefined {
    if (value === null || value === undefined || value === "") {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new BadRequestException(`${fieldName} must be numeric`);
    }
    if (parsed < 0) {
      throw new BadRequestException(`${fieldName} cannot be negative`);
    }
    return parsed;
  }

  private throwVersionConflict(expectedVersion: number, currentVersion: number): never {
    throw new ConflictException({
      code: "VERSION_CONFLICT",
      message: "Product has been updated by another operation. Reload and retry.",
      expectedVersion,
      currentVersion,
    });
  }

  private canonicalWorkflowStatus(status: RecordStatus): WorkflowStatus {
    if (status === RecordStatus.active) {
      return "approved";
    }
    return status as WorkflowStatus;
  }

  private isValidWorkflowTransition(currentStatus: RecordStatus, nextStatus: RecordStatus): boolean {
    if (currentStatus === nextStatus) {
      return true;
    }
    const currentCanonical = this.canonicalWorkflowStatus(currentStatus);
    const nextCanonical = this.canonicalWorkflowStatus(nextStatus);
    if (currentCanonical === nextCanonical) {
      return true;
    }
    const allowed = WORKFLOW_TRANSITIONS[currentCanonical] ?? [];
    return allowed.includes(nextCanonical);
  }

  private assertProductContentMutationAllowed(
    current: {
      status: RecordStatus;
      title: string;
      description: string;
      brand: string;
      categoryId: string;
      vendorScopeKey?: string | null;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: unknown;
    },
    dto: UpdateProductDto,
  ) {
    if (!this.isWorkflowStateContentLocked(current.status)) {
      return;
    }

    const nextAttributes = this.normalizeProductAttributes(dto.attributes ?? {});
    const currentAttributes = this.normalizeProductAttributes(this.asRecord(current.attributes));
    const nextVendorScopeKey =
      dto.vendorScopeKey === undefined
        ? this.normalizeVendorScopeKey(current.vendorScopeKey)
        : this.normalizeVendorScopeKey(dto.vendorScopeKey);
    const contentChanged =
      current.title !== dto.title.trim() ||
      current.description !== dto.description.trim() ||
      current.brand !== dto.brand.trim() ||
      current.categoryId !== dto.categoryId ||
      this.normalizeVendorScopeKey(current.vendorScopeKey) !== nextVendorScopeKey ||
      (current.hsnCode ?? null) !== (dto.hsnCode?.trim() || null) ||
      (current.gstRate ?? null) !== (dto.gstRate ?? null) ||
      !this.recordsEqual(currentAttributes, nextAttributes);

    if (!contentChanged) {
      return;
    }

    throw new BadRequestException({
      code: "WORKFLOW_CONTENT_LOCKED",
      message: `Products in ${current.status} status require a workflow transition before content can change.`,
      currentStatus: current.status,
      allowedAction: "status_transition_only",
    });
  }

  private assertWorkflowStateAllowsContentMutation(status: RecordStatus, source: string) {
    if (!this.isWorkflowStateContentLocked(status)) {
      return;
    }
    throw new BadRequestException({
      code: "WORKFLOW_CONTENT_LOCKED",
      message: `Products in ${status} status require a workflow transition before content can change.`,
      currentStatus: status,
      source,
      allowedAction: "status_transition_only",
    });
  }

  private isWorkflowStateContentLocked(status: RecordStatus): boolean {
    const canonical = this.canonicalWorkflowStatus(status);
    return canonical === "approved" || canonical === "archived";
  }

  private recordsEqual(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private normalizeVendorScopeKey(value: string | null | undefined): string | null {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private assertDraftWorkflowEntry(status: RecordStatus, source: "create_product") {
    if (status === RecordStatus.draft) {
      return;
    }
    throw new BadRequestException({
      code: "WORKFLOW_ENTRY_INVALID",
      message: "New products must enter workflow in draft status.",
      source,
      allowedStatus: RecordStatus.draft,
      receivedStatus: status,
    });
  }

  private async attachCompletenessScores<
    T extends {
      categoryId: string;
      title: string;
      brand: string;
      description: string;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: unknown;
    },
  >(products: T[]): Promise<Array<T & { completenessScore: number }>> {
    if (products.length === 0) {
      return [];
    }

    const categoryIds = Array.from(new Set(products.map((product) => product.categoryId)));
    const requiredAttributes = await this.prisma.tenant().attributeDefinition.findMany({
      where: {
        categoryId: { in: categoryIds },
        appliesTo: AppliesTo.product,
        required: true,
      },
      select: {
        categoryId: true,
        key: true,
      },
    });

    const requiredByCategory = new Map<string, string[]>();
    for (const attribute of requiredAttributes) {
      const existing = requiredByCategory.get(attribute.categoryId) ?? [];
      existing.push(attribute.key);
      requiredByCategory.set(attribute.categoryId, existing);
    }

    return products.map((product) => ({
      ...product,
      completenessScore: this.calculateCompletenessScore(
        product,
        requiredByCategory.get(product.categoryId) ?? [],
      ),
    }));
  }

  private calculateCompletenessScore(
    product: {
      title: string;
      brand: string;
      description: string;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: unknown;
    },
    requiredAttributeKeys: string[],
  ) {
    const coreValues = [product.title, product.brand, product.description, product.hsnCode, product.gstRate];
    const filledCore = coreValues.filter((value) => !this.isEmpty(value)).length;
    const requiredTotal = coreValues.length + requiredAttributeKeys.length;

    if (requiredTotal === 0) {
      return 100;
    }

    const attributes = this.asRecord(product.attributes);
    const filledAttributes = requiredAttributeKeys.filter((key) => !this.isEmpty(attributes[key])).length;
    return Math.round(((filledCore + filledAttributes) / requiredTotal) * 100);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private toPolicyActor(actor?: ActorContext) {
    return {
      actorId: actor?.id,
      actorRole: actor?.role,
      tenantId: actor?.tenantId,
      effectiveRoles: actor?.effectiveRoles,
    };
  }

  private collectChangedRestrictedProductAttributeFields(currentInput: unknown, nextInput: Record<string, unknown>): string[] {
    const current = this.asRecord(currentInput);
    const next = this.asRecord(nextInput);
    const changed: string[] = [];
    const paths = [
      ["pricing", "mrp"],
      ["pricing", "sellingPrice"],
      ["mrp"],
      ["sellingPrice"],
      ["selling_price"],
      ["price"],
      ["cost"],
      ["sku"],
      ["inventoryQty"],
    ] as const;
    for (const path of paths) {
      if (JSON.stringify(this.readPath(current, path)) !== JSON.stringify(this.readPath(next, path))) {
        changed.push(path.join("."));
      }
    }
    return changed;
  }

  private collectChangedVariantFields(
    current: {
      skuCode: string;
      mrp: number | null;
      sellingPrice: number | null;
      inventoryQty: number;
      status: RecordStatus;
    },
    dto: UpdateVariantDto,
  ): string[] {
    const changed: string[] = [];
    if (current.skuCode !== dto.skuCode.trim()) changed.push("sku");
    if ((current.mrp ?? null) !== (dto.mrp ?? null)) changed.push("mrp");
    if ((current.sellingPrice ?? null) !== (dto.sellingPrice ?? null)) changed.push("sellingPrice");
    if (current.inventoryQty !== dto.inventoryQty) changed.push("inventoryQty");
    if (current.status !== (dto.status as RecordStatus)) changed.push("status");
    return changed;
  }

  private readPath(source: Record<string, unknown>, path: readonly string[]): unknown {
    let current: unknown = source;
    for (const segment of path) {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private isEmpty(value: unknown) {
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  }
}
