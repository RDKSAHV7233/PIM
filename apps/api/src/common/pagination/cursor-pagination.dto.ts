import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

export class CursorPaginationDto {
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
