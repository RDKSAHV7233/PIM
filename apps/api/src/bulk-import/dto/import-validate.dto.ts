import { IsNumber, IsOptional, IsString, MaxLength } from "class-validator";

export class ImportValidateDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  categoryId?: string;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsNumber()
  fileSize!: number;

  @IsString()
  @MaxLength(100)
  mimeType!: string;
}
