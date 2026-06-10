import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { TaxCodeDto } from "./create-product.dto";

const PRODUCT_STATUSES = ["draft", "in_review", "approved", "rejected", "active", "archived"] as const;

export class UpdateProductDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(220)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  vendorScopeKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  categoryId?: string;

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

  @IsIn(PRODUCT_STATUSES)
  status!: (typeof PRODUCT_STATUSES)[number];

  /**
   * Structured tax codes for one or more tax regimes.
   * - undefined: existing tax codes are PRESERVED (no-op)
   * - []: all existing tax codes for this product are CLEARED
   * - [...]: full-replace — existing codes deleted, new ones inserted
   * Duplicate regimeKey+key pairs or unknown regimeKeys are rejected with 400.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TaxCodeDto)
  taxCodes?: TaxCodeDto[];
}
