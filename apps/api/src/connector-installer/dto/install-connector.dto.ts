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

  @IsOptional()
  @IsString()
  @MaxLength(255)
  shopDomain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  clientSecret?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  refreshToken?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  accessToken?: string;
}
