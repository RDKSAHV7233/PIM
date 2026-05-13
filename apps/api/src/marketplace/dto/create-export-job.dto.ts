import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { MARKETPLACE_CHANNELS } from "../marketplace-channels";

export class CreateExportJobDto {
  @IsIn(MARKETPLACE_CHANNELS)
  channel!: (typeof MARKETPLACE_CHANNELS)[number];

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxRetries?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  fallbackAcknowledged?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  installationId?: string;
}
