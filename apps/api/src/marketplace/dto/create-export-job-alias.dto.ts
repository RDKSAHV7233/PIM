import { IsString } from "class-validator";
import { CreateExportJobDto } from "./create-export-job.dto";

export class CreateExportJobAliasDto extends CreateExportJobDto {
  @IsString()
  productId!: string;
}
