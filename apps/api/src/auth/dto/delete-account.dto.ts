import { IsOptional, IsString, MaxLength } from "class-validator";

export class DeleteAccountDto {
  @IsString()
  @MaxLength(50)
  confirmation!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
