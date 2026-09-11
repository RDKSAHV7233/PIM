import { Module } from "@nestjs/common";
import { MetricsModule } from "../../metrics/metrics.module";
import { ResendWebhookController } from "./resend-webhook.controller";

@Module({
  imports: [MetricsModule],
  controllers: [ResendWebhookController],
})
export class ResendWebhookModule {}
