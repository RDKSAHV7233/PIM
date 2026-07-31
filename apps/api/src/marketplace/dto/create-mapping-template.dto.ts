import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { MARKETPLACE_CHANNELS } from "../marketplace-channels";

export class CreateMappingTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(MARKETPLACE_CHANNELS)
  channel!: (typeof MARKETPLACE_CHANNELS)[number];

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  requiredFields!: string[];

  @IsObject()
  fieldMap!: Record<string, string | string[]>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
