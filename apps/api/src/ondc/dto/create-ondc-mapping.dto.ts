import { Transform } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from "class-validator";

const NODE_TYPES = ["buyer_app", "seller_app", "gateway", "logistics"] as const;

export class CreateOndcMappingDto {
  @IsString()
  @MaxLength(140)
  name!: string;

  @IsString()
  @MaxLength(50)
  categoryId!: string;

  @IsString()
  @IsIn(NODE_TYPES)
  nodeType!: (typeof NODE_TYPES)[number];

  @IsString()
  @MaxLength(40)
  version!: string;

  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  requiredFields!: string[];

  @IsObject()
  fieldMap!: Record<string, string>;

  @IsOptional()
  @IsObject()
  discoveryMetadata?: Record<string, unknown>;

  @IsOptional()
  @Transform(({ value }) => value === true || value === "true")
  @IsBoolean()
  isDefault?: boolean;
}
