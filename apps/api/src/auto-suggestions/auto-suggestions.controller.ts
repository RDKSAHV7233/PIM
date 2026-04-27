import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { AutoSuggestionsService } from "./auto-suggestions.service";

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("auto-suggestions")
@Roles("admin", "editor")
export class AutoSuggestionsController {
  constructor(private readonly autoSuggestionsService: AutoSuggestionsService) {}

  private resolveActor(request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string }) {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    };
  }

  @Get("products/:id/title-suggestion")
  getTitleSuggestion(
    @Param("id") productId: string,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.autoSuggestionsService.getTitleSuggestion(productId, this.resolveActor(request));
  }

  @Get("products/:id/attribute-enrichment")
  getAttributeEnrichment(
    @Param("id") productId: string,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.autoSuggestionsService.getAttributeEnrichment(productId, this.resolveActor(request));
  }

  @Get("products/:id/category-suggestion")
  getCategorySuggestion(
    @Param("id") productId: string,
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.autoSuggestionsService.getCategorySuggestion(productId, this.resolveActor(request));
  }

  @Post("products/:id/repair")
  applyRepair(
    @Param("id") productId: string,
    @Body() body: { apply?: boolean },
    @Req() request: FastifyRequest & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.autoSuggestionsService.applyRepair(productId, Boolean(body?.apply), this.resolveActor(request));
  }
}
