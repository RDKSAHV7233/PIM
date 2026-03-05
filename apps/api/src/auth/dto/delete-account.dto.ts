import { IsOptional, IsString, MaxLength } from "class-validator";

export class DeleteAccountDto {
  @IsString()
  confirmation!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
