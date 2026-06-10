import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

const PRICE_LIST_STATUS_VALUES = ["active", "inactive"] as const;

export class CreatePriceListDto {
  @ApiProperty({ example: "India Default Price List" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  /** ID of the Market this price list belongs to. Must exist within the same tenant. */
  @ApiProperty({ example: "clz1abc..." })
  @IsString()
  @IsNotEmpty()
  marketId!: string;

  /** ID of the Currency for this price list. Must exist within the same tenant. */
  @ApiProperty({ example: "clz1def..." })
  @IsString()
  @IsNotEmpty()
  currencyId!: string;

  /** When true, unsets any existing default price list for this tenant. */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: PRICE_LIST_STATUS_VALUES, default: "active" })
  @IsOptional()
  @IsIn(PRICE_LIST_STATUS_VALUES)
  status?: (typeof PRICE_LIST_STATUS_VALUES)[number];
}
