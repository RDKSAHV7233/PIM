import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const MARKET_STATUS_VALUES = ["active", "inactive"] as const;

export class CreateMarketDto {
  /** ISO 3166-1 alpha-2 country code, upper-case. */
  @ApiProperty({ example: "IN", description: "ISO 3166-1 alpha-2 market code" })
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: "code must be a 2-letter ISO 3166-1 alpha-2 code (e.g. IN, US)" })
  code!: string;

  /** BCP-47 locale string, e.g. "en-IN". */
  @ApiProperty({ example: "en-IN", description: "BCP-47 locale identifier" })
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  locale!: string;

  @ApiProperty({ example: "India", description: "Human-readable market name" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  displayName!: string;

  /** When true, unsets any existing default market for this tenant. */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: MARKET_STATUS_VALUES, default: "active" })
  @IsOptional()
  @IsIn(MARKET_STATUS_VALUES)
  status?: (typeof MARKET_STATUS_VALUES)[number];
}
