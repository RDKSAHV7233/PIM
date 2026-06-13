import { BadRequestException, Body, Controller, ForbiddenException, Get, Header, Headers, HttpCode, Logger, Post, Query, Req, Res, UnauthorizedException } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AuditService } from "../audit/audit.service";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute, ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { requireInternalToken } from "../common/security/internal-token";
import { DEFAULT_TENANT_KEY, normalizeTenantKey } from "../common/tenant/tenant.constants";
import { Public } from "../auth/public.decorator";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { CommercialRequestsService } from "./commercial-requests.service";
import { CommercialNotificationsService } from "./commercial-notifications.service";
import { PlanUsageService } from "./plan-usage.service";
import { StripeService } from "./stripe.service";
import { CreatePlanUpgradeRequestDto } from "./dto/create-plan-upgrade-request.dto";
import {
  PlanMetadataListDto,
  PlanProfileSummaryDto,
  PlanUpgradeRequestCreateDto,
  PlanUpgradeRequestLookupDto,
  PlanUsageSummaryDto,
} from "./dto/billing-response.dto";
import { ExportCommercialTenantsDto } from "./dto/export-commercial-tenants.dto";
import { InternalUpdateTenantCommercialStateDto } from "./dto/internal-update-tenant-commercial-state.dto";
import { InternalSetTenantPlanTierDto } from "./dto/internal-set-tenant-plan-tier.dto";
import { ListPlanUpgradeRequestsDto } from "./dto/list-plan-upgrade-requests.dto";
import { SearchCommercialTenantsDto } from "./dto/search-commercial-tenants.dto";
import { SetTenantPlanTierDto } from "./dto/set-tenant-plan-tier.dto";
import { UpdateBillingContactDto } from "./dto/update-billing-contact.dto";
import { UpdatePlanUpgradeRequestStatusDto } from "./dto/update-plan-upgrade-request-status.dto";
import { getPlanMetadata } from "./plan-metadata";

type AuthenticatedRequest = Request & {
  pimUserId?: string;
  pimRole?: AppRole;
};

type UsageSummary = Awaited<ReturnType<PlanUsageService["getUsageSummary"]>>;

function buildUpgradeUsageSnapshot(usage: UsageSummary): Record<string, unknown> {
  return {
    capturedAt: new Date().toISOString(),
    planTier: usage.planTier,
    billingStatus: usage.billingStatus,
    accessStatus: usage.accessStatus,
    billingCycleResetAt: usage.billingCycleResetAt,
    resources: {
      skus: usage.skus,
      submissions: usage.submissions,
      users: usage.users,
      storageGb: usage.storageGb,
      connectorInstallations: usage.connectorsInstallations,
      connectorAccounts: usage.connectorAccounts,
      apiKeys: usage.apiKeys,
      outboundWebhooks: usage.outboundWebhooks,
      importRowsPerJob: usage.importRowsPerJob,
    },
  };
}

