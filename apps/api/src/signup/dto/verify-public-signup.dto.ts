import { Transform } from "class-transformer";
import { IsString, MinLength } from "class-validator";

export class VerifyPublicSignupDto {
  @Transform(({ value }) => String(value ?? "").trim())
  @IsString()
  @MinLength(1)
  token!: string;
}
