import { Body, Controller, Get, NotFoundException, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ApiClientScopes, DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { FoundationRoleAccess } from "../common/rbac/foundation-role-access.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { AutoSuggestionsService } from "./auto-suggestions.service";
import { isInternalAiLabEnabled } from "./internal-ai-lab-flag";

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("auto-suggestions")
@Roles("admin", "editor")
export class AutoSuggestionsController {
  constructor(private readonly autoSuggestionsService: AutoSuggestionsService) {}

  private resolveActor(
    request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
      effectiveRoles: request.pimEffectiveRoles,
    };
  }

  @Get("products/:id/title-suggestion")
  @FoundationRoleAccess("vendor")
  @AuthenticatedReadRoute({ classification: "scope_filtered", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("auto_suggestions.read")
  getTitleSuggestion(
    @Param("id") productId: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.autoSuggestionsService.getTitleSuggestion(productId, this.resolveActor(request));
  }

  @Get("products/:id/attribute-enrichment")
  @FoundationRoleAccess("vendor")
  @AuthenticatedReadRoute({ classification: "scope_filtered", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("auto_suggestions.read")
  getAttributeEnrichment(
    @Param("id") productId: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.autoSuggestionsService.getAttributeEnrichment(productId, this.resolveActor(request));
  }

  @Get("products/:id/category-suggestion")
  @FoundationRoleAccess("vendor")
  @AuthenticatedReadRoute({ classification: "scope_filtered", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("auto_suggestions.read")
  getCategorySuggestion(
    @Param("id") productId: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.autoSuggestionsService.getCategorySuggestion(productId, this.resolveActor(request));
  }

  @Post("products/:id/repair")
  applyRepair(
    @Param("id") productId: string,
    @Body() body: { apply?: boolean },
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    // QA-AI-01 (#1236): persisting a repair writes the product directly, outside the governed proposal and approval path. It is
    // available only while the internal AI Lab flag is explicitly on; the dry run (apply=false) and the read suggestions are unchanged.
    // The same coercion as the service call below, so this gate and the service agree on what counts as "apply".
    const apply = Boolean(body?.apply);
    if (apply && !isInternalAiLabEnabled()) {
      throw new NotFoundException({ code: "FEATURE_DISABLED", message: "Not found" });
    }
    return this.autoSuggestionsService.applyRepair(productId, apply, this.resolveActor(request));
  }
}
