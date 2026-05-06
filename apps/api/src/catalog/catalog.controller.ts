import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { ApiClientPolicy, ApiClientScopes } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { FoundationRoleAccess } from "../common/rbac/foundation-role-access.decorator";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { CatalogService } from "./catalog.service";
import { CreateApprovalCommentDto } from "./dto/create-approval-comment.dto";
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

  private resolveActor(
    request: Request & {
      pimUserId?: string;
      pimRole?: AppRole;
      pimTenant?: string;
      pimEffectiveRoles?: string[];
    },
  ) {
    return {
      id: request.pimUserId ?? "system",
      role: request.pimRole ?? "viewer",
      tenantId: request.pimTenant,
      effectiveRoles: request.pimEffectiveRoles,
    } as const;
  }

  @Get("stats")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_stats_redacted")
  stats(@Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string }) {
    return this.catalogService.stats(this.resolveActor(request));
  }

  @Get("products")
  @FoundationRoleAccess("category_manager", "vendor")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_products_redacted")
  @ApiOperation({ summary: "List products" })
  @ApiResponse({ status: 200, description: "Products fetched" })
  listProducts(
    @Query() pagination: CursorPaginationDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
    @Query("slim") slim?: string,
  ) {
    // Full list payload remains available for legacy callers; prefer ?slim=true for list surfaces.
    return this.catalogService.listProducts(pagination, { slim: slim === "true" }, this.resolveActor(request));
  }

  @Get("products/search")
  @FoundationRoleAccess("category_manager", "vendor")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_search_redacted")
  @ApiOperation({ summary: "Search products by title or SKU" })
  @ApiResponse({ status: 200, description: "Product search results fetched" })
  searchProducts(
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
    @Query("q") query?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    return this.catalogService.searchProducts(query, parsedLimit, this.resolveActor(request));
  }

  @Get("products/:id")
  @FoundationRoleAccess("category_manager", "vendor")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_product_detail_redacted")
  @ApiOperation({ summary: "Get product by id" })
  @ApiResponse({ status: 200, description: "Product fetched" })
  getProduct(
    @Param("id") id: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.catalogService.getProduct(id, this.resolveActor(request));
  }

  @Post("products")
  @FoundationRoleAccess("category_manager")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("skus")
  @ApiOperation({ summary: "Create product" })
  @ApiResponse({ status: 201, description: "Product created" })
  @ApiResponse({ status: 402, description: "Plan limit exceeded" })
  createProduct(
    @Body() dto: CreateProductDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.catalogService.createProduct(dto, this.resolveActor(request));
  }

  @Patch("products/:id")
  @FoundationRoleAccess("category_manager")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Update product" })
  @ApiResponse({ status: 200, description: "Product updated" })
  updateProduct(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
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
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.catalogService.decideProductReview(id, dto, this.resolveActor(request));
  }

  @Post("products/:id/review-comments")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor", "reviewer")
  @ApiOperation({ summary: "Add a comment to the approval thread for a product" })
  @ApiResponse({ status: 201, description: "Comment added" })
  addApprovalComment(
    @Param("id") id: string,
    @Body() dto: CreateApprovalCommentDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.catalogService.addApprovalComment(id, dto, this.resolveActor(request));
  }

  @Get("products/:id/review-comments")
  @FoundationRoleAccess("category_manager", "vendor")
  @ApiClientScopes("catalog.read")
  @Roles("admin", "editor", "reviewer", "viewer")
  @ApiOperation({ summary: "List approval comments for a product" })
  @ApiResponse({ status: 200, description: "Comments fetched" })
  listApprovalComments(
    @Param("id") id: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.catalogService.listApprovalComments(id, this.resolveActor(request));
  }

  @Get("products/:id/activity")
  @FoundationRoleAccess("category_manager", "vendor")
  @ApiClientScopes("catalog.read")
  @Roles("admin", "editor", "reviewer", "viewer")
  @ApiOperation({ summary: "Get activity timeline for a product" })
  @ApiResponse({ status: 200, description: "Activity events fetched" })
  getProductActivity(
    @Param("id") id: string,
    @Query("limit") limit?: string,
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    const parsedLimit = limit ? Math.min(Number(limit), 100) : 50;
    return this.catalogService.getProductActivity(id, this.resolveActor(request as Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] }), parsedLimit);
  }

  @Delete("products/:id")
  @FoundationRoleAccess("category_manager")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  deleteProduct(
    @Param("id") id: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.catalogService.deleteProduct(id, this.resolveActor(request));
  }

  @Delete("products/:id/purge")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @ApiClientScopes("catalog.write")
  @Roles("admin")
  purgeProduct(
    @Param("id") id: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.catalogService.purgeProduct(id, this.resolveActor(request));
  }

  @Get("products/:id/variants")
  @FoundationRoleAccess("category_manager", "vendor")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_variants_redacted")
  listVariants(
    @Param("id") productId: string,
    @Query() pagination: CursorPaginationDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.catalogService.listVariants(productId, pagination, this.resolveActor(request));
  }

  @Post("products/:id/variants")
  @FoundationRoleAccess("category_manager")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  createVariant(
    @Param("id") productId: string,
    @Body() dto: CreateVariantDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.catalogService.createVariant(productId, dto, this.resolveActor(request));
  }

  @Patch("variants/:id")
  @FoundationRoleAccess("category_manager")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  updateVariant(
    @Param("id") variantId: string,
    @Body() dto: UpdateVariantDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.catalogService.updateVariant(variantId, dto, this.resolveActor(request));
  }

  @Delete("variants/:id")
  @FoundationRoleAccess("category_manager")
  @ApiClientScopes("catalog.write")
  @Roles("admin", "editor")
  deleteVariant(
    @Param("id") variantId: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.catalogService.deleteVariant(variantId, this.resolveActor(request));
  }
}
