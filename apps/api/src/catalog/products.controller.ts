import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { ApiClientPolicy, ApiClientScopes } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { AppRole } from "../common/rbac/roles";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { CatalogService } from "./catalog.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { UpdateProductDto } from "./dto/update-product.dto";

@Controller("products")
@ApiClientPolicy("allowed_with_api_scope")
@ApiTags("Products")
export class ProductsController {
  constructor(private readonly catalogService: CatalogService) {}

  private resolveActor(request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string }) {
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
    @Query() pagination: CursorPaginationDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.listProducts(pagination, undefined, this.resolveActor(request));
  }

  @Post()
  @ApiClientScopes("catalog.write")
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

  @Get(":id")
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

  @Patch(":id")
  @ApiClientScopes("catalog.write")
  @ApiOperation({ summary: "Update product" })
  @ApiResponse({ status: 200, description: "Product updated" })
  updateProduct(
    @Param("id") id: string,
    @Body() dto: UpdateProductDto,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.catalogService.updateProduct(id, dto, this.resolveActor(request));
  }
}
