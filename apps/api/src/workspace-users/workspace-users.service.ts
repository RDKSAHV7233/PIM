import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import {
  APP_ROLES,
  availableRolesForTier,
  isRoleAvailableForTier,
  type AppRole,
  type FoundationRole,
} from "../common/rbac/roles";
import { normalizeAppRole, normalizeFoundationRole } from "../common/rbac/role-utils";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { CreateWorkspaceUserDto } from "./dto/create-workspace-user.dto";
import { LockWorkspaceUserDto } from "./dto/lock-workspace-user.dto";
import { UpdateWorkspaceUserRoleDto } from "./dto/update-workspace-user-role.dto";

type AuthIdentityRecord = {
  id: string;
  userId: string;
  role: string;
  assignedRoles?: string[] | null;
  isActive: boolean;
  lockedUntil: Date | null;
  lastSignInAt?: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface WorkspaceUserRow {
  id: string;
  userId: string;
  role: AppRole;
  assignedRoles: FoundationRole[];
  isActive: boolean;
  lockedUntil: string | null;
  isLocked: boolean;
  mfaEnrolled: boolean;
  lastSignInAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class WorkspaceUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly planUsage: PlanUsageService,
  ) {}

  async listUsers(tenantId: string): Promise<WorkspaceUserRow[]> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    const rows = await this.prisma.tenant(normalizedTenantId).authIdentity.findMany({
      where: {
        tenantKey: normalizedTenantId,
      },
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
      take: 1_000, // defensive cap — workspace user lists are admin-only; no tenant reaches this
      select: {
        id: true,
        userId: true,
        role: true,
        assignedRoles: true,
        isActive: true,
        lockedUntil: true,
        lastSignInAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const isDbMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
    let enrolledUserIds = new Set<string>();
    if (isDbMode && rows.length > 0) {
      const userIds = rows.map((r) => r.userId);
      const mfaRows = await this.prisma.tenant(normalizedTenantId).userMfaEnrollment.findMany({
        where: {
          tenantKey: normalizedTenantId,
          userId: { in: userIds },
          method: "totp",
          status: "active",
        },
        take: userIds.length, // at most one active TOTP enrollment per user
        select: { userId: true },
      });
      enrolledUserIds = new Set(mfaRows.map((r) => r.userId));
    }
    return rows.map((row) => this.mapWorkspaceUserRow(row, enrolledUserIds.has(row.userId)));
  }

  /**
   * Real, unbounded count of active admins — unlike listUsers()'s `take: 1_000`
   * page, this can't silently omit an admin whose row falls outside the most
   * recent 1,000 identities. The Governance Snapshot's "Admin Coverage" card
   * depends on this being exact: it's the same invariant the last-admin guard
   * (deactivateUser, #816/#819) protects, so undercounting it here can make a
   * healthy tenant look mistakenly at-risk (or mask a real one).
   */
  async countActiveAdmins(tenantId: string): Promise<number> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    return this.prisma.tenant(normalizedTenantId).authIdentity.count({
      where: { role: "admin", isActive: true },
    });
  }

  /**
   * Same fix as countActiveAdmins, extended to the other three Governance
   * Snapshot / MFA Policy headline numbers on /admin/users: activeUsers,
   * lockedUsers, and mfaEnrolledCount were all still being derived from
   * listUsers()'s capped 1,000-row page (page.tsx's workspaceUsers.filter(...)),
   * so they shared the exact same undercount risk as Admin Coverage (#816/#822)
   * in any tenant with more identities than that. One aggregate query, no
   * per-row cap — mfaEnrolledCount needs a join since MFA enrollment lives in
   * a separate table, not a plain count().
   *
   * Deliberately not extended to the roster table itself (still capped at
   * 1,000 rows for display) — giving admins a real way to reach every user in
   * a >1,000-identity tenant is a UX decision (search? cursor pagination?),
   * not a plain count() fix. Tracked separately in #823.
   */
  async getUserStats(tenantId: string): Promise<{ activeUsers: number; lockedUsers: number; mfaEnrolledCount: number }> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    const rows = await this.prisma.tenant(normalizedTenantId).$queryRaw<
      Array<{ activeUsers: bigint | number; lockedUsers: bigint | number; mfaEnrolledCount: bigint | number }>
    >`
      SELECT
        COUNT(*) FILTER (WHERE ai."isActive" = true)::int AS "activeUsers",
        COUNT(*) FILTER (WHERE ai."isActive" = true AND ai."lockedUntil" > NOW())::int AS "lockedUsers",
        COUNT(DISTINCT ai."id") FILTER (WHERE ai."isActive" = true AND me."id" IS NOT NULL)::int AS "mfaEnrolledCount"
      FROM "AuthIdentity" ai
      LEFT JOIN "user_mfa_enrollments" me
        ON me."userId" = ai."userId" AND me."tenantKey" = ai."tenantKey" AND me."method" = 'totp' AND me."status" = 'active'
      WHERE ai."tenantKey" = ${normalizedTenantId}
    `;
    const row = rows[0];
    return {
      activeUsers: Number(row?.activeUsers ?? 0),
      lockedUsers: Number(row?.lockedUsers ?? 0),
      mfaEnrolledCount: Number(row?.mfaEnrolledCount ?? 0),
    };
  }

  /**
   * Direct, uncapped lookup by exact userId — a way to actually reach a user
   * that listUsers()'s take: 1_000 page has pushed out. Confirmed live need
   * (2026-09-14): the staging tenant's own root/founding admin identity fell
   * outside the 1,000 most-recently-created rows and was completely
   * unreachable through the roster table, including by the client-side
   * UserSearchFilter (which only searches the same already-capped page, so it
   * reports "no match" for a real user rather than "not in this page").
   *
   * Deliberately exact-match only, not a fuzzy/partial search — a full search
   * experience over an unbounded, possibly-large identity set needs its own
   * design (indexing, rate limiting, etc.), tracked in #823. This is the
   * narrow, safe fix: if you know the exact userId you're looking for, you
   * can always find and manage it, no matter how many newer rows exist.
   */
  async findUserByExactId(tenantId: string, targetUserId: string): Promise<WorkspaceUserRow | null> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    const normalizedTargetUserId = this.normalizeUserId(targetUserId);
    if (!normalizedTargetUserId) {
      return null;
    }
    const row = await this.prisma.tenant(normalizedTenantId).authIdentity.findFirst({
      where: {
        tenantKey: normalizedTenantId,
        userId: normalizedTargetUserId,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        assignedRoles: true,
        isActive: true,
        lockedUntil: true,
        lastSignInAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!row) {
      return null;
    }
    const isDbMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
    let mfaEnrolled = false;
    if (isDbMode) {
      const mfaRow = await this.prisma.tenant(normalizedTenantId).userMfaEnrollment.findFirst({
        where: {
          tenantKey: normalizedTenantId,
          userId: row.userId,
          method: "totp",
          status: "active",
        },
        select: { id: true },
      });
      mfaEnrolled = Boolean(mfaRow);
    }
    return this.mapWorkspaceUserRow(row, mfaEnrolled);
  }

  async createUser(
    tenantId: string,
    actorId: string,
    actorRole: AppRole,
    dto: CreateWorkspaceUserDto,
    actorAdminBoundaryRoles: string[] = [],
  ): Promise<WorkspaceUserRow> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    const normalizedActorId = this.normalizeUserId(actorId);
    const userId = this.normalizeUserId(dto.userId);
    const role = this.normalizeRoleOrThrow(dto.role);
    const assignedRoles = this.normalizeManagedAssignedRolesOrThrow(role, dto.assignedRoles);

    if (!userId) {
      throw new BadRequestException({ error: "USER_ID_REQUIRED" });
    }
    const actorCanAssignAdmin = actorRole === "admin"
      || actorAdminBoundaryRoles.includes("system_admin")
      || actorAdminBoundaryRoles.includes("super_admin");
    if (role === "admin" && !actorCanAssignAdmin) {
      throw new ForbiddenException({ error: "ADMIN_ROLE_REQUIRES_ADMIN" });
    }

    await this.assertRoleAllowedForTenantPlan(normalizedTenantId, role);
    for (const assignedRole of assignedRoles) {
      if ((APP_ROLES as readonly string[]).includes(assignedRole)) {
        await this.assertRoleAllowedForTenantPlan(normalizedTenantId, assignedRole as AppRole);
      }
    }

    const existing = await this.prisma.tenant(normalizedTenantId).authIdentity.findFirst({
      where: {
        tenantKey: normalizedTenantId,
        userId,
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({ error: "USER_ALREADY_EXISTS" });
    }

    // Enforce the tenant's user-count plan limit before creating.
    const planCheck = await this.planUsage.checkLimit("users", 1, normalizedTenantId);
    if (!planCheck.allowed) {
      throw new ForbiddenException({
        error: "PLAN_USERS_LIMIT_EXCEEDED",
        limit: planCheck.limit,
        current: planCheck.current,
      });
    }

    try {
      const passwordHash = await this.resolveInitialPasswordHash(dto.password);
      if (this.isStrictRuntime() && !passwordHash) {
        throw new BadRequestException({ error: "PASSWORD_REQUIRED", minLength: 8 });
      }

      const created = await this.prisma.tenant(normalizedTenantId).authIdentity.create({
        data: {
          tenantKey: normalizedTenantId,
          userId,
          role,
          assignedRoles,
          passwordHash,
          createdBy: normalizedActorId,
        },
        select: {
          id: true,
          userId: true,
          role: true,
          assignedRoles: true,
          isActive: true,
          lockedUntil: true,
          lastSignInAt: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      await this.auditService.record({
        actorId: normalizedActorId,
        actorRole,
        action: "workspace_user.created",
        resource: "AuthIdentity",
        resourceId: created.id,
        metadata: {
          targetUserId: created.userId,
          role,
          assignedRoles,
        },
      });

      return this.mapWorkspaceUserRow(created);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException({ error: "USER_ALREADY_EXISTS" });
      }
      throw error;
    }
  }

  async updateUserRole(
    tenantId: string,
    actorId: string,
    actorRole: AppRole,
    targetUserId: string,
    dto: UpdateWorkspaceUserRoleDto,
    actorAdminBoundaryRoles: string[] = [],
  ): Promise<WorkspaceUserRow> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    const normalizedActorId = this.normalizeUserId(actorId);
    const normalizedTargetUserId = this.normalizeUserId(targetUserId);
    const nextRole = this.normalizeRoleOrThrow(dto.role);

    const actorCanAssignAdmin = actorRole === "admin"
      || actorAdminBoundaryRoles.includes("system_admin")
      || actorAdminBoundaryRoles.includes("super_admin");
    if (nextRole === "admin" && !actorCanAssignAdmin) {
      throw new ForbiddenException({ error: "ADMIN_ROLE_REQUIRES_ADMIN" });
    }
    if (normalizedTargetUserId === normalizedActorId) {
      throw new BadRequestException({ error: "CANNOT_CHANGE_OWN_ROLE" });
    }

    await this.assertRoleAllowedForTenantPlan(normalizedTenantId, nextRole);

    const existing = await this.findTenantUserOrThrow(normalizedTenantId, normalizedTargetUserId);
    const nextAssignedRoles = dto.assignedRoles === undefined
      ? this.normalizeManagedAssignedRolesOrThrow(nextRole, existing.assignedRoles)
      : this.normalizeManagedAssignedRolesOrThrow(nextRole, dto.assignedRoles);
    for (const assignedRole of nextAssignedRoles) {
      if ((APP_ROLES as readonly string[]).includes(assignedRole)) {
        await this.assertRoleAllowedForTenantPlan(normalizedTenantId, assignedRole as AppRole);
      }
    }
    const updated = await this.prisma.tenant(normalizedTenantId).authIdentity.update({
      where: {
        id: existing.id,
      },
      data: {
        role: nextRole,
        assignedRoles: nextAssignedRoles,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        assignedRoles: true,
        isActive: true,
        lockedUntil: true,
        lastSignInAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.record({
      actorId: normalizedActorId,
      actorRole,
      action: "workspace_user.role_changed",
      resource: "AuthIdentity",
      resourceId: existing.id,
      metadata: {
        targetUserId: updated.userId,
        fromRole: this.normalizeRoleOrThrow(existing.role),
        toRole: nextRole,
        fromAssignedRoles: this.normalizeAssignedRolesOrThrow(existing.assignedRoles),
        toAssignedRoles: nextAssignedRoles,
      },
    });

    return this.mapWorkspaceUserRow(updated);
  }

  async lockUser(
    tenantId: string,
    actorId: string,
    actorRole: AppRole,
    targetUserId: string,
    dto: LockWorkspaceUserDto,
  ): Promise<WorkspaceUserRow> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    const normalizedActorId = this.normalizeUserId(actorId);
    const normalizedTargetUserId = this.normalizeUserId(targetUserId);

    if (normalizedTargetUserId === normalizedActorId) {
      throw new BadRequestException({ error: "CANNOT_LOCK_SELF" });
    }

    const existing = await this.findTenantUserOrThrow(normalizedTenantId, normalizedTargetUserId);
    const durationMinutes = this.clampDurationMinutes(dto.durationMinutes);
    const lockedUntil = new Date(Date.now() + durationMinutes * 60_000);

    const updated = await this.prisma.tenant(normalizedTenantId).authIdentity.update({
      where: {
        id: existing.id,
      },
      data: {
        lockedUntil,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        assignedRoles: true,
        isActive: true,
        lockedUntil: true,
        lastSignInAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.record({
      actorId: normalizedActorId,
      actorRole,
      action: "workspace_user.locked",
      resource: "AuthIdentity",
      resourceId: existing.id,
      metadata: {
        targetUserId: updated.userId,
        durationMinutes,
        reason: dto.reason ?? null,
        lockedUntil: lockedUntil.toISOString(),
      },
    });

    return this.mapWorkspaceUserRow(updated);
  }

  async unlockUser(
    tenantId: string,
    actorId: string,
    actorRole: AppRole,
    targetUserId: string,
  ): Promise<WorkspaceUserRow> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    const normalizedActorId = this.normalizeUserId(actorId);
    const normalizedTargetUserId = this.normalizeUserId(targetUserId);
    const existing = await this.findTenantUserOrThrow(normalizedTenantId, normalizedTargetUserId);

    const updated = await this.prisma.tenant(normalizedTenantId).authIdentity.update({
      where: {
        id: existing.id,
      },
      data: {
        lockedUntil: null,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        assignedRoles: true,
        isActive: true,
        lockedUntil: true,
        lastSignInAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.record({
      actorId: normalizedActorId,
      actorRole,
      action: "workspace_user.unlocked",
      resource: "AuthIdentity",
      resourceId: existing.id,
      metadata: {
        targetUserId: updated.userId,
      },
    });

    return this.mapWorkspaceUserRow(updated);
  }

  async deactivateUser(
    tenantId: string,
    actorId: string,
    actorRole: AppRole,
    targetUserId: string,
  ): Promise<WorkspaceUserRow> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    const normalizedActorId = this.normalizeUserId(actorId);
    const normalizedTargetUserId = this.normalizeUserId(targetUserId);

    if (normalizedTargetUserId === normalizedActorId) {
      throw new BadRequestException({ error: "CANNOT_DEACTIVATE_SELF" });
    }

    let existing = await this.findTenantUserOrThrow(normalizedTenantId, normalizedTargetUserId);

    // U-02: last-admin guard — prevent deactivating the final active admin.
    // Without this, a single-admin workspace can be permanently locked out.
    //
    // #816 fix, round 1 (Serializable transaction around count+update): closes
    // the naive two-round-trip race, but a real-Postgres write-skew
    // reproduction (two different admins deactivated concurrently, run 5x with
    // the actual compiled service code and natural Promise.allSettled timing —
    // no artificial delay) showed it does NOT reliably hold: Postgres's
    // Serializable Snapshot Isolation detects conflicts on COUNT aggregates
    // opportunistically, not with a 100% guarantee under realistic timing —
    // it caught the conflict when an artificial delay widened the overlap
    // window, and missed it 5/5 times without one.
    //
    // #816 fix, round 2 (this version): explicit pessimistic row locking via
    // `SELECT ... FOR UPDATE` on every currently-active admin row, inside the
    // transaction, BEFORE counting. A concurrent deactivation targeting a
    // DIFFERENT admin row will genuinely BLOCK on this SELECT until the first
    // transaction commits or rolls back — true mutual exclusion on the exact
    // rows the invariant depends on, not optimistic conflict detection after
    // the fact. This is the standard, reliable pattern for a "last one out"
    // invariant in Postgres. Re-verified via the same real-Postgres
    // reproduction, 5/5 runs, guard held every time (see
    // last-admin-guard-real-service-proof.cjs in the PR).
    const updated = await this.prisma.tenant(normalizedTenantId).$transaction(async (tx) => {
      if (existing.role === "admin") {
        const lockedActiveAdmins = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "AuthIdentity"
          WHERE "tenantKey" = ${normalizedTenantId} AND "role" = 'admin' AND "isActive" = true
          FOR UPDATE
        `;
        if (lockedActiveAdmins.length <= 1) {
          throw new BadRequestException({
            error: "LAST_ADMIN_GUARD",
            message: "Cannot deactivate the last active admin. Promote another user to admin first.",
          });
        }
      }

      return tx.authIdentity.update({
        where: {
          id: existing.id,
        },
        data: {
          isActive: false,
        },
        select: {
          id: true,
          userId: true,
          role: true,
          assignedRoles: true,
          isActive: true,
          lockedUntil: true,
          lastSignInAt: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    await this.auditService.record({
      actorId: normalizedActorId,
      actorRole,
      action: "workspace_user.deactivated",
      resource: "AuthIdentity",
      resourceId: existing.id,
      metadata: {
        targetUserId: updated.userId,
      },
    });

    return this.mapWorkspaceUserRow(updated);
  }

  async setUserPassword(
    tenantId: string,
    actorId: string,
    actorRole: AppRole,
    targetUserId: string,
    newPassword: string,
  ): Promise<{ ok: true }> {
    const normalizedTenantId = normalizeTenantKey(tenantId);
    const normalizedActorId = this.normalizeUserId(actorId);
    const normalizedTargetUserId = this.normalizeUserId(targetUserId);
    const normalizedPassword = String(newPassword ?? "");

    if (normalizedPassword.trim().length < 8) {
      throw new BadRequestException({ error: "PASSWORD_TOO_SHORT", minLength: 8 });
    }

    const existing = await this.findTenantUserOrThrow(normalizedTenantId, normalizedTargetUserId);
    const passwordHash = await bcrypt.hash(normalizedPassword, 12);

    await this.prisma.tenant(normalizedTenantId).authIdentity.update({
      where: {
        id: existing.id,
      },
      data: {
        passwordHash,
      },
    });

    await this.auditService.record({
      actorId: normalizedActorId,
      actorRole,
      action: "workspace_user.password_set",
      resource: "AuthIdentity",
      resourceId: existing.id,
      metadata: {
        targetUserId: existing.userId,
      },
    });

    return { ok: true };
  }

  private async findTenantUserOrThrow(tenantId: string, targetUserId: string): Promise<AuthIdentityRecord> {
    const row = await this.prisma.tenant(tenantId).authIdentity.findFirst({
      where: {
        tenantKey: tenantId,
        userId: targetUserId,
      },
      select: {
        id: true,
        userId: true,
        role: true,
        assignedRoles: true,
        isActive: true,
        lockedUntil: true,
        lastSignInAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!row) {
      throw new NotFoundException({ error: "USER_NOT_FOUND" });
    }
    return row;
  }

  private normalizeUserId(value: string): string {
    return String(value ?? "").trim().toLowerCase();
  }

  private normalizeRoleOrThrow(value: string): AppRole {
    const normalized = normalizeAppRole(value);
    if (!normalized) {
      throw new BadRequestException({ error: "INVALID_ROLE" });
    }
    return normalized;
  }

  private async assertRoleAllowedForTenantPlan(tenantKey: string, role: AppRole): Promise<void> {
    const planTier = await this.planUsage.getTenantPlanTier(tenantKey);
    if (!isRoleAvailableForTier(role, planTier)) {
      throw new BadRequestException({
        error: "ROLE_NOT_AVAILABLE_IN_PLAN",
        role,
        planTier,
        availableRoles: availableRolesForTier(planTier),
      });
    }
  }

  private normalizeAssignedRolesOrThrow(value: unknown): FoundationRole[] {
    if (value === undefined || value === null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new BadRequestException({ error: "INVALID_ASSIGNED_ROLES" });
    }
    const normalized = value
      .map((entry) => normalizeFoundationRole(entry))
      .filter(Boolean) as FoundationRole[];
    if (normalized.length !== value.length) {
      throw new BadRequestException({ error: "INVALID_ASSIGNED_ROLES" });
    }
    return Array.from(new Set(normalized));
  }

  private normalizeManagedAssignedRolesOrThrow(baseRole: AppRole, value: unknown): FoundationRole[] {
    const normalized = this.normalizeAssignedRolesOrThrow(value);
    if (normalized.length === 0) {
      return normalized;
    }
    if (normalized.length > 1) {
      throw new BadRequestException({ error: "MULTI_ASSIGNED_ROLE_SET_NOT_SUPPORTED" });
    }
    const [assignedRole] = normalized;
    if (assignedRole === "reviewer" || assignedRole === "editor") {
      if (this.isSupportedAppRoleBridge(baseRole, assignedRole)) {
        return normalized;
      }
      throw new BadRequestException({ error: "ASSIGNED_ROLE_DOES_NOT_WIDEN_BASE_ROLE" });
    }
    // Enterprise specialist roles — any base role can be granted a specialist role
    // that is narrower in scope than their base role.
    const ENTERPRISE_SPECIALIST_ROLES = ["publisher", "approver", "channel_manager", "connector_admin"] as const;
    if (ENTERPRISE_SPECIALIST_ROLES.includes(assignedRole as (typeof ENTERPRISE_SPECIALIST_ROLES)[number])) {
      return normalized;
    }
    if (assignedRole === "product_admin" || assignedRole === "system_admin") {
      if (baseRole !== "admin") {
        throw new BadRequestException({ error: "ADMIN_BOUNDARY_ASSIGNED_ROLE_REQUIRES_ADMIN_BASE_ROLE" });
      }
      return normalized;
    }
    throw new BadRequestException({ error: "MANAGED_ASSIGNED_ROLE_NOT_SUPPORTED" });
  }

  private isSupportedAppRoleBridge(baseRole: AppRole, assignedRole: FoundationRole): boolean {
    if (assignedRole !== "reviewer" && assignedRole !== "editor") {
      return false;
    }
    if (baseRole === "viewer") {
      return assignedRole === "reviewer" || assignedRole === "editor";
    }
    if (baseRole === "reviewer") {
      return assignedRole === "editor";
    }
    return false;
  }

  private clampDurationMinutes(value: number | undefined): number {
    if (!Number.isFinite(value)) {
      return 60;
    }
    return Math.min(10_080, Math.max(1, Math.floor(Number(value))));
  }

  private isDbMode(): boolean {
    return String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
  }

  private isStrictRuntime(): boolean {
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
    return appEnv === "staging" || appEnv === "production";
  }

  private async resolveInitialPasswordHash(initialPassword?: string): Promise<string | null> {
    const explicitPassword = typeof initialPassword === "string" ? initialPassword : "";
    if (explicitPassword.trim().length > 0) {
      return bcrypt.hash(explicitPassword, 12);
    }

    if (this.isDbMode()) {
      return null;
    }

    const configuredPassword = String(process.env.PIM_AUTH_PASSWORD ?? "").trim();
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
    const allowLocalDefault = appEnv === "development" || appEnv === "local" || appEnv === "test";
    const sharedPassword = configuredPassword || (allowLocalDefault ? "vexa-pim-demo-password" : "");
    if (!sharedPassword) {
      return null;
    }
    return bcrypt.hash(sharedPassword, 12);
  }

  private mapWorkspaceUserRow(row: AuthIdentityRecord, mfaEnrolled = false): WorkspaceUserRow {
    const lockedUntil = row.lockedUntil ? new Date(row.lockedUntil) : null;
    const assignedRoles = Array.isArray(row.assignedRoles)
      ? row.assignedRoles
          .map((entry) => normalizeFoundationRole(entry))
          .filter(Boolean) as FoundationRole[]
      : [];
    return {
      id: row.id,
      userId: this.normalizeUserId(row.userId),
      role: this.normalizeRoleOrThrow(row.role),
      assignedRoles: Array.from(new Set(assignedRoles)),
      isActive: row.isActive,
      lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
      isLocked: Boolean(lockedUntil && lockedUntil.getTime() > Date.now()),
      mfaEnrolled,
      lastSignInAt: row.lastSignInAt ? new Date(row.lastSignInAt).toISOString() : null,
      createdBy: row.createdBy,
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
  }
}
