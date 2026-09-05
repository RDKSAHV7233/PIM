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
  // @Global() only makes a module's EXPORTS available everywhere without an explicit
  // import — providers left out of this array stay private to this module even though
  // it's global. CommercialRequestsService and CommercialNotificationsService are used
  // outside billing/ now (OidcAuthService, in AuthModule, for the SSO user-limit overage
  // flag) — omitting them here isn't a missing convenience, it's a boot failure:
  // UnknownDependenciesException, the whole API refuses to start.
  exports: [PlanUsageService, PlanGuard, StripeService, CommercialRequestsService, CommercialNotificationsService],
})
export class BillingModule {}
