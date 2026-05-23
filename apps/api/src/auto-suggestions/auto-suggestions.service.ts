import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AccessPolicyService, type PolicyActor, type ScopeAction } from "../common/access-policy/access-policy.service";
import { CacheService } from "../common/cache/cache.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";

type ProductShape = {
  id: string;
  title: string;
  description: string;
  brand: string;
  categoryId: string;
  attributes: unknown;
  status: string;
  vendorScopeKey: string | null;
};

@Injectable()
export class AutoSuggestionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicyService: AccessPolicyService,
    private readonly cache: CacheService,
  ) {}

  async getTitleSuggestion(productId: string, actor: PolicyActor) {
    const product = await this.requireProduct(productId, actor, "view", "AutoSuggestion");
    return this.buildTitleSuggestion(product);
  }

  async getAttributeEnrichment(productId: string, actor: PolicyActor) {
    const product = await this.requireProduct(productId, actor, "view", "AutoSuggestion");
    return this.buildAttributeEnrichment(product);
  }

  async getCategorySuggestion(productId: string, actor: PolicyActor) {
    const product = await this.requireProduct(productId, actor, "view", "AutoSuggestion");
    return this.buildCategorySuggestion(product);
  }

  async applyRepair(productId: string, apply: boolean, actor: PolicyActor) {
    const product = await this.requireProduct(productId, actor, "edit", "AutoSuggestionRepair");
    const titleSuggestion = this.buildTitleSuggestion(product);
    const enrichmentSuggestion = this.buildAttributeEnrichment(product);
    const categorySuggestion = await this.buildCategorySuggestion(product);
    const currentAttributes = this.asRecord(product.attributes);
    const mergedAttributes = {
      ...currentAttributes,
      ...enrichmentSuggestion.suggestedAttributes,
    };
    const patch = {
      title: titleSuggestion.optimizedTitle,
      categoryId: categorySuggestion.suggestedCategoryId,
      attributes: mergedAttributes,
    };

    if (!apply) {
      return {
        productId,
        apply: false,
        patch,
        note: "Dry-run only. Set apply=true to persist.",
      };
    }

    const updated = await this.prisma.tenant().product.update({
      where: { id: productId },
      data: {
        title: patch.title,
        categoryId: patch.categoryId,
        attributes: patch.attributes as Prisma.JsonObject,
      },
      include: { category: true },
    });

    return {
      productId,
      apply: true,
      patch,
      updated,
    };
  }

  private buildTitleSuggestion(product: ProductShape) {
    const attributes = this.asRecord(product.attributes);
    const tokens = [
      product.brand,
      product.title,
      typeof attributes.material === "string" ? attributes.material : null,
      typeof attributes.color === "string" ? attributes.color : null,
    ]
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);

    const optimizedTitle = Array.from(new Set(tokens)).join(" ").replace(/\s+/g, " ").trim();
    return {
      productId: product.id,
      originalTitle: product.title,
      optimizedTitle: optimizedTitle || product.title,
      confidence: optimizedTitle ? 0.78 : 0.5,
    };
  }

  private buildAttributeEnrichment(product: ProductShape) {
    const attributes = this.asRecord(product.attributes);
    const description = `${product.title} ${product.description}`.toLowerCase();
    const suggestions: Record<string, unknown> = {};

    if (!attributes.color) {
      const detectedColor = this.detectColor(description);
      if (detectedColor) {
        suggestions.color = detectedColor;
      }
    }
    if (!attributes.material) {
      const detectedMaterial = this.detectMaterial(description);
      if (detectedMaterial) {
        suggestions.material = detectedMaterial;
      }
    }
    if (!attributes.fit && description.includes("regular fit")) {
      suggestions.fit = "regular";
    }

    return {
      productId: product.id,
      existingAttributes: attributes,
      suggestedAttributes: suggestions,
      confidence: Object.keys(suggestions).length > 0 ? 0.74 : 0.42,
    };
  }

  private async buildCategorySuggestion(product: ProductShape) {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const categories = await this.cache.getOrSet(
      `auto-suggest:categories:${tenantKey}`,
      () => this.prisma.tenant().category.findMany({
        select: { id: true, name: true, path: true },
        take: 200,
      }),
      5 * 60,
    );
    const bag = `${product.title} ${product.description}`.toLowerCase();

    const ranked = categories
      .map((category) => {
        const categoryTokens = `${category.name} ${category.path}`.toLowerCase().split(/[^a-z0-9]+/g);
        const overlap = categoryTokens.filter((token) => token.length > 2 && bag.includes(token)).length;
        return { ...category, overlap };
      })
      .sort((a, b) => b.overlap - a.overlap);

    const best = ranked[0];
    return {
      productId: product.id,
      currentCategoryId: product.categoryId,
      suggestedCategoryId: best?.id ?? product.categoryId,
      suggestedCategoryPath: best?.path ?? null,
      confidence: best?.overlap ? Math.min(0.9, 0.4 + best.overlap * 0.1) : 0.35,
    };
  }

  private async requireProduct(
    productId: string,
    actor: PolicyActor,
    action: ScopeAction,
    resource: string,
  ): Promise<ProductShape> {
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        title: true,
        description: true,
        brand: true,
        categoryId: true,
        attributes: true,
        status: true,
        vendorScopeKey: true,
      },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    await this.accessPolicyService.assertProductAccess(
      actor,
      action,
      {
        id: product.id,
        categoryId: product.categoryId,
        brand: product.brand,
        vendorScopeKey: product.vendorScopeKey,
      },
      resource,
    );
    return product as ProductShape;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private detectColor(text: string) {
    const colors = ["black", "blue", "red", "green", "white", "grey", "yellow", "pink", "navy"];
    return colors.find((color) => text.includes(color)) ?? null;
  }

  private detectMaterial(text: string) {
    const materials = ["cotton", "linen", "polyester", "silk", "denim", "rayon", "viscose"];
    return materials.find((material) => text.includes(material)) ?? null;
  }
}
