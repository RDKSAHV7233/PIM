import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { CatalogService } from "./catalog.service";
import { CreateProductDto } from "./dto/create-product.dto";
import { CreateVariantDto } from "./dto/create-variant.dto";
import { UpdateProductDto } from "./dto/update-product.dto";
import { UpdateVariantDto } from "./dto/update-variant.dto";

@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("stats")
  stats() {
    return this.catalogService.stats();
  }

  @Get("products")
  listProducts() {
    return this.catalogService.listProducts();
  }

  @Get("products/:id")
  getProduct(@Param("id") id: string) {
    return this.catalogService.getProduct(id);
  }

  @Post("products")
  createProduct(@Body() dto: CreateProductDto) {
    return this.catalogService.createProduct(dto);
  }

  @Patch("products/:id")
  updateProduct(@Param("id") id: string, @Body() dto: UpdateProductDto) {
    return this.catalogService.updateProduct(id, dto);
  }

  @Delete("products/:id")
  deleteProduct(@Param("id") id: string) {
    return this.catalogService.deleteProduct(id);
  }

  @Get("products/:id/variants")
  listVariants(@Param("id") productId: string) {
    return this.catalogService.listVariants(productId);
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
