import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from "class-validator";

export class UpsertOidcConfigDto {
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  issuer!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  clientId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  clientSecret!: string;

  @IsUrl({ require_tld: false })
  @MaxLength(500)
  callbackUrl!: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @IsOptional()
  scopes?: string[];

  /** JSON object mapping IdP claim names to Vexa roles.
   * e.g. { "roles": { "pim_admin": "admin", "pim_editor": "editor" } }
   */
  @IsOptional()
  claimsMapping?: Record<string, unknown>;
}
