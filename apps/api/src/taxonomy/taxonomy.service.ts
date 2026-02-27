import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAttributeDefinitionDto } from "./dto/create-attribute-definition.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateAttributeDefinitionDto } from "./dto/update-attribute-definition.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";

@Injectable()
export class TaxonomyService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories() {
    return this.prisma.category.findMany({
      orderBy: [{ path: "asc" }],
    });
  }

  async getCategory(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  async createCategory(dto: CreateCategoryDto) {
    const parent = dto.parentId
      ? await this.prisma.category.findUnique({ where: { id: dto.parentId } })
      : null;

    if (dto.parentId && !parent) {
      throw new NotFoundException("Parent category not found");
    }

    const normalizedName = dto.name.trim();
    const path = parent ? `${parent.path} > ${normalizedName}` : normalizedName;
    const slug = this.makeSlug(path);

    return this.prisma.category.create({
      data: {
        name: normalizedName,
        parentId: dto.parentId ?? null,
        path,
        slug: await this.ensureUniqueSlug(slug),
      },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const current = await this.prisma.category.findUnique({
      where: { id },
      include: { parent: true },
    });
    if (!current) {
      throw new NotFoundException("Category not found");
    }

    const normalizedName = dto.name.trim();
    const newPath = current.parent ? `${current.parent.path} > ${normalizedName}` : normalizedName;
    const newSlug = await this.ensureUniqueSlug(this.makeSlug(newPath), id);

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        name: normalizedName,
        path: newPath,
        slug: newSlug,
      },
    });

    await this.refreshDescendantPaths(updated.id);
    return updated;
  }

  async deleteCategory(id: string) {
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }

    const childCount = await this.prisma.category.count({ where: { parentId: id } });
    if (childCount > 0) {
      throw new BadRequestException("Cannot delete category with child categories");
    }

    const productCount = await this.prisma.product.count({ where: { categoryId: id } });
    if (productCount > 0) {
      throw new BadRequestException("Cannot delete category with attached products");
    }

    await this.prisma.category.delete({ where: { id } });
  }

  async listAttributeDefinitions(categoryId: string) {
    await this.getCategory(categoryId);
    return this.prisma.attributeDefinition.findMany({
      where: { categoryId },
      orderBy: [{ appliesTo: "asc" }, { key: "asc" }],
    });
  }

  async createAttributeDefinition(categoryId: string, dto: CreateAttributeDefinitionDto) {
    await this.getCategory(categoryId);
    try {
      return await this.prisma.attributeDefinition.create({
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
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Attribute key already exists for this category and target.");
      }
      throw error;
    }
  }

  async updateAttributeDefinition(attributeId: string, dto: UpdateAttributeDefinitionDto) {
    await this.requireAttributeDefinition(attributeId);
    try {
      return await this.prisma.attributeDefinition.update({
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
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Attribute key already exists for this category and target.");
      }
      throw error;
    }
  }

  async deleteAttributeDefinition(attributeId: string) {
    await this.requireAttributeDefinition(attributeId);
    await this.prisma.attributeDefinition.delete({ where: { id: attributeId } });
  }

  private async refreshDescendantPaths(parentId: string) {
    const parent = await this.prisma.category.findUnique({ where: { id: parentId } });
    if (!parent) {
      return;
    }

    const children = await this.prisma.category.findMany({
      where: { parentId },
      orderBy: [{ name: "asc" }],
    });

    for (const child of children) {
      const path = `${parent.path} > ${child.name}`;
      const slug = await this.ensureUniqueSlug(this.makeSlug(path), child.id);
      await this.prisma.category.update({
        where: { id: child.id },
        data: { path, slug },
      });
      await this.refreshDescendantPaths(child.id);
    }
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
    const attribute = await this.prisma.attributeDefinition.findUnique({ where: { id: attributeId } });
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
      const existing = await this.prisma.category.findUnique({ where: { slug: candidate } });
      if (!existing || existing.id === currentId) {
        return candidate;
      }
      index += 1;
    }
  }
}
