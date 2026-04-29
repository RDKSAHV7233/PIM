import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RequireStepUp } from "../auth/step-up.decorator";
import { StepUpGuard } from "../auth/step-up.guard";
import { STEP_UP_SCOPE_MAPPING_HIGH_RISK } from "../auth/jwt";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { ConnectorMappingService } from "./connector-mapping.service";
import { BatchMarketplaceReadinessDto } from "./dto/batch-marketplace-readiness.dto";
import { CloneMappingTemplateDto } from "./dto/clone-mapping-template.dto";
import {
  ArchiveConnectorMappingVersionDto,
  ConnectorMappingPreflightDto,
  ConnectorPublishReadinessDto,
  ConnectorTaxonomySearchQueryDto,
  CreateConnectorMappingVersionDto,
  ListConnectorMappingVersionsQueryDto,
  PublishConnectorMappingVersionDto,
  ResolveConnectorMappingQueryDto,
  RollbackConnectorMappingVersionDto,
} from "./dto/connector-mapping.dto";
import { CreateExportJobAliasDto } from "./dto/create-export-job-alias.dto";
import { CreateExportJobDto } from "./dto/create-export-job.dto";
import { CreateMappingTemplateDto } from "./dto/create-mapping-template.dto";
import { SimulateMarketplaceDto } from "./dto/simulate-marketplace.dto";
import { UpdateMappingTemplateDto } from "./dto/update-mapping-template.dto";
import { DEFAULT_MARKETPLACE_CHANNEL } from "./marketplace-channels";
import { MarketplaceService } from "./marketplace.service";

