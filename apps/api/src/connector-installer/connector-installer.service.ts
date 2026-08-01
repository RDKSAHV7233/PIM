import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import {
  signConnectorOAuthState,
  verifyConnectorOAuthState,
} from "./connector-oauth-state";
import { AuditService } from "../audit/audit.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import { AccessPolicyService } from "../common/access-policy/access-policy.service";
import { AppRole } from "../common/rbac/roles";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { MarketplaceService } from "../marketplace/marketplace.service";
import { PrismaService } from "../prisma/prisma.service";
import { tenantRaw, tenantExecRaw, globalQuery } from "../common/tenant/tenant-raw";
import {
  ConnectorCap,
  ConnectorPublicationTarget,
  ConnectorImplementationStatus,
} from "../connector-framework/connector.interface";
import { parseCapabilities } from "../connector-framework/parse-capabilities";
import { resolveConnectorLaunchPolicy, isCustomerVisibleStage, isInstallableStage } from "../connector-framework/connector-launch-policy";
import { ConnectorCredentialService } from "../connector-framework/connector-credential.service";
import { ConnectorHttpClient } from "../connector-framework/connector-http-client.service";
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
import { ShopifyApiHttpError } from "../connectors/shopify/shopify-api-client.service";
import { ConfigureConnectorDto } from "./dto/configure-connector.dto";
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
    private readonly accessPolicy: AccessPolicyService,
    private readonly credentialService: ConnectorCredentialService,
    private readonly httpClient: ConnectorHttpClient,
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
    if (!isInstallableStage(launchPolicy.launchStage)) {
      return {
        allowed: false,
        reason: "CONNECTOR_LAUNCH_STAGE_PLANNED",
      };
    }
    return action;
  }

  async listAvailableDefinitions(actor: ConnectorActor): Promise<ConnectorDefinitionRecord[]> {
    const stubSlugs = new Set(resolveStubConnectorSlugs());
    // globalQuery: connector_definitions is shared reference data — no tenant_key column.
    const rows = await globalQuery<Array<Record<string, unknown>>>(this.prisma.tenant(), `
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

    // Pre-filter stubs so they don't consume plan-check slots in the batch
    const activeRows = rows.filter((row) => !stubSlugs.has(String(row.slug).toLowerCase()));
    const slugs = activeRows.map((row) => String(row.slug));

    // Batch action resolution: 2 shared queries + N parallel account checks + 1 permission fetch
    // Replaces the prior N×2 sequential per-slug plan check loop.
    const actionsMap = await this.connectorPermissionService.buildDefinitionActionsForSlugs(actor, slugs);

    const boundaryRoles = actor.adminBoundaryRoles ?? [];
    const isInternalAdmin =
      actor.actorRole === "admin" &&
      (boundaryRoles.includes("system_admin") || boundaryRoles.includes("super_admin"));
    const showPlanned =
      isInternalAdmin ||
      (process.env.SHOW_PLANNED_CONNECTORS === "true" && actor.actorRole === "admin");

    return activeRows
      .map((row) => {
        const slug = String(row.slug);
        const capabilities = parseCapabilities(row.capabilities);
        const launchPolicy = resolveConnectorLaunchPolicy(slug, capabilities);
        const actions = actionsMap.get(slug) ?? {
          install: { allowed: false, reason: "CONNECTOR_PERMISSION_REQUIRED" },
          reconnect: { allowed: false, reason: "INSTALLATION_REQUIRED" },
          uninstall: { allowed: false, reason: "INSTALLATION_REQUIRED" },
        };
        return {
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
        };
      })
      .filter((def) => showPlanned || isCustomerVisibleStage(def.launchStage));
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

      // globalQuery: connector_definitions is shared reference data — no tenant_key column.
      const definitionRows = await globalQuery<Array<Record<string, unknown>>>(this.prisma.tenant(tenantKey), `
        SELECT
          id,
          slug,
          display_name AS "displayName",
          capabilities
        FROM connector_definitions
        WHERE slug = $1 AND is_active = TRUE
        LIMIT 1
        `,
        [normalizedSlug]);
      const definition = definitionRows[0];
      if (!definition) {
        throw new NotFoundException(`Connector '${normalizedSlug}' is not available.`);
      }

      const definitionCapabilities = parseCapabilities(definition.capabilities);
      const launchPolicy = resolveConnectorLaunchPolicy(normalizedSlug, definitionCapabilities);
      if (!isInstallableStage(launchPolicy.launchStage)) {
        throw new BadRequestException({
          error: "CONNECTOR_LAUNCH_STAGE_PLANNED",
          message:
            launchPolicy.launchNote ??
            `${normalizedSlug} is not yet available for installation in this workspace.`,
        });
      }

      try {
        await tenantExecRaw(this.prisma.tenant(tenantKey), `
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
          [installationId,
          tenantKey,
          String(definition.id),
          accountAlias,
          externalAccountRef,
          "ACTIVE",
          actor.actorId]);
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
          const accessToken = String(dto.accessToken ?? "").trim();
          if (accessToken) {
            const runtimeRecord = await this.requireInstallationRuntimeRecord(installationId, tenantKey);
            const connector = this.connectorRegistry.getConnector("shopify");
            if (connector.handleOAuthCallback) {
              await connector.handleOAuthCallback(this.buildConnectorContext(runtimeRecord), {
                accessToken,
                shopDomain: requestedShopDomain ?? "",
              });
            }
          }
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw this.translateShopifyInstallError(error);
        }
      } else if (normalizedSlug === "meesho") {
        try {
          await this.captureAndStoreMeeshoCredentials({
            tenantKey,
            installationId,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "myntra") {
        try {
          await this.captureAndStoreMyntraCredentials({
            tenantKey,
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "woocommerce") {
        try {
          await this.captureAndStoreWooCommerceCredentials({
            tenantKey,
            installationId,
            externalAccountRef,
            dto,
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
    // DTO slug filter takes precedence over the internal slugFilter argument.
    const resolvedSlugFilter = query.slug?.trim() || slugFilter;

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
    if (resolvedSlugFilter) {
      params.push(resolvedSlugFilter);
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
    const rows = await tenantRaw<Array<Record<string, unknown>>>(this.prisma.tenant(tenantKey), `
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
        ci.updated_at AS "updatedAt",
        EXISTS (
          SELECT 1 FROM connector_credentials cc
          WHERE cc.installation_id = ci.id
            AND cc.tenant_key = ci.tenant_key
            AND cc.last_validated_at IS NOT NULL
            AND cc.failure_reason IS NULL
        ) AS "credentialsValidated"
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.tenant_key = $1
      ${slugWhere}
      ${hiddenStubWhere}
      ${cursorWhere}
      ORDER BY ci.installed_at DESC, ci.id DESC
      LIMIT $${params.length}
      `,
      params);

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
          // Only flipkart/amazon-in have the "blank credentials, skip validation"
          // gap this field exists to catch — see connector.types.ts. Every other
          // connector reports true so this field is a no-op for them.
          credentialsValidated:
            slug === "flipkart" || slug === "amazon-in" ? Boolean(row.credentialsValidated) : true,
          actions: actor
            ? await this.connectorPermissionService.buildInstallationActions(actor, slug, accountAlias)
            : undefined,
        };
      }),
    );
    const filteredItems = actor
      ? await this.accessPolicy.filterConnectorInstallations(
          {
            actorId: actor.actorId,
            actorRole: actor.actorRole,
            tenantId: tenantKey,
          },
          items,
          "manage_connector",
        )
      : items;

    const last = filteredItems[filteredItems.length - 1];
    return {
      items: filteredItems,
      limit,
      nextCursor:
        hasNext && last
          ? encodeCursor({ installedAt: last.installedAt, id: last.id })
          : null,
    };
  }

  async getInstalledById(
    installationId: string,
    actor: ConnectorActor,
  ): Promise<ConnectorInstallationRecord> {
    const tenantKey = this.getTenantKey();
    const stubSlugs = resolveStubConnectorSlugs();

    const params: unknown[] = [tenantKey, installationId];
    let hiddenStubWhere = "";
    if (stubSlugs.length > 0) {
      const placeholders = stubSlugs.map((slug) => {
        params.push(slug);
        return `$${params.length}`;
      });
      hiddenStubWhere = ` AND cd.slug NOT IN (${placeholders.join(", ")})`;
    }

    // RLS-BYPASS: manual tenant filter
    const rows = await tenantRaw<Array<Record<string, unknown>>>(this.prisma.tenant(tenantKey), `
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
        ci.updated_at AS "updatedAt",
        EXISTS (
          SELECT 1 FROM connector_credentials cc
          WHERE cc.installation_id = ci.id
            AND cc.tenant_key = ci.tenant_key
            AND cc.last_validated_at IS NOT NULL
            AND cc.failure_reason IS NULL
        ) AS "credentialsValidated"
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.tenant_key = $1
        AND ci.id = $2
        ${hiddenStubWhere}
      LIMIT 1
      `,
      params,
    );

    const row = rows[0];
    if (!row) {
      throw new NotFoundException("Connector installation not found.");
    }

    const slug = String(row.slug);
    const accountAlias = String(row.accountAlias);
    const launchPolicy = resolveConnectorLaunchPolicy(slug, parseCapabilities(row.capabilities));
    const item: ConnectorInstallationRecord = {
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
      credentialsValidated:
        slug === "flipkart" || slug === "amazon-in" ? Boolean(row.credentialsValidated) : true,
      actions: await this.connectorPermissionService.buildInstallationActions(actor, slug, accountAlias),
    };

    const [filtered] = await this.accessPolicy.filterConnectorInstallations(
      { actorId: actor.actorId, actorRole: actor.actorRole, tenantId: tenantKey },
      [item],
      "manage_connector",
    );
    if (!filtered) {
      throw new NotFoundException("Connector installation not found.");
    }
    return filtered;
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

      const affected = await tenantExecRaw(this.prisma.tenant(tenantKey), `
        UPDATE connector_installations
        SET status = 'DISABLED', updated_at = NOW()
        WHERE id = $1 AND tenant_key = $2
        `,
        [installationId, tenantKey]);
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

      const affected = await tenantExecRaw(this.prisma.tenant(tenantKey), `
        DELETE FROM connector_installations
        WHERE id = $1 AND tenant_key = $2
        `,
        [installationId, tenantKey]);
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

      const affected = await tenantExecRaw(this.prisma.tenant(tenantKey), `
        UPDATE connector_installations
        SET
          status = 'ACTIVE',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reconnectRequestedAt', NOW()),
          updated_at = NOW()
        WHERE id = $1 AND tenant_key = $2
        `,
        [installationId, tenantKey]);
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

  async previewPayload(installationId: string, dto: ConnectorPayloadPreviewDto, actor: ConnectorActor) {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationRuntimeRecord(installationId, tenantKey);
    await this.accessPolicy.assertConnectorInstallationAccess(
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        tenantId: tenantKey,
      },
      "preview_connector_payload",
      {
        installationId: installation.id,
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
      },
    );
    await this.connectorPermissionService.assertActionAllowed(actor, {
      connectorSlug: installation.slug,
      action: "reconnect",
      accountAlias: installation.accountAlias,
    });
    const product = await this.prisma.tenant(tenantKey).product.findUnique({
      where: { id: dto.productId },
      select: { id: true, categoryId: true, brand: true },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    await this.accessPolicy.assertProductAccess(
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        tenantId: tenantKey,
      },
      "view",
      product,
    );
    await this.accessPolicy.assertSensitivePayloadAccessAllowed(
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        tenantId: tenantKey,
      },
      {
        action: "connector.preview",
        resource: "ConnectorInstallation",
        resourceId: installationId,
      },
    );
    return this.marketplaceService.previewPayloadForInstallation(
      installationId,
      dto.productId,
      dto.templateId,
      dto.channel,
    );
  }

  async initiateOAuth(
    installationId: string,
    actor: ConnectorActor,
  ): Promise<{ authorizationUrl: string; state: string }> {
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
        error: "CONNECTOR_OAUTH_NOT_SUPPORTED",
        message: `${installation.slug} does not support OAuth authorization.`,
      });
    }

    const jwtSecret = String(process.env.JWT_SECRET ?? process.env.PIM_JWT_SECRET ?? "").trim();
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error("JWT_SECRET is required and must be at least 32 characters for OAuth state signing.");
    }

    const { stateToken, nonce, expiresAt } = signConnectorOAuthState(
      {
        tenantKey,
        installationId: installation.id,
        connectorKey: installation.slug,
      },
      jwtSecret,
    );

    const nonceHash = createHash("sha256").update(nonce).digest("hex");
    await this.patchInstallationMetadata(tenantKey, installation.id, {
      oauthNonceHash: nonceHash,
      oauthNonceIssuedAt: Date.now(),
      oauthNonceExpiresAt: expiresAt,
    });

    const authorizationUrl = this.buildConnectorAuthorizationUrl(installation, stateToken);

    return { authorizationUrl, state: stateToken };
  }

  private buildConnectorAuthorizationUrl(
    installation: {
      slug: string;
      metadata: Record<string, unknown>;
    },
    stateToken: string,
  ): string {
    if (installation.slug === "shopify") {
      const rawDomain = String(installation.metadata.shopDomain ?? "").trim();
      if (!rawDomain) {
        throw new BadRequestException({
          error: "SHOPIFY_SHOP_DOMAIN_REQUIRED",
          message: "Shop domain must be set before initiating OAuth. Re-install the connector with a valid store domain.",
        });
      }
      const shopDomain = this.normalizeShopifyDomain(rawDomain);
      const clientId = String(process.env.PIM_SHOPIFY_CLIENT_ID ?? "").trim();
      if (!clientId) {
        throw new Error("PIM_SHOPIFY_CLIENT_ID is not configured.");
      }
      const scopes = String(process.env.PIM_SHOPIFY_SCOPES ?? "write_products,read_products").trim();
      const redirectUri = String(
        process.env.PIM_SHOPIFY_REDIRECT_URI ??
        `${String(process.env.CORS_ORIGIN ?? "http://localhost:4000").replace(/\/+$/, "").replace(/:3000$/, ":4000")}/api/v1/connectors/shopify/oauth/callback`,
      ).trim();

      const params = new URLSearchParams({
        client_id: clientId,
        scope: scopes,
        redirect_uri: redirectUri,
        state: stateToken,
      });
      return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
    }

    throw new BadRequestException({
      error: "CONNECTOR_OAUTH_NOT_SUPPORTED",
      message: `OAuth initiation is not implemented for ${installation.slug}.`,
    });
  }

  private normalizeShopifyDomain(raw: string): string {
    let domain = raw
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/\?.*$/, "")
      .replace(/#.*$/, "")
      .toLowerCase()
      .trim();
    if (!domain.endsWith(".myshopify.com")) {
      domain = `${domain}.myshopify.com`;
    }
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
      throw new BadRequestException({
        error: "SHOPIFY_SHOP_DOMAIN_INVALID",
        message: "Shop domain must be a valid {store}.myshopify.com hostname.",
      });
    }
    return domain;
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

  /**
   * Handle OAuth callback from a public (unauthenticated) redirect.
   * Extracts tenantKey from the verified state token instead of AsyncLocalStorage.
   */
  async handlePublicOAuthCallback(
    stateToken: string,
    params: Record<string, string>,
    expectedConnectorKey?: string,
  ): Promise<{ installationId: string; status: "CONNECTED" }> {
    const jwtSecret = String(process.env.JWT_SECRET ?? process.env.PIM_JWT_SECRET ?? "").trim();
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new BadRequestException({ error: "OAUTH_STATE_VERIFICATION_FAILED", code: "SERVER_CONFIG_ERROR" });
    }

    const result = verifyConnectorOAuthState(stateToken, jwtSecret);
    if (!result.valid) {
      throw new BadRequestException({ error: "OAUTH_STATE_VERIFICATION_FAILED", code: result.error });
    }

    const { payload } = result;

    if (expectedConnectorKey && payload.connectorKey !== expectedConnectorKey) {
      throw new BadRequestException({ error: "OAUTH_STATE_VERIFICATION_FAILED", code: "CONNECTOR_MISMATCH" });
    }

    const installation = await this.requireInstallationRuntimeRecord(payload.installationId, payload.tenantKey);

    if (installation.slug !== payload.connectorKey) {
      throw new BadRequestException({ error: "OAUTH_STATE_VERIFICATION_FAILED", code: "CONNECTOR_MISMATCH" });
    }

    const metadata = installation.metadata;
    const storedNonceHash = String(metadata.oauthNonceHash ?? "").trim();
    const nonceExpiresAt = Number(metadata.oauthNonceExpiresAt ?? 0);

    if (!storedNonceHash) {
      throw new BadRequestException({ error: "OAUTH_STATE_VERIFICATION_FAILED", code: "NONCE_NOT_FOUND" });
    }
    if (Date.now() > nonceExpiresAt) {
      throw new BadRequestException({ error: "OAUTH_STATE_VERIFICATION_FAILED", code: "NONCE_EXPIRED" });
    }

    const expectedNonceHash = createHash("sha256").update(payload.nonce).digest("hex");
    if (storedNonceHash !== expectedNonceHash) {
      throw new BadRequestException({ error: "OAUTH_STATE_VERIFICATION_FAILED", code: "NONCE_MISMATCH" });
    }

    await this.patchInstallationMetadata(payload.tenantKey, payload.installationId, {
      oauthNonceHash: null,
      oauthNonceIssuedAt: null,
      oauthNonceExpiresAt: null,
    });

    const connector = this.connectorRegistry.getConnector(installation.slug);
    if (!connector.handleOAuthCallback) {
      throw new BadRequestException({ error: "OAUTH_STATE_VERIFICATION_FAILED", code: "CONNECTOR_UNSUPPORTED" });
    }

    await connector.handleOAuthCallback(this.buildConnectorContext(installation), params);
    await this.prisma.tenant(payload.tenantKey).connectorInstallation.updateMany({
      where: { id: payload.installationId },
      data: {
        status: "ACTIVE",
        updatedAt: new Date(),
      },
    });

    return { installationId: payload.installationId, status: "CONNECTED" };
  }

  async fetchProductTypeSchema(
    installationId: string,
    productType: string,
    actor: ConnectorActor,
  ) {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationRuntimeRecord(installationId, tenantKey);
    await this.accessPolicy.assertConnectorInstallationAccess(
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        tenantId: tenantKey,
      },
      "manage_connector",
      {
        installationId: installation.id,
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
      },
    );

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
    await this.accessPolicy.assertConnectorInstallationAccess(
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        tenantId: tenantKey,
      },
      "manage_connector",
      {
        installationId: installation.id,
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
        supportedScopeTypes: ["connector_account", "channel", "catalog"],
      },
    );

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

    const targets = await connector.listPublications(this.buildConnectorContext(installation));
    return this.accessPolicy.filterPublicationTargets(
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        tenantId: tenantKey,
      },
      "manage_connector",
      targets,
      {
        resource: "ConnectorPublicationTarget",
        resourceId: installationId,
      },
    );
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
    await this.accessPolicy.assertConnectorInstallationAccess(
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        tenantId: tenantKey,
      },
      "manage_connector",
      {
        installationId: installation.id,
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
        supportedScopeTypes: ["connector_account", "channel", "catalog"],
      },
    );

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
    await this.accessPolicy.assertPublicationTargetsAccess(
      {
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        tenantId: tenantKey,
      },
      "manage_connector",
      selectedTargets.map((target) => ({
        id: String(target.id ?? "").trim() || null,
        catalogId: target.catalogId ?? null,
      })),
      {
        resource: "ConnectorPublicationTarget",
        resourceId: installationId,
      },
    );

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
    const validated = await connector.validateCredentials(
      this.buildConnectorContext({
        id: input.installationId,
        tenantKey: input.tenantKey,
        connectorId: input.connectorId,
        slug: "flipkart",
        externalAccountRef: input.externalAccountRef ?? null,
        metadata: {},
      }),
    );

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

    // Prefer the caller-supplied marketplace ID; fall back to India default.
    const marketplaceId = String(input.dto.marketplaceId ?? "").trim() || "A21TJRUUN4KGV";
    const defaultProductType = String(input.dto.defaultProductType ?? "").trim().toUpperCase() || null;

    const connector = this.connectorRegistry.getConnector("amazon-in");
    const validated = await connector.validateCredentials(
      this.buildConnectorContext({
        id: input.installationId,
        tenantKey: input.tenantKey,
        connectorId: input.connectorId,
        slug: "amazon-in",
        externalAccountRef: input.externalAccountRef ?? null,
        metadata: { sellerId: input.externalAccountRef, marketplaceId },
      }),
    );

    if (!validated) {
      throw new BadRequestException({
        error: "AMAZON_CREDENTIALS_INVALID",
        message: "Amazon credentials could not be validated. Check the client ID, client secret, and refresh token.",
      });
    }

    // Persist marketplace config into installation metadata so it is available
    // at runtime without needing a separate lookup.
    const metadataPatch: Record<string, unknown> = { marketplaceId };
    if (defaultProductType) {
      metadataPatch.defaultProductType = defaultProductType;
    }
    await this.patchInstallationMetadata(input.tenantKey, input.installationId, metadataPatch);
  }

  /**
   * Store Meesho Merchant ID and Secret Key without live credential validation.
   *
   * Validation requires a Meesho API ping endpoint that is not yet available
   * (pending RD-MEESHO-1 — credential package from meesholink-integration@meesho.com).
   * Credentials are stored encrypted so they are available when Phase M-2 upgrades
   * validateCredentials() with a real ping.
   *
   * Credential fields in the install form:
   *   clientId     → Meesho Merchant ID (stored as "merchant_id")
   *   clientSecret → Meesho Secret Key  (stored as "secret_key")
   *
   * Both are optional for Phase M-1 (Excel export requires no API credentials).
   * If neither is supplied the method returns silently.
   * If only one is supplied an error is thrown — partial credentials are never stored.
   */
  private async captureAndStoreMeeshoCredentials(input: {
    tenantKey: string;
    installationId: string;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const merchantId = String(input.dto.clientId ?? "").trim();
    const secretKey  = String(input.dto.clientSecret ?? "").trim();

    // Both absent — credentials deferred to Phase M-2. Export still works.
    if (!merchantId && !secretKey) {
      return;
    }

    // Partial credentials are a data-entry mistake; require all-or-nothing.
    if (!merchantId || !secretKey) {
      throw new BadRequestException({
        error: "MEESHO_CREDENTIALS_INCOMPLETE",
        message:
          "Meesho installation requires both Merchant ID and Secret Key. " +
          "Leave both fields empty to skip credential setup — Excel export works without credentials.",
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "merchant_id",
      plainValue: merchantId,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "secret_key",
      plainValue: secretKey,
      metadata: { source: "install_form" },
    });
    // Live validation deferred to Phase M-2 (RD-MEESHO-1).
  }

  /**
   * Capture and store Myntra Merchant ID, Secret Key, and Warehouse ID.
   *
   * Live credential validation is deferred — Myntra auth scheme and endpoint
   * contract are [NEEDS_PARTNER_CONFIRMATION] until the account-manager kickoff
   * provides the Postman collection and sandbox credentials.
   * All three fields are required because Myntra is a live publish connector.
   *
   * Field mapping from InstallConnectorDto:
   *   externalAccountRef → merchant_id (also stored as installation.externalAccountRef)
   *   clientSecret       → secret_key
   *   refreshToken       → warehouse_id
   */
  private async captureAndStoreMyntraCredentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const merchantId  = String(input.externalAccountRef ?? "").trim();
    const secretKey   = String(input.dto.clientSecret ?? "").trim();
    const warehouseId = String(input.dto.refreshToken ?? "").trim();

    if (!merchantId || !secretKey || !warehouseId) {
      const missing = [
        !merchantId  && "Merchant ID",
        !secretKey   && "Secret Key",
        !warehouseId && "Warehouse ID",
      ].filter(Boolean).join(", ");
      throw new BadRequestException({
        error: "MYNTRA_CREDENTIALS_INCOMPLETE",
        message: `Myntra installation requires Merchant ID, Secret Key, and Warehouse ID. Missing: ${missing}.`,
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "merchant_id",
      plainValue: merchantId,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "secret_key",
      plainValue: secretKey,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "warehouse_id",
      plainValue: warehouseId,
      metadata: { source: "install_form" },
    });
    // Live validation deferred — enable after AM kickoff confirms Myntra
    // Listing Management API endpoint URL, auth scheme, and sandbox creds.
  }

  /**
   * Store WooCommerce manual-key credentials (W1 install path).
   *
   * Field mapping from InstallConnectorDto:
   *   externalAccountRef → site_url   (store URL, also the installation account ref)
   *   clientId           → consumer_key
   *   clientSecret       → consumer_secret
   *   refreshToken       → webhook_secret  (used for HMAC webhook verification)
   *
   * App-auth install path (handleOAuthCallback) stores consumer_key and consumer_secret
   * when the WC /wc-auth/v1/authorize callback returns. site_url + webhook_secret are
   * captured here at install-start for both paths.
   */
  private async captureAndStoreWooCommerceCredentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const siteUrl       = String(input.externalAccountRef ?? "").trim();
    const consumerKey   = String(input.dto.clientId      ?? "").trim();
    const consumerSecret = String(input.dto.clientSecret ?? "").trim();
    const webhookSecret  = String(input.dto.refreshToken ?? "").trim();

    if (!siteUrl || !consumerKey || !consumerSecret) {
      const missing = [
        !siteUrl        && "Site URL",
        !consumerKey    && "Consumer Key",
        !consumerSecret && "Consumer Secret",
      ].filter(Boolean).join(", ");
      throw new BadRequestException({
        error: "WOOCOMMERCE_CREDENTIALS_INCOMPLETE",
        message: `WooCommerce installation requires Site URL, Consumer Key, and Consumer Secret. Missing: ${missing}.`,
      });
    }

    if (!siteUrl.startsWith("https://")) {
      throw new BadRequestException({
        error: "WOOCOMMERCE_SITE_URL_NOT_HTTPS",
        message: "WooCommerce Site URL must use HTTPS.",
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "site_url",
      plainValue: siteUrl,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "consumer_key",
      plainValue: consumerKey,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "consumer_secret",
      plainValue: consumerSecret,
      metadata: { source: "install_form" },
    });
    if (webhookSecret) {
      await this.credentialEncryptionService.storeCredential({
        tenantKey: input.tenantKey,
        installationId: input.installationId,
        credentialType: "webhook_secret",
        plainValue: webhookSecret,
        metadata: { source: "install_form" },
      });
    }
    // Live preflight (HTTPS + /wp-json/wc/v3 reachability) deferred to
    // validateCredentials heartbeat — Docker WooCommerce CI fixture required.
  }

  /**
   * Merge a partial metadata object into the installation row.
   * Uses PostgreSQL's || operator so existing keys not present in the patch
   * are preserved.
   */
  private async patchInstallationMetadata(
    tenantKey: string,
    installationId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await tenantExecRaw(this.prisma.tenant(tenantKey), `
      UPDATE connector_installations
      SET metadata = metadata || $1::jsonb
      WHERE id = $2 AND tenant_key = $3
      `,
      [JSON.stringify(patch), installationId, tenantKey]);
  }

  /**
   * Update connector-level configuration (marketplaceId, defaultProductType, etc.)
   * post-install without touching credentials.
   */
  async configure(
    installationId: string,
    dto: ConfigureConnectorDto,
    actor: ConnectorActor,
  ): Promise<{ updated: boolean }> {
    const tenantKey = this.getTenantKey();
    const patch: Record<string, unknown> = {};

    if (dto.marketplaceId !== undefined && dto.marketplaceId.trim()) {
      patch.marketplaceId = dto.marketplaceId.trim();
    }
    if (dto.defaultProductType !== undefined) {
      // Allow clearing the default product type by passing an empty string.
      patch.defaultProductType = dto.defaultProductType.trim().toUpperCase() || null;
    }

    if (Object.keys(patch).length === 0) {
      return { updated: false };
    }

    await this.patchInstallationMetadata(tenantKey, installationId, patch);

    await this.auditService.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "CONNECTOR_CONFIGURE",
      resource: "CONNECTOR_INSTALLATION",
      resourceId: installationId,
      metadata: { patch },
    });

    return { updated: true };
  }

  private async captureShopifyInstallContext(input: {
    tenantKey: string;
    installationId: string;
    shopDomain: string | null;
  }): Promise<void> {
    if (!input.shopDomain) {
      throw new BadRequestException({
        error: "SHOPIFY_SHOP_DOMAIN_REQUIRED",
        message: "Shopify install requires a store domain before the connector account can be created.",
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

  /**
   * VEXA-201: Shopify install used to let a raw ShopifyApiHttpError (or worse,
   * a bare Error from the HTTP client) reach the global exception filter as an
   * opaque 500. 404/401/403 are user-fixable (bad domain, bad token) and should
   * be a 400 with a specific message; anything else is a genuine Shopify-side
   * problem and should read as an outage, not a request error.
   */
  private translateShopifyInstallError(error: unknown): Error {
    if (!(error instanceof ShopifyApiHttpError)) {
      return error instanceof Error ? error : new Error(String(error));
    }
    if (error.status === 404) {
      return new BadRequestException({
        error: "SHOPIFY_STORE_NOT_FOUND",
        message: `We couldn't find a Shopify store at ${error.shopDomain}. Check the store domain and try again.`,
      });
    }
    if (error.status === 401 || error.status === 403) {
      return new BadRequestException({
        error: "SHOPIFY_TOKEN_REJECTED",
        message: "Shopify rejected that access token. Check it and try again.",
      });
    }
    return new ServiceUnavailableException({
      error: "SHOPIFY_UPSTREAM_UNAVAILABLE",
      message: "Shopify's API is temporarily unavailable. Please try again shortly.",
    });
  }

  private async cleanupInstallationArtifacts(tenantKey: string, installationId: string): Promise<void> {
    await tenantExecRaw(this.prisma.tenant(tenantKey), `
      DELETE FROM connector_credentials
      WHERE tenant_key = $1 AND installation_id = $2
      `,
      [tenantKey, installationId]);

    await tenantExecRaw(this.prisma.tenant(tenantKey), `
      DELETE FROM connector_installations
      WHERE tenant_key = $1 AND id = $2
      `,
      [tenantKey, installationId]);
  }

  private async requireInstallationForAction(
    installationId: string,
    tenantKey: string,
  ): Promise<{ id: string; slug: string; accountAlias: string }> {
    const rows = await tenantRaw<Array<Record<string, unknown>>>(this.prisma.tenant(tenantKey), `
      SELECT
        ci.id,
        ci.account_alias AS "accountAlias",
        cd.slug
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.id = $1 AND ci.tenant_key = $2
      LIMIT 1
      `,
      [installationId, tenantKey]);

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
    const rows = await tenantRaw<Array<Record<string, unknown>>>(this.prisma.tenant(tenantKey), `
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
      [installationId, tenantKey]);

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
    const ctx = {
      tenantId: installation.tenantKey,
      installationId: installation.id,
      connectorId: installation.connectorId,
      sellerId: metadataSellerId || installation.externalAccountRef || undefined,
      marketplaceId:
        metadataMarketplaceId ||
        (installation.slug === "amazon-in" ? "A21TJRUUN4KGV" : undefined),
      getAccessToken: async (): Promise<string> => {
        const connector = this.connectorRegistry.getConnector(installation.slug);
        return this.credentialService.getOrRefreshAccessToken(
          installation.tenantKey,
          installation.id,
          installation.slug,
          async () => {
            if (!connector.refreshAccessToken) {
              throw new Error(
                `Connector '${installation.slug}' does not implement refreshAccessToken.`,
              );
            }
            return connector.refreshAccessToken(ctx);
          },
        );
      },
      fetch: (url: string, init?: import("../connector-framework/connector.interface").ConnectorFetchInit) =>
        this.httpClient.fetch(installation.slug, installation.id, url, init),
    };
    return ctx;
  }
}