@Controller("billing")
@DisallowApiClient()
@ApiTags("Billing")
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(
    private readonly planUsageService: PlanUsageService,
    private readonly auditService: AuditService,
    private readonly commercialRequestsService: CommercialRequestsService,
    private readonly commercialNotificationsService: CommercialNotificationsService,
    private readonly stripeService: StripeService,
  ) {}

  @Get("usage")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ allowedRoles: ["product_admin", "system_admin", "super_admin"] })
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Get current tenant plan usage" })
  @ApiResponse({ status: 200, description: "Plan usage fetched", type: PlanUsageSummaryDto })
  usage() {
    return this.planUsageService.getUsageSummary();
  }

  @Get("plans")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Get plan metadata and commercial limits" })
  @ApiResponse({ status: 200, description: "Plan metadata fetched", type: PlanMetadataListDto })
  plans() {
    return { items: getPlanMetadata() };
  }

  @Get("plan-profile")
  @ReadAccessPolicy("billing_plan_profile_governance_redacted")
  @AdminBoundaryAccess({ allowedRoles: ["system_admin", "super_admin"] })
  @Roles("admin")
  @ApiOperation({ summary: "Get current tenant plan profile" })
  @ApiResponse({ status: 200, description: "Tenant plan profile fetched", type: PlanProfileSummaryDto })
  planProfile() {
    return this.planUsageService.getTenantPlanProfile();
  }

  @Post("billing-contact")
  @AdminBoundaryAccess({ allowedRoles: ["system_admin", "super_admin"] })
  @Roles("admin")
  @HttpCode(200)
  @ApiOperation({ summary: "Update the billing notice recipient for this tenant" })
  @ApiResponse({ status: 200, description: "Tenant billing contact updated", type: PlanProfileSummaryDto })
  async updateBillingContact(
    @Body() dto: UpdateBillingContactDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actorId = String(request.pimUserId ?? "system");
    const actorRole = String(request.pimRole ?? "admin");
    const current = await this.planUsageService.getTenantPlanProfile();
    const profile = await this.planUsageService.updateCommercialStateForTenant(
      current.tenantKey,
      {
        billingContactEmail: dto.billingContactEmail ?? null,
      },
      actorId,
    );

    await this.auditService.record({
      actorId,
      actorRole,
      action: "TENANT_BILLING_CONTACT_UPDATED",
      resource: "TENANT_PLAN_PROFILE",
      resourceId: profile.tenantKey,
      tenantKey: profile.tenantKey,
      metadata: {
        event: "tenant_billing_contact_updated",
        previousBillingContactEmail: current.billingContactEmail,
        billingContactEmail: profile.billingContactEmail,
      },
    });
    return profile;
  }

  @Get("upgrade-request")
  @ReadAccessPolicy("billing_upgrade_request_governance_redacted")
  @AdminBoundaryAccess({ allowedRoles: ["system_admin", "super_admin"] })
  @Roles("admin")
  @ApiOperation({ summary: "Get current open upgrade request for this tenant" })
  @ApiResponse({ status: 200, description: "Current open upgrade request fetched", type: PlanUpgradeRequestLookupDto })
  async upgradeRequest() {
    const usage = await this.planUsageService.getUsageSummary();
    return {
      item: await this.commercialRequestsService.getOpenUpgradeRequestForTenant(usage.profile.tenantKey),
    };
  }

  @Post("upgrade-request")
  @AdminBoundaryAccess({ allowedRoles: ["system_admin", "super_admin"] })
  @Roles("admin")
  @HttpCode(200)
  @ApiOperation({ summary: "Create or reuse an upgrade request for this tenant" })
  @ApiResponse({ status: 200, description: "Upgrade request created or reused", type: PlanUpgradeRequestCreateDto })
  async createUpgradeRequest(
    @Body() dto: CreatePlanUpgradeRequestDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actorId = String(request.pimUserId ?? "system");
    const actorRole = String(request.pimRole ?? "admin");
    const usage = await this.planUsageService.getUsageSummary();
    const result = await this.commercialRequestsService.createOrReuseUpgradeRequest(usage.profile.tenantKey, {
      requestedBy: actorId,
      requesterRole: actorRole,
      currentPlanTier: usage.planTier,
      requestedPlanTier: dto.requestedPlanTier,
      currentBillingStatus: usage.billingStatus,
      currentAccessStatus: usage.accessStatus,
      usageSnapshot: buildUpgradeUsageSnapshot(usage),
      notes: dto.notes,
      source: dto.source,
    });

    await this.auditService.record({
      actorId,
      actorRole,
      action: result.created ? "COMMERCIAL_UPGRADE_REQUEST_CREATED" : "COMMERCIAL_UPGRADE_REQUEST_REUSED",
      resource: "TENANT_COMMERCIAL_REQUEST",
      resourceId: result.item.id,
      tenantKey: result.item.tenantKey,
      metadata: {
        event: result.created ? "commercial_upgrade_request_created" : "commercial_upgrade_request_reused",
        tenantKey: result.item.tenantKey,
        currentPlanTier: result.item.currentPlanTier,
        requestedPlanTier: result.item.requestedPlanTier,
        currentBillingStatus: result.item.currentBillingStatus,
        currentAccessStatus: result.item.currentAccessStatus,
        source: result.item.source,
      },
    });
    if (result.created) {
      await this.commercialNotificationsService.notifyCommercialOpsUpgradeRequest({
        tenantKey: result.item.tenantKey,
        request: result.item,
      });
    }
    return result;
  }

  @Post("checkout-session")
  @AdminBoundaryAccess({ allowedRoles: ["system_admin", "super_admin"] })
  @Roles("admin")
  @HttpCode(200)
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Create a Stripe checkout session for plan upgrade" })
  @ApiResponse({ status: 200, description: "Checkout session URL returned" })
  async createCheckoutSession(
    @Body() body: { planTier?: string; successUrl?: string; cancelUrl?: string },
    @Req() request: AuthenticatedRequest,
  ) {
    if (!this.stripeService.isEnabled()) {
      throw new BadRequestException({ error: "STRIPE_BILLING_NOT_ENABLED" });
    }
    const usage = await this.planUsageService.getUsageSummary();
    const tenantKey = usage.profile.tenantKey;
    const planTier = String(body.planTier ?? "GROWTH").toUpperCase();
    const webBaseUrl = String(process.env.PIM_WEB_BASE_URL ?? "").trim().replace(/\/+$/, "") || "http://localhost:3000";
    const successUrl = String(body.successUrl ?? "").trim() || `${webBaseUrl}/admin/plan?checkout=success`;
    const cancelUrl = String(body.cancelUrl ?? "").trim() || `${webBaseUrl}/admin/plan?checkout=cancelled`;
    const { url } = await this.stripeService.createCheckoutSession({ tenantKey, planTier, successUrl, cancelUrl });
    await this.auditService.record({
      actorId: String(request.pimUserId ?? "system"),
      actorRole: String(request.pimRole ?? "admin"),
      action: "BILLING_CHECKOUT_SESSION_CREATED",
      resource: "TENANT_PLAN_PROFILE",
      resourceId: tenantKey,
      tenantKey,
      metadata: { planTier },
    });
    return { url };
  }

  @Post("plan-tier")
  @AdminBoundaryAccess({ allowedRoles: ["system_admin", "super_admin"] })
  @Roles("admin")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Set tenant plan tier" })
  @ApiResponse({ status: 200, description: "Tenant plan tier updated" })
  async setPlanTier(
    @Body() _dto: SetTenantPlanTierDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actorId = String(request.pimUserId ?? "system");
    const actorRole = String(request.pimRole ?? "admin");
    await this.auditService.record({
      actorId,
      actorRole,
      action: "COMMERCIAL_MUTATION_BLOCKED",
      resource: "TENANT_PLAN_PROFILE",
      resourceId: String(request.pimUserId ?? "unknown"),
      metadata: {
        event: "tenant_self_plan_mutation_blocked",
      },
    });
    throw new ForbiddenException({ error: "COMMERCIAL_MUTATION_INTERNAL_ONLY" });
  }

  @Public()
  @Get("internal/overview")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Internal-only commercial overview" })
  async getCommercialOverviewInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const { actorId, actorRole } = await this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
      request,
      "billing.internal.overview",
    );

    const [tenantOverview, requestOverview] = await Promise.all([
      this.planUsageService.getCommercialTenantOverview(),
      this.commercialRequestsService.getUpgradeRequestOverviewInternal(),
    ]);
    await this.auditService.record({
      actorId,
      actorRole,
      action: "COMMERCIAL_OVERVIEW_VIEWED",
      resource: "TENANT_PLAN_PROFILE",
      resourceId: "all",
      tenantKey: this.resolveCommercialAuditTenantKey(),
      metadata: {
        event: "commercial_overview_viewed",
        totalTenants: tenantOverview.totalTenants,
        activeRequests: requestOverview.activeRequests,
      },
    });
    return {
      tenantOverview,
      requestOverview,
    };
  }

  @Public()
  @Get("internal/upgrade-requests")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Internal-only upgrade request listing" })
  async listUpgradeRequestsInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Query() query: ListPlanUpgradeRequestsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const { actorId, actorRole } = await this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
      request,
      "billing.internal.upgrade_requests.list",
    );

    const items = await this.commercialRequestsService.listUpgradeRequestsInternal({
      tenantKey: query.tenantKey,
      status: query.status,
      sla: query.sla,
      limit: query.limit,
    });
    await this.auditService.record({
      actorId,
      actorRole,
      action: "COMMERCIAL_UPGRADE_REQUEST_LISTED",
      resource: "TENANT_COMMERCIAL_REQUEST",
      resourceId: query.tenantKey ?? "all",
      tenantKey: this.resolveCommercialAuditTenantKey(query.tenantKey),
      metadata: {
        event: "commercial_upgrade_request_listed",
        tenantKey: query.tenantKey ?? null,
        status: query.status ?? null,
        sla: query.sla ?? null,
        limit: query.limit ?? null,
        resultCount: items.length,
      },
    });
    return {
      items,
      count: items.length,
    };
  }

  @Public()
  @Get("internal/upgrade-requests/export")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Internal-only upgrade request CSV export" })
  @Header("Content-Type", "text/csv; charset=utf-8")
  async exportUpgradeRequestsInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Query() query: ListPlanUpgradeRequestsDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: AuthenticatedRequest,
  ) {
    const { actorId, actorRole } = await this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
      request,
      "billing.internal.upgrade_requests.export",
    );
    const stamp = new Date().toISOString().slice(0, 10);
    response.header("Content-Disposition", `attachment; filename="vexa-pim-commercial-requests-${stamp}.csv"`);
    const csv = await this.commercialRequestsService.exportUpgradeRequestsCsvInternal({
      tenantKey: query.tenantKey,
      status: query.status,
      sla: query.sla,
      limit: query.limit ?? 250,
    });
    await this.auditService.record({
      actorId,
      actorRole,
      action: "COMMERCIAL_UPGRADE_REQUEST_EXPORTED",
      resource: "TENANT_COMMERCIAL_REQUEST",
      resourceId: query.tenantKey ?? "all",
      tenantKey: this.resolveCommercialAuditTenantKey(query.tenantKey),
      metadata: {
        event: "commercial_upgrade_request_exported",
        tenantKey: query.tenantKey ?? null,
        status: query.status ?? null,
        sla: query.sla ?? null,
        limit: query.limit ?? 250,
      },
    });
    return csv;
  }

  @Public()
  @Post("internal/upgrade-requests/status")
  @ApiExcludeEndpoint()
  @HttpCode(200)
  @ApiOperation({ summary: "Internal-only upgrade request status update" })
  async updateUpgradeRequestStatusInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Body() dto: UpdatePlanUpgradeRequestStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const { actorId, actorRole } = await this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
      request,
      "billing.internal.upgrade_requests.status",
    );

    let item;
    try {
      item = await this.commercialRequestsService.updateUpgradeRequestStatusInternal(
        dto.requestId,
        dto.status,
        actorId,
      );
    } catch (error: unknown) {
      // Log full error server-side; return a generic code so internal DB details are not leaked in HTTP responses.
      this.logger.error(`updateUpgradeRequestStatusInternal failed for request ${dto.requestId}`, error instanceof Error ? error.stack : String(error));
      throw new BadRequestException({ error: "UPGRADE_REQUEST_STATUS_UPDATE_FAILED" });
    }

    await this.auditService.record({
      actorId,
      actorRole,
      action: "COMMERCIAL_UPGRADE_REQUEST_STATUS_UPDATED",
      resource: "TENANT_COMMERCIAL_REQUEST",
      resourceId: item.id,
      tenantKey: item.tenantKey,
      metadata: {
        event: "commercial_upgrade_request_status_updated",
        tenantKey: item.tenantKey,
        status: item.status,
        resolvedAt: item.resolvedAt,
        resolvedBy: item.resolvedBy,
      },
    });
    await this.commercialNotificationsService.notifyTenantAdminsUpgradeRequestStatus({
      tenantKey: item.tenantKey,
      request: item,
    });
    return { item };
  }

  @Public()
  @Get("internal/tenants/search")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Internal-only commercial tenant search" })
  async searchCommercialTenantsInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Query() query: SearchCommercialTenantsDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const { actorId, actorRole } = await this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
      request,
      "billing.internal.tenants.search",
    );

    let results;
    try {
      results = await this.planUsageService.searchCommercialTenants(query.q, query.limit);
    } catch (error: unknown) {
      // Log full error server-side; return a generic code so internal DB details are not leaked in HTTP responses.
      this.logger.error(`searchCommercialTenants failed for query "${query.q}"`, error instanceof Error ? error.stack : String(error));
      throw new BadRequestException({ error: "COMMERCIAL_TENANT_SEARCH_FAILED" });
    }
    await this.auditService.record({
      actorId,
      actorRole,
      action: "COMMERCIAL_TENANT_SEARCH",
      resource: "WORKSPACE_DIRECTORY",
      resourceId: query.q,
      tenantKey: this.resolveCommercialAuditTenantKey(),
      metadata: {
        event: "commercial_tenant_search",
        query: query.q,
        limit: query.limit ?? null,
        resultCount: results.length,
      },
    });
    return {
      items: results,
      count: results.length,
      query: query.q,
    };
  }

  @Public()
  @Get("internal/tenants/export")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Internal-only commercial tenant CSV export" })
  @Header("Content-Type", "text/csv; charset=utf-8")
  async exportCommercialTenantsInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Query() query: ExportCommercialTenantsDto,
    @Res({ passthrough: true }) response: Response,
    @Req() request: AuthenticatedRequest,
  ) {
    const { actorId, actorRole } = await this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
      request,
      "billing.internal.tenants.export",
    );

    const stamp = new Date().toISOString().slice(0, 10);
    response.header("Content-Disposition", `attachment; filename="vexa-pim-commercial-tenants-${stamp}.csv"`);
    const csv = await this.planUsageService.exportCommercialTenantsCsvInternal({
      query: query.q,
      limit: query.limit ?? 250,
    });
    await this.auditService.record({
      actorId,
      actorRole,
      action: "COMMERCIAL_TENANT_EXPORTED",
      resource: "WORKSPACE_DIRECTORY",
      resourceId: query.q ?? "all",
      tenantKey: this.resolveCommercialAuditTenantKey(),
      metadata: {
        event: "commercial_tenant_exported",
        query: query.q ?? null,
        limit: query.limit ?? 250,
      },
    });
    return csv;
  }

  @Public()
  @Post("internal/plan-tier")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Internal-only tenant plan tier update" })
  @ApiResponse({ status: 200, description: "Tenant plan tier updated" })
  async setPlanTierInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Body() dto: InternalSetTenantPlanTierDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const { actorId, actorRole } = await this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
      request,
      "billing.internal.plan_tier",
    );

    const profile = await this.planUsageService.setTenantPlanTierForTenant(dto.tenantKey, dto.planTier, actorId);
    await this.auditService.record({
      actorId,
      actorRole,
      action: "PLAN_TIER_CHANGE",
      resource: "TENANT_PLAN_PROFILE",
      resourceId: profile.tenantKey,
      tenantKey: profile.tenantKey,
      metadata: {
        event: "plan_tier_changed",
        planTier: profile.planTier,
        effectiveFrom: profile.effectiveFrom,
      },
    });
    await this.commercialNotificationsService.notifyTenantAdmins({
      tenantKey: profile.tenantKey,
      event: "plan_tier_changed",
      profile,
    });
    return profile;
  }

  @Public()
  @Post("internal/commercial-state")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Internal-only tenant commercial state update" })
  @ApiResponse({ status: 200, description: "Tenant commercial state updated", type: PlanProfileSummaryDto })
  async updateCommercialStateInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Body() dto: InternalUpdateTenantCommercialStateDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const { actorId, actorRole } = await this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
      request,
      "billing.internal.commercial_state",
    );

    const profile = await this.planUsageService.updateCommercialStateForTenant(
      dto.tenantKey,
      {
        billingStatus: dto.billingStatus,
        accessStatus: dto.accessStatus,
        suspensionReason: dto.suspensionReason,
        billingContactEmail: dto.billingContactEmail,
        trialEndsAt: dto.trialEndsAt,
        paidThroughAt: dto.paidThroughAt,
        graceEndsAt: dto.graceEndsAt,
        cancelledAt: dto.cancelledAt,
        suspendedAt: dto.suspendedAt,
      },
      actorId,
    );
    const auditAction =
      dto.accessStatus === "suspended"
        ? "TENANT_ACCESS_SUSPENDED"
        : dto.accessStatus === "active"
          ? "TENANT_ACCESS_RESUMED"
          : dto.billingStatus
            ? "TENANT_BILLING_STATUS_SET"
            : dto.billingContactEmail !== undefined
              ? "TENANT_BILLING_CONTACT_UPDATED"
            : "TENANT_COMMERCIAL_STATE_UPDATED";
    const auditEvent =
      dto.accessStatus === "suspended"
        ? "tenant_suspended"
        : dto.accessStatus === "active"
          ? "tenant_resumed"
          : dto.billingStatus
            ? "tenant_billing_status_set"
            : dto.billingContactEmail !== undefined
              ? "tenant_billing_contact_updated"
            : "tenant_commercial_state_updated";

    await this.auditService.record({
      actorId,
      actorRole,
      action: auditAction,
      resource: "TENANT_PLAN_PROFILE",
      resourceId: profile.tenantKey,
      tenantKey: profile.tenantKey,
      metadata: {
        event: auditEvent,
        billingStatus: profile.billingStatus,
        accessStatus: profile.accessStatus,
        trialEndsAt: profile.trialEndsAt,
        paidThroughAt: profile.paidThroughAt,
        graceEndsAt: profile.graceEndsAt,
        cancelledAt: profile.cancelledAt,
        suspendedAt: profile.suspendedAt,
        suspensionReason: profile.suspensionReason,
        billingContactEmail: profile.billingContactEmail,
      },
    });
    await this.commercialNotificationsService.notifyTenantAdmins({
      tenantKey: profile.tenantKey,
      event:
        dto.accessStatus === "suspended"
          ? "tenant_access_suspended"
          : dto.accessStatus === "active"
            ? "tenant_access_resumed"
            : dto.billingStatus
              ? "tenant_billing_status_set"
              : dto.billingContactEmail !== undefined
                ? "tenant_commercial_state_updated"
              : "tenant_commercial_state_updated",
      profile,
    });
    return profile;
  }

  private async requireCommercialOperator(
    commercialOpsToken: string | undefined,
    operatorIdHeader: string | undefined,
    operatorRoleHeader: string | undefined,
    request: Request | undefined,
    routeKey: string,
  ): Promise<{ actorId: string; actorRole: string }> {
    const expectedToken = String(process.env.PIM_COMMERCIAL_OPS_TOKEN ?? "").trim();
    try {
      await requireInternalToken({
        routeKey,
        expectedToken,
        submittedToken: commercialOpsToken,
        request,
        onFailure: (event) =>
          this.auditService.record({
            actorId: "internal-token",
            actorRole: "system",
            action: "COMMERCIAL_INTERNAL_TOKEN_REJECTED",
            resource: "INTERNAL_COMMERCIAL_ROUTE",
            resourceId: routeKey,
            tenantKey: this.resolveCommercialAuditTenantKey(),
            metadata: {
              event: "commercial_internal_token_rejected",
              routeKey,
              reason: event.reason,
              remoteAddress: event.remoteAddress,
              retryAfterSeconds: event.retryAfterSeconds ?? null,
            },
          }),
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw new UnauthorizedException({ error: "COMMERCIAL_OPS_TOKEN_REQUIRED" });
      }
      throw error;
    }

    const actorId = String(operatorIdHeader ?? "").trim();
    const actorRole = String(operatorRoleHeader ?? "").trim();
    if (!actorId) {
      throw new BadRequestException({ error: "COMMERCIAL_OPERATOR_ID_REQUIRED" });
    }
    if (!actorRole) {
      throw new BadRequestException({ error: "COMMERCIAL_OPERATOR_ROLE_REQUIRED" });
    }
    return { actorId, actorRole };
  }

  private resolveCommercialAuditTenantKey(tenantKey?: string | null): string {
    const normalized = String(tenantKey ?? "").trim();
    return normalized.length > 0 ? normalizeTenantKey(normalized) : DEFAULT_TENANT_KEY;
  }
}
