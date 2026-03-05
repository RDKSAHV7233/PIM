import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { AppRole } from "../common/rbac/roles";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { MarketplaceService } from "../marketplace/marketplace.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectorCap } from "../connector-framework/connector.interface";
import {
  ConnectorDefinitionRecord,
  ConnectorInstallationRecord,
  PaginatedResponse,
} from "../connector-framework/connector.types";
import {
  ConnectorActor,
  ConnectorPermissionService,
} from "./connector-permission.service";
import { ConnectorPayloadPreviewDto } from "./dto/connector-payload-preview.dto";
import { InstallConnectorDto } from "./dto/install-connector.dto";
import { ListInstalledConnectorsDto } from "./dto/list-installed-connectors.dto";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

type CursorPayload = {
  installedAt: string;
  id: string;
};

function parseCapabilities(raw: unknown): ConnectorCap[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is ConnectorCap => typeof value === "string") as ConnectorCap[];
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((value) => value.replace(/^"|"$/g, "").trim())
        .filter((value) => value.length > 0) as ConnectorCap[];
    }
  }
  return [];
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof decoded.installedAt !== "string" || typeof decoded.id !== "string") {
      return null;
    }
    return {
      installedAt: decoded.installedAt,
      id: decoded.id,
    };
  } catch {
    return null;
  }
}

