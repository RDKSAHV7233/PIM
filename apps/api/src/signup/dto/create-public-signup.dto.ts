import { Transform } from "class-transformer";
import { IsBoolean, IsEmail, IsString, MaxLength, MinLength } from "class-validator";

export class CreatePublicSignupDto {
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsString()
  @MaxLength(64)
  workspaceSlug!: string;

  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsEmail()
  @MaxLength(320)
  adminEmail!: string;

  @Transform(({ value }) => String(value ?? ""))
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsBoolean()
  acceptedTerms!: boolean;
}
