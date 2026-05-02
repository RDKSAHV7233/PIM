import { Body, Controller, Get, Patch, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { type AppRole, Roles } from "../common/rbac/roles";
import { AuthPolicyService } from "./auth-policy.service";
import { UpdateAuthPolicyDto } from "./dto/update-auth-policy.dto";

type AuthenticatedRequest = Request & {
  pimUserId?: string;
  pimTenant?: string;
  pimRole?: AppRole;
  pimJwtClaims?: {
    sub?: string;
    tenantId?: string;
    role?: AppRole;
  };
};

@Controller("admin/auth-policy")
@DisallowApiClient()
@AdminBoundaryAccess({ capability: "manage_security" })
@Roles("admin")
export class AuthPolicyController {
  constructor(private readonly authPolicyService: AuthPolicyService) {}

  @Get()
  @AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  getPolicy(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.authPolicyService.getPolicy(actor.tenantId);
  }

  @Patch()
  updatePolicy(@Req() request: AuthenticatedRequest, @Body() dto: UpdateAuthPolicyDto) {
    const actor = this.requireActor(request);
    return this.authPolicyService.updatePolicy(actor.tenantId, actor.userId, actor.role, dto);
  }

  private requireActor(request: AuthenticatedRequest): { userId: string; tenantId: string; role: AppRole } {
    const userId = request.pimUserId ?? request.pimJwtClaims?.sub;
    const tenantId = request.pimTenant ?? request.pimJwtClaims?.tenantId;
    const role = request.pimRole ?? request.pimJwtClaims?.role;
    if (!userId || !tenantId || !role) {
      throw new UnauthorizedException("Authenticated actor is required.");
    }
    return { userId, tenantId, role };
  }
}
