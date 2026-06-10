import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class CreateCurrencyDto {
  /** ISO 4217 currency code, upper-case, 3 letters. */
  @ApiProperty({ example: "INR", description: "ISO 4217 currency code" })
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: "code must be a 3-letter ISO 4217 currency code (e.g. INR, USD)" })
  code!: string;

  /** Currency symbol shown in UI. */
  @ApiProperty({ example: "₹", description: "Currency symbol" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(8)
  symbol!: string;

  @ApiProperty({ example: "Indian Rupee" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  displayName!: string;

  /** Number of decimal places for display and rounding (0–6). Defaults to 2. */
  @ApiPropertyOptional({ default: 2, minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  decimalPlaces?: number;
}
