import { IsBoolean, IsObject, IsOptional } from "class-validator";

export class RepairBulkImportRowDto {
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  requeue?: boolean;
}
