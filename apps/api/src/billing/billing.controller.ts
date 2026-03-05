import { Body, Controller, Get, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service";
import { AppRole, Roles } from "../common/rbac/roles";
import { PlanUsageService } from "./plan-usage.service";
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
  ) {}

  @Get("usage")
  @ApiOperation({ summary: "Get current tenant plan usage" })
  @ApiResponse({ status: 200, description: "Plan usage fetched" })
  usage() {
    return this.planUsageService.getUsageSummary();
  }

  @Get("plan-profile")
  @Roles("admin")
  @ApiOperation({ summary: "Get current tenant plan profile" })
  @ApiResponse({ status: 200, description: "Tenant plan profile fetched" })
  planProfile() {
    return this.planUsageService.getTenantPlanProfile();
  }

  @Post("plan-tier")
  @Roles("admin")
  @ApiOperation({ summary: "Set tenant plan tier" })
  @ApiResponse({ status: 200, description: "Tenant plan tier updated" })
  async setPlanTier(
    @Body() dto: SetTenantPlanTierDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actorId = String(request.pimUserId ?? "system");
    const actorRole = String(request.pimRole ?? "admin");
    const profile = await this.planUsageService.setTenantPlanTier(
      dto.planTier,
      actorId,
    );
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
    return profile;
  }
}
