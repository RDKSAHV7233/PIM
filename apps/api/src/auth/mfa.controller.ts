import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AllowMfaEnrollmentToken } from "./allow-mfa-enrollment.decorator";
import { AllowSuspendedTenant } from "./allow-suspended.decorator";
import { SubmitMfaCodeDto } from "./dto/submit-mfa-code.dto";
import { type AppRole, APP_ROLES, Roles } from "../common/rbac/roles";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AuthService } from "./auth.service";
import { MfaService } from "./mfa.service";
import { Public } from "./public.decorator";
import { extractBearerToken } from "./jwt";

type AuthenticatedRequest = Request & {
  pimUserId?: string;
  pimTenant?: string;
  pimRole?: AppRole;
  pimJwtClaims?: {
    sub?: string;
    tenantId?: string;
    role?: AppRole;
    assignedRoles?: import("../common/rbac/roles").FoundationRole[];
  };
};

@Controller("auth/mfa")
@DisallowApiClient()
export class MfaController {
  constructor(
    private readonly mfaService: MfaService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @AuthenticatedReadRoute({ classification: "self_service", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @Roles(...APP_ROLES)
  @AllowSuspendedTenant()
  async getStatus(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.mfaService.getStatus(actor.userId, actor.tenantId);
  }

  @Post("request-enrollment-token")
  @HttpCode(200)
  @Roles(...APP_ROLES)
  @AllowSuspendedTenant()
  async requestEnrollmentToken(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    const assignedRoles = request.pimJwtClaims?.assignedRoles ?? [];
    return this.authService.issueEnrollmentToken(actor.userId, actor.tenantId, actor.role, assignedRoles);
  }

  @Post("enroll")
  @HttpCode(201)
  @Roles(...APP_ROLES)
  @AllowMfaEnrollmentToken()
  async beginEnrollment(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.mfaService.beginEnrollment(actor.userId, actor.tenantId, actor.role);
  }

  @Post("verify-enrollment")
  @HttpCode(200)
  @Roles(...APP_ROLES)
  @AllowMfaEnrollmentToken()
  async verifyEnrollment(@Req() request: AuthenticatedRequest, @Body() dto: SubmitMfaCodeDto) {
    const actor = this.requireActor(request);
    return this.mfaService.verifyEnrollment(actor.userId, actor.tenantId, actor.role, dto.code);
  }

  @Public()
  @Post("verify-login")
  @HttpCode(200)
  async verifyLogin(@Body() dto: SubmitMfaCodeDto, @Req() request: Request) {
    const rawToken = extractBearerToken(request.headers.authorization);
    if (!rawToken) {
      throw new UnauthorizedException({ error: "MFA_PENDING_TOKEN_REQUIRED" });
    }
    const result = await this.authService.verifyLoginMfa(rawToken, dto.code);
    if (result.type === "invalid_token") {
      throw new UnauthorizedException({ error: "MFA_PENDING_TOKEN_REQUIRED" });
    }
    if (result.type === "invalid_code") {
      throw new UnauthorizedException({ error: "MFA_CODE_INVALID" });
    }
    return result.payload;
  }

  @Post("backup-codes/regenerate")
  @HttpCode(200)
  @Roles(...APP_ROLES)
  async regenerateBackupCodes(@Req() request: AuthenticatedRequest, @Body() dto: SubmitMfaCodeDto) {
    const actor = this.requireActor(request);
    return this.mfaService.regenerateBackupCodes(actor.userId, actor.tenantId, actor.role, dto.code);
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
