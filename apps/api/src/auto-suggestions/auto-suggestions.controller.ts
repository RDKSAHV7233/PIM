import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { AutoSuggestionsService } from "./auto-suggestions.service";

@Controller("auto-suggestions")
export class AutoSuggestionsController {
  constructor(private readonly autoSuggestionsService: AutoSuggestionsService) {}

  @Get("products/:id/title-suggestion")
  getTitleSuggestion(@Param("id") productId: string) {
    return this.autoSuggestionsService.getTitleSuggestion(productId);
  }

  @Get("products/:id/attribute-enrichment")
  getAttributeEnrichment(@Param("id") productId: string) {
    return this.autoSuggestionsService.getAttributeEnrichment(productId);
  }

  @Get("products/:id/category-suggestion")
  getCategorySuggestion(@Param("id") productId: string) {
    return this.autoSuggestionsService.getCategorySuggestion(productId);
  }

  @Post("products/:id/repair")
  applyRepair(@Param("id") productId: string, @Body() body: { apply?: boolean }) {
    return this.autoSuggestionsService.applyRepair(productId, Boolean(body?.apply));
  }
}
