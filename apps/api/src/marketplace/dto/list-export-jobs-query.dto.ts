import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { CursorPaginationDto } from "../../common/pagination/cursor-pagination.dto";

export class ListExportJobsQueryDto extends CursorPaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  productId?: string;

  @IsOptional()
  @IsIn(["true", "false"])
  templateSummary?: string;
}
