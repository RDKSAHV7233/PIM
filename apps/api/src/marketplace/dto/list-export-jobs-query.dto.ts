import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { CursorPaginationDto } from "../../common/pagination/cursor-pagination.dto";

export class ListExportJobsQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: "Filter export jobs by product ID" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  productId?: string;

  @ApiPropertyOptional({ description: "Include template summary in response", enum: ["true", "false"] })
  @IsOptional()
  @IsIn(["true", "false"])
  templateSummary?: string;
}
