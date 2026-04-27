import { Module } from "@nestjs/common";
import { AccessPolicyModule } from "../common/access-policy/access-policy.module";
import { MetricsModule } from "../metrics/metrics.module";
import { DashboardController } from "./dashboard.controller";
import { DashboardService } from "./dashboard.service";

@Module({
  imports: [MetricsModule, AccessPolicyModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
