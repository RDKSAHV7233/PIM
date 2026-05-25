import { IsString, MaxLength } from "class-validator";

export class ResendUnlockDto {
  @IsString()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MaxLength(64)
  workspaceSlug!: string;
}
