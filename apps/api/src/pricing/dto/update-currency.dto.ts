import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";

export class UpdateCurrencyDto {
  @ApiPropertyOptional({ example: "₹" })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  symbol?: string;

  @ApiPropertyOptional({ example: "Indian Rupee" })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  displayName?: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  decimalPlaces?: number;
}
