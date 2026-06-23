import { IsOptional, IsString } from "class-validator";
import { CursorPaginationDto } from "../../common/pagination/cursor-pagination.dto";

export class ListCategoriesQueryDto extends CursorPaginationDto {
  @IsOptional()
  @IsString()
  all?: string;
}
