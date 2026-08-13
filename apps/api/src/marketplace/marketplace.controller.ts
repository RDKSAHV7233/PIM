import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { RequireStepUp } from "../auth/step-up.decorator";
import { StepUpGuard } from "../auth/step-up.guard";
import { STEP_UP_SCOPE_MAPPING_HIGH_RISK } from "../auth/jwt";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { APP_ROLES, AppRole, Roles } from "../common/rbac/roles";
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
import { ListExportJobsQueryDto } from "./dto/list-export-jobs-query.dto";
import { CreateMappingTemplateDto } from "./dto/create-mapping-template.dto";
import { SimulateMarketplaceDto } from "./dto/simulate-marketplace.dto";
import { ConfirmCatalogLinksDto } from "./dto/confirm-catalog-links.dto";
import { RetryRecoveryGroupDto } from "./dto/retry-recovery-group.dto";
import { TriggerBulkPublishDto } from "./dto/trigger-bulk-publish.dto";
import { UpsertScheduleDto } from "./dto/upsert-schedule.dto";
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
  @Roles("admin", "editor", "channel_manager")
  listChannels() {
    return this.marketplaceService.listChannels();
  }

  @Get("channels/:channel/destinations")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "publisher", "channel_manager")
  @ApiOperation({ summary: "List safe publishing destinations for a marketplace channel" })
  @ApiResponse({ status: 200, description: "Publishing destinations returned (no credentials)" })
  listPublishingDestinations(@Param("channel") channel: string) {
    return this.marketplaceService.listPublishingDestinations(channel);
  }

  @Get("connectors/:connectorSlug/mappings/versions")
  @Roles("admin", "editor", "channel_manager")
  listConnectorMappingVersions(
    @Param("connectorSlug") connectorSlug: string,
    @Query() query: ListConnectorMappingVersionsQueryDto,
  ) {
    return this.connectorMappingService.listVersions({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      categoryScope: query.categoryScope,
      installationId: query.installationId,
      includeArchived: query.includeArchived,
    });
  }

  @Post("connectors/:connectorSlug/mappings/versions")
  @Roles("admin", "editor", "channel_manager")
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
      installationId: dto.installationId ?? null,
      actorId: request.pimUserId,
    });
  }

  @Post("connectors/:connectorSlug/mappings/versions/:versionId/validate")
  @Roles("admin", "editor", "channel_manager")
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
  @Roles("admin", "editor", "channel_manager")
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
      installationId: dto.installationId ?? null,
      actorId: request.pimUserId,
    });
  }

  @Post("connectors/:connectorSlug/mappings/versions/:versionId/rollback")
  @Roles("admin", "editor", "channel_manager")
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
  @Roles("admin", "editor", "channel_manager", "publisher")
  resolveConnectorMapping(
    @Param("connectorSlug") connectorSlug: string,
    @Query() query: ResolveConnectorMappingQueryDto,
  ) {
    return this.connectorMappingService.resolveEffectiveMapping({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      categoryScope: query.categoryScope,
      installationId: query.installationId,
    });
  }

  @Post("connectors/:connectorSlug/mappings/preflight")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "channel_manager", "publisher")
  preflightConnectorMapping(
    @Param("connectorSlug") connectorSlug: string,
    @Body() dto: ConnectorMappingPreflightDto,
    @Req() request: { pimUserId?: string },
  ) {
    return this.connectorMappingService.evaluateMappingPreflight({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      categoryScope: dto.categoryScope,
      installationId: dto.installationId,
      fallbackAcknowledged: dto.fallbackAcknowledged,
      actorId: request.pimUserId,
    });
  }

  @Get("connectors/:connectorSlug/taxonomy/search")
  @Roles("admin", "editor", "channel_manager")
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
  @Roles("admin", "editor", "channel_manager")
  listUnmappedConnectorTaxonomy(@Param("connectorSlug") connectorSlug: string) {
    return this.connectorMappingService.listUnmappedCategories({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
    });
  }

  @Post("connectors/:connectorSlug/publish-readiness")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  // "Channels — channel readiness" is R for every role per
  // docs/security/rbac-permissions-matrix.md; the product detail and mapping
  // wizard pages call this unconditionally regardless of viewer role.
  @Roles(...APP_ROLES)
  evaluateConnectorPublishReadiness(
    @Param("connectorSlug") connectorSlug: string,
    @Body() dto: ConnectorPublishReadinessDto,
    @Req() request: { pimUserId?: string },
  ) {
    return this.connectorMappingService.evaluatePublishReadiness({
      connectorSlug: String(connectorSlug ?? "").trim().toLowerCase(),
      categoryScope: dto.categoryScope,
      installationId: dto.installationId,
      fallbackAcknowledged: dto.fallbackAcknowledged,
      productId: dto.productId,
      actorId: request.pimUserId,
    });
  }

  @Get("channels/:channel/mapping")
  @Roles("admin", "editor", "channel_manager")
  getChannelMapping(
    @Param("channel") channel: string,
    @Query("categoryId") categoryId?: string,
    @Query("templateId") templateId?: string,
    @Query("installationId") installationId?: string,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.getChannelMapping(
      channel,
      categoryId,
      templateId,
      this.resolveActor(request ?? {}),
      installationId,
    );
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
  @Roles(...APP_ROLES)
  simulateProductQuery(
    @Param("id") productId: string,
    @Query("channel") channel = DEFAULT_MARKETPLACE_CHANNEL,
    @Query("templateId") templateId?: string,
    @Query("installationId") installationId?: string,
  ) {
    return this.marketplaceService.simulateProduct(productId, channel, templateId, installationId);
  }

  @Post("products/:id/simulate")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles(...APP_ROLES)
  simulateProductBody(@Param("id") productId: string, @Body() dto: SimulateMarketplaceDto) {
    return this.marketplaceService.simulateProduct(productId, dto.channel, dto.templateId, dto.installationId);
  }

  @Post("readiness/batch")
  @HttpCode(200)
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles(...APP_ROLES)
  batchReadiness(@Body() dto: BatchMarketplaceReadinessDto) {
    return this.marketplaceService.getBatchReadiness(dto.productIds, dto.channels);
  }

  @Post("products/:id/export-jobs")
  @Roles("admin", "publisher", "channel_manager")
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
  listExportJobs(@Query() query: ListExportJobsQueryDto) {
    // Full template payload remains available for legacy callers; prefer ?templateSummary=true for job lists.
    return this.marketplaceService.listExportJobs(query.productId, query, {
      templateSummary: query.templateSummary === "true",
    });
  }

  @Post("export-job")
  @Roles("admin", "publisher", "channel_manager")
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

  @Get("connectors/shopify/:installationId/recovery/groups")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getRecoveryGroups(@Param("installationId") installationId: string) {
    return this.marketplaceService.getRecoveryGroups(installationId);
  }

  @Post("connectors/shopify/:installationId/recovery/retry-group")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  @HttpCode(200)
  retryRecoveryGroup(
    @Param("installationId") installationId: string,
    @Body() dto: RetryRecoveryGroupDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.retryRecoveryGroup(installationId, dto.errorFamily, this.resolveActor(request));
  }

  @Post("connectors/shopify/:installationId/products/:productId/preview-changes")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  // Read-only diff ahead of publish: roles that can queue exports (admin,
  // publisher, channel_manager per docs/security/rbac-permissions-matrix.md
  // "Channels — publish / queue export") must be able to preview what the
  // export will change; editor keeps access for the sync/recovery surfaces.
  @Roles("admin", "editor", "publisher", "channel_manager")
  @HttpCode(200)
  previewShopifyProductChanges(
    @Param("installationId") installationId: string,
    @Param("productId") productId: string,
  ) {
    return this.marketplaceService.previewProductChanges(installationId, productId);
  }

  // ─── Sprint 8: Delta sync ────────────────────────────────────────────────

  @Get("connectors/shopify/:installationId/sync/delta-candidates")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getDeltaSyncCandidates(@Param("installationId") installationId: string) {
    return this.marketplaceService.getDeltaSyncCandidates(installationId);
  }

  /** Live progress breakdown for a running Shopify delta sync.
   *  Equivalent to the generic /connectors/:id/sync/status endpoint. */
  @Get("connectors/shopify/:installationId/sync/status")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getShopifyDeltaSyncStatus(@Param("installationId") installationId: string) {
    return this.marketplaceService.getDeltaSyncStatus(installationId);
  }

  @Post("connectors/shopify/:installationId/sync/delta")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "publisher", "channel_manager")
  @HttpCode(200)
  queueDeltaSync(
    @Param("installationId") installationId: string,
    @Req() request: { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.marketplaceService.queueDeltaSync(installationId, this.resolveActor(request));
  }

  @Get("connectors/shopify/:installationId/sync/states")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getSyncStates(@Param("installationId") installationId: string) {
    return this.marketplaceService.getSyncStates(installationId);
  }

  // ─── Sprint 9: Scheduled sync ────────────────────────────────────────────

  @Get("connectors/shopify/:installationId/schedule")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getSchedule(@Param("installationId") installationId: string) {
    return this.marketplaceService.getSchedule(installationId);
  }

  @Post("connectors/shopify/:installationId/schedule")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  upsertSchedule(
    @Param("installationId") installationId: string,
    @Body() dto: UpsertScheduleDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.marketplaceService.upsertSchedule(
      installationId,
      { cronExpression: dto.cronExpression, scope: dto.scope ?? "approved_only", status: dto.status ?? "active" },
      this.resolveActor(request),
    );
  }

  @Delete("connectors/shopify/:installationId/schedule")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  @HttpCode(204)
  deleteSchedule(@Param("installationId") installationId: string) {
    return this.marketplaceService.deleteSchedule(installationId);
  }

  // ─── Sprint G: Generic connector sync routes ────────────────────────────
  // These sit at connectors/:installationId/... (without the /shopify/ segment)
  // and work for any connector slug. NestJS resolves static segments first,
  // so connectors/shopify/:id routes above continue to match Shopify requests
  // arriving via the legacy path; these generic routes handle Amazon/Flipkart
  // (and Shopify installations that have been migrated to the generic path).

  @Get("connectors/:installationId/sync/delta-candidates")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getConnectorDeltaSyncCandidates(@Param("installationId") installationId: string) {
    return this.marketplaceService.getDeltaSyncCandidates(installationId);
  }

  /** Live progress breakdown — poll this while a delta sync is running.
   *  Returns per-status job counts, a 0-1 pendingRatio, and lastUpdatedAt. */
  @Get("connectors/:installationId/sync/status")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getConnectorDeltaSyncStatus(@Param("installationId") installationId: string) {
    return this.marketplaceService.getDeltaSyncStatus(installationId);
  }

  @Post("connectors/:installationId/sync/delta")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "publisher", "channel_manager")
  @HttpCode(200)
  queueConnectorDeltaSync(
    @Param("installationId") installationId: string,
    @Req() request: { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.marketplaceService.queueDeltaSync(installationId, this.resolveActor(request));
  }

  @Get("connectors/:installationId/sync/states")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getConnectorSyncStates(@Param("installationId") installationId: string) {
    return this.marketplaceService.getSyncStates(installationId);
  }

  @Get("connectors/:installationId/schedule")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getConnectorSchedule(@Param("installationId") installationId: string) {
    return this.marketplaceService.getSchedule(installationId);
  }

  @Post("connectors/:installationId/schedule")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  upsertConnectorSchedule(
    @Param("installationId") installationId: string,
    @Body() dto: UpsertScheduleDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.marketplaceService.upsertSchedule(
      installationId,
      {
        cronExpression: dto.cronExpression,
        scope: dto.scope ?? "approved_only",
        status: dto.status ?? "active",
      },
      this.resolveActor(request),
    );
  }

  @Delete("connectors/:installationId/schedule")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  @HttpCode(204)
  deleteConnectorSchedule(@Param("installationId") installationId: string) {
    return this.marketplaceService.deleteSchedule(installationId);
  }

  // ─── Sprint F: Amazon Feeds API bulk publish ─────────────────────────────

  @Post("connectors/:installationId/bulk-publish")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "publisher", "channel_manager")
  @HttpCode(200)
  triggerBulkPublish(
    @Param("installationId") installationId: string,
    @Body() dto: TriggerBulkPublishDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.marketplaceService.triggerBulkPublish(installationId, dto.productIds, this.resolveActor(request));
  }

  // ─── Meesho Excel export ─────────────────────────────────────────────────
  // POST because we accept productIds in the body; GET would require URL-encoding
  // potentially large product ID lists. Returns the .xlsx file as a binary stream.

  @Post("connectors/:installationId/export")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor", "channel_manager")
  @HttpCode(200)
  @ApiOperation({ summary: "Generate and download Meesho Excel export file" })
  @ApiResponse({ status: 200, description: "Excel file returned as binary stream" })
  async triggerConnectorExport(
    @Param("installationId") installationId: string,
    @Body() dto: TriggerBulkPublishDto,
    @Res() res: Response,
  ) {
    const exportFile = await this.marketplaceService.triggerConnectorExport(
      installationId,
      dto.productIds,
    );
    res.setHeader("Content-Type", exportFile.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportFile.filename}"`,
    );
    res.setHeader("Content-Length", exportFile.buffer.length);
    res.end(exportFile.buffer);
  }

  // ─── Sprint 10: Catalog linking ──────────────────────────────────────────

  // ─── Sprint 2: Shopify config import ─────────────────────────────────────────

  @Get("connectors/shopify/:installationId/shopify-config")
  @Roles("admin", "editor")
  getShopifyConfig(@Param("installationId") installationId: string) {
    return this.marketplaceService.getShopifyConfig(installationId);
  }

  @Post("connectors/shopify/:installationId/shopify-config/import")
  @Roles("admin")
  @HttpCode(200)
  importShopifyConfig(@Param("installationId") installationId: string) {
    return this.marketplaceService.importShopifyConfig(installationId);
  }

  @Post("connectors/shopify/:installationId/catalog-link/scan")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  @HttpCode(200)
  scanCatalogLinks(@Param("installationId") installationId: string) {
    return this.marketplaceService.scanCatalogLinks(installationId);
  }

  @Get("connectors/shopify/:installationId/catalog-link")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  getProductLinks(@Param("installationId") installationId: string) {
    return this.marketplaceService.getProductLinks(installationId);
  }

  @Post("connectors/shopify/:installationId/catalog-link/confirm")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  confirmCatalogLinks(
    @Param("installationId") installationId: string,
    @Body() dto: ConfirmCatalogLinksDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole },
  ) {
    return this.marketplaceService.confirmCatalogLinks(installationId, dto.links, this.resolveActor(request));
  }
}
