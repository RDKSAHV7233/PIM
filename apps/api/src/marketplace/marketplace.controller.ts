import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RequireStepUp } from "../auth/step-up.decorator";
import { StepUpGuard } from "../auth/step-up.guard";
import { STEP_UP_SCOPE_MAPPING_HIGH_RISK } from "../auth/jwt";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { Roles } from "../common/rbac/roles";
import { ConnectorMappingService } from "./connector-mapping.service";
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
import { MarketplaceService } from "./marketplace.service";

@Controller("marketplace")
@ApiTags("Marketplace")
export class MarketplaceController {
  constructor(
    private readonly marketplaceService: MarketplaceService,
    private readonly connectorMappingService: ConnectorMappingService,
  ) {}

  @Get("channels")
  listChannels() {
    return this.marketplaceService.listChannels();
  }

  @Get("connectors/:connectorSlug/mappings/versions")
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
  listUnmappedConnectorTaxonomy(@Param("connectorSlug") connectorSlug: string) {
    return this.connectorMappingService.listUnmappedCategories({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
    });
  }

  @Post("connectors/:connectorSlug/publish-readiness")
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
  getChannelMapping(
    @Param("channel") channel: string,
    @Query("categoryId") categoryId?: string,
    @Query("templateId") templateId?: string,
  ) {
    return this.marketplaceService.getChannelMapping(channel, categoryId, templateId);
  }

  @Get("categories/:id/templates")
  listTemplates(@Param("id") categoryId: string, @Query("channel") channel?: string) {
    return this.marketplaceService.listTemplates(categoryId, channel);
  }

  @Post("categories/:id/templates")
  createTemplate(@Param("id") categoryId: string, @Body() dto: CreateMappingTemplateDto) {
    return this.marketplaceService.createTemplate(categoryId, dto);
  }

  @Get("templates/:id")
  getTemplate(@Param("id") templateId: string) {
    return this.marketplaceService.getTemplate(templateId);
  }

  @Patch("templates/:id")
  updateTemplate(@Param("id") templateId: string, @Body() dto: UpdateMappingTemplateDto) {
    return this.marketplaceService.updateTemplate(templateId, dto);
  }

  @Delete("templates/:id")
  deleteTemplate(@Param("id") templateId: string) {
    return this.marketplaceService.deleteTemplate(templateId);
  }

  @Post("templates/:id/clone")
  cloneTemplate(@Param("id") templateId: string, @Body() dto: CloneMappingTemplateDto) {
    return this.marketplaceService.cloneTemplate(templateId, dto);
  }

  @Get("products/:id/simulate")
  simulateProductQuery(
    @Param("id") productId: string,
    @Query("channel") channel = "amazon",
    @Query("templateId") templateId?: string,
  ) {
    return this.marketplaceService.simulateProduct(productId, channel, templateId);
  }

  @Post("products/:id/simulate")
  simulateProductBody(@Param("id") productId: string, @Body() dto: SimulateMarketplaceDto) {
    return this.marketplaceService.simulateProduct(productId, dto.channel, dto.templateId);
  }

  @Post("products/:id/export-jobs")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("submissions")
  @ApiOperation({ summary: "Create marketplace export job" })
  @ApiResponse({ status: 201, description: "Export job queued" })
  @ApiResponse({ status: 402, description: "Plan limit exceeded" })
  createExportJob(@Param("id") productId: string, @Body() dto: CreateExportJobDto) {
    return this.marketplaceService.createExportJob(productId, dto);
  }

  @Get("export-jobs")
  @ApiOperation({ summary: "List export jobs" })
  @ApiResponse({ status: 200, description: "Export jobs fetched" })
  listExportJobs(@Query("productId") productId?: string, @Query() pagination?: CursorPaginationDto) {
    return this.marketplaceService.listExportJobs(productId, pagination);
  }

  @Post("export-job")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("submissions")
  @ApiOperation({ summary: "Create export job (alias endpoint)" })
  @ApiResponse({ status: 201, description: "Export job queued" })
  @ApiResponse({ status: 402, description: "Plan limit exceeded" })
  createExportJobAlias(@Body() dto: CreateExportJobAliasDto) {
    return this.marketplaceService.createExportJob(dto.productId, dto);
  }

  @Get("export-jobs/:id")
  getExportJob(@Param("id") jobId: string) {
    return this.marketplaceService.getExportJob(jobId);
  }

  @Post("export-jobs/:id/process")
  processExportJob(@Param("id") jobId: string) {
    return this.marketplaceService.processExportJob(jobId);
  }

  @Post("export-jobs/:id/requeue")
  requeueExportJob(@Param("id") jobId: string) {
    return this.marketplaceService.requeueExportJob(jobId);
  }
}
