import { IsObject, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { BulkEditScopeDto } from "./bulk-edit-scope.dto";

export class BulkEditPreviewDto {
  @ValidateNested()
  @Type(() => BulkEditScopeDto)
  scope!: BulkEditScopeDto;

  @IsObject()
  updates!: Record<string, unknown>;
}
