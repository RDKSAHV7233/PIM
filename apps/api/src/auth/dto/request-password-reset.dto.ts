import { IsString, MaxLength, MinLength } from "class-validator";

export class RequestPasswordResetDto {
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  email!: string;
}
