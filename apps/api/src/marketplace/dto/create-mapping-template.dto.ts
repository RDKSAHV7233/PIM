import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";
import { MARKETPLACE_CHANNELS } from "./simulate-marketplace.dto";

export class CreateMappingTemplateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsIn(MARKETPLACE_CHANNELS)
  channel!: (typeof MARKETPLACE_CHANNELS)[number];

  @IsArray()
  @IsString({ each: true })
  requiredFields!: string[];

  @IsObject()
  fieldMap!: Record<string, string>;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
