import { Transform } from "class-transformer";
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

const DATA_TYPES = ["text", "number", "boolean", "select", "json"] as const;
const APPLIES_TO = ["product", "variant"] as const;

export class UpdateAttributeDefinitionDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  key!: string;

  @IsIn(DATA_TYPES)
  dataType!: (typeof DATA_TYPES)[number];

  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  required!: boolean;

  @IsIn(APPLIES_TO)
  appliesTo!: (typeof APPLIES_TO)[number];

  @IsOptional()
  @IsObject()
  allowedValues?: Record<string, unknown>;
}
