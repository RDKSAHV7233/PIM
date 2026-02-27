import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { CreateAttributeDefinitionDto } from "./dto/create-attribute-definition.dto";
import { CreateCategoryDto } from "./dto/create-category.dto";
import { UpdateAttributeDefinitionDto } from "./dto/update-attribute-definition.dto";
import { UpdateCategoryDto } from "./dto/update-category.dto";
import { TaxonomyService } from "./taxonomy.service";

@Controller("taxonomy/categories")
export class TaxonomyController {
  constructor(private readonly taxonomyService: TaxonomyService) {}

  @Get()
  listCategories() {
    return this.taxonomyService.listCategories();
  }

  @Get(":id")
  getCategory(@Param("id") id: string) {
    return this.taxonomyService.getCategory(id);
  }

  @Post()
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.taxonomyService.createCategory(dto);
  }

  @Patch(":id")
  updateCategory(@Param("id") id: string, @Body() dto: UpdateCategoryDto) {
    return this.taxonomyService.updateCategory(id, dto);
  }

  @Delete(":id")
  deleteCategory(@Param("id") id: string) {
    return this.taxonomyService.deleteCategory(id);
  }

  @Get(":id/attributes")
  listAttributeDefinitions(@Param("id") categoryId: string) {
    return this.taxonomyService.listAttributeDefinitions(categoryId);
  }

  @Post(":id/attributes")
  createAttributeDefinition(
    @Param("id") categoryId: string,
    @Body() dto: CreateAttributeDefinitionDto,
  ) {
    return this.taxonomyService.createAttributeDefinition(categoryId, dto);
  }

  @Patch("attributes/:attributeId")
  updateAttributeDefinition(
    @Param("attributeId") attributeId: string,
    @Body() dto: UpdateAttributeDefinitionDto,
  ) {
    return this.taxonomyService.updateAttributeDefinition(attributeId, dto);
  }

  @Delete("attributes/:attributeId")
  deleteAttributeDefinition(@Param("attributeId") attributeId: string) {
    return this.taxonomyService.deleteAttributeDefinition(attributeId);
  }
}
