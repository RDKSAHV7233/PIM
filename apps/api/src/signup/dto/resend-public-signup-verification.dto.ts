import { Transform } from "class-transformer";
import { IsEmail, MaxLength } from "class-validator";

export class ResendPublicSignupVerificationDto {
  @Transform(({ value }) => String(value ?? "").trim().toLowerCase())
  @IsEmail()
  @MaxLength(320)
  adminEmail!: string;
}
