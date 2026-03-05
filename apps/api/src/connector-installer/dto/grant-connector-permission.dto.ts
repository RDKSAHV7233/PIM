import { IsIn, IsOptional, IsString, MaxLength } from "class-validator";

export class GrantConnectorPermissionDto {
  @IsString()
  @IsIn(["user", "role"])
  principalType!: "user" | "role";

  @IsString()
  @MaxLength(120)
  principalId!: string;

  @IsString()
  @MaxLength(120)
  connectorSlug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountAlias?: string;

  @IsString()
  @IsIn(["install", "reconnect", "uninstall"])
  action!: "install" | "reconnect" | "uninstall";
}
