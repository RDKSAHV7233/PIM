import { Type } from "class-transformer";
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

const SOURCE_FORMATS = ["csv", "json"] as const;

export class CreateBulkImportRunDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  categoryId!: string;

  @IsOptional()
  @IsIn(SOURCE_FORMATS)
  sourceFormat?: (typeof SOURCE_FORMATS)[number];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  sourceName?: string;

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
