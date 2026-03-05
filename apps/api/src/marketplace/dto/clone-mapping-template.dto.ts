import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CloneMappingTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

