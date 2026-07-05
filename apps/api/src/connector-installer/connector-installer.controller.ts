import { BadRequestException, Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Redirect, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { PlanGuard } from "../billing/plan-guard.guard";
import { PlanUsageService } from "../billing/plan-usage.service";
import { Public } from "../auth/public.decorator";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute, ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { DashboardService } from "../dashboard/dashboard.service";
import {
  APP_ROLES,
  AppRole,
  availableRolesForTier,
  isRoleAvailableForTier,
  Roles,
} from "../common/rbac/roles";
import { ConfigureConnectorDto } from "./dto/configure-connector.dto";
import { ConnectorPayloadPreviewDto } from "./dto/connector-payload-preview.dto";
import { GrantConnectorPermissionDto } from "./dto/grant-connector-permission.dto";
import { InstallConnectorDto } from "./dto/install-connector.dto";
import { ListConnectorPermissionsDto } from "./dto/list-connector-permissions.dto";
import { ListInstalledConnectorsDto } from "./dto/list-installed-connectors.dto";
import { UpdatePublicationTargetsDto } from "./dto/update-publication-targets.dto";
import { ConnectorInstallerService } from "./connector-installer.service";

type AuthenticatedRequest = Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimAdminBoundaryRoles?: string[] };

@Controller("connectors")
@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "human_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@ApiTags("Connectors")
export class ConnectorInstallerController {
  constructor(
    private readonly connectorInstallerService: ConnectorInstallerService,
    private readonly planUsageService: PlanUsageService,
    private readonly dashboardService: DashboardService,
  ) {}

  private resolveActor(request: AuthenticatedRequest) {
    return {
      actorId: request.pimUserId ?? "system",
      actorRole: request.pimRole ?? "viewer",
      tenantId: request.pimTenant,
      adminBoundaryRoles: Array.isArray(request.pimAdminBoundaryRoles) ? request.pimAdminBoundaryRoles : [],
    } as const;
  }

  @Get("definitions")
  @Roles("admin", "editor", "connector_admin", "channel_manager", "reviewer", "approver", "publisher")
  @Header("Cache-Control", "private, max-age=60, stale-while-revalidate=300")
  listDefinitions(@Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.listAvailableDefinitions(this.resolveActor(request));
  }

  @Post(":slug/install")
  @Roles("admin", "editor", "connector_admin")
  @UseGuards(PlanGuard)
  @RequirePlanLimit(["connectors_installations", "connector_accounts"])
  @ApiOperation({ summary: "Install connector for tenant" })
  @ApiResponse({ status: 201, description: "Connector installed" })
  installConnector(
    @Param("slug") slug: string,
    @Body() dto: InstallConnectorDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connectorInstallerService.install(slug, dto, this.resolveActor(request));
  }

  @Get("installed")
  @Roles("admin", "editor", "connector_admin", "channel_manager", "reviewer", "approver", "publisher")
  @ApiOperation({ summary: "List installed connectors" })
  @ApiResponse({ status: 200, description: "Installed connectors fetched" })
  listInstalled(@Query() query: ListInstalledConnectorsDto, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.listInstalled(query, undefined, this.resolveActor(request));
  }

  @Get("installed/:id")
  @Roles("admin", "editor", "connector_admin", "channel_manager", "reviewer", "approver", "publisher")
  @Header("Cache-Control", "private, max-age=30, stale-while-revalidate=60")
  @ApiOperation({ summary: "Get a single installed connector by installation ID" })
  @ApiResponse({ status: 200, description: "Installed connector fetched" })
  @ApiResponse({ status: 404, description: "Connector installation not found" })
  getInstalledById(@Param("id") installationId: string, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.getInstalledById(installationId, this.resolveActor(request));
  }

  @Get("installations/health")
  @Roles("admin", "editor", "connector_admin", "channel_manager", "reviewer", "approver", "publisher")
  @ApiOperation({ summary: "List installation-scoped connector health truth" })
  @ApiResponse({ status: 200, description: "Connector installation health fetched" })
  getInstallationHealth() {
    return this.dashboardService.getConnectorInstallationsHealth();
  }

  @Get("summary")
  @Roles("admin", "editor", "connector_admin", "channel_manager", "reviewer", "approver", "publisher")
  @ApiOperation({ summary: "List connector summary truth for current tenant" })
  @ApiResponse({ status: 200, description: "Connector summary fetched" })
  getConnectorSummary() {
    return this.dashboardService.getConnectorSummary();
  }

  @Post(":id/uninstall")
  @Roles("admin", "editor", "connector_admin")
  uninstall(@Param("id") installationId: string, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.uninstall(installationId, this.resolveActor(request));
  }

  @Delete(":slug/install/:id")
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  @ApiOperation({ summary: "Delete connector installation record by slug + installation id" })
  @ApiResponse({ status: 200, description: "Connector installation deleted" })
  uninstallBySlugAndId(
    @Param("slug") slug: string,
    @Param("id") installationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connectorInstallerService.deleteInstallation(installationId, this.resolveActor(request), slug);
  }

  @Post(":id/reconnect")
  @Roles("admin", "editor", "connector_admin")
  reconnect(@Param("id") installationId: string, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.reconnect(installationId, this.resolveActor(request));
  }

  @Patch(":id/configure")
  @Roles("admin", "editor", "connector_admin")
  @ApiOperation({ summary: "Update connector installation configuration (marketplace ID, default product type, etc.)" })
  @ApiResponse({ status: 200, description: "Configuration updated" })
  configure(
    @Param("id") installationId: string,
    @Body() dto: ConfigureConnectorDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connectorInstallerService.configure(installationId, dto, this.resolveActor(request));
  }

