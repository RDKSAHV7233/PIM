import { IsIn, IsOptional } from "class-validator";

const EXPORT_FORMATS = ["json", "csv"] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

export class RequestAccountExportDto {
  @IsOptional()
  @IsIn(EXPORT_FORMATS)
  format?: ExportFormat;
}
