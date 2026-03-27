import { Global, Module } from "@nestjs/common";
import { AuthEmailService } from "../auth/auth-email.service";
import { AuditModule } from "../audit/audit.module";
import { BillingController } from "./billing.controller";
import { CommercialNotificationsService } from "./commercial-notifications.service";
import { PlanGuard } from "./plan-guard.guard";
import { PlanUsageService } from "./plan-usage.service";

@Global()
@Module({
  imports: [AuditModule],
  controllers: [BillingController],
  providers: [PlanUsageService, PlanGuard, AuthEmailService, CommercialNotificationsService],
  exports: [PlanUsageService, PlanGuard],
})
export class BillingModule {}
