import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import { normalizeAppRole } from "../common/rbac/role-utils";
import { AppRole } from "../common/rbac/roles";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";

export type ConnectorPermissionAction = "install" | "reconnect" | "uninstall";

export interface ConnectorActor {
  actorId: string;
  actorRole: AppRole;
  adminBoundaryRoles?: readonly string[];
}

export interface ConnectorActionRule {
  allowed: boolean;
  reason: string | null;
}

export interface ConnectorActionMatrix {
  install: ConnectorActionRule;
  reconnect: ConnectorActionRule;
  uninstall: ConnectorActionRule;
}

export interface ConnectorPermissionRow {
  id: string;
  tenantKey: string;
  principalType: "user" | "role";
  principalId: string;
  connectorSlug: string;
  accountAlias: string;
  action: ConnectorPermissionAction;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PermissionLookupOptions {
  connectorSlug: string;
  action: ConnectorPermissionAction;
  accountAlias?: string;
}

interface InstallPlanCheck {
  allowed: boolean;
  reason: string | null;
}

interface LocalIdentityRecord {
  tenantId: string;
}

@Injectable()
export class ConnectorPermissionService {
  private readonly identityDirectory = this.loadIdentityDirectory();

  constructor(
    private readonly prisma: PrismaService,
    private readonly planUsageService: PlanUsageService,
    private readonly auditService: AuditService,
  ) {}

  private getTenantKey(): string {
    return normalizeTenantKey(getTenantKeyFromContext());
  }

