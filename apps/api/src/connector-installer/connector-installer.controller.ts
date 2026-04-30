import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute, ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { ConnectorPayloadPreviewDto } from "./dto/connector-payload-preview.dto";
import { GrantConnectorPermissionDto } from "./dto/grant-connector-permission.dto";
import { InstallConnectorDto } from "./dto/install-connector.dto";
import { ListConnectorPermissionsDto } from "./dto/list-connector-permissions.dto";
import { ListInstalledConnectorsDto } from "./dto/list-installed-connectors.dto";
import { UpdatePublicationTargetsDto } from "./dto/update-publication-targets.dto";
import { ConnectorInstallerService } from "./connector-installer.service";

type AuthenticatedRequest = Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string };

@Controller("connectors")
@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "human_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@ApiTags("Connectors")
export class ConnectorInstallerController {
  constructor(private readonly connectorInstallerService: ConnectorInstallerService) {}

  private resolveActor(request: AuthenticatedRequest) {
    return {
      actorId: request.pimUserId ?? "system",
      actorRole: request.pimRole ?? "viewer",
      tenantId: request.pimTenant,
    } as const;
  }

  @Get("definitions")
  @Roles("admin", "editor")
  listDefinitions(@Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.listAvailableDefinitions(this.resolveActor(request));
  }

  @Post(":slug/install")
  @Roles("admin", "editor")
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
  @Roles("admin", "editor")
  @ApiOperation({ summary: "List installed connectors" })
  @ApiResponse({ status: 200, description: "Installed connectors fetched" })
  listInstalled(@Query() query: ListInstalledConnectorsDto, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.listInstalled(query, undefined, this.resolveActor(request));
  }

  @Post(":id/uninstall")
  @Roles("admin", "editor")
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
  @Roles("admin", "editor")
  reconnect(@Param("id") installationId: string, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.reconnect(installationId, this.resolveActor(request));
  }

  @Post(":id/oauth/callback")
  @Roles("admin", "editor")
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

  @Get(":id/product-type-schema")
  @Roles("admin", "editor")
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
  @Roles("admin", "editor")
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
  @Roles("admin", "editor")
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
  @Roles("admin", "editor")
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
  grantPermission(
    @Body() dto: GrantConnectorPermissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connectorInstallerService.grantPermission(dto, this.resolveActor(request));
  }

  @Delete("permissions/:id")
  @AdminBoundaryAccess({ capability: "manage_security" })
  @Roles("admin")
  revokePermission(@Param("id") permissionId: string, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.revokePermission(permissionId, this.resolveActor(request));
  }
}
