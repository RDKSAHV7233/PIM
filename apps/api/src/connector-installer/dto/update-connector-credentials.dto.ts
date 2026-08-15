import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * All fields optional at the class level — which fields are actually required
 * or allowed is connector-dependent (see the per-connector allowlist table in
 * ConnectorInstallerService.updateCredentials()) and enforced in the service,
 * not here.
 */
export class UpdateConnectorCredentialsDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalAccountRef?: string;

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
}