@Injectable()
export class ConnectorInstallerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly marketplaceService: MarketplaceService,
    private readonly connectorPermissionService: ConnectorPermissionService,
  ) {}

  private getTenantKey(): string {
    return getTenantKeyFromContext();
  }

  async listAvailableDefinitions(actor: ConnectorActor): Promise<ConnectorDefinitionRecord[]> {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant().$queryRawUnsafe<Array<Record<string, unknown>>>(`
      SELECT
        id,
        slug,
        display_name AS "displayName",
        auth_type AS "authType",
        capabilities,
        marketplace_id AS "marketplaceId",
        connector_version AS "connectorVersion",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM connector_definitions
      WHERE is_active = TRUE
      ORDER BY display_name ASC
    `);

    return Promise.all(
      rows.map(async (row) => {
        const slug = String(row.slug);
        return {
          id: String(row.id),
          slug,
          displayName: String(row.displayName),
          authType: String(row.authType),
          capabilities: parseCapabilities(row.capabilities),
          marketplaceId: row.marketplaceId ? String(row.marketplaceId) : null,
          connectorVersion: String(row.connectorVersion),
          isActive: Boolean(row.isActive),
          createdAt: String(row.createdAt),
          updatedAt: String(row.updatedAt),
          actions: await this.connectorPermissionService.buildDefinitionActions(actor, slug),
        };
      }),
    );
  }

  async install(slug: string, dto: InstallConnectorDto, actor: ConnectorActor): Promise<ConnectorInstallationRecord> {
    const tenantKey = this.getTenantKey();
    const normalizedSlug = slug.trim().toLowerCase();
    const accountAlias = (dto.accountAlias ?? "primary").trim() || "primary";

    await this.auditService.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "CONNECTOR_INSTALL_ATTEMPT",
      resource: "CONNECTOR_INSTALLATION",
      metadata: {
        connectorSlug: normalizedSlug,
        accountAlias,
      },
    });

    try {
      await this.connectorPermissionService.assertActionAllowed(actor, {
        connectorSlug: normalizedSlug,
        action: "install",
        accountAlias,
      });

      // RLS-BYPASS: manual tenant filter
      const definitionRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
        `
        SELECT
          id,
          slug,
          display_name AS "displayName",
          capabilities
        FROM connector_definitions
        WHERE slug = $1 AND is_active = TRUE
        LIMIT 1
        `,
        normalizedSlug,
      );
      const definition = definitionRows[0];
      if (!definition) {
        throw new NotFoundException(`Connector '${normalizedSlug}' is not available.`);
      }

      try {
        // RLS-BYPASS: manual tenant filter
        await this.prisma.tenant(tenantKey).$executeRawUnsafe(
          `
          INSERT INTO connector_installations (
            id,
            tenant_key,
            connector_id,
            account_alias,
            external_account_ref,
            status,
            metadata,
            installed_by
          ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', '{}'::jsonb, $6)
          `,
          randomUUID(),
          tenantKey,
          String(definition.id),
          accountAlias,
          dto.externalAccountRef?.trim() || null,
          actor.actorId,
        );
      } catch (error: unknown) {
        if (error instanceof Error && "code" in error && (error as { code?: string }).code === "23505") {
          throw new ConflictException(
            `Connector '${normalizedSlug}' with account alias '${accountAlias}' is already installed for this tenant.`,
          );
        }
        throw error;
      }

      const installed = await this.listInstalled(
        {
          limit: 1,
          cursor: undefined,
        },
        normalizedSlug,
        actor,
      );
      const item = installed.items[0];
      if (!item) {
        throw new BadRequestException("Connector installed but could not be retrieved.");
      }

      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_INSTALL_SUCCESS",
        resource: "CONNECTOR_INSTALLATION",
        resourceId: item.id,
        metadata: {
          connectorSlug: item.slug,
          accountAlias: item.accountAlias,
        },
      });
      return item;
    } catch (error: unknown) {
      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_INSTALL_FAILURE",
        resource: "CONNECTOR_INSTALLATION",
        metadata: {
          connectorSlug: normalizedSlug,
          accountAlias,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async listInstalled(
    query: ListInstalledConnectorsDto,
    slugFilter?: string,
    actor?: ConnectorActor,
  ): Promise<PaginatedResponse<ConnectorInstallationRecord>> {
    const tenantKey = this.getTenantKey();
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
    const cursor = decodeCursor(query.cursor);

    const params: unknown[] = [tenantKey];
    let cursorWhere = "";
    if (cursor) {
      params.push(cursor.installedAt);
      params.push(cursor.id);
      cursorWhere = `
        AND (
          ci.installed_at < $${params.length - 1}::timestamptz
          OR (ci.installed_at = $${params.length - 1}::timestamptz AND ci.id < $${params.length})
        )
      `;
    }

    let slugWhere = "";
    if (slugFilter) {
      params.push(slugFilter);
      slugWhere = ` AND cd.slug = $${params.length}`;
    }

    params.push(limit + 1);
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        ci.id,
        ci.tenant_key AS "tenantKey",
        ci.connector_id AS "connectorId",
        cd.slug,
        cd.display_name AS "displayName",
        ci.account_alias AS "accountAlias",
        ci.external_account_ref AS "externalAccountRef",
        ci.status,
        cd.capabilities,
        ci.metadata,
        ci.installed_at AS "installedAt",
        ci.installed_by AS "installedBy",
        ci.last_sync_at AS "lastSyncAt",
        ci.created_at AS "createdAt",
        ci.updated_at AS "updatedAt"
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.tenant_key = $1
      ${slugWhere}
      ${cursorWhere}
      ORDER BY ci.installed_at DESC, ci.id DESC
      LIMIT $${params.length}
      `,
      ...params,
    );

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const items = await Promise.all(
      pageRows.map(async (row): Promise<ConnectorInstallationRecord> => {
        const slug = String(row.slug);
        const accountAlias = String(row.accountAlias);
        return {
          id: String(row.id),
          tenantKey: String(row.tenantKey),
          connectorId: String(row.connectorId),
          slug,
          displayName: String(row.displayName),
          accountAlias,
          externalAccountRef: row.externalAccountRef ? String(row.externalAccountRef) : null,
          status: String(row.status) as ConnectorInstallationRecord["status"],
          capabilities: parseCapabilities(row.capabilities),
          metadata: parseMetadata(row.metadata),
          installedAt: String(row.installedAt),
          installedBy: String(row.installedBy),
          lastSyncAt: row.lastSyncAt ? String(row.lastSyncAt) : null,
          createdAt: String(row.createdAt),
          updatedAt: String(row.updatedAt),
          actions: actor
            ? await this.connectorPermissionService.buildInstallationActions(actor, slug, accountAlias)
            : undefined,
        };
      }),
    );

    const last = items[items.length - 1];
    return {
      items,
      limit,
      nextCursor:
        hasNext && last
          ? encodeCursor({ installedAt: last.installedAt, id: last.id })
          : null,
    };
  }

  async uninstall(installationId: string, actor: ConnectorActor) {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationForAction(installationId, tenantKey);

    await this.auditService.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "CONNECTOR_UNINSTALL_ATTEMPT",
      resource: "CONNECTOR_INSTALLATION",
      resourceId: installationId,
      metadata: {
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
      },
    });

    try {
      await this.connectorPermissionService.assertActionAllowed(actor, {
        connectorSlug: installation.slug,
        action: "uninstall",
        accountAlias: installation.accountAlias,
      });

      // RLS-BYPASS: manual tenant filter
      const affected = await this.prisma.tenant(tenantKey).$executeRawUnsafe(
        `
        UPDATE connector_installations
        SET status = 'DISABLED', updated_at = NOW()
        WHERE id = $1 AND tenant_key = $2
        `,
        installationId,
        tenantKey,
      );
      if (affected === 0) {
        throw new NotFoundException("Connector installation not found.");
      }

      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_UNINSTALL_SUCCESS",
        resource: "CONNECTOR_INSTALLATION",
        resourceId: installationId,
        metadata: {
          status: "DISABLED",
          connectorSlug: installation.slug,
          accountAlias: installation.accountAlias,
        },
      });
      return { id: installationId, status: "DISABLED" };
    } catch (error: unknown) {
      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_UNINSTALL_FAILURE",
        resource: "CONNECTOR_INSTALLATION",
        resourceId: installationId,
        metadata: {
          connectorSlug: installation.slug,
          accountAlias: installation.accountAlias,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async deleteInstallation(installationId: string, actor: ConnectorActor, expectedSlug?: string) {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationForAction(installationId, tenantKey);
    const normalizedExpectedSlug = String(expectedSlug ?? "").trim().toLowerCase();
    const installationSlug = String(installation.slug).trim().toLowerCase();
    if (normalizedExpectedSlug && normalizedExpectedSlug !== installationSlug) {
      throw new BadRequestException({
        error: "CONNECTOR_SLUG_MISMATCH",
        expectedSlug: normalizedExpectedSlug,
        actualSlug: installationSlug,
      });
    }

    await this.auditService.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "CONNECTOR_DELETE_ATTEMPT",
      resource: "CONNECTOR_INSTALLATION",
      resourceId: installationId,
      metadata: {
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
      },
    });

    try {
      await this.connectorPermissionService.assertActionAllowed(actor, {
        connectorSlug: installation.slug,
        action: "uninstall",
        accountAlias: installation.accountAlias,
      });

      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_DELETE_SUCCESS",
        resource: "CONNECTOR_INSTALLATION",
        resourceId: installationId,
        metadata: {
          connectorSlug: installation.slug,
          accountAlias: installation.accountAlias,
        },
      });

      // RLS-BYPASS: manual tenant filter
      const affected = await this.prisma.tenant(tenantKey).$executeRawUnsafe(
        `
        DELETE FROM connector_installations
        WHERE id = $1 AND tenant_key = $2
        `,
        installationId,
        tenantKey,
      );
      if (affected === 0) {
        throw new NotFoundException("Connector installation not found.");
      }
      return { id: installationId, status: "DELETED" };
    } catch (error: unknown) {
      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_DELETE_FAILURE",
        resource: "CONNECTOR_INSTALLATION",
        resourceId: installationId,
        metadata: {
          connectorSlug: installation.slug,
          accountAlias: installation.accountAlias,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async reconnect(installationId: string, actor: ConnectorActor) {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationForAction(installationId, tenantKey);

    await this.auditService.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "CONNECTOR_RECONNECT_ATTEMPT",
      resource: "CONNECTOR_CREDENTIAL",
      resourceId: installationId,
      metadata: {
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
      },
    });

    try {
      await this.connectorPermissionService.assertActionAllowed(actor, {
        connectorSlug: installation.slug,
        action: "reconnect",
        accountAlias: installation.accountAlias,
      });

      // RLS-BYPASS: manual tenant filter
      const affected = await this.prisma.tenant(tenantKey).$executeRawUnsafe(
        `
        UPDATE connector_installations
        SET
          status = 'ACTIVE',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reconnectRequestedAt', NOW()),
          updated_at = NOW()
        WHERE id = $1 AND tenant_key = $2
        `,
        installationId,
        tenantKey,
      );
      if (affected === 0) {
        throw new NotFoundException("Connector installation not found.");
      }

      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_RECONNECT_SUCCESS",
        resource: "CONNECTOR_CREDENTIAL",
        resourceId: installationId,
        metadata: {
          status: "ACTIVE",
          connectorSlug: installation.slug,
          accountAlias: installation.accountAlias,
        },
      });
      return { id: installationId, status: "ACTIVE" };
    } catch (error: unknown) {
      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_RECONNECT_FAILURE",
        resource: "CONNECTOR_CREDENTIAL",
        resourceId: installationId,
        metadata: {
          connectorSlug: installation.slug,
          accountAlias: installation.accountAlias,
          reason: error instanceof Error ? error.message : String(error),
        },
      });
      throw error;
    }
  }

  async listPermissions(connectorSlug?: string) {
    return this.connectorPermissionService.listPermissions(connectorSlug);
  }

  async grantPermission(
    input: {
      principalType: "user" | "role";
      principalId: string;
      connectorSlug: string;
      accountAlias?: string;
      action: "install" | "reconnect" | "uninstall";
    },
    actor: ConnectorActor,
  ) {
    return this.connectorPermissionService.grantPermission({
      actor,
      ...input,
    });
  }

  async revokePermission(permissionId: string, actor: ConnectorActor) {
    return this.connectorPermissionService.revokePermission(permissionId, actor);
  }

  async previewPayload(installationId: string, dto: ConnectorPayloadPreviewDto) {
    return this.marketplaceService.previewPayloadForInstallation(
      installationId,
      dto.productId,
      dto.templateId,
      dto.channel,
    );
  }

  private async requireInstallationForAction(
    installationId: string,
    tenantKey: string,
  ): Promise<{ id: string; slug: string; accountAlias: string }> {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        ci.id,
        ci.account_alias AS "accountAlias",
        cd.slug
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.id = $1 AND ci.tenant_key = $2
      LIMIT 1
      `,
      installationId,
      tenantKey,
    );

    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Connector installation not found.");
    }

    return {
      id: String(row.id),
      slug: String(row.slug),
      accountAlias: String(row.accountAlias),
    };
  }
}

