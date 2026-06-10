import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

const PRICE_LIST_STATUS_VALUES = ["active", "inactive"] as const;

export class UpdatePriceListDto {
  @ApiPropertyOptional({ example: "India Default Price List" })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  /** Setting to true will clear the current default price list for this tenant. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ enum: PRICE_LIST_STATUS_VALUES })
  @IsOptional()
  @IsIn(PRICE_LIST_STATUS_VALUES)
  status?: (typeof PRICE_LIST_STATUS_VALUES)[number];
}
