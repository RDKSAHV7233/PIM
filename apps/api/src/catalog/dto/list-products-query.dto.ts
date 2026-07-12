import { IsIn, IsOptional, IsString } from "class-validator";
import { CursorPaginationDto } from "../../common/pagination/cursor-pagination.dto";

const PRODUCT_STATUSES = ["draft", "in_review", "approved", "rejected", "active", "archived"] as const;

export class ListProductsQueryDto extends CursorPaginationDto {
  @IsOptional()
  @IsString()
  slim?: string;

  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: (typeof PRODUCT_STATUSES)[number];
}