  @Post(":id/oauth/callback")
  @Roles("admin", "editor", "connector_admin")
  @HttpCode(200)
  @ApiOperation({ summary: "Complete OAuth callback for a connector installation" })
  @ApiResponse({ status: 200, description: "OAuth callback handled and credentials persisted" })
  oauthCallback(
    @Param("id") installationId: string,
    @Body() params: Record<string, string>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connectorInstallerService.handleOAuthCallback(
      installationId,
      params ?? {},
      this.resolveActor(request),
    );
  }

  @Get("shopify/oauth/callback")
  @Public()
  @ApiOperation({ summary: "Handle Shopify OAuth redirect via static callback URL (installation ID in state)" })
  @ApiResponse({ status: 302, description: "Redirects to web app after token exchange" })
  async oauthCallbackStatic(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const webRoot = String(process.env.CORS_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
    // state is the installation ID
    const installationId = String(query.state ?? "").trim();
    if (!installationId) {
      res.redirect(`${webRoot}/channels/connectors?status=oauth_error&detail=${encodeURIComponent("Missing installation ID in state parameter")}`);
      return;
    }
    try {
      await this.connectorInstallerService.handleOAuthCallback(
        installationId,
        query ?? {},
        { actorId: "oauth-redirect", actorRole: "admin" },
      );
      res.redirect(`${webRoot}/channels/connectors/${encodeURIComponent(installationId)}?status=oauth_complete`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.redirect(`${webRoot}/channels/connectors/${encodeURIComponent(installationId)}?status=oauth_error&detail=${encodeURIComponent(msg)}`);
    }
  }

  @Get(":id/oauth/callback")
  @Public()
  @ApiOperation({ summary: "Handle Shopify OAuth redirect (public GET callback)" })
  @ApiResponse({ status: 302, description: "Redirects to web app after token exchange" })
  async oauthCallbackRedirect(
    @Param("id") installationId: string,
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const webRoot = String(process.env.CORS_ORIGIN ?? "http://localhost:3000").replace(/\/+$/, "");
    try {
      await this.connectorInstallerService.handleOAuthCallback(
        installationId,
        query ?? {},
        { actorId: "oauth-redirect", actorRole: "admin" },
      );
      res.redirect(`${webRoot}/channels/connectors/${encodeURIComponent(installationId)}?status=oauth_complete`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.redirect(`${webRoot}/channels/connectors/${encodeURIComponent(installationId)}?status=oauth_error&detail=${encodeURIComponent(msg)}`);
    }
  }

  @Get(":id/product-type-schema")
  @Roles("admin", "editor", "connector_admin")
  @ApiOperation({ summary: "Fetch connector product type schema for an installed account" })
  @ApiResponse({ status: 200, description: "Product type schema fetched" })
  productTypeSchema(
    @Param("id") installationId: string,
    @Query("productType") productType: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const normalizedProductType = String(productType ?? "").trim();
    if (!normalizedProductType) {
      throw new BadRequestException({
        error: "PRODUCT_TYPE_REQUIRED",
        message: "productType query parameter is required.",
      });
    }
    return this.connectorInstallerService.fetchProductTypeSchema(
      installationId,
      normalizedProductType,
      this.resolveActor(request),
    );
  }

  @Get(":id/publications")
  @Roles("admin", "editor", "connector_admin")
  @ApiOperation({ summary: "List publication targets for an installed connector account" })
  @ApiResponse({ status: 200, description: "Publication targets fetched" })
  listPublications(
    @Param("id") installationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connectorInstallerService.listPublications(
      installationId,
      this.resolveActor(request),
    );
  }

  @Post(":id/publication-targets")
  @Roles("admin", "editor", "connector_admin")
  @ApiOperation({ summary: "Persist publication targets for an installed connector account" })
  @ApiResponse({ status: 201, description: "Publication targets saved" })
  updatePublicationTargets(
    @Param("id") installationId: string,
    @Body() dto: UpdatePublicationTargetsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connectorInstallerService.updatePublicationTargets(
      installationId,
      dto,
      this.resolveActor(request),
    );
  }

  @Post(":id/payload-preview")
  @Roles("admin", "editor", "connector_admin")
  @ApiOperation({ summary: "Generate payload preview for connector installation + product" })
  @ApiResponse({ status: 200, description: "Payload preview generated" })
  payloadPreview(
    @Param("id") installationId: string,
    @Body() dto: ConnectorPayloadPreviewDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connectorInstallerService.previewPayload(installationId, dto, this.resolveActor(request));
  }

  @Get("permissions")
  @ReadAccessPolicy("connector_permissions_governance_redacted")
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  listPermissions(@Query() query: ListConnectorPermissionsDto) {
    return this.connectorInstallerService.listPermissions(query.connectorSlug);
  }

  @Post("permissions")
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  async grantPermission(
    @Body() dto: GrantConnectorPermissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.resolveActor(request);
    if (dto.principalType === "role" && actor.tenantId) {
      const normalizedRole = String(dto.principalId ?? "").trim().toLowerCase();
      if ((APP_ROLES as readonly string[]).includes(normalizedRole)) {
        const planTier = await this.planUsageService.getTenantPlanTier(actor.tenantId);
        if (!isRoleAvailableForTier(normalizedRole as AppRole, planTier)) {
          throw new BadRequestException({
            error: "ROLE_NOT_AVAILABLE_IN_PLAN",
            role: normalizedRole,
            planTier,
            availableRoles: availableRolesForTier(planTier),
          });
        }
      }
    }
    return this.connectorInstallerService.grantPermission(dto, actor);
  }

  @Delete("permissions/:id")
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  revokePermission(@Param("id") permissionId: string, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.revokePermission(permissionId, this.resolveActor(request));
  }
}
