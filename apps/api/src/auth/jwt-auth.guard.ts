import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { extractApiKeyFromHeaders } from "../api-keys/api-key-auth";
import { ApiKeysService, type ResolvedApiKeyIdentity } from "../api-keys/api-keys.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import { resolveDefaultRole, resolveEffectiveRoles } from "../common/rbac/role-utils";
import { AppRole } from "../common/rbac/roles";
import { normalizeTenantKey, TENANT_HEADER } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { ALLOW_MFA_ENROLLMENT_TOKEN_KEY } from "./allow-mfa-enrollment.decorator";
import { ALLOW_SUSPENDED_TENANT_KEY } from "./allow-suspended.decorator";
import { JwtBlocklistService } from "./jwt-blocklist.service";
import { PimJwtClaims, decodePimJwtFromAuthHeader } from "./jwt";
import { IS_PUBLIC_KEY } from "./public.decorator";

interface AuthenticatedRequest extends Request {
  pimRole?: AppRole;
  pimTenant?: string;
  pimUserId?: string;
  pimJwtClaims?: PimJwtClaims;
  pimResolvedApiKey?: ResolvedApiKeyIdentity | null;
  pimAuthType?: "user_jwt" | "api_key";
  pimEffectiveRoles?: string[];
  pimAdminBoundaryRoles?: string[];
  pimApiScopes?: string[];
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtBlocklistService: JwtBlocklistService,
    private readonly apiKeysService: ApiKeysService,
    private readonly planUsageService: PlanUsageService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    const allowSuspendedTenant = this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED_TENANT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const roleHeader = request.headers["x-pim-role"];
    if (request.headers[TENANT_HEADER] || roleHeader) {
      throw new ForbiddenException("Legacy auth headers are disabled. Use Bearer token authentication.");
    }

    const claims = decodePimJwtFromAuthHeader(request.headers.authorization);
    if (claims) {
      if (claims.tokenType === "step_up") {
        throw new UnauthorizedException({ error: "STEP_UP_TOKEN_NOT_ALLOWED_AS_ACCESS_TOKEN" });
      }
      if (claims.tokenType === "mfa_pending") {
        throw new UnauthorizedException({ error: "MFA_PENDING_TOKEN_NOT_ALLOWED_AS_ACCESS_TOKEN" });
      }
      if (claims.tokenType === "mfa_enrollment") {
        const allowEnrollment = this.reflector.getAllAndOverride<boolean>(ALLOW_MFA_ENROLLMENT_TOKEN_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);
        if (!allowEnrollment) {
          throw new UnauthorizedException({ error: "MFA_ENROLLMENT_TOKEN_NOT_ALLOWED_AS_ACCESS_TOKEN" });
        }
      }
      const revoked = await this.jwtBlocklistService.isRevoked(claims.jti);
      if (revoked) {
        throw new UnauthorizedException({ error: "TOKEN_REVOKED" });
      }
      const tenantId = normalizeTenantKey(claims.tenantId);
      if (!allowSuspendedTenant) {
        await this.assertTenantAccessActive(tenantId);
      }
      await this.assertUserAccessActive(tenantId, claims.sub);
      const resolvedRoles = resolveEffectiveRoles({
        legacyRole: claims.role ?? resolveDefaultRole(),
        assignedRoles: claims.assignedRoles,
        principalType: "human",
      });
      request.pimUserId = claims.sub;
      request.pimTenant = tenantId;
      request.pimRole = resolvedRoles.primaryAppRole;
      request.pimEffectiveRoles = resolvedRoles.foundationRoles;
      request.pimAdminBoundaryRoles = resolvedRoles.adminBoundaryRoles;
      request.pimJwtClaims = claims;
      request.pimAuthType = "user_jwt";
      return true;
    }

    const apiKey = extractApiKeyFromHeaders(request.headers as Record<string, string | string[] | undefined>);
    if (apiKey) {
      const resolved = request.pimResolvedApiKey ?? await this.apiKeysService.resolveApiKey(apiKey);
      if (!resolved) {
        throw new UnauthorizedException({ error: "INVALID_API_KEY" });
      }
      const tenantId = normalizeTenantKey(resolved.tenantId);
      await this.assertTenantAccessActive(tenantId);
      const resolvedRoles = resolveEffectiveRoles({
        legacyRole: resolved.role ?? resolveDefaultRole(),
        principalType: "api_client",
      });
      request.pimUserId = resolved.actorId;
      request.pimTenant = tenantId;
      request.pimRole = resolvedRoles.primaryAppRole;
      request.pimEffectiveRoles = resolvedRoles.foundationRoles;
      request.pimAdminBoundaryRoles = resolvedRoles.adminBoundaryRoles;
      request.pimAuthType = "api_key";
      request.pimApiScopes = resolved.scopes;
      void this.apiKeysService.touchLastUsed(resolved.keyId);
      return true;
    }

    throw new UnauthorizedException("Bearer token or API key is required.");
  }

  private async assertTenantAccessActive(tenantKeyInput: string): Promise<void> {
    const profile = await this.planUsageService.getTenantPlanProfile(tenantKeyInput);
    if (profile.accessStatus !== "suspended") {
      return;
    }
    throw new ForbiddenException({
      error: "TENANT_SUSPENDED",
      tenantId: profile.tenantKey,
      billingStatus: profile.billingStatus,
      accessStatus: profile.accessStatus,
      suspensionReason: profile.suspensionReason,
    });
  }

  private async assertUserAccessActive(tenantKey: string, userId: string): Promise<void> {
    const normalizedUserId = String(userId ?? "").trim().toLowerCase();
    if (!normalizedUserId) {
      throw new UnauthorizedException({ error: "USER_ID_REQUIRED" });
    }

    const identity = await this.prisma.tenant(tenantKey).authIdentity.findFirst({
      where: {
        tenantKey,
        userId: normalizedUserId,
      },
      select: {
        isActive: true,
        lockedUntil: true,
      },
    });

    const dbAuthRequired = String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
    if (!identity) {
      if (dbAuthRequired) {
        throw new UnauthorizedException({ error: "USER_NOT_FOUND" });
      }
      return;
    }

    if (!identity.isActive) {
      throw new UnauthorizedException({ error: "USER_INACTIVE" });
    }

    if (identity.lockedUntil && identity.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException({
        error: "USER_LOCKED",
        unlockAt: identity.lockedUntil.toISOString(),
      });
    }
  }
}
