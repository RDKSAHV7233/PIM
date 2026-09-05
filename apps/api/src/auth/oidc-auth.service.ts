import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { type AppRole } from "../common/rbac/roles";
import { normalizeAppRole } from "../common/rbac/role-utils";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { TenantDirectoryService } from "../common/tenant/tenant-directory.service";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CommercialNotificationsService } from "../billing/commercial-notifications.service";
import { CommercialRequestsService } from "../billing/commercial-requests.service";
import { PlanUsageService } from "../billing/plan-usage.service";
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
    private readonly planUsageService: PlanUsageService,
    private readonly commercialRequestsService: CommercialRequestsService,
    private readonly commercialNotificationsService: CommercialNotificationsService,
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

    // PO decision (option 2, TC-37): SSO auto-provisioning is continuous and passive — it
    // happens on every new person's first login, not a deliberate bulk action a customer
    // chooses to trigger. Blocking a login over a plan limit is a real support-flow risk
    // (an employee locked out mid-workday because *someone else's* org grew past the plan's
    // seat count). So: never block here. Instead, flag the tenant for commercial follow-up
    // the same way this codebase already handles "something needs Vexa's commercial
    // attention" — a TenantCommercialRequest row plus a one-time email, same idiom as
    // billing.controller.ts's upgrade-request flow. Awaited (not fire-and-forget) so this
    // stays deterministic and testable — the extra query is cheap, and try/catch guarantees
    // a failure here can never turn into a failed login.
    try {
      await this.flagUserLimitOverageIfNeeded(tenantKey);
    } catch (error) {
      this.logger.error(
        `Failed to flag user-limit overage for tenant ${tenantKey} (login was still allowed): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { userId, role, assignedRoles: claimedRoles };
  }

  private async flagUserLimitOverageIfNeeded(tenantKey: string): Promise<void> {
    const check = await this.planUsageService.checkLimit("users", 0, tenantKey);
    if (check.allowed) {
      return;
    }

    const profile = await this.planUsageService.getTenantPlanProfile(tenantKey);
    const result = await this.commercialRequestsService.createOrReuseOverageFlag(tenantKey, {
      resource: "users",
      current: check.current,
      limit: check.limit,
      currentPlanTier: profile.planTier,
      currentBillingStatus: profile.billingStatus,
      currentAccessStatus: profile.accessStatus,
      source: "sso_auto_provisioning",
      notes:
        `SSO auto-provisioning brought active user count to ${check.current}, over the plan's ` +
        `limit of ${check.limit}. The login was allowed — user-count enforcement here is a ` +
        `flag for commercial follow-up, not a block.`,
    });

    if (!result.created) {
      return;
    }

    await this.auditService.record({
      actorId: "system",
      actorRole: "system",
      action: "billing.user_limit_overage_flagged",
      resource: "TENANT_COMMERCIAL_REQUEST",
      resourceId: result.item.id,
      tenantKey,
      metadata: {
        event: "sso_user_limit_overage_flagged",
        tenantKey,
        current: check.current,
        limit: check.limit,
      },
    });

    await this.commercialNotificationsService.notifyCommercialOpsOverageFlag({
      tenantKey,
      request: result.item,
    });
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
