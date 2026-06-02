import { Global, Module } from "@nestjs/common";
import { AuthEmailService } from "../auth/auth-email.service";
import { AuditModule } from "../audit/audit.module";
import { BillingController } from "./billing.controller";
import { CommercialNotificationsService } from "./commercial-notifications.service";
import { CommercialRemindersService } from "./commercial-reminders.service";
import { CommercialRequestsService } from "./commercial-requests.service";
import { GracePeriodEscalationService } from "./grace-period-escalation.service";
import { PlanGuard } from "./plan-guard.guard";
import { PlanUsageService } from "./plan-usage.service";
import { StripeService } from "./stripe.service";
import { StripeWebhookController } from "./stripe-webhook.controller";

@Global()
@Module({
  imports: [AuditModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [
    PlanUsageService,
    PlanGuard,
    AuthEmailService,
    CommercialNotificationsService,
    CommercialRequestsService,
    CommercialRemindersService,
    GracePeriodEscalationService,
    StripeService,
  ],
  exports: [PlanUsageService, PlanGuard, StripeService],
})
export class BillingModule {}
