import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AppRole } from "../common/rbac/roles";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PlanUsageService } from "../billing/plan-usage.service";
import { PrismaService } from "../prisma/prisma.service";

export type ConnectorPermissionAction = "install" | "reconnect" | "uninstall";

export interface ConnectorActor {
  actorId: string;
  actorRole: AppRole;
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

@Injectable()
export class ConnectorPermissionService {
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

    if (options.action === "install") {
      const planRule = await this.evaluateInstallPlanRule(options.connectorSlug);
      if (!planRule.allowed) {
        return { allowed: false, reason: planRule.reason };
      }
    }

    const tenantKey = this.getTenantKey();
    const normalizedSlug = options.connectorSlug.trim().toLowerCase();
    const normalizedAlias = String(options.accountAlias ?? "*").trim() || "*";

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
        AND "action" = ${options.action}
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
    const principalId = input.principalId.trim();
    const connectorSlug = input.connectorSlug.trim().toLowerCase();
    const accountAlias = String(input.accountAlias ?? "*").trim() || "*";

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
          ${input.principalType},
          ${principalId},
          ${connectorSlug},
          ${accountAlias},
          ${input.action},
          ${input.actor.actorId},
          NOW(),
          NOW()
        )
      ON CONFLICT ("tenantKey", "principalType", "principalId", "connectorSlug", "accountAlias", "action")
      DO UPDATE SET
        "updatedAt" = NOW(),
        "createdBy" = EXCLUDED."createdBy"
    `);

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
        AND "principalType" = ${input.principalType}
        AND "principalId" = ${principalId}
        AND "connectorSlug" = ${connectorSlug}
        AND "accountAlias" = ${accountAlias}
        AND "action" = ${input.action}
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

    await this.prisma.tenant(tenantKey).$executeRaw(Prisma.sql`
      DELETE FROM "ConnectorPermission"
      WHERE "tenantKey" = ${tenantKey} AND "id" = ${permissionId}
    `);

    return { id: permissionId, status: "DELETED" };
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
