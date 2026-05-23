import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { AppliesTo, Prisma, ProductRelationshipType, RecordStatus, RuleSeverity, ValidationIssueStatus } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import { AccessPolicyService } from "../common/access-policy/access-policy.service";
import { CacheService } from "../common/cache/cache.service";
import { ComplianceService } from "../compliance/compliance.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
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
import { CreateApprovalCommentDto } from "./dto/create-approval-comment.dto";
import { CreateProductDto } from "./dto/create-product.dto";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";
import { type AppRole } from "../common/rbac/roles";

type ActorContext = {
  id: string;
  role: AppRole;
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

const COMPLETENESS_CACHE_TTL = 5 * 60;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceService: ComplianceService,
    private readonly planUsageService: PlanUsageService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly cache: CacheService,
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
          category: { select: { id: true, name: true, slug: true, path: true, parentId: true, createdAt: true, updatedAt: true } },
          variants: { select: { id: true, productId: true, skuCode: true, attributes: true, mrp: true, sellingPrice: true, inventoryQty: true, status: true, createdAt: true, updatedAt: true } },
          validationIssues: {
            where: { status: "open" },
            select: { id: true, severity: true, ruleCode: true, message: true, fieldPath: true },
            take: 100,
          },
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

    // Legacy (non-cursor) path — hard-capped at 200 to prevent full-table loads.
    // Prefer ?pagination=cursor for all list surfaces.
    const products = await this.prisma.tenant().product.findMany({
      where: scopeWhere,
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
        category: { select: { id: true, name: true, path: true } },
        variants: { select: { id: true, skuCode: true, attributes: true, status: true, createdAt: true, updatedAt: true } },
        validationIssues: { where: { status: "open" }, select: { id: true, severity: true, ruleCode: true, message: true, fieldPath: true }, take: 100 },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
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
        category: { select: { id: true, name: true, path: true, parentId: true, slug: true, createdAt: true, updatedAt: true } },
        variants: { orderBy: [{ updatedAt: "desc" }], take: 500 },
        validationIssues: { where: { status: "open" }, orderBy: [{ createdAt: "desc" }], take: 100 },
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

  async getProductRevisions(productId: string, actor?: ActorContext) {
    const product = await this.requireProduct(productId);
    await this.accessPolicy.assertProductAccess(this.toPolicyActor(actor), "view", {
      id: product.id,
      categoryId: product.categoryId,
      brand: product.brand,
      vendorScopeKey: product.vendorScopeKey,
    });

    const logs = await this.prisma.tenant().auditLog.findMany({
      where: {
        resourceId: productId,
        action: {
          in: ["PRODUCT_UPDATED", "REVIEW_DECISION"],
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });

    const items = logs
      .map((log) => this.toProductRevision(log, productId))
      .filter((revision): revision is NonNullable<typeof revision> => revision !== null);
    return { items };
  }

  /**
   * RG-C6: Advanced catalog search with faceted filtering and cursor pagination.
   * Supports multi-dimensional filtering: status[], categoryId, brand, channelSlug,
   * plus full-text q across title/SKU/brand/description. Cursor-paginated for
   * large-catalog performance. Applies access-policy scope and response redaction.
   */
  async advancedSearchProducts(
    params: {
      q?: string;
      status?: string[];
      categoryId?: string;
      brand?: string;
      channelSlug?: string;
      cursor?: string;
      limit?: number;
      sort?: "updatedAt" | "createdAt" | "title";
      sortDir?: "asc" | "desc";
    },
    actor?: ActorContext,
  ) {
    const policyActor = this.toPolicyActor(actor);
    const pageLimit = Math.max(1, Math.min(100, Number.isFinite(params.limit) ? Number(params.limit) : 20));
    const sort = params.sort ?? "updatedAt";
    const sortDir: "asc" | "desc" = params.sortDir ?? "desc";
    const token = params.cursor ? decodeCursorToken(params.cursor) : null;
    if (params.cursor && !token) {
      throw new BadRequestException("Invalid cursor token.");
    }

    // Resolve access scope and channel definition in parallel — independent DB reads
    const [scopeWhere, channelDefResult] = await Promise.all([
      this.accessPolicy.buildProductScopeWhere(policyActor, "view"),
      params.channelSlug
        ? this.prisma.tenant().connectorDefinition.findFirst({
            where: { slug: params.channelSlug },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);

    const filterClauses: Prisma.ProductWhereInput[] = [];

    // Full-text query across title, description, brand, and variant SKU codes
    const q = String(params.q ?? "").trim();
    if (q) {
      filterClauses.push({
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          { description: { contains: q, mode: "insensitive" } },
          { brand: { contains: q, mode: "insensitive" } },
          { variants: { some: { skuCode: { contains: q, mode: "insensitive" } } } },
        ],
      });
    }

    // Status multi-filter — validate each value against RecordStatus enum
    if (Array.isArray(params.status) && params.status.length > 0) {
      const validStatuses = params.status
        .map((s) => String(s).trim())
        .filter((s) => Object.values(RecordStatus).includes(s as RecordStatus))
        .map((s) => s as RecordStatus);
      if (validStatuses.length > 0) {
        filterClauses.push({ status: { in: validStatuses } });
      }
    }

    // Category exact-match (tenant-scoped implicitly via scopeWhere)
    if (params.categoryId) {
      filterClauses.push({ categoryId: params.categoryId });
    }

    // Brand partial match (case-insensitive ILIKE)
    if (params.brand) {
      const brandTrimmed = String(params.brand).trim();
      if (brandTrimmed) {
        filterClauses.push({ brand: { contains: brandTrimmed, mode: "insensitive" } });
      }
    }

    // Channel/connector submission filter — resolves slug → installations → product IDs
    if (params.channelSlug) {
      const channelDef = channelDefResult;
      if (!channelDef) {
        return {
          items: [],
          limit: pageLimit,
          total: null as null,
          nextCursor: null as null,
          filters: { channelSlug: params.channelSlug },
        };
      }
      const channelInstallations = await this.prisma.tenant().connectorInstallation.findMany({
        where: { connectorId: channelDef.id },
        select: { id: true },
        take: 500,
      });
      if (channelInstallations.length === 0) {
        return {
          items: [],
          limit: pageLimit,
          total: null as null,
          nextCursor: null as null,
          filters: { channelSlug: params.channelSlug },
        };
      }
      const channelSubmissions = await this.prisma.tenant().connectorSubmission.findMany({
        where: { installationId: { in: channelInstallations.map((i) => i.id) } },
        select: { productId: true },
        distinct: ["productId"],
        take: 10_000,
      });
      const channelProductIds = channelSubmissions.map((s) => s.productId);
      if (channelProductIds.length === 0) {
        return {
          items: [],
          limit: pageLimit,
          total: null as null,
          nextCursor: null as null,
          filters: { channelSlug: params.channelSlug },
        };
      }
      filterClauses.push({ id: { in: channelProductIds } });
    }

    // Cursor clause — date-based for updatedAt/createdAt; lexicographic for title/status
    let cursorWhere: Prisma.ProductWhereInput | undefined;
    if (token) {
      if (sort === "updatedAt" || sort === "createdAt") {
        const cursorDate = new Date(token.sort);
        if (Number.isNaN(cursorDate.getTime())) {
          throw new BadRequestException("Invalid cursor token.");
        }
        const dateCompare = sortDir === "desc" ? { lt: cursorDate } : { gt: cursorDate };
        const tiebreakId = sortDir === "desc" ? { lt: token.id } : { gt: token.id };
        cursorWhere =
          sort === "updatedAt"
            ? { OR: [{ updatedAt: dateCompare }, { updatedAt: { equals: cursorDate }, id: tiebreakId }] }
            : { OR: [{ createdAt: dateCompare }, { createdAt: { equals: cursorDate }, id: tiebreakId }] };
      } else if (sort === "title") {
        const strCompare = sortDir === "desc" ? { lt: token.sort } : { gt: token.sort };
        const tiebreakId = sortDir === "desc" ? { lt: token.id } : { gt: token.id };
        cursorWhere = { OR: [{ title: strCompare }, { title: { equals: token.sort }, id: tiebreakId }] };
      } else {
        // sort === "title" already handled above; exhaustive guard for type safety
        cursorWhere = undefined;
      }
    }

    // Compose final WHERE: [cursor] AND [user filters] AND [access-policy scope]
    const allClauses: Prisma.ProductWhereInput[] = [];
    if (cursorWhere) allClauses.push(cursorWhere);
    if (filterClauses.length > 0) allClauses.push({ AND: filterClauses });
    if (scopeWhere) allClauses.push(scopeWhere as Prisma.ProductWhereInput);
    const fullWhere: Prisma.ProductWhereInput = allClauses.length > 0 ? { AND: allClauses } : {};

    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      sort === "createdAt" ? [{ createdAt: sortDir }, { id: sortDir }] :
      sort === "title"     ? [{ title: sortDir }, { id: sortDir }] :
                             [{ updatedAt: sortDir }, { id: sortDir }];

    const products = await this.prisma.tenant().product.findMany({
      where: fullWhere,
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
        category: { select: { name: true, path: true } },
        variants: { select: { skuCode: true } },
        _count: { select: { variants: true } },
      },
      orderBy,
      take: pageLimit + 1,
    });

    const hasNext = products.length > pageLimit;
    const page = hasNext ? products.slice(0, pageLimit) : products;
    const scored = await this.attachCompletenessScores(page);

    const items = this.accessPolicy.applyReadResponsePolicy(
      policyActor,
      "catalog_products_redacted",
      scored.map((p) => ({
        ...p,
        variantCount: p._count.variants,
        skuCodes: p.variants.map((v) => v.skuCode),
      })),
    );

    const last = page[page.length - 1];
    let nextCursor: string | null = null;
    if (hasNext && last) {
      const sortValue =
        sort === "createdAt" ? last.createdAt.toISOString() :
        sort === "title"     ? String(last.title ?? "") :
                               last.updatedAt.toISOString();
      nextCursor = encodeCursorToken({ sort: sortValue, id: last.id });
    }

    return {
      items,
      limit: pageLimit,
      total: null as null,
      nextCursor,
      filters: {
        q: q || undefined,
        status: Array.isArray(params.status) && params.status.length > 0 ? params.status : undefined,
        categoryId: params.categoryId || undefined,
        brand: params.brand || undefined,
        channelSlug: params.channelSlug || undefined,
      },
    };
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
      include: {
        category: { select: { id: true, name: true, slug: true, path: true, parentId: true, createdAt: true, updatedAt: true } },
        variants: { select: { id: true, productId: true, skuCode: true, attributes: true, mrp: true, sellingPrice: true, inventoryQty: true, status: true, createdAt: true, updatedAt: true } },
      },
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

    // Resolve SLA deadline when transitioning to in_review.
    let slaDeadlineAt: Date | null = null;
    if (nextStatus === RecordStatus.in_review && current.status !== RecordStatus.in_review) {
      const slaConfig = await this.prisma.tenant().workflowSla.findUnique({
        where: { tenantKey: actor?.tenantId ?? "default" },
      });
      const targetDays = slaConfig?.reviewTargetDays ?? 3;
      slaDeadlineAt = new Date(Date.now() + targetDays * 24 * 60 * 60 * 1000);
    }

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
        ...(slaDeadlineAt !== null ? { slaDeadlineAt } : {}),
      },
    });
    if (updateResult.count === 0) {
      const latest = await this.requireProduct(productId);
      this.throwVersionConflict(dto.expectedVersion, latest.version);
    }
    const product = await this.prisma.tenant().product.findUniqueOrThrow({
      where: { id: productId },
      include: {
        category: { select: { id: true, name: true, slug: true, path: true, parentId: true, createdAt: true, updatedAt: true } },
        variants: { select: { id: true, productId: true, skuCode: true, attributes: true, mrp: true, sellingPrice: true, inventoryQty: true, status: true, createdAt: true, updatedAt: true } },
      },
    });
    await this.complianceService.validateAndPersistProduct(product.id);
    const changedFields = this.collectChangedProductFields(current, {
      title: dto.title.trim(),
      description: dto.description.trim(),
      brand: dto.brand.trim(),
      categoryId: dto.categoryId,
      vendorScopeKey: requestedVendorScopeKey,
      hsnCode: dto.hsnCode?.trim() || null,
      gstRate: dto.gstRate ?? null,
      attributes,
      status: nextStatus,
    });
    const auditTasks: Promise<void>[] = [];
    if (changedFields.length > 0) {
      auditTasks.push(this.auditService.record({
        actorId: actor?.id ?? "system",
        actorRole: actor?.role ?? "admin",
        action: "PRODUCT_UPDATED",
        resource: "/api/v1/catalog/products/:id",
        resourceId: product.id,
        metadata: {
          model: "Product",
          fromStatus: current.status,
          toStatus: nextStatus,
          changedFields,
          changedFieldCount: changedFields.length,
          changedSectionCount: this.countChangedSections(changedFields),
        },
      }));
    }
    if (current.status !== nextStatus) {
      auditTasks.push(this.auditService.record({
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
      }));
    }
    await Promise.all(auditTasks);
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
      include: {
        category: { select: { id: true, name: true, slug: true, path: true, parentId: true, createdAt: true, updatedAt: true } },
        variants: { select: { id: true, productId: true, skuCode: true, attributes: true, mrp: true, sellingPrice: true, inventoryQty: true, status: true, createdAt: true, updatedAt: true } },
      },
    });

    await Promise.all([
      this.auditService.record({
        actorId: actor.id,
        actorRole: actor.role,
        action: "REVIEW_DECISION",
        resource: "/api/v1/catalog/products/:id/review-decision",
        resourceId: product.id,
        metadata: {
          model: "Product",
          fromStatus: current.status,
          toStatus: nextStatus,
          changedFields: [
            {
              path: "status",
              label: "Status",
              before: current.status,
              after: nextStatus,
            },
          ],
          changedFieldCount: 1,
          changedSectionCount: 1,
          decisionNote: dto.note?.trim() || null,
        },
      }),
      this.auditService.record({
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
      }),
      this.notificationsService.emitApprovalDecision(product.id, dto.status),
    ]);

    return product;
  }

  async addApprovalComment(productId: string, dto: CreateApprovalCommentDto, actor: ActorContext) {
    await this.requireProduct(productId);
    const comment = await this.prisma.tenant().approvalComment.create({
      data: {
        productId,
        actorId: actor.id,
        actorRole: actor.role,
        body: dto.body.trim(),
      },
    });
    await this.auditService.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: "APPROVAL_COMMENT_ADDED",
      resource: "/api/v1/catalog/products/:id/review-comments",
      resourceId: productId,
      metadata: { model: "ApprovalComment", commentId: comment.id },
    });
    return comment;
  }

  async listApprovalComments(productId: string, actor: ActorContext) {
    await this.requireProduct(productId);
    return this.prisma.tenant().approvalComment.findMany({
      where: { productId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
  }

  // ── RG-C5: Workflow collaboration ──────────────────────────────────────────

  async assignProduct(productId: string, assigneeId: string | null, actor: ActorContext) {
    await this.requireProduct(productId);
    const updated = await this.prisma.tenant().product.update({
      where: { id: productId },
      data: { assigneeId },
      select: { id: true, assigneeId: true, updatedAt: true },
    });
    await this.auditService.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: assigneeId ? "PRODUCT_ASSIGNED" : "PRODUCT_UNASSIGNED",
      resource: "/api/v1/catalog/products/:id/assignee",
      resourceId: productId,
      metadata: { assigneeId },
    });
    return updated;
  }

  async requestChanges(productId: string, reason: string, actor: ActorContext) {
    const trimmedReason = String(reason ?? "").trim();
    if (!trimmedReason) {
      throw new BadRequestException("reason is required");
    }
    await this.requireProduct(productId);
    const cr = await this.prisma.tenant().changeRequest.create({
      data: {
        productId,
        requesterId: actor.id,
        requesterRole: actor.role,
        reason: trimmedReason,
      },
    });
    await this.auditService.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: "CHANGE_REQUEST_CREATED",
      resource: "/api/v1/catalog/products/:id/change-requests",
      resourceId: productId,
      metadata: { changeRequestId: cr.id },
    });
    return cr;
  }

  async listChangeRequests(productId: string, _actor: ActorContext) {
    await this.requireProduct(productId);
    return this.prisma.tenant().changeRequest.findMany({
      where: { productId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    });
  }

  async resolveChangeRequest(changeRequestId: string, actor: ActorContext) {
    const cr = await this.prisma.tenant().changeRequest.findFirstOrThrow({
      where: { id: changeRequestId },
    });
    if (cr.status === "resolved") {
      throw new BadRequestException("Change request is already resolved");
    }
    const updated = await this.prisma.tenant().changeRequest.update({
      where: { id: changeRequestId },
      data: { status: "resolved", resolvedAt: new Date(), resolvedById: actor.id },
    });
    await this.auditService.record({
      actorId: actor.id,
      actorRole: actor.role,
      action: "CHANGE_REQUEST_RESOLVED",
      resource: "/api/v1/catalog/products/:id/change-requests/:requestId/resolve",
      resourceId: cr.productId,
      metadata: { changeRequestId: cr.id },
    });
    return updated;
  }

  async upsertWorkflowSla(reviewTargetDays: number, actor: ActorContext) {
    const days = Math.max(1, Math.min(365, Math.trunc(Number(reviewTargetDays) || 3)));
    const sla = await this.prisma.tenant().workflowSla.upsert({
      where: { tenantKey: actor.tenantId ?? "default" },
      create: { tenantKey: actor.tenantId ?? "default", reviewTargetDays: days },
      update: { reviewTargetDays: days },
    });
    return sla;
  }

  async getWorkflowSla(actor: ActorContext) {
    const sla = await this.prisma.tenant().workflowSla.findUnique({
      where: { tenantKey: actor.tenantId ?? "default" },
    });
    return sla ?? { reviewTargetDays: 3, tenantKey: actor.tenantId ?? "default" };
  }

  async getOverdueProductCount(actor: ActorContext) {
    const now = new Date();
    const count = await this.prisma.tenant().product.count({
      where: {
        status: RecordStatus.in_review,
        slaDeadlineAt: { lt: now },
        deletedAt: null,
      },
    });
    return { overdueCount: count, asOf: now.toISOString() };
  }

  async getProductActivity(productId: string, actor: ActorContext, limit = 50) {
    await this.requireProduct(productId);
    const logs = await this.prisma.tenant().auditLog.findMany({
      where: { resourceId: productId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: Math.min(limit, 100),
      select: {
        id: true,
        actorId: true,
        actorRole: true,
        action: true,
        resource: true,
        resourceId: true,
        metadata: true,
        createdAt: true,
      },
    });
    return { productId, total: logs.length, events: logs };
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
      take: 500,
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

    // Per-category cache keys — once a category warms up, any page containing it is a hit
    // regardless of the other categories on the page. Lookups are parallelized so N cache
    // reads (and any cold-miss DB queries) resolve in one round-trip, not N.
    const uniqueCategoryIds = Array.from(new Set(products.map((p) => p.categoryId)));
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());

    const entries = await Promise.all(
      uniqueCategoryIds.map(async (categoryId) => {
        const keys = await this.cache.getOrSet(
          `completeness:required:${tenantKey}:${categoryId}`,
          () => this.prisma.tenant().attributeDefinition.findMany({
            where: { categoryId, appliesTo: AppliesTo.product, required: true },
            take: 500,
            select: { key: true },
          }).then((defs) => defs.map((d) => d.key)),
          COMPLETENESS_CACHE_TTL,
        );
        return [categoryId, keys] as const;
      }),
    );
    const requiredByCategory = new Map<string, string[]>(entries);

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

  private collectChangedProductFields(
    current: {
      title: string;
      description: string;
      brand: string;
      categoryId: string;
      vendorScopeKey?: string | null;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: unknown;
      status: RecordStatus;
    },
    next: {
      title: string;
      description: string;
      brand: string;
      categoryId: string;
      vendorScopeKey?: string | null;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: Record<string, unknown>;
      status: RecordStatus;
    },
  ) {
    const changedFields: Array<{ path: string; label: string; before: unknown; after: unknown }> = [];
    const scalarFields = [
      { path: "title", label: "Title", before: current.title, after: next.title },
      { path: "description", label: "Description", before: current.description, after: next.description },
      { path: "brand", label: "Brand", before: current.brand, after: next.brand },
      { path: "categoryId", label: "Category", before: current.categoryId, after: next.categoryId },
      {
        path: "vendorScopeKey",
        label: "Vendor scope",
        before: this.normalizeVendorScopeKey(current.vendorScopeKey),
        after: this.normalizeVendorScopeKey(next.vendorScopeKey),
      },
      { path: "hsnCode", label: "HSN Code", before: current.hsnCode ?? null, after: next.hsnCode ?? null },
      { path: "gstRate", label: "GST Rate", before: current.gstRate ?? null, after: next.gstRate ?? null },
      { path: "status", label: "Status", before: current.status, after: next.status },
    ] as const;
    for (const field of scalarFields) {
      if (JSON.stringify(field.before) !== JSON.stringify(field.after)) {
        changedFields.push(field);
      }
    }

    const currentAttributes = this.normalizeProductAttributes(this.asRecord(current.attributes));
    const nextAttributes = this.normalizeProductAttributes(next.attributes);
    const attributeKeys = Array.from(
      new Set([...Object.keys(currentAttributes), ...Object.keys(nextAttributes)]),
    ).sort((left, right) => left.localeCompare(right));
    for (const key of attributeKeys) {
      const before = currentAttributes[key];
      const after = nextAttributes[key];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changedFields.push({
          path: `attributes.${key}`,
          label: `Attribute: ${key}`,
          before: before ?? null,
          after: after ?? null,
        });
      }
    }

    return changedFields;
  }

  private countChangedSections(changedFields: Array<{ path: string }>) {
    return new Set(
      changedFields.map((field) => {
        const [section] = field.path.split(".");
        return section || field.path;
      }),
    ).size;
  }

  private toProductRevision(
    log: {
      id: string;
      actorId: string;
      actorRole: string;
      action: string;
      metadata: Prisma.JsonValue;
      createdAt: Date;
    },
    productId: string,
  ) {
    const metadata = this.asRecord(log.metadata);
    if (metadata.model !== "Product") {
      return null;
    }
    const changedFields = Array.isArray(metadata.changedFields)
      ? metadata.changedFields
          .map((entry) => this.toProductRevisionFieldChange(entry))
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      : [];

    return {
      productId,
      revisionId: log.id,
      action: log.action,
      actorId: log.actorId,
      actorLabel: log.actorId.length > 8 ? `…${log.actorId.slice(-8)}` : log.actorId,
      actorRole: log.actorRole,
      createdAt: log.createdAt,
      changedFields,
      summary: {
        changedFieldCount:
          typeof metadata.changedFieldCount === "number"
            ? metadata.changedFieldCount
            : changedFields.length,
        changedSectionCount:
          typeof metadata.changedSectionCount === "number"
            ? metadata.changedSectionCount
            : this.countChangedSections(changedFields),
      },
      decisionNote: typeof metadata.decisionNote === "string" ? metadata.decisionNote : null,
    };
  }

  private toProductRevisionFieldChange(entry: unknown) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const value = entry as Record<string, unknown>;
    const path = String(value.path ?? "").trim();
    const label = String(value.label ?? "").trim();
    if (!path || !label) {
      return null;
    }
    return {
      path,
      label,
      before: value.before ?? null,
      after: value.after ?? null,
    };
  }

  // ─── RG-C4: Product Relationships ─────────────────────────────────────────

  async createRelationship(
    sourceProductId: string,
    dto: { targetProductId: string; type: ProductRelationshipType; quantityInParent?: number; sortOrder?: number },
    actor: ActorContext,
  ) {
    const tenantKey = actor.tenantId ?? "default";

    const [source, target] = await Promise.all([
      this.prisma.tenant().product.findFirst({ where: { id: sourceProductId, tenantKey, deletedAt: null } }),
      this.prisma.tenant().product.findFirst({ where: { id: dto.targetProductId, tenantKey, deletedAt: null } }),
    ]);
    if (!source) throw new NotFoundException("Source product not found");
    if (!target) throw new NotFoundException("Target product not found");
    if (sourceProductId === dto.targetProductId) throw new BadRequestException("Source and target must differ");

    try {
      const rel = await this.prisma.tenant().productRelationship.create({
        data: {
          id: `${sourceProductId}_${dto.targetProductId}_${dto.type}_${Date.now()}`,
          tenantKey,
          sourceProductId,
          targetProductId: dto.targetProductId,
          type: dto.type,
          quantityInParent: dto.quantityInParent ?? null,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
      return rel;
    } catch (err: unknown) {
      const msg = String((err as { message?: string }).message ?? "");
      if (msg.includes("uq_product_relationship_source_target_type")) {
        throw new ConflictException("Relationship of this type already exists between these products");
      }
      throw err;
    }
  }

  async listRelationships(productId: string, actor: ActorContext) {
    const tenantKey = actor.tenantId ?? "default";
    const product = await this.prisma.tenant().product.findFirst({ where: { id: productId, tenantKey, deletedAt: null } });
    if (!product) throw new NotFoundException("Product not found");

    const [from, to] = await Promise.all([
      this.prisma.tenant().productRelationship.findMany({
        where: { sourceProductId: productId, tenantKey },
        include: { targetProduct: { select: { id: true, title: true, status: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 500,
      }),
      this.prisma.tenant().productRelationship.findMany({
        where: { targetProductId: productId, tenantKey },
        include: { sourceProduct: { select: { id: true, title: true, status: true } } },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        take: 500,
      }),
    ]);

    return { outgoing: from, incoming: to };
  }

  async deleteRelationship(relationshipId: string, actor: ActorContext) {
    const tenantKey = actor.tenantId ?? "default";
    const rel = await this.prisma.tenant().productRelationship.findFirst({ where: { id: relationshipId, tenantKey } });
    if (!rel) throw new NotFoundException("Relationship not found");

    if (actor.role !== "admin" && actor.role !== "editor") {
      throw new ForbiddenException("Only admins and editors may delete product relationships");
    }

    await this.prisma.tenant().productRelationship.delete({ where: { id: relationshipId } });
    return { deleted: true };
  }
}
