import { Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { AuditService } from "../audit/audit.service";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { type AppRole, Roles } from "../common/rbac/roles";
import { ListErrorIssuesDto } from "./dto/list-error-issues.dto";
import { ListErrorOccurrencesDto } from "./dto/list-error-occurrences.dto";
import { ErrorAuthorityOpsService } from "./error-authority-ops.service";

type ErrorOpsRequest = Request & {
  pimRole?: AppRole;
  pimUserId?: string;
};

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@AdminBoundaryAccess({
  allowedRoles: ["system_admin", "super_admin"],
  allowLegacyAdminFallback: false,
})
@Controller("error-authority/ops")
export class ErrorAuthorityOpsController {
  constructor(
    private readonly opsService: ErrorAuthorityOpsService,
    private readonly auditService: AuditService,
  ) {}

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

  /**
   * PIM#766 Part 1: manual resolve. Same access decoration as the reads
   * above (human-only admin + system/super boundary role) — this is a
   * mutation, but it's ops triage, not a tenant-facing write.
   */
  @Post("issues/:issueId/resolve")
  @Roles("admin")
  @HttpCode(200)
  async resolveIssue(@Param("issueId") issueId: string, @Req() request: ErrorOpsRequest) {
    assertAdminAppRole(request);
    const result = await this.opsService.resolveIssue(issueId);
    // Explicit audit call (PLATFORM_TENANT_PROVISIONED pattern, see
    // platform-admin.controller.ts) in addition to the generic AuditLogInterceptor
    // record every mutating route already gets — this one carries a
    // meaningful action name and the fields an ops investigation needs.
    await this.auditService.record({
      actorId:
        typeof request.pimUserId === "string" && request.pimUserId.trim().length > 0
          ? request.pimUserId.trim()
          : "system",
      actorRole: request.pimRole ?? "admin",
      action: "ERROR_ISSUE_RESOLVED",
      resource: "ERROR_ISSUE",
      resourceId: issueId,
      metadata: {
        fingerprint: result.fingerprint,
        service: result.service,
        runtime: result.runtime,
        severity: result.severity,
        previousState: result.previousState,
      },
    });
    return { id: result.id, state: result.state };
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
