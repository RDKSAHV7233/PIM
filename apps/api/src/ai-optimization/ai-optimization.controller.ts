import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AiOptimizationService } from "./ai-optimization.service";

@Controller("ai-optimization")
export class AiOptimizationController {
  constructor(private readonly aiOptimizationService: AiOptimizationService) {}

  @Get("products/:id/title-suggestion")
  suggestTitle(@Param("id") productId: string) {
    return this.aiOptimizationService.suggestTitle(productId);
  }

  @Get("products/:id/attribute-enrichment")
  suggestAttributeEnrichment(@Param("id") productId: string) {
    return this.aiOptimizationService.suggestAttributeEnrichment(productId);
  }

  @Get("products/:id/category-suggestion")
  suggestCategory(@Param("id") productId: string) {
    return this.aiOptimizationService.suggestCategory(productId);
  }

  @Post("products/:id/repair")
  repairProduct(@Param("id") productId: string, @Body() body: { apply?: boolean }) {
    return this.aiOptimizationService.repairProduct(productId, Boolean(body?.apply));
  }
}
