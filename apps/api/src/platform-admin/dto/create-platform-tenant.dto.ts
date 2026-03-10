import { IsString, Matches, MinLength } from "class-validator";

export class CreatePlatformTenantDto {
  @IsString()
  @MinLength(1)
  tenantKey!: string;

  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  workspaceSlug!: string;

  @IsString()
  @MinLength(1)
  displayName!: string;

  @IsString()
  @MinLength(1)
  initialAdminUserId!: string;
}
