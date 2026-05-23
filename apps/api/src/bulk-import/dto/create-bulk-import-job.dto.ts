import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBase64,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const SOURCE_FORMATS = ["csv", "json"] as const;

export class CreateBulkImportJobDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  runId?: string;

  @IsString()
  @MaxLength(50)
  categoryId!: string;

  @IsIn(SOURCE_FORMATS)
  sourceFormat!: (typeof SOURCE_FORMATS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5_000_000)  // bounded by 10 MB body limit; explicit cap prevents outsized JSON strings
  csvContent?: string;

  @IsOptional()
  @IsBase64()
  fileContentBase64?: string;

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
