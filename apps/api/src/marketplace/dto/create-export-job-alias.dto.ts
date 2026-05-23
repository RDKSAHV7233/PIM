import { IsString, MaxLength } from "class-validator";
import { CreateExportJobDto } from "./create-export-job.dto";

export class CreateExportJobAliasDto extends CreateExportJobDto {
  @IsString()
  @MaxLength(50)
  productId!: string;
}
