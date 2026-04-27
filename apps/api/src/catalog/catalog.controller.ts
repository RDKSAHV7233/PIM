import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { ApiClientPolicy, ApiClientScopes } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { CatalogService } from "./catalog.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { DecideProductReviewDto } from "./dto/decide-product-review.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";

@Controller("catalog")
@ApiClientPolicy("allowed_with_api_scope")
@ApiTags("Catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  private resolveActor(request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string }) {
    return {
      id: request.pimUserId ?? "system",
      role: request.pimRole ?? "viewer",
      tenantId: request.pimTenant,
    } as const;
  }

  @Get("stats")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_stats_redacted")
  stats(@Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string }) {
    return this.catalogService.stats(this.resolveActor(request));
  }

  @Get("products")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_products_redacted")
  @ApiOperation({ summary: "List products" })
  @ApiResponse({ status: 200, description: "Products fetched" })
  listProducts(
    @Query() pagination: CursorPaginationDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
    @Query("slim") slim?: string,
  ) {
    // Full list payload remains available for legacy callers; prefer ?slim=true for list surfaces.
    return this.catalogService.listProducts(pagination, { slim: slim === "true" }, this.resolveActor(request));
  }

  @Get("products/search")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_search_redacted")
  @ApiOperation({ summary: "Search products by title or SKU" })
  @ApiResponse({ status: 200, description: "Product search results fetched" })
  searchProducts(
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
    @Query("q") query?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.catalogService.searchProducts(query, parsedLimit, this.resolveActor(request));
  }

  @Get("products/:id")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_product_detail_redacted")
  @ApiOperation({ summary: "Get product by id" })
  @ApiResponse({ status: 200, description: "Product fetched" })
  getProduct(
    @Param("id") id: string,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.getProduct(id, this.resolveActor(request));
  }

  @Post("products")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("skus")
  @ApiOperation({ summary: "Create product" })
  @ApiResponse({ status: 201, description: "Product created" })
  @ApiResponse({ status: 402, description: "Plan limit exceeded" })
  createProduct(
    @Body() dto: CreateProductDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.createProduct(dto, this.resolveActor(request));
  }

  @Patch("products/:id")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Update product" })
  @ApiResponse({ status: 200, description: "Product updated" })
  updateProduct(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.updateProduct(id, dto, this.resolveActor(request));
  }

  @Post("products/:id/review-decision")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor", "reviewer")
  @ApiOperation({ summary: "Approve or reject an in-review product" })
  @ApiResponse({ status: 201, description: "Review decision applied" })
  decideProductReview(
    @Param("id") id: string,
    @Body() dto: DecideProductReviewDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.catalogService.decideProductReview(id, dto, this.resolveActor(request));
  }

  @Delete("products/:id")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  deleteProduct(
    @Param("id") id: string,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.deleteProduct(id, this.resolveActor(request));
  }

  @Delete("products/:id/purge")
  @ApiClientScopes("catalog.write")
  @Roles("admin")
  purgeProduct(
    @Param("id") id: string,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.catalogService.purgeProduct(id, this.resolveActor(request));
  }

  @Get("products/:id/variants")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_variants_redacted")
  listVariants(
    @Param("id") productId: string,
    @Query() pagination: CursorPaginationDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.listVariants(productId, pagination, this.resolveActor(request));
  }

  @Post("products/:id/variants")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  createVariant(
    @Param("id") productId: string,
    @Body() dto: CreateVariantDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.createVariant(productId, dto, this.resolveActor(request));
  }

  @Patch("variants/:id")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  updateVariant(
    @Param("id") variantId: string,
    @Body() dto: UpdateVariantDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.updateVariant(variantId, dto, this.resolveActor(request));
  }

  @Delete("variants/:id")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  deleteVariant(
    @Param("id") variantId: string,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.deleteVariant(variantId, this.resolveActor(request));
  }
}
