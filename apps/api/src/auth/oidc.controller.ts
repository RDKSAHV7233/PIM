import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Roles } from "../common/rbac/roles";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { OidcConfigService } from "./oidc-config.service";
import { OidcService } from "./oidc.service";
import { OidcAuthService } from "./oidc-auth.service";
import { Public } from "./public.decorator";
import { UpsertOidcConfigDto } from "./dto/upsert-oidc-config.dto";

interface AuthenticatedRequest extends Request {
  pimTenant?: string;
  pimUserId?: string;
  pimJwtClaims?: { sub?: string; tenantId?: string };
}

@Controller("auth")
export class OidcController {
  constructor(
    private readonly oidcConfigService: OidcConfigService,
    private readonly oidcService: OidcService,
    private readonly oidcAuthService: OidcAuthService,
  ) {}

  // ── Admin config endpoints ───────────────────────────────────────────────

  @Post("oidc-config")
  @Roles("admin")
  async upsertConfig(@Req() req: AuthenticatedRequest, @Body() dto: UpsertOidcConfigDto) {
    const tenantKey = this.requireTenantKey(req);
    const actorId = req.pimUserId ?? req.pimJwtClaims?.sub;
    return this.oidcConfigService.upsert(tenantKey, dto, actorId);
  }

  @Get("oidc-config")
  @Roles("admin")
  async getConfig(@Req() req: AuthenticatedRequest) {
    const tenantKey = this.requireTenantKey(req);
    return this.oidcConfigService.get(tenantKey);
  }

  @Delete("oidc-config")
  @Roles("admin")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConfig(@Req() req: AuthenticatedRequest) {
    const tenantKey = this.requireTenantKey(req);
    await this.oidcConfigService.delete(tenantKey);
  }

  // ── OIDC login flow (public) ──────────────────────────────────────────────

  @Get("oidc/login")
  @Public()
  async login(@Query("workspace") workspace: string, @Res() res: Response) {
    if (!workspace) {
      throw new BadRequestException("workspace query parameter is required.");
    }
    const { url } = await this.oidcService.buildAuthorizationUrl(workspace);
    res.redirect(302, url);
  }

  @Get("oidc/callback")
  @Public()
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
    @Query("error") error: string,
    @Query("error_description") errorDescription: string,
    @Res() res: Response,
  ) {
    if (error) {
      throw new UnauthorizedException(`IdP error: ${error}${errorDescription ? ` — ${errorDescription}` : ""}`);
    }
    if (!code || !state) {
      throw new BadRequestException("code and state query parameters are required.");
    }

    const result = await this.oidcAuthService.completeLogin(state, code);

    // Return JSON — the frontend/app layer handles token storage and redirect.
    res.status(200).json(result);
  }

  private requireTenantKey(req: AuthenticatedRequest): string {
    const tenantKey = req.pimTenant ?? req.pimJwtClaims?.tenantId;
    if (!tenantKey) {
      throw new UnauthorizedException("Tenant context not found.");
    }
    return tenantKey;
  }
}
