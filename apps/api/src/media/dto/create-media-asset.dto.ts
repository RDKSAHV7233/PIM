import { Transform } from "class-transformer";
import { IsBase64, IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

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

  @IsOptional()
  @IsString()
  @MaxLength(280)
  altText?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === "true" || value === "1" || value === "on")
  @IsBoolean()
  isMain?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === null || value === "" ? undefined : Number(value)))
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? value.map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0)
      : String(value ?? "")
          .split(/[,\n]/)
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
  )
  channelEligibility?: string[];
}
