import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ProductPriceEntryDto {
  /** Variant ID to set prices for. Must belong to the same tenant. */
  @ApiProperty({ example: "clz1abc..." })
  @IsString()
  @IsNotEmpty()
  variantId!: string;

  /** Maximum retail price (or "was" price). Null / omitted clears the field. */
  @ApiPropertyOptional({ example: 999.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999_999_999)
  mrp?: number | null;

  /** Actual selling price. Null / omitted clears the field. */
  @ApiPropertyOptional({ example: 799.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999_999_999)
  sellingPrice?: number | null;
}

export class UpsertProductPricesDto {
  @ApiProperty({ type: [ProductPriceEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductPriceEntryDto)
  prices!: ProductPriceEntryDto[];
}
