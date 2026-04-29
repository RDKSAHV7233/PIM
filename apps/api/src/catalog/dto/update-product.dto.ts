import { Transform } from "class-transformer";
import {
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
} from "class-validator";

const PRODUCT_STATUSES = ["draft", "in_review", "approved", "rejected", "active", "archived"] as const;

export class UpdateProductDto {
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  expectedVersion!: number;

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

  @IsIn(PRODUCT_STATUSES)
  status!: (typeof PRODUCT_STATUSES)[number];
}
