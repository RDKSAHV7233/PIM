import { Transform } from "class-transformer";
import { IsBase64, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateMediaAssetDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  variantId?: string;

  @IsString()
  @MaxLength(260)
  fileName!: string;

  @IsString()
  @MaxLength(128)
  mimeType!: string;

  @IsBase64()
  contentBase64!: string;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null || value === "" ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  width?: number;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null || value === "" ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  height?: number;
}
