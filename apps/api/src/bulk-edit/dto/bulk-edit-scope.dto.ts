import { IsArray, IsIn, IsOptional, IsString } from "class-validator";

const RECORD_STATUSES = ["draft", "active", "archived"] as const;

export class BulkEditScopeDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(RECORD_STATUSES)
  status?: (typeof RECORD_STATUSES)[number];

  @IsOptional()
  @IsString()
  brandContains?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  productIds?: string[];
}
