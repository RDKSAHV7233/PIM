import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";

const SOURCE_FORMATS = ["csv", "json"] as const;

export class CreateBulkImportJobDto {
  @IsString()
  categoryId!: string;

  @IsIn(SOURCE_FORMATS)
  sourceFormat!: (typeof SOURCE_FORMATS)[number];

  @IsOptional()
  @IsString()
  sourceName?: string;

  @IsOptional()
  @IsString()
  csvContent?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10000)
  @IsObject({ each: true })
  rows?: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  mapping?: Record<string, string>;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  chunkSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxRetries?: number;
}
