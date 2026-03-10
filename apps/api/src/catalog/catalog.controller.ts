import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { AppRole, Roles } from "../common/rbac/roles";
import { CatalogService } from "./catalog.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { DecideProductReviewDto } from "./dto/decide-product-review.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";

@Controller("catalog")
@ApiTags("Catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("stats")
  stats() {
    return this.catalogService.stats();
  }

  @Get("products")
  @ApiOperation({ summary: "List products" })
  @ApiResponse({ status: 200, description: "Products fetched" })
  listProducts(@Query() pagination: CursorPaginationDto) {
    return this.catalogService.listProducts(pagination);
  }

  @Get("products/:id")
  @ApiOperation({ summary: "Get product by id" })
  @ApiResponse({ status: 200, description: "Product fetched" })
  getProduct(@Param("id") id: string) {
    return this.catalogService.getProduct(id);
  }

  @Post("products")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("skus")
  @ApiOperation({ summary: "Create product" })
  @ApiResponse({ status: 201, description: "Product created" })
  @ApiResponse({ status: 402, description: "Plan limit exceeded" })
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalogService.createProduct(dto);
  }

  @Patch("products/:id")
  @ApiOperation({ summary: "Update product" })
  @ApiResponse({ status: 200, description: "Product updated" })
  updateProduct(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole },
  ) {
    const actorId = typeof request.pimUserId === "string" && request.pimUserId.trim().length > 0
      ? request.pimUserId.trim()
      : "system";
    const actorRole = request.pimRole ?? "admin";
    return this.catalogService.updateProduct(id, dto, {
      id: actorId,
      role: actorRole,
    });
  }

  @Post("products/:id/review-decision")
  @Roles("admin", "editor", "reviewer")
  @ApiOperation({ summary: "Approve or reject an in-review product" })
  @ApiResponse({ status: 201, description: "Review decision applied" })
  decideProductReview(
    @Param("id") id: string,
    @Body() dto: DecideProductReviewDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole },
  ) {
    const actorId = typeof request.pimUserId === "string" && request.pimUserId.trim().length > 0
      ? request.pimUserId.trim()
      : "system";
    const actorRole = request.pimRole ?? "viewer";
    return this.catalogService.decideProductReview(id, dto, {
      id: actorId,
      role: actorRole,
    });
  }

  @Delete("products/:id")
  deleteProduct(@Param("id") id: string) {
    return this.catalogService.deleteProduct(id);
  }

  @Delete("products/:id/purge")
  @Roles("admin")
  purgeProduct(
    @Param("id") id: string,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole },
  ) {
    const actorId = typeof request.pimUserId === "string" && request.pimUserId.trim().length > 0
      ? request.pimUserId.trim()
      : "system";
    return this.catalogService.purgeProduct(id, actorId);
  }

  @Get("products/:id/variants")
  listVariants(@Param("id") productId: string, @Query() pagination: CursorPaginationDto) {
    return this.catalogService.listVariants(productId, pagination);
  }

  @Post("products/:id/variants")
  createVariant(@Param("id") productId: string, @Body() dto: CreateVariantDto) {
    return this.catalogService.createVariant(productId, dto);
  }

  @Patch("variants/:id")
  updateVariant(@Param("id") variantId: string, @Body() dto: UpdateVariantDto) {
    return this.catalogService.updateVariant(variantId, dto);
  }

  @Delete("variants/:id")
  deleteVariant(@Param("id") variantId: string) {
    return this.catalogService.deleteVariant(variantId);
  }
}
