import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { OutboundWebhooksModule } from "../outbound-webhooks/outbound-webhooks.module";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

@Module({
  imports: [AuditModule, OutboundWebhooksModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
