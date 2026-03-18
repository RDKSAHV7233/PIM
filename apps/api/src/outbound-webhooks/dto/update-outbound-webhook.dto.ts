import { IsBoolean, IsOptional, IsString, IsUrl, MaxLength, MinLength } from "class-validator";

export class UpdateOutboundWebhookDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
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
