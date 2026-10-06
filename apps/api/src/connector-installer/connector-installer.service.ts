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
import { LoggerService } from "../common/logging/logger.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { MarketplaceService } from "../marketplace/marketplace.service";
import { PrismaService } from "../prisma/prisma.service";
import { tenantRaw, tenantExecRaw, globalQuery } from "../common/tenant/tenant-raw";
import {
  ConnectorCap,
  ConnectorContext,
  ConnectorInterface,
  ConnectorPublicationTarget,
  ConnectorImplementationStatus,
  CredentialVerificationResult,
} from "../connector-framework/connector.interface";
import { parseCapabilities } from "../connector-framework/parse-capabilities";
import { resolveConnectorLaunchPolicy, resolveConnectorPipelineMetadata, isCustomerVisibleStage, isInstallableStage } from "../connector-framework/connector-launch-policy";
import { ConnectorCredentialService } from "../connector-framework/connector-credential.service";
import { toValidationState, unvalidatedAfterCredentialChange, verifiedValidationStamp } from "../connector-framework/credential-validation";
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
import { UpdateConnectorCredentialsDto } from "./dto/update-connector-credentials.dto";
import { UpdatePublicationTargetsDto } from "./dto/update-publication-targets.dto";

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const RECONNECT_VALIDATION_DEFERRED_SLUGS = new Set(["meesho"]);

type CursorPayload = {
  installedAt: string;
  id: string;
};

type ConnectorRemovalCleanupSummary = {
  credentialsDeleted: number;
  installationDeleted: number;
};

