import { IsNumber, IsOptional, IsString } from "class-validator";

export class ImportValidateDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsString()
  fileName!: string;

  @IsNumber()
  fileSize!: number;

  @IsString()
  mimeType!: string;
}
