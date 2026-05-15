import { IsArray, IsNotEmpty, IsOptional, IsString, IsUrl } from "class-validator";

export class UpsertOidcConfigDto {
  @IsUrl({ require_tld: false })
  issuer!: string;

  @IsString()
  @IsNotEmpty()
  clientId!: string;

  @IsString()
  @IsNotEmpty()
  clientSecret!: string;

  @IsUrl({ require_tld: false })
  callbackUrl!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopes?: string[];

  /** JSON object mapping IdP claim names to Vexa roles.
   * e.g. { "roles": { "pim_admin": "admin", "pim_editor": "editor" } }
   */
  @IsOptional()
  claimsMapping?: Record<string, unknown>;
}
