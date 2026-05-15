import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { type AppRole } from "../common/rbac/roles";
import { normalizeAppRole } from "../common/rbac/role-utils";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { TenantDirectoryService } from "../common/tenant/tenant-directory.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { AuthPolicyService } from "./auth-policy.service";
import { signPimJwt } from "./jwt";
import { OidcService } from "./oidc.service";

const DEFAULT_OIDC_ROLE: AppRole = "viewer";
const OIDC_SESSION_SECONDS = 4 * 60 * 60;

export interface OidcLoginResult {
  accessToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
  userId: string;
  tenantId: string;
  role: AppRole;
}

@Injectable()
export class OidcAuthService {
  private readonly logger = new Logger(OidcAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oidcService: OidcService,
    private readonly tenantDirectoryService: TenantDirectoryService,
    private readonly authPolicyService: AuthPolicyService,
    private readonly auditService: AuditService,
  ) {}

  async completeLogin(state: string, code: string): Promise<OidcLoginResult> {
    const { tenantKey, sub, email, effectiveRoles } = await this.oidcService.handleCallback(state, code);

    const normalizedTenantKey = normalizeTenantKey(tenantKey);

    // Verify OIDC is enabled for this tenant
    const policy = await this.authPolicyService.getPolicy(normalizedTenantKey);
    if (!policy.externalIdentityMode) {
      throw new UnauthorizedException("OIDC login is not enabled for this workspace.");
    }

    // Resolve userId — prefer email, fall back to sub
    const userId = email || sub;
    if (!userId) {
      throw new UnauthorizedException("OIDC token did not contain a usable identity (no email or sub).");
    }

    // Find or provision the workspace user
    const identity = await this.findOrProvisionUser(normalizedTenantKey, userId, effectiveRoles);

    const policySessionTimeoutMinutes = await this.authPolicyService.getEffectiveSessionTimeoutMinutes(normalizedTenantKey);
    const expiresInSeconds = Math.min(OIDC_SESSION_SECONDS, policySessionTimeoutMinutes * 60);

    const accessToken = signPimJwt({
      sub: identity.userId,
      tenantId: normalizedTenantKey,
      role: identity.role,
      assignedRoles: identity.assignedRoles as never,
      expiresInSeconds,
    });

    await this.auditService.record({
      actorId: identity.userId,
      actorRole: identity.role,
      action: "auth.oidc_login_success",
      resource: "auth.oidc",
      tenantKey: normalizedTenantKey,
      metadata: { oidcSub: sub },
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresInSeconds,
      userId: identity.userId,
      tenantId: normalizedTenantKey,
      role: identity.role,
    };
  }

  private async findOrProvisionUser(
    tenantKey: string,
    userId: string,
    claimedRoles: string[],
  ): Promise<{ userId: string; role: AppRole; assignedRoles: string[] }> {
    const existing = await this.prisma.tenant(tenantKey).authIdentity.findFirst({
      where: { tenantKey, userId },
      select: { userId: true, role: true, assignedRoles: true, isActive: true },
    });

    if (existing) {
      if (!existing.isActive) {
        throw new UnauthorizedException("Account is disabled.");
      }
      return {
        userId: existing.userId,
        role: normalizeAppRole(existing.role) ?? DEFAULT_OIDC_ROLE,
        assignedRoles: existing.assignedRoles,
      };
    }

    // Provision: determine role from claims, fall back to viewer
    const role = this.resolveRoleFromClaims(claimedRoles);

    await this.prisma.tenant(tenantKey).authIdentity.create({
      data: {
        tenantKey,
        userId,
        role,
        assignedRoles: claimedRoles.length > 0 ? claimedRoles : [],
        isActive: true,
        passwordHash: null,
      },
    });

    this.logger.log(`Provisioned OIDC user ${userId} in tenant ${tenantKey} with role ${role}`);

    return { userId, role, assignedRoles: claimedRoles };
  }

  private resolveRoleFromClaims(claimedRoles: string[]): AppRole {
    const precedence: AppRole[] = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"];
    for (const role of precedence) {
      if (claimedRoles.includes(role)) {
        return role;
      }
    }
    return DEFAULT_OIDC_ROLE;
  }
}
