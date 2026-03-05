import { Global, Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { BillingController } from "./billing.controller";
import { PlanGuard } from "./plan-guard.guard";
import { PlanUsageService } from "./plan-usage.service";

@Global()
@Module({
  imports: [AuditModule],
  controllers: [BillingController],
  providers: [PlanUsageService, PlanGuard],
  exports: [PlanUsageService, PlanGuard],
})
export class BillingModule {}
