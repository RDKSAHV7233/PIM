import { Type } from "class-transformer";
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CreateBulkImportRunDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  categoryId!: string;

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
