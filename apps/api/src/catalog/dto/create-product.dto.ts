import { Transform, Type } from "class-transformer";
import { IsArray, IsEnum, IsIn, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { TaxCodeKey } from "@prisma/client";

const PRODUCT_STATUSES = ["draft", "in_review", "approved", "rejected", "active", "archived"] as const;

export class TaxCodeDto {
  /** Market code matching a TaxRegime.marketCode e.g. "IN", "GB", "US", "AE". */
  @IsString()
  @MaxLength(8)
  regimeKey!: string;

  /** Canonical tax identifier type. Uses the Prisma-generated TaxCodeKey enum. */
  @IsEnum(TaxCodeKey)
  key!: TaxCodeKey;

  /** Tax identifier value e.g. "62044200" (HSN), "6204420000" (commodity code). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  value!: string;

  /** Tax rate percentage — e.g. 5, 12, 18, 28 for India GST; 20 for UK VAT. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  rate?: number;
}

export class CreateProductDto {
  @IsString()
  @MinLength(2)
  @MaxLength(220)
  title!: string;

  @IsString()
  @MaxLength(5000)
  description!: string;

  @IsString()
  @MaxLength(120)
  brand!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorScopeKey?: string;

  @IsString()
  @MaxLength(50)
  categoryId!: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}(\d{2})?(\d{2})?$/, { message: "HSN must be 4, 6, or 8 digits" })
  hsnCode?: string;

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null || value === undefined ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  gstRate?: number;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: (typeof PRODUCT_STATUSES)[number];

  /**
   * Structured tax codes for one or more tax regimes.
   * - undefined: no tax codes provided (OK — product may have none yet)
   * - []: not meaningful on create (same as undefined; ignored)
   * Duplicate regimeKey+key pairs or unknown regimeKeys are rejected with 400.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxCodeDto)
  taxCodes?: TaxCodeDto[];
}
