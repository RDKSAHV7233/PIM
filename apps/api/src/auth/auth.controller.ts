import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import type { Response } from "express";
import { AuthService, LoginResponse } from "./auth.service";
import { AllowSuspendedTenant } from "./allow-suspended.decorator";
import { ConfirmPasswordResetDto } from "./dto/confirm-password-reset.dto";
import { DeleteAccountDto } from "./dto/delete-account.dto";
import { LoginDto } from "./dto/login.dto";
import { RecordConsentDto } from "./dto/record-consent.dto";
import { RequestPasswordResetDto } from "./dto/request-password-reset.dto";
import { RequestAccountExportDto } from "./dto/request-account-export.dto";
import { ResendUnlockDto } from "./dto/resend-unlock.dto";
import { StepUpChallengeDto } from "./dto/step-up.dto";
import { PimJwtClaims } from "./jwt";
import { Public } from "./public.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { APP_ROLES, AppRole, Roles } from "../common/rbac/roles";

interface AuthenticatedRequest extends Request {
  pimJwtClaims?: PimJwtClaims;
  pimRole?: AppRole;
  pimTenant?: string;
  pimUserId?: string;
}

const REFRESH_COOKIE_NAME = "pim_refresh_token";
const REFRESH_COOKIE_PATH = "/api/v1/auth";
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function useSecureCookies(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return appEnv === "production" || appEnv === "staging";
}

function parseCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function setRefreshCookie(reply: Response, refreshToken: string): void {
  reply.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    sameSite: "strict",
    secure: useSecureCookies(),
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    path: REFRESH_COOKIE_PATH,
  });
}

function clearRefreshCookie(reply: Response): void {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}

