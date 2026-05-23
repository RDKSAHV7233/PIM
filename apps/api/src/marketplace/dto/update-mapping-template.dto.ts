import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { MARKETPLACE_CHANNELS } from "../marketplace-channels";

export class UpdateMappingTemplateDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(MARKETPLACE_CHANNELS)
  channel?: (typeof MARKETPLACE_CHANNELS)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  requiredFields?: string[];

  @IsOptional()
  @IsObject()
  fieldMap?: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @Min(1)
  version?: number;
}
