import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service";
import { AppRole, Roles } from "../common/rbac/roles";
import { Public } from "../auth/public.decorator";
import { CommercialNotificationsService } from "./commercial-notifications.service";
import { PlanUsageService } from "./plan-usage.service";
import { PlanProfileSummaryDto, PlanUsageSummaryDto } from "./dto/billing-response.dto";
import { InternalUpdateTenantCommercialStateDto } from "./dto/internal-update-tenant-commercial-state.dto";
import { InternalSetTenantPlanTierDto } from "./dto/internal-set-tenant-plan-tier.dto";
import { SearchCommercialTenantsDto } from "./dto/search-commercial-tenants.dto";
import { SetTenantPlanTierDto } from "./dto/set-tenant-plan-tier.dto";

type AuthenticatedRequest = FastifyRequest & {
  pimUserId?: string;
  pimRole?: AppRole;
};

@Controller("billing")
@ApiTags("Billing")
export class BillingController {
  constructor(
    private readonly planUsageService: PlanUsageService,
    private readonly auditService: AuditService,
    private readonly commercialNotificationsService: CommercialNotificationsService,
  ) {}

  @Get("usage")
  @ApiOperation({ summary: "Get current tenant plan usage" })
  @ApiResponse({ status: 200, description: "Plan usage fetched", type: PlanUsageSummaryDto })
  usage() {
    return this.planUsageService.getUsageSummary();
  }

  @Get("plan-profile")
  @Roles("admin")
  @ApiOperation({ summary: "Get current tenant plan profile" })
  @ApiResponse({ status: 200, description: "Tenant plan profile fetched", type: PlanProfileSummaryDto })
  planProfile() {
    return this.planUsageService.getTenantPlanProfile();
  }

  @Post("plan-tier")
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
  @Get("internal/tenants/search")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Internal-only commercial tenant search" })
  async searchCommercialTenantsInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Query() query: SearchCommercialTenantsDto,
  ) {
    const { actorId, actorRole } = this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
    );

    let results;
    try {
      results = await this.planUsageService.searchCommercialTenants(query.q, query.limit);
    } catch (error: unknown) {
      const code = error instanceof Error ? error.message : String(error ?? "unknown error");
      throw new BadRequestException({ error: code });
    }
    await this.auditService.record({
      actorId,
      actorRole,
      action: "COMMERCIAL_TENANT_SEARCH",
      resource: "WORKSPACE_DIRECTORY",
      resourceId: query.q,
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
  @Post("internal/plan-tier")
  @ApiExcludeEndpoint()
  @ApiOperation({ summary: "Internal-only tenant plan tier update" })
  @ApiResponse({ status: 200, description: "Tenant plan tier updated" })
  async setPlanTierInternal(
    @Headers("x-pim-commercial-ops-token") commercialOpsToken: string | undefined,
    @Headers("x-pim-operator-id") operatorIdHeader: string | undefined,
    @Headers("x-pim-operator-role") operatorRoleHeader: string | undefined,
    @Body() dto: InternalSetTenantPlanTierDto,
  ) {
    const { actorId, actorRole } = this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
    );

    const profile = await this.planUsageService.setTenantPlanTierForTenant(dto.tenantKey, dto.planTier, actorId);
    await this.auditService.record({
      actorId,
      actorRole,
      action: "PLAN_TIER_CHANGE",
      resource: "TENANT_PLAN_PROFILE",
      resourceId: profile.tenantKey,
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
  ) {
    const { actorId, actorRole } = this.requireCommercialOperator(
      commercialOpsToken,
      operatorIdHeader,
      operatorRoleHeader,
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
            : "TENANT_COMMERCIAL_STATE_UPDATED";
    const auditEvent =
      dto.accessStatus === "suspended"
        ? "tenant_suspended"
        : dto.accessStatus === "active"
          ? "tenant_resumed"
          : dto.billingStatus
            ? "tenant_billing_status_set"
            : "tenant_commercial_state_updated";

    await this.auditService.record({
      actorId,
      actorRole,
      action: auditAction,
      resource: "TENANT_PLAN_PROFILE",
      resourceId: profile.tenantKey,
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
              : "tenant_commercial_state_updated",
      profile,
    });
    return profile;
  }

  private requireCommercialOperator(
    commercialOpsToken: string | undefined,
    operatorIdHeader: string | undefined,
    operatorRoleHeader: string | undefined,
  ): { actorId: string; actorRole: string } {
    const expectedToken = String(process.env.PIM_COMMERCIAL_OPS_TOKEN ?? "").trim();
    if (!expectedToken || commercialOpsToken !== expectedToken) {
      throw new UnauthorizedException({ error: "COMMERCIAL_OPS_TOKEN_REQUIRED" });
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
}
