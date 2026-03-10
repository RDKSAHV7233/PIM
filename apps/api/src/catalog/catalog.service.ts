import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { AppliesTo, Prisma, RecordStatus, RuleSeverity, ValidationIssueStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import { ComplianceService } from "../compliance/compliance.service";
import { withSoftDeleteBypass } from "../common/prisma-soft-delete.middleware";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";

type ActorContext = {
  id: string;
  role: "admin" | "editor" | "reviewer" | "viewer";
};

type WorkflowStatus = "draft" | "in_review" | "approved" | "rejected" | "archived";

const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["approved", "rejected", "draft", "archived"],
  approved: ["archived"],
  rejected: ["draft", "in_review", "archived"],
  archived: ["draft", "in_review"],
};

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceService: ComplianceService,
    private readonly planUsageService: PlanUsageService,
    private readonly auditService: AuditService,
  ) {}

  async stats() {
    const [categories, products, variants, pendingApprovals] = await Promise.all([
      this.prisma.tenant().category.count(),
      this.prisma.tenant().product.count(),
      this.prisma.tenant().variant.count(),
      this.prisma.tenant().product.count({ where: { status: RecordStatus.in_review } }),
    ]);
    return { categories, products, variants, pendingApprovals };
  }

  async listProducts(
    pagination?: CursorPaginationQuery,
  ) {
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
        where: token && cursorDate
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
      const last = scored[scored.length - 1];
      return {
        items: scored,
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
      include: {
        category: true,
        variants: true,
        validationIssues: { where: { status: "open" } },
      },
      orderBy: [{ updatedAt: "desc" }],
    });
    return this.attachCompletenessScores(products);
  }

  async searchProducts(query: string | undefined, limit?: number) {
    const normalizedQuery = String(query ?? "").trim();
    if (!normalizedQuery) {
      return [];
    }

    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.trunc(limit as number))) : 8;
    const loweredQuery = normalizedQuery.toLowerCase();
    const products = await this.prisma.tenant().product.findMany({
      where: {
        OR: [
          {
            title: {
              contains: normalizedQuery,
              mode: "insensitive",
            },
          },
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
        ],
      },
      include: {
        category: {
          select: {
            name: true,
          },
        },
        variants: {
          select: {
            skuCode: true,
          },
          take: 25,
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 25,
    });

    return products
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
  }

  async getProduct(productId: string) {
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
    const [withScore] = await this.attachCompletenessScores([product]);
    return withScore;
  }

  async createProduct(dto: CreateProductDto) {
    await this.requireCategory(dto.categoryId);
    const requestedStatus = (dto.status ?? RecordStatus.draft) as RecordStatus;
    this.assertDraftWorkflowEntry(requestedStatus, "create_product");
    const attributes = this.normalizeProductAttributes(dto.attributes ?? {});
    const product = await this.prisma.tenant().product.create({
      data: {
        title: dto.title.trim(),
        description: dto.description.trim(),
        brand: dto.brand.trim(),
        categoryId: dto.categoryId,
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
    if (dto.expectedVersion !== current.version) {
      this.throwVersionConflict(dto.expectedVersion, current.version);
    }
    await this.requireCategory(dto.categoryId);
    const nextStatus = dto.status as RecordStatus;
    if (!this.isValidWorkflowTransition(current.status, nextStatus)) {
      throw new BadRequestException(`Invalid workflow transition from ${current.status} to ${nextStatus}.`);
    }
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

    return product;
  }

  async deleteProduct(productId: string) {
    await this.requireProduct(productId);
    await this.prisma.tenant().product.update({
      where: { id: productId },
      data: {
        deletedAt: new Date(),
        purgedById: null,
      },
    });
  }

  async purgeProduct(productId: string, actorId: string) {
    const product = await this.requireProductIncludingDeleted(productId);
    if (!product.deletedAt) {
      throw new BadRequestException("Product must be soft-deleted before purge.");
    }

    await this.prisma.tenant().product.delete({ where: { id: productId } });
    await this.auditService.record({
      actorId,
      actorRole: "admin",
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
  ) {
    await this.requireProduct(productId);
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
      const last = items[items.length - 1];
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
    return this.prisma.tenant().variant.findMany({
      where: { productId },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  async createVariant(productId: string, dto: CreateVariantDto) {
    await this.requireProduct(productId);
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

  async updateVariant(variantId: string, dto: UpdateVariantDto) {
    await this.requireVariant(variantId);
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

  async deleteVariant(variantId: string) {
    await this.requireVariant(variantId);
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
  >(products: T[]) {
    if (products.length === 0) {
      return products;
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

  private isEmpty(value: unknown) {
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  }
}
