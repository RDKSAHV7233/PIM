import { Controller, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { IntelligenceService } from "./intelligence.service";

type AuthenticatedRequest = Request & {
  pimUserId?: string;
  pimRole?: AppRole;
  pimTenant?: string;
  pimEffectiveRoles?: string[];
};

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("intelligence")
@Roles("admin", "editor")
export class IntelligenceController {
  constructor(private readonly intelligenceService: IntelligenceService) {}

  @Get("boundary")
  getBoundary(@Req() request: AuthenticatedRequest) {
    return this.intelligenceService.getBoundaryStatus({
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
      effectiveRoles: request.pimEffectiveRoles,
    });
  }
}
