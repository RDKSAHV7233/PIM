import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AccessPolicyService } from "../common/access-policy/access-policy.service";
import { CacheService } from "../common/cache/cache.service";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { type AppRole } from "../common/rbac/roles";
import { CreateAttributeDefinitionDto } from "./dto/create-attribute-definition.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateAttributeDefinitionDto } from "./dto/update-attribute-definition.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

type ActorContext = {
  id?: string;
  role?: AppRole;
  tenantId?: string;
  effectiveRoles?: string[];
};

@Injectable()
export class TaxonomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly cache: CacheService,
  ) {}

  async listCategories(
    pagination?: CursorPaginationQuery,
    options?: {
      all?: boolean;
    },
    actor?: ActorContext,
  ) {
    const scopeWhere = await this.accessPolicy.buildCategoryScopeWhere(this.toPolicyActor(actor), "view");
    if (options?.all) {
      return this.prisma.tenant().category.findMany({
        where: scopeWhere,
        orderBy: [{ path: "asc" }],
        take: 5_000, // defensive cap — category trees in any real PIM won't exceed this
      });
    }

    const limit = resolveCursorLimit(pagination?.limit ?? 100);
    const token = decodeCursorToken(pagination?.cursor);
    if (pagination?.cursor && !token) {
      throw new BadRequestException("Invalid cursor.");
    }
    const categories = await this.prisma.tenant().category.findMany({
      where: token
        ? {
            AND: [
              scopeWhere ?? {},
              {
                OR: [
                  { path: { gt: token.sort } },
                  {
                    path: token.sort,
                    id: { gt: token.id },
                  },
                ],
              },
            ],
          }
        : scopeWhere,
      orderBy: [{ path: "asc" }],
      take: limit + 1,
    });
    const hasNext = categories.length > limit;
    const items = hasNext ? categories.slice(0, limit) : categories;
    const last = items[items.length - 1];
    return {
      items,
      limit,
      nextCursor: hasNext && last
        ? encodeCursorToken({
            sort: last.path,
            id: last.id,
          })
        : null,
    };
  }

  async getCategory(id: string, actor?: ActorContext) {
    const category = await this.prisma.tenant().category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    await this.accessPolicy.assertCategoryAccess(this.toPolicyActor(actor), "view", category.id);
    return category;
  }

  async createCategory(dto: CreateCategoryDto) {
    const parent = dto.parentId
      ? await this.prisma.tenant().category.findUnique({ where: { id: dto.parentId } })
      : null;

    if (dto.parentId && !parent) {
      throw new NotFoundException("Parent category not found");
    }

    const normalizedName = dto.name.trim();
    const path = parent ? `${parent.path} > ${normalizedName}` : normalizedName;
    const slug = this.makeSlug(path);

    return this.prisma.tenant().category.create({
      data: {
        name: normalizedName,
        parentId: dto.parentId ?? null,
        path,
        slug: await this.ensureUniqueSlug(slug),
      },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const current = await this.prisma.tenant().category.findUnique({
      where: { id },
      include: { parent: true },
    });
    if (!current) {
      throw new NotFoundException("Category not found");
    }

    const normalizedName = dto.name.trim();
    const oldPath = current.path;
    const newPath = current.parent ? `${current.parent.path} > ${normalizedName}` : normalizedName;
    const descendants = await this.prisma.tenant().category.findMany({
      where: {
        path: {
          startsWith: `${oldPath} > `,
        },
      },
      orderBy: [{ path: "asc" }, { id: "asc" }],
      take: 5_000, // defensive cap — bounded by total category count
    });
    const affectedIds = [id, ...descendants.map((child) => child.id)];
    const existingSlugs = new Set(
      (
        await this.prisma.tenant().category.findMany({
          where: {
            id: {
              notIn: affectedIds,
            },
          },
          take: 5_000, // defensive cap — slug collision check across all categories
          select: {
            slug: true,
          },
        })
      ).map((category) => category.slug),
    );
    const plannedUpdates = [
      {
        id,
        name: normalizedName,
        path: newPath,
        slug: this.reserveUniqueSlug(this.makeSlug(newPath), existingSlugs),
      },
      ...descendants.map((child) => {
        const childPath = `${newPath}${child.path.slice(oldPath.length)}`;
        return {
          id: child.id,
          name: child.name,
          path: childPath,
          slug: this.reserveUniqueSlug(this.makeSlug(childPath), existingSlugs),
        };
      }),
    ];

    const [updated] = await this.prisma.tenant().$transaction(
      plannedUpdates.map((item) =>
        this.prisma.tenant().category.update({
          where: { id: item.id },
          data: {
            name: item.id === id ? item.name : undefined,
            path: item.path,
            slug: item.slug,
          },
        }),
      ),
    );
    return updated;
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.tenant().category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }

    const childCount = await this.prisma.tenant().category.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new BadRequestException("Cannot delete category with child categories");
    }

    const productCount = await this.prisma.tenant().product.count({ where: { categoryId: id, deletedAt: null } });
    if (productCount > 0) {
      throw new BadRequestException("Cannot delete category with attached products");
    }

    const importJobCount = await this.prisma.tenant().bulkImportJob.count({ where: { categoryId: id } });
    if (importJobCount > 0) {
      throw new BadRequestException("Cannot delete category with existing import jobs. Archive or remove the import jobs first.");
    }

    await this.prisma.tenant().category.delete({ where: { id } });
  }

  async listAttributeDefinitions(categoryId: string, actor?: ActorContext) {
    await this.getCategory(categoryId, actor);
    return this.prisma.tenant().attributeDefinition.findMany({
      where: { categoryId },
      orderBy: [{ appliesTo: "asc" }, { key: "asc" }],
      take: 500, // defensive cap — attribute definitions per category
    });
  }

  async createAttributeDefinition(categoryId: string, dto: CreateAttributeDefinitionDto, actor?: ActorContext) {
    await this.getCategory(categoryId, actor);
    await this.accessPolicy.assertCategoryAccess(this.toPolicyActor(actor), "edit", categoryId, "AttributeDefinition");
    try {
      const definition = await this.prisma.tenant().attributeDefinition.create({
        data: {
          categoryId,
          key: this.normalizeKey(dto.key),
          name: dto.name.trim(),
          dataType: dto.dataType,
          required: dto.required,
          appliesTo: dto.appliesTo,
          allowedValues: (dto.allowedValues ?? undefined) as Prisma.JsonObject | undefined,
        },
      });
      await this.invalidateAttributeCaches();
      return definition;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Attribute key already exists for this category and target.");
      }
      throw error;
    }
  }

  async updateAttributeDefinition(attributeId: string, dto: UpdateAttributeDefinitionDto, actor?: ActorContext) {
    const attribute = await this.requireAttributeDefinition(attributeId);
    await this.accessPolicy.assertCategoryAccess(
      this.toPolicyActor(actor),
      "edit",
      attribute.categoryId,
      "AttributeDefinition",
      attributeId,
    );
    try {
      const definition = await this.prisma.tenant().attributeDefinition.update({
        where: { id: attributeId },
        data: {
          key: this.normalizeKey(dto.key),
          name: dto.name.trim(),
          dataType: dto.dataType,
          required: dto.required,
          appliesTo: dto.appliesTo,
          allowedValues: (dto.allowedValues ?? undefined) as Prisma.JsonObject | undefined,
        },
      });
      await this.invalidateAttributeCaches();
      return definition;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Attribute key already exists for this category and target.");
      }
      throw error;
    }
  }

  async deleteAttributeDefinition(attributeId: string, actor?: ActorContext) {
    const attribute = await this.requireAttributeDefinition(attributeId);
    await this.accessPolicy.assertCategoryAccess(
      this.toPolicyActor(actor),
      "delete",
      attribute.categoryId,
      "AttributeDefinition",
      attributeId,
    );
    await this.prisma.tenant().attributeDefinition.delete({ where: { id: attributeId } });
    await this.invalidateAttributeCaches();
  }

  /**
   * Bust compliance-attr and completeness-required caches for the current tenant.
   * Called after any AttributeDefinition write — both cache namespaces read from
   * the same underlying table.
   */
  private async invalidateAttributeCaches(): Promise<void> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    await Promise.all([
      this.cache.invalidateByPrefix(`compliance:attrs:${tenantKey}`),
      this.cache.invalidateByPrefix(`completeness:required:${tenantKey}`),
    ]);
  }

  private makeSlug(value: string) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 150);
  }

  private normalizeKey(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private async requireAttributeDefinition(attributeId: string) {
    const attribute = await this.prisma.tenant().attributeDefinition.findUnique({ where: { id: attributeId } });
    if (!attribute) {
      throw new NotFoundException("Attribute definition not found");
    }
    return attribute;
  }

  private async ensureUniqueSlug(baseSlug: string, currentId?: string): Promise<string> {
    const root = baseSlug || "category";
    let index = 0;
    while (true) {
      const candidate = index === 0 ? root : `${root}-${index}`;
      const existing = await this.prisma.tenant().category.findFirst({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing || existing.id === currentId) {
        return candidate;
      }
      index += 1;
    }
  }

  private reserveUniqueSlug(baseSlug: string, reservedSlugs: Set<string>) {
    const root = baseSlug || "category";
    let index = 0;
    while (true) {
      const candidate = index === 0 ? root : `${root}-${index}`;
      if (!reservedSlugs.has(candidate)) {
        reservedSlugs.add(candidate);
        return candidate;
      }
      index += 1;
    }
  }

  private toPolicyActor(actor?: ActorContext) {
    return {
      actorId: actor?.id,
      actorRole: actor?.role,
      tenantId: actor?.tenantId,
      effectiveRoles: actor?.effectiveRoles,
    };
  }
}
