import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { Roles } from "../common/rbac/roles";
import { CreateAttributeDefinitionDto } from "./dto/create-attribute-definition.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateAttributeDefinitionDto } from "./dto/update-attribute-definition.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { TaxonomyService } from "./taxonomy.service";

@Controller("taxonomy/categories")
@DisallowApiClient()
export class TaxonomyController {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  @Get()
  @ReadAccessPolicy("taxonomy_safe_metadata")
  listCategories(@Query() pagination: CursorPaginationDto, @Query("all") all?: string) {
    // Unbounded tree fetch is deprecated for default callers; pass ?all=true when the full tree is required.
    return this.taxonomyService.listCategories(pagination, { all: all === "true" });
  }

  @Get(":id")
  @ReadAccessPolicy("taxonomy_safe_metadata")
  getCategory(@Param("id") id: string) {
    return this.taxonomyService.getCategory(id);
  }

  @Post()
  @Roles("admin")
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.taxonomyService.createCategory(dto);
  }

  @Patch(":id")
  @Roles("admin")
  updateCategory(@Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.taxonomyService.updateCategory(id, dto);
  }

  @Delete(":id")
  @Roles("admin")
  deleteCategory(@Param("id") id: string) {
    return this.taxonomyService.deleteCategory(id);
  }

  @Get(":id/attributes")
  @ReadAccessPolicy("taxonomy_safe_metadata")
  listAttributeDefinitions(@Param("id") categoryId: string) {
    return this.taxonomyService.listAttributeDefinitions(categoryId);
  }

  @Post(":id/attributes")
  @Roles("admin")
  createAttributeDefinition(
    @Param("id") categoryId: string,
    @Body() dto: CreateAttributeDefinitionDto,
  ) {
    return this.taxonomyService.createAttributeDefinition(categoryId, dto);
  }

  @Patch("attributes/:attributeId")
  @Roles("admin")
  updateAttributeDefinition(
    @Param("attributeId") attributeId: string,
    @Body() dto: UpdateAttributeDefinitionDto,
  ) {
    return this.taxonomyService.updateAttributeDefinition(attributeId, dto);
  }

  @Delete("attributes/:attributeId")
  @Roles("admin")
  deleteAttributeDefinition(@Param("attributeId") attributeId: string) {
    return this.taxonomyService.deleteAttributeDefinition(attributeId);
  }
}
