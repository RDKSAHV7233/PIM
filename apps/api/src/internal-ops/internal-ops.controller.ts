import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/public.decorator";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { type AppRole, Roles } from "../common/rbac/roles";
import { requireInternalToken } from "../common/security/internal-token";
import { InternalOpsAlertsService } from "./internal-ops-alerts.service";
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
  constructor(
    private readonly summaryService: InternalOpsSummaryService,
    private readonly internalOpsAlertsService: InternalOpsAlertsService,
  ) {}

  @Get("summary")
  @Roles("admin")
  getSummary(@Req() request: InternalOpsRequest) {
    assertAdminAppRole(request);
    return this.summaryService.getSummary();
  }

  // #919/#921 follow-up: called by GitHub Actions on backup-job failure via
  // a plain Bearer-token auth so GitHub Secrets can hold the key directly.
  // @Public() bypasses JwtAuthGuard and RbacGuard; requireInternalToken()
  // provides timing-safe token validation with a per-IP rate-limit bucket.
  @Public()
  @Post("alerts/backup-job-failure")
  @HttpCode(204)
  async captureBackupJobFailure(
    @Headers("authorization") authHeader: string | undefined,
    @Body() body: Record<string, unknown>,
    @Req() request: Request,
  ): Promise<void> {
    const submittedToken = extractBearerToken(authHeader);
    const expectedToken = String(process.env.INTERNAL_OPS_API_KEY ?? "").trim();
    try {
      await requireInternalToken({
        routeKey: "internal.ops.alerts.backup-job-failure",
        expectedToken,
        submittedToken,
        request,
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException({ error: "INTERNAL_OPS_TOKEN_REQUIRED" });
      }
      throw error;
    }

    const workflowName = String(body?.workflowName ?? "").trim();
    const database = String(body?.database ?? "").trim();
    const errorSummary = body?.errorSummary != null ? String(body.errorSummary).trim() : undefined;

    if (!workflowName) {
      throw new BadRequestException({ error: "VALIDATION_ERROR", field: "workflowName", reason: "required" });
    }
    if (!database) {
      throw new BadRequestException({ error: "VALIDATION_ERROR", field: "database", reason: "required" });
    }

    await this.internalOpsAlertsService.captureBackupJobFailure({ workflowName, database, errorSummary });
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

function extractBearerToken(authHeader: string | undefined): string | undefined {
  const raw = String(authHeader ?? "").trim();
  if (raw.toLowerCase().startsWith("bearer ")) {
    return raw.slice("bearer ".length).trim();
  }
  return undefined;
}