function readCount(rows: Array<Record<string, unknown>>): number {
  const raw = rows[0]?.count ?? 0;
  const value = typeof raw === "bigint" ? Number(raw) : Number(raw);
  return Number.isFinite(value) ? value : 0;
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
    private readonly accessPolicy: AccessPolicyService,
    private readonly credentialService: ConnectorCredentialService,
    private readonly httpClient: ConnectorHttpClient,
    private readonly logger: LoggerService,
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
          // Internal-only detail (owner/milestone/blockers/notes) — never sent
          // to a caller without a system_admin/super_admin boundary role, so
          // an ordinary tenant hitting this same endpoint can't see it.
          ...(isInternalAdmin ? { pipelineMetadata: resolveConnectorPipelineMetadata(slug) } : {}),
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
      .filter((def) => showPlanned || isCustomerVisibleStage(def.launchStage) || isInstallableStage(def.launchStage));
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
      } else if (normalizedSlug === "odoo") {
        try {
          await this.captureAndStoreOdooCredentials({
            tenantKey,
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "etsy") {
        try {
          await this.captureAndStoreEtsyCredentials({
            tenantKey,
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "dynamics-365") {
        try {
          await this.captureAndStoreDynamics365Credentials({
            tenantKey,
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "prestashop") {
        try {
          await this.captureAndStorePrestaShopCredentials({
            tenantKey,
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "ebay") {
        try {
          await this.captureAndStoreEbayCredentials({
            tenantKey,
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "bigcommerce") {
        try {
          await this.captureAndStoreBigCommerceCredentials({
            tenantKey,
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "shopware") {
        try {
          await this.captureAndStoreShopwareCredentials({
            tenantKey,
            installationId,
            externalAccountRef,
            dto,
          });
        } catch (error) {
          await this.cleanupInstallationArtifacts(tenantKey, installationId);
          throw error;
        }
      } else if (normalizedSlug === "zoho-inventory") {
        try {
          await this.captureAndStoreZohoInventoryCredentials({
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
        ci.last_validated_at AS "lastValidatedAt",
        ci.last_validation_attempt_at AS "lastValidationAttemptAt",
        ci.last_validation_outcome AS "lastValidationOutcome",
        ci.last_validation_reason AS "lastValidationReason",
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
          validation: toValidationState(row),
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
        ci.last_validated_at AS "lastValidatedAt",
        ci.last_validation_attempt_at AS "lastValidationAttemptAt",
        ci.last_validation_outcome AS "lastValidationOutcome",
        ci.last_validation_reason AS "lastValidationReason",
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
      validation: toValidationState(row),
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

      await this.deleteInstallationTransaction({
        tenantKey,
        installationId,
        expectedSlug: installationSlug,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
      });

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

  /**
   * Permanently deletes a connector installation inside a single DB transaction:
   * blocks while active work exists, removes credentials, deletes the
   * installation row, and audits the outcome — all atomically, so a failure at
   * any step leaves the pre-call state untouched (no half-deleted installation).
   *
   * Historical connector_submissions / connector_webhook_events rows are
   * deliberately NOT deleted here — see the 20260817000001 migration, which
   * drops their ON DELETE CASCADE so resolved history survives installation
   * deletion instead of disappearing with it.
   */
  private async deleteInstallationTransaction(input: {
    tenantKey: string;
    installationId: string;
    expectedSlug: string;
    actorId: string;
    actorRole: string;
    connectorSlug: string;
    accountAlias: string;
  }): Promise<ConnectorRemovalCleanupSummary> {
    const tenantClient = this.prisma.tenant(input.tenantKey);
    return tenantClient.$transaction(async (tx) => {
      const lockedRows = await tenantRaw<Array<Record<string, unknown>>>(
        tx,
        `
          SELECT ci.id, cd.slug
          FROM connector_installations ci
          JOIN connector_definitions cd ON cd.id = ci.connector_id
          WHERE ci.tenant_key = $1 AND ci.id = $2
          FOR UPDATE
        `,
        [input.tenantKey, input.installationId],
      );
      if (lockedRows.length === 0) {
        throw new NotFoundException("Connector installation not found.");
      }
      const lockedSlug = String(lockedRows[0]?.slug ?? "").trim().toLowerCase();
      if (lockedSlug !== input.expectedSlug) {
        throw new BadRequestException({
          error: "CONNECTOR_SLUG_MISMATCH",
          expectedSlug: input.expectedSlug,
          actualSlug: lockedSlug,
        });
      }

      const activeExportRows = await tenantRaw<Array<Record<string, unknown>>>(
        tx,
        `
          SELECT COUNT(*)::int AS count
          FROM "MarketplaceExportJob"
          WHERE "tenantKey" = $1 /* tenant_key: MarketplaceExportJob uses unmapped camelCase tenantKey */
            AND installation_id = $2
            AND status IN ('queued', 'processing', 'retrying')
        `,
        [input.tenantKey, input.installationId],
      );
      const activeExportJobs = readCount(activeExportRows);
      if (activeExportJobs > 0) {
        throw new ConflictException({
          error: "CONNECTOR_DELETE_BLOCKED_ACTIVE_EXPORT_JOBS",
          message: "Connector deletion is blocked while export jobs are queued, processing, or retrying.",
          activeExportJobs,
        });
      }

      // connector_submissions has no queued/processing/retrying status of its own —
      // PENDING is the only non-terminal state a submission can be in (terminal:
      // SUCCESS, REJECTED, SUPPRESSED, ERROR — see ConnectorFrameworkService).
      const activeSubmissionRows = await tenantRaw<Array<Record<string, unknown>>>(
        tx,
        `
          SELECT COUNT(*)::int AS count
          FROM connector_submissions
          WHERE tenant_key = $1
            AND installation_id = $2
            AND UPPER(status) = 'PENDING'
        `,
        [input.tenantKey, input.installationId],
      );
      const activeSubmissions = readCount(activeSubmissionRows);
      if (activeSubmissions > 0) {
        throw new ConflictException({
          error: "CONNECTOR_DELETE_BLOCKED_ACTIVE_SUBMISSIONS",
          message: "Connector deletion is blocked while connector submissions are still pending.",
          activeSubmissions,
        });
      }

      const credentialsDeleted = await tenantExecRaw(
        tx,
        `
          DELETE FROM connector_credentials
          WHERE tenant_key = $1 AND installation_id = $2
        `,
        [input.tenantKey, input.installationId],
      );
      const installationDeleted = await tenantExecRaw(
        tx,
        `
          DELETE FROM connector_installations
          WHERE tenant_key = $1 AND id = $2
        `,
        [input.tenantKey, input.installationId],
      );
      if (installationDeleted === 0) {
        throw new NotFoundException("Connector installation not found.");
      }

      const cleanup: ConnectorRemovalCleanupSummary = { credentialsDeleted, installationDeleted };
      await tx.auditLog.create({
        data: {
          id: randomUUID(),
          actorId: input.actorId,
          actorRole: input.actorRole,
          action: "CONNECTOR_DELETE_SUCCESS",
          resource: "CONNECTOR_INSTALLATION",
          resourceId: input.installationId,
          metadata: {
            connectorSlug: input.connectorSlug,
            accountAlias: input.accountAlias,
            cleanup,
          },
        },
      });

      return cleanup;
    });
  }

  async reconnect(installationId: string, actor: ConnectorActor) {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationRuntimeRecord(installationId, tenantKey);

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

      // #564: live-checkable connectors must prove stored credentials before
      // Reconnect marks them ACTIVE. Meesho M-1 is export-only and has no partner
      // ping endpoint yet, so validation is explicitly deferred until RD-MEESHO-1.
      if (!RECONNECT_VALIDATION_DEFERRED_SLUGS.has(installation.slug)) {
        const connector = this.connectorRegistry.getConnector(installation.slug);
        await this.validateStoredCredentialsOrThrow(
          connector,
          this.buildConnectorContext(installation),
          "CONNECTOR_CREDENTIALS_STILL_INVALID",
          `${installation.slug} credentials could not be validated. Update the stored credentials via setup, then try reconnecting again.`,
        );
      }

      // Reconnect clears the recorded validation facts rather than stamping VALID: the check above
      // is a gate, not a recorded provider verdict (and deferred-validation connectors skip it), and
      // a stale INVALID / CONFIGURATION_ERROR must not outlive a reconnect. A NULL attempt time puts
      // this installation first in the next heartbeat batch, which records the truthful outcome.
      const affected = await tenantExecRaw(this.prisma.tenant(tenantKey), `
        UPDATE connector_installations
        SET
          status = 'ACTIVE',
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reconnectRequestedAt', NOW()),
          updated_at = NOW(),
          last_validated_at = NULL,
          last_validation_attempt_at = NULL,
          last_validation_outcome = NULL,
          last_validation_reason = NULL
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

  /**
   * Replace an existing installation's credential set. Unlike install(), this
   * targets an already-live installation and verifies the CANDIDATE credentials
   * live before persisting anything — a rejected or unreachable check leaves the
   * stored credentials and installation status completely untouched (see the
   * per-connector helpers below for the exact zero-mutation guarantee).
   *
   * Roles are enforced at the controller (`admin`, `connector_admin` — `editor`
   * deliberately excluded, replacing persistent external-account secrets is a
   * higher-privilege action than replacing a session). Step-up is enforced at
   * the controller too, via StepUpGuard + STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK.
   */
  async updateCredentials(
    installationId: string,
    dto: UpdateConnectorCredentialsDto,
    actor: ConnectorActor,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    const tenantKey = this.getTenantKey();
    const installation = await this.requireInstallationRuntimeRecord(installationId, tenantKey);

    await this.auditService.record({
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "CONNECTOR_CREDENTIALS_UPDATE_ATTEMPT",
      resource: "CONNECTOR_CREDENTIAL",
      resourceId: installationId,
      metadata: {
        connectorSlug: installation.slug,
        accountAlias: installation.accountAlias,
        changedCredentialTypes: this.describeChangedCredentialTypes(installation.slug, dto),
        externalAccountRefChanged: dto.externalAccountRef !== undefined && dto.externalAccountRef.trim().length > 0,
      },
    });

    try {
      await this.connectorPermissionService.assertActionAllowed(actor, {
        connectorSlug: installation.slug,
        action: "reconnect",
        accountAlias: installation.accountAlias,
      });

      const result = await this.dispatchUpdateCredentials(tenantKey, installation, dto);

      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_CREDENTIALS_UPDATE_SUCCESS",
        resource: "CONNECTOR_CREDENTIAL",
        resourceId: installationId,
        metadata: {
          connectorSlug: installation.slug,
          accountAlias: installation.accountAlias,
          verificationOutcome: result.verification.outcome,
          previousStatus: installation.status,
          newStatus: result.status,
        },
      });

      return result;
    } catch (error: unknown) {
      await this.auditService.record({
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "CONNECTOR_CREDENTIALS_UPDATE_FAILURE",
        resource: "CONNECTOR_CREDENTIAL",
        resourceId: installationId,
        metadata: {
          connectorSlug: installation.slug,
          accountAlias: installation.accountAlias,
          failureCode: this.extractFailureCode(error),
        },
      });
      throw error;
    }
  }

  /** Storage-type names only — never the DTO property names, never values. */
  private describeChangedCredentialTypes(slug: string, dto: UpdateConnectorCredentialsDto): string[] {
    const types: string[] = [];
    const has = (v: string | undefined) => v !== undefined && v.trim().length > 0;
    if (slug === "woocommerce") {
      if (has(dto.externalAccountRef)) types.push("site_url");
      if (has(dto.clientId)) types.push("consumer_key");
      if (has(dto.clientSecret)) types.push("consumer_secret");
      if (has(dto.refreshToken)) types.push("webhook_secret");
    } else if (slug === "myntra") {
      if (has(dto.externalAccountRef)) types.push("merchant_id");
      if (has(dto.clientSecret)) types.push("secret_key");
      if (has(dto.refreshToken)) types.push("warehouse_id");
    } else if (slug === "meesho") {
      if (has(dto.clientId)) types.push("merchant_id");
      if (has(dto.clientSecret)) types.push("secret_key");
    } else if (slug === "flipkart" || slug === "amazon-in") {
      if (has(dto.clientId)) types.push("client_id");
      if (has(dto.clientSecret)) types.push("client_secret");
      if (has(dto.refreshToken)) types.push("refresh_token");
    } else if (slug === "odoo") {
      if (has(dto.externalAccountRef)) types.push("odoo_url");
      if (has(dto.clientId)) types.push("username");
      if (has(dto.clientSecret)) types.push("password");
      if (has(dto.refreshToken)) types.push("database");
    } else if (slug === "etsy") {
      if (has(dto.externalAccountRef)) types.push("shop_id");
      if (has(dto.clientId)) types.push("client_id");
      if (has(dto.clientSecret)) types.push("shared_secret");
      if (has(dto.refreshToken)) types.push("refresh_token");
    } else if (slug === "dynamics-365") {
      if (has(dto.externalAccountRef)) types.push("aad_tenant");
      if (has(dto.clientId)) types.push("client_id");
      if (has(dto.clientSecret)) types.push("client_secret");
      if (has(dto.refreshToken)) types.push("environment_company");
    } else if (slug === "prestashop") {
      if (has(dto.externalAccountRef)) types.push("store_url");
      if (has(dto.clientId)) types.push("api_key");
      if (has(dto.refreshToken)) types.push("lang_id");
    } else if (slug === "ebay") {
      if (has(dto.clientId)) types.push("client_id");
      if (has(dto.clientSecret)) types.push("client_secret");
      if (has(dto.refreshToken)) types.push("refresh_token");
    } else if (slug === "bigcommerce") {
      if (has(dto.externalAccountRef)) types.push("store_hash");
      if (has(dto.clientId)) types.push("api_key");
    } else if (slug === "shopware") {
      if (has(dto.externalAccountRef)) types.push("store_url");
      if (has(dto.clientId)) types.push("client_id");
      if (has(dto.clientSecret)) types.push("client_secret");
    } else if (slug === "zoho-inventory") {
      if (has(dto.externalAccountRef)) types.push("organization_id");
      if (has(dto.clientId)) types.push("client_id");
      if (has(dto.clientSecret)) types.push("client_secret");
      if (has(dto.refreshToken)) types.push("refresh_token");
    }
    return types;
  }

  private extractFailureCode(error: unknown): string {
    if (error instanceof BadRequestException || error instanceof ServiceUnavailableException || error instanceof NotFoundException) {
      const response = error.getResponse();
      if (typeof response === "object" && response !== null && "error" in response) {
        return String((response as Record<string, unknown>).error);
      }
    }
    return error instanceof Error ? error.name : "UNKNOWN_ERROR";
  }

  private assertNoDisallowedFields(
    dto: UpdateConnectorCredentialsDto,
    allowed: Array<keyof UpdateConnectorCredentialsDto>,
    slug: string,
  ): void {
    const allowedSet = new Set<string>(allowed);
    const allFields: Array<keyof UpdateConnectorCredentialsDto> = [
      "externalAccountRef", "clientId", "clientSecret", "refreshToken",
    ];
    for (const field of allFields) {
      if (allowedSet.has(field)) continue;
      const value = dto[field];
      if (value !== undefined && value.trim().length > 0) {
        throw new BadRequestException({
          error: "CONNECTOR_CREDENTIALS_FIELD_NOT_ALLOWED",
          message: `${slug} credentials do not accept '${field}'.`,
        });
      }
    }
  }

  private async dispatchUpdateCredentials(
    tenantKey: string,
    installation: { id: string; slug: string; status: string; metadata: Record<string, unknown> },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    switch (installation.slug) {
      case "woocommerce":
        return this.updateWooCommerceCredentials(tenantKey, installation, dto);
      case "myntra":
        return this.updateMyntraCredentials(tenantKey, installation, dto);
      case "meesho":
        return this.updateMeeshoCredentials(tenantKey, installation, dto);
      case "flipkart":
      case "amazon-in":
      case "ebay":
        return this.updateOAuthTokenExchangeCredentials(tenantKey, installation, dto);
      case "odoo":
        return this.updateOdooCredentials(tenantKey, installation, dto);
      case "etsy":
        return this.updateEtsyCredentials(tenantKey, installation, dto);
      case "dynamics-365":
        return this.updateDynamics365Credentials(tenantKey, installation, dto);
      case "prestashop":
        return this.updatePrestaShopCredentials(tenantKey, installation, dto);
      case "bigcommerce":
        return this.updateBigCommerceCredentials(tenantKey, installation, dto);
      case "shopware":
        return this.updateShopwareCredentials(tenantKey, installation, dto);
      case "zoho-inventory":
        return this.updateZohoInventoryCredentials(tenantKey, installation, dto);
      default:
        throw new BadRequestException({
          error: "CONNECTOR_CREDENTIALS_EDIT_UNSUPPORTED",
          message: `Editing stored credentials is not supported for ${installation.slug}.`,
        });
    }
  }

  private async updateWooCommerceCredentials(
    tenantKey: string,
    installation: { id: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["externalAccountRef", "clientId", "clientSecret", "refreshToken"], "woocommerce");

    const suppliedExternalAccountRef = dto.externalAccountRef?.trim();
    const consumerKey = dto.clientId?.trim();
    const consumerSecret = dto.clientSecret;
    const webhookSecret = dto.refreshToken;

    const missing = [
      !suppliedExternalAccountRef && "Site URL",
      !consumerKey && "Consumer Key",
      !(consumerSecret && consumerSecret.trim()) && "Consumer Secret",
    ].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "WOOCOMMERCE_CREDENTIALS_INCOMPLETE",
        message: `WooCommerce credentials require Site URL, Consumer Key, and Consumer Secret. Missing: ${missing}.`,
      });
    }
    if (!suppliedExternalAccountRef!.startsWith("https://")) {
      throw new BadRequestException({
        error: "WOOCOMMERCE_SITE_URL_NOT_HTTPS",
        message: "WooCommerce Site URL must use HTTPS.",
      });
    }

    const connector = this.connectorRegistry.getConnector("woocommerce");
    const verification = await connector.verifyCandidateCredentials!({
      site_url: suppliedExternalAccountRef!,
      consumer_key: consumerKey!,
      consumer_secret: consumerSecret!,
    });

    this.throwOnUnverified("WOOCOMMERCE", verification);

    const now = new Date();
    await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "site_url", plainValue: suppliedExternalAccountRef!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "consumer_key", plainValue: consumerKey!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "consumer_secret", plainValue: consumerSecret!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      if (webhookSecret) {
        // webhook_secret isn't exercised by the candidate check — no health stamp.
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "webhook_secret", plainValue: webhookSecret, metadata: { source: "credentials_update" } },
          tx,
        );
      }
      await tx.connectorInstallation.updateMany({
        where: { id: installation.id, tenantKey },
        data: { status: "ACTIVE", externalAccountRef: suppliedExternalAccountRef, updatedAt: new Date(), ...verifiedValidationStamp() },
      });
    });

    return { id: installation.id, status: "ACTIVE", verification };
  }

  private async updateOdooCredentials(
    tenantKey: string,
    installation: { id: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["externalAccountRef", "clientId", "clientSecret", "refreshToken"], "odoo");

    const suppliedOdooUrl = dto.externalAccountRef?.trim();
    const username = dto.clientId?.trim();
    const password = dto.clientSecret;
    const database = dto.refreshToken?.trim();

    const missing = [
      !suppliedOdooUrl && "Odoo URL",
      !database && "Database",
      !username && "Username",
      !(password && password.trim()) && "Password or API Key",
    ].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "ODOO_CREDENTIALS_INCOMPLETE",
        message: `Odoo credentials require Odoo URL, Database, Username, and Password/API Key. Missing: ${missing}.`,
      });
    }
    if (!suppliedOdooUrl!.startsWith("https://")) {
      throw new BadRequestException({
        error: "ODOO_URL_NOT_HTTPS",
        message: "Odoo URL must use HTTPS.",
      });
    }

    const connector = this.connectorRegistry.getConnector("odoo");
    const verification = await connector.verifyCandidateCredentials!({
      odoo_url: suppliedOdooUrl!,
      database: database!,
      username: username!,
      password: password!,
    });

    this.throwOnUnverified("ODOO", verification);

    const now = new Date();
    await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "odoo_url", plainValue: suppliedOdooUrl!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "database", plainValue: database!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "username", plainValue: username!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "password", plainValue: password!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await tx.connectorInstallation.updateMany({
        where: { id: installation.id, tenantKey },
        data: { status: "ACTIVE", externalAccountRef: suppliedOdooUrl, updatedAt: new Date(), ...verifiedValidationStamp() },
      });
    });

    return { id: installation.id, status: "ACTIVE", verification };
  }

  // lang_id (repurposing the refreshToken slot) is optional and defaults to
  // "1" — unlike Odoo's four required fields, PrestaShop only strictly needs
  // store_url + api_key.
  private async updatePrestaShopCredentials(
    tenantKey: string,
    installation: { id: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["externalAccountRef", "clientId", "refreshToken"], "prestashop");

    const suppliedStoreUrl = dto.externalAccountRef?.trim();
    const apiKey = dto.clientId?.trim();
    const langId = dto.refreshToken?.trim() || "1";

    const missing = [!suppliedStoreUrl && "Store URL", !apiKey && "Webservice API Key"].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "PRESTASHOP_CREDENTIALS_INCOMPLETE",
        message: `PrestaShop credentials require Store URL and Webservice API Key. Missing: ${missing}.`,
      });
    }
    if (!suppliedStoreUrl!.startsWith("https://")) {
      throw new BadRequestException({
        error: "PRESTASHOP_URL_NOT_HTTPS",
        message: "PrestaShop store URL must use HTTPS.",
      });
    }

    const connector = this.connectorRegistry.getConnector("prestashop");
    const verification = await connector.verifyCandidateCredentials!({
      store_url: suppliedStoreUrl!,
      api_key: apiKey!,
    });

    this.throwOnUnverified("PRESTASHOP", verification);

    const now = new Date();
    await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "store_url", plainValue: suppliedStoreUrl!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "api_key", plainValue: apiKey!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "lang_id", plainValue: langId, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await tx.connectorInstallation.updateMany({
        where: { id: installation.id, tenantKey },
        data: { status: "ACTIVE", externalAccountRef: suppliedStoreUrl, updatedAt: new Date(), ...verifiedValidationStamp() },
      });
    });

    return { id: installation.id, status: "ACTIVE", verification };
  }

  // BigCommerce only needs two fields — no HTTPS enforcement here since the
  // store_hash isn't a URL (it's a bare identifier used to build the fixed
  // api.bigcommerce.com host, which is always HTTPS).
  private async updateBigCommerceCredentials(
    tenantKey: string,
    installation: { id: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["externalAccountRef", "clientId"], "bigcommerce");

    const suppliedStoreHash = dto.externalAccountRef?.trim();
    const apiKey = dto.clientId?.trim();

    const missing = [!suppliedStoreHash && "Store Hash", !apiKey && "API Access Token"].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "BIGCOMMERCE_CREDENTIALS_INCOMPLETE",
        message: `BigCommerce credentials require Store Hash and API Access Token. Missing: ${missing}.`,
      });
    }

    const connector = this.connectorRegistry.getConnector("bigcommerce");
    const verification = await connector.verifyCandidateCredentials!({
      store_hash: suppliedStoreHash!,
      api_key: apiKey!,
    });

    this.throwOnUnverified("BIGCOMMERCE", verification);

    const now = new Date();
    await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "store_hash", plainValue: suppliedStoreHash!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "api_key", plainValue: apiKey!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await tx.connectorInstallation.updateMany({
        where: { id: installation.id, tenantKey },
        data: { status: "ACTIVE", externalAccountRef: suppliedStoreHash, updatedAt: new Date(), ...verifiedValidationStamp() },
      });
    });

    return { id: installation.id, status: "ACTIVE", verification };
  }

  // Shopware uses client_credentials — same "no refresh_token to rotate" shape
  // as Dynamics 365 above, but the token exchange still yields a fresh
  // access_token worth persisting immediately (commitExtra) so the first live
  // call after a credentials update doesn't need a redundant token exchange.
  private async updateShopwareCredentials(
    tenantKey: string,
    installation: { id: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["externalAccountRef", "clientId", "clientSecret"], "shopware");

    const storeUrl = dto.externalAccountRef?.trim();
    const clientId = dto.clientId?.trim();
    const clientSecret = dto.clientSecret;

    const missing = [
      !storeUrl && "Store URL",
      !clientId && "Integration Access ID",
      !(clientSecret && clientSecret.trim()) && "Integration Secret Key",
    ].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "SHOPWARE_CREDENTIALS_INCOMPLETE",
        message: `Shopware credentials require Store URL, Integration Access ID, and Integration Secret Key. Missing: ${missing}.`,
      });
    }

    if (!storeUrl!.startsWith("https://")) {
      throw new BadRequestException({
        error: "SHOPWARE_URL_NOT_HTTPS",
        message: "Shopware store URL must use HTTPS.",
      });
    }

    const connector = this.connectorRegistry.getConnector("shopware");
    const verification = await connector.verifyCandidateCredentials!({
      store_url: storeUrl!,
      client_id: clientId!,
      client_secret: clientSecret!,
    });

    this.throwOnUnverified("SHOPWARE", verification);

    // Narrowed by throwOnUnverified: only "valid" reaches here.
    const commitExtra = verification.outcome === "valid" ? verification.commitExtra : undefined;

    const now = new Date();
    await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "store_url", plainValue: storeUrl!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "client_id", plainValue: clientId!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "client_secret", plainValue: clientSecret!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      if (commitExtra?.accessToken) {
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "access_token", plainValue: commitExtra.accessToken.value, expiresAt: commitExtra.accessToken.expiresAt, metadata: { source: "credentials_update" } },
          tx,
        );
      }
      await tx.connectorInstallation.updateMany({
        where: { id: installation.id, tenantKey },
        data: { status: "ACTIVE", externalAccountRef: storeUrl, updatedAt: new Date(), ...verifiedValidationStamp() },
      });
    });

    return { id: installation.id, status: "ACTIVE", verification };
  }

  // Zoho does NOT rotate the refresh_token on use (unlike Etsy) — the value
  // the operator submits stays valid, so there's no commitExtra-sourced
  // refresh_token to persist, only a fresh access_token. The data-center
  // region isn't editable here (same precedent as eBay's marketplaceId): it's
  // fixed at install time in installation.metadata.marketplaceId and reused
  // as-is so the candidate is verified against the same host the connector
  // will actually call afterward.
  private async updateZohoInventoryCredentials(
    tenantKey: string,
    installation: { id: string; metadata?: Record<string, unknown> },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["externalAccountRef", "clientId", "clientSecret", "refreshToken"], "zoho-inventory");

    const organizationId = dto.externalAccountRef?.trim();
    const clientId = dto.clientId?.trim();
    const clientSecret = dto.clientSecret;
    const refreshToken = dto.refreshToken;

    const missing = [
      !organizationId && "Organization ID",
      !clientId && "Client ID",
      !(clientSecret && clientSecret.trim()) && "Client Secret",
      !(refreshToken && refreshToken.trim()) && "Refresh Token",
    ].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "ZOHO_INVENTORY_CREDENTIALS_INCOMPLETE",
        message: `Zoho Inventory credentials require Organization ID, Client ID, Client Secret, and Refresh Token. Missing: ${missing}.`,
      });
    }

    const dataCenter = String(installation.metadata?.marketplaceId ?? "").trim();
    const connector = this.connectorRegistry.getConnector("zoho-inventory");
    const verification = await connector.verifyCandidateCredentials!({
      organization_id: organizationId!,
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken!,
      data_center: dataCenter,
    });

    this.throwOnUnverified("ZOHO_INVENTORY", verification);

    // Narrowed by throwOnUnverified: only "valid" reaches here.
    const commitExtra = verification.outcome === "valid" ? verification.commitExtra : undefined;

    const now = new Date();
    await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "organization_id", plainValue: organizationId!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "client_id", plainValue: clientId!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "client_secret", plainValue: clientSecret!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "refresh_token", plainValue: refreshToken!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      if (commitExtra?.accessToken) {
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "access_token", plainValue: commitExtra.accessToken.value, expiresAt: commitExtra.accessToken.expiresAt, metadata: { source: "credentials_update" } },
          tx,
        );
      }
      await tx.connectorInstallation.updateMany({
        where: { id: installation.id, tenantKey },
        data: { status: "ACTIVE", externalAccountRef: organizationId, updatedAt: new Date(), ...verifiedValidationStamp() },
      });
    });

    return { id: installation.id, status: "ACTIVE", verification };
  }

  // Etsy rotates refresh_token on every exchange (verified live 2026-09-20) —
  // same commitExtra-sourced persistence as updateOAuthTokenExchangeCredentials,
  // since the value the provider now considers valid may differ from what the
  // operator submitted.
  private async updateEtsyCredentials(
    tenantKey: string,
    installation: { id: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["externalAccountRef", "clientId", "clientSecret", "refreshToken"], "etsy");

    const shopId = dto.externalAccountRef?.trim();
    const clientId = dto.clientId?.trim();
    const sharedSecret = dto.clientSecret;
    const refreshToken = dto.refreshToken;

    const missing = [
      !shopId && "Shop ID",
      !clientId && "Client ID (Keystring)",
      !(sharedSecret && sharedSecret.trim()) && "Shared Secret",
      !(refreshToken && refreshToken.trim()) && "Refresh Token",
    ].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "ETSY_CREDENTIALS_INCOMPLETE",
        message: `Etsy credentials require Shop ID, Client ID, Shared Secret, and Refresh Token. Missing: ${missing}.`,
      });
    }

    const connector = this.connectorRegistry.getConnector("etsy");
    const verification = await connector.verifyCandidateCredentials!({
      client_id: clientId!,
      shared_secret: sharedSecret!,
      refresh_token: refreshToken!,
    });

    this.throwOnUnverified("ETSY", verification);

    // Narrowed by throwOnUnverified: only "valid" reaches here.
    const commitExtra = verification.outcome === "valid" ? verification.commitExtra : undefined;
    const rotatedRefreshToken = commitExtra?.refreshToken;
    const refreshTokenToStore = rotatedRefreshToken?.value ?? refreshToken!;
    const refreshTokenExpiry = rotatedRefreshToken?.expiresAt ?? null;

    const now = new Date();
    try {
      await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "shop_id", plainValue: shopId!, metadata: { source: "credentials_update" } },
          tx, { lastValidatedAt: now, failureReason: null },
        );
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "client_id", plainValue: clientId!, metadata: { source: "credentials_update" } },
          tx, { lastValidatedAt: now, failureReason: null },
        );
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "shared_secret", plainValue: sharedSecret!, metadata: { source: "credentials_update" } },
          tx, { lastValidatedAt: now, failureReason: null },
        );
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "refresh_token", plainValue: refreshTokenToStore, expiresAt: refreshTokenExpiry, metadata: { source: "credentials_update" } },
          tx, { lastValidatedAt: now, failureReason: null },
        );
        if (commitExtra?.accessToken) {
          await this.credentialEncryptionService.storeCredential(
            { tenantKey, installationId: installation.id, credentialType: "access_token", plainValue: commitExtra.accessToken.value, expiresAt: commitExtra.accessToken.expiresAt, metadata: { source: "credentials_update" } },
            tx,
          );
        }
        await tx.connectorInstallation.updateMany({
          where: { id: installation.id, tenantKey },
          data: { status: "ACTIVE", externalAccountRef: shopId, updatedAt: new Date(), ...verifiedValidationStamp() },
        });
      });
    } catch (txError) {
      if (rotatedRefreshToken) {
        // The provider already rotated the refresh token server-side before this
        // transaction failed — that's not "nothing changed," it needs to be
        // operationally visible so it can be manually reconciled.
        this.logger.error("connector_credentials_rotation_commit_failed", {
          installationId: installation.id,
          connectorSlug: "etsy",
        });
      }
      throw txError;
    }

    return { id: installation.id, status: "ACTIVE", verification };
  }

  // Dynamics 365 uses client_credentials — there's no refresh_token to rotate,
  // client_credentials always mints a fresh access_token, so this is simpler
  // than updateEtsyCredentials' rotation handling.
  private async updateDynamics365Credentials(
    tenantKey: string,
    installation: { id: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["externalAccountRef", "clientId", "clientSecret", "refreshToken"], "dynamics-365");

    const aadTenant = dto.externalAccountRef?.trim();
    const clientId = dto.clientId?.trim();
    const clientSecret = dto.clientSecret;
    const environmentCompany = dto.refreshToken?.trim();

    const missing = [
      !aadTenant && "Azure AD Tenant",
      !clientId && "Client ID",
      !(clientSecret && clientSecret.trim()) && "Client Secret",
      !environmentCompany && "Environment/Company (e.g. \"Production|CRONUS IN\")",
    ].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "DYNAMICS_365_CREDENTIALS_INCOMPLETE",
        message: `Dynamics 365 credentials require Azure AD Tenant, Client ID, Client Secret, and Environment/Company. Missing: ${missing}.`,
      });
    }

    const connector = this.connectorRegistry.getConnector("dynamics-365");
    const verification = await connector.verifyCandidateCredentials!({
      aad_tenant: aadTenant!,
      client_id: clientId!,
      client_secret: clientSecret!,
      environment_company: environmentCompany!,
    });

    this.throwOnUnverified("DYNAMICS_365", verification);

    // Narrowed by throwOnUnverified: only "valid" reaches here.
    const commitExtra = verification.outcome === "valid" ? verification.commitExtra : undefined;

    const now = new Date();
    await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "aad_tenant", plainValue: aadTenant!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "client_id", plainValue: clientId!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "client_secret", plainValue: clientSecret!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "environment_company", plainValue: environmentCompany!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      if (commitExtra?.accessToken) {
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "access_token", plainValue: commitExtra.accessToken.value, expiresAt: commitExtra.accessToken.expiresAt, metadata: { source: "credentials_update" } },
          tx,
        );
      }
      await tx.connectorInstallation.updateMany({
        where: { id: installation.id, tenantKey },
        data: { status: "ACTIVE", externalAccountRef: aadTenant, updatedAt: new Date(), ...verifiedValidationStamp() },
      });
    });

    return { id: installation.id, status: "ACTIVE", verification };
  }

  private async updateMyntraCredentials(
    tenantKey: string,
    installation: { id: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["externalAccountRef", "clientSecret", "refreshToken"], "myntra");

    const suppliedExternalAccountRef = dto.externalAccountRef?.trim();
    const secretKey = dto.clientSecret;
    const warehouseId = dto.refreshToken?.trim();

    const missing = [
      !suppliedExternalAccountRef && "Merchant ID",
      !(secretKey && secretKey.trim()) && "Secret Key",
      !warehouseId && "Warehouse ID",
    ].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "MYNTRA_CREDENTIALS_INCOMPLETE",
        message: `Myntra credentials require Merchant ID, Secret Key, and Warehouse ID. Missing: ${missing}.`,
      });
    }

    const connector = this.connectorRegistry.getConnector("myntra");
    const verification = await connector.verifyCandidateCredentials!({
      merchant_id: suppliedExternalAccountRef!,
      secret_key: secretKey!,
    });

    this.throwOnUnverified("MYNTRA", verification);

    const now = new Date();
    await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "merchant_id", plainValue: suppliedExternalAccountRef!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "secret_key", plainValue: secretKey!, metadata: { source: "credentials_update" } },
        tx, { lastValidatedAt: now, failureReason: null },
      );
      // warehouse_id isn't exercised by the candidate check — no health stamp.
      await this.credentialEncryptionService.storeCredential(
        { tenantKey, installationId: installation.id, credentialType: "warehouse_id", plainValue: warehouseId!, metadata: { source: "credentials_update" } },
        tx,
      );
      await tx.connectorInstallation.updateMany({
        where: { id: installation.id, tenantKey },
        data: { status: "ACTIVE", externalAccountRef: suppliedExternalAccountRef, updatedAt: new Date(), ...verifiedValidationStamp() },
      });
    });

    return { id: installation.id, status: "ACTIVE", verification };
  }

  private async updateMeeshoCredentials(
    tenantKey: string,
    installation: { id: string; status: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    this.assertNoDisallowedFields(dto, ["clientId", "clientSecret"], "meesho");

    const merchantId = dto.clientId?.trim();
    const secretKey = dto.clientSecret;

    const missing = [
      !merchantId && "Merchant ID",
      !(secretKey && secretKey.trim()) && "Secret Key",
    ].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: "MEESHO_CREDENTIALS_INCOMPLETE",
        message: `Meesho credentials require both Merchant ID and Secret Key. Missing: ${missing}.`,
      });
    }

    // No live check exists for Meesho (RD-MEESHO-1) — store unconditionally,
    // never claim health, never touch installation status.
    await this.credentialEncryptionService.storeCredential({
      tenantKey, installationId: installation.id, credentialType: "merchant_id",
      plainValue: merchantId!, metadata: { source: "credentials_update" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey, installationId: installation.id, credentialType: "secret_key",
      plainValue: secretKey!, metadata: { source: "credentials_update" },
    });

    return { id: installation.id, status: installation.status, verification: { outcome: "not_supported" } };
  }

  private async updateOAuthTokenExchangeCredentials(
    tenantKey: string,
    installation: { id: string; slug: string },
    dto: UpdateConnectorCredentialsDto,
  ): Promise<{ id: string; status: string; verification: CredentialVerificationResult }> {
    const prefix = installation.slug === "flipkart" ? "FLIPKART" : installation.slug === "ebay" ? "EBAY" : "AMAZON";
    this.assertNoDisallowedFields(dto, ["clientId", "clientSecret", "refreshToken"], installation.slug);

    const clientId = dto.clientId?.trim();
    const clientSecret = dto.clientSecret;
    const refreshToken = dto.refreshToken;

    const missing = [
      !clientId && "Client ID",
      !(clientSecret && clientSecret.trim()) && "Client Secret",
      !(refreshToken && refreshToken.trim()) && "Refresh Token",
    ].filter(Boolean).join(", ");
    if (missing) {
      throw new BadRequestException({
        error: `${prefix}_CREDENTIALS_INCOMPLETE`,
        message: `${installation.slug} credentials require Client ID, Client Secret, and Refresh Token. Missing: ${missing}.`,
      });
    }

    const connector = this.connectorRegistry.getConnector(installation.slug);
    const verification = await connector.verifyCandidateCredentials!({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken!,
    });

    this.throwOnUnverified(prefix, verification);

    // Narrowed by throwOnUnverified: only "valid" reaches here.
    const commitExtra = verification.outcome === "valid" ? verification.commitExtra : undefined;
    const rotatedRefreshToken = commitExtra?.refreshToken;
    const refreshTokenToStore = rotatedRefreshToken?.value ?? refreshToken!;
    const refreshTokenExpiry = rotatedRefreshToken?.expiresAt ?? null;

    const now = new Date();
    try {
      await this.credentialEncryptionService.transaction(tenantKey, async (tx) => {
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "client_id", plainValue: clientId!, metadata: { source: "credentials_update" } },
          tx, { lastValidatedAt: now, failureReason: null },
        );
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "client_secret", plainValue: clientSecret!, metadata: { source: "credentials_update" } },
          tx, { lastValidatedAt: now, failureReason: null },
        );
        await this.credentialEncryptionService.storeCredential(
          { tenantKey, installationId: installation.id, credentialType: "refresh_token", plainValue: refreshTokenToStore, expiresAt: refreshTokenExpiry, metadata: { source: "credentials_update" } },
          tx, { lastValidatedAt: now, failureReason: null },
        );
        if (commitExtra?.accessToken) {
          await this.credentialEncryptionService.storeCredential(
            { tenantKey, installationId: installation.id, credentialType: "access_token", plainValue: commitExtra.accessToken.value, expiresAt: commitExtra.accessToken.expiresAt, metadata: { source: "credentials_update" } },
            tx,
          );
        }
        await tx.connectorInstallation.updateMany({
          where: { id: installation.id, tenantKey },
          data: { status: "ACTIVE", updatedAt: new Date(), ...verifiedValidationStamp() },
        });
      });
    } catch (txError) {
      if (rotatedRefreshToken) {
        // The provider already rotated the refresh token server-side before this
        // transaction failed — that's not "nothing changed," it needs to be
        // operationally visible so it can be manually reconciled.
        this.logger.error("connector_credentials_rotation_commit_failed", {
          installationId: installation.id,
          connectorSlug: installation.slug,
        });
      }
      throw txError;
    }

    return { id: installation.id, status: "ACTIVE", verification };
  }

  private throwOnUnverified(prefix: string, verification: CredentialVerificationResult): void {
    if (verification.outcome === "invalid") {
      throw new BadRequestException({
        error: `${prefix}_CREDENTIALS_INVALID`,
        message: `${prefix} rejected these credentials. Existing credentials were not changed.`,
        verification,
      });
    }
    if (verification.outcome === "unavailable") {
      throw new ServiceUnavailableException({
        error: `${prefix}_CREDENTIALS_UNAVAILABLE`,
        message: `${prefix} couldn't be reached to verify these credentials right now. Existing credentials were not changed — try again shortly.`,
        verification,
      });
    }
    // Only an explicit "valid" counts as verified: a result with no verdict (not_supported) must
    // not let credentials be saved and recorded as validated.
    if (verification.outcome !== "valid") {
      throw new BadRequestException({
        error: `${prefix}_CREDENTIALS_UNVERIFIED`,
        message: `${prefix} could not verify these credentials. Existing credentials were not changed.`,
        verification,
      });
    }
  }

  // PIM#653 — install/reconnect need the same invalid-vs-unavailable distinction
  // throwOnUnverified() already applies to the credential-replace path, so a genuine
  // outage during validation surfaces as a non-exempt 503 (captured by Error Authority)
  // rather than the plain 400 both flows used unconditionally before this fix.
  //
  // As of 2026-09-19 all four connectors with a live credential check implement
  // validateStoredCredentialsDetailed() (Flipkart, Amazon, then Shopify and WooCommerce
  // added later, each with its own explicit review rather than a blind uniform
  // retrofit — WooCommerce in particular deliberately leaves its original
  // validateCredentials() heartbeat behavior untouched per #472/BUG-WOO-HEALTH-001,
  // and only the new one-shot install/reconnect path is honest about "couldn't verify
  // right now"). Any connector without a live check falls back to the original
  // validateCredentials() boolean and plain-400-on-false behavior below, unchanged —
  // this is a duck-typed dispatch on the connector's own interface, not a slug allowlist,
  // so a connector gains the detailed outcome automatically the day it implements the
  // method, without this file needing an update.
  private async validateStoredCredentialsOrThrow(
    connector: ConnectorInterface,
    ctx: ConnectorContext,
    errorCode: string,
    invalidMessage: string,
  ): Promise<void> {
    if (connector.validateStoredCredentialsDetailed) {
      const result = await connector.validateStoredCredentialsDetailed(ctx);
      if (result.outcome === "valid") {
        return;
      }
      if (result.outcome === "unavailable") {
        throw new ServiceUnavailableException({
          error: `${errorCode}_UNAVAILABLE`,
          message: `${invalidMessage} Couldn't be reached to verify right now — try again shortly.`,
        });
      }
      throw new BadRequestException({ error: errorCode, message: invalidMessage });
    }
    const validated = await connector.validateCredentials(ctx);
    if (!validated) {
      throw new BadRequestException({ error: errorCode, message: invalidMessage });
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
        ...unvalidatedAfterCredentialChange(),
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
        ...unvalidatedAfterCredentialChange(),
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
    await this.validateStoredCredentialsOrThrow(
      connector,
      this.buildConnectorContext({
        id: input.installationId,
        tenantKey: input.tenantKey,
        connectorId: input.connectorId,
        slug: "flipkart",
        externalAccountRef: input.externalAccountRef ?? null,
        metadata: {},
      }),
      "FLIPKART_CREDENTIALS_INVALID",
      "Flipkart credentials could not be validated. Check the client ID, client secret, and refresh token.",
    );
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
    await this.validateStoredCredentialsOrThrow(
      connector,
      this.buildConnectorContext({
        id: input.installationId,
        tenantKey: input.tenantKey,
        connectorId: input.connectorId,
        slug: "amazon-in",
        externalAccountRef: input.externalAccountRef ?? null,
        metadata: { sellerId: input.externalAccountRef, marketplaceId },
      }),
      "AMAZON_CREDENTIALS_INVALID",
      "Amazon credentials could not be validated. Check the client ID, client secret, and refresh token.",
    );

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
   * Odoo install-time credential capture. DTO field reuse (matching the
   * existing WooCommerce/Myntra convention of repurposing the generic
   * clientId/clientSecret/refreshToken slots per connector):
   *   externalAccountRef -> odoo_url   (e.g. https://odoo.example.com, HTTPS required)
   *   clientId           -> username
   *   clientSecret       -> password   (a real user password OR an Odoo API key —
   *                                     both authenticate via /jsonrpc's common.authenticate)
   *   refreshToken       -> database   (the Odoo database name, e.g. "odoo")
   */
  private async captureAndStoreOdooCredentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const odooUrl  = String(input.externalAccountRef ?? "").trim();
    const username = String(input.dto.clientId       ?? "").trim();
    const password = String(input.dto.clientSecret   ?? "").trim();
    const database = String(input.dto.refreshToken   ?? "").trim();

    if (!odooUrl || !username || !password || !database) {
      const missing = [
        !odooUrl   && "Odoo URL",
        !database  && "Database",
        !username  && "Username",
        !password  && "Password or API Key",
      ].filter(Boolean).join(", ");
      throw new BadRequestException({
        error: "ODOO_CREDENTIALS_INCOMPLETE",
        message: `Odoo installation requires Odoo URL, Database, Username, and Password/API Key. Missing: ${missing}.`,
      });
    }

    if (!odooUrl.startsWith("https://")) {
      throw new BadRequestException({
        error: "ODOO_URL_NOT_HTTPS",
        message: "Odoo URL must use HTTPS.",
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "odoo_url",
      plainValue: odooUrl,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "database",
      plainValue: database,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "username",
      plainValue: username,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "password",
      plainValue: password,
      metadata: { source: "install_form" },
    });
    // Live preflight (HTTPS + common.authenticate reachability) deferred to
    // validateCredentials heartbeat, matching the WooCommerce install path above.
  }

  // PrestaShop install-time capture. DTO field reuse (matching the Odoo
  // convention above):
  //   externalAccountRef -> store_url   (e.g. https://shop.example.com, HTTPS required)
  //   clientId           -> api_key     (Webservice API key, Basic-auth username with
  //                                      an empty password — PrestaShop's own convention)
  //   refreshToken       -> lang_id     (optional; defaults to "1" if not supplied)
  private async captureAndStorePrestaShopCredentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const storeUrl = String(input.externalAccountRef ?? "").trim();
    const apiKey = String(input.dto.clientId ?? "").trim();
    const langId = String(input.dto.refreshToken ?? "").trim() || "1";

    if (!storeUrl || !apiKey) {
      const missing = [!storeUrl && "Store URL", !apiKey && "Webservice API Key"].filter(Boolean).join(", ");
      throw new BadRequestException({
        error: "PRESTASHOP_CREDENTIALS_INCOMPLETE",
        message: `PrestaShop installation requires Store URL and Webservice API Key. Missing: ${missing}.`,
      });
    }

    if (!storeUrl.startsWith("https://")) {
      throw new BadRequestException({
        error: "PRESTASHOP_URL_NOT_HTTPS",
        message: "PrestaShop store URL must use HTTPS.",
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "store_url",
      plainValue: storeUrl,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "api_key",
      plainValue: apiKey,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "lang_id",
      plainValue: langId,
      metadata: { source: "install_form" },
    });
    // Live preflight (HTTPS + /api/ reachability) deferred to the
    // validateCredentials heartbeat, matching the Odoo install path above.
  }

  // BigCommerce install-time capture. DTO field reuse:
  //   externalAccountRef -> store_hash  (e.g. "abc123", from the store's Store
  //                                      API Accounts URL)
  //   clientId           -> api_key     (Store API account's Access Token,
  //                                      sent as the X-Auth-Token header)
  private async captureAndStoreBigCommerceCredentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const storeHash = String(input.externalAccountRef ?? "").trim();
    const apiKey = String(input.dto.clientId ?? "").trim();

    if (!storeHash || !apiKey) {
      const missing = [!storeHash && "Store Hash", !apiKey && "API Access Token"].filter(Boolean).join(", ");
      throw new BadRequestException({
        error: "BIGCOMMERCE_CREDENTIALS_INCOMPLETE",
        message: `BigCommerce installation requires Store Hash and API Access Token. Missing: ${missing}.`,
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "store_hash",
      plainValue: storeHash,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "api_key",
      plainValue: apiKey,
      metadata: { source: "install_form" },
    });
    // Live preflight (X-Auth-Token + /catalog/summary reachability) deferred
    // to the validateCredentials heartbeat, matching the Odoo install path above.
  }

  // Shopware install-time capture. DTO field reuse:
  //   externalAccountRef -> store_url     (HTTPS store base URL)
  //   clientId            -> client_id     (Integration's Access ID)
  //   clientSecret        -> client_secret (Integration's Secret Key)
  private async captureAndStoreShopwareCredentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const storeUrl = String(input.externalAccountRef ?? "").trim();
    const clientId = String(input.dto.clientId ?? "").trim();
    const clientSecret = String(input.dto.clientSecret ?? "").trim();

    if (!storeUrl || !clientId || !clientSecret) {
      const missing = [
        !storeUrl && "Store URL",
        !clientId && "Integration Access ID",
        !clientSecret && "Integration Secret Key",
      ].filter(Boolean).join(", ");
      throw new BadRequestException({
        error: "SHOPWARE_CREDENTIALS_INCOMPLETE",
        message: `Shopware installation requires Store URL, Integration Access ID, and Integration Secret Key. Missing: ${missing}.`,
      });
    }

    if (!storeUrl.startsWith("https://")) {
      throw new BadRequestException({
        error: "SHOPWARE_URL_NOT_HTTPS",
        message: "Shopware store URL must use HTTPS.",
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "store_url",
      plainValue: storeUrl,
      metadata: { source: "install_form" },
    });
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
    // Live preflight (client_credentials exchange + /api/_info/config
    // reachability) deferred to the validateCredentials heartbeat, matching
    // the Odoo/BigCommerce install paths above.
  }

  // Zoho Inventory install-time capture. DTO field reuse (matching the
  // Dynamics 365 convention — all four generic OAuth-quad fields, each
  // repurposed to their real Zoho meaning):
  //   externalAccountRef -> organization_id (Zoho Inventory org id, required
  //                                           on every API call)
  //   clientId            -> client_id       (Zoho API Console client id)
  //   clientSecret        -> client_secret   (Zoho API Console client secret)
  //   refreshToken        -> refresh_token   (from a completed OAuth consent
  //                                           flow; Zoho does not rotate it)
  // marketplaceId reuses eBay's existing generic DTO field/metadata path to
  // carry the data-center region code (com/eu/in/com.au/jp/com.cn) — no new
  // plumbing needed, defaults to "com" (Zoho's global host) when unset.
  private async captureAndStoreZohoInventoryCredentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const organizationId = String(input.externalAccountRef ?? "").trim();
    const clientId = String(input.dto.clientId ?? "").trim();
    const clientSecret = String(input.dto.clientSecret ?? "").trim();
    const refreshToken = String(input.dto.refreshToken ?? "").trim();

    if (!organizationId || !clientId || !clientSecret || !refreshToken) {
      const missing = [
        !organizationId && "Organization ID",
        !clientId && "Client ID",
        !clientSecret && "Client Secret",
        !refreshToken && "Refresh Token",
      ].filter(Boolean).join(", ");
      throw new BadRequestException({
        error: "ZOHO_INVENTORY_CREDENTIALS_INCOMPLETE",
        message: `Zoho Inventory installation requires Organization ID, Client ID, Client Secret, and Refresh Token (from a completed OAuth consent flow). Missing: ${missing}.`,
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "organization_id",
      plainValue: organizationId,
      metadata: { source: "install_form" },
    });
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

    const marketplaceId = String(input.dto.marketplaceId ?? "").trim() || "com";
    await this.patchInstallationMetadata(input.tenantKey, input.installationId, { marketplaceId });
    // Live preflight (refresh_token exchange + /inventory/v1/items
    // reachability) deferred to the validateCredentials heartbeat, matching
    // the Odoo/BigCommerce/Shopware install paths above.
  }

  // eBay install-time capture. Uses the same generic client_id/client_secret/
  // refresh_token OAuth-quad shape as Flipkart/Amazon (no externalAccountRef —
  // eBay has no natural single "account reference" the way Etsy's shop_id or
  // Odoo's odoo_url do). marketplaceId reuses Amazon's existing generic DTO
  // field and is stored in installation.metadata, not as a credential — that
  // path already populates ctx.marketplaceId for any slug. The three eBay
  // Business Policy IDs are their own named DTO fields (ebayFulfillmentPolicyId
  // etc.) and are optional here: a merchant may not have configured eBay
  // Business Policies yet at install time. They're required only later, by
  // publishProduct/updateProduct (see ebay.connector.ts's requirePolicyIds()).
  private async captureAndStoreEbayCredentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const clientId = String(input.dto.clientId ?? "").trim();
    const clientSecret = String(input.dto.clientSecret ?? "").trim();
    const refreshToken = String(input.dto.refreshToken ?? "").trim();

    if (!clientId || !clientSecret || !refreshToken) {
      const missing = [!clientId && "Client ID", !clientSecret && "Client Secret", !refreshToken && "Refresh Token"]
        .filter(Boolean)
        .join(", ");
      throw new BadRequestException({
        error: "EBAY_CREDENTIALS_INCOMPLETE",
        message: `eBay installation requires Client ID, Client Secret, and Refresh Token (from a completed OAuth consent flow). Missing: ${missing}.`,
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

    const fulfillmentPolicyId = String(input.dto.ebayFulfillmentPolicyId ?? "").trim();
    const paymentPolicyId = String(input.dto.ebayPaymentPolicyId ?? "").trim();
    const returnPolicyId = String(input.dto.ebayReturnPolicyId ?? "").trim();
    if (fulfillmentPolicyId) {
      await this.credentialEncryptionService.storeCredential({
        tenantKey: input.tenantKey,
        installationId: input.installationId,
        credentialType: "fulfillment_policy_id",
        plainValue: fulfillmentPolicyId,
        metadata: { source: "install_form" },
      });
    }
    if (paymentPolicyId) {
      await this.credentialEncryptionService.storeCredential({
        tenantKey: input.tenantKey,
        installationId: input.installationId,
        credentialType: "payment_policy_id",
        plainValue: paymentPolicyId,
        metadata: { source: "install_form" },
      });
    }
    if (returnPolicyId) {
      await this.credentialEncryptionService.storeCredential({
        tenantKey: input.tenantKey,
        installationId: input.installationId,
        credentialType: "return_policy_id",
        plainValue: returnPolicyId,
        metadata: { source: "install_form" },
      });
    }

    const marketplaceId = String(input.dto.marketplaceId ?? "").trim() || "EBAY_US";
    await this.patchInstallationMetadata(input.tenantKey, input.installationId, { marketplaceId });
    // Live preflight (token exchange + Sell Inventory API reachability)
    // deferred to validateCredentials heartbeat, matching the Odoo/Etsy/
    // Dynamics 365/PrestaShop install paths above.
  }

  // Etsy install-time capture. DTO field reuse (matching the Odoo convention
  // above):
  //   externalAccountRef -> shop_id         (numeric Etsy shop ID)
  //   clientId           -> client_id       (Etsy Keystring)
  //   clientSecret       -> shared_secret   (Etsy Shared Secret — required for
  //                                          x-api-key alongside client_id;
  //                                          verified live 2026-09-20 that a
  //                                          bare client_id 403s)
  //   refreshToken       -> refresh_token   (obtained via the OAuth2/PKCE
  //                                          authorization-code flow before
  //                                          install; Etsy rotates this value
  //                                          on every use)
  private async captureAndStoreEtsyCredentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const shopId = String(input.externalAccountRef ?? "").trim();
    const clientId = String(input.dto.clientId ?? "").trim();
    const sharedSecret = String(input.dto.clientSecret ?? "").trim();
    const refreshToken = String(input.dto.refreshToken ?? "").trim();

    if (!shopId || !clientId || !sharedSecret || !refreshToken) {
      const missing = [
        !shopId && "Shop ID",
        !clientId && "Client ID (Keystring)",
        !sharedSecret && "Shared Secret",
        !refreshToken && "Refresh Token",
      ].filter(Boolean).join(", ");
      throw new BadRequestException({
        error: "ETSY_CREDENTIALS_INCOMPLETE",
        message: `Etsy installation requires Shop ID, Client ID, Shared Secret, and Refresh Token. Missing: ${missing}.`,
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "shop_id",
      plainValue: shopId,
      metadata: { source: "install_form" },
    });
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
      credentialType: "shared_secret",
      plainValue: sharedSecret,
      metadata: { source: "install_form" },
    });
    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "refresh_token",
      plainValue: refreshToken,
      metadata: { source: "install_form" },
    });
    // Live preflight (token exchange + x-api-key reachability) deferred to
    // validateCredentials heartbeat, matching the Odoo install path above.
  }

  // Dynamics 365 install-time capture. DTO field reuse (matching the
  // Odoo/Etsy convention above):
  //   externalAccountRef -> aad_tenant         (Azure AD tenant ID or domain)
  //   clientId           -> client_id          (Azure AD app registration's Application ID)
  //   clientSecret       -> client_secret      (Azure AD app registration's client secret)
  //   refreshToken       -> environment_company (pipe-separated "{environment}|{companyName}",
  //                                              e.g. "Production|CRONUS IN" — see
  //                                              dynamics365.connector.ts's resolveApiBase()
  //                                              for why this resolves to a company GUID via
  //                                              a live lookup rather than asking for one)
  private async captureAndStoreDynamics365Credentials(input: {
    tenantKey: string;
    installationId: string;
    externalAccountRef: string | null;
    dto: InstallConnectorDto;
  }): Promise<void> {
    const aadTenant = String(input.externalAccountRef ?? "").trim();
    const clientId = String(input.dto.clientId ?? "").trim();
    const clientSecret = String(input.dto.clientSecret ?? "").trim();
    const environmentCompany = String(input.dto.refreshToken ?? "").trim();

    if (!aadTenant || !clientId || !clientSecret || !environmentCompany) {
      const missing = [
        !aadTenant && "Azure AD Tenant",
        !clientId && "Client ID",
        !clientSecret && "Client Secret",
        !environmentCompany && "Environment/Company",
      ].filter(Boolean).join(", ");
      throw new BadRequestException({
        error: "DYNAMICS_365_CREDENTIALS_INCOMPLETE",
        message: `Dynamics 365 installation requires Azure AD Tenant, Client ID, Client Secret, and Environment/Company. Missing: ${missing}.`,
      });
    }

    await this.credentialEncryptionService.storeCredential({
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      credentialType: "aad_tenant",
      plainValue: aadTenant,
      metadata: { source: "install_form" },
    });
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
      credentialType: "environment_company",
      plainValue: environmentCompany,
      metadata: { source: "install_form" },
    });
    // Live preflight (token exchange + Business Central API reachability)
    // deferred to validateCredentials heartbeat, matching the Odoo/Etsy
    // install paths above.
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
    status: string;
    metadata: Record<string, unknown>;
  }> {
    const rows = await tenantRaw<Array<Record<string, unknown>>>(this.prisma.tenant(tenantKey), `
      SELECT
        ci.id,
        ci.tenant_key AS "tenantKey",
        ci.connector_id AS "connectorId",
        ci.account_alias AS "accountAlias",
        ci.external_account_ref AS "externalAccountRef",
        ci.status,
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
      status: String(row.status),
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
