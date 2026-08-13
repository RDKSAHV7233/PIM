import { Controller, ForbiddenException, Get, Param, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { type AppRole, Roles } from "../common/rbac/roles";
import { ListErrorIssuesDto } from "./dto/list-error-issues.dto";
import { ListErrorOccurrencesDto } from "./dto/list-error-occurrences.dto";
import { ErrorAuthorityOpsService } from "./error-authority-ops.service";

type ErrorOpsRequest = Request & {
  pimRole?: AppRole;
};

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@AdminBoundaryAccess({
  allowedRoles: ["system_admin", "super_admin"],
  allowLegacyAdminFallback: false,
})
@Controller("error-authority/ops")
export class ErrorAuthorityOpsController {
  constructor(private readonly opsService: ErrorAuthorityOpsService) {}

  @Get("issues")
  @Roles("admin")
  listIssues(@Query() query: ListErrorIssuesDto, @Req() request: ErrorOpsRequest) {
    assertAdminAppRole(request);
    return this.opsService.listIssues(query);
  }

  @Get("issues/:issueId/occurrences")
  @Roles("admin")
  listOccurrences(
    @Param("issueId") issueId: string,
    @Query() query: ListErrorOccurrencesDto,
    @Req() request: ErrorOpsRequest,
  ) {
    assertAdminAppRole(request);
    return this.opsService.listOccurrences(issueId, query);
  }
}

function assertAdminAppRole(request: ErrorOpsRequest) {
  if (request.pimRole !== "admin") {
    throw new ForbiddenException({
      error: "ACCESS_POLICY_DENIED",
      reason: "ADMIN_APP_ROLE_REQUIRED",
      resource: request.url ?? "error-authority/ops",
    });
  }
}
