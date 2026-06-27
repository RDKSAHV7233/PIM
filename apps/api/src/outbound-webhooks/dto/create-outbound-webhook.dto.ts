import { IsBoolean, IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from "class-validator";
import { NOTIFICATION_EVENT_TYPES, type NotificationEventType } from "../../notifications/notification-event.types";

// Allow HTTP webhook targets in integration-test environments only.
// PIM_UNSAFE_HTTP_WEBHOOK_TARGETS must never be set in production.
const webhookUrlPattern =
  process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS === "true" ? /^https?:\/\// : /^https:\/\//;

export class CreateOutboundWebhookDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(NOTIFICATION_EVENT_TYPES)
  eventType!: NotificationEventType;

  @IsUrl({ require_tld: false })
  @Matches(webhookUrlPattern, { message: "Webhook target URL must use HTTPS." })
  @MaxLength(500)
  targetUrl!: string;

  @IsString()
  @MinLength(16)
  @MaxLength(256)
  signingSecret!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
