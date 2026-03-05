import { IsInt, IsOptional, IsString, Max, Min, MinLength } from "class-validator";

export class LoginDto {
  @IsString()
  @MinLength(1)
  userId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4 * 60)
  expiresInMinutes?: number;

  @IsString()
  @MinLength(1)
  password!: string;
}
