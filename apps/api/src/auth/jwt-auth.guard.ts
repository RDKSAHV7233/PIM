import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { extractApiKeyFromHeaders } from "../api-keys/api-key-auth";
import { ApiKeysService, type ResolvedApiKeyIdentity } from "../api-keys/api-keys.service";
import { AuthPolicyService } from "./auth-policy.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import { ADMIN_BOUNDARY_ACCESS_KEY, type AdminBoundaryAccessConfig } from "../common/rbac/admin-boundary.decorator";
import {
  AUTHENTICATED_READ_ROUTE_KEY,
  READ_ACCESS_POLICY_KEY,
  type AuthenticatedReadRouteConfig,
  type ReadAccessPolicyId,
} from "../common/rbac/read-access-policy.decorator";
import { resolveDefaultRole, resolveEffectiveRoles } from "../common/rbac/role-utils";
import { AppRole, ROLES_KEY } from "../common/rbac/roles";
import { normalizeTenantKey, TENANT_HEADER } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { ALLOW_MFA_ENROLLMENT_TOKEN_KEY } from "./allow-mfa-enrollment.decorator";
import { ALLOW_SUSPENDED_TENANT_KEY } from "./allow-suspended.decorator";
import { JwtBlocklistService } from "./jwt-blocklist.service";
import { PimJwtClaims, decodePimJwtFromAuthHeader } from "./jwt";
import { IS_PUBLIC_KEY } from "./public.decorator";
import { STEP_UP_REQUIRED_KEY, type StepUpRequirement } from "./step-up.decorator";

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

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEGRADED_READ_CLASSIFICATIONS = new Set<AuthenticatedReadRouteConfig["classification"]>(["public_safe"]);
const DEGRADED_READ_ACCESS_POLICIES = new Set<ReadAccessPolicyId>(["taxonomy_safe_metadata"]);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtBlocklistService: JwtBlocklistService,
    private readonly apiKeysService: ApiKeysService,
    private readonly planUsageService: PlanUsageService,
    private readonly prisma: PrismaService,
    private readonly authPolicyService: AuthPolicyService,
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
      if (claims.tokenType === "refresh") {
        throw new UnauthorizedException({ error: "REFRESH_TOKEN_NOT_ALLOWED_AS_ACCESS_TOKEN" });
      }
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
      const revoked = await this.checkRevocationWithRoutePolicy(
        context,
        request,
        "access_token",
        () => this.jwtBlocklistService.isRevoked(claims.jti),
      );
      if (revoked) {
        throw new UnauthorizedException({ error: "TOKEN_REVOKED" });
      }
      const tenantId = normalizeTenantKey(claims.tenantId);
      const credRevoked = await this.checkRevocationWithRoutePolicy(
        context,
        request,
        "credential",
        () => this.jwtBlocklistService.isCredentialRevoked(tenantId, claims.sub, claims.iat),
      );
      if (credRevoked) {
        throw new UnauthorizedException({ error: "CREDENTIALS_CHANGED" });
      }
      if (!allowSuspendedTenant) {
        await this.assertTenantAccessActive(tenantId);
      }
      await this.assertUserAccessActive(tenantId, claims.sub);
      const { mfaRequired } = await this.authPolicyService.getEffectiveMfaPolicy(tenantId);
      if (mfaRequired && !claims.mfaVerified) {
        throw new UnauthorizedException({ error: "MFA_REQUIRED" });
      }
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

  private async checkRevocationWithRoutePolicy(
    context: ExecutionContext,
    request: AuthenticatedRequest,
    check: "access_token" | "credential",
    operation: () => Promise<boolean>,
  ): Promise<boolean> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (this.allowsBoundedReadOnlyDegradedMode(context, request)) {
        this.logger.warn(
          `Revocation authority unavailable for ${check} check - allowing explicitly classified read-only degraded route`,
          {
            method: request.method ?? "GET",
            path: request.path ?? request.url ?? "unknown",
          },
        );
        return false;
      }

      this.logger.warn(`Revocation authority unavailable for ${check} check - failing closed`, {
        method: request.method ?? "GET",
        path: request.path ?? request.url ?? "unknown",
        error: error instanceof Error ? error.message : String(error ?? "unknown"),
      });
      throw new ServiceUnavailableException({
        error: "REVOCATION_AUTHORITY_UNAVAILABLE",
        check,
      });
    }
  }

  private allowsBoundedReadOnlyDegradedMode(context: ExecutionContext, request: AuthenticatedRequest): boolean {
    const method = String(request.method ?? "GET").toUpperCase();
    if (!READ_ONLY_METHODS.has(method)) {
      return false;
    }

    const targets = [context.getHandler(), context.getClass()];
    const stepUpRequirement = this.reflector.getAllAndOverride<StepUpRequirement>(STEP_UP_REQUIRED_KEY, targets);
    if (stepUpRequirement) {
      return false;
    }

    const adminBoundaryAccess = this.reflector.getAllAndOverride<AdminBoundaryAccessConfig>(
      ADMIN_BOUNDARY_ACCESS_KEY,
      targets,
    );
    if (adminBoundaryAccess) {
      return false;
    }

    const requiredRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, targets) ?? [];
    if (requiredRoles.includes("admin")) {
      return false;
    }

    const readRoute = this.reflector.getAllAndOverride<AuthenticatedReadRouteConfig>(
      AUTHENTICATED_READ_ROUTE_KEY,
      targets,
    );
    if (readRoute?.classification && DEGRADED_READ_CLASSIFICATIONS.has(readRoute.classification)) {
      return true;
    }

    const readAccessPolicy = this.reflector.getAllAndOverride<ReadAccessPolicyId>(READ_ACCESS_POLICY_KEY, targets);
    return Boolean(readAccessPolicy && DEGRADED_READ_ACCESS_POLICIES.has(readAccessPolicy));
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

    const dbAuthRequired = String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
    if (!dbAuthRequired) {
      return;
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
