import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export type IssueInboxSeverityFilter = "BLOCKING" | "WARNING";

export class IssueInboxQueryDto {
  @IsOptional()
  @IsIn(["BLOCKING", "WARNING"])
  severity?: IssueInboxSeverityFilter;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  installationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  categoryId?: string;

  @IsOptional()
  @IsIn(["draft", "in_review", "approved", "rejected", "active", "archived"])
  productStatus?: "draft" | "in_review" | "approved" | "rejected" | "active" | "archived";

  @IsOptional()
  @IsIn(["cursor"])
  pagination?: "cursor";

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cursor?: string;
}
