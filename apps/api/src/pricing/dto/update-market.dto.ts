import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

const MARKET_STATUS_VALUES = ["active", "inactive"] as const;

export class UpdateMarketDto {
  /** Override the locale string — rarely needed after creation. */
  @ApiPropertyOptional({ example: "en-IN" })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  locale?: string;

  @ApiPropertyOptional({ example: "India (Updated)" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  /** Setting to true will clear the current default market for this tenant. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: MARKET_STATUS_VALUES })
  @IsOptional()
  @IsIn(MARKET_STATUS_VALUES)
  status?: (typeof MARKET_STATUS_VALUES)[number];
}
