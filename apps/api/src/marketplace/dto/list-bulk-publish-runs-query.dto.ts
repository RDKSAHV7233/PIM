import { IsOptional, IsString, MaxLength } from "class-validator";
import { ApiPropertyOptional } from "@nestjs/swagger";
import { CursorPaginationDto } from "../../common/pagination/cursor-pagination.dto";

export class ListBulkPublishRunsQueryDto extends CursorPaginationDto {
  @ApiPropertyOptional({ description: "Filter bulk-publish runs to a single connector installation" })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  installationId?: string;
}