  async resolveActionRule(
    actor: ConnectorActor,
    options: PermissionLookupOptions,
  ): Promise<ConnectorActionRule> {
    if (actor.actorRole === "admin") {
      if (options.action === "install") {
        const planRule = await this.evaluateInstallPlanRule(options.connectorSlug);
        if (!planRule.allowed) {
          return { allowed: false, reason: planRule.reason };
        }
      }
      return { allowed: true, reason: null };
    }

    const CONNECTOR_ADMIN_ACTIONS: ConnectorPermissionAction[] = ["install", "reconnect", "uninstall"];
    if (actor.actorRole === "connector_admin" && CONNECTOR_ADMIN_ACTIONS.includes(options.action)) {
      if (options.action === "install") {
        const planRule = await this.evaluateInstallPlanRule(options.connectorSlug);
        if (!planRule.allowed) {
          return { allowed: false, reason: planRule.reason };
        }
      }
      return { allowed: true, reason: null };
    }

    if (options.action === "install") {
      const planRule = await this.evaluateInstallPlanRule(options.connectorSlug);
      if (!planRule.allowed) {
        return { allowed: false, reason: planRule.reason };
      }
    }

    const tenantKey = this.getTenantKey();
    const normalizedSlug = options.connectorSlug.trim().toLowerCase();
    const normalizedAlias = String(options.accountAlias ?? "*").trim() || "*";

    // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<ConnectorPermissionRow[]>(Prisma.sql`
      SELECT
        "id" AS "id",
        "tenantKey" AS "tenantKey",
        "principalType" AS "principalType",
        "principalId" AS "principalId",
        "connectorSlug" AS "connectorSlug",
        "accountAlias" AS "accountAlias",
        "action" AS "action",
        "createdBy" AS "createdBy",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt"
      FROM "ConnectorPermission"
      WHERE "tenantKey" = ${tenantKey}
        AND "connectorSlug" = ${normalizedSlug}
        AND "action"::text = ${options.action}
        AND (
          ("principalType" = 'user' AND "principalId" = ${actor.actorId})
          OR ("principalType" = 'role' AND "principalId" = ${actor.actorRole})
        )
        AND "accountAlias" IN ('*', ${normalizedAlias})
      LIMIT 1
    `);

    if (rows[0]) {
      return { allowed: true, reason: null };
    }

    return { allowed: false, reason: "CONNECTOR_PERMISSION_REQUIRED" };
  }

  async assertActionAllowed(actor: ConnectorActor, options: PermissionLookupOptions): Promise<void> {
    const decision = await this.resolveActionRule(actor, options);
    if (decision.allowed) {
      return;
    }

    throw new ForbiddenException({
      error: "CONNECTOR_PERMISSION_DENIED",
      action: options.action,
      connectorSlug: options.connectorSlug,
      accountAlias: options.accountAlias ?? "*",
      reason: decision.reason ?? "CONNECTOR_PERMISSION_REQUIRED",
    });
  }

  async buildDefinitionActions(
    actor: ConnectorActor,
    connectorSlug: string,
  ): Promise<ConnectorActionMatrix> {
    const install = await this.resolveActionRule(actor, {
      connectorSlug,
      action: "install",
      accountAlias: "*",
    });

    return {
      install,
      reconnect: {
        allowed: false,
        reason: "INSTALLATION_REQUIRED",
      },
      uninstall: {
        allowed: false,
        reason: "INSTALLATION_REQUIRED",
      },
    };
  }

  /**
   * Batch variant of buildDefinitionActions for use in listAvailableDefinitions.
   * Replaces N per-slug sequential plan checks with:
   *   - 1× recomputeUsage + getPlanLimits (shared)
   *   - N parallel getConnectorAccountCount queries
   *   - 1× bulk ConnectorPermission fetch for non-admin actors
   */
  async buildDefinitionActionsForSlugs(
    actor: ConnectorActor,
    slugs: string[],
  ): Promise<Map<string, ConnectorActionMatrix>> {
    const result = new Map<string, ConnectorActionMatrix>();
    if (slugs.length === 0) return result;

    const tenantKey = this.getTenantKey();
    const normalizedSlugs = slugs.map((s) => s.trim().toLowerCase());

    // Single batch plan check: 2 shared queries + N parallel account-count queries
    const planResults = await this.planUsageService.checkInstallLimitBatch(normalizedSlugs, tenantKey);

    if (actor.actorRole === "admin" || actor.actorRole === "connector_admin") {
      for (let i = 0; i < slugs.length; i++) {
        const planRule = planResults.get(normalizedSlugs[i]) ?? { allowed: true, reason: null };
        result.set(slugs[i], {
          install: planRule,
          reconnect: { allowed: false, reason: "INSTALLATION_REQUIRED" },
          uninstall: { allowed: false, reason: "INSTALLATION_REQUIRED" },
        });
      }
      return result;
    }

    // Non-admin/non-connector_admin: one batch query for all install permissions across all slugs
    const permittedSlugs = await this.batchFetchInstallPermittedSlugs(tenantKey, actor, normalizedSlugs);

    for (let i = 0; i < slugs.length; i++) {
      const planRule = planResults.get(normalizedSlugs[i]) ?? { allowed: true, reason: null };
      let install: ConnectorActionRule;
      if (!planRule.allowed) {
        install = planRule;
      } else if (permittedSlugs.has(normalizedSlugs[i])) {
        install = { allowed: true, reason: null };
      } else {
        install = { allowed: false, reason: "CONNECTOR_PERMISSION_REQUIRED" };
      }
      result.set(slugs[i], {
        install,
        reconnect: { allowed: false, reason: "INSTALLATION_REQUIRED" },
        uninstall: { allowed: false, reason: "INSTALLATION_REQUIRED" },
      });
    }

    return result;
  }

  private async batchFetchInstallPermittedSlugs(
    tenantKey: string,
    actor: ConnectorActor,
    normalizedSlugs: string[],
  ): Promise<Set<string>> {
    if (normalizedSlugs.length === 0) return new Set();

    // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<Array<{ connectorSlug: string }>>(Prisma.sql`
      SELECT DISTINCT "connectorSlug" AS "connectorSlug"
      FROM "ConnectorPermission"
      WHERE "tenantKey" = ${tenantKey}
        AND "action"::text = 'install'
        AND "connectorSlug" = ANY(${normalizedSlugs}::text[])
        AND (
          ("principalType" = 'user' AND "principalId" = ${actor.actorId})
          OR ("principalType" = 'role' AND "principalId" = ${actor.actorRole})
        )
    `);

    return new Set(rows.map((r) => r.connectorSlug));
  }

  async buildInstallationActions(
    actor: ConnectorActor,
    connectorSlug: string,
    accountAlias: string,
  ): Promise<ConnectorActionMatrix> {
    return {
      install: {
        allowed: false,
        reason: "ALREADY_INSTALLED",
      },
      reconnect: await this.resolveActionRule(actor, {
        connectorSlug,
        action: "reconnect",
        accountAlias,
      }),
      uninstall: await this.resolveActionRule(actor, {
        connectorSlug,
        action: "uninstall",
        accountAlias,
      }),
    };
  }

  async listPermissions(connectorSlug?: string): Promise<ConnectorPermissionRow[]> {
    const tenantKey = this.getTenantKey();
    const normalizedSlug = String(connectorSlug ?? "").trim().toLowerCase();

    if (normalizedSlug) {
      // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
      return this.prisma.tenant(tenantKey).$queryRaw<ConnectorPermissionRow[]>(Prisma.sql`
        SELECT
          "id" AS "id",
          "tenantKey" AS "tenantKey",
          "principalType" AS "principalType",
          "principalId" AS "principalId",
          "connectorSlug" AS "connectorSlug",
          "accountAlias" AS "accountAlias",
          "action" AS "action",
          "createdBy" AS "createdBy",
          "createdAt" AS "createdAt",
          "updatedAt" AS "updatedAt"
        FROM "ConnectorPermission"
        WHERE "tenantKey" = ${tenantKey}
          AND "connectorSlug" = ${normalizedSlug}
        ORDER BY "connectorSlug" ASC, "principalType" ASC, "principalId" ASC, "action" ASC
      `);
    }

    // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
    return this.prisma.tenant(tenantKey).$queryRaw<ConnectorPermissionRow[]>(Prisma.sql`
      SELECT
        "id" AS "id",
        "tenantKey" AS "tenantKey",
        "principalType" AS "principalType",
        "principalId" AS "principalId",
        "connectorSlug" AS "connectorSlug",
        "accountAlias" AS "accountAlias",
        "action" AS "action",
        "createdBy" AS "createdBy",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt"
      FROM "ConnectorPermission"
      WHERE "tenantKey" = ${tenantKey}
      ORDER BY "connectorSlug" ASC, "principalType" ASC, "principalId" ASC, "action" ASC
    `);
  }

  async grantPermission(input: {
    actor: ConnectorActor;
    principalType: "user" | "role";
    principalId: string;
    connectorSlug: string;
    accountAlias?: string;
    action: ConnectorPermissionAction;
  }): Promise<ConnectorPermissionRow> {
    const tenantKey = this.getTenantKey();
    const { principalId, principalType } = await this.validatePrincipal(input.principalType, input.principalId);
    const connectorSlug = input.connectorSlug.trim().toLowerCase();
    const accountAlias = String(input.accountAlias ?? "*").trim() || "*";

    // RLS-BYPASS: manual tenant filter — tenantKey is an explicit INSERT column
    // and part of the ON CONFLICT target below.
    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      INSERT INTO "ConnectorPermission"
        (
          "id",
          "tenantKey",
          "principalType",
          "principalId",
          "connectorSlug",
          "accountAlias",
          "action",
          "createdBy",
          "createdAt",
          "updatedAt"
        )
      VALUES
        (
          ${randomUUID()},
          ${tenantKey},
          ${Prisma.raw(`'${principalType}'::"ConnectorPermissionPrincipalType"`)},
          ${principalId},
          ${connectorSlug},
          ${accountAlias},
          ${Prisma.raw(`'${input.action}'::"ConnectorPermissionAction"`)},
          ${input.actor.actorId},
          NOW(),
          NOW()
        )
      ON CONFLICT ("tenantKey", "principalType", "principalId", "connectorSlug", "accountAlias", "action")
      DO UPDATE SET
        "updatedAt" = NOW(),
        "createdBy" = EXCLUDED."createdBy"
    `);

    // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<ConnectorPermissionRow[]>(Prisma.sql`
      SELECT
        "id" AS "id",
        "tenantKey" AS "tenantKey",
        "principalType" AS "principalType",
        "principalId" AS "principalId",
        "connectorSlug" AS "connectorSlug",
        "accountAlias" AS "accountAlias",
        "action" AS "action",
        "createdBy" AS "createdBy",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt"
      FROM "ConnectorPermission"
      WHERE "tenantKey" = ${tenantKey}
        AND "principalType"::text = ${principalType}
        AND "principalId" = ${principalId}
        AND "connectorSlug" = ${connectorSlug}
        AND "accountAlias" = ${accountAlias}
        AND "action"::text = ${input.action}
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Connector permission could not be retrieved after upsert.");
    }

    await this.auditService.record({
      actorId: input.actor.actorId,
      actorRole: input.actor.actorRole,
      action: "CONNECTOR_PERMISSION_GRANT",
      resource: "CONNECTOR_PERMISSION",
      resourceId: row.id,
      metadata: {
        principalType: row.principalType,
        principalId: row.principalId,
        connectorSlug: row.connectorSlug,
        accountAlias: row.accountAlias,
        actionType: row.action,
      },
    });

    return row;
  }

  async revokePermission(permissionId: string, actor: ConnectorActor): Promise<{ id: string; status: "DELETED" }> {
    const tenantKey = this.getTenantKey();
    // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<ConnectorPermissionRow[]>(Prisma.sql`
      SELECT
        "id" AS "id",
        "tenantKey" AS "tenantKey",
        "principalType" AS "principalType",
        "principalId" AS "principalId",
        "connectorSlug" AS "connectorSlug",
        "accountAlias" AS "accountAlias",
        "action" AS "action",
        "createdBy" AS "createdBy",
        "createdAt" AS "createdAt",
        "updatedAt" AS "updatedAt"
      FROM "ConnectorPermission"
      WHERE "tenantKey" = ${tenantKey} AND "id" = ${permissionId}
      LIMIT 1
    `);

    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Connector permission not found.");
    }

    await this.auditService.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "CONNECTOR_PERMISSION_REVOKE",
      resource: "CONNECTOR_PERMISSION",
      resourceId: row.id,
      metadata: {
        principalType: row.principalType,
        principalId: row.principalId,
        connectorSlug: row.connectorSlug,
        accountAlias: row.accountAlias,
        actionType: row.action,
      },
    });

    // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      DELETE FROM "ConnectorPermission"
      WHERE "tenantKey" = ${tenantKey} AND "id" = ${permissionId}
    `);

    return { id: permissionId, status: "DELETED" };
  }

  private async validatePrincipal(
    principalType: "user" | "role",
    principalIdInput: string,
  ): Promise<{ principalType: "user" | "role"; principalId: string }> {
    if (principalType === "role") {
      const normalizedRole = normalizeAppRole(principalIdInput);
      if (!normalizedRole) {
        throw new BadRequestException({
          error: "CONNECTOR_PERMISSION_INVALID_ROLE",
          message: "Role must be one of admin, editor, reviewer, or viewer.",
          statusCode: 400,
        });
      }
      return { principalType, principalId: normalizedRole };
    }

    const principalId = this.normalizeUserKey(principalIdInput);
    if (!principalId) {
      throw new BadRequestException({
        error: "CONNECTOR_PERMISSION_USER_REQUIRED",
        message: "User ID is required when principal type is user.",
        statusCode: 400,
      });
    }

    const exists = await this.userExistsForTenant(principalId);
    if (!exists) {
      throw new BadRequestException({
        error: "CONNECTOR_PERMISSION_USER_NOT_FOUND",
        message: "User ID was not found in this workspace.",
        statusCode: 400,
      });
    }

    return { principalType, principalId };
  }

  private async userExistsForTenant(userId: string): Promise<boolean> {
    const tenantKey = this.getTenantKey();

    if (this.isDbAuthMode()) {
      // RLS-BYPASS: manual tenant filter — WHERE "tenantKey" = ${tenantKey} below.
      const rows = await this.prisma.tenant().$queryRaw<Array<{ userId: string; isActive: boolean }>>(Prisma.sql`
        SELECT
          "userId" AS "userId",
          "isActive" AS "isActive"
        FROM "AuthIdentity"
        WHERE "tenantKey" = ${tenantKey}
          AND "userId" = ${userId}
        LIMIT 1
      `);
      return Boolean(rows[0]?.userId) && Boolean(rows[0]?.isActive);
    }

    const localIdentity = this.identityDirectory.get(userId);
    if (localIdentity) {
      return localIdentity.tenantId === tenantKey;
    }

    if (this.isLocalAuthMode()) {
      if (this.identityDirectory.size > 0) {
        return false;
      }
      return normalizeTenantKey(process.env.PIM_DEFAULT_TENANT_KEY) === tenantKey;
    }

    return false;
  }

  private normalizeUserKey(value: string): string {
    return String(value ?? "").trim().toLowerCase();
  }

  private loadIdentityDirectory(): Map<string, LocalIdentityRecord> {
    const directory = new Map<string, LocalIdentityRecord>();
    if (!this.isLocalAuthMode()) {
      return directory;
    }

    const raw = String(process.env.PIM_AUTH_IDENTITIES_JSON ?? "").trim();
    if (!raw) {
      return directory;
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [userIdRaw, value] of Object.entries(parsed)) {
        const normalizedUserId = this.normalizeUserKey(userIdRaw);
        if (!normalizedUserId || !value || typeof value !== "object" || Array.isArray(value)) {
          continue;
        }
        const candidate = value as Record<string, unknown>;
        directory.set(normalizedUserId, {
          tenantId: normalizeTenantKey(candidate.tenantId),
        });
      }
    } catch {
      return directory;
    }

    return directory;
  }

  private isDbAuthMode(): boolean {
    const authMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase();
    return authMode === "db";
  }

  private isLocalAuthMode(): boolean {
    const authMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase();
    if (authMode === "db") {
      return false;
    }
    if (authMode === "local") {
      return true;
    }
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development")
      .trim()
      .toLowerCase();
    return appEnv === "development" || appEnv === "local" || appEnv === "test";
  }

  private async evaluateInstallPlanRule(connectorSlug: string): Promise<InstallPlanCheck> {
    const tenantKey = this.getTenantKey();
    const installCheck = await this.planUsageService.checkLimit(
      "connectors_installations",
      1,
      tenantKey,
    );
    if (!installCheck.allowed) {
      return {
        allowed: false,
        reason: "PLAN_CONNECTOR_INSTALLATIONS_LIMIT_EXCEEDED",
      };
    }

    const accountCheck = await this.planUsageService.checkLimit(
      "connector_accounts",
      1,
      tenantKey,
      { connectorSlug },
    );
    if (!accountCheck.allowed) {
      return {
        allowed: false,
        reason: "PLAN_CONNECTOR_ACCOUNTS_LIMIT_EXCEEDED",
      };
    }

    return {
      allowed: true,
      reason: null,
    };
  }
}

