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

    const existing = await this.findTenantUserOrThrow(normalizedTenantId, normalizedTargetUserId);

    // U-02: last-admin guard — prevent deactivating the final active admin.
    // Without this, a single-admin workspace can be permanently locked out.
    //
    // #816 fix: the guard's count-and-then-update was two separate round trips
    // against the tenant's own PrismaClient (one plain `count`, one plain
    // `update`), with no transaction tying them together. Under READ COMMITTED
    // (Postgres's default), a concurrent request — e.g. two admin deactivations
    // submitted close together, or another automation hitting this same
    // endpoint — can each independently observe `activeAdminCount > 1` (or, in
    // this bug's confirmed live reproduction, the guard's own count simply not
    // reflecting the same state the UI's Governance Snapshot had just shown)
    // and both proceed, leaving zero active admins with no error surfaced.
    // Serializable isolation forces Postgres to abort one side with a
    // serialization failure if the two transactions would otherwise interleave
    // unsafely, so the count-then-update is now atomic with respect to any
    // other concurrent deactivation.
    const updated = await this.prisma.tenant(normalizedTenantId).$transaction(
      async (tx) => {
        if (existing.role === "admin") {
          const activeAdminCount = await tx.authIdentity.count({
            where: { role: "admin", isActive: true },
          });
          if (activeAdminCount <= 1) {
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
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

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
