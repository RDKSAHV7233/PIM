import { IsBoolean, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength } from "class-validator";

const webhookUrlPattern =
  process.env.PIM_UNSAFE_HTTP_WEBHOOK_TARGETS === "true" ? /^https?:\/\// : /^https:\/\//;

export class UpdateOutboundWebhookDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @Matches(webhookUrlPattern, { message: "Webhook target URL must use HTTPS." })
  @MaxLength(500)
  targetUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  signingSecret?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
