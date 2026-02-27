import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RecordStatus } from "@prisma/client";
import { ComplianceService } from "../compliance/compliance.service";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceService: ComplianceService,
  ) {}

  async stats() {
    const [categories, products, variants] = await Promise.all([
      this.prisma.category.count(),
      this.prisma.product.count(),
      this.prisma.variant.count(),
    ]);
    return { categories, products, variants };
  }

  async listProducts() {
    return this.prisma.product.findMany({
      include: {
        category: true,
        variants: true,
        validationIssues: { where: { status: "open" } },
      },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  async getProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
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
    return product;
  }

  async createProduct(dto: CreateProductDto) {
    await this.requireCategory(dto.categoryId);
    const product = await this.prisma.product.create({
      data: {
        title: dto.title.trim(),
        description: dto.description.trim(),
        brand: dto.brand.trim(),
        categoryId: dto.categoryId,
        hsnCode: dto.hsnCode?.trim() || null,
        gstRate: dto.gstRate ?? null,
        attributes: (dto.attributes ?? {}) as Prisma.JsonObject,
        status: dto.status as RecordStatus,
      },
      include: { category: true, variants: true },
    });
    await this.complianceService.validateAndPersistProduct(product.id);
    return product;
  }

  async updateProduct(productId: string, dto: UpdateProductDto) {
    await this.requireProduct(productId);
    await this.requireCategory(dto.categoryId);
    const product = await this.prisma.product.update({
      where: { id: productId },
      data: {
        title: dto.title.trim(),
        description: dto.description.trim(),
        brand: dto.brand.trim(),
        categoryId: dto.categoryId,
        hsnCode: dto.hsnCode?.trim() || null,
        gstRate: dto.gstRate ?? null,
        attributes: (dto.attributes ?? {}) as Prisma.JsonObject,
        status: dto.status as RecordStatus,
      },
      include: { category: true, variants: true },
    });
    await this.complianceService.validateAndPersistProduct(product.id);
    return product;
  }

  async deleteProduct(productId: string) {
    await this.requireProduct(productId);
    await this.prisma.product.delete({ where: { id: productId } });
  }

  async listVariants(productId: string) {
    await this.requireProduct(productId);
    return this.prisma.variant.findMany({
      where: { productId },
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  async createVariant(productId: string, dto: CreateVariantDto) {
    await this.requireProduct(productId);
    this.validatePricing(dto.mrp, dto.sellingPrice);
    try {
      return await this.prisma.variant.create({
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
      return await this.prisma.variant.update({
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
    await this.prisma.variant.delete({ where: { id: variantId } });
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  private async requireProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return product;
  }

  private async requireVariant(variantId: string) {
    const variant = await this.prisma.variant.findUnique({ where: { id: variantId } });
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
}
