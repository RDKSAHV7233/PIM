import { Transform } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const VARIANT_STATUSES = ["draft", "active", "archived"] as const;

export class UpdateVariantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  skuCode!: string;

  @IsObject()
  attributes!: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null || value === undefined ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  mrp?: number;

  @IsOptional()
  @Transform(({ value }) => (value === "" || value === null || value === undefined ? undefined : Number(value)))
  @IsNumber()
  @Min(0)
  sellingPrice?: number;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  inventoryQty!: number;

  @IsIn(VARIANT_STATUSES)
  status!: (typeof VARIANT_STATUSES)[number];
}
