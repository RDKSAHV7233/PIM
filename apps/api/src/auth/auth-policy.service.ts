import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PlanUsageService } from "../billing/plan-usage.service";
import { AuditService } from "../audit/audit.service";
import { type AppRole } from "../common/rbac/roles";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { type AuthPolicyMethod, UpdateAuthPolicyDto } from "./dto/update-auth-policy.dto";

const DEFAULT_MFA_GRACE_PERIOD_DAYS = 7;
const DEFAULT_SESSION_TIMEOUT_MINUTES = 240;
const MIN_SESSION_TIMEOUT_MINUTES = 15;
const MAX_SESSION_TIMEOUT_MINUTES = 240;
const DEFAULT_ALLOWED_AUTH_METHODS = ["password"] as const satisfies readonly AuthPolicyMethod[];

const AUTH_POLICY_SELECT = {
  id: true,
  tenantKey: true,
  externalIdentityMode: true,
  mfaRequired: true,
  mfaRequiredSince: true,
  mfaGracePeriodDays: true,
  sessionTimeoutMinutes: true,
  allowedAuthMethods: true,
  createdBy: true,
  updatedBy: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.TenantAuthPolicySelect;

type TenantAuthPolicyRow = Prisma.TenantAuthPolicyGetPayload<{
  select: typeof AUTH_POLICY_SELECT;
}>;

export interface TenantAuthPolicyView {
  id: string | null;
  tenantKey: string;
  externalIdentityMode: boolean;
  mfaRequired: boolean;
  mfaRequiredSince: string | null;
  mfaGracePeriodDays: number;
  sessionTimeoutMinutes: number;
  allowedAuthMethods: AuthPolicyMethod[];
  isPersisted: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  runtimeApplied: {
    sessionTimeout: boolean;
    mfaEnrollment: boolean;
    externalIdentity: boolean;
  };
}

/** Fields only configurable on ENTERPRISE plan. */
const ENTERPRISE_ONLY_FIELDS = ["externalIdentityMode", "mfaRequired", "mfaGracePeriodDays", "allowedAuthMethods"] as const;
type EnterpriseOnlyField = (typeof ENTERPRISE_ONLY_FIELDS)[number];

@Injectable()
export class AuthPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly planUsageService: PlanUsageService,
  ) {}

  async getPolicy(tenantIdInput: string): Promise<TenantAuthPolicyView> {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const row = await this.prisma.tenant(tenantId).tenantAuthPolicy.findUnique({
      where: { tenantKey: tenantId },
      select: AUTH_POLICY_SELECT,
    });
    return this.mapPolicyRow(tenantId, row);
  }

  async getEffectiveSessionTimeoutMinutes(tenantIdInput: string): Promise<number> {
    if (String(process.env.AUTH_MODE ?? "").trim().toLowerCase() !== "db") {
      return this.normalizeSessionTimeoutMinutes(undefined);
    }
    const tenantId = normalizeTenantKey(tenantIdInput);
    const row = await this.prisma.tenant(tenantId).tenantAuthPolicy.findUnique({
      where: { tenantKey: tenantId },
      select: {
        sessionTimeoutMinutes: true,
      },
    });
    return this.normalizeSessionTimeoutMinutes(row?.sessionTimeoutMinutes);
  }

  async getEffectiveMfaPolicy(
    tenantIdInput: string,
  ): Promise<{ mfaRequired: boolean; mfaRequiredSince: Date | null; mfaGracePeriodDays: number }> {
    if (String(process.env.AUTH_MODE ?? "").trim().toLowerCase() !== "db") {
      return { mfaRequired: false, mfaRequiredSince: null, mfaGracePeriodDays: DEFAULT_MFA_GRACE_PERIOD_DAYS };
    }
    const tenantId = normalizeTenantKey(tenantIdInput);
    const row = await this.prisma.tenant(tenantId).tenantAuthPolicy.findUnique({
      where: { tenantKey: tenantId },
      select: { mfaRequired: true, mfaRequiredSince: true, mfaGracePeriodDays: true },
    });
    return {
      mfaRequired: row?.mfaRequired ?? false,
      mfaRequiredSince: row?.mfaRequiredSince ?? null,
      mfaGracePeriodDays: this.normalizeMfaGracePeriodDays(row?.mfaGracePeriodDays),
    };
  }

  /**
   * Whether `mfaRequired` is still inside its rollout grace window — i.e. it was
   * turned on recently enough that unenrolled members shouldn't be forced into
   * enrollment yet. `mfaRequiredSince` is null both for tenants that never had
   * this column populated (predates this feature) and for one-off cases where
   * the transition wasn't tracked; treating null as "no grace" preserves the
   * immediate-enforcement behavior that shipped before grace periods existed,
   * rather than silently granting an open-ended pass.
   */
  isWithinMfaGracePeriod(policy: { mfaRequiredSince: Date | null; mfaGracePeriodDays: number }, now = new Date()): boolean {
    if (!policy.mfaRequiredSince) {
      return false;
    }
    const graceEndsAt = policy.mfaRequiredSince.getTime() + policy.mfaGracePeriodDays * 24 * 60 * 60 * 1000;
    return now.getTime() < graceEndsAt;
  }

  async getEffectiveAllowedAuthMethods(tenantIdInput: string): Promise<AuthPolicyMethod[]> {
    if (String(process.env.AUTH_MODE ?? "").trim().toLowerCase() !== "db") {
      return this.normalizeAuthMethods(undefined);
    }
    const tenantId = normalizeTenantKey(tenantIdInput);
    const row = await this.prisma.tenant(tenantId).tenantAuthPolicy.findUnique({
      where: { tenantKey: tenantId },
      select: { allowedAuthMethods: true },
    });
    return this.normalizeAuthMethods(row?.allowedAuthMethods);
  }

  async updatePolicy(
    tenantIdInput: string,
    actorIdInput: string,
    actorRole: AppRole,
    dto: UpdateAuthPolicyDto,
  ): Promise<TenantAuthPolicyView> {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const actorId = String(actorIdInput ?? "").trim().toLowerCase() || "unknown";

    const planTier = await this.planUsageService.getTenantPlanTier(tenantId);

    if (planTier === "TRIAL" || planTier === "STARTER") {
      throw new ForbiddenException({
        error: "PLAN_UPGRADE_REQUIRED",
        message: "Auth policy configuration requires a Growth or Enterprise plan.",
        upgrade_url: "/admin/plan",
      });
    }

    if (planTier === "GROWTH") {
      const blockedFields = (Object.keys(dto) as EnterpriseOnlyField[]).filter(
        (field) => (ENTERPRISE_ONLY_FIELDS as readonly string[]).includes(field) && dto[field] !== undefined,
      );
      if (blockedFields.length > 0) {
        throw new ForbiddenException({
          error: "PLAN_UPGRADE_REQUIRED",
          message: `Fields ${blockedFields.join(", ")} require an Enterprise plan.`,
          upgrade_url: "/admin/plan",
        });
      }
    }

    const current = await this.prisma.tenant(tenantId).tenantAuthPolicy.findUnique({
      where: { tenantKey: tenantId },
      select: AUTH_POLICY_SELECT,
    });
    const hasExplicitChange =
      dto.externalIdentityMode !== undefined ||
      dto.mfaRequired !== undefined ||
      dto.mfaGracePeriodDays !== undefined ||
      dto.sessionTimeoutMinutes !== undefined ||
      dto.allowedAuthMethods !== undefined;
    if (!hasExplicitChange) {
      throw new BadRequestException({ error: "NO_AUTH_POLICY_CHANGES" });
    }

    const next = {
      externalIdentityMode: dto.externalIdentityMode ?? current?.externalIdentityMode ?? false,
      mfaRequired: dto.mfaRequired ?? current?.mfaRequired ?? false,
      mfaGracePeriodDays: this.normalizeMfaGracePeriodDays(dto.mfaGracePeriodDays ?? current?.mfaGracePeriodDays),
      sessionTimeoutMinutes: this.normalizeSessionTimeoutMinutes(
        dto.sessionTimeoutMinutes ?? current?.sessionTimeoutMinutes,
      ),
      allowedAuthMethods: this.normalizeAuthMethods(dto.allowedAuthMethods ?? current?.allowedAuthMethods),
    };

    // Anchor the grace-period rollout window to this exact transition, not to
    // updatedAt (which also moves on unrelated field changes below). Turning
    // MFA off clears it, so re-enabling later starts a fresh window rather than
    // resuming a stale one.
    const wasRequired = current?.mfaRequired ?? false;
    const mfaRequiredSince = next.mfaRequired
      ? wasRequired
        ? current?.mfaRequiredSince ?? null
        : new Date()
      : null;

    const persisted = await this.prisma.tenant(tenantId).tenantAuthPolicy.upsert({
      where: { tenantKey: tenantId },
      create: {
        tenantKey: tenantId,
        externalIdentityMode: next.externalIdentityMode,
        mfaRequired: next.mfaRequired,
        mfaRequiredSince,
        mfaGracePeriodDays: next.mfaGracePeriodDays,
        sessionTimeoutMinutes: next.sessionTimeoutMinutes,
        allowedAuthMethods: next.allowedAuthMethods,
        createdBy: actorId,
        updatedBy: actorId,
      },
      update: {
        externalIdentityMode: next.externalIdentityMode,
        mfaRequired: next.mfaRequired,
        mfaRequiredSince,
        mfaGracePeriodDays: next.mfaGracePeriodDays,
        sessionTimeoutMinutes: next.sessionTimeoutMinutes,
        allowedAuthMethods: next.allowedAuthMethods,
        updatedBy: actorId,
      },
      select: AUTH_POLICY_SELECT,
    });

    const before = this.mapPolicyRow(tenantId, current);
    const after = this.mapPolicyRow(tenantId, persisted);

    await this.auditService.record({
      actorId,
      actorRole,
      action: current ? "tenant_auth_policy.updated" : "tenant_auth_policy.created",
      resource: "TenantAuthPolicy",
      resourceId: persisted.id,
      tenantKey: tenantId,
      metadata: {
        tenantKey: tenantId,
        changedFields: this.collectChangedFields(before, after),
        before: {
          externalIdentityMode: before.externalIdentityMode,
          mfaRequired: before.mfaRequired,
          mfaRequiredSince: before.mfaRequiredSince,
          mfaGracePeriodDays: before.mfaGracePeriodDays,
          sessionTimeoutMinutes: before.sessionTimeoutMinutes,
          allowedAuthMethods: before.allowedAuthMethods,
          isPersisted: before.isPersisted,
        },
        after: {
          externalIdentityMode: after.externalIdentityMode,
          mfaRequired: after.mfaRequired,
          mfaRequiredSince: after.mfaRequiredSince,
          mfaGracePeriodDays: after.mfaGracePeriodDays,
          sessionTimeoutMinutes: after.sessionTimeoutMinutes,
          allowedAuthMethods: after.allowedAuthMethods,
          isPersisted: after.isPersisted,
        },
      },
    });

    return after;
  }

  private mapPolicyRow(tenantId: string, row: TenantAuthPolicyRow | null): TenantAuthPolicyView {
    return {
      id: row?.id ?? null,
      tenantKey: tenantId,
      externalIdentityMode: row?.externalIdentityMode ?? false,
      mfaRequired: row?.mfaRequired ?? false,
      mfaRequiredSince: row?.mfaRequiredSince ? row.mfaRequiredSince.toISOString() : null,
      mfaGracePeriodDays: this.normalizeMfaGracePeriodDays(row?.mfaGracePeriodDays),
      sessionTimeoutMinutes: this.normalizeSessionTimeoutMinutes(row?.sessionTimeoutMinutes),
      allowedAuthMethods: this.normalizeAuthMethods(row?.allowedAuthMethods),
      isPersisted: Boolean(row),
      createdBy: row?.createdBy ?? null,
      updatedBy: row?.updatedBy ?? null,
      createdAt: row?.createdAt ? row.createdAt.toISOString() : null,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
      runtimeApplied: {
        sessionTimeout: true,
        mfaEnrollment: String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db",
        externalIdentity: false,
      },
    };
  }

  private normalizeMfaGracePeriodDays(value: number | null | undefined): number {
    const candidate = Number.isFinite(value) ? Math.floor(Number(value)) : DEFAULT_MFA_GRACE_PERIOD_DAYS;
    return Math.min(90, Math.max(0, candidate));
  }

  private normalizeSessionTimeoutMinutes(value: number | null | undefined): number {
    const candidate = Number.isFinite(value) ? Math.floor(Number(value)) : DEFAULT_SESSION_TIMEOUT_MINUTES;
    return Math.min(MAX_SESSION_TIMEOUT_MINUTES, Math.max(MIN_SESSION_TIMEOUT_MINUTES, candidate));
  }

  private normalizeAuthMethods(value: readonly string[] | null | undefined): AuthPolicyMethod[] {
    const requested = Array.isArray(value) ? value : DEFAULT_ALLOWED_AUTH_METHODS;
    const normalized = Array.from(
      new Set(
        requested
          .map((entry) => String(entry ?? "").trim().toLowerCase())
          .filter((entry): entry is AuthPolicyMethod => entry === "password" || entry === "oidc"),
      ),
    );
    return normalized.length > 0 ? normalized : [...DEFAULT_ALLOWED_AUTH_METHODS];
  }

  private collectChangedFields(before: TenantAuthPolicyView, after: TenantAuthPolicyView): string[] {
    const changed: string[] = [];
    if (before.externalIdentityMode !== after.externalIdentityMode) {
      changed.push("externalIdentityMode");
    }
    if (before.mfaRequired !== after.mfaRequired) {
      changed.push("mfaRequired");
    }
    if (before.mfaRequiredSince !== after.mfaRequiredSince) {
      changed.push("mfaRequiredSince");
    }
    if (before.mfaGracePeriodDays !== after.mfaGracePeriodDays) {
      changed.push("mfaGracePeriodDays");
    }
    if (before.sessionTimeoutMinutes !== after.sessionTimeoutMinutes) {
      changed.push("sessionTimeoutMinutes");
    }
    if (before.allowedAuthMethods.join(",") !== after.allowedAuthMethods.join(",")) {
      changed.push("allowedAuthMethods");
    }
    if (before.isPersisted !== after.isPersisted) {
      changed.push("isPersisted");
    }
    return changed;
  }
}