@Controller("marketplace")
@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "human_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@ApiTags("Marketplace")
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly connectorMappingService: ConnectorMappingService,
  ) {}

  private resolveActor(request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string }) {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    };
  }

  @Get("channels")
  @Roles("admin", "editor")
  listChannels() {
    return this.marketplaceService.listChannels();
  }

  @Get("connectors/:connectorSlug/mappings/versions")
  @Roles("admin", "editor")
  listConnectorMappingVersions(
    @Param("connectorSlug") connectorSlug: string,
    @Query() query: ListConnectorMappingVersionsQueryDto,
  ) {
    return this.connectorMappingService.listVersions({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      categoryScope: query.categoryScope,
      includeArchived: query.includeArchived,
    });
  }

  @Post("connectors/:connectorSlug/mappings/versions")
  @Roles("admin", "editor")
  createConnectorMappingVersion(
    @Param("connectorSlug") connectorSlug: string,
    @Body() dto: CreateConnectorMappingVersionDto,
    @Req() request: { pimUserId?: string },
  ) {
    return this.connectorMappingService.createDraft({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      categoryScope: dto.categoryScope,
      mappingLevel: dto.mappingLevel,
      connectorDefinitionId: dto.connectorDefinitionId,
      connectorDefinitionVersion: dto.connectorDefinitionVersion,
      compatibilityState: dto.compatibilityState,
      mappingRules: dto.mappingRules,
      fallbackPolicy: dto.fallbackPolicy,
      fallbackAckRequired: dto.fallbackAckRequired,
      actorId: request.pimUserId,
    });
  }

  @Post("connectors/:connectorSlug/mappings/versions/:versionId/validate")
  @Roles("admin", "editor")
  validateConnectorMappingVersion(
    @Param("connectorSlug") connectorSlug: string,
    @Param("versionId") versionId: string,
    @Req() request: { pimUserId?: string },
  ) {
    return this.connectorMappingService.validateVersion({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      versionId: String(versionId ?? "").trim(),
      actorId: request.pimUserId,
    });
  }

  @Post("connectors/:connectorSlug/mappings/versions/:versionId/publish")
  @Roles("admin", "editor")
  @UseGuards(StepUpGuard)
  @RequireStepUp(STEP_UP_SCOPE_MAPPING_HIGH_RISK, "mapping.publish")
  publishConnectorMappingVersion(
    @Param("connectorSlug") connectorSlug: string,
    @Param("versionId") versionId: string,
    @Body() dto: PublishConnectorMappingVersionDto,
    @Req() request: { pimUserId?: string },
  ) {
    return this.connectorMappingService.publishVersion({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      versionId: String(versionId ?? "").trim(),
      confirm: dto.confirm,
      actorId: request.pimUserId,
    });
  }

  @Post("connectors/:connectorSlug/mappings/versions/:versionId/rollback")
  @Roles("admin", "editor")
  @UseGuards(StepUpGuard)
  @RequireStepUp(STEP_UP_SCOPE_MAPPING_HIGH_RISK, "mapping.rollback")
  rollbackConnectorMappingVersion(
    @Param("connectorSlug") connectorSlug: string,
    @Param("versionId") versionId: string,
    @Body() dto: RollbackConnectorMappingVersionDto,
    @Req() request: { pimUserId?: string },
  ) {
    return this.connectorMappingService.rollbackVersion({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      versionId: String(versionId ?? "").trim(),
      confirm: dto.confirm,
      reason: dto.reason,
      actorId: request.pimUserId,
    });
  }

  @Post("connectors/:connectorSlug/mappings/versions/:versionId/archive")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  @UseGuards(StepUpGuard)
  @RequireStepUp(STEP_UP_SCOPE_MAPPING_HIGH_RISK, "mapping.archive")
  archiveConnectorMappingVersion(
    @Param("connectorSlug") connectorSlug: string,
    @Param("versionId") versionId: string,
    @Body() dto: ArchiveConnectorMappingVersionDto,
    @Req() request: { pimUserId?: string },
  ) {
    return this.connectorMappingService.archiveVersion({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      versionId: String(versionId ?? "").trim(),
      reason: dto.reason,
      actorId: request.pimUserId,
    });
  }

  @Get("connectors/:connectorSlug/mappings/resolve")
  @Roles("admin", "editor")
  resolveConnectorMapping(
    @Param("connectorSlug") connectorSlug: string,
    @Query() query: ResolveConnectorMappingQueryDto,
  ) {
    return this.connectorMappingService.resolveEffectiveMapping({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      categoryScope: query.categoryScope,
    });
  }

  @Post("connectors/:connectorSlug/mappings/preflight")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  preflightConnectorMapping(
    @Param("connectorSlug") connectorSlug: string,
    @Body() dto: ConnectorMappingPreflightDto,
    @Req() request: { pimUserId?: string },
  ) {
    return this.connectorMappingService.evaluateMappingPreflight({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      categoryScope: dto.categoryScope,
      fallbackAcknowledged: dto.fallbackAcknowledged,
      actorId: request.pimUserId,
    });
  }

  @Get("connectors/:connectorSlug/taxonomy/search")
  @Roles("admin", "editor")
  searchConnectorTaxonomy(
    @Param("connectorSlug") connectorSlug: string,
    @Query() query: ConnectorTaxonomySearchQueryDto,
  ) {
    return this.connectorMappingService.searchTaxonomy({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      query: query.q,
      limit: query.limit,
    });
  }

  @Get("connectors/:connectorSlug/taxonomy/unmapped")
  @Roles("admin", "editor")
  listUnmappedConnectorTaxonomy(@Param("connectorSlug") connectorSlug: string) {
    return this.connectorMappingService.listUnmappedCategories({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
    });
  }

  @Post("connectors/:connectorSlug/publish-readiness")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  evaluateConnectorPublishReadiness(
    @Param("connectorSlug") connectorSlug: string,
    @Body() dto: ConnectorPublishReadinessDto,
    @Req() request: { pimUserId?: string },
  ) {
    return this.connectorMappingService.evaluatePublishReadiness({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      categoryScope: dto.categoryScope,
      fallbackAcknowledged: dto.fallbackAcknowledged,
      productId: dto.productId,
      actorId: request.pimUserId,
    });
  }

  @Get("channels/:channel/mapping")
  @Roles("admin", "editor")
  getChannelMapping(
    @Param("channel") channel: string,
    @Query("categoryId") categoryId?: string,
    @Query("templateId") templateId?: string,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.getChannelMapping(channel, categoryId, templateId, this.resolveActor(request ?? {}));
  }

  @Get("categories/:id/templates")
  @Roles("admin", "editor")
  listTemplates(
    @Param("id") categoryId: string,
    @Query("channel") channel?: string,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.listTemplates(categoryId, channel, this.resolveActor(request ?? {}));
  }

  @Post("categories/:id/templates")
  createTemplate(
    @Param("id") categoryId: string,
    @Body() dto: CreateMappingTemplateDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.createTemplate(categoryId, dto, this.resolveActor(request ?? {}));
  }

  @Get("templates/:id")
  @Roles("admin", "editor")
  getTemplate(
    @Param("id") templateId: string,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.getTemplate(templateId, this.resolveActor(request ?? {}));
  }

  @Patch("templates/:id")
  updateTemplate(
    @Param("id") templateId: string,
    @Body() dto: UpdateMappingTemplateDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.updateTemplate(templateId, dto, this.resolveActor(request ?? {}));
  }

  @Delete("templates/:id")
  deleteTemplate(
    @Param("id") templateId: string,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.deleteTemplate(templateId, this.resolveActor(request ?? {}));
  }

  @Post("templates/:id/clone")
  cloneTemplate(
    @Param("id") templateId: string,
    @Body() dto: CloneMappingTemplateDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.cloneTemplate(templateId, dto, this.resolveActor(request ?? {}));
  }

  @Get("products/:id/simulate")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  simulateProductQuery(
    @Param("id") productId: string,
    @Query("channel") channel = DEFAULT_MARKETPLACE_CHANNEL,
    @Query("templateId") templateId?: string,
  ) {
    return this.marketplaceService.simulateProduct(productId, channel, templateId);
  }

  @Post("products/:id/simulate")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  simulateProductBody(@Param("id") productId: string, @Body() dto: SimulateMarketplaceDto) {
    return this.marketplaceService.simulateProduct(productId, dto.channel, dto.templateId);
  }

  @Post("readiness/batch")
  @HttpCode(200)
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  batchReadiness(@Body() dto: BatchMarketplaceReadinessDto) {
    return this.marketplaceService.getBatchReadiness(dto.productIds, dto.channels);
  }

  @Post("products/:id/export-jobs")
  @Roles("admin", "editor")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("submissions")
  @ApiOperation({ summary: "Create marketplace export job" })
  @ApiResponse({ status: 201, description: "Export job queued" })
  @ApiResponse({ status: 402, description: "Plan limit exceeded" })
  createExportJob(
    @Param("id") productId: string,
    @Body() dto: CreateExportJobDto,
    @Req() request: { pimUserId?: string; pimRole?: import("../common/rbac/roles").AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.createExportJob(productId, dto, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Get("export-jobs")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  @ApiOperation({ summary: "List export jobs" })
  @ApiResponse({ status: 200, description: "Export jobs fetched" })
  listExportJobs(
    @Query("productId") productId?: string,
    @Query() pagination?: CursorPaginationDto,
    @Query("templateSummary") templateSummary?: string,
  ) {
    // Full template payload remains available for legacy callers; prefer ?templateSummary=true for job lists.
    return this.marketplaceService.listExportJobs(productId, pagination, {
      templateSummary: templateSummary === "true",
    });
  }

  @Post("export-job")
  @Roles("admin", "editor")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("submissions")
  @ApiOperation({ summary: "Create export job (alias endpoint)" })
  @ApiResponse({ status: 201, description: "Export job queued" })
  @ApiResponse({ status: 402, description: "Plan limit exceeded" })
  createExportJobAlias(
    @Body() dto: CreateExportJobAliasDto,
    @Req() request: { pimUserId?: string; pimRole?: import("../common/rbac/roles").AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.createExportJob(dto.productId, dto, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Get("export-jobs/:id")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  getExportJob(@Param("id") jobId: string) {
    return this.marketplaceService.getExportJob(jobId);
  }

  @Post("export-jobs/:id/process")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  processExportJob(@Param("id") jobId: string) {
    return this.marketplaceService.processExportJob(jobId);
  }

  @Post("export-jobs/:id/requeue")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin")
  requeueExportJob(@Param("id") jobId: string) {
    return this.marketplaceService.requeueExportJob(jobId);
  }
}
