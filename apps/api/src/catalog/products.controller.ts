import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ApiClientPolicy, ApiClientScopes } from "../common/rbac/api-client-policy.decorator";
import { AppRole } from "../common/rbac/roles";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { CatalogService } from "./catalog.service";
import { ListProductsQueryDto } from "./dto/list-products-query.dto";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";

@Controller("products")
@ApiClientPolicy("allowed_with_api_scope")
@ApiTags("Products")
export class ProductsController {
  constructor(private readonly catalogService: CatalogService) {}

  private resolveActor(request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string }) {
    return {
      id: request.pimUserId ?? "system",
      role: request.pimRole ?? "viewer",
      tenantId: request.pimTenant,
    } as const;
  }

  @Get()
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_products_redacted")
  @ApiOperation({ summary: "List products" })
  @ApiResponse({ status: 200, description: "Products fetched" })
  listProducts(
    @Query() query: ListProductsQueryDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.listProducts(query, { slim: query.slim === "true" }, this.resolveActor(request));
  }

  // No plan-limit guard here — see catalog.controller.ts's createProduct for why: a new
  // product is a draft with zero variants, and draft/parent-only records don't count
  // toward SKU usage. Enforced instead where a variant becomes sellable (approval).
  @Post()
  @ApiClientScopes("catalog.write")
  @ApiOperation({ summary: "Create product" })
  @ApiResponse({ status: 201, description: "Product created" })
  createProduct(
    @Body() dto: CreateProductDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.createProduct(dto, this.resolveActor(request));
  }

  @Get(":id")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_product_detail_redacted")
  @ApiOperation({ summary: "Get product by id" })
  @ApiResponse({ status: 200, description: "Product fetched" })
  getProduct(
    @Param("id") id: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.getProduct(id, this.resolveActor(request));
  }

  @Get(":id/revisions")
  @ApiClientScopes("catalog.read")
  @ReadAccessPolicy("catalog_product_detail_redacted")
  @ApiOperation({ summary: "Get product revision history" })
  @ApiResponse({ status: 200, description: "Revisions fetched" })
  getProductRevisions(
    @Param("id") id: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.getProductRevisions(id, this.resolveActor(request));
  }

  @Patch(":id")
  @ApiClientScopes("catalog.write")
  @ApiOperation({ summary: "Update product" })
  @ApiResponse({ status: 200, description: "Product updated" })
  updateProduct(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.updateProduct(id, dto, this.resolveActor(request));
  }
}
