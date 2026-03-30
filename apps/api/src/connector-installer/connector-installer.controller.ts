import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { APP_ROLES, AppRole, Roles } from "../common/rbac/roles";
import { ConnectorPayloadPreviewDto } from "./dto/connector-payload-preview.dto";
import { GrantConnectorPermissionDto } from "./dto/grant-connector-permission.dto";
import { InstallConnectorDto } from "./dto/install-connector.dto";
import { ListConnectorPermissionsDto } from "./dto/list-connector-permissions.dto";
import { ListInstalledConnectorsDto } from "./dto/list-installed-connectors.dto";
import { ConnectorInstallerService } from "./connector-installer.service";

type AuthenticatedRequest = FastifyRequest & { pimUserId?: string; pimRole?: AppRole };

@Controller("connectors")
@ApiTags("Connectors")
export class ConnectorInstallerController {
  constructor(private readonly connectorInstallerService: ConnectorInstallerService) {}

  private resolveActor(request: AuthenticatedRequest) {
    return {
      actorId: request.pimUserId ?? "system",
      actorRole: request.pimRole ?? "viewer",
    } as const;
  }

  @Get("definitions")
  listDefinitions(@Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.listAvailableDefinitions(this.resolveActor(request));
  }

  @Post(":slug/install")
  @Roles(...APP_ROLES)
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
  @ApiOperation({ summary: "List installed connectors" })
  @ApiResponse({ status: 200, description: "Installed connectors fetched" })
  listInstalled(@Query() query: ListInstalledConnectorsDto, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.listInstalled(query, undefined, this.resolveActor(request));
  }

  @Post(":id/uninstall")
  @Roles(...APP_ROLES)
  uninstall(@Param("id") installationId: string, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.uninstall(installationId, this.resolveActor(request));
  }

  @Delete(":slug/install/:id")
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
  @Roles(...APP_ROLES)
  reconnect(@Param("id") installationId: string, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.reconnect(installationId, this.resolveActor(request));
  }

  @Post(":id/oauth/callback")
  @Roles(...APP_ROLES)
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

  @Post(":id/payload-preview")
  @ApiOperation({ summary: "Generate payload preview for connector installation + product" })
  @ApiResponse({ status: 200, description: "Payload preview generated" })
  payloadPreview(
    @Param("id") installationId: string,
    @Body() dto: ConnectorPayloadPreviewDto,
  ) {
    return this.connectorInstallerService.previewPayload(installationId, dto);
  }

  @Get("permissions")
  @Roles("admin")
  listPermissions(@Query() query: ListConnectorPermissionsDto) {
    return this.connectorInstallerService.listPermissions(query.connectorSlug);
  }

  @Post("permissions")
  @Roles("admin")
  grantPermission(
    @Body() dto: GrantConnectorPermissionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.connectorInstallerService.grantPermission(dto, this.resolveActor(request));
  }

  @Delete("permissions/:id")
  @Roles("admin")
  revokePermission(@Param("id") permissionId: string, @Req() request: AuthenticatedRequest) {
    return this.connectorInstallerService.revokePermission(permissionId, this.resolveActor(request));
  }
}
