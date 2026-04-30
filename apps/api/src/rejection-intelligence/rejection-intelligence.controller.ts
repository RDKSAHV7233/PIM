import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { ApiClientScopes, DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { FoundationRoleAccess } from "../common/rbac/foundation-role-access.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { DEFAULT_MARKETPLACE_CHANNEL } from "../marketplace/marketplace-channels";
import { RejectionIntelligenceService } from "./rejection-intelligence.service";

type AuthenticatedRequest = Request & {
  pimUserId?: string;
  pimRole?: AppRole;
  pimTenant?: string;
  pimEffectiveRoles?: string[];
};

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "scope_filtered", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("rejection-intelligence")
export class RejectionIntelligenceController {
  constructor(private readonly rejectionIntelligenceService: RejectionIntelligenceService) {}

  private resolveActor(request: AuthenticatedRequest) {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
      effectiveRoles: request.pimEffectiveRoles,
    };
  }

  @Get("products/:id/score")
  @FoundationRoleAccess("vendor")
  @AuthenticatedReadRoute({ classification: "scope_filtered", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("rejection_intelligence.read")
  @Roles("admin", "editor", "reviewer")
  scoreProduct(
    @Param("id") productId: string,
    @Query("channel") channel = DEFAULT_MARKETPLACE_CHANNEL,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.rejectionIntelligenceService.scoreProduct(productId, channel, this.resolveActor(request));
  }
}
