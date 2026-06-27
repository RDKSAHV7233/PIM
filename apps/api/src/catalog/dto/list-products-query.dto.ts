import { IsOptional, IsString } from "class-validator";
import { CursorPaginationDto } from "../../common/pagination/cursor-pagination.dto";

export class ListProductsQueryDto extends CursorPaginationDto {
  @IsOptional()
  @IsString()
  slim?: string;
}
