import { Controller, ForbiddenException, Get, Req } from "@nestjs/common";
import type { Request } from "express";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { type AppRole, Roles } from "../common/rbac/roles";
import { InternalOpsSummaryService } from "./internal-ops-summary.service";

type InternalOpsRequest = Request & {
  pimRole?: AppRole;
};

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@AdminBoundaryAccess({
  allowedRoles: ["system_admin", "super_admin"],
  allowLegacyAdminFallback: false,
})
@Controller("internal/ops")
export class InternalOpsController {
  constructor(private readonly summaryService: InternalOpsSummaryService) {}

  @Get("summary")
  @Roles("admin")
  getSummary(@Req() request: InternalOpsRequest) {
    assertAdminAppRole(request);
    return this.summaryService.getSummary();
  }
}

function assertAdminAppRole(request: InternalOpsRequest) {
  if (request.pimRole !== "admin") {
    throw new ForbiddenException({
      error: "ACCESS_POLICY_DENIED",
      reason: "ADMIN_APP_ROLE_REQUIRED",
      resource: request.url ?? "internal/ops/summary",
    });
  }
}
