import { Type } from "class-transformer";
import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

const SOURCE_FORMATS = ["csv", "json"] as const;

export class CreateBulkImportTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  tenantKey?: string;

  @IsString()
  categoryId!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsIn(SOURCE_FORMATS)
  sourceFormat!: (typeof SOURCE_FORMATS)[number];

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