@Controller("auth")
@DisallowApiClient()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("login")
  async login(
    @Body() dto: LoginDto,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Response,
  ): Promise<LoginResponse> {
    const result = await this.authService.login(dto, request.ip ?? "unknown");

    if (result.type === "rate_limited") {
      reply.header("X-RateLimit-Retry-After", String(result.retryAfterSeconds));
      throw new HttpException(
        {
          error: "IP_RATE_LIMITED",
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (result.type === "account_locked") {
      throw new HttpException(
        {
          error: "ACCOUNT_LOCKED",
          unlockAt: result.unlockAt,
          maskedEmail: result.maskedEmail,
        },
        HttpStatus.LOCKED,
      );
    }

    if (result.type === "invalid_credentials") {
      // Do not expose the exact attempt count — a precise number lets an attacker
      // stop just before lockout and rotate credentials, defeating the rate limit.
      throw new UnauthorizedException({ error: "INVALID_CREDENTIALS" });
    }

    if (result.type === "workspace_not_found") {
      throw new HttpException(
        {
          error: "WORKSPACE_NOT_FOUND",
        },
        HttpStatus.NOT_FOUND,
      );
    }

    if (result.type === "tenant_suspended") {
      throw new HttpException(
        {
          error: "TENANT_SUSPENDED",
          tenantId: result.tenantId,
          billingStatus: result.billingStatus,
          accessStatus: result.accessStatus,
          suspensionReason: result.suspensionReason,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (result.type === "mfa_required") {
      throw new HttpException(
        {
          error: "MFA_REQUIRED",
          mfaPendingToken: result.pendingToken,
          maskedEmail: result.maskedEmail,
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (result.type === "mfa_enrollment_required") {
      throw new HttpException(
        {
          error: "MFA_ENROLLMENT_REQUIRED",
          enrollmentToken: result.enrollmentToken,
          maskedEmail: result.maskedEmail,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (result.type === "auth_method_not_allowed") {
      throw new HttpException(
        {
          error: "AUTH_METHOD_NOT_ALLOWED",
          allowedMethods: result.allowedMethods,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    setRefreshCookie(reply, result.refreshToken);
    return result.payload;
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  async refresh(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: Response) {
    const refreshToken = parseCookie(request.headers.cookie, REFRESH_COOKIE_NAME);
    if (!refreshToken) {
      throw new UnauthorizedException({ error: "REFRESH_TOKEN_MISSING" });
    }
    const result = await this.authService.refresh(refreshToken);
    if (result.type === "invalid_token") {
      clearRefreshCookie(reply);
      throw new UnauthorizedException({ error: "REFRESH_TOKEN_INVALID" });
    }
    setRefreshCookie(reply, result.refreshToken);
    return {
      accessToken: result.accessToken,
      tokenType: "Bearer",
      expiresInSeconds: result.expiresInSeconds,
    };
  }

  @Public()
  @Post("resend-unlock")
  @HttpCode(200)
  async resendUnlock(
    @Body() dto: ResendUnlockDto,
    @Res({ passthrough: true }) reply: Response,
  ) {
    const result = await this.authService.resendUnlock(dto.email, dto.workspaceSlug);
    if (result.retryAfterSeconds > 0) {
      reply.header("X-RateLimit-Retry-After", String(result.retryAfterSeconds));
    }
    return result;
  }

  @Public()
  @Post("password-reset/request")
  @HttpCode(200)
  async requestPasswordReset(
    @Body() dto: RequestPasswordResetDto,
    @Res({ passthrough: true }) reply: Response,
  ) {
    const result = await this.authService.requestPasswordReset(dto.email);
    if (result.retryAfterSeconds > 0) {
      reply.header("X-RateLimit-Retry-After", String(result.retryAfterSeconds));
    }
    return result;
  }

  @Public()
  @Post("password-reset/confirm")
  @HttpCode(200)
  async confirmPasswordReset(@Body() dto: ConfirmPasswordResetDto) {
    return this.authService.confirmPasswordReset(dto.token, dto.password);
  }

  @Post("consent")
  @Roles(...APP_ROLES)
  @HttpCode(200)
  async recordConsent(@Body() dto: RecordConsentDto, @Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    if (!dto.accepted) {
      throw new BadRequestException({ error: "CONSENT_REQUIRED" });
    }
    return this.authService.recordConsent({
      userId: actor.userId,
      tenantId: actor.tenantId,
      role: actor.role,
      accepted: dto.accepted,
      policyVersion: dto.policyVersion,
      purpose: dto.purpose,
    });
  }

  @Get("account/privacy-status")
  @ReadAccessPolicy("account_privacy_self_service")
  @Roles(...APP_ROLES)
  @AllowSuspendedTenant()
  @HttpCode(200)
  async getPrivacyStatus(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.authService.getAccountPrivacyStatus(actor.userId, actor.tenantId);
  }

  @Post("account/export")
  @Roles(...APP_ROLES)
  @HttpCode(202)
  async requestAccountExport(@Body() dto: RequestAccountExportDto, @Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.authService.requestAccountExport({
      userId: actor.userId,
      tenantId: actor.tenantId,
      role: actor.role,
      format: dto.format,
    });
  }

  @Get("account/export/:jobId/download")
  @ReadAccessPolicy("account_export_download_self_service")
  @Roles(...APP_ROLES)
  @AllowSuspendedTenant()
  async downloadAccountExport(
    @Param("jobId") jobId: string,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: Response,
  ) {
    const actor = this.requireActor(request);
    const result = await this.authService.downloadAccountExport(jobId, actor.userId, actor.tenantId);
    if (result.kind === "binary") {
      reply.header("Content-Type", result.contentType);
      reply.header("Content-Disposition", `attachment; filename=\"${result.fileName}\"`);
      return result.content;
    }
    if (result.kind === "unavailable") {
      reply.status(HttpStatus.ACCEPTED);
      return result;
    }
    return result;
  }

  @Delete("account")
  @Roles(...APP_ROLES)
  @AllowSuspendedTenant()
  @HttpCode(202)
  async deleteAccount(@Body() dto: DeleteAccountDto, @Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    if (dto.confirmation.trim().toUpperCase() !== "DELETE") {
      throw new BadRequestException({ error: "DELETE_CONFIRMATION_REQUIRED" });
    }
    return this.authService.deleteAccount({
      userId: actor.userId,
      tenantId: actor.tenantId,
      role: actor.role,
      reason: dto.reason,
    });
  }

  @Post("logout")
  @Roles(...APP_ROLES)
  @HttpCode(204)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) reply: Response): Promise<void> {
    const claims = request.pimJwtClaims;
    if (!claims) {
      throw new UnauthorizedException("Bearer token is required.");
    }
    const refreshToken = parseCookie(request.headers.cookie, REFRESH_COOKIE_NAME);
    await this.authService.logout(claims, refreshToken);
    clearRefreshCookie(reply);
  }

  @Post("step-up")
  @Roles(...APP_ROLES)
  @HttpCode(201)
  async issueStepUp(@Body() dto: StepUpChallengeDto, @Req() request: AuthenticatedRequest) {
    const claims = request.pimJwtClaims;
    if (!claims) {
      throw new UnauthorizedException("Bearer token is required.");
    }
    return this.authService.issueStepUp({
      claims,
      password: dto.password,
      scope: dto.scope,
      ipAddress: request.ip ?? "unknown",
    });
  }

  private requireActor(request: AuthenticatedRequest): { userId: string; tenantId: string; role: AppRole } {
    const userId = request.pimUserId ?? request.pimJwtClaims?.sub;
    const tenantId = request.pimTenant ?? request.pimJwtClaims?.tenantId;
    const role = request.pimRole ?? request.pimJwtClaims?.role;
    if (!userId || !tenantId || !role) {
      throw new UnauthorizedException("Bearer token is required.");
    }
    return { userId, tenantId, role };
  }
}
