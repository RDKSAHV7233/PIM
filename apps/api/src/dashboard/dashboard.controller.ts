import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@ApiTags("Dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("readiness")
  @ApiOperation({ summary: "Per-connector readiness summary for current tenant" })
  @ApiResponse({ status: 200, description: "Readiness summary fetched" })
  getReadiness() {
    return this.dashboardService.getReadiness();
  }

  @Get("catalog-health")
  @ApiOperation({ summary: "Catalog health and completeness summary for current tenant" })
  @ApiResponse({ status: 200, description: "Catalog health fetched" })
  getCatalogHealth() {
    return this.dashboardService.getCatalogHealth();
  }

  @Get("health")
  @ApiOperation({ summary: "Catalog health snapshot with 30-day trend" })
  @ApiResponse({ status: 200, description: "Dashboard health snapshot fetched" })
  getHealth() {
    return this.dashboardService.getHealth();
  }
}
