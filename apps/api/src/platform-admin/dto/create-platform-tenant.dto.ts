import { IsString, Matches, MaxLength, MinLength } from "class-validator";

export class CreatePlatformTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  tenantKey!: string;

  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  workspaceSlug!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  initialAdminUserId!: string;
}
