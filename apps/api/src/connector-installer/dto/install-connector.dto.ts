import { IsOptional, IsString, MaxLength } from "class-validator";

export class InstallConnectorDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountAlias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalAccountRef?: string;
}
