import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import { AppRole } from "../common/rbac/roles";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { MarketplaceService } from "../marketplace/marketplace.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  ConnectorCap,
  ConnectorPublicationTarget,
  ConnectorImplementationStatus,
} from "../connector-framework/connector.interface";
import { resolveConnectorLaunchPolicy } from "../connector-framework/connector-launch-policy";
import { ConnectorRegistry } from "../connector-framework/connector.registry";
import {
  ConnectorActionRule,
  ConnectorDefinitionRecord,
  ConnectorInstallationRecord,
  PaginatedResponse,
} from "../connector-framework/connector.types";
import {
  ConnectorActor,
  ConnectorPermissionService,
} from "./connector-permission.service";
import { ConnectorCredentialEncryptionService } from "./credential-encryption.service";
import { ConnectorPayloadPreviewDto } from "./dto/connector-payload-preview.dto";
import { InstallConnectorDto } from "./dto/install-connector.dto";
import { ListInstalledConnectorsDto } from "./dto/list-installed-connectors.dto";
import { UpdatePublicationTargetsDto } from "./dto/update-publication-targets.dto";

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

function resolveStubConnectorSlugs(): string[] {
  return String(process.env.CONNECTOR_STUB_SLUGS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
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
    private readonly planUsageService: PlanUsageService,
    private readonly marketplaceService: MarketplaceService,
    private readonly connectorRegistry: ConnectorRegistry,
    private readonly credentialEncryptionService: ConnectorCredentialEncryptionService,
    private readonly connectorPermissionService: ConnectorPermissionService,
  ) {}

  private getTenantKey(): string {
    return getTenantKeyFromContext();
  }

  private resolveImplementationStatus(slug: string): ConnectorImplementationStatus {
    try {
      return this.connectorRegistry.getConnector(slug).implementationStatus ?? "stub";
    } catch {
      return "stub";
    }
  }

  private applyInstallLaunchStageRule(
    slug: string,
    capabilities: ConnectorCap[],
    action: ConnectorActionRule,
  ): ConnectorActionRule {
    const launchPolicy = resolveConnectorLaunchPolicy(slug, capabilities);
    if (launchPolicy.launchStage === "planned") {
      return {
        allowed: false,
        reason: "CONNECTOR_LAUNCH_STAGE_PLANNED",
      };
    }
    return action;
  }

  async listAvailableDefinitions(actor: ConnectorActor): Promise<ConnectorDefinitionRecord[]> {
    const stubSlugs = new Set(resolveStubConnectorSlugs());
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

    const definitions: ConnectorDefinitionRecord[] = [];
    // Resolve install actions sequentially to avoid request-local plan-check fanout
    // exhausting the DB pool under the current tenant-scoped Prisma client model.
    for (const row of rows) {
      const slug = String(row.slug);
      if (stubSlugs.has(slug.toLowerCase())) {
        continue;
      }
      const capabilities = parseCapabilities(row.capabilities);
      const launchPolicy = resolveConnectorLaunchPolicy(slug, capabilities);
      const actions = await this.connectorPermissionService.buildDefinitionActions(actor, slug);
      definitions.push({
        id: String(row.id),
        slug,
        displayName: String(row.displayName),
        authType: String(row.authType),
        capabilities: launchPolicy.surfacedCapabilities,
        implementationStatus: this.resolveImplementationStatus(slug),
        launchStage: launchPolicy.launchStage,
        launchNote: launchPolicy.launchNote,
        marketplaceId: row.marketplaceId ? String(row.marketplaceId) : null,
        connectorVersion: String(row.connectorVersion),
        isActive: Boolean(row.isActive),
        createdAt: String(row.createdAt),
        updatedAt: String(row.updatedAt),
        actions: {
          ...actions,
          install: this.applyInstallLaunchStageRule(slug, capabilities, actions.install),
        },
      });
    }

    return definitions;
  }

  async install(slug: string, dto: InstallConnectorDto, actor: ConnectorActor): Promise<ConnectorInstallationRecord> {
    const tenantKey = this.getTenantKey();
    const normalizedSlug = slug.trim().toLowerCase();
    const accountAlias = (dto.accountAlias ?? "primary").trim() || "primary";
    const requestedShopDomain =
      normalizedSlug === "shopify" ? this.normalizeShopifyShopDomain(dto.shopDomain) : null;
    const externalAccountRef =
      normalizedSlug === "shopify"
        ? requestedShopDomain ?? dto.externalAccountRef?.trim() ?? null
        : dto.externalAccountRef?.trim() || null;
    const installationId = randomUUID();

    await this.auditService.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "CONNECTOR_INSTALL_ATTEMPT",
      resource: "CONNECTOR_INSTALLATION",
        metadata: {
          connectorSlug: normalizedSlug,
          accountAlias,
          credentialsCaptured: this.hasConnectorCredentialInput(dto),
          shopDomain: requestedShopDomain,
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

      const definitionCapabilities = parseCapabilities(definition.capabilities);
      const launchPolicy = resolveConnectorLaunchPolicy(normalizedSlug, definitionCapabilities);
      if (launchPolicy.launchStage === "planned") {
        throw new BadRequestException({
          error: "CONNECTOR_LAUNCH_STAGE_PLANNED",
          message:
            launchPolicy.launchNote ??
            `${normalizedSlug} is not yet available for installation in this workspace.`,
        });
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
          ) VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb, $7)
          `,
          installationId,
          tenantKey,
          String(definition.id),
          accountAlias,
          externalAccountRef,
          normalizedSlug === "shopify" ? "PAUSED" : "ACTIVE",
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

      if (normalizedSlug === "flipkart") {
        try {
          await this.captureAndValidateFlipkartCredentials({
            tenantKey,
            connectorId: String(definition.id),
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "amazon-in") {
        try {
          await this.captureAndValidateAmazonCredentials({
            tenantKey,
            connectorId: String(definition.id),
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "shopify") {
        try {
          await this.captureShopifyInstallContext({
            tenantKey,
            installationId,
            shopDomain: requestedShopDomain,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
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

      await this.planUsageService.touchUsageForCurrentTenant();

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
    const stubSlugs = resolveStubConnectorSlugs();

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

    let hiddenStubWhere = "";
    if (stubSlugs.length > 0) {
      const placeholders = stubSlugs.map((slug) => {
        params.push(slug);
        return `$${params.length}`;
      });
      hiddenStubWhere = ` AND cd.slug NOT IN (${placeholders.join(", ")})`;
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
      ${hiddenStubWhere}
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
        const launchPolicy = resolveConnectorLaunchPolicy(slug, parseCapabilities(row.capabilities));
        return {
          id: String(row.id),
          tenantKey: String(row.tenantKey),
          connectorId: String(row.connectorId),
          slug,
          displayName: String(row.displayName),
          accountAlias,
          externalAccountRef: row.externalAccountRef ? String(row.externalAccountRef) : null,
          status: String(row.status) as ConnectorInstallationRecord["status"],
          capabilities: launchPolicy.surfacedCapabilities,
          implementationStatus: this.resolveImplementationStatus(slug),
          launchStage: launchPolicy.launchStage,
          launchNote: launchPolicy.launchNote,
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

      await this.planUsageService.touchUsageForCurrentTenant();

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

      await this.planUsageService.touchUsageForCurrentTenant();
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

  async handleOAuthCallback(
    installationId: string,
    params: Record<string, string>,
    actor: ConnectorActor,
  ): Promise<{ id: string; status: "CONNECTED" }> {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationRuntimeRecord(installationId, tenantKey);

    await this.connectorPermissionService.assertActionAllowed(actor, {
      connectorSlug: installation.slug,
      action: "reconnect",
      accountAlias: installation.accountAlias,
    });

    const connector = this.connectorRegistry.getConnector(installation.slug);
    if (!connector.handleOAuthCallback) {
      throw new BadRequestException({
        error: "CONNECTOR_OAUTH_CALLBACK_UNSUPPORTED",
        message: `${installation.slug} does not support OAuth callback handling.`,
      });
    }

    await connector.handleOAuthCallback(this.buildConnectorContext(installation), params);
    await this.prisma.tenant(tenantKey).connectorInstallation.updateMany({
      where: { id: installationId },
      data: {
        status: "ACTIVE",
        updatedAt: new Date(),
      },
    });
    return { id: installationId, status: "CONNECTED" };
  }

  async fetchProductTypeSchema(
    installationId: string,
    productType: string,
    actor: ConnectorActor,
  ) {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationRuntimeRecord(installationId, tenantKey);

    await this.connectorPermissionService.assertActionAllowed(actor, {
      connectorSlug: installation.slug,
      action: "reconnect",
      accountAlias: installation.accountAlias,
    });

    const connector = this.connectorRegistry.getConnector(installation.slug);
    if (!connector.fetchProductTypeSchema) {
      throw new BadRequestException({
        error: "CONNECTOR_PRODUCT_TYPE_SCHEMA_UNSUPPORTED",
        message: `${installation.slug} does not expose product type schemas.`,
      });
    }

    return connector.fetchProductTypeSchema(this.buildConnectorContext(installation), productType);
  }

  async listPublications(
    installationId: string,
    actor: ConnectorActor,
  ): Promise<ConnectorPublicationTarget[]> {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationRuntimeRecord(installationId, tenantKey);

    await this.connectorPermissionService.assertActionAllowed(actor, {
      connectorSlug: installation.slug,
      action: "reconnect",
      accountAlias: installation.accountAlias,
    });

    const connector = this.connectorRegistry.getConnector(installation.slug);
    if (!connector.listPublications) {
      throw new BadRequestException({
        error: "CONNECTOR_PUBLICATIONS_UNSUPPORTED",
        message: `${installation.slug} does not expose publication targets.`,
      });
    }

    return connector.listPublications(this.buildConnectorContext(installation));
  }

  async updatePublicationTargets(
    installationId: string,
    dto: UpdatePublicationTargetsDto,
    actor: ConnectorActor,
  ): Promise<{
    id: string;
    publicationTargets: ConnectorPublicationTarget[];
    updatedAt: string;
  }> {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationRuntimeRecord(installationId, tenantKey);

    await this.connectorPermissionService.assertActionAllowed(actor, {
      connectorSlug: installation.slug,
      action: "reconnect",
      accountAlias: installation.accountAlias,
    });

    const connector = this.connectorRegistry.getConnector(installation.slug);
    if (!connector.listPublications) {
      throw new BadRequestException({
        error: "CONNECTOR_PUBLICATIONS_UNSUPPORTED",
        message: `${installation.slug} does not expose publication targets.`,
      });
    }

    const requestedIds = Array.from(
      new Set(
        (Array.isArray(dto.publicationIds) ? dto.publicationIds : [])
          .map((value) => String(value ?? "").trim())
          .filter((value) => value.length > 0),
      ),
    );
    if (requestedIds.length === 0) {
      throw new BadRequestException({
        error: "PUBLICATION_TARGET_REQUIRED",
        message: "At least one publication target must be selected.",
      });
    }

    const availableTargets = await connector.listPublications(this.buildConnectorContext(installation));
    const availableById = new Map(
      availableTargets.map((target) => [String(target.id ?? "").trim(), target]),
    );
    const selectedTargets = requestedIds.map((id) => availableById.get(id)).filter(Boolean) as ConnectorPublicationTarget[];
    if (selectedTargets.length !== requestedIds.length) {
      throw new BadRequestException({
        error: "PUBLICATION_TARGET_INVALID",
        message: "One or more selected publication targets are not available for this installation.",
      });
    }

    const updatedAt = new Date();
    await this.prisma.tenant(tenantKey).connectorInstallation.updateMany({
      where: { id: installationId },
      data: {
        metadata: {
          ...installation.metadata,
          publicationTargetIds: requestedIds,
          publicationTargets: selectedTargets.map((target) => ({
            id: target.id,
            name: target.name,
            catalogId: target.catalogId ?? null,
            catalogTitle: target.catalogTitle ?? null,
            catalogType: target.catalogType ?? null,
          })),
          publicationTargetsUpdatedAt: updatedAt.toISOString(),
        },
        updatedAt,
      },
    });

    await this.auditService.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "CONNECTOR_PUBLICATION_TARGETS_UPDATED",
      resource: "CONNECTOR_INSTALLATION",
      resourceId: installationId,
      metadata: {
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
        publicationIds: requestedIds,
      },
    });

    return {
      id: installationId,
      publicationTargets: selectedTargets.map((target) => ({
        ...target,
        selected: true,
      })),
      updatedAt: updatedAt.toISOString(),
    };
  }

  private hasConnectorCredentialInput(dto: InstallConnectorDto): boolean {
    return Boolean(
      String(dto.shopDomain ?? "").trim() ||
      String(dto.clientId ?? "").trim() ||
        String(dto.clientSecret ?? "").trim() ||
        String(dto.refreshToken ?? "").trim(),
    );
  }

  private normalizeShopifyShopDomain(value: string | undefined): string | null {
    const trimmed = String(value ?? "").trim().toLowerCase();
    if (!trimmed) {
      return null;
    }
    const normalized = trimmed.includes(".") ? trimmed : `${trimmed}.myshopify.com`;
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
      throw new BadRequestException({
        error: "SHOPIFY_SHOP_DOMAIN_INVALID",
        message: "Shopify shop domain must be a valid *.myshopify.com hostname.",
      });
    }
    return normalized;
  }

  private async captureAndValidateFlipkartCredentials(input: {
    tenantKey: string;
    connectorId: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const clientId = String(input.dto.clientId ?? "").trim();
    const clientSecret = String(input.dto.clientSecret ?? "").trim();
    const refreshToken = String(input.dto.refreshToken ?? "").trim();

    if (!clientId && !clientSecret && !refreshToken) {
      return;
    }

    if (!clientId || !clientSecret || !refreshToken) {
      throw new BadRequestException({
        error: "FLIPKART_CREDENTIALS_INCOMPLETE",
        message: "Flipkart installation requires client ID, client secret, and refresh token together.",
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "client_id",
      plainValue: clientId,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "client_secret",
      plainValue: clientSecret,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "refresh_token",
      plainValue: refreshToken,
      metadata: { source: "install_form" },
    });

    const connector = this.connectorRegistry.getConnector("flipkart");
    const validated = await connector.validateCredentials({
      tenantId: input.tenantKey,
      installationId: input.installationId,
      connectorId: input.connectorId,
      sellerId: input.externalAccountRef ?? undefined,
      getAccessToken: async () => "",
    });

    if (!validated) {
      throw new BadRequestException({
        error: "FLIPKART_CREDENTIALS_INVALID",
        message: "Flipkart credentials could not be validated. Check the client ID, client secret, and refresh token.",
      });
    }
  }

  private async captureAndValidateAmazonCredentials(input: {
    tenantKey: string;
    connectorId: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const clientId = String(input.dto.clientId ?? "").trim();
    const clientSecret = String(input.dto.clientSecret ?? "").trim();
    const refreshToken = String(input.dto.refreshToken ?? "").trim();

    if (!clientId && !clientSecret && !refreshToken) {
      return;
    }

    if (!clientId || !clientSecret || !refreshToken) {
      throw new BadRequestException({
        error: "AMAZON_CREDENTIALS_INCOMPLETE",
        message: "Amazon installation requires client ID, client secret, and refresh token together.",
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "client_id",
      plainValue: clientId,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "client_secret",
      plainValue: clientSecret,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "refresh_token",
      plainValue: refreshToken,
      metadata: { source: "install_form" },
    });

    const connector = this.connectorRegistry.getConnector("amazon-in");
    const validated = await connector.validateCredentials({
      tenantId: input.tenantKey,
      installationId: input.installationId,
      connectorId: input.connectorId,
      sellerId: input.externalAccountRef ?? undefined,
      marketplaceId: "A21TJRUUN4KGV",
      getAccessToken: async () => "",
    });

    if (!validated) {
      throw new BadRequestException({
        error: "AMAZON_CREDENTIALS_INVALID",
        message: "Amazon credentials could not be validated. Check the client ID, client secret, and refresh token.",
      });
    }
  }

  private async captureShopifyInstallContext(input: {
    tenantKey: string;
    installationId: string;
    shopDomain: string | null;
  }): Promise<void> {
    if (!input.shopDomain) {
      throw new BadRequestException({
        error: "SHOPIFY_SHOP_DOMAIN_REQUIRED",
        message: "Shopify guided setup requires a store domain before the connector account can be created.",
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "shop_domain",
      plainValue: input.shopDomain,
      metadata: {
        source: "install_form",
        authMode: "guided_managed_install",
      },
    });

    await this.prisma.tenant(input.tenantKey).connectorInstallation.updateMany({
      where: { id: input.installationId },
      data: {
        metadata: {
          shopDomain: input.shopDomain,
          authMode: "guided_managed_install",
          connectionStage: "awaiting_managed_install",
          managedInstallPending: true,
        },
        updatedAt: new Date(),
      },
    });
  }

  private async cleanupInstallationArtifacts(tenantKey: string, installationId: string): Promise<void> {
    // RLS-BYPASS: manual tenant filter
    await this.prisma.tenant(tenantKey).$executeRawUnsafe(
      `
      DELETE FROM connector_credentials
      WHERE tenant_key = $1 AND installation_id = $2
      `,
      tenantKey,
      installationId,
    );

    // RLS-BYPASS: manual tenant filter
    await this.prisma.tenant(tenantKey).$executeRawUnsafe(
      `
      DELETE FROM connector_installations
      WHERE tenant_key = $1 AND id = $2
      `,
      tenantKey,
      installationId,
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

  private async requireInstallationRuntimeRecord(
    installationId: string,
    tenantKey: string,
  ): Promise<{
    id: string;
    tenantKey: string;
    connectorId: string;
    slug: string;
    accountAlias: string;
    externalAccountRef: string | null;
    metadata: Record<string, unknown>;
  }> {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        ci.id,
        ci.tenant_key AS "tenantKey",
        ci.connector_id AS "connectorId",
        ci.account_alias AS "accountAlias",
        ci.external_account_ref AS "externalAccountRef",
        ci.metadata,
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
      tenantKey: String(row.tenantKey),
      connectorId: String(row.connectorId),
      slug: String(row.slug),
      accountAlias: String(row.accountAlias),
      externalAccountRef: row.externalAccountRef ? String(row.externalAccountRef) : null,
      metadata: parseMetadata(row.metadata),
    };
  }

  private buildConnectorContext(installation: {
    id: string;
    tenantKey: string;
    connectorId: string;
    slug: string;
    externalAccountRef: string | null;
    metadata: Record<string, unknown>;
  }) {
    const metadataSellerId = String(installation.metadata.sellerId ?? "").trim();
    const metadataMarketplaceId = String(installation.metadata.marketplaceId ?? "").trim();
    return {
      tenantId: installation.tenantKey,
      installationId: installation.id,
      connectorId: installation.connectorId,
      sellerId: metadataSellerId || installation.externalAccountRef || undefined,
      marketplaceId:
        metadataMarketplaceId ||
        (installation.slug === "amazon-in" ? "A21TJRUUN4KGV" : undefined),
      getAccessToken: async () => "",
    };
  }
}

