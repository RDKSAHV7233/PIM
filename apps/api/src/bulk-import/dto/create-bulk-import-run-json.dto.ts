import { Type } from "class-transformer";
import { IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from "class-validator";

export class CreateBulkImportRunJsonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  categoryId!: string;

  @IsString()
  @IsIn(["csv", "json"])
  sourceFormat!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000_000)
  csvContent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(13_500_000)
  fileContentBase64?: string;

  @IsOptional()
  @IsArray()
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
