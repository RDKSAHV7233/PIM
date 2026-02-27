import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";
import { MARKETPLACE_CHANNELS } from "./simulate-marketplace.dto";

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
}
