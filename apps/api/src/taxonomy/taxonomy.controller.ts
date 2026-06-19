import { Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { ApiClientScopes, DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { FoundationRoleAccess } from "../common/rbac/foundation-role-access.decorator";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { CreateAttributeDefinitionDto } from "./dto/create-attribute-definition.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateAttributeDefinitionDto } from "./dto/update-attribute-definition.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { TaxonomyService } from "./taxonomy.service";

@Controller("taxonomy/categories")
@DisallowApiClient()
export class TaxonomyController {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  private resolveActor(
    request: Request & {
      pimUserId?: string;
      pimRole?: AppRole;
      pimTenant?: string;
      pimEffectiveRoles?: string[];
    },
  ) {
    return {
      id: request.pimUserId,
      role: request.pimRole,
      tenantId: request.pimTenant,
      effectiveRoles: request.pimEffectiveRoles,
    } as const;
  }

  @Get()
  @FoundationRoleAccess("category_manager")
  @ReadAccessPolicy("taxonomy_safe_metadata")
  @ApiClientScopes("taxonomy.read")
  @Header("Cache-Control", "private, max-age=60, stale-while-revalidate=300")
  listCategories(
    @Query() pagination: CursorPaginationDto,
    @Query("all") all?: string,
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    // Unbounded tree fetch is deprecated for default callers; pass ?all=true when the full tree is required.
    return this.taxonomyService.listCategories(pagination, { all: all === "true" }, this.resolveActor(request ?? {} as never));
  }

  @Get("counts")
  @FoundationRoleAccess("category_manager")
  @ReadAccessPolicy("taxonomy_safe_metadata")
  @ApiClientScopes("taxonomy.read")
  @Header("Cache-Control", "private, max-age=60, stale-while-revalidate=300")
  listCategoryCounts(
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.taxonomyService.listCategoryCounts(this.resolveActor(request ?? {} as never));
  }

  @Get(":id")
  @FoundationRoleAccess("category_manager")
  @ReadAccessPolicy("taxonomy_safe_metadata")
  @ApiClientScopes("taxonomy.read")
  getCategory(
    @Param("id") id: string,
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.taxonomyService.getCategory(id, this.resolveActor(request ?? {} as never));
  }

  @Post()
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.taxonomyService.createCategory(dto);
  }

  @Patch(":id")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  updateCategory(@Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.taxonomyService.updateCategory(id, dto);
  }

  @Delete(":id")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  deleteCategory(@Param("id") id: string) {
    return this.taxonomyService.deleteCategory(id);
  }

  @Get(":id/attributes")
  @FoundationRoleAccess("category_manager")
  @ReadAccessPolicy("taxonomy_safe_metadata")
  @ApiClientScopes("taxonomy.read")
  @Header("Cache-Control", "private, max-age=60, stale-while-revalidate=300")
  listAttributeDefinitions(
    @Param("id") categoryId: string,
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.taxonomyService.listAttributeDefinitions(categoryId, this.resolveActor(request ?? {} as never));
  }

  @Post(":id/attributes")
  @FoundationRoleAccess("category_manager")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  createAttributeDefinition(
    @Param("id") categoryId: string,
    @Body() dto: CreateAttributeDefinitionDto,
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.taxonomyService.createAttributeDefinition(categoryId, dto, this.resolveActor(request ?? {} as never));
  }

  @Patch("attributes/:attributeId")
  @FoundationRoleAccess("category_manager")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  updateAttributeDefinition(
    @Param("attributeId") attributeId: string,
    @Body() dto: UpdateAttributeDefinitionDto,
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.taxonomyService.updateAttributeDefinition(attributeId, dto, this.resolveActor(request ?? {} as never));
  }

  @Delete("attributes/:attributeId")
  @FoundationRoleAccess("category_manager")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  deleteAttributeDefinition(
    @Param("attributeId") attributeId: string,
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.taxonomyService.deleteAttributeDefinition(attributeId, this.resolveActor(request ?? {} as never));
  }
}
