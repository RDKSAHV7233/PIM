import { Controller, Get, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { AccessPolicyService } from "../common/access-policy/access-policy.service";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute, ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole } from "../common/rbac/roles";
import { Roles } from "../common/rbac/roles";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@DisallowApiClient()
@ApiTags("Dashboard")
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly accessPolicyService: AccessPolicyService,
  ) {}

  private resolveActor(
    request: FastifyRequest & {
      pimUserId?: string;
      pimRole?: AppRole;
      pimTenant?: string;
      pimAuthType?: "user_jwt" | "api_key";
    },
  ) {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
      actorType: request.pimAuthType === "api_key" ? "api_client" : "human",
    } as const;
  }

  @Get("readiness")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Per-connector readiness summary for current tenant" })
  @ApiResponse({ status: 200, description: "Readiness summary fetched" })
  getReadiness() {
    return this.dashboardService.getReadiness();
  }

  @Get("catalog-health")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Catalog health and completeness summary for current tenant" })
  @ApiResponse({ status: 200, description: "Catalog health fetched" })
  getCatalogHealth() {
    return this.dashboardService.getCatalogHealth();
  }

  @Get("health")
  @ReadAccessPolicy("dashboard_health_redacted")
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @ApiOperation({ summary: "Catalog health snapshot with 30-day trend" })
  @ApiResponse({ status: 200, description: "Dashboard health snapshot fetched" })
  async getHealth(
    @Req()
    request: FastifyRequest & {
      pimUserId?: string;
      pimRole?: AppRole;
      pimTenant?: string;
      pimAuthType?: "user_jwt" | "api_key";
    },
  ) {
    const health = await this.dashboardService.getHealth();
    return this.accessPolicyService.applyReadResponsePolicy(
      this.resolveActor(request),
      "dashboard_health_redacted",
      health,
    );
  }

  @Get("operations-summary")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
  @AdminBoundaryAccess({ capability: "manage_product_data" })
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Dashboard operations summary for current tenant" })
  @ApiResponse({ status: 200, description: "Dashboard operations summary fetched" })
  getOperationsSummary() {
    return this.dashboardService.getOperationsSummary();
  }
}
