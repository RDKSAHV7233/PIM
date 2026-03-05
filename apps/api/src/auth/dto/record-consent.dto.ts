import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

export class RecordConsentDto {
  @IsBoolean()
  accepted!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  policyVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  purpose?: string;
}
