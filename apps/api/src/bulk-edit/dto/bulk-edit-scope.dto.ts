import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from "class-validator";

const RECORD_STATUSES = ["draft", "in_review", "approved", "rejected", "active", "archived"] as const;

export class BulkEditScopeDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  categoryId?: string;

  @IsOptional()
  @IsIn(RECORD_STATUSES)
  status?: (typeof RECORD_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  brandContains?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  productIds?: string[];
}
