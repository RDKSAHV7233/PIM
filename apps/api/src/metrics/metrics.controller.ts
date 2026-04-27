import { Controller, Get, Query } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { Roles } from "../common/rbac/roles";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { MetricsService } from "./metrics.service";

@Controller("metrics")
@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@ApiTags("Metrics")
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get("kpi-trends")
  @Roles("admin")
  @ApiOperation({ summary: "KPI trends by tenant and connector" })
  @ApiQuery({
    name: "days",
    required: false,
    description: "Trend window in days (1-90). Defaults to 30.",
  })
  @ApiResponse({ status: 200, description: "KPI trend series fetched" })
  async getKpiTrends(@Query("days") daysInput?: string) {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const days = daysInput ? Number.parseInt(daysInput, 10) : undefined;
    return this.metricsService.getKpiTrends(tenantKey, Number.isFinite(days) ? days : undefined);
  }
}
