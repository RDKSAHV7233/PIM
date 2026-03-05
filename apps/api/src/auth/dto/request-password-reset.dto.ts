import { IsString, MinLength } from "class-validator";

export class RequestPasswordResetDto {
  @IsString()
  @MinLength(3)
  email!: string;
}
